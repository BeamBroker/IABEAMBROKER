// A CONTINGÊNCIA DA IA, EXERCITADA — os três caminhos em que o turno termina
// sem resposta real e o cliente recebe a frase fixa.
//
// Por que este arquivo existe: a frase fixa é gravada como Mensagem{autor:"IA"}
// letra por letra igual a uma resposta de verdade, e a rota ainda loga
// "resposta enviada ✓". Em 10/08 isso passou 52 minutos sem ninguém ver. Os
// testes abaixo travam o que torna cada caminho VISÍVEL — o log distinto e a
// linha em LogAuditoria.
//
// SEM BANCO, de propósito. `chave-ia-em-uso.test.ts` fala com o Postgres e não
// roda em máquina sem cluster local; a observabilidade do runner não depende de
// dado nenhum, então mockar o Prisma inteiro deixa o teste rodar em qualquer
// lugar — inclusive no portão do deploy.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CONVERSA = {
  id: 77,
  imobiliariaId: 3,
  agente: "VENDAS",
  memoria: null,
  memoriaMensagens: 0,
  pessoaId: null,
  perfil: null,
  contatoNome: "Quem escreveu",
  contatoTelefone: "5511999998888",
  iaPausada: false,
};

// O que o toolRunner vai emitir neste teste. Cada item é uma "mensagem do
// modelo"; o runner real é async-iterable e emite uma por chamada da API.
let mensagensDoRunner: Array<Record<string, unknown>> = [];
let erroDoRunner: unknown = null;
let opcoesDoConstrutor: Record<string, unknown> | null = null;

// Tipado com os argumentos de propósito: `vi.fn(async () => {})` infere
// tupla VAZIA em mock.calls, e cada `calls[0][3]` abaixo vira erro de tsc
// (TS2493). O build de produção não compila teste, então só o CI pegaria.
const auditar = vi.fn(async (..._a: unknown[]) => {});

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = {
      messages: {
        toolRunner: () => ({
          async *[Symbol.asyncIterator]() {
            if (erroDoRunner) throw erroDoRunner;
            for (const m of mensagensDoRunner) yield m;
          },
        }),
      },
    };
    constructor(opts: Record<string, unknown>) {
      opcoesDoConstrutor = opts;
    }
  },
}));

vi.mock("@/lib/credenciais-ia", () => ({
  credenciaisAnthropic: async () => ({ apiKey: "sk-ant-de-teste", origem: "plataforma" }),
}));

vi.mock("@/lib/uso-ia", () => ({
  podeConsumirIA: async () => true,
  registrarUso: async () => {},
}));

vi.mock("@/lib/auditoria", () => ({ auditar: (...a: unknown[]) => auditar(...(a as [])) }));

// O prisma inteiro por Proxy: a montagem do system prompt consulta várias
// tabelas para dar contexto ao modelo (visita, simulação, imóveis...), e listar
// cada uma tornaria este arquivo refém de qualquer contexto novo que o prompt
// passe a usar. O que se mede aqui é a observabilidade do runner, não a query.
const VAZIO: Record<string, unknown> = {
  // `conversa.findUnique` devolve a MESMA área: sem isso o runner acha que
  // houve troca de agente e sai por outro caminho, sem passar pela contingência.
  conversa: {
    findUnique: async () => ({ ...CONVERSA }),
    findFirst: async () => null,
    update: async () => ({}),
  },
  imobiliaria: { findUnique: async () => ({ id: 3, modulos: [], addons: [] }) },
};

vi.mock("@/lib/db", () => ({
  prisma: new Proxy(VAZIO, {
    get(alvo, model: string) {
      if (model in alvo) return alvo[model];
      return new Proxy(
        {},
        {
          get(_t, metodo: string) {
            if (metodo === "count") return async () => 0;
            if (metodo === "findMany") return async () => [];
            return async () => null;
          },
        }
      );
    },
  }),
}));

const { executarAgente } = await import("./agentes");

beforeEach(() => {
  mensagensDoRunner = [];
  erroDoRunner = null;
  opcoesDoConstrutor = null;
  auditar.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => vi.restoreAllMocks());

const rodar = () =>
  executarAgente({
    conversa: CONVERSA as never,
    historico: [],
    mensagem: "quero ver casas até 500 mil",
  });

const logs = () =>
  (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
    .map((c) => c.map(String).join(" "))
    .join("\n");

describe("o teto de tempo existe por causa da rota, não por gosto", () => {
  it("o cliente da Anthropic nasce com timeout e retry explícitos", async () => {
    // O default do SDK é 600s contra maxDuration=60 do webhook: a função morria
    // ANTES do catch, sem log e sem resposta nenhuma ao lead.
    mensagensDoRunner = [{ content: [{ type: "text", text: "oi" }], stop_reason: "end_turn" }];
    await rodar();
    expect(opcoesDoConstrutor?.timeout).toBe(25_000);
    expect(opcoesDoConstrutor?.maxRetries).toBe(2);
  });
});

describe("o turno que termina sem texto não sai mais calado", () => {
  it("estouro do teto de iterações é registrado e nomeado", async () => {
    // O toolRunner encerra com `break`, não com erro (ToolRunner.ts:85-90): a
    // última mensagem vem só com tool_use e o texto sai vazio.
    mensagensDoRunner = Array.from({ length: 8 }, () => ({
      content: [{ type: "tool_use", id: "t", name: "buscar_imoveis_disponiveis", input: {} }],
      stop_reason: "tool_use",
    }));
    const resposta = await rodar();

    expect(logs()).toMatch(/\[IA-SEM-TEXTO\]/);
    expect(logs()).toMatch(/TETO DE ITERAÇÕES ESTOURADO/);
    expect(auditar).toHaveBeenCalled();
    expect(auditar.mock.calls[0][0]).toBe("IA_CONTINGENCIA");
    expect(auditar.mock.calls[0][2]).toBe(CONVERSA.id);
    expect(String(auditar.mock.calls[0][3])).toMatch(/8\/8 iterações/);
    // O tenant vai junto: sem ele a linha fica órfã e não aparece em /auditoria.
    expect(auditar.mock.calls[0][4]).toBe(CONVERSA.imobiliariaId);
    // E o cliente continua recebendo a frase fixa, sem mudança de comportamento.
    expect(resposta).toContain("Maitê");
  });

  it("terminar sem texto ANTES do teto também registra, sem culpar o teto", async () => {
    mensagensDoRunner = [{ content: [], stop_reason: "end_turn" }];
    await rodar();
    expect(logs()).toMatch(/\[IA-SEM-TEXTO\]/);
    expect(logs()).not.toMatch(/TETO DE ITERAÇÕES ESTOURADO/);
    expect(auditar).toHaveBeenCalled();
  });
});

describe("texto cortado no meio chega ao cliente, mas fica registrado", () => {
  it("stop_reason max_tokens não descarta a resposta parcial", async () => {
    // Cortar seria pior que entregar: metade de uma frase ainda ajuda. O que
    // faltava era distinguir isso de um prompt ruim.
    mensagensDoRunner = [
      { content: [{ type: "text", text: "A casa no Gaivota I custa R$ 1.2" }], stop_reason: "max_tokens" },
    ];
    const resposta = await rodar();
    expect(resposta).toBe("A casa no Gaivota I custa R$ 1.2");
    expect(logs()).toMatch(/\[IA-TRUNCADA\]/);
    // Truncar não é contingência: a IA respondeu. Não polui a auditoria.
    expect(auditar).not.toHaveBeenCalled();
  });
});

describe("erro da API vira contingência auditada, com o status", () => {
  it("529 da Anthropic é registrado com o código HTTP", async () => {
    erroDoRunner = Object.assign(new Error("Overloaded"), { status: 529 });
    const resposta = await rodar();

    expect(logs()).toMatch(/\[IA-DEMO-FALLBACK\]/);
    expect(auditar).toHaveBeenCalled();
    expect(String(auditar.mock.calls[0][3])).toMatch(/HTTP 529/);
    // A frase fixa não muda: é decisão de produto, não efeito colateral.
    expect(resposta).toContain("Maitê");
  });

  it("erro sem status (banco, ferramenta) não vira 'HTTP undefined'", async () => {
    erroDoRunner = new Error("connection terminated unexpectedly");
    await rodar();
    expect(String(auditar.mock.calls[0][3])).toMatch(/erro interno/);
    expect(String(auditar.mock.calls[0][3])).not.toMatch(/HTTP/);
  });
});

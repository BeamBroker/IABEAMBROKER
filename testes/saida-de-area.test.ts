// A SAÍDA DE ÁREA, EXERCITADA — o turno inteiro, do assunto novo até a resposta
// escrita pela área certa.
//
// O caso está medido em produção, conversa 329 do tenant 3, 26/08 11:13 BRT:
//
//   cliente: "Estou procurando uma casa pra comprar até 200 mil na região sul"
//   Maitê:   "Deixa eu confirmar com a equipe qual é a melhor opção pra essa
//             busca. Um atendente vai entrar em contato em breve."
//
// A IA rodou de verdade (UsoIA: agente ADMINISTRACAO, haiku, mesmo segundo), o
// tenant tem o módulo COMERCIAL e a carteira tinha 43 imóveis à venda dentro dos
// 200 mil. O telefone de quem escreveu está cadastrado como Pessoa, e por isso a
// conversa nasceu em ADMINISTRACAO (lib/conversas.ts) e nunca passou pela
// recepção — a única que tinha `direcionar_atendimento`. Não havia porta.
//
// Este teste trava a porta aberta: com a ferramenta na mão da ADMINISTRAÇÃO, o
// turno reentra e quem responde ao cliente é o prompt de COMPRA_VENDA, com as
// ferramentas de compra.
//
// SEM BANCO, como `agente-contingencia.test.ts` e pelo mesmo motivo: o que se
// mede aqui é o encaminhamento do turno, não a query.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Msg = Record<string, unknown>;

const CONVERSA = {
  id: 329,
  imobiliariaId: 3,
  agente: "ADMINISTRACAO",
  memoria: null,
  memoriaMensagens: 0,
  // Quem é da carteira chega com os dois preenchidos, e é justamente esse
  // cadastro que prendia a conversa na administração para sempre.
  pessoaId: 7,
  perfil: "PROPRIETARIO",
  contatoNome: null,
  contatoTelefone: "5517997343144",
  iaPausada: false,
};

/** O agente gravado "no banco" — a ferramenta escreve aqui, como em produção. */
let agenteNoBanco = "ADMINISTRACAO";
/** O `system` de cada passada do turno, na ordem. */
let systems: string[] = [];
/** Os nomes das ferramentas oferecidas em cada passada. */
let ferramentas: string[][] = [];
/** O que a ferramenta respondeu ao modelo, quando ele a chamou. */
let recibos: string[] = [];
/** Qual área o modelo pede em cada passada (null = não chama ferramenta). */
let pedidos: Array<string | null> = [];

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = {
      messages: {
        toolRunner: (params: {
          system: string | Array<{ text?: string }>;
          tools: Array<{ name: string; run: (i: unknown, x: unknown) => Promise<string> }>;
        }) => {
          const passada = systems.length;
          // O `system` vai como array de blocos quando há cache_control: o que
          // importa aqui é o texto, venha ele de que forma vier.
          systems.push(
            typeof params.system === "string"
              ? params.system
              : params.system.map((b) => b.text ?? "").join("\n")
          );
          ferramentas.push(params.tools.map((t) => t.name));
          const pedido = pedidos[passada] ?? null;
          return {
            async *[Symbol.asyncIterator]() {
              if (pedido) {
                const tool = params.tools.find((t) => t.name === "direcionar_atendimento");
                if (!tool) throw new Error("esta área não tem saída");
                const antes = agenteNoBanco;
                recibos.push(await tool.run({ area: pedido }, {}));
                yield { content: [{ type: "tool_use", id: "t", name: "direcionar_atendimento", input: {} }], stop_reason: "tool_use" } as Msg;
                // Encaminhou de verdade: o modelo obedece ao recibo ("não
                // escreva nada") e a passada termina sem texto. RECUSADO: o
                // runner segue iterando e ele responde o cliente ali mesmo, que
                // é o que o recibo da recusa manda fazer.
                if (agenteNoBanco === antes)
                  yield {
                    content: [{ type: "text", text: `resposta de ${agenteNoBanco}` }],
                    stop_reason: "end_turn",
                  } as Msg;
                return;
              }
              yield {
                content: [{ type: "text", text: `resposta de ${agenteNoBanco}` }],
                stop_reason: "end_turn",
              } as Msg;
            },
          };
        },
      },
    };
  },
}));

vi.mock("@/lib/credenciais-ia", () => ({
  credenciaisAnthropic: async () => ({ apiKey: "sk-ant-de-teste", origem: "plataforma" }),
}));
vi.mock("@/lib/uso-ia", () => ({ podeConsumirIA: async () => true, registrarUso: async () => {} }));
vi.mock("@/lib/auditoria", () => ({ auditar: async () => {} }));

// O contexto da carteira (fatura, repasse, contrato) é montado de verdade a
// partir do Prisma, e aqui o Prisma é oco. Ele não muda o encaminhamento: o que
// se mede é para onde o turno vai, não o que a administração leria da carteira.
vi.mock("@/lib/atendimento", () => ({
  montarContexto: async () => "Contexto do cliente da carteira (mock).",
  resolverInterlocutor: async () => null,
  respostaLocal: () => "resposta local",
}));

const VAZIO: Record<string, unknown> = {
  conversa: {
    // Devolve o estado ATUAL: é assim que `umaPassadaDoAgente` descobre que a
    // área mudou no meio do turno e reentra com o prompt certo.
    findUnique: async () => ({ ...CONVERSA, agente: agenteNoBanco }),
    findFirst: async () => null,
    update: async ({ data }: { data: { agente?: string } }) => {
      if (data.agente) agenteNoBanco = data.agente;
      return {};
    },
  },
  imobiliaria: {
    findUnique: async () => ({
      id: 3,
      nome: "WSP Prime",
      modulos: ["ADM", "COMERCIAL"],
      addons: ["CAPTACAO"],
      municipio: "São José do Rio Preto",
      uf: "SP",
      taxaAdmPercent: 10,
      seguroFiancaPercent: 11,
      modeloRemuneracao: "TAXA",
      iasConfig: null,
      telefonesCorretores: null,
    }),
  },
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
  agenteNoBanco = "ADMINISTRACAO";
  systems = [];
  ferramentas = [];
  recibos = [];
  pedidos = [];
});

const rodar = () =>
  executarAgente({
    conversa: { ...CONVERSA } as never,
    historico: [],
    mensagem: "Estou procurando uma casa pra comprar até 200 mil na região sul",
  });

describe("o cliente da carteira que quer COMPRAR não fica preso na administração", () => {
  it("a administração encaminha e quem responde é COMPRA_VENDA", async () => {
    pedidos = ["COMPRA_VENDA", null];
    const resposta = await rodar();

    // 1) A área mudou no banco.
    expect(agenteNoBanco).toBe("COMPRA_VENDA");
    // 2) O turno reentrou: duas passadas, com prompts diferentes.
    expect(systems).toHaveLength(2);
    expect(systems[0]).toContain("Agora o assunto é ADMINISTRAÇÃO");
    expect(systems[1]).toContain("Agora o assunto é VENDA DE IMÓVEIS");
    // 3) Na volta ela tem as ferramentas de compra na mão — era isso que
    //    faltava para mostrar os 43 imóveis que existiam.
    expect(ferramentas[0]).toContain("direcionar_atendimento");
    expect(ferramentas[0]).not.toContain("buscar_imoveis_venda");
    expect(ferramentas[1]).toContain("buscar_imoveis_venda");
    expect(ferramentas[1]).toContain("qualificar_comprador");
    // 4) Quem fala com o cliente é a área nova. O texto da primeira passada é
    //    descartado: saiu do prompt errado.
    expect(resposta).toBe("resposta de COMPRA_VENDA");
  });

  it("o recibo da ferramenta manda ficar calada, não se despedir", async () => {
    // A promessa de retorno é o defeito original: "um atendente vai entrar em
    // contato" cria uma expectativa com prazo que ninguém assumiu.
    pedidos = ["COMPRA_VENDA", null];
    await rodar();
    expect(recibos[0]).toMatch(/Encaminhado para COMPRA_VENDA/);
    expect(recibos[0]).toMatch(/Não escreva nada/);
  });

  it("encaminhar para a própria área é recusado, e o turno não se perde", async () => {
    // Sem a guarda, a IA se transferiria para si mesma: a reentrada seria gasta
    // e o cliente ficaria sem resposta nenhuma.
    pedidos = ["ADMINISTRACAO", null];
    const resposta = await rodar();

    expect(recibos[0]).toMatch(/Você JÁ está em ADMINISTRACAO/);
    expect(agenteNoBanco).toBe("ADMINISTRACAO");
    // Uma passada só: não houve troca, então não há motivo para reentrar.
    expect(systems).toHaveLength(1);
    expect(resposta).toBe("resposta de ADMINISTRACAO");
  });

  it("a locação também tem saída para a compra", async () => {
    // Mesmo beco, outra porta: quem chegou perguntando de aluguel e decidiu
    // comprar estava igualmente preso.
    agenteNoBanco = "VENDAS";
    pedidos = ["COMPRA_VENDA", null];
    const resposta = await executarAgente({
      conversa: { ...CONVERSA, agente: "VENDAS", pessoaId: null, perfil: null } as never,
      historico: [],
      mensagem: "na verdade eu quero comprar, não alugar",
    });

    expect(agenteNoBanco).toBe("COMPRA_VENDA");
    expect(systems[1]).toContain("Agora o assunto é VENDA DE IMÓVEIS");
    expect(resposta).toBe("resposta de COMPRA_VENDA");
  });
});

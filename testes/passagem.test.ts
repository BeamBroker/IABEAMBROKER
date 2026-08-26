// O carimbo da passagem: as regras que decidem se o relógio existe.
//
// Prisma MOCKADO, não banco de verdade — mesmo desenho de
// lib/aviso-lead-gatilho.test.ts, e pelo mesmo motivo: o que está sob prova
// aqui é a DECISÃO (abre? não abre? fecha a anterior?), não o SQL. Assim a
// prova roda em milissegundos e em qualquer máquina.
//
// O QUE ESTE ARQUIVO PRENDE, e por que cada um custou uma decisão:
//
//   · RODÍZIO DESLIGADO ainda abre relógio. É o bug que originou todo o
//     trabalho: `Lead.atribuidoEm` só era escrito quando o rodízio achava
//     alguém, e a casa sem rodízio ficava sem medida nenhuma.
//   · A ferramenta da IA é rechamada a cada resposta do cliente. Sem trava, o
//     vendedor zeraria o próprio atraso a cada mensagem que o cliente mandasse.
//   · Troca de dono NÃO apaga a linha anterior. A prova de que o vendedor de
//     antes não respondeu costuma ser o motivo da troca.
//   · Nada aqui sobe exceção: acima está a resposta que o cliente espera no
//     WhatsApp.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** O dono atual do lead, do jeito que `registrarPassagem` o lê. */
let corretorDoLead: number | null = null;
/** O relógio aberto que o banco devolve, ou null. */
let slaAberto: { id: number; corretorId: number | null } | null = null;
/** Faz a transação explodir, para provar o best-effort. */
let bancoJoga = false;
/** O que `prisma.lead.findMany` devolve no casamento por telefone. */
let leadsDaCasa: { id: number; telefone: string | null }[] = [];

/** Os argumentos de cada escrita, guardados para as asserções.
 *
 *  Guardar em vez de ler `mock.calls[0][0]`: com o argumento declarado, o que a
 *  asserção compara tem TIPO — e um `toMatchObject` contra `unknown` passa por
 *  vácuo no dia em que o nome de um campo mudar. */
type Args = Record<string, unknown>;
const criados: Args[] = [];
const encerrados: Args[] = [];
const carimbosNoLead: Args[] = [];

const slaCreate = vi.fn(async (args: Args) => {
  criados.push(args);
  return { id: 99 };
});
const slaUpdate = vi.fn(async (args: Args) => {
  encerrados.push(args);
  return {};
});
const leadUpdateMany = vi.fn(async (args: Args) => {
  carimbosNoLead.push(args);
  return { count: 1 };
});

const tx = {
  lead: {
    findUnique: vi.fn(async () => ({ corretorId: corretorDoLead })),
    updateMany: leadUpdateMany,
  },
  slaLead: {
    findFirst: vi.fn(async () => slaAberto),
    update: slaUpdate,
    create: slaCreate,
  },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
      if (bancoJoga) throw new Error("banco fora do ar");
      return fn(tx);
    }),
    lead: { findMany: vi.fn(async () => leadsDaCasa) },
  },
}));

const AGORA = new Date("2026-08-20T14:20:00-03:00");

beforeEach(() => {
  vi.clearAllMocks();
  corretorDoLead = null;
  slaAberto = null;
  bancoJoga = false;
  leadsDaCasa = [];
  criados.length = 0;
  encerrados.length = 0;
  carimbosNoLead.length = 0;
});

describe("registrarPassagem — o relógio começa em TODOS os caminhos", () => {
  it("rodízio desligado (lead sem dono) abre relógio mesmo assim", async () => {
    // ESTE É O TESTE DO BUG. Antes, o carimbo morava dentro de `distribuirLead`
    // e só acontecia quando o rodízio devolvia alguém — a casa sem rodízio
    // entregava o lead, avisava o corretor, e não media nada.
    const { registrarPassagem } = await import("@/lib/passagem");
    const id = await registrarPassagem({
      leadId: 10,
      imobiliariaId: 3,
      gatilho: "QUALIFICACAO",
      agora: AGORA,
    });

    expect(id).toBe(99);
    expect(slaCreate).toHaveBeenCalledTimes(1);
    expect(criados[0]).toMatchObject({
      data: { leadId: 10, imobiliariaId: 3, corretorId: null, gatilho: "QUALIFICACAO" },
    });
  });

  it("lê o dono do LEAD quando o chamador não o informa", async () => {
    // O retorno do rodízio ser `null` não quer dizer que o lead está sem dono:
    // ele pode já ter um, e `distribuirLead` nem roda quando a casa distribui
    // noutro momento. Passar o retorno cru abriria um "sem dono" por cima do
    // dono real.
    corretorDoLead = 4;
    const { registrarPassagem } = await import("@/lib/passagem");
    await registrarPassagem({ leadId: 10, imobiliariaId: 3, gatilho: "QUALIFICACAO" });
    expect(criados[0]).toMatchObject({ data: { corretorId: 4 } });
  });

  it("`corretorId: null` explícito continua sendo 'sem dono'", async () => {
    corretorDoLead = 4;
    const { registrarPassagem } = await import("@/lib/passagem");
    await registrarPassagem({
      leadId: 10,
      imobiliariaId: 3,
      gatilho: "CRM",
      corretorId: null,
    });
    expect(criados[0]).toMatchObject({ data: { corretorId: null } });
  });
});

describe("idempotência — a ferramenta da IA é rechamada a cada mensagem", () => {
  it("relógio aberto para o MESMO vendedor não vira um segundo relógio", async () => {
    corretorDoLead = 4;
    slaAberto = { id: 50, corretorId: 4 };
    const { registrarPassagem } = await import("@/lib/passagem");
    const id = await registrarPassagem({ leadId: 10, imobiliariaId: 3, gatilho: "QUALIFICACAO" });

    expect(id).toBeNull();
    expect(slaCreate).not.toHaveBeenCalled();
    // E, principalmente, não mexe no relógio que está correndo: reiniciá-lo
    // deixaria o vendedor zerar o próprio atraso a cada resposta do cliente.
    expect(slaUpdate).not.toHaveBeenCalled();
  });

  it("entregue SEM DONO duas vezes também é uma passagem só", async () => {
    slaAberto = { id: 50, corretorId: null };
    const { registrarPassagem } = await import("@/lib/passagem");
    expect(
      await registrarPassagem({ leadId: 10, imobiliariaId: 3, gatilho: "PEDIDO_VISITA" })
    ).toBeNull();
    expect(slaCreate).not.toHaveBeenCalled();
  });
});

describe("troca de dono — a linha do vendedor anterior fica", () => {
  it("encerra a anterior e abre uma nova, sem apagar nada", async () => {
    slaAberto = { id: 50, corretorId: 4 };
    const { registrarPassagem } = await import("@/lib/passagem");
    await registrarPassagem({
      leadId: 10,
      imobiliariaId: 3,
      gatilho: "MANUAL",
      corretorId: 7,
      agora: AGORA,
    });

    // A anterior é ENCERRADA, não apagada nem respondida: "ficou com ele até
    // 14:20 e ele não respondeu" é a informação que o gestor precisa.
    expect(slaUpdate).toHaveBeenCalledTimes(1);
    expect(encerrados[0]).toMatchObject({
      where: { id: 50 },
      data: { encerradoEm: AGORA },
    });
    expect(criados[0]).toMatchObject({ data: { corretorId: 7 } });
  });
});

describe("`Lead.atribuidoEm` para de mentir", () => {
  it("com dono, carimba o lead — mas só se ainda estiver nulo", async () => {
    // `updateMany` com a condição no WHERE, e não ler-e-escrever: `distribuirLead`
    // pode ter acabado de gravar, e sobrescrever moveria o carimbo para depois.
    corretorDoLead = 4;
    const { registrarPassagem } = await import("@/lib/passagem");
    await registrarPassagem({
      leadId: 10,
      imobiliariaId: 3,
      gatilho: "QUALIFICACAO",
      agora: AGORA,
    });
    expect(leadUpdateMany).toHaveBeenCalledTimes(1);
    expect(carimbosNoLead[0]).toMatchObject({
      where: { id: 10, atribuidoEm: null },
      data: { atribuidoEm: AGORA, atribuicaoOrigem: "RODIZIO" },
    });
  });

  it("SEM dono não carimba: `atribuidoEm` sem corretor afirmaria o que não houve", async () => {
    const { registrarPassagem } = await import("@/lib/passagem");
    await registrarPassagem({ leadId: 10, imobiliariaId: 3, gatilho: "QUALIFICACAO" });
    expect(leadUpdateMany).not.toHaveBeenCalled();
  });

  it("o vocabulário de `atribuicaoOrigem` continua sendo RODIZIO/MANUAL", async () => {
    // O gatilho fino (PEDIDO_VISITA, CRM, FIM_CADENCIA_IA) mora no SlaLead. Na
    // coluna antiga, dois vocabulários fariam a tela "por que esse lead caiu pra
    // mim?" falar dois idiomas.
    corretorDoLead = 4;
    const { registrarPassagem } = await import("@/lib/passagem");
    await registrarPassagem({ leadId: 10, imobiliariaId: 3, gatilho: "PEDIDO_VISITA" });
    expect(carimbosNoLead[0]).toMatchObject({
      data: { atribuicaoOrigem: "RODIZIO" },
    });
  });
});

describe("best-effort: o relógio nunca derruba a resposta ao cliente", () => {
  it("banco fora do ar devolve null em vez de lançar", async () => {
    bancoJoga = true;
    const { registrarPassagem } = await import("@/lib/passagem");
    await expect(
      registrarPassagem({ leadId: 10, imobiliariaId: 3, gatilho: "QUALIFICACAO" })
    ).resolves.toBeNull();
  });
});

describe("casamento por telefone (a ponte temporária do CRM)", () => {
  it("um lead com o mesmo sufixo: abre o relógio nele", async () => {
    leadsDaCasa = [
      { id: 1, telefone: "(17) 3333-1111" },
      { id: 2, telefone: "5517999998888" },
    ];
    const { registrarPassagemPorTelefone } = await import("@/lib/passagem");
    await registrarPassagemPorTelefone({
      imobiliariaId: 3,
      telefone: "17 99999-8888",
      gatilho: "CRM",
      corretorId: 7,
    });
    expect(criados[0]).toMatchObject({ data: { leadId: 2, gatilho: "CRM" } });
  });

  it("DOIS leads com o mesmo sufixo: não abre nada, em vez de chutar", async () => {
    // Abrir o relógio no lead errado faria o painel cobrar um vendedor pelo
    // atraso de outro — pior que não medir.
    leadsDaCasa = [
      { id: 1, telefone: "5517999998888" },
      { id: 2, telefone: "17999998888" },
    ];
    const { registrarPassagemPorTelefone } = await import("@/lib/passagem");
    const id = await registrarPassagemPorTelefone({
      imobiliariaId: 3,
      telefone: "17 99999-8888",
      gatilho: "CRM",
    });
    expect(id).toBeNull();
    expect(slaCreate).not.toHaveBeenCalled();
  });

  it("telefone curto demais não casa com ninguém", async () => {
    leadsDaCasa = [{ id: 1, telefone: "5517999998888" }];
    const { registrarPassagemPorTelefone } = await import("@/lib/passagem");
    expect(
      await registrarPassagemPorTelefone({ imobiliariaId: 3, telefone: "1234", gatilho: "CRM" })
    ).toBeNull();
  });
});

// O fechamento do relógio: a regra que decide se o vendedor "respondeu".
//
// Prisma MOCKADO (mesmo desenho de lib/passagem.test.ts): o que está sob prova
// é a decisão e a conta, não o SQL.
//
// A REGRA QUE MAIS IMPORTA AQUI: só `ATENDENTE` fecha. Se a IA fechasse, o
// follow-up automático de 1 hora daria 100% de SLA para a casa inteira, e o
// painel passaria a medir a pontualidade de um cron em vez do trabalho de
// alguém.
import { beforeEach, describe, expect, it, vi } from "vitest";

type LinhaSla = {
  id: number;
  leadId: number;
  imobiliariaId: number;
  passouEm: Date;
  encerradoEm: Date | null;
  lead: { telefone: string | null };
};

let abertos: LinhaSla[] = [];
let conversas: {
  id: number;
  imobiliariaId: number;
  contatoTelefone: string | null;
  leadId: number | null;
}[] = [];
/** A resposta humana que o banco encontra, ou null. */
let respostaHumana: { criadaEm: Date } | null = null;

/** Os argumentos de cada escrita/consulta, guardados para as asserções: com o
 *  argumento declarado, o que a asserção compara tem TIPO — e um `toMatchObject`
 *  contra `unknown` passa por vácuo no dia em que um campo mudar de nome. */
type Args = Record<string, unknown>;
const fechamentos: Args[] = [];
const buscasDeMensagem: { where: { conversaId: { in: number[] }; [k: string]: unknown } }[] = [];

const slaUpdateMany = vi.fn(async (args: Args) => {
  fechamentos.push(args);
  return { count: 1 };
});
const mensagemFindFirst = vi.fn(
  async (args: { where: { conversaId: { in: number[] }; [k: string]: unknown } }) => {
    buscasDeMensagem.push(args);
    return respostaHumana;
  }
);

vi.mock("@/lib/db", () => ({
  prisma: {
    slaLead: { findMany: vi.fn(async () => abertos), updateMany: slaUpdateMany },
    conversa: { findMany: vi.fn(async () => conversas) },
    mensagem: { findFirst: mensagemFindFirst },
  },
}));

const PASSOU = new Date("2026-08-20T14:20:00-03:00");
const t = (hhmm: string) => new Date(`2026-08-20T${hhmm}:00-03:00`);

const linha = (over: Partial<LinhaSla> = {}): LinhaSla => ({
  id: 50,
  leadId: 10,
  imobiliariaId: 3,
  passouEm: PASSOU,
  encerradoEm: null,
  lead: { telefone: "5517999998888" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  abertos = [];
  conversas = [];
  respostaHumana = null;
  fechamentos.length = 0;
  buscasDeMensagem.length = 0;
});

describe("fecharSlaPorTelefone — o corretor digitou do celular", () => {
  it("fecha o relógio e grava os segundos calculados no ato", async () => {
    abertos = [linha()];
    const { fecharSlaPorTelefone } = await import("@/lib/sla-fechamento");
    const ok = await fecharSlaPorTelefone({
      imobiliariaId: 3,
      telefone: "17 99999-8888",
      quando: t("14:26"),
    });

    expect(ok).toBe(true);
    expect(fechamentos[0]).toMatchObject({
      // A trava condicional: duas passadas simultâneas (webhook + cron) não
      // podem reescrever um carimbo já gravado com uma resposta mais tardia.
      where: { id: 50, respondidoEm: null },
      data: { respondidoEm: t("14:26"), segundosResposta: 360 },
    });
  });

  it("casa por SUFIXO, não por igualdade de string", async () => {
    // "5517999998888" no banco e "17 99999-8888" no webhook são a mesma pessoa.
    abertos = [linha({ lead: { telefone: "(17) 99999-8888" } })];
    const { fecharSlaPorTelefone } = await import("@/lib/sla-fechamento");
    expect(
      await fecharSlaPorTelefone({
        imobiliariaId: 3,
        telefone: "5517999998888",
        quando: t("14:26"),
      })
    ).toBe(true);
  });

  it("mensagem ANTERIOR à passagem não fecha nada", async () => {
    // Evento fora de ordem: zerar aqui fabricaria um atendimento instantâneo.
    abertos = [linha()];
    const { fecharSlaPorTelefone } = await import("@/lib/sla-fechamento");
    expect(
      await fecharSlaPorTelefone({
        imobiliariaId: 3,
        telefone: "5517999998888",
        quando: t("14:10"),
      })
    ).toBe(false);
    expect(slaUpdateMany).not.toHaveBeenCalled();
  });

  it("a resposta do vendedor NOVO não fecha o relógio do ANTERIOR", async () => {
    // A linha antiga foi encerrada às 14:25 (o lead mudou de mão). Uma mensagem
    // às 15:00 é do dono novo; creditá-la ao anterior apagaria a prova de que
    // ele não respondeu — que costuma ser o motivo da troca.
    abertos = [
      linha({ id: 51, passouEm: t("14:25") }),
      linha({ id: 50, passouEm: PASSOU, encerradoEm: t("14:25") }),
    ];
    const { fecharSlaPorTelefone } = await import("@/lib/sla-fechamento");
    await fecharSlaPorTelefone({
      imobiliariaId: 3,
      telefone: "5517999998888",
      quando: t("15:00"),
    });
    expect(fechamentos[0]).toMatchObject({ where: { id: 51 } });
  });

  it("telefone sem 8 dígitos não fecha nada", async () => {
    abertos = [linha()];
    const { fecharSlaPorTelefone } = await import("@/lib/sla-fechamento");
    expect(
      await fecharSlaPorTelefone({ imobiliariaId: 3, telefone: "999", quando: t("14:26") })
    ).toBe(false);
  });
});

describe("fecharSlasPendentes — a rede de segurança do cron", () => {
  it("procura APENAS mensagem de ATENDENTE, posterior à passagem", async () => {
    abertos = [linha()];
    conversas = [{ id: 900, imobiliariaId: 3, contatoTelefone: "17999998888", leadId: null }];
    respostaHumana = { criadaEm: t("14:35") };

    const { fecharSlasPendentes } = await import("@/lib/sla-fechamento");
    const r = await fecharSlasPendentes();

    expect(buscasDeMensagem[0]).toMatchObject({
      where: {
        conversaId: { in: [900] },
        // A IA respondendo NÃO fecha o relógio do corretor.
        autor: "ATENDENTE",
        criadaEm: { gt: PASSOU },
      },
    });
    expect(r).toEqual({ abertos: 1, fechados: 1 });
    expect(fechamentos[0]).toMatchObject({
      data: { respondidoEm: t("14:35"), segundosResposta: 900 },
    });
  });

  it("usa `Conversa.leadId` quando ele existe, e o sufixo quando não", async () => {
    // A ponte correta é a FK; enquanto ela está vazia em produção, o sufixo
    // segura. Os dois convivem — nenhum é excludente.
    abertos = [linha()];
    conversas = [
      { id: 900, imobiliariaId: 3, contatoTelefone: null, leadId: 10 },
      { id: 901, imobiliariaId: 3, contatoTelefone: "17999998888", leadId: null },
      { id: 902, imobiliariaId: 3, contatoTelefone: "1733331111", leadId: null },
    ];
    respostaHumana = { criadaEm: t("14:35") };

    const { fecharSlasPendentes } = await import("@/lib/sla-fechamento");
    await fecharSlasPendentes();

    const alvo = buscasDeMensagem[0].where.conversaId.in;
    expect(alvo.sort()).toEqual([900, 901]);
  });

  it("passagem já encerrada só aceita resposta ANTERIOR ao encerramento", async () => {
    abertos = [linha({ encerradoEm: t("14:25") })];
    conversas = [{ id: 900, imobiliariaId: 3, contatoTelefone: "17999998888", leadId: null }];
    respostaHumana = { criadaEm: t("14:22") };

    const { fecharSlasPendentes } = await import("@/lib/sla-fechamento");
    await fecharSlasPendentes();

    expect(buscasDeMensagem[0]).toMatchObject({
      where: { criadaEm: { gt: PASSOU, lte: t("14:25") } },
    });
  });

  it("sem resposta humana não fecha, e não inventa carimbo", async () => {
    abertos = [linha()];
    conversas = [{ id: 900, imobiliariaId: 3, contatoTelefone: "17999998888", leadId: null }];
    respostaHumana = null;

    const { fecharSlasPendentes } = await import("@/lib/sla-fechamento");
    expect(await fecharSlasPendentes()).toEqual({ abertos: 1, fechados: 0 });
    expect(slaUpdateMany).not.toHaveBeenCalled();
  });

  it("lead sem conversa nenhuma é pulado sem consultar Mensagem", async () => {
    // A tabela de mensagens é a mais quente do sistema: uma consulta por
    // passagem que não tem para onde olhar é custo puro.
    abertos = [linha()];
    conversas = [];
    const { fecharSlasPendentes } = await import("@/lib/sla-fechamento");
    await fecharSlasPendentes();
    expect(mensagemFindFirst).not.toHaveBeenCalled();
  });

  it("nada aberto encerra cedo, sem tocar em Conversa nem em Mensagem", async () => {
    abertos = [];
    const { fecharSlasPendentes } = await import("@/lib/sla-fechamento");
    expect(await fecharSlasPendentes()).toEqual({ abertos: 0, fechados: 0 });
    expect(mensagemFindFirst).not.toHaveBeenCalled();
  });
});

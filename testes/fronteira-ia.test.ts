// A fronteira: a IA para de falar com o cliente depois do handoff.
//
// Prisma mockado, como em lib/aviso-lead.test.ts. O que se prova aqui é a
// DECISÃO — quais conversas são caladas, por qual ligação foram achadas, e que
// a rechamada da ferramenta da IA não vira auditoria repetida.
import { beforeEach, describe, expect, it, vi } from "vitest";

const auditar = vi.fn(async () => {});
vi.mock("@/lib/auditoria", () => ({ auditar: (...a: unknown[]) => auditar(...(a as [])) }));

type Linha = Record<string, unknown>;

let leadNoBanco: Linha | null = null;
let conversasNoBanco: Linha[] = [];
let leadsEntregues: Linha[] = [];
/** Quantas linhas o updateMany acerta. 0 = a conversa já estava pausada. */
let jaEstavaPausada = false;
const updateManysDeConversa: Linha[] = [];

vi.mock("@/lib/db", () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(async () => leadNoBanco),
      findMany: vi.fn(async () => leadsEntregues),
    },
    conversa: {
      findMany: vi.fn(async (args: Linha) => {
        const where = args.where as Linha;
        // Ramo da FK: só devolve o que tem leadId batendo.
        if ("leadId" in where) return conversasNoBanco.filter((c) => c.leadId === where.leadId);
        return conversasNoBanco;
      }),
      updateMany: vi.fn(async (args: Linha) => {
        updateManysDeConversa.push(args);
        const ids = ((args.where as Linha).id as Linha).in as number[];
        return { count: jaEstavaPausada ? 0 : ids.length };
      }),
    },
  },
}));

const LEAD = {
  id: 10,
  nome: "Carlos Alberto",
  telefone: "(17) 99999-8888",
  imobiliariaId: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  leadNoBanco = { ...LEAD };
  conversasNoBanco = [];
  leadsEntregues = [];
  jaEstavaPausada = false;
  updateManysDeConversa.length = 0;
});

describe("o handoff cala a IA", () => {
  it("acha a conversa pela FK e grava iaPausada", async () => {
    conversasNoBanco = [{ id: 500, leadId: 10, contatoTelefone: "17999998888" }];
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");

    expect(await pausarIaNaEntregaAoCorretor(10, 3)).toBe(1);
    expect((updateManysDeConversa[0]!.data as Linha).iaPausada).toBe(true);
    expect(auditar).toHaveBeenCalledTimes(1);
  });

  it("sem Conversa.leadId, casa pelo TELEFONE", async () => {
    // `Conversa.leadId` está vazio em produção. Sem este ramo, o handoff não
    // acharia conversa nenhuma e a fronteira existiria só no papel.
    conversasNoBanco = [{ id: 500, leadId: null, contatoTelefone: "5517999998888" }];
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");
    expect(await pausarIaNaEntregaAoCorretor(10, 3)).toBe(1);
  });

  it("não cala a conversa de outra pessoa que só parece com essa", async () => {
    conversasNoBanco = [{ id: 500, leadId: null, contatoTelefone: "17911112222" }];
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");
    expect(await pausarIaNaEntregaAoCorretor(10, 3)).toBe(0);
    expect(updateManysDeConversa).toHaveLength(0);
  });

  it("rechamada da ferramenta da IA não gera auditoria em duplicata", async () => {
    // A ferramenta é rechamada a cada resposta do cliente que ainda fala de
    // visita. Sem o `iaPausada: false` no WHERE, cada uma escreveria uma linha
    // nova dizendo que o handoff aconteceu de novo.
    conversasNoBanco = [{ id: 500, leadId: 10, contatoTelefone: "17999998888" }];
    jaEstavaPausada = true;
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");

    expect(await pausarIaNaEntregaAoCorretor(10, 3)).toBe(0);
    expect((updateManysDeConversa[0]!.where as Linha).iaPausada).toBe(false);
    expect(auditar).not.toHaveBeenCalled();
  });

  it("lead de OUTRO tenant não é tocado", async () => {
    // O id chega de dentro de uma ferramenta da IA; conferir o tenant aqui é a
    // diferença entre pausar a conversa certa e a de outra imobiliária.
    leadNoBanco = { ...LEAD, imobiliariaId: 9 };
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");
    expect(await pausarIaNaEntregaAoCorretor(10, 3)).toBe(0);
  });

  it("lead sem conversa nenhuma não é erro — é cadastro manual", async () => {
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");
    expect(await pausarIaNaEntregaAoCorretor(10, 3)).toBe(0);
    expect(auditar).not.toHaveBeenCalled();
  });

  it("NUNCA joga: acima está a resposta que o cliente espera no WhatsApp", async () => {
    leadNoBanco = null;
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");
    await expect(pausarIaNaEntregaAoCorretor(999, 3)).resolves.toBe(0);
  });
});

describe("o resgate automático não desfaz a fronteira", () => {
  it("reconhece a conversa de lead entregue pela FK e pelo telefone", async () => {
    // Sem isto, `reativarConversasEsquecidas` religaria a IA 24h depois e a
    // decisão da reunião duraria exatamente um dia — sem erro, sem log, e só
    // aparecendo para o cliente.
    leadsEntregues = [{ id: 10, imobiliariaId: 3, telefone: "17999998888" }];
    const { conversasDeLeadEntregue } = await import("@/lib/fronteira-ia");

    const achadas = await conversasDeLeadEntregue([
      { id: 500, leadId: 10, imobiliariaId: 3, contatoTelefone: null },
      { id: 501, leadId: null, imobiliariaId: 3, contatoTelefone: "(17) 99999-8888" },
      { id: 502, leadId: null, imobiliariaId: 3, contatoTelefone: "17911112222" },
    ]);

    expect(achadas.has(500)).toBe(true);
    expect(achadas.has(501)).toBe(true);
    // Conversa que não é de lead entregue continua elegível ao resgate.
    expect(achadas.has(502)).toBe(false);
  });

  it("não confunde tenants que compartilham o mesmo sufixo de telefone", async () => {
    leadsEntregues = [{ id: 10, imobiliariaId: 3, telefone: "17999998888" }];
    const { conversasDeLeadEntregue } = await import("@/lib/fronteira-ia");
    const achadas = await conversasDeLeadEntregue([
      { id: 700, leadId: null, imobiliariaId: 9, contatoTelefone: "17999998888" },
    ]);
    expect(achadas.size).toBe(0);
  });

  it("sem lead entregue nenhum, o resgate segue como sempre foi", async () => {
    const { conversasDeLeadEntregue } = await import("@/lib/fronteira-ia");
    const achadas = await conversasDeLeadEntregue([
      { id: 500, leadId: 10, imobiliariaId: 3, contatoTelefone: "17999998888" },
    ]);
    expect(achadas.size).toBe(0);
  });
});

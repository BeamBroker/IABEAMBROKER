// A cobrança que sai para o WhatsApp do corretor.
//
// Prisma e WhatsApp MOCKADOS, no mesmo desenho de lib/aviso-lead.test.ts: nenhum
// número real pode receber mensagem porque alguém rodou a suíte, e a regra que
// se quer provar aqui é a de decisão — quem é cobrado, quantas vezes, por qual
// número e quando o gestor entra —, não a de SQL.
//
// A regra de TEMPO tem teste próprio e sem mock nenhum, em
// lib/cadencia-vendedor.test.ts. Aqui só entram os casos que dependem do
// encanamento: agrupamento, escada de destino, falha de envio e a trava do
// escalonamento.
import { beforeEach, describe, expect, it, vi } from "vitest";

const enviarWhatsApp = vi.fn(async () => ({ enviado: true, provedor: "uazapi" }));
vi.mock("@/lib/whatsapp", () => ({
  enviarWhatsApp: (...a: unknown[]) => enviarWhatsApp(...(a as [])),
}));
vi.mock("@/lib/instancias", () => ({ idDaCasa: vi.fn(async () => 7) }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn(async () => {}) }));

type Linha = Record<string, unknown>;

let casasNoBanco: Linha[] = [];
let leadsNoBanco: Linha[] = [];
let conversasNoBanco: Linha[] = [];
let mensagensNoBanco: Linha[] = [];
/** Quantas linhas o `updateMany` do escalonamento acerta — 0 simula a corrida
 *  perdida entre as duas passadas simultâneas do cron. */
let travaEscalonamento = 1;

const updatesDeLead: Linha[] = [];
const updateManysDeLead: Linha[] = [];

vi.mock("@/lib/db", () => ({
  prisma: {
    imobiliaria: { findMany: vi.fn(async () => casasNoBanco) },
    lead: {
      findMany: vi.fn(async () => leadsNoBanco),
      update: vi.fn(async (args: Linha) => {
        updatesDeLead.push(args);
        return {};
      }),
      updateMany: vi.fn(async (args: Linha) => {
        updateManysDeLead.push(args);
        const where = args.where as Linha;
        // A reserva do escalonamento (`cobrancaEscalonadaEm: null`) obedece ao
        // cenário; qualquer outro updateMany acerta o que pediu.
        if ("cobrancaEscalonadaEm" in where && where.cobrancaEscalonadaEm === null)
          return { count: travaEscalonamento };
        const ids = (where.id as Linha | undefined)?.in as number[] | undefined;
        return { count: ids?.length ?? 1 };
      }),
    },
    conversa: { findMany: vi.fn(async () => conversasNoBanco) },
    mensagem: {
      findMany: vi.fn(async (args: Linha) => {
        const where = args.where as Linha;
        return mensagensNoBanco.filter((m) => !where.autor || m.autor === where.autor);
      }),
    },
  },
}));

// ── O cenário ───────────────────────────────────────────────────────────────

const sp = (dia: number, hora: number, min = 0) =>
  new Date(Date.UTC(2026, 7, dia, hora + 3, min, 0));

const AGORA = sp(3, 14, 36); // segunda, 14:36 — dentro do expediente
const PASSOU = sp(3, 14, 20); // 16 min antes: o 1º toque (15 min) venceu

const CASA = { id: 3, avisoLeadTelefone: "17977776666", gestorTelefone: "17966665555" };

const CORRETOR = {
  id: 42,
  nome: "Gabriel Souza",
  telefone: "17988887777",
  instanciaWhatsApp: { numero: "17955554444" },
};

const LEAD = {
  id: 10,
  nome: "Carlos Alberto",
  telefone: "17999998888",
  finalidade: "COMPRA",
  corretorId: CORRETOR.id,
  atribuidoEm: PASSOU,
  cobrancaBaseEm: PASSOU, // ciclo já sincronizado
  cobrancaToques: 0,
  cobrancaDispensadaEm: null,
  cobrancaEscalonadaEm: null,
  imovel: { codigo: "AP-0002", tipo: "Apartamento", bairro: "Centro", cidade: "Rio Preto" },
  empreendimento: null,
  corretor: CORRETOR,
};

const rodar = async () => {
  const { cobrarFollowsPendentes } = await import("@/lib/cobranca-vendedor");
  return cobrarFollowsPendentes({ agora: AGORA });
};

const textoEnviado = (i = 0) => (enviarWhatsApp.mock.calls[i] as unknown as [string, string])[1];
const destinoEnviado = (i = 0) => (enviarWhatsApp.mock.calls[i] as unknown as [string])[0];

beforeEach(() => {
  vi.clearAllMocks();
  enviarWhatsApp.mockResolvedValue({ enviado: true, provedor: "uazapi" });
  casasNoBanco = [{ ...CASA }];
  leadsNoBanco = [{ ...LEAD }];
  conversasNoBanco = [];
  mensagensNoBanco = [];
  travaEscalonamento = 1;
  updatesDeLead.length = 0;
  updateManysDeLead.length = 0;
});

// ── O desligado ─────────────────────────────────────────────────────────────

describe("o estado do dia 1", () => {
  it("nenhuma casa com o recurso ligado → não consulta lead e não envia nada", async () => {
    // `cobrancaVendedorAtiva` nasce false em todo tenant. Este é o caminho
    // NORMAL, e ele tem que ser barato e mudo.
    casasNoBanco = [];
    const r = await rodar();
    expect(r.casas).toBe(0);
    expect(r.mensagensEnviadas).toBe(0);
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });
});

// ── O envio ─────────────────────────────────────────────────────────────────

describe("a cobrança do corretor", () => {
  it("manda UMA mensagem, para o telefone cadastrado da pessoa, pelo número da casa", async () => {
    const r = await rodar();

    expect(r.mensagensEnviadas).toBe(1);
    expect(enviarWhatsApp).toHaveBeenCalledTimes(1);
    expect(destinoEnviado()).toBe(CORRETOR.telefone);
    // Sai pelo número DA CASA (idDaCasa mockado como 7), nunca pela instância do
    // próprio corretor: aviso-lead.ts:269-271 já registra que corretor recebendo
    // do próprio número é conversa consigo mesmo.
    const origem = (enviarWhatsApp.mock.calls[0] as unknown as [string, string, Linha])[2];
    expect(origem).toEqual({ instanciaId: 7 });

    const t = textoEnviado();
    expect(t).toContain("Carlos Alberto");
    expect(t).toContain("Toque 1 de 3");
    expect(t).toContain("Compra · Apartamento no Centro (AP-0002)");
    expect(t).toContain("https://wa.me/5517999998888");
  });

  it("dois leads do MESMO corretor viram uma mensagem só", async () => {
    // A defesa contra a rajada: dez notificações seguidas do mesmo chip é o
    // padrão que o WhatsApp pune com provider_code 463.
    leadsNoBanco = [{ ...LEAD }, { ...LEAD, id: 11, nome: "Ana Paula", telefone: "17911112222" }];
    const r = await rodar();

    expect(enviarWhatsApp).toHaveBeenCalledTimes(1);
    expect(r.toquesRegistrados).toBe(2);
    const t = textoEnviado();
    expect(t).toContain("2 clientes esperando você");
    expect(t).toContain("Carlos Alberto");
    expect(t).toContain("Ana Paula");
  });

  it("corretores diferentes recebem mensagens diferentes", async () => {
    leadsNoBanco = [
      { ...LEAD },
      {
        ...LEAD,
        id: 11,
        corretorId: 43,
        corretor: { ...CORRETOR, id: 43, nome: "Marina", telefone: "17933332222" },
      },
    ];
    await rodar();
    expect(enviarWhatsApp).toHaveBeenCalledTimes(2);
    expect([destinoEnviado(0), destinoEnviado(1)].sort()).toEqual(
      [CORRETOR.telefone, "17933332222"].sort()
    );
  });

  it("registra o toque só de quem entrou na mensagem", async () => {
    await rodar();
    const avanco = updateManysDeLead.find(
      (u) => (u.data as Linha).cobrancaToques !== undefined
    );
    expect((avanco!.where as Linha).id).toEqual({ in: [10] });
    expect((avanco!.data as Linha).cobrancaToques).toEqual({ increment: 1 });
  });
});

// ── A escada de destinos ────────────────────────────────────────────────────

describe("para onde vai o lembrete quando o cadastro está pela metade", () => {
  it("sem Usuario.telefone, cai no número que o corretor conectou", async () => {
    leadsNoBanco = [{ ...LEAD, corretor: { ...CORRETOR, telefone: null } }];
    await rodar();
    expect(destinoEnviado()).toBe(CORRETOR.instanciaWhatsApp.numero);
  });

  it("sem nada do corretor, cai no plantão da casa", async () => {
    leadsNoBanco = [
      { ...LEAD, corretor: { ...CORRETOR, telefone: null, instanciaWhatsApp: null } },
    ];
    await rodar();
    expect(destinoEnviado()).toBe(CASA.avisoLeadTelefone);
  });

  it("lead SEM dono (casa sem rodízio) também é cobrado — no plantão", async () => {
    // É justamente a casa sem rodízio que mais precisa: nela ninguém vira dono
    // e o lead não aparece na carteira de pessoa alguma.
    leadsNoBanco = [{ ...LEAD, corretorId: null, corretor: null }];
    const r = await rodar();
    expect(r.mensagensEnviadas).toBe(1);
    expect(destinoEnviado()).toBe(CASA.avisoLeadTelefone);
  });

  it("sem NENHUM número, não envia, não avança o toque, e conta o buraco", async () => {
    // O estado de hoje na maioria das contas. Tem que ser silencioso para o
    // cliente e barulhento para quem opera — daí `semDestino` no resultado.
    casasNoBanco = [{ ...CASA, avisoLeadTelefone: null }];
    leadsNoBanco = [
      { ...LEAD, corretor: { ...CORRETOR, telefone: null, instanciaWhatsApp: null } },
    ];
    const r = await rodar();
    expect(enviarWhatsApp).not.toHaveBeenCalled();
    expect(r.semDestino).toBe(1);
    expect(r.toquesRegistrados).toBe(0);
    expect(updateManysDeLead.some((u) => (u.data as Linha).cobrancaToques)).toBe(false);
  });
});

// ── A falha de envio ────────────────────────────────────────────────────────

describe("envio que falha", () => {
  it("NÃO avança o toque — só reagenda", async () => {
    // Contar como enviado o que não saiu queima um dos três toques do corretor
    // sem ele ter recebido nada, e o gestor é avisado de uma cadência que nunca
    // aconteceu.
    enviarWhatsApp.mockResolvedValue({ enviado: false, provedor: "uazapi" });
    const r = await rodar();

    expect(r.toquesRegistrados).toBe(0);
    expect(updateManysDeLead.some((u) => (u.data as Linha).cobrancaToques)).toBe(false);
    const reagendou = updateManysDeLead.find(
      (u) => (u.data as Linha).cobrancaProximaEm !== undefined
    );
    expect(reagendou).toBeTruthy();
    expect((reagendou!.data as Linha).cobrancaProximaEm).toBeInstanceOf(Date);
  });

  it("exceção no envio não sobe e não derruba a rotina", async () => {
    enviarWhatsApp.mockRejectedValue(new Error("uazapi fora do ar"));
    const r = await rodar();
    expect(r.toquesRegistrados).toBe(0);
    expect(r.casas).toBe(1); // rodou até o fim
  });
});

// ── O ciclo ─────────────────────────────────────────────────────────────────

describe("reatribuição abre um ciclo novo", () => {
  it("atribuidoEm diferente de cobrancaBaseEm zera os toques", async () => {
    // Sem isto, o corretor novo herdaria "toque 3 de 3" de quem tinha o lead
    // antes e seria escalado ao gestor sem ter recebido um lembrete sequer.
    leadsNoBanco = [{ ...LEAD, cobrancaBaseEm: sp(1, 10, 0), cobrancaToques: 3 }];
    await rodar();

    const reset = updatesDeLead.find((u) => (u.data as Linha).cobrancaBaseEm !== undefined);
    expect(reset).toBeTruthy();
    expect((reset!.data as Linha).cobrancaToques).toBe(0);
    expect((reset!.data as Linha).cobrancaEscalonadaEm).toBeNull();
    // E, zerado, ele recebe o TOQUE 1 — não o quarto.
    expect(textoEnviado()).toContain("Toque 1 de 3");
  });
});

// ── A varredura do WhatsApp ─────────────────────────────────────────────────

describe("quem já foi atendido sai da esteira", () => {
  const conversaDoLead = { id: 500, leadId: 10, contatoTelefone: "17999998888" };

  it("mensagem de ATENDENTE depois da passagem para a cobrança", async () => {
    conversasNoBanco = [conversaDoLead];
    mensagensNoBanco = [{ conversaId: 500, autor: "ATENDENTE", criadaEm: sp(3, 14, 30) }];
    const r = await rodar();
    expect(enviarWhatsApp).not.toHaveBeenCalled();
    expect(r.toquesRegistrados).toBe(0);
  });

  it("mensagem da IA NÃO para a cobrança", async () => {
    // A regra que decide o recurso inteiro: se a IA contasse, o follow-up
    // automático da própria Maitê fecharia o relógio do corretor uma hora depois
    // e todo mundo teria 100% de cumprimento.
    conversasNoBanco = [conversaDoLead];
    mensagensNoBanco = [{ conversaId: 500, autor: "IA", criadaEm: sp(3, 14, 30) }];
    const r = await rodar();
    expect(enviarWhatsApp).toHaveBeenCalledTimes(1);
    expect(r.toquesRegistrados).toBe(1);
  });

  it("mensagem de ATENDENTE ANTERIOR à passagem não vale", async () => {
    // Conversa antiga com o mesmo cliente não prova follow do lead de agora.
    conversasNoBanco = [conversaDoLead];
    mensagensNoBanco = [{ conversaId: 500, autor: "ATENDENTE", criadaEm: sp(3, 10, 0) }];
    await rodar();
    expect(enviarWhatsApp).toHaveBeenCalledTimes(1);
  });

  it("casa a conversa pelo TELEFONE quando Conversa.leadId está vazio", async () => {
    // `Conversa.leadId` está vazio em produção; sem o casamento por sufixo, a
    // varredura não acharia follow nenhum e cobraria todo mundo.
    conversasNoBanco = [{ id: 500, leadId: null, contatoTelefone: "(17) 99999-8888" }];
    mensagensNoBanco = [{ conversaId: 500, autor: "ATENDENTE", criadaEm: sp(3, 14, 30) }];
    await rodar();
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });
});

// ── O escalonamento ─────────────────────────────────────────────────────────

describe("o escalonamento ao gestor", () => {
  const ESGOTADO = {
    ...LEAD,
    cobrancaToques: 3,
    atribuidoEm: sp(1, 14, 20),
    cobrancaBaseEm: sp(1, 14, 20), // 48h antes de AGORA
  };

  it("depois dos 3 toques e do prazo, avisa o gestor UMA vez", async () => {
    leadsNoBanco = [{ ...ESGOTADO }];
    const r = await rodar();

    expect(r.escalonamentos).toBe(1);
    expect(destinoEnviado()).toBe(CASA.gestorTelefone);
    const t = textoEnviado();
    expect(t).toContain("Cadência não cumprida");
    expect(t).toContain("Gabriel Souza");
    expect(t).toContain("Carlos Alberto");
    // O gestor precisa saber o limite da medida antes de penalizar alguém.
    expect(t).toContain("Ligação não aparece");
  });

  it("a corrida entre duas passadas do cron não manda em duplicata", async () => {
    // A trava é `updateMany where cobrancaEscalonadaEm: null`, tomada ANTES do
    // envio — mesma reserva atômica de aviso-lead.ts:252-256.
    leadsNoBanco = [{ ...ESGOTADO }];
    travaEscalonamento = 0; // a outra passada chegou primeiro
    const r = await rodar();
    expect(r.escalonamentos).toBe(0);
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("sem gestorTelefone não escala, mas marca para não reprocessar para sempre", async () => {
    casasNoBanco = [{ ...CASA, gestorTelefone: null }];
    leadsNoBanco = [{ ...ESGOTADO }];
    const r = await rodar();

    expect(r.escalonamentos).toBe(0);
    expect(enviarWhatsApp).not.toHaveBeenCalled();
    expect(
      updateManysDeLead.some((u) => (u.data as Linha).cobrancaEscalonadaEm instanceof Date)
    ).toBe(true);
  });

  it("envio do escalonamento que falha DEVOLVE a trava", async () => {
    // Sem isto, a única tentativa que este escalonamento teria na vida seria a
    // que falhou. Mesmo desenho de aviso-lead.ts:282-284.
    leadsNoBanco = [{ ...ESGOTADO }];
    enviarWhatsApp.mockResolvedValue({ enviado: false, provedor: "uazapi" });
    const r = await rodar();

    expect(r.escalonamentos).toBe(0);
    const devolveu = updateManysDeLead.filter(
      (u) => (u.data as Linha).cobrancaEscalonadaEm === null
    );
    expect(devolveu).toHaveLength(1);
  });

  it("não escala quem ainda tem toque a receber", async () => {
    leadsNoBanco = [{ ...ESGOTADO, cobrancaToques: 2 }];
    const r = await rodar();
    expect(r.escalonamentos).toBe(0);
  });
});

// ── A palavra do corretor ───────────────────────────────────────────────────

describe("o corretor que ligou responde OK", () => {
  // Um toque já saiu e o SEGUNDO venceu: o degrau 2 é 4h, então a passagem
  // precisa ser mais antiga que a de LEAD (16 min). Sem isso o cenário provaria
  // apenas que nada vencia ainda.
  const COBRADO_UMA_VEZ = {
    ...LEAD,
    cobrancaToques: 1,
    atribuidoEm: sp(3, 9, 36),
    cobrancaBaseEm: sp(3, 9, 36),
  };

  it("um 'já falei' no fio da cobrança tira o lead da esteira", async () => {
    leadsNoBanco = [{ ...COBRADO_UMA_VEZ }];
    // A conversa entre o número do CORRETOR e o da casa: a resposta dele chega
    // como CLIENTE ali.
    conversasNoBanco = [{ id: 900, leadId: null, contatoTelefone: CORRETOR.telefone }];
    mensagensNoBanco = [
      { conversaId: 900, autor: "CLIENTE", texto: "já falei com ele", criadaEm: sp(3, 14, 30) },
    ];
    const r = await rodar();

    expect(r.dispensados).toBe(1);
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("o uso normal do Ajuda Corretor NÃO desliga a cobrança", async () => {
    // O mesmo número conversa com a casa sobre estoque. Tratar qualquer
    // mensagem como confirmação faria a cobrança se desligar sozinha, e o
    // sintoma seria a AUSÊNCIA de mensagens — que ninguém percebe.
    leadsNoBanco = [{ ...COBRADO_UMA_VEZ }];
    conversasNoBanco = [{ id: 900, leadId: null, contatoTelefone: CORRETOR.telefone }];
    mensagensNoBanco = [
      {
        conversaId: 900,
        autor: "CLIENTE",
        texto: "quais imóveis temos em Dianópolis?",
        criadaEm: sp(3, 14, 30),
      },
    ];
    const r = await rodar();
    expect(r.dispensados).toBe(0);
    expect(enviarWhatsApp).toHaveBeenCalledTimes(1);
  });

  it("um OK ANTES do primeiro toque não vale", async () => {
    leadsNoBanco = [{ ...LEAD, cobrancaToques: 0 }];
    conversasNoBanco = [{ id: 900, leadId: null, contatoTelefone: CORRETOR.telefone }];
    mensagensNoBanco = [
      { conversaId: 900, autor: "CLIENTE", texto: "ok", criadaEm: sp(3, 14, 30) },
    ];
    const r = await rodar();
    expect(r.dispensados).toBe(0);
  });
});

// ── A promessa do cabeçalho ─────────────────────────────────────────────────

describe("nunca joga", () => {
  it("banco fora do ar devolve zeros em vez de derrubar o cron", async () => {
    // Esta rotina roda junto do monitor de instância e do follow-up do cliente
    // no cron de 15 min. Uma exceção aqui levaria os dois com ela.
    casasNoBanco = [{ ...CASA }];
    leadsNoBanco = [{ ...LEAD, atribuidoEm: null, cobrancaBaseEm: null }];
    const r = await rodar();
    expect(r.mensagensEnviadas).toBe(0);
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });
});

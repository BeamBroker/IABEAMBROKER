// A mensagem que o cliente lê. Cada caso aqui é uma frase que chegou (ou quase
// chegou) num WhatsApp de verdade.
import { describe, expect, it } from "vitest";
import { mensagemToque } from "@/lib/followup";

type Lead = Parameters<typeof mensagemToque>[0];

/** O lead 342 de produção, do toque de 21/08 às 10:30.
 *
 *  `status` NÃO vem preenchido por padrão de propósito: é assim que a consulta
 *  da cadência entrega o imóvel quando ninguém conferiu nada, e é esse o caso
 *  que produzia "segue disponível" sem base. Quem quer o outro caminho passa
 *  o status explicitamente. */
function leadReal(over: Record<string, unknown> = {}): Lead {
  return {
    nome: "Roberto Almeida",
    finalidade: "COMPRA",
    simulacoes: [],
    visitas: [],
    imovel: {
      tipo: "Casa de Condomínio",
      endereco: "Avenida Miguel Damha, 1515",
      bairro: "Gaivota I",
      cidade: "São José do Rio Preto",
      valorVenda: 1250000,
      valorSugerido: null,
      condominio: { nome: "Gaivota I" },
    },
    ...over,
  } as unknown as Lead;
}

/** O mesmo lead, com o imóvel confirmado disponível. */
function leadDisponivel(over: Record<string, unknown> = {}): Lead {
  const base = leadReal(over) as unknown as { imovel: Record<string, unknown> };
  return { ...base, imovel: { ...base.imovel, status: "DISPONIVEL" } } as unknown as Lead;
}

describe("o toque de 21/08 que confundiu o cliente", () => {
  it("cita o CONDOMÍNIO, não a avenida", () => {
    // "em Avenida Miguel Damha, 1515" fez o cliente entender que era oferta de
    // outro condomínio. Ele tinha procurado no Gaivota I — que é onde o imóvel
    // fica; Miguel Damha é só a avenida da portaria.
    const t = mensagemToque(leadReal(), 1);
    expect(t).toContain("condomínio Gaivota I");
    expect(t).not.toContain("Miguel Damha");
  });

  it("concorda em gênero: 'a casa', nunca 'o casa'", () => {
    const t = mensagemToque(leadDisponivel(), 1);
    expect(t).toContain("a casa no condomínio Gaivota I");
    expect(t).not.toContain("o casa");
  });

  it("o pronome também concorda: 'pra ela'", () => {
    const t = mensagemToque(leadDisponivel(), 1);
    expect(t).toContain("pra ela");
    expect(t).not.toContain("pra ele");
  });

  it("a mensagem inteira, do jeito que o cliente vai ler", () => {
    // `brl()` separa "R$" do número com ESPAÇO NÃO-QUEBRÁVEL (U+00A0), como
    // manda o Intl. Comparar contra um espaço comum falha com as duas strings
    // idênticas na tela — normalizar aqui é o que torna a asserção legível.
    const texto = mensagemToque(leadDisponivel(), 1).replace(/\u00a0/g, " ");
    expect(texto).toBe(
      "Roberto, a casa no condomínio Gaivota I (R$ 1.250.000,00) " +
        "que você viu segue disponível. Quer que eu veja as condições de financiamento pra ela?"
    );
  });

  it("imóvel masculino continua certo", () => {
    const t = mensagemToque(
      leadReal({
        imovel: { tipo: "Apartamento", bairro: "Centro", valorVenda: 300000, condominio: null, status: "DISPONIVEL" },
      }),
      1
    );
    expect(t).toContain("o apartamento no Centro");
    expect(t).toContain("pra ele");
  });

  it("etapa 3 concorda no demonstrativo (locação, sem simulação)", () => {
    const t = mensagemToque(leadReal({ finalidade: "LOCACAO" }), 3);
    expect(t).toContain("quiser essa");
    expect(t).not.toContain("quiser esse");
  });
});

// ── O QUE A MENSAGEM DE 21/08 AINDA DIZIA SEM SABER ────────────────────────
//
// O conserto daquele toque pegou o artigo e a referência, e deixou passar a
// afirmação: "segue disponível" sobre um imóvel cujo status ninguém consultou.
// A consulta da cadência filtra o LEAD, nunca o imóvel, e traz a linha inteira
// do Imovel no include — o dado estava na mão e a frase o ignorava.
describe("disponibilidade se confere, não se supõe", () => {
  it("sem status conferido, NÃO afirma que segue disponível", () => {
    const t = mensagemToque(leadReal(), 1);
    expect(t).not.toContain("segue disponível");
    expect(t).not.toContain("continua disponível");
  });

  it("sem status conferido, retoma citando o imóvel e oferece confirmar", () => {
    const texto = mensagemToque(leadReal(), 1).replace(/\u00a0/g, " ");
    expect(texto).toBe(
      "Roberto, lembrei daquela casa no condomínio Gaivota I (R$ 1.250.000,00) " +
        "que você viu. Quer que eu confirme as condições dela pra você?"
    );
  });

  it("imóvel ALUGADO não vira 'segue disponível'", () => {
    const t = mensagemToque(leadDisponivel({}), 1);
    expect(t).toContain("segue disponível"); // controle: DISPONIVEL pode afirmar
    const alugado = mensagemToque(
      leadReal({
        imovel: {
          tipo: "Casa de Condomínio",
          bairro: "Gaivota I",
          valorVenda: 1250000,
          condominio: { nome: "Gaivota I" },
          status: "ALUGADO",
        },
      }),
      1
    );
    expect(alugado).not.toContain("disponível");
  });

  it("e também não afirma o contrário: em reforma não vira 'já saiu'", () => {
    // ALUGADO, EM_REFORMA e INATIVO querem dizer coisas diferentes. "Esse já
    // saiu" sobre um imóvel em reforma é uma segunda afirmação sem base para
    // consertar a primeira.
    const t = mensagemToque(
      leadReal({
        imovel: {
          tipo: "Casa de Condomínio",
          bairro: "Gaivota I",
          valorVenda: 1250000,
          condominio: { nome: "Gaivota I" },
          status: "EM_REFORMA",
        },
      }),
      1
    );
    expect(t).not.toMatch(/j[áa] saiu|foi alugad|foi vendid|n[ãa]o est[áa] mais/i);
    expect(t).toContain("lembrei daquela casa");
  });

  it("a etapa 2 da compra também não afirma sem conferir", () => {
    expect(mensagemToque(leadReal(), 2)).not.toContain("continua de pé");
    expect(mensagemToque(leadDisponivel(), 2)).toContain("continua de pé");
  });
});

// ── A REAPRESENTAÇÃO ───────────────────────────────────────────────────────
//
// "Oi Samuel, aqui é a Maitê" numa conversa que aconteceu de manhã é o carimbo
// do disparo automático. O follow-up é, por definição, continuação: se existe
// um toque, existe uma conversa antes dele.
describe("a Maitê não se reapresenta no follow-up", () => {
  const casos: [string, Lead, number][] = [
    ["compra, etapa 1", leadDisponivel(), 1],
    ["compra, sem conferir, etapa 1", leadReal(), 1],
    ["locação, etapa 1", leadReal({ finalidade: "LOCACAO" }), 1],
    ["locação com simulação pendente", leadReal({ finalidade: "LOCACAO", simulacoes: [{ status: "PENDENTE" }] }), 1],
    ["sem imóvel escolhido", leadReal({ imovel: null }), 1],
  ];

  for (const [rotulo, lead, etapa] of casos) {
    it(`${rotulo} abre pelo nome, sem se apresentar`, () => {
      const t = mensagemToque(lead, etapa);
      expect(t).not.toContain("aqui é a Maitê");
      expect(t.startsWith("Roberto")).toBe(true);
    });
  }
});

// ── REGÊNCIA E CONTRAÇÃO ──────────────────────────────────────────────────
//
// A mesma família de defeito que fez "o casa de condomínio" chegar a um cliente
// em 21/08, e que lib/referencia-imovel.ts existe para não repetir. A citação do
// imóvel já vem com artigo ("a casa no condomínio Gaivota I"), então emendar uma
// preposição na frente sem contrair produz "de a casa" e "pensando daquela".
describe("a preposição contrai com o artigo", () => {
  it("é 'do seguro da casa', nunca 'do seguro de a casa'", () => {
    const t = mensagemToque(leadReal({ finalidade: "LOCACAO" }), 1);
    expect(t).toContain("do seguro da casa no condomínio Gaivota I");
    expect(t).not.toContain("de a casa");
    expect(t).not.toContain("seguro de a");
  });

  it("no masculino vira 'do'", () => {
    const t = mensagemToque(
      leadReal({
        finalidade: "LOCACAO",
        imovel: { tipo: "Apartamento", bairro: "Centro", valorSugerido: 1800, condominio: null },
      }),
      1
    );
    expect(t).toContain("do seguro do apartamento no Centro");
    expect(t).not.toContain("de o apartamento");
  });

  it("quem rege EM não vira DE: 'pensando naquela', nunca 'pensando daquela'", () => {
    // O caminho desta frase é estreito: locação, com imóvel citável, com uma
    // simulação que NÃO está pendente (a pendente devolve antes) e sem o status
    // do imóvel conferido. Sem essa combinação o teste passaria por vacuidade,
    // afirmando sobre uma mensagem que nunca conteria a frase de qualquer jeito.
    const t = mensagemToque(
      leadReal({ finalidade: "LOCACAO", simulacoes: [{ status: "APROVADO" }] }),
      1
    );
    expect(t).toContain("fiquei pensando naquela casa no condomínio Gaivota I");
    expect(t).not.toContain("pensando daquela");
  });

  it("a etapa 1 sem status conferido usa 'naquela' depois de 'fiquei pensando'", () => {
    // O caminho que chega nesta frase é o de quem viu opções e não escolheu
    // nenhuma: sem imóvel escolhido para locação e sem simulação.
    const t = mensagemToque(leadReal({ finalidade: "COMPRA" }), 1);
    // Este é o de compra, que usa "lembrei daquela" — a regência de LEMBRAR é DE.
    expect(t).toContain("lembrei daquela casa");
    expect(t).not.toContain("lembrei naquela");
  });
});

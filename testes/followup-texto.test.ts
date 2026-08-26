// A mensagem que o cliente lê. Cada caso aqui é uma frase que chegou (ou quase
// chegou) num WhatsApp de verdade.
import { describe, expect, it } from "vitest";
import { mensagemToque } from "@/lib/followup";

type Lead = Parameters<typeof mensagemToque>[0];

/** O lead 342 de produção, do toque de 21/08 às 10:30. */
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
    const t = mensagemToque(leadReal(), 1);
    expect(t).toContain("a casa no condomínio Gaivota I");
    expect(t).not.toContain("o casa");
  });

  it("o pronome também concorda: 'pra ela'", () => {
    const t = mensagemToque(leadReal(), 1);
    expect(t).toContain("pra ela");
    expect(t).not.toContain("pra ele");
  });

  it("a mensagem inteira, do jeito que o cliente vai ler", () => {
    // `brl()` separa "R$" do número com ESPAÇO NÃO-QUEBRÁVEL (U+00A0), como
    // manda o Intl. Comparar contra um espaço comum falha com as duas strings
    // idênticas na tela — normalizar aqui é o que torna a asserção legível.
    const texto = mensagemToque(leadReal(), 1).replace(/\u00a0/g, " ");
    expect(texto).toBe(
      "Oi Roberto, aqui é a Maitê. a casa no condomínio Gaivota I (R$ 1.250.000,00) " +
        "que você viu segue disponível. Quer que eu veja as condições de financiamento pra ela?"
    );
  });

  it("imóvel masculino continua certo", () => {
    const t = mensagemToque(
      leadReal({ imovel: { tipo: "Apartamento", bairro: "Centro", valorVenda: 300000, condominio: null } }),
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

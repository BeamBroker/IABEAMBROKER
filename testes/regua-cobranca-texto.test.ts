// O texto de cada degrau da régua, sem banco.
//
// O teste ao lado (regua-cobranca-banco.test.ts) prova a idempotência da régua
// rodando de verdade. Este aqui prova a coisa que o inquilino LÊ — e que, como
// no follow-up, chega no WhatsApp de gente real sem passar por ninguém.
import { describe, expect, it } from "vitest";

import { textoDoToque } from "@/lib/regua-cobranca";

type Dados = Parameters<typeof textoDoToque>[1];

function dados(over: Record<string, unknown> = {}): Dados {
  return {
    nome: "Roberto Almeida",
    endereco: "Rua das Palmeiras, 320",
    competencia: "2026-08",
    vencimento: new Date("2026-08-10T12:00:00Z"),
    valorOriginal: 1800,
    valorAtualizado: 1953.4,
    diasAtraso: 12,
    temPix: false,
    primeiroToque: true,
    ...over,
  } as unknown as Dados;
}

// ── A APRESENTAÇÃO É DO PRIMEIRO TOQUE, E SÓ DELE ──────────────────────────
//
// A régua manda até seis mensagens para a mesma pessoa sobre a mesma fatura.
// Abrir todas com "aqui é a Maitê" é o carimbo do disparo automático, e no
// último degrau vira contradição escrita.
describe("a Maitê se apresenta uma vez por fatura", () => {
  it("o primeiro toque se apresenta", () => {
    expect(textoDoToque("LEMBRETE", dados())).toContain("Oi Roberto, aqui é a Maitê.");
  });

  const degraus = ["LEMBRETE", "VENCE_HOJE", "VENCEU", "ENCARGOS", "ACORDO", "ULTIMO"] as const;

  for (const chave of degraus) {
    it(`${chave}, quando não é o primeiro, abre só pelo nome`, () => {
      const t = textoDoToque(chave, dados({ primeiroToque: false }));
      expect(t).not.toContain("aqui é a Maitê");
      expect(t.startsWith("Roberto, ")).toBe(true);
    });
  }

  it("o último degrau não se apresenta e diz que já mandou mensagem", () => {
    // "Oi Roberto, aqui é a Maitê" seguido de "as minhas mensagens não tiveram
    // retorno" diz, na mesma frase, que ela nunca falou com você e que já falou
    // cinco vezes.
    const t = textoDoToque("ULTIMO", dados({ primeiroToque: false }));
    expect(t).toContain("não tiveram retorno");
    expect(t).not.toContain("aqui é a Maitê");
  });
});

// ── A INICIAL SOBE DEPOIS DO PONTO ─────────────────────────────────────────
//
// O corpo chega em minúscula porque, sem apresentação, ele emenda na vírgula
// depois do nome. Com apresentação, a frase recomeça depois de um ponto. Foi
// este detalhe que deixou "aqui é a Maitê. a casa no condomínio" chegar em
// produção pelo lado do follow-up.
describe("a frase não começa em minúscula depois do ponto", () => {
  it("com apresentação, o corpo do LEMBRETE sobe", () => {
    expect(textoDoToque("LEMBRETE", dados())).toContain("aqui é a Maitê. Passando só pra lembrar");
  });

  it("com apresentação, o corpo dos outros degraus também sobe", () => {
    expect(textoDoToque("VENCEU", dados())).toContain("aqui é a Maitê. O aluguel");
    expect(textoDoToque("ULTIMO", dados())).toContain("aqui é a Maitê. O aluguel");
  });

  it("sem apresentação, o corpo emenda em minúscula na vírgula", () => {
    expect(textoDoToque("VENCEU", dados({ primeiroToque: false }))).toContain("Roberto, o aluguel");
  });
});

// ── DOIS-PONTOS ────────────────────────────────────────────────────────────
//
// Dois-pontos emendando pergunta ou anunciando o que vem é a pontuação que mais
// denuncia texto gerado. Antes de um valor que vale sozinho ele continua
// valendo, e é por isso que o VENCEU segue com "em aberto: R$ ...".
describe("dois-pontos não anunciam o que vem", () => {
  it("o VENCE_HOJE separa o valor por vírgula", () => {
    const t = textoDoToque("VENCE_HOJE", dados());
    expect(t).toContain("vence hoje,");
    expect(t).not.toContain("vence hoje:");
  });

  it("o ACORDO não anuncia a saída com dois-pontos", () => {
    const t = textoDoToque("ACORDO", dados());
    expect(t).toContain("uma saída. Dá pra parcelar");
    expect(t).not.toContain("uma saída:");
  });
});

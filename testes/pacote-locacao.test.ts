// O pacote da locação: o que a pessoa paga por mês para morar ali.
//
// O caso que escreveu este arquivo: o cliente diz "procuro até 1.700" e recebe
// um apartamento de aluguel 1.500 com 400 de condomínio e 100 de IPTU. Dois mil
// reais apresentados como mil e quinhentos, e a conta aparecendo na assinatura.
//
// A busca filtrava por `Imovel.valorSugerido`, que é só o aluguel, e o IPTU não
// chegava nem à apresentação: o prompt mandava mostrar "o valor TOTAL (aluguel
// + condomínio + IPTU)" e a ferramenta devolvia dois dos três números.
import { describe, expect, it } from "vitest";

import {
  MARGEM_ACIMA,
  descreverPacote,
  encaixe,
  pacoteMensal,
  tetoComMargem,
} from "@/lib/pacote-locacao";

const real = (v: number) => `R$ ${v.toLocaleString("pt-BR")}`;

describe("o pacote soma os três", () => {
  it("aluguel + condomínio + IPTU", () => {
    const p = pacoteMensal({ valorSugerido: 1400, valorCondominio: 250, valorIptuMensal: 80 });
    expect(p.total).toBe(1730);
    expect(p.completo).toBe(true);
  });

  it("o caso do print: 1.500 de aluguel são 2.000 por mês", () => {
    const p = pacoteMensal({ valorSugerido: 1500, valorCondominio: 400, valorIptuMensal: 100 });
    expect(p.total).toBe(2000);
    // E não pode ser tratado como uma opção de 1.500 para quem falou 1.700.
    expect(encaixe(p, 1700)).toBe("fora");
  });

  it("aceita Decimal do Prisma e string do banco", () => {
    const decimalzinho = { toString: () => "1400", valueOf: () => 1400 };
    expect(pacoteMensal({ valorSugerido: decimalzinho, valorCondominio: "250" }).total).toBe(1650);
  });
});

// ── NULO É "NÃO SEI", NUNCA "É ZERO" ──────────────────────────────────────
//
// Mesma regra de `nomeRestrito` em lib/qualificacao.ts. Condomínio em branco no
// cadastro pode significar que o imóvel não tem, ou que ninguém preencheu.
// Tratar como zero transforma cadastro incompleto em afirmação de preço.
describe("o que falta no cadastro não vira zero", () => {
  it("sem condomínio cadastrado, o pacote fica incompleto", () => {
    const p = pacoteMensal({ valorSugerido: 1400 });
    expect(p.condominio).toBeNull();
    expect(p.iptu).toBeNull();
    expect(p.completo).toBe(false);
    expect(p.faltando).toEqual(["condomínio", "IPTU"]);
  });

  it("o total do pacote incompleto é um PISO, e o texto avisa", () => {
    const t = descreverPacote(pacoteMensal({ valorSugerido: 1400 }), real);
    expect(t).toContain("PISO");
    expect(t).toContain("ofereça confirmar");
  });

  it("zero cadastrado é zero, e é diferente de não cadastrado", () => {
    const p = pacoteMensal({ valorSugerido: 1400, valorCondominio: 0, valorIptuMensal: 0 });
    expect(p.condominio).toBe(0);
    expect(p.completo).toBe(true);
    expect(descreverPacote(p, real)).not.toContain("PISO");
  });

  it("pacote incompleto nunca é promovido a 'dentro' do orçamento", () => {
    // O piso cabe, mas pode haver 400 de condomínio escondido. Ele entra como
    // pouco_acima para a Maitê mostrar oferecendo confirmar, nunca afirmando.
    const p = pacoteMensal({ valorSugerido: 1400 });
    expect(p.total).toBeLessThan(1700);
    expect(encaixe(p, 1700)).toBe("pouco_acima");
  });
});

// ── A MARGEM ──────────────────────────────────────────────────────────────
//
// 1.800 para quem falou 1.700 vale a pena mostrar (avisando). 2.100 e 2.500,
// não: aí a Maitê estaria apresentando como possível o que a pessoa já disse
// que não cabe.
describe("uma margem pequena, e só", () => {
  it("o teto de 1.700 abre até 1.870", () => {
    expect(MARGEM_ACIMA).toBe(0.1);
    expect(tetoComMargem(1700)).toBeCloseTo(1870, 5);
  });

  it("1.800 entra, avisado", () => {
    const p = pacoteMensal({ valorSugerido: 1600, valorCondominio: 150, valorIptuMensal: 50 });
    expect(p.total).toBe(1800);
    expect(encaixe(p, 1700)).toBe("pouco_acima");
  });

  it("2.100 e 2.500 ficam de fora", () => {
    for (const total of [2100, 2500]) {
      const p = pacoteMensal({ valorSugerido: total, valorCondominio: 0, valorIptuMensal: 0 });
      expect(encaixe(p, 1700)).toBe("fora");
    }
  });

  it("dentro do teto é dentro", () => {
    const p = pacoteMensal({ valorSugerido: 1400, valorCondominio: 200, valorIptuMensal: 50 });
    expect(p.total).toBe(1650);
    expect(encaixe(p, 1700)).toBe("dentro");
  });

  it("sem teto informado, tudo cabe", () => {
    const p = pacoteMensal({ valorSugerido: 9000, valorCondominio: 0, valorIptuMensal: 0 });
    expect(encaixe(p, null)).toBe("dentro");
    expect(encaixe(p, 0)).toBe("dentro");
  });
});

describe("o texto abre a conta", () => {
  it("mostra as parcelas, para a Maitê poder responder 'é o pacote?'", () => {
    const t = descreverPacote(pacoteMensal({ valorSugerido: 1400, valorCondominio: 250, valorIptuMensal: 80 }), real);
    expect(t).toContain("pacote");
    expect(t).toContain("aluguel");
    expect(t).toContain("cond.");
    expect(t).toContain("IPTU");
  });

  it("sem condomínio nem IPTU cadastrados, não inventa parcela nenhuma", () => {
    const t = descreverPacote(pacoteMensal({ valorSugerido: 1400 }), real);
    expect(t).not.toContain("cond.");
    // O aviso do piso CITA o IPTU que falta, então a asserção é sobre a conta
    // aberta entre parênteses, que é onde uma parcela inventada apareceria.
    expect(t).not.toMatch(/\(aluguel/);
  });
});

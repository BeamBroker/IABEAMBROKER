import { describe, expect, it } from "vitest";

import {
  cpfValido,
  formatarCpf,
  idadeEm,
  lerNascimento,
  podeSeguirFunil,
  validarDados,
  AGUARDE,
  PEDIDO_DE_DADOS,
  REPROVADO,
} from "@/lib/seguro-fianca";

describe("CPF", () => {
  it("aceita CPF válido, com ou sem pontuação", () => {
    // Validar aqui evita que um dígito trocado volte como "reprovado" horas
    // depois — que o cliente entende como "meu nome está sujo".
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("52998224725")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(cpfValido("529.982.247-26")).toBe(false);
  });

  it("recusa os repetidos, que passam na conta mas não existem", () => {
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("000.000.000-00")).toBe(false);
  });

  it("recusa tamanho errado", () => {
    expect(cpfValido("5299822472")).toBe(false);
    expect(cpfValido("")).toBe(false);
  });

  it("formata para leitura", () => {
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
  });
});

describe("data de nascimento", () => {
  it("aceita o jeito que o cliente escreve", () => {
    // Recusar por causa do formato é jogar de volta para ele um problema nosso.
    for (const entrada of ["15/03/1990", "15-03-1990", "15.03.1990", "1990-03-15"]) {
      const d = lerNascimento(entrada)!;
      expect(d.getFullYear()).toBe(1990);
      expect(d.getMonth()).toBe(2);
      expect(d.getDate()).toBe(15);
    }
  });

  it("recusa data que não existe", () => {
    // O Date acomoda 31/02 em 03/03 sem reclamar — daí a conferência de volta.
    expect(lerNascimento("31/02/1990")).toBeNull();
    expect(lerNascimento("00/01/1990")).toBeNull();
    expect(lerNascimento("ontem")).toBeNull();
    expect(lerNascimento("")).toBeNull();
  });

  it("calcula idade contando o aniversário ainda não feito", () => {
    const nasc = new Date(1990, 5, 15); // 15/06/1990
    expect(idadeEm(nasc, new Date(2026, 5, 14))).toBe(35); // véspera
    expect(idadeEm(nasc, new Date(2026, 5, 15))).toBe(36); // no dia
  });
});

describe("os cinco dados da seguradora", () => {
  const bons = {
    nomeCompleto: "Maria Souza",
    cpf: "529.982.247-25",
    nascimento: "15/03/1990",
    telefone: "(63) 99999-0000",
    email: "maria@email.com",
  };

  it("passa com tudo certo", () => {
    const r = validarDados(bons);
    expect(r.ok).toBe(true);
  });

  it("exige nome COMPLETO — só o primeiro nome não identifica ninguém", () => {
    const r = validarDados({ ...bons, nomeCompleto: "Maria" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros).toContain("nome completo (nome e sobrenome)");
  });

  it("recusa titular menor de idade", () => {
    const ano = new Date().getFullYear() - 15;
    const r = validarDados({ ...bons, nascimento: `15/03/${ano}` });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros).toContain("titular maior de 18 anos");
  });

  it("junta tudo que falta de uma vez, para a IA pedir de uma vez só", () => {
    const r = validarDados({ nomeCompleto: "Ana" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erros.length).toBeGreaterThanOrEqual(4);
  });

  it("recusa telefone sem DDD e e-mail malformado", () => {
    const r = validarDados({ ...bons, telefone: "99990000", email: "maria@" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros).toContain("telefone com DDD");
      expect(r.erros).toContain("e-mail válido");
    }
  });
});

describe("a trava do funil", () => {
  it("sem simulação, não mostra imóvel — e diz o que fazer", () => {
    // A trava fica ANTES de mostrar imóvel, não antes da visita: é a diferença
    // entre descobrir que não passa agora, quando ainda é conversa, e descobrir
    // depois de já ter escolhido um apartamento.
    const r = podeSeguirFunil({ temSimulacao: false, status: null });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/nome completo, CPF/i);
    expect(r.motivo).toMatch(/antes de mostrar qualquer imóvel/i);
  });

  it("pendente não passa: ainda não voltou o retorno", () => {
    expect(podeSeguirFunil({ temSimulacao: true, status: "PENDENTE" }).pode).toBe(false);
  });

  it("reprovado não passa — manda pedir alguém da família", () => {
    const r = podeSeguirFunil({ temSimulacao: true, status: "REPROVADO" });
    expect(r.pode).toBe(false);
    expect(r.motivo).toMatch(/família/i);
  });

  it("aprovado libera", () => {
    expect(podeSeguirFunil({ temSimulacao: true, status: "APROVADO" })).toEqual({
      pode: true,
      motivo: null,
    });
  });
});

describe("as mensagens fixas", () => {
  it("o pedido explica ANTES de pedir, e lista os cinco dados", () => {
    // Pedir CPF sem dizer por quê é o momento em que o cliente desconfia e some.
    expect(PEDIDO_DE_DADOS).toMatch(/seguro fiança/i);
    // Fala da CARTEIRA, não de "esse imóvel que você escolheu": neste ponto da
    // conversa o cliente ainda não escolheu nada.
    expect(PEDIDO_DE_DADOS).toMatch(/carteira/i);
    expect(PEDIDO_DE_DADOS).toMatch(/antes de te mandar as opções/i);
    expect(PEDIDO_DE_DADOS).not.toMatch(/imóvel que você escolheu/i);
    expect(PEDIDO_DE_DADOS).toMatch(/proprietário/i);
    for (const dado of ["Nome completo", "CPF", "Data de nascimento", "Telefone", "E-mail"])
      expect(PEDIDO_DE_DADOS).toContain(dado);
  });

  it("o aviso de espera fala em 5 minutinhos", () => {
    expect(AGUARDE).toMatch(/5 minutinhos/);
  });

  it("reprovado oferece a saída pela família, sem soar como fim", () => {
    expect(REPROVADO).toMatch(/família/i);
    expect(REPROVADO).toMatch(/tem solução|comum/i);
  });
});

// A regra que divide comissão entre pessoas.
//
// Testes de lógica pura, sem banco. É a única parte deste sistema em que
// "aproximadamente certo" não serve: 50/30/20 configurado tem que dar 50/30/20
// contado, senão a discussão vira a palavra de um contra a do outro — e é uma
// discussão sobre dinheiro.

import { describe, expect, it } from "vitest";

import { escolherCorretor, type Elegivel } from "@/lib/distribuicao";

// Roda N distribuições sobre o mesmo conjunto, atualizando o realizado a cada
// uma — que é exatamente o que o banco faz entre um lead e o seguinte.
function distribuir(iniciais: Elegivel[], quantos: number): Map<number, number> {
  const estado = iniciais.map((e) => ({ ...e }));
  const conta = new Map<number, number>(estado.map((e) => [e.corretorId, 0]));
  let relogio = 0;
  for (let i = 0; i < quantos; i++) {
    const id = escolherCorretor(estado);
    if (id === null) break;
    const alvo = estado.find((e) => e.corretorId === id)!;
    alvo.recebidos += 1;
    alvo.ultimoEm = new Date(++relogio);
    conta.set(id, (conta.get(id) ?? 0) + 1);
  }
  return conta;
}

const zerado = (corretorId: number, percentual: number): Elegivel => ({
  corretorId,
  percentual,
  recebidos: 0,
  ultimoEm: null,
});

describe("menor déficit", () => {
  it("50/30/20 em 100 rodadas dá 50, 30 e 20 EXATOS", () => {
    // O teste que o sorteio ponderado não passa, e a razão de o algoritmo ser
    // este. É o número que alguém vai conferir numa reunião.
    const r = distribuir([zerado(1, 50), zerado(2, 30), zerado(3, 20)], 100);
    expect(r.get(1)).toBe(50);
    expect(r.get(2)).toBe(30);
    expect(r.get(3)).toBe(20);
  });

  it("não depende da ordem da lista", () => {
    const a = distribuir([zerado(1, 50), zerado(2, 30), zerado(3, 20)], 100);
    const b = distribuir([zerado(3, 20), zerado(1, 50), zerado(2, 30)], 100);
    expect([...b].sort()).toEqual([...a].sort());
  });

  it("percentuais que não somam 100 são normalizados, não quebram", () => {
    // A tela recusa salvar fora de 100, mas o algoritmo não pode depender
    // disso: uma cota desativada no meio do mês deixa a soma dos ativos em 80.
    const r = distribuir([zerado(1, 40), zerado(2, 40)], 50);
    expect(r.get(1)).toBe(25);
    expect(r.get(2)).toBe(25);
  });

  it("quem entra no meio do mês recebe MAIS até alcançar — e só até lá", () => {
    // O que mais surpreende quem esperava sorteio: o rodízio se autocorrige em
    // vez de perpetuar o atraso de quem chegou depois.
    const veterano: Elegivel = { corretorId: 1, percentual: 50, recebidos: 40, ultimoEm: null };
    const novato: Elegivel = { corretorId: 2, percentual: 50, recebidos: 0, ultimoEm: null };
    const r = distribuir([veterano, novato], 40);
    expect(r.get(2)).toBeGreaterThan(r.get(1)!);
    // Ao fim das 40 os dois empatam: a dívida foi paga, não compensada para
    // sempre. Um rodízio que não para de compensar vira punição ao veterano.
    expect(40 + r.get(1)!).toBe(0 + r.get(2)!);
  });

  it("empate vai para quem está sem receber há mais tempo", () => {
    const antigo: Elegivel = { corretorId: 1, percentual: 50, recebidos: 5, ultimoEm: new Date(1) };
    const recente: Elegivel = { corretorId: 2, percentual: 50, recebidos: 5, ultimoEm: new Date(9) };
    expect(escolherCorretor([recente, antigo])).toBe(1);
  });

  it("com dois zerados, o segundo lead NÃO volta para o primeiro", () => {
    // O caso do primeiro dia. Sem o desempate por tempo, o mesmo corretor
    // levaria os dois primeiros e a queixa apareceria na primeira manhã.
    const estado = [zerado(1, 50), zerado(2, 50)];
    const primeiro = escolherCorretor(estado)!;
    const alvo = estado.find((e) => e.corretorId === primeiro)!;
    alvo.recebidos = 1;
    alvo.ultimoEm = new Date(1);
    expect(escolherCorretor(estado)).not.toBe(primeiro);
  });
});

describe("quem NÃO entra no rodízio", () => {
  it("percentual zero nunca é escolhido", () => {
    // É como a tela representa quem não recebe: cota 0, não linha apagada. O
    // histórico dele continua de pé.
    const r = distribuir([zerado(1, 100), zerado(2, 0)], 20);
    expect(r.get(1)).toBe(20);
    expect(r.get(2)).toBe(0);
  });

  it("lista vazia devolve null, sem lançar", () => {
    // Distribuição que falha não pode desfazer a qualificação que acabou de ser
    // gravada — por isso ela devolve null em vez de estourar.
    expect(escolherCorretor([])).toBeNull();
  });

  // MUDOU EM 18/08/2026, e o teste antigo prendia o bug: "todo mundo em zero"
  // devolvia null, ou seja, a casa que nunca abriu a tela de cotas não
  // distribuía lead nenhum, para sempre. A cota nasce em 0 — o zero geral é
  // "ninguém configurou", não "ninguém recebe".
  it("todo mundo com percentual zero cai no rodízio igualitário", () => {
    const r = distribuir([zerado(1, 0), zerado(2, 0), zerado(3, 0)], 99);
    expect([r.get(1), r.get(2), r.get(3)]).toEqual([33, 33, 33]);
  });

  it("basta UM com percentual para o zero voltar a significar 'fora'", () => {
    const r = distribuir([zerado(1, 100), zerado(2, 0)], 10);
    expect(r.get(1)).toBe(10);
    expect(r.get(2) ?? 0).toBe(0);
  });

  it("sem cota nenhuma continua devolvendo null", () => {
    expect(escolherCorretor([])).toBeNull();
  });

  it("quem está em atendimento cede a vez a quem está livre", () => {
    const ocupado = { ...zerado(1, 50), emAtendimento: true };
    expect(escolherCorretor([ocupado, zerado(2, 50)])).toBe(2);
  });

  it("com todo mundo atendendo, o rodízio decide como sempre", () => {
    const a = { ...zerado(1, 50), emAtendimento: true, recebidos: 5 };
    const b = { ...zerado(2, 50), emAtendimento: true, recebidos: 1 };
    expect(escolherCorretor([a, b])).toBe(2);
  });

  it("um corretor só leva tudo", () => {
    expect(distribuir([zerado(7, 30)], 12).get(7)).toBe(12);
  });
});

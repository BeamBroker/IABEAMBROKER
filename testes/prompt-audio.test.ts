// A decisão de mandar áudio passou a vir ANTES de a IA escrever. Sorteada
// depois, a resposta chegava pronta com bullet, link e "R$ 189.900,00" para
// serem narrados — e nenhum pipeline de fala conserta estrutura de texto
// escrito. Estes testes travam as duas metades: a regra de horário e o
// conteúdo do prompt que a IA recebe.
import { describe, expect, it } from "vitest";

import { PROMPT_AUDIO, dentroDaJanelaDeAudio, janelaLiberada } from "@/lib/prompt-audio";
import { sorteioDeAudio } from "@/lib/voz";

// Horários montados em UTC e conferidos no fuso de São Paulo (UTC-3).
// Data DEPOIS da liberação temporária, de propósito: aqui o que se testa é a
// regra padrão. A liberação tem bloco próprio no fim do arquivo.
const emSaoPaulo = (hora: number) => new Date(Date.UTC(2026, 7, 15, hora + 3, 0, 0));

describe("a janela de áudio", () => {
  it("de dia manda voz", () => {
    expect(dentroDaJanelaDeAudio(emSaoPaulo(8))).toBe(true);
    expect(dentroDaJanelaDeAudio(emSaoPaulo(15))).toBe(true);
    expect(dentroDaJanelaDeAudio(emSaoPaulo(20))).toBe(true);
  });

  it("de madrugada e no fim da noite, NÃO", () => {
    // Áudio de número desconhecido às 23h é o que mais toma bloqueio.
    expect(dentroDaJanelaDeAudio(emSaoPaulo(23))).toBe(false);
    expect(dentroDaJanelaDeAudio(emSaoPaulo(3))).toBe(false);
    expect(dentroDaJanelaDeAudio(emSaoPaulo(7))).toBe(false);
  });

  it("as bordas exatas: 8h entra, 21h já não", () => {
    expect(dentroDaJanelaDeAudio(emSaoPaulo(8))).toBe(true);
    expect(dentroDaJanelaDeAudio(emSaoPaulo(21))).toBe(false);
  });
});

describe("o sorteio respeita a janela", () => {
  const base = { pct: 100, temChave: true, sorteio: () => 0 };

  it("100% configurado NÃO manda áudio fora do horário", () => {
    expect(sorteioDeAudio({ ligada: true, ...base, agora: emSaoPaulo(23) })).toBe(false);
    expect(sorteioDeAudio({ ligada: true, ...base, agora: emSaoPaulo(14) })).toBe(true);
  });

  it("decide SEM ver o texto — é isso que permite avisar a IA antes", () => {
    // A assinatura não tem `texto`: se tivesse, a decisão só poderia vir depois
    // de escrever, que era exatamente o problema.
    expect(sorteioDeAudio({ ligada: true, pct: 100, temChave: true, agora: emSaoPaulo(14) })).toBe(true);
  });

  it("zero desliga, e sem chave nunca sai", () => {
    expect(sorteioDeAudio({ ligada: true, ...base, pct: 0, agora: emSaoPaulo(14) })).toBe(false);
    expect(sorteioDeAudio({ ligada: true, ...base, temChave: false, agora: emSaoPaulo(14) })).toBe(false);
  });
});

describe("o prompt que a IA recebe quando a resposta vai virar voz", () => {
  it("proíbe o que não existe em áudio", () => {
    for (const proibido of ["Emoji", "bullet", "link", "markdown"]) {
      expect(PROMPT_AUDIO).toContain(proibido);
    }
  });

  it("manda escrever número por extenso, com exemplo do ramo", () => {
    expect(PROMPT_AUDIO).toContain("trezentos e cinquenta mil");
    expect(PROMPT_AUDIO).toContain("setenta metros quadrados");
  });

  it("limita a duração — ouvido não guarda textão", () => {
    expect(PROMPT_AUDIO).toMatch(/2 a 4 frases/);
    expect(PROMPT_AUDIO).toMatch(/20 segundos/);
  });

  it("exige honestidade sobre ser IA", () => {
    // Negar ativamente é o único cenário com risco real de prática enganosa.
    expect(PROMPT_AUDIO).toMatch(/Nunca afirme ser humana/);
  });
});

// Uma regra invisível é indistinguível de um bug. Quando a janela bloqueia, o
// log de auditoria precisa dizer isso — senão a investigação recomeça do zero
// caçando chave, saldo e modelo, que é o que aconteceu.
describe("a janela é a explicação mais provável quando o áudio some", () => {
  it("de madrugada, nem 100% com chave e texto curto passa", () => {
    expect(
      sorteioDeAudio({ ligada: true, pct: 100, temChave: true, agora: emSaoPaulo(1), sorteio: () => 0 })
    ).toBe(false);
  });

  it("o mesmo caso às 10h da manhã passa — a diferença é SÓ o horário", () => {
    expect(
      sorteioDeAudio({ ligada: true, pct: 100, temChave: true, agora: emSaoPaulo(10), sorteio: () => 0 })
    ).toBe(true);
  });
});

// Liberação temporária para teste fora do horário. Expira SOZINHA: liberação
// que depende de alguém lembrar de desfazer vira permanente por esquecimento —
// e aí a Maitê manda áudio às 3 da manhã sem ninguém ter decidido isso.
describe("a liberação temporária da janela", () => {
  const DURANTE = new Date("2026-07-28T05:00:00Z"); // 2h em São Paulo, liberado
  const DEPOIS = new Date("2026-07-29T05:00:00Z"); // 2h do dia seguinte

  it("enquanto vale, o áudio sai de madrugada", () => {
    expect(janelaLiberada(DURANTE)).toBe(true);
    expect(dentroDaJanelaDeAudio(DURANTE)).toBe(true);
  });

  it("no dia seguinte, a mesma hora volta a ser bloqueada", () => {
    expect(janelaLiberada(DEPOIS)).toBe(false);
    expect(dentroDaJanelaDeAudio(DEPOIS)).toBe(false);
  });

  it("expirada a liberação, o horário comercial continua funcionando", () => {
    const dezDaManha = new Date("2026-07-29T13:00:00Z");
    expect(janelaLiberada(dezDaManha)).toBe(false);
    expect(dentroDaJanelaDeAudio(dezDaManha)).toBe(true);
  });
});

// O tom da atendente, por imobiliária.
//
// A voz do PROMPT_BASE foi escrita para o WhatsApp de uma administradora de
// bairro, e ali ela está certa. A mesma frase muda de sinal conforme a casa:
// "qual região você curte mais?" funciona para aluguel de dois quartos e queima
// uma conversa de casa de três milhões.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { promptDoTom, TOM_PADRAO, tomDaImobiliaria, tomEscolhido, TONS } from "@/lib/tom-da-imobiliaria";

const cfg = (o: Record<string, unknown>) => JSON.stringify(o);

describe("quem não configurou nada continua com o comportamento de ontem", () => {
  it("sem iasConfig, o tom é o padrão", () => {
    expect(tomDaImobiliaria(null)).toBe(TOM_PADRAO);
    expect(tomDaImobiliaria(undefined)).toBe(TOM_PADRAO);
    expect(tomDaImobiliaria("")).toBe(TOM_PADRAO);
  });

  it("O PADRÃO NÃO ACRESCENTA BLOCO NENHUM", () => {
    // A decisão mais importante do módulo. Se o padrão repetisse "seja informal
    // e leve" logo depois de o PROMPT_BASE já ter dito isso, passariam a existir
    // duas descrições da mesma voz competindo — e entre duas instruções sobre o
    // mesmo assunto o modelo obedece à mais próxima. A casa que não mexeu em
    // nada receberia comportamento novo sem ninguém ter decidido isso.
    expect(promptDoTom(TOM_PADRAO)).toBe("");
  });

  it("iasConfig quebrado não derruba a resposta ao cliente", () => {
    // Mesmo desenho de ia-config.ts: um JSON inválido no banco não pode
    // explodir no caminho em que o cliente está esperando no WhatsApp.
    expect(tomDaImobiliaria("{isso não é json")).toBe(TOM_PADRAO);
    expect(tomDaImobiliaria("null")).toBe(TOM_PADRAO);
    expect(tomDaImobiliaria('"uma string solta"')).toBe(TOM_PADRAO);
  });

  it("tom inválido cai no padrão em vez de virar prompt vazio", () => {
    expect(tomDaImobiliaria(cfg({ tom: "SIMPÁTICA" }))).toBe(TOM_PADRAO);
    expect(tomDaImobiliaria(cfg({ tom: 42 }))).toBe(TOM_PADRAO);
  });

  it("o nome da IA e o tom convivem no mesmo iasConfig", () => {
    // O tom mora onde o nome já mora: sem coluna nova, sem migration.
    expect(tomDaImobiliaria(cfg({ nome: "Marina", tom: "ALTO_PADRAO" }))).toBe("ALTO_PADRAO");
  });

  it("aceita o valor em minúsculas e com espaço sobrando", () => {
    expect(tomDaImobiliaria(cfg({ tom: " alto_padrao " }))).toBe("ALTO_PADRAO");
  });
});

describe("tomEscolhido distingue 'escolheu' de 'não escolheu'", () => {
  it("null quando ninguém escolheu", () => {
    // Igual a nomeEscolhidoDaIA: a tela precisa da diferença, senão apagar o
    // campo não teria como significar "volte ao padrão".
    expect(tomEscolhido(null)).toBeNull();
    expect(tomEscolhido(cfg({ nome: "Marina" }))).toBeNull();
  });

  it("o valor quando escolheu, inclusive quando escolheu o padrão", () => {
    expect(tomEscolhido(cfg({ tom: "NATURAL" }))).toBe("NATURAL");
    expect(tomEscolhido(cfg({ tom: "INFORMAL" }))).toBe("INFORMAL");
  });
});

describe("cada bloco é um DELTA, nunca uma segunda voz inteira", () => {
  const naoPadrao = TONS.filter((t) => t !== TOM_PADRAO);

  for (const t of naoPadrao) {
    it(`${t} diz o que muda, e traz o par certo/errado`, () => {
      const b = promptDoTom(t);
      expect(b.length).toBeGreaterThan(0);
      expect(b).toContain("TOM DESTA IMOBILIÁRIA");
    });
  }

  it("nenhum tom libera emoji", () => {
    // docs/05 registra a decisão como absoluta, e ela está na lista das que
    // custaram cliente. Tornar emoji configurável é decisão do dono, não efeito
    // colateral de um arquivo de tom.
    for (const t of TONS) {
      expect(promptDoTom(t)).not.toMatch(/pode usar emoji|com emoji|emojis? liberado/i);
    }
    expect(promptDoTom("INFORMAL")).toContain("sem emoji");
  });

  it("o mais solto continua sem animação de vendedor", () => {
    // "Showww" e "partiu visita" não são informalidade, são propaganda — e por
    // escrito denunciam robô imitando gente, que é o oposto do objetivo.
    const b = promptDoTom("INFORMAL");
    expect(b).toMatch(/Showww/);
    expect(b).toMatch(/N[ÃA]O entram/);
  });

  it("o alto padrão troca 'curte' por 'considera', com o par escrito", () => {
    const b = promptDoTom("ALTO_PADRAO");
    expect(b).toContain("Tem alguma outra região que você considera também?");
    expect(b).toContain("Qual região você curte mais?");
  });

  it("o profissional não vira ofício", () => {
    const b = promptDoTom("PROFISSIONAL");
    expect(b).toMatch(/prezado/i);
    expect(b).toContain("Continua sendo WhatsApp");
  });
});

describe("o tom entra no prompt, e no lugar certo", () => {
  const fonte = readFileSync("lib/agentes.ts", "utf8");

  it("o bloco é acrescentado ao parteB (variável), não ao parteA (cacheável)", () => {
    // parteA é idêntica para todas as imobiliárias: é o que faz o cache da
    // Anthropic valer entre elas. Um bloco por casa lá dentro invalidaria o
    // cache de todo mundo, que é o mesmo motivo de o NOME da IA estar no B.
    expect(fonte).toMatch(/parteB \+= `\\n\\n\$\{blocoDeTom\}`/);
  });

  it("o AJUDA_CORRETOR fica de fora", () => {
    // Aquele prompt já declara a própria exceção de tom, por pedido do dono.
    // Empilhar um bloco por cima criaria duas instruções opostas sobre o mesmo
    // assunto — o defeito que este sistema já pagou duas vezes.
    expect(fonte).toContain('if (conversa.agente !== "AJUDA_CORRETOR") {');
  });

  it("vem ANTES do bloco de áudio: quem manda no jeito de escrever é o canal", () => {
    expect(fonte.indexOf("const blocoDeTom")).toBeLessThan(fonte.indexOf("PROMPT_AUDIO"));
  });
});

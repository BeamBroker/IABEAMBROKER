// Um cliente que queria comprar uma casa recebeu, no WhatsApp:
// "[modo demo: configure a ANTHROPIC_API_KEY para a IA operar de verdade]".
// Estes testes existem para que isso não volte por nenhum caminho.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { RESPOSTA_NEUTRA, contemVazamentoInterno, paraOCliente } from "@/lib/mensagem-segura";

const A_MENSAGEM_QUE_VAZOU =
  "Oi, aqui é a Maitê. Você procura um imóvel pra alugar, quer anunciar um imóvel seu, " +
  "ou já é cliente da gente? [modo demo: configure a ANTHROPIC_API_KEY para a IA operar de verdade]";

describe("a mensagem que vazou não passa mais", () => {
  it("a nota de diagnóstico é removida e a frase boa sobrevive", () => {
    const saida = paraOCliente(A_MENSAGEM_QUE_VAZOU);
    expect(saida).not.toMatch(/ANTHROPIC/i);
    expect(saida).not.toMatch(/modo demo/i);
    expect(saida).not.toContain("[");
    // A pergunta ao cliente continua lá: salvamos a frase, não descartamos tudo.
    expect(saida).toContain("Você procura um imóvel pra alugar");
  });

  it("termo interno solto no texto derruba a mensagem inteira para a neutra", () => {
    // Sem colchete não dá para recortar. Aí é melhor dizer pouco do que vazar.
    expect(paraOCliente("Deu erro na ANTHROPIC_API_KEY, tenta de novo")).toBe(RESPOSTA_NEUTRA);
    expect(paraOCliente("Sua cota de IA acabou")).toBe(RESPOSTA_NEUTRA);
    expect(paraOCliente("Falha no uazapi ao enviar")).toBe(RESPOSTA_NEUTRA);
  });

  it("reconhece os termos que não podem sair", () => {
    for (const t of [
      "ANTHROPIC_API_KEY",
      "modo demo",
      "process.env",
      "cota mensal",
      "módulo não contratado",
      "elevenlabs",
      "vercel",
      "localhost:3000",
    ]) {
      expect(contemVazamentoInterno(t)).toBe(true);
    }
  });

  it("mensagem normal da Maitê passa intacta", () => {
    const normal = "Tem sim. Costuma ser 3 aluguéis de depósito.\n\nQuer ver as opções?";
    expect(paraOCliente(normal)).toBe(normal);
  });

  it("tag de emoção do áudio não é confundida com vazamento", () => {
    const comTag = "Oi! [laughs] Achei um que combina com o que você falou.";
    expect(paraOCliente(comTag)).toContain("[laughs]");
  });

  it("texto vazio vira a resposta neutra, nunca silêncio", () => {
    expect(paraOCliente("")).toBe(RESPOSTA_NEUTRA);
    expect(paraOCliente("[modo demo]")).toBe(RESPOSTA_NEUTRA);
  });

  it("a própria resposta neutra é limpa", () => {
    expect(contemVazamentoInterno(RESPOSTA_NEUTRA)).toBe(false);
  });
});

describe("as respostas fixas do agente não citam infraestrutura", () => {
  const fonte = readFileSync(new URL("./agentes.ts", import.meta.url), "utf8");

  it("respostaDemoAgente não menciona chave, env nem modo demo", () => {
    const inicio = fonte.indexOf("function respostaDemoAgente");
    expect(inicio).toBeGreaterThan(0);
    const corpo = fonte.slice(inicio, fonte.indexOf("\n}", inicio));
    for (const proibido of [/ANTHROPIC/i, /API_KEY/i, /modo demo/i, /configure a/i]) {
      expect(corpo).not.toMatch(proibido);
    }
  });

  it("a resposta de cota estourada também não conta o motivo ao cliente", () => {
    // Cota é assunto entre a plataforma e a imobiliária. O cliente final não
    // pode nem desconfiar que existe um limite.
    const trecho = fonte.slice(fonte.indexOf("podeConsumirIA"), fonte.indexOf("const modelo ="));
    expect(trecho).not.toMatch(/cota (esgotada|acabou)/i);
    expect(trecho).toContain("Recebi sua mensagem");
  });
});

// O filtro julgava por substring, e o descarte é da mensagem INTEIRA. Duas
// entradas da lista eram pedaço de palavra comum em português, então a IA
// escrevia a resposta certa e o cliente recebia a frase neutra.
//
// "cotação" é o caso que dói: é a palavra natural de uma IA que vende
// seguro-fiança. Cuidado ao mexer — /\bcota\b/ NÃO resolve, porque \w é
// [A-Za-z0-9_] e "ç" fica fora da classe: a fronteira cai entre "cota" e "ção".
describe("palavra comum do português não é vazamento", () => {
  it("cotação, cotar e cotado passam intactos", () => {
    const frase = "Já pedi a cotação do seguro-fiança, te aviso assim que sair.";
    expect(paraOCliente(frase)).toBe(frase);
    expect(contemVazamentoInterno("vou cotar pra você agora")).toBe(false);
    expect(contemVazamentoInterno("o seguro já foi cotado")).toBe(false);
  });

  it("cota de condomínio é assunto do cliente, não da plataforma", () => {
    expect(contemVazamentoInterno("a cota do condomínio é R$ 380")).toBe(false);
    expect(contemVazamentoInterno("tem cota extra esse mês")).toBe(false);
    expect(contemVazamentoInterno("a cota-parte fica com o proprietário")).toBe(false);
  });

  it("cota da plataforma continua bloqueada", () => {
    // A razão de o termo estar na lista não mudou: o cliente final não pode
    // saber que existe limite de uso entre a plataforma e a imobiliária.
    expect(paraOCliente("Sua cota de IA acabou")).toBe(RESPOSTA_NEUTRA);
    expect(contemVazamentoInterno("cota mensal")).toBe(true);
    expect(contemVazamentoInterno("estourou a cota")).toBe(true);
  });

  it("nome de cliente não é nome de modelo", () => {
    expect(contemVazamentoInterno("Claro, Claudemir! Já te mando as fotos")).toBe(false);
    expect(contemVazamentoInterno("falei com a Claudete ontem")).toBe(false);
    // Mas o modelo, sim: em "claude-sonnet-5" o hífen é fronteira.
    expect(contemVazamentoInterno("rodando claude-sonnet-5")).toBe(true);
    expect(contemVazamentoInterno("erro no claude")).toBe(true);
  });

  it("null e undefined seguem por substring, de propósito", () => {
    // Nenhuma palavra portuguesa os contém, e no vazamento real eles vêm
    // grudados. Exigir fronteira aqui só perderia captura.
    expect(contemVazamentoInterno("erro: undefined")).toBe(true);
    expect(contemVazamentoInterno("valor null")).toBe(true);
    expect(contemVazamentoInterno("nullPointerException na linha 4")).toBe(true);
  });
});

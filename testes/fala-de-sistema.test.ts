// A fala de sistema: o vazamento que não tem nome de variável nenhum.
//
// lib/mensagem-segura.ts já barrava "[modo demo: configure a ANTHROPIC_API_KEY]".
// O que este arquivo protege é o outro vazamento, o que sai em português
// perfeito e conta ao cliente que existe uma consulta do lado de cá:
//
//   26/08, lead de R$ 2,3 mi: "quero comprar uma casa no damha"
//   Maitê:  "Não achei Damha na nossa carteira, nem como condomínio nem como
//            bairro. Vou confirmar com a equipe se existe algo assim."
//
// A carteira tinha DOZE Damhas. lib/acoes-bairro.ts consertou a busca; a frase
// continuava contando ao cliente como a informação chega até nós.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { FALAS_DE_SISTEMA, falaDeSistema } from "@/lib/fala-de-sistema";
import { paraOCliente } from "@/lib/mensagem-segura";

describe("cada família pega o caso que a escreveu", () => {
  for (const f of FALAS_DE_SISTEMA) {
    it(`${f.id}: "${f.exemplo.slice(0, 44)}..."`, () => {
      expect(falaDeSistema(f.exemplo)).toBe(f.id);
    });
  }

  it("o Damha de 26/08, na íntegra", () => {
    expect(
      falaDeSistema(
        "Não achei Damha na nossa carteira, nem como condomínio nem como bairro. " +
          "Vou confirmar com a equipe se existe algo assim."
      )
    ).toBe("busca-vazia");
  });
});

// ── O LIMITE, E ELE É O MOTIVO DE OS PADRÕES SEREM TÃO ESPECÍFICOS ─────────
//
// Metade destas frases tem uma versão LEGÍTIMA a uma palavra de distância. O
// prompt do AJUDA_CORRETOR manda dizer o que foi consultado ("não achei casa
// disponível no Centro") em vez do geral ("não temos casa") — e é o complemento
// interno, não o verbo, que separa a forma boa da ruim. Um padrão frouxo aqui
// repetiria o defeito do "cota" engolindo "cotação do seguro-fiança".
describe("a resposta certa continua passando", () => {
  const legitimas = [
    "Não achei casa disponível no Centro.",
    "Não tenho de 3 quartos na represa, mas tenho dois de 2 quartos a 4 km.",
    "Não achei nada nessa faixa, mas tenho duas um pouco acima.",
    "Tenho algumas opções nos Damhas. Você pretende investir mais ou menos até quanto?",
    "A cotação do seguro-fiança sai hoje.",
    "O imóvel tem acesso independente pela lateral.",
    "O condomínio tem acesso pela Avenida Bady Bassitt.",
    "A casa tem acesso para cadeirante.",
    "Vou confirmar a disponibilidade e já te falo.",
    "Sou a Maitê sim, trabalho aqui na imobiliária.",
  ];

  for (const t of legitimas) {
    it(`passa: "${t.slice(0, 46)}..."`, () => {
      expect(falaDeSistema(t)).toBeNull();
    });
  }
});

// ── AS DUAS PONTAS NÃO PODEM DIVERGIR ─────────────────────────────────────
//
// O conserto do COMPORTAMENTO é o bloco NÃO NARRE O SISTEMA, no PROMPT_BASE; o
// que mora em lib/fala-de-sistema.ts é a régua para medir se ele funcionou.
// Padrão novo lá sem a frase correspondente no prompt é uma medição de algo que
// nunca foi proibido, e o inverso é uma proibição que ninguém mede.
//
// A verificação aproveita que o prompt CITA as frases proibidas: o próprio
// bloco é capturado pelos padrões que ele existe para impedir.
describe("o PROMPT_BASE nomeia todas as famílias que a régua mede", () => {
  const fonte = readFileSync("lib/agentes.ts", "utf8");
  const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("// ── OS TRÊS BLOCOS DO FIM"));

  it("o bloco existe, e existe no PROMPT_BASE (não só numa área)", () => {
    expect(base).toContain("NÃO NARRE O SISTEMA");
    expect(base).toContain("VEIO DE OUTRO CANAL");
    expect(base).toContain("NÃO AFIRME O QUE VOCÊ NÃO ACABOU DE CONFERIR");
  });

  for (const f of FALAS_DE_SISTEMA) {
    it(`${f.id} está escrita no prompt como frase proibida`, () => {
      expect(f.teste.test(base)).toBe(true);
    });
  }

  it("o exemplo do Damha, com o certo e o errado, está no prompt", () => {
    expect(base).toContain("Tenho algumas opções nos Damhas");
    expect(base).toMatch(/E n[ãa]o assim: "N[ãa]o achei Damha na nossa carteira/);
  });

  it("dizer que não tem continua PERMITIDO, e o prompt diz isso", () => {
    // Sem esta linha o modelo entende "nunca diga que não tem" e passa a
    // inventar imóvel para não decepcionar, que é muito pior.
    expect(base).toContain("DIZER QUE NÃO TEM CONTINUA VALENDO");
    expect(base).toContain("Não achei casa disponível no Centro");
  });

  it("o pedido do LINK é a resposta a quem veio de outro canal", () => {
    expect(base).toMatch(/link do an[úu]ncio/);
    expect(base).toContain("Messenger");
  });

  it("perguntada direto, ela NÃO nega ser uma IA", () => {
    // A regra é não NARRAR o sistema, nunca mentir sobre ele. Quem descobre
    // depois que foi enganado não volta, e nenhuma frase economizada paga isso.
    expect(base).toMatch(/se ela perguntar direto/i);
    expect(base).toMatch(/N[ÃA]O MINTA/);
  });
});

// ── MEDE, NÃO BLOQUEIA ────────────────────────────────────────────────────
//
// A tentação é trocar a mensagem inteira pela neutra. Seria repetir, com outra
// roupa, o defeito mais caro de mensagem-segura.ts: a resposta CERTA sumindo
// por causa de um padrão. Enquanto não houver medição de produção dizendo o
// contrário, a frase ruim sai e vira log.
describe("paraOCliente mede a fala de sistema sem descartar a resposta", () => {
  it("a frase do Damha ATRAVESSA, e não vira a resposta neutra", () => {
    const ruim = "Não achei Damha na nossa carteira, nem como condomínio nem como bairro.";
    expect(paraOCliente(ruim)).toBe(ruim);
  });

  it("o vazamento de infraestrutura continua sendo bloqueado", () => {
    expect(paraOCliente("[modo demo: configure a ANTHROPIC_API_KEY]")).not.toContain("ANTHROPIC");
  });
});

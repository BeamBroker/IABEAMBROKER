// O roteiro do seguro-fiança depois da inversão da ordem.
//
// Este arquivo existe porque a mudança é fácil de desfazer sem perceber: o
// roteiro antigo era coerente consigo mesmo — peneira antes de tudo, com uma
// seção ensinando a não ceder — e quem ler só um pedaço vai achar que a versão
// nova está frouxa. Não está: a peneira continua, só que na visita, que é onde
// o custo acontece.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { PEDIDO_APOS_ESCOLHA, PROMPT_SEGURO_FIANCA } from "./prompt-seguro-fianca";

const fonte = readFileSync("lib/prompt-seguro-fianca.ts", "utf8");

describe("a ordem que o roteiro ensina", () => {
  it("mostrar imóvel vem ANTES de pedir dado", () => {
    const mostrar = PROMPT_SEGURO_FIANCA.indexOf("MOSTRAR os imóveis");
    const pedir = PROMPT_SEGURO_FIANCA.indexOf("os cinco dados do seguro");
    expect(mostrar).toBeGreaterThan(-1);
    expect(pedir).toBeGreaterThan(mostrar);
  });

  it("diz explicitamente que foto e imóvel não dependem de simulação", () => {
    // A IA sob pressão inventa exigência quando o roteiro é ambíguo.
    expect(PROMPT_SEGURO_FIANCA).toMatch(/NÃO dependem de simulação nenhuma/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/não condicione imóvel a dado/);
  });

  it("a peneira sobreviveu: a VISITA continua exigindo aprovação", () => {
    expect(PROMPT_SEGURO_FIANCA).toMatch(/O QUE DEPENDE DE APROVAÇÃO É A VISITA/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/Marcar visita com simulação PENDENTE ou REPROVADA/);
  });

  it("a seção de 'não ceder' foi apagada — virou o fluxo normal", () => {
    // Era a seção que mandava resistir a quem pedia para ver antes. Hoje ver
    // antes é o caminho.
    expect(PROMPT_SEGURO_FIANCA).not.toMatch(/INSISTIR EM VER OS IMÓVEIS ANTES/);
    expect(PROMPT_SEGURO_FIANCA).not.toMatch(/Não ceda/);
  });

  it("o que restou de 'não' é sobre a visita, e é honesto", () => {
    expect(PROMPT_SEGURO_FIANCA).toMatch(/QUISER MARCAR A VISITA ANTES DE PASSAR OS DADOS/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/Não prometa "vou ver se consigo"/);
  });

  it("enquanto a simulação roda, a conversa continua viva", () => {
    // A simulação depende de uma pessoa e não tem prazo. Congelar a conversa
    // atrás dela é perder o cliente por espera.
    expect(PROMPT_SEGURO_FIANCA).toMatch(/Continue a conversa normalmente/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/O que você NÃO faz é marcar visita/);
  });
});

describe("a mensagem que pede os cinco dados", () => {
  it("explica ANTES de pedir — é o que impede o cliente de sumir", () => {
    const explicacao = PEDIDO_APOS_ESCOLHA.indexOf("seguro-fiança");
    const pedido = PEDIDO_APOS_ESCOLHA.indexOf("CPF");
    expect(explicacao).toBeGreaterThan(-1);
    expect(pedido).toBeGreaterThan(explicacao);
  });

  it("pede os cinco, nem mais nem menos", () => {
    for (const dado of ["Nome completo", "CPF", "Data de nascimento", "Telefone", "E-mail"])
      expect(PEDIDO_APOS_ESCOLHA, dado).toContain(dado);
  });

  it("fala do imóvel ESCOLHIDO, não da carteira", () => {
    // É a diferença entre a mensagem antiga e esta: lá o cliente não tinha
    // escolhido nada, então o texto falava das "opções" que ainda viriam.
    expect(PEDIDO_APOS_ESCOLHA).toMatch(/Boa escolha/);
    expect(PEDIDO_APOS_ESCOLHA).not.toMatch(/antes de te mandar as opções/);
  });

  it("não promete prazo, porque não há prazo", () => {
    // A simulação passa por uma pessoa da equipe. Prometer "cinco minutinhos" e
    // falhar é pior que não prometer nada.
    expect(PEDIDO_APOS_ESCOLHA).not.toMatch(/minutinho|minutos|rapidinho|na hora/);
  });

  it("antecipa a saída do reprovado — e é UMA só", () => {
    // A saída é outro titular da família, e nada além disso. "Falo com o
    // proprietário sobre outra garantia" saiu daqui: a imobiliária trabalha só
    // com seguro-fiança, e prometer uma conversa que ninguém está encarregado
    // de ter deixa o cliente esperando por nada.
    expect(PEDIDO_APOS_ESCOLHA).toMatch(/família/);
    expect(PEDIDO_APOS_ESCOLHA).not.toMatch(/outra garantia|proprietário/);
  });

  it("sem ninguém na família, o roteiro manda dizer que acabou", () => {
    expect(PROMPT_SEGURO_FIANCA).toMatch(/NÃO HOUVER NINGUÉM NA FAMÍLIA/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/única garantia que a imobiliária aceita/);
    // O que não pode: deixar a conversa em aberto com esperança que não existe.
    expect(PROMPT_SEGURO_FIANCA).toMatch(/NÃO prometa falar com o proprietário/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/esperando por um retorno que nunca vem/);
  });

  it("o titular do seguro não precisa ir à visita — só assinar o contrato", () => {
    expect(PROMPT_SEGURO_FIANCA).toMatch(/NÃO PRECISA SER QUEM VISITA/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/quem assina tem que ser o mesmo nome que foi aprovado/);
  });
});

describe("a dívida deixada para lib/seguro-fianca.ts", () => {
  it("está escrita no arquivo, não só na cabeça de quem mudou", () => {
    // `PEDIDO_DE_DADOS` ficou órfã e `AGUARDE` promete 5 minutos. Os dois são
    // de um arquivo de outra pessoa; a nota é o que evita virar surpresa.
    expect(fonte).toMatch(/Nota para quem mantém lib\/seguro-fianca\.ts/);
    expect(fonte).toMatch(/PEDIDO_DE_DADOS[\s\S]*órfã/);
    expect(fonte).toMatch(/AGUARDE[\s\S]*5 minutinhos/);
  });

  it("o motivo da inversão está no cabeçalho, com os três pontos", () => {
    // Sem isto a próxima pessoa desfaz achando que é sobra.
    expect(fonte).toMatch(/A ORDEM MUDOU/);
    expect(fonte).toMatch(/contradizia o que já está em produção/);
    expect(fonte).toMatch(/não tem prazo definido/);
    expect(fonte).toMatch(/é onde o cliente desconfia e some/);
  });
});

// Este describe existe por causa de um buraco de cobertura, não por zelo.
//
// `agentes-tools.test.ts:320` já proíbe nome de ferramenta de agenda no prompt
// de VENDAS — mas o slice dele vai de `const PROMPTS` até `ADMINISTRACAO:`, e
// portanto lê SÓ `agentes.ts`. Este arquivo é concatenado no mesmo system prompt
// (agentes.ts:4577) e escapava inteiro. Foi assim que o roteiro passou de 10/08
// a 18/08 mandando chamar `agendar_visita`, removida em 10/08.
//
// A asserção é sobre a CONSTANTE EXPORTADA, de propósito. O cabeçalho do arquivo
// documenta a decisão citando os nomes das ferramentas; ler o fonte faria o
// teste falhar no próprio comentário que registra o motivo — a armadilha que
// `semComentarios()` existe para contornar em saude-ia-tela.test.ts:24. Aqui não
// é preciso contornar: comentário não entra em template literal.
describe("o roteiro não cita ferramenta que VENDAS não alcança", () => {
  // As quatro saíram do alcance da IA em 10/08 (agentes.ts:3986-4005). Elas
  // continuam definidas em agentes.ts como código morto — o que este teste
  // protege é o roteiro MANDAR usá-las.
  const FORA_DO_ALCANCE = [
    "agendar_visita",
    "consultar_horarios_visita",
    "remarcar_visita",
    "cancelar_visita",
  ];

  it("nenhum nome de ferramenta de agenda aparece no roteiro", () => {
    for (const nome of FORA_DO_ALCANCE) {
      expect(PROMPT_SEGURO_FIANCA, `o roteiro manda usar ${nome}`).not.toContain(nome);
    }
  });

  it("nem na mensagem que a IA manda depois da escolha", () => {
    for (const nome of FORA_DO_ALCANCE) {
      expect(PEDIDO_APOS_ESCOLHA, `a mensagem cita ${nome}`).not.toContain(nome);
    }
  });

  it("o roteiro diz quem marca a visita, e não é a IA", () => {
    // Não basta remover o nome da ferramenta: sem dizer quem marca, o modelo
    // preenche o vazio sozinho — e prometer visita que ninguém agendou é pior
    // que não oferecer. O texto espelha agentes.ts:4601 de propósito: as duas
    // metades do mesmo system prompt precisam dizer a mesma coisa.
    expect(PROMPT_SEGURO_FIANCA).toMatch(/quem marca a visita é a EQUIPE/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/a equipe entra em contato para marcar a visita/);
    expect(PROMPT_SEGURO_FIANCA).toMatch(/não invente dia, não invente horário/);
  });
});

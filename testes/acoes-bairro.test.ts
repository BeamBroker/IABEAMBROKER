// O bairro que a pessoa falou e o bairro que está no cadastro.
//
// Caso real de 03/08, com o print da conversa: o cliente pediu apartamento até
// R$1.700 em "São Diocleciano". A carteira tem "Conjunto Habitacional São
// Deocleciano" com dois apartamentos DISPONÍVEIS, um deles a R$1.400. A Maitê
// respondeu que não tinha nada — e na mensagem seguinte citou "Santo
// Inocenciano", um bairro que não existe.
//
// Dois defeitos, não um: a busca não achou o que existia, e a IA preencheu o
// vazio com invenção em vez de perguntar.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  APELIDOS,
  bairrosParecidos,
  distancia,
  melhorBairro,
  nomeDoApelido,
  normalizar,
  regiaoCardinal,
  familiaDeBairros,
  nucleo,
  parecido,
  semLogradouro,
  termosDeRua,
} from "@/lib/acoes-bairro";

const CARTEIRA = [
  "Conjunto Habitacional São Deocleciano",
  "Nova Redentora",
  "Residencial Piavon",
  "Jardim das Flores",
  "Vila Toninho",
  "Centro",
];

const agentes = readFileSync("lib/agentes.ts", "utf8");
const voz = readFileSync("lib/voz.ts", "utf8");

describe("o caso que aconteceu", () => {
  it("acha o bairro certo com a letra trocada", () => {
    // Deocleciano com E no cadastro; o cliente escreveu com I.
    expect(melhorBairro("São Diocleciano", CARTEIRA)?.bairro).toBe(
      "Conjunto Habitacional São Deocleciano"
    );
  });

  it("acha sem o prefixo que ninguém fala", () => {
    // Ninguém diz "Conjunto Habitacional" no WhatsApp.
    expect(melhorBairro("deocleciano", CARTEIRA)?.bairro).toBe(
      "Conjunto Habitacional São Deocleciano"
    );
    expect(melhorBairro("são deocleciano", CARTEIRA)?.exato).toBe(true);
  });

  it("acha sem acento, como se digita no celular", () => {
    expect(melhorBairro("sao deocleciano", CARTEIRA)?.bairro).toContain("Deocleciano");
    expect(melhorBairro("vila toninho", CARTEIRA)?.exato).toBe(true);
  });

  it("aguenta o erro que a transcrição de áudio comete", () => {
    expect(melhorBairro("Sao Dioclesiano", CARTEIRA)?.bairro).toContain("Deocleciano");
  });

  it("o bairro INVENTADO continua não casando — e é isso que faz perguntar", () => {
    // Se isto casasse, a IA ofereceria imóvel de um bairro que o cliente não
    // pediu, o que é pior que não achar.
    expect(melhorBairro("Santo Inocenciano", CARTEIRA)).toBeNull();
  });

  it("quando não sabe, devolve os bairros que EXISTEM para perguntar", () => {
    const sugestoes = bairrosParecidos("Santo Inocenciano", CARTEIRA, 3);
    expect(sugestoes).toHaveLength(3);
    for (const s of sugestoes) expect(CARTEIRA).toContain(s);
  });
});

describe("não casar demais é tão importante quanto casar", () => {
  it("bairros diferentes continuam diferentes", () => {
    expect(parecido("Centro", "Nova Redentora")).toBe(false);
    expect(parecido("Piavon", "Vila Toninho")).toBe(false);
    expect(melhorBairro("Ipiranga", CARTEIRA)).toBeNull();
  });

  it("nome curto não tolera erro nenhum", () => {
    // Em "Sé" uma letra de diferença é outro bairro; em "Deocleciano" é um dedo
    // no teclado ao lado.
    expect(parecido("Sé", "Só")).toBe(false);
    expect(parecido("Bela", "Vela")).toBe(false);
  });

  it("palavra curta comum não casa sozinha", () => {
    // "São" e "das" aparecem em meio bairro do Brasil.
    expect(parecido("São Pedro", "São Deocleciano")).toBe(false);
    expect(parecido("Jardim", "Jardim das Flores")).toBe(false);
  });
});

describe("as peças", () => {
  it("normalizar tira acento sem comer letra", () => {
    expect(normalizar("São Deocleciano")).toBe("sao deocleciano");
    expect(normalizar("  Vila  Toninho! ")).toBe("vila toninho");
  });

  it("núcleo tira o genérico, e não devolve vazio", () => {
    expect(nucleo("Conjunto Habitacional São Deocleciano")).toBe("sao deocleciano");
    expect(nucleo("Jardim das Flores")).toBe("das flores");
    // Só genérico: melhor comparar demais que não ter o que comparar.
    expect(nucleo("Jardim")).toBe("jardim");
  });

  it("distância conta edições", () => {
    expect(distancia("deocleciano", "diocleciano")).toBe(1);
    expect(distancia("centro", "centro")).toBe(0);
    expect(distancia("", "abc")).toBe(3);
  });
});

describe("a busca da IA passa a resolver o bairro antes de filtrar", () => {
  const codigo = agentes
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");

  it("as TRÊS buscas de imóvel resolvem: locação, venda e a do corretor", () => {
    expect(codigo.match(/await resolverBairro\(/g) ?? []).toHaveLength(3);
  });

  it("nenhuma busca de IMÓVEL joga o texto cru do cliente no filtro", () => {
    // A de empreendimentos (`prisma.empreendimento`) fica de fora de propósito:
    // é outra tabela, o cadastro é feito pela própria imobiliária e a busca ali
    // é pelo NOME do empreendimento, não pelo bairro. Está anotado como
    // pendência em vez de disfarçado com uma asserção que não cobre nada.
    const buscasDeImovel = codigo
      .split("prisma.imovel.findMany")
      .slice(1)
      .map((t) => t.slice(0, 400))
      .join("\n");
    expect(buscasDeImovel).not.toMatch(/bairro: \{ contains: input\.bairro/);
  });

  it("sem certeza, manda PERGUNTAR — e proíbe as duas saídas erradas", () => {
    expect(agentes).toMatch(/NÃO invente nome de bairro e NÃO diga que não temos nada/);
    expect(agentes).toMatch(/ainda mais se veio de áudio/);
  });

  it("a lista sugerida vem da carteira, não da cabeça da IA", () => {
    expect(codigo).toMatch(/bairrosParecidos\(pedido, bairros, 4\)/);
    expect(codigo).toMatch(/distinct: \["bairro"\]/);
  });
});

describe("a cidade vem do cadastro, não da pergunta", () => {
  it("a IA é proibida de perguntar a cidade", () => {
    // Perguntar a cidade a quem fala com a imobiliária da própria cidade gasta
    // um turno e faz a IA parecer uma central que não sabe onde fica.
    expect(agentes).toMatch(/NUNCA pergunte em que cidade o cliente procura/);
    expect(agentes).toMatch(/imobiliariaCfg\.municipio/);
  });

  it("outra cidade é tratada, não ignorada", () => {
    expect(agentes).toMatch(/Só toque no assunto se ELE citar outra cidade/);
  });
});

describe("o áudio diz em que língua está", () => {
  it("manda language_code — sem isso o modelo adivinha e erra nome próprio", () => {
    expect(voz).toMatch(/form\.append\("language_code", "pt"\)/);
  });

  it("não deixa marcação de evento virar fala do cliente", () => {
    expect(voz).toMatch(/form\.append\("tag_audio_events", "false"\)/);
  });
});

// Apelido de rua: o que a pessoa fala e o que o cadastro escreve.
//
// Em Rio Preto ela diz "jk" e quer a Avenida Juscelino Kubitschek. O cadastro
// escreve "Avenida Presidente Juscelino K. de Oliveira" — abreviada — e o bairro
// daqueles imóveis é "Jardim Tarraf II". Nenhuma comparação de BAIRRO liga uma
// coisa à outra, então o apelido vira termo de busca no ENDEREÇO.
describe("apelido de rua vira termo de endereço", () => {
  it('"jk" procura pelo nome que está escrito no cadastro', () => {
    expect(termosDeRua("jk")).toContain("juscelino");
  });

  it("o tipo de logradouro não atrapalha: av jk, avenida JK, JK", () => {
    for (const dito of ["jk", "JK", "av jk", "avenida JK", "Avenida jk"])
      expect(termosDeRua(dito), dito).toContain("juscelino");
  });

  it("o termo abreviado do cadastro é alcançado", () => {
    // "juscelino kubitschek" NÃO é substring de "Juscelino K. de Oliveira": é
    // por isso que os termos são palavras soltas, não a frase inteira.
    const endereco = "Avenida Presidente Juscelino K. de Oliveira, 1890".toLowerCase();
    expect(termosDeRua("jk").some((t) => endereco.includes(t))).toBe(true);
  });

  it("quem escreve o nome por extenso chega no mesmo lugar", () => {
    const endereco = "Avenida Presidente Juscelino K. de Oliveira, 1890".toLowerCase();
    expect(termosDeRua("avenida juscelino kubitschek").some((t) => endereco.includes(t))).toBe(true);
  });

  it("pedaço curto NÃO vira busca — casa por acaso e manda pra rua errada", () => {
    // "sul" está dentro de "Setsul"; "jd" está dentro de qualquer "Jardim".
    expect(termosDeRua("sul")).toEqual([]);
    expect(termosDeRua("jd")).toEqual([]);
    expect(termosDeRua("av")).toEqual([]);
  });

  it("apelido desconhecido não inventa nada", () => {
    expect(nomeDoApelido("xyz")).toBeNull();
    expect(nomeDoApelido("jk")).toBe(APELIDOS.jk!.nome);
  });

  it("semLogradouro tira o tipo da via e mantém o nome", () => {
    expect(semLogradouro("Avenida Bady Bassitt")).toBe("bady bassitt");
    expect(semLogradouro("rua João")).toBe("joao");
  });
});

// ─── Região não é bairro (26/08) ────────────────────────────────────────────
//
// Segundo passo do mesmo atendimento que abriu a saída de área: "casa pra
// comprar até 200 mil na REGIÃO SUL". Nenhuma carteira grava "região sul" no
// campo bairro, então a comparação não achava nada e a busca terminava numa
// pergunta com 43 imóveis dentro do valor esperando na prateleira.
describe("regiaoCardinal", () => {
  it("reconhece as formas que a pessoa usa de verdade", () => {
    for (const dito of [
      "região sul",
      "regiao sul",
      "Região Sul",
      "zona sul",
      "lado sul da cidade",
      "sul da cidade",
      "na parte sul",
    ])
      expect(regiaoCardinal(dito), dito).toBe("sul");
    expect(regiaoCardinal("zona norte")).toBe("norte");
    expect(regiaoCardinal("região leste")).toBe("leste");
    expect(regiaoCardinal("lado oeste")).toBe("oeste");
  });

  it("NÃO confunde bairro que tem a palavra dentro", () => {
    // "Setsul" e "Sulina" existem na carteira do tenant 3; trocar um bairro real
    // por uma região imaginária é o erro que este arquivo inteiro evita. Por
    // isso a palavra qualificadora (região/zona/lado/parte) é obrigatória.
    for (const bairro of ["Setsul", "Sulina", "Vila Sul Americana", "Norte", "sul", "Solo Sagrado"])
      expect(regiaoCardinal(bairro), bairro).toBeNull();
  });

  it("não inventa região a partir de texto vazio ou solto", () => {
    expect(regiaoCardinal("")).toBeNull();
    expect(regiaoCardinal("perto do shopping")).toBeNull();
  });
});

// ─── FAMÍLIA DE CONDOMÍNIOS (26/08) ─────────────────────────────────────────
//
// Conversa de cliente real no tenant 3, lead de R$ 2,3 milhões:
//
//   cliente: "quero comprar uma casa no damha"
//   Maitê:   "Não achei Damha na nossa carteira, nem como condomínio nem como
//             bairro. Vou confirmar com a equipe se existe algo assim."
//
// Havia DOZE imóveis com Damha no bairro. Nenhum se chama "Damha": são Damha
// Fit, Damha III, Village Damha 3, Parque Residencial Damha IV, Damha VI. Quem
// diz o nome da marca quer todos eles.
describe("familiaDeBairros", () => {
  const CARTEIRA = [
    "Damha Fit",
    "Damha III Rio Preto",
    "Residencial Village Damha Rio Preto II",
    "Parque Residencial Damha IV",
    "Parque Residencial Damha VI",
    "Loteamento Village Damha Mirassol IV",
    "Centro",
    "Higienópolis",
    "Setsul",
    "Sulina",
  ];

  it("reconhece a marca que atravessa vários bairros", () => {
    const achado = familiaDeBairros("damha", CARTEIRA);
    expect(achado?.termo).toBe("damha");
    // Os SEIS bairros da marca, com o nome exato do cadastro. É esta lista que
    // vira filtro `in` — nunca um `contains` do termo, que arrastaria
    // "Damhazinho" junto.
    expect(achado?.bairros).toHaveLength(6);
    expect(achado?.bairros).toContain("Parque Residencial Damha IV");
    expect(achado?.bairros).not.toContain("Centro");
    expect(familiaDeBairros("Damha", CARTEIRA)?.termo).toBe("damha");
    expect(familiaDeBairros("região dos damha", CARTEIRA)?.termo).toBe("damha");
  });

  it("não inventa família a partir de um bairro só", () => {
    // Com um único candidato quem resolve é a comparação de nome, que devolve o
    // bairro certo em vez de um `contains` mais frouxo.
    expect(familiaDeBairros("higienopolis", CARTEIRA)).toBeNull();
    expect(familiaDeBairros("centro", CARTEIRA)).toBeNull();
  });

  it("NÃO casa por acaso de substring — a palavra tem que ser inteira", () => {
    // "sul" está dentro de Setsul e de Sulina. Se bastasse substring, pedir a
    // região sul devolveria dois bairros que não têm nada a ver.
    expect(familiaDeBairros("sul", CARTEIRA)).toBeNull();
    expect(familiaDeBairros("rio", CARTEIRA)).toBeNull(); // 3 letras: abaixo do corte
  });

  it("texto vazio ou só genérico não vira família", () => {
    expect(familiaDeBairros("", CARTEIRA)).toBeNull();
    expect(familiaDeBairros("jardim", CARTEIRA)).toBeNull();
  });
});

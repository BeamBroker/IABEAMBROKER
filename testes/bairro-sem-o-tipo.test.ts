// O bairro certo, o tipo errado — e o que a IA precisa saber para não perder a
// venda.
//
// O caso veio de produção duas vezes seguidas, com o mesmo cliente e o mesmo
// bairro. Na primeira, a Maitê disse que Higienópolis NÃO EXISTE na carteira
// (corrigido em `cbe5d53`). Na segunda, ela disse:
//
//   "Não achei casa à venda no Higienópolis, mas tenho algumas em outros
//    bairros dentro do seu valor, de R$270 mil a R$700 mil."
//
// Honesto e inútil: Higienópolis tinha 5 apartamentos e 1 cobertura à venda,
// todos dentro do orçamento, e o cliente nunca soube. A primeira correção só
// avisava quando a busca voltava VAZIA — e ali ela não voltou vazia, porque o
// plano B de proximidade encheu a lista com casas de outros bairros.
//
// POR QUE ESTE TESTE EXECUTA A FERRAMENTA, EM VEZ DE LER O ARQUIVO
//
// As tools nascem dentro de `toolsPorAgente`, e por isso os testes antigos
// conferiam o TEXTO do fonte. Teste de texto passa com o comportamento errado —
// aconteceu duas vezes aqui. Este roda o `run` de verdade, contra o banco, e lê
// o mesmo que a IA leria.
//
// O `@/lib/geo` é o único mock, e é obrigatório: ele geocodifica na Nominatim
// por HTTP. Sem mock o teste dependeria da internet e, pior, a distância voltaria
// vazia — o plano B de proximidade não rodaria e o cenário do bug (lista CHEIA
// de outro bairro) nunca seria reproduzido.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/geo", () => ({
  RAIO_PROXIMIDADE_KM: 2,
  // Todo candidato a 1 km: perto o bastante para entrar na lista.
  distanciasAoBairro: vi.fn(async (imoveis: unknown[]) => {
    const m = new Map<unknown, number>();
    for (const i of imoveis) m.set(i, 1);
    return m;
  }),
}));

import { prisma } from "@/lib/db";
import { toolsPorAgente } from "@/lib/agentes";

const MARCA = `bairro-tipo-${process.pid}`;
const BAIRRO = `${MARCA}-higienopolis`;
const VIZINHO = `${MARCA}-vizinho`;
// Bairro só do caso dos QUARTOS: mexer no BAIRRO de cima mudaria a premissa dos
// testes de tipo (lá o combinado é "não há casa nenhuma neste bairro").
const BAIRRO_3Q = `${MARCA}-tresquartos`;

let imobiliariaId = 0;
let conversa: Awaited<ReturnType<typeof prisma.conversa.create>>;

/** Roda a ferramenta pelo nome, como o modelo rodaria. */
async function rodar(agente: "COMPRA_VENDA" | "VENDAS", nome: string, input: unknown) {
  const mapa = await toolsPorAgente({
    conversa,
    modulos: ["ADM", "COMERCIAL", "CAPTACAO"],
    addons: [],
  } as never);
  const tool = (mapa as Record<string, Array<{ name: string; run: (i: unknown, x: unknown) => Promise<string> }>>)[
    agente
  ]!.find((t) => t.name === nome);
  if (!tool) throw new Error(`ferramenta ${nome} não existe em ${agente}`);
  return tool.run(input, {});
}

beforeAll(async () => {
  const imob = await prisma.imobiliaria.create({
    data: { nome: MARCA, municipio: "São José do Rio Preto", uf: "SP" },
  });
  imobiliariaId = imob.id;
  const inst = await prisma.instanciaWhatsApp.create({
    data: { imobiliariaId, nome: "teste" },
  });
  conversa = await prisma.conversa.create({
    data: {
      imobiliariaId,
      instanciaId: inst.id,
      contatoTelefone: `5517${String(Date.now()).slice(-8)}`,
      agente: "COMPRA_VENDA",
    },
  });

  const proprietario = await prisma.pessoa.create({
    data: { imobiliariaId, nome: "Dono", cpfCnpj: `${Date.now()}`.slice(-11), tipo: "FISICA" },
  });

  // No bairro pedido: só APARTAMENTO — nenhuma casa. É o caso real.
  for (const [i, valor] of [345_000, 420_000].entries()) {
    await prisma.imovel.create({
      data: {
        imobiliariaId,
        codigo: `${MARCA}-AP${i}`,
        tipo: "Apartamento",
        endereco: `Rua A, ${i}`,
        bairro: BAIRRO,
        cidade: "São José do Rio Preto",
        uf: "SP",
        finalidade: "VENDA",
        status: "DISPONIVEL",
        valorVenda: valor,
        valorSugerido: 2_000,
        latitude: -20.8,
        longitude: -49.4,
        proprietarioId: proprietario.id,
      },
    });
  }

  // TRÊS QUARTOS no bairro pedido, para o cliente que quer QUATRO não achar nada
  // ali — e mesmo assim ficar sabendo o que existe. É o caso de 26/08.
  for (const [i, valor] of [390_000, 410_000].entries()) {
    await prisma.imovel.create({
      data: {
        imobiliariaId,
        codigo: `${MARCA}-3Q${i}`,
        tipo: "Casa",
        endereco: `Rua Q, ${i}`,
        bairro: BAIRRO_3Q,
        cidade: "São José do Rio Preto",
        uf: "SP",
        finalidade: "VENDA",
        status: "DISPONIVEL",
        quartos: 3,
        valorVenda: valor,
        latitude: -20.8,
        longitude: -49.4,
        proprietarioId: proprietario.id,
      },
    });
  }

  // A FAMÍLIA "Damha": três bairros diferentes que compartilham a marca, mais um
  // que só se parece por substring e NÃO pode entrar.
  for (const [i, bairro] of [
    `${MARCA} Damha Fit`,
    `${MARCA} Parque Residencial Damha IV`,
    `${MARCA} Village Damha 3`,
  ].entries()) {
    await prisma.imovel.create({
      data: {
        imobiliariaId,
        codigo: `${MARCA}-DAMHA${i + 1}`,
        tipo: "Casa",
        endereco: `Rua D, ${i}`,
        bairro,
        cidade: "São José do Rio Preto",
        uf: "SP",
        finalidade: "VENDA",
        status: "DISPONIVEL",
        quartos: 4,
        valorVenda: 2_300_000,
        proprietarioId: proprietario.id,
      },
    });
  }
  await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo: `${MARCA}-NAODAMHA`,
      tipo: "Casa",
      endereco: "Rua X, 1",
      bairro: `${MARCA} Damhazinho do Norte`,
      cidade: "São José do Rio Preto",
      uf: "SP",
      finalidade: "VENDA",
      status: "DISPONIVEL",
      quartos: 4,
      valorVenda: 2_400_000,
      proprietarioId: proprietario.id,
    },
  });

  // O mesmo bairro, agora para ALUGAR: um apartamento e nenhuma casa. Fica
  // separado dos de venda de propósito — assim cada busca enxerga só a
  // finalidade dela, como na carteira de verdade.
  await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo: `${MARCA}-APLOC`,
      tipo: "Apartamento",
      endereco: "Rua A, 99",
      bairro: BAIRRO,
      cidade: "São José do Rio Preto",
      uf: "SP",
      finalidade: "LOCACAO",
      status: "DISPONIVEL",
      valorSugerido: 2_400,
      latitude: -20.8,
      longitude: -49.4,
      proprietarioId: proprietario.id,
    },
  });

  // A "JK": o cliente chama a avenida pelo apelido, o cadastro escreve o nome
  // abreviado, e o BAIRRO desses imóveis não tem nada a ver com nenhum dos dois.
  await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo: `${MARCA}-JK`,
      tipo: "Apartamento",
      endereco: "Avenida Presidente Juscelino K. de Oliveira, 1890",
      bairro: `${MARCA}-tarraf`,
      cidade: "São José do Rio Preto",
      uf: "SP",
      finalidade: "VENDA",
      status: "DISPONIVEL",
      valorVenda: 500_000,
      latitude: -20.82,
      longitude: -49.38,
      proprietarioId: proprietario.id,
    },
  });

  // A armadilha da Bady Bassitt: a AVENIDA de Rio Preto e um BAIRRO de mesmo
  // nome na cidade vizinha. Sem o apelido, a comparação de bairro casa com o
  // bairro e manda o cliente para outro município.
  await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo: `${MARCA}-AVBADY`,
      tipo: "Apartamento",
      endereco: "Avenida Bady Bassitt, 4000",
      bairro: `${MARCA}-boavista`,
      cidade: "São José do Rio Preto",
      uf: "SP",
      finalidade: "VENDA",
      status: "DISPONIVEL",
      valorVenda: 480_000,
      latitude: -20.82,
      longitude: -49.39,
      proprietarioId: proprietario.id,
    },
  });
  await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo: `${MARCA}-EVILLE`,
      tipo: "Casa",
      endereco: "Rodovia Transbrasiliana, sn",
      bairro: `Eville Bady Bassitt ${MARCA}`,
      cidade: "Bady Bassitt",
      uf: "SP",
      finalidade: "VENDA",
      status: "DISPONIVEL",
      valorVenda: 300_000,
      latitude: -20.92,
      longitude: -49.44,
      proprietarioId: proprietario.id,
    },
  });

  // Num bairro VIZINHO: a casa que o plano B de proximidade vai encontrar. É ela
  // que enchia a lista e fazia o aviso do bairro pedido nunca ser calculado.
  await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo: `${MARCA}-CS0`,
      tipo: "Casa",
      endereco: "Rua B, 10",
      bairro: VIZINHO,
      cidade: "São José do Rio Preto",
      uf: "SP",
      finalidade: "AMBOS",
      status: "DISPONIVEL",
      valorVenda: 700_000,
      valorSugerido: 3_000,
      latitude: -20.81,
      longitude: -49.41,
      proprietarioId: proprietario.id,
    },
  });
});

afterAll(async () => {
  await prisma.mensagem.deleteMany({ where: { conversa: { imobiliariaId } } });
  await prisma.conversa.deleteMany({ where: { imobiliariaId } });
  await prisma.instanciaWhatsApp.deleteMany({ where: { imobiliariaId } });
  await prisma.imovel.deleteMany({ where: { imobiliariaId } });
  await prisma.pessoa.deleteMany({ where: { imobiliariaId } });
  await prisma.imobiliaria.deleteMany({ where: { id: imobiliariaId } });
});

describe("COMPRA — o bairro tem o imóvel, só não é do tipo pedido", () => {
  it("avisa o que EXISTE no bairro pedido mesmo achando opção em outro bairro", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      tipo: "Casa",
      valorMaximo: 800_000,
      bairro: BAIRRO,
    });

    // O cenário do bug: a lista NÃO está vazia — veio a casa do bairro vizinho.
    // Sem isto o teste passaria pelo caminho antigo e não provaria nada.
    expect(r).toContain(`${MARCA}-CS0`);

    // O que faltava: dizer que naquele bairro há apartamento.
    expect(r).toContain(BAIRRO);
    expect(r).toMatch(/2 Apartamento/);
    // E continuar honesta sobre a casa, como o dono pediu.
    expect(r).toMatch(/Casa[\s\S]{0,40}NÃO tem/);
  });

  it("não inventa aviso quando o bairro pedido TEM o tipo pedido", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      tipo: "Apartamento",
      valorMaximo: 800_000,
      bairro: BAIRRO,
    });

    expect(r).toContain(`${MARCA}-AP0`);
    expect(r).not.toMatch(/NÃO tem mesmo/);
  });

  it("sem tipo pedido, nada muda — é a busca de sempre", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 800_000,
      bairro: BAIRRO,
    });

    expect(r).toContain(`${MARCA}-AP0`);
    expect(r).not.toMatch(/NÃO tem mesmo/);
  });
});

describe("LOCAÇÃO — mesma regra, mesmo motivo", () => {
  it("avisa que no bairro pedido o que há é de outro tipo", async () => {
    const r = await rodar("VENDAS", "buscar_imoveis_disponiveis", {
      tipo: "Casa",
      valorMaximo: 5_000,
      bairro: BAIRRO,
    });

    // A casa do vizinho entrou pela proximidade — a lista NÃO está vazia, que é
    // exatamente o caminho onde o aviso não saía.
    expect(r).toContain(`${MARCA}-CS0`);
    expect(r).toMatch(/1 Apartamento/);
    expect(r).toContain(BAIRRO);
  });
});

// O apelido da avenida, na busca de verdade.
//
// "jk" não se parece com nenhum bairro, então a busca desistia e mandava a Maitê
// perguntar "você quis dizer <quatro bairros aleatórios>?" — com apartamento
// cadastrado na avenida certa. Agora o apelido vira termo de ENDEREÇO e o bairro
// sai de onde os imóveis daquela rua realmente estão.
describe("apelido de rua: o cliente diz jk, o cadastro diz Juscelino K.", () => {
  it("acha o imóvel da avenida pelo apelido", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 800_000,
      bairro: "jk",
    });

    expect(r).toContain(`${MARCA}-JK`);
    // E não pode ter virado a pergunta de desistência.
    expect(r).not.toMatch(/Não existe nenhum bairro parecido/);
  });

  it("com o tipo de via junto também: 'av jk'", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 800_000,
      bairro: "av jk",
    });

    expect(r).toContain(`${MARCA}-JK`);
  });

  it("bairro que não existe MESMO continua virando pergunta", async () => {
    // A rede de segurança: inventar bairro é pior que perguntar, e o caminho da
    // pergunta não pode ter sido engolido pelo atalho da rua.
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 800_000,
      bairro: "Santo Inocenciano",
    });

    expect(r).toMatch(/Não existe nenhum bairro parecido/);
  });
});

describe("Bady Bassitt: a avenida daqui vence o bairro da cidade vizinha", () => {
  it("quem pede a Bady recebe o imóvel da AVENIDA, não o do outro município", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 800_000,
      bairro: "bady bassitt",
    });

    expect(r).toContain(`${MARCA}-AVBADY`);
    // O de Bady Bassitt-cidade não pode ser o resultado do bairro pedido.
    expect(r.split("\n")[0]).not.toContain(`${MARCA}-EVILLE`);
  });

  it("só 'bady' também", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 800_000,
      bairro: "bady",
    });

    expect(r).toContain(`${MARCA}-AVBADY`);
  });
});

// A REGIÃO da cidade, na busca de verdade.
//
// Conversa 329 do tenant 3, 26/08 11:13 BRT: "casa pra comprar até 200 mil na
// REGIÃO SUL". "região sul" não é bairro em carteira nenhuma, então a busca
// desistia e mandava a Maitê perguntar "é o Setsul? o Solo Sagrado?" — com 43
// imóveis dentro do valor esperando na prateleira. Agora a região DESLIGA o
// filtro de lugar (coordenada só existe em parte da carteira, filtrar por ela
// esconderia o resto) e a lista sai na hora, com a pergunta do bairro emendada.
describe("região da cidade não é bairro, e não pode travar a busca", () => {
  it("mostra a carteira e manda perguntar o bairro de referência", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      tipo: "Casa",
      valorMaximo: 800_000,
      bairro: "região sul",
    });

    // A lista veio. É isso que o cliente esperou e não recebeu.
    expect(r).toContain(`${MARCA}-CS0`);
    expect(r).not.toMatch(/Não existe nenhum bairro parecido/);
    // E a IA foi instruída a não mentir para nenhum dos dois lados.
    expect(r).toMatch(/REGIÃO SUL/);
    expect(r).toMatch(/qual bairro ou ponto de referência/);
    expect(r).toMatch(/PROIBIDO dizer que não temos imóveis na região sul/);
  });

  it("vale igual para locação", async () => {
    const r = await rodar("VENDAS", "buscar_imoveis_disponiveis", {
      valorMaximo: 5_000,
      bairro: "zona norte",
    });

    expect(r).not.toMatch(/Não existe nenhum bairro parecido/);
    expect(r).toMatch(/REGIÃO NORTE/);
  });

  it("bairro de verdade continua sendo bairro", async () => {
    // A guarda que impede a região de atropelar a carteira: o pedido só vira
    // região depois de a comparação de bairro não achar nome exato.
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 800_000,
      bairro: BAIRRO,
    });

    expect(r).toContain(`${MARCA}-AP0`);
    expect(r).not.toMatch(/ATENÇÃO: o cliente falou em REGIÃO/);
  });
});


// QUARTOS NÃO DECIDEM QUE BAIRRO EXISTE.
//
// Medido em produção em 26/08, 13:47 BRT, tenant 3, e é o MESMO bairro do topo
// deste arquivo cobrando pela segunda vez:
//
//   cliente: "quero com 4 quartos no higienopolis"
//   Maitê:   "É um desses aí que você quer: Centro, Parque Residencial Romano
//             Calil, Jardim Veneza ou Jardim Aclimação?"
//
// Higienópolis tem 6 imóveis à venda, de 285 a 650 mil, e NENHUM de 4 quartos.
// A lista de bairros que decide "este bairro existe?" herdava o filtro de
// quartos, então o bairro sumia dela e a IA respondia que ele não existia. A
// correção de 07/08 tirou tipo e preço dessa lista e esqueceu quartos e
// banheiros — o filtro mais estreito de todos (33 dos 468 à venda têm 4+).
describe("quartos não apagam o bairro do mapa", () => {
  it("o bairro pedido continua existindo mesmo sem imóvel do tamanho pedido", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      quartos: 4,
      bairro: BAIRRO_3Q,
    });

    // O defeito: a pergunta de desistência com quatro bairros aleatórios.
    expect(r).not.toMatch(/Não existe nenhum bairro parecido/);
    // E a resposta honesta: não tem de 4, mas tem estes de 3.
    expect(r).toMatch(/de 4 quartos[\s\S]{0,40}NÃO tem/);
    expect(r).toMatch(/de 3 quartos/);
    expect(r).toContain(BAIRRO_3Q);
  });

  it("com tipo E quartos juntos, o aviso fala dos dois", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      tipo: "Casa",
      quartos: 4,
      bairro: BAIRRO_3Q,
    });

    expect(r).not.toMatch(/Não existe nenhum bairro parecido/);
    expect(r).toMatch(/Casa de 4 quartos[\s\S]{0,40}NÃO tem/);
  });

  it("banheiros também não apagam o bairro", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      banheiros: 5,
      bairro: BAIRRO_3Q,
    });
    expect(r).not.toMatch(/Não existe nenhum bairro parecido/);
  });
});

// A MARCA QUE ATRAVESSA VÁRIOS BAIRROS, na busca de verdade.
//
// Cliente real, tenant 3, 26/08 13:17 — lead de R$ 2,3 milhões:
//
//   cliente: "quero comprar uma casa no damha"
//   Maitê:   "Não achei Damha na nossa carteira, nem como condomínio nem como
//             bairro. Vou confirmar com a equipe se existe algo assim."
//   cliente: "quero na regiao dos damhas / 4 quartos"
//   Maitê:   "Achei uma no Damha IV (...). Não tenho mais nenhuma nos outros
//             Damhas por enquanto."
//
// Doze imóveis com Damha no bairro, e ela ofereceu um. Escolher "o bairro mais
// parecido" devolve UM quando o cliente pediu a marca inteira.
describe("marca de condomínio traz a família toda, não um bairro só", () => {
  it("pedir a marca devolve imóveis de TODOS os bairros dela", async () => {
    const r = await rodar("COMPRA_VENDA", "buscar_imoveis_venda", {
      valorMaximo: 3_000_000,
      bairro: "damha",
    });

    // Os três Damhas do fixture, cada um com nome próprio no cadastro.
    expect(r).toContain(`${MARCA}-DAMHA1`);
    expect(r).toContain(`${MARCA}-DAMHA2`);
    expect(r).toContain(`${MARCA}-DAMHA3`);
    expect(r).not.toMatch(/Não existe nenhum bairro parecido/);
    // E não arrasta o bairro que só parece: o corte é por palavra inteira.
    expect(r).not.toContain(`${MARCA}-NAODAMHA`);
  });
});

// A CARTEIRA DE UM TENANT NÃO APARECE NO OUTRO — exercitado, não lido.
//
// Toda ferramenta da IA filtra por `ctx.conversa.imobiliariaId`, e a conversa
// nasce da INSTÂNCIA de WhatsApp: o número conectado é quem decide de quem é a
// carteira. Isto aqui existe porque essa promessa é fácil de quebrar sem
// perceber — em 26/08 a correção do "quartos apagam o bairro" mexeu justamente
// no objeto de filtro que carrega o tenant (`resolverBairro` desestrutura o
// `where` para relaxar exigências). Tirar uma chave a mais ali vaza a cidade
// inteira do vizinho sem erro nenhum, sem log nenhum.
//
// O `@/lib/geo` é mockado pelo mesmo motivo de `bairro-sem-o-tipo.test.ts`: sem
// isso a proximidade dependeria de HTTP para a Nominatim.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/geo", () => ({
  RAIO_PROXIMIDADE_KM: 2,
  distanciasAoBairro: vi.fn(async (imoveis: unknown[]) => {
    const m = new Map<unknown, number>();
    for (const i of imoveis) m.set(i, 1);
    return m;
  }),
}));

import { prisma } from "@/lib/db";
import { toolsPorAgente } from "@/lib/agentes";

const MARCA = `vaza-${process.pid}`;
const BAIRRO_A = `${MARCA}-bairro-da-casa`;
const BAIRRO_B = `${MARCA}-bairro-do-vizinho`;

let idA = 0;
let idB = 0;
let codigoB = "";
let conversaA: Awaited<ReturnType<typeof prisma.conversa.create>>;

async function rodar(nome: string, input: unknown, agente = "COMPRA_VENDA") {
  const mapa = await toolsPorAgente({
    conversa: conversaA,
    modulos: ["ADM", "COMERCIAL"],
    addons: ["CAPTACAO"],
  } as never);
  const tool = (
    mapa as Record<string, Array<{ name: string; run: (i: unknown, x: unknown) => Promise<string> }>>
  )[agente]!.find((t) => t.name === nome);
  if (!tool) throw new Error(`${nome} não existe em ${agente}`);
  return tool.run(input, {});
}

async function casa(imobiliariaId: number, dono: number, codigo: string, bairro: string) {
  await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo,
      tipo: "Casa",
      endereco: `Rua ${codigo}, 100`,
      bairro,
      cidade: "São José do Rio Preto",
      uf: "SP",
      finalidade: "AMBOS",
      status: "DISPONIVEL",
      quartos: 3,
      valorVenda: 300_000,
      valorSugerido: 2_000,
      latitude: -20.8,
      longitude: -49.4,
      proprietarioId: dono,
    },
  });
}

beforeAll(async () => {
  const a = await prisma.imobiliaria.create({
    data: { nome: `${MARCA}-A`, municipio: "São José do Rio Preto", uf: "SP" },
  });
  const b = await prisma.imobiliaria.create({
    data: { nome: `${MARCA}-B`, municipio: "São José do Rio Preto", uf: "SP" },
  });
  idA = a.id;
  idB = b.id;

  const inst = await prisma.instanciaWhatsApp.create({ data: { imobiliariaId: idA, nome: "linha A" } });
  conversaA = await prisma.conversa.create({
    data: {
      imobiliariaId: idA,
      instanciaId: inst.id,
      contatoTelefone: `5517${String(Date.now()).slice(-8)}`,
      agente: "COMPRA_VENDA",
    },
  });

  const donoA = await prisma.pessoa.create({
    data: { imobiliariaId: idA, nome: "Dono A", cpfCnpj: `${Date.now()}`.slice(-11), tipo: "FISICA" },
  });
  const donoB = await prisma.pessoa.create({
    data: { imobiliariaId: idB, nome: "Dono B", cpfCnpj: `${Date.now() + 1}`.slice(-11), tipo: "FISICA" },
  });

  await casa(idA, donoA.id, `${MARCA}-A1`, BAIRRO_A);
  codigoB = `${MARCA}-B1`;
  await casa(idB, donoB.id, codigoB, BAIRRO_B);
});

afterAll(async () => {
  for (const id of [idA, idB]) {
    await prisma.mensagem.deleteMany({ where: { conversa: { imobiliariaId: id } } });
    await prisma.conversa.deleteMany({ where: { imobiliariaId: id } });
    await prisma.instanciaWhatsApp.deleteMany({ where: { imobiliariaId: id } });
    await prisma.imovel.deleteMany({ where: { imobiliariaId: id } });
    await prisma.pessoa.deleteMany({ where: { imobiliariaId: id } });
    await prisma.imobiliaria.deleteMany({ where: { id } });
  }
});

describe("a IA só enxerga a carteira do tenant da linha de WhatsApp", () => {
  it("busca de VENDA sem filtro nenhum não traz imóvel do vizinho", async () => {
    const r = await rodar("buscar_imoveis_venda", {});
    expect(r).toContain(`${MARCA}-A1`);
    expect(r).not.toContain(codigoB);
    expect(r).not.toContain(BAIRRO_B);
  });

  it("busca de LOCAÇÃO sem filtro nenhum não traz imóvel do vizinho", async () => {
    const r = await rodar("buscar_imoveis_disponiveis", {}, "VENDAS");
    expect(r).toContain(`${MARCA}-A1`);
    expect(r).not.toContain(codigoB);
    expect(r).not.toContain(BAIRRO_B);
  });

  it("pedir o BAIRRO do vizinho não devolve a carteira dele", async () => {
    // O caminho que a correção de 26/08 tocou: a lista de bairros que decide
    // "este bairro existe?" é montada a partir do mesmo objeto de filtro.
    const r = await rodar("buscar_imoveis_venda", { bairro: BAIRRO_B });
    expect(r).not.toContain(codigoB);
    // E o bairro do vizinho não pode nem ser SUGERIDO: a pergunta de
    // desistência lista os bairros parecidos que existem — só os da casa.
    expect(r).not.toContain(BAIRRO_B);
  });

  it("a exigência relaxada continua sem abrir a porta do vizinho", async () => {
    // Quatro quartos não existem em lugar nenhum aqui: força o caminho que
    // relaxa o filtro e o aviso "o que tem no bairro".
    const r = await rodar("buscar_imoveis_venda", { quartos: 4, bairro: BAIRRO_A });
    expect(r).not.toContain(codigoB);
    expect(r).not.toContain(BAIRRO_B);
  });

  it("o código do imóvel do vizinho não vira foto enviada", async () => {
    const r = await rodar("enviar_fotos_imovel", { codigoImovel: codigoB });
    expect(r).toMatch(/não encontrad|não existe|nenhum/i);
    expect(r).not.toContain(BAIRRO_B);
  });
});

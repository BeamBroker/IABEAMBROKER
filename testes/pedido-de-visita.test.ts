// O PEDIDO DE VISITA É A ENTREGA — exercitado contra o banco.
//
// A decisão de 10/08 continua de pé: a IA não marca visita, quem marca é a
// equipe. O que faltava era a outra metade — alguém FICAR SABENDO. Até 26/08 a
// entrega ao corretor tinha um gatilho só, a ficha de qualificação completa, e a
// medição em produção daquele dia mostrou o resultado disso:
//
//   105 fichas abertas · 104 trabalhadas depois de o código existir · 0 completas
//   321 leads · 0 LEAD_DISTRIBUIDO · 0 AVISO_LEAD_CORRETOR
//
// São 15 perguntas (19 para casado), e ninguém chega à décima quinta antes de
// pedir para ver a casa. O gatilho existia num evento que nunca acontece.
//
// Roda o `run` de verdade, como `bairro-sem-o-tipo.test.ts` e pelo mesmo motivo:
// teste que lê o texto do arquivo passa com o comportamento errado.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// O único mock: o aviso manda WhatsApp de verdade. O que importa aqui é que ele
// FOI CHAMADO no instante do pedido — o envio em si é de `aviso-lead.test.ts`.
const avisarCorretorDoLead = vi.fn(async () => ({ feito: "enviado" as const, texto: "..." }));
vi.mock("@/lib/aviso-lead", () => ({
  avisarCorretorDoLead: (...a: unknown[]) => avisarCorretorDoLead(...(a as [])),
}));

import { prisma } from "@/lib/db";
import { toolsPorAgente } from "@/lib/agentes";

const MARCA = `visita-${process.pid}`;

let imobiliariaId = 0;
let imovelId = 0;
let codigoImovel = "";
let conversaCompra: Awaited<ReturnType<typeof prisma.conversa.create>>;
let conversaLocacao: Awaited<ReturnType<typeof prisma.conversa.create>>;

const TEL_COMPRA = `5517${String(Date.now()).slice(-8)}`;
const TEL_LOCACAO = `5516${String(Date.now()).slice(-8)}`;

async function rodar(
  conversa: typeof conversaCompra,
  agente: "COMPRA_VENDA" | "VENDAS",
  input: unknown
) {
  const mapa = await toolsPorAgente({
    conversa,
    modulos: ["ADM", "COMERCIAL"],
    addons: [],
  } as never);
  const tool = (
    mapa as Record<string, Array<{ name: string; run: (i: unknown, x: unknown) => Promise<string> }>>
  )[agente]!.find((t) => t.name === "passar_para_corretor");
  if (!tool) throw new Error(`passar_para_corretor não existe em ${agente}`);
  return tool.run(input, {});
}

const leadDeCompra = () =>
  prisma.lead.findFirstOrThrow({ where: { imobiliariaId, telefone: TEL_COMPRA } });

beforeAll(async () => {
  const imob = await prisma.imobiliaria.create({
    data: { nome: MARCA, municipio: "São José do Rio Preto", uf: "SP" },
  });
  imobiliariaId = imob.id;
  const inst = await prisma.instanciaWhatsApp.create({ data: { imobiliariaId, nome: "teste" } });
  conversaCompra = await prisma.conversa.create({
    data: { imobiliariaId, instanciaId: inst.id, contatoTelefone: TEL_COMPRA, agente: "COMPRA_VENDA" },
  });
  conversaLocacao = await prisma.conversa.create({
    data: { imobiliariaId, instanciaId: inst.id, contatoTelefone: TEL_LOCACAO, agente: "VENDAS" },
  });

  const dono = await prisma.pessoa.create({
    data: { imobiliariaId, nome: "Dono", cpfCnpj: `${Date.now()}`.slice(-11), tipo: "FISICA" },
  });
  codigoImovel = `${MARCA}-CS1`;
  const imovel = await prisma.imovel.create({
    data: {
      imobiliariaId,
      codigo: codigoImovel,
      tipo: "Casa",
      endereco: "Rua B, 10",
      bairro: `${MARCA}-bairro`,
      cidade: "São José do Rio Preto",
      uf: "SP",
      finalidade: "VENDA",
      status: "DISPONIVEL",
      valorVenda: 190_000,
      proprietarioId: dono.id,
    },
  });
  imovelId = imovel.id;
});

afterAll(async () => {
  await prisma.qualificacaoMcmv.deleteMany({ where: { lead: { imobiliariaId } } });
  await prisma.lead.deleteMany({ where: { imobiliariaId } });
  await prisma.conversa.deleteMany({ where: { imobiliariaId } });
  await prisma.instanciaWhatsApp.deleteMany({ where: { imobiliariaId } });
  await prisma.imovel.deleteMany({ where: { imobiliariaId } });
  await prisma.pessoa.deleteMany({ where: { imobiliariaId } });
  await prisma.imobiliaria.deleteMany({ where: { id: imobiliariaId } });
});

beforeEach(() => avisarCorretorDoLead.mockClear());

describe("sem lead não há a quem entregar", () => {
  it("manda registrar antes, em vez de falhar calada", async () => {
    const r = await rodar(conversaCompra, "COMPRA_VENDA", {});
    expect(r).toMatch(/NÃO entreguei/);
    expect(r).toMatch(/registrar_interesse_compra/);
    expect(avisarCorretorDoLead).not.toHaveBeenCalled();
  });
});

describe("COMPRA: a visita entrega o lead ao corretor", () => {
  beforeAll(async () => {
    await prisma.lead.create({
      data: {
        imobiliariaId,
        nome: "Julia Compradora",
        telefone: TEL_COMPRA,
        origem: "WHATSAPP",
        status: "NOVO",
        finalidade: "COMPRA",
        temperatura: "MORNO",
      },
    });
  });

  it("antes disso, pergunta do nome — restrição não financia", async () => {
    // A peneira que já valia para agendar continua valendo para entregar: é o
    // mesmo custo do outro lado (deslocamento, chave, agenda de alguém).
    const r = await rodar(conversaCompra, "COMPRA_VENDA", { codigoImovel });
    expect(r).toMatch(/NÃO entreguei ainda/);
    expect(r).toMatch(/Seu nome está limpo\?/);
    expect(avisarCorretorDoLead).not.toHaveBeenCalled();
  });

  it("com o nome limpo, entrega: lead QUENTE, nota na ficha e corretor avisado", async () => {
    const lead = await leadDeCompra();
    await prisma.qualificacaoMcmv.create({ data: { leadId: lead.id, nomeRestrito: false } });

    const r = await rodar(conversaCompra, "COMPRA_VENDA", {
      codigoImovel,
      observacao: "só pode depois das 18h",
    });

    // O que a IA lê: entrega feita, e o que ela pode dizer sem mentir.
    expect(r).toMatch(/Entregue ao corretor/);
    expect(r).toMatch(/NÃO invente data/);
    // O que o corretor recebe.
    expect(avisarCorretorDoLead).toHaveBeenCalledTimes(1);
    const depois = await leadDeCompra();
    expect(depois.temperatura).toBe("QUENTE");
    expect(depois.status).toBe("ATENDIMENTO");
    expect(depois.imovelId).toBe(imovelId);
    expect(depois.observacoes).toMatch(/pediu visita/);
    expect(depois.observacoes).toMatch(/só pode depois das 18h/);
  });

  it("rechamar não enche a ficha da mesma linha", async () => {
    // A ferramenta é rechamada a cada resposta que ainda fala de visita.
    await rodar(conversaCompra, "COMPRA_VENDA", { codigoImovel, observacao: "só pode depois das 18h" });
    const depois = await leadDeCompra();
    const vezes = (depois.observacoes ?? "").split("pediu visita").length - 1;
    expect(vezes).toBe(1);
  });

  it("restrição confirmada e sem outro titular: não entrega, oferece o caminho", async () => {
    const lead = await leadDeCompra();
    await prisma.qualificacaoMcmv.update({
      where: { leadId: lead.id },
      data: { nomeRestrito: true, nomeAlternativo: null },
    });

    const r = await rodar(conversaCompra, "COMPRA_VENDA", { codigoImovel });
    expect(r).toMatch(/NÃO entreguei/);
    expect(r).toMatch(/outra pessoa da FAMÍLIA/);
    expect(avisarCorretorDoLead).not.toHaveBeenCalled();
  });
});

describe("LOCAÇÃO: a peneira do seguro-fiança continua na visita", () => {
  beforeAll(async () => {
    await prisma.lead.create({
      data: {
        imobiliariaId,
        nome: "Inquilino",
        telefone: TEL_LOCACAO,
        origem: "WHATSAPP",
        status: "NOVO",
        finalidade: "LOCACAO",
        temperatura: "MORNO",
      },
    });
  });

  it("sem simulação aprovada, o corretor não é acionado", async () => {
    const r = await rodar(conversaLocacao, "VENDAS", {});
    expect(r).toMatch(/NÃO passei para o corretor/);
    expect(avisarCorretorDoLead).not.toHaveBeenCalled();
  });
});

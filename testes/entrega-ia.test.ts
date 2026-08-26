// A entrega do card pela IA, contra o BANCO.
//
// ─── O QUE ESTE ARQUIVO PROTEGE ─────────────────────────────────────────────
//
// Duas coisas, e a segunda é a que assusta.
//
// A primeira: chegando na fase de entrega, o card ganha dono, trava e evento —
// numa transação só. Card com dono e sem trava faz dois corretores ligarem para
// o mesmo cliente; com trava e sem dono, ninguém mexe e ninguém sabe de quem é.
//
// A segunda: a IA NUNCA reescreve card que já tem dono. Sem essa guarda, cada
// releitura da mesma conversa reentregaria o card e tiraria o cliente de quem
// estava atendendo — no meio da negociação, sem erro em log nenhum. É o tipo de
// defeito que só aparece na reunião de segunda, como "sumiu da minha carteira".

import { beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { criarNegocio, garantirFunil, moverFase } from "@/lib/negocios";
import { entregarNegocio } from "@/lib/entrega-ia";

const AGORA = new Date(2026, 7, 11, 10, 0);

let imob = 0;
let funil = 0;
let fases: { id: number; ordem: number; nome: string }[] = [];
let ana = 0;
let bruno = 0;

async function novoTenant() {
  const u = `${Date.now()}-${Math.floor(performance.now() * 1000)}`;
  imob = (await prisma.imobiliaria.create({ data: { nome: `ent-${u}` } })).id;

  const cria = async (nome: string) =>
    (
      await prisma.usuario.create({
        data: {
          imobiliariaId: imob, nome, email: `${nome}-${u}@local.dev`,
          senhaHash: "x:y", papel: "CORRETOR",
        },
      })
    ).id;
  ana = await cria("Ana");
  bruno = await cria("Bruno");

  await garantirFunil(imob);
  const f = await prisma.funil.findFirstOrThrow({
    where: { imobiliariaId: imob, nome: "Venda" },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  funil = f.id;
  fases = f.fases.map((x) => ({ id: x.id, ordem: x.ordem, nome: x.nome }));
}

async function comCotas() {
  for (const c of [ana, bruno]) {
    await prisma.cotaDistribuicao.create({
      data: { imobiliariaId: imob, corretorId: c, percentual: 50, ativo: true },
    });
  }
}

/** Um card da IA (sem dono) na fase pedida. */
async function card(ordem: number) {
  const n = await criarNegocio({
    imobiliariaId: imob, funilId: funil, faseId: fases[0]!.id, titulo: `Card ${ordem}`,
  });
  if (ordem > 0) await moverFase(n.id, fases[ordem]!.id);
  return n.id;
}

beforeEach(async () => {
  await novoTenant();
});

describe("a IA entrega quando o card chega na fase de entrega", () => {
  it("na Visita, o card ganha dono, trava e evento — os três", async () => {
    await comCotas();
    const id = await card(3); // Visita

    const r = await entregarNegocio(id, AGORA);
    expect(r.entregue).toBe(true);

    const n = await prisma.negocio.findUniqueOrThrow({
      where: { id },
      include: { eventos: true },
    });
    expect(n.responsavelId).not.toBeNull();
    // A trava é o que impede dois corretores no mesmo cliente. Ela existia no
    // schema e no card desde sempre, e nenhum código de produção a escrevia.
    expect(n.travadoPorId).toBe(n.responsavelId);
    expect(n.travadoAte).not.toBeNull();
    expect(n.travadoAte!.getTime()).toBeGreaterThan(AGORA.getTime());
    expect(n.eventos.some((e) => e.tipo === "ENTREGUE")).toBe(true);
  });

  it("o evento ENTREGUE não tem autor — não foi pessoa nenhuma", async () => {
    await comCotas();
    const id = await card(3);
    await entregarNegocio(id, AGORA);
    const ev = await prisma.eventoNegocio.findFirstOrThrow({
      where: { negocioId: id, tipo: "ENTREGUE" },
    });
    // Pôr o corretor que RECEBEU como autor diria que ele pegou o card, que é a
    // informação contrária à que aconteceu.
    expect(ev.autorId).toBeNull();
  });

  it("antes da fase de entrega, não entrega", async () => {
    await comCotas();
    const id = await card(1); // Qualificado
    const r = await entregarNegocio(id, AGORA);
    expect(r.entregue).toBe(false);
    const n = await prisma.negocio.findUniqueOrThrow({ where: { id } });
    expect(n.responsavelId).toBeNull();
  });

  it("depois da fase de entrega também entrega — o teto é piso, não igualdade", async () => {
    // Card movido à mão para Proposta e ainda sem dono precisa de dono também.
    await comCotas();
    const id = await card(4);
    expect((await entregarNegocio(id, AGORA)).entregue).toBe(true);
  });
});

describe("a IA não encosta em card que já tem dono", () => {
  it("card com dono não é reentregue", async () => {
    await comCotas();
    const id = await card(3);
    await entregarNegocio(id, AGORA);
    const primeiro = await prisma.negocio.findUniqueOrThrow({ where: { id } });

    // Segunda passada da mesma conversa — acontece a cada rodada do cron.
    const r = await entregarNegocio(id, new Date(AGORA.getTime() + 3_600_000));
    expect(r).toEqual({ entregue: false, porque: "já tem dono" });

    const depois = await prisma.negocio.findUniqueOrThrow({ where: { id } });
    expect(depois.responsavelId).toBe(primeiro.responsavelId);
    expect(depois.travadoAte).toEqual(primeiro.travadoAte);
  });

  it("não duplica o evento ENTREGUE nem o contador do rodízio", async () => {
    await comCotas();
    const id = await card(3);
    await entregarNegocio(id, AGORA);
    await entregarNegocio(id, AGORA);
    await entregarNegocio(id, AGORA);

    expect(
      await prisma.eventoNegocio.count({ where: { negocioId: id, tipo: "ENTREGUE" } })
    ).toBe(1);
    const total = await prisma.cotaDistribuicao.aggregate({
      where: { imobiliariaId: imob },
      _sum: { recebidos: true },
    });
    expect(total._sum.recebidos).toBe(1);
  });
});

describe("sem rodízio configurado, o card espera — não é jogado em alguém", () => {
  it("nenhuma cota ativa: não entrega e não inventa dono", async () => {
    // Caso real: imobiliária que ainda não mexeu em Configurações. Escolher
    // alguém a esmo daria um cliente a quem não é dele e nasceria o rodízio
    // torto; o card fica visível ao gestor na visão [IA].
    const id = await card(3);
    const r = await entregarNegocio(id, AGORA);
    expect(r).toEqual({ entregue: false, porque: "nenhum corretor no rodízio" });
    expect((await prisma.negocio.findUniqueOrThrow({ where: { id } })).responsavelId).toBeNull();
  });

  // INVERTEU EM 18/08/2026, por decisão do dono. A cota nasce com percentual 0
  // (lib/distribuicao.ts), então "todo mundo em zero" é a casa que ainda não
  // abriu a tela de cotas — não uma escolha de não distribuir. Prendendo o
  // comportamento antigo, este teste protegia o estado em que a Mellim Imóveis
  // ficou: 3 cotas em 0% e 97 leads sem dono nenhum.
  //
  // O que o describe promete continua valendo e está no teste acima: sem cota
  // ATIVA nenhuma, o card espera. O que mudou é só o significado do zero
  // quando existe gente cadastrada no rodízio.
  it("cota existente com percentual zero recebe: zero geral é rodízio igualitário", async () => {
    await prisma.cotaDistribuicao.create({
      data: { imobiliariaId: imob, corretorId: ana, percentual: 0, ativo: true },
    });
    const id = await card(3);
    expect((await entregarNegocio(id, AGORA)).entregue).toBe(true);
    expect((await prisma.negocio.findUniqueOrThrow({ where: { id } })).responsavelId).toBe(ana);
  });

  it("cota INATIVA em zero continua fora: desativar é a forma de sair do rodízio", async () => {
    await prisma.cotaDistribuicao.create({
      data: { imobiliariaId: imob, corretorId: ana, percentual: 0, ativo: false },
    });
    const id = await card(3);
    expect((await entregarNegocio(id, AGORA)).entregue).toBe(false);
  });
});

describe("a fase de entrega é dado, não constante", () => {
  it("movendo a marca para mais cedo, a IA entrega mais cedo", async () => {
    await comCotas();
    await prisma.faseFunil.updateMany({ where: { funilId: funil }, data: { entregaIa: false } });
    await prisma.faseFunil.update({ where: { id: fases[1]!.id }, data: { entregaIa: true } });

    const id = await card(1); // Qualificado, que agora É a entrega
    expect((await entregarNegocio(id, AGORA)).entregue).toBe(true);
  });

  it("renomear a fase não muda nada — a marca é que manda", async () => {
    await comCotas();
    await prisma.faseFunil.update({
      where: { id: fases[3]!.id },
      data: { nome: "Vistoria" },
    });
    const id = await card(3);
    const r = await entregarNegocio(id, AGORA);
    expect(r.entregue).toBe(true);
    if (r.entregue) expect(r.fase).toBe("Vistoria");
  });
});

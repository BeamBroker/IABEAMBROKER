// A hora em que a IA solta o card e um humano assume.
//
// ─── O PEDIDO ───────────────────────────────────────────────────────────────
//
// Do dono, em 10/08: a IA trabalha o pipeline sozinha "até a hora dela". A hora
// dela é a fase marcada com `entregaIa` — a Visita, no funil padrão. Chegando
// ali, o card precisa de DONO: negócio sem dono na coluna de visita é uma
// visita que ninguém vai fazer.
//
// ─── AS TRÊS COISAS QUE ACONTECEM JUNTAS, E POR QUE JUNTAS ──────────────────
//
//   1. o card ganha `responsavelId`;
//   2. o card ganha TRAVA (`travadoPorId` + `travadoAte`);
//   3. fica um evento `ENTREGUE` na linha do tempo.
//
// Numa transação só. Separadas, uma falha no meio deixa o pior estado possível:
// card com dono e sem trava (dois corretores ligam), ou com trava e sem dono
// (ninguém consegue mexer e ninguém sabe de quem é).
//
// A TRAVA reaproveita `travadoPorId`/`travadoAte`, que até 11/08 eram campos
// LIDOS pelo card e escritos por ninguém a não ser o botão manual. Aqui eles
// ganham o segundo escritor, e é o uso que o desenho previa: "estou com este
// cliente agora", dito pelo sistema no momento em que ele entrega.
//
// ─── A GUARDA QUE IMPORTA ───────────────────────────────────────────────────
//
// A IA NUNCA escreve em card que já tem dono. Sem isto, uma releitura da mesma
// conversa reentregaria o card e tiraria o cliente de quem já estava atendendo
// — silenciosamente, no meio de uma negociação.

import { prisma } from "@/lib/db";
import { escolherCorretor } from "@/lib/distribuicao";
import { HORAS_DE_TRAVA, indiceDeEntrega } from "@/lib/negocios";

export type ResultadoEntrega =
  | { entregue: true; corretorId: number; fase: string }
  | { entregue: false; porque: string };

/**
 * Entrega o negócio a um corretor, se ele chegou na fase de entrega.
 *
 * Idempotente: card já entregue (com dono) devolve `entregue: false` sem tocar
 * em nada. É o que permite chamá-la a cada sincronização da conversa sem
 * precisar lembrar se já rodou.
 *
 * `agora` entra por parâmetro para o teste não depender do relógio.
 */
export async function entregarNegocio(
  negocioId: number,
  agora: Date = new Date()
): Promise<ResultadoEntrega> {
  const negocio = await prisma.negocio.findUnique({
    where: { id: negocioId },
    select: {
      id: true,
      imobiliariaId: true,
      responsavelId: true,
      titulo: true,
      // Para o relógio do SLA casar o card com a ficha do lead — ver o fim
      // desta função e a nota sobre a FK que não existe.
      contatoTelefone: true,
      fase: { select: { ordem: true, nome: true } },
      funil: { select: { fases: { orderBy: { ordem: "asc" }, select: { entregaIa: true } } } },
    },
  });
  if (!negocio) return { entregue: false, porque: "negócio não existe" };

  // A guarda. Primeira coisa depois de existir, antes de qualquer conta: nada
  // aqui pode passar por cima de um atendimento em andamento.
  if (negocio.responsavelId != null)
    return { entregue: false, porque: "já tem dono" };

  const teto = indiceDeEntrega(negocio.funil.fases);
  if (negocio.fase.ordem < teto)
    return { entregue: false, porque: `ainda em "${negocio.fase.nome}", antes da entrega` };

  // O MESMO rodízio dos leads (lib/distribuicao.ts), não uma segunda régua.
  // Duas filas de distribuição na mesma casa produzem duas ideias diferentes de
  // "de quem é a vez", e a conversa que isso gera na reunião não tem resposta.
  //
  // `finalidades` vazio = atende tudo. Um negócio do quadro é sempre de venda,
  // então cota restrita a LOCACAO não entra.
  const cotas = await prisma.cotaDistribuicao.findMany({
    where: {
      imobiliariaId: negocio.imobiliariaId,
      ativo: true,
      OR: [{ finalidades: { isEmpty: true } }, { finalidades: { has: "COMPRA" } }],
    },
  });

  const corretorId = escolherCorretor(
    cotas.map((c) => ({
      corretorId: c.corretorId,
      percentual: c.percentual,
      recebidos: c.recebidos,
      ultimoEm: c.ultimoEm,
    }))
  );
  // Ninguém elegível é caso REAL: imobiliária que ainda não configurou cotas.
  // O card fica sem dono na coluna de entrega, visível para o gestor na visão
  // [IA], que é melhor que atribuir a alguém escolhido a esmo — o corretor
  // receberia um cliente que não é dele e o rodízio nasceria torto.
  if (!corretorId) return { entregue: false, porque: "nenhum corretor no rodízio" };

  await prisma.$transaction([
    prisma.negocio.update({
      where: { id: negocio.id },
      data: {
        responsavelId: corretorId,
        travadoPorId: corretorId,
        travadoAte: new Date(agora.getTime() + HORAS_DE_TRAVA * 3_600_000),
      },
    }),
    prisma.cotaDistribuicao.update({
      where: { corretorId },
      data: { recebidos: { increment: 1 }, ultimoEm: agora },
    }),
    prisma.eventoNegocio.create({
      data: {
        negocioId: negocio.id,
        tipo: "ENTREGUE",
        titulo: "Entregue pela IA",
        // Sem `autorId`: não foi pessoa nenhuma. A linha do tempo mostra "—" no
        // autor, e é a verdade — atribuir ao corretor que RECEBEU faria parecer
        // que ele pegou o card, que é exatamente a informação contrária.
        detalhe: `Chegou em "${negocio.fase.nome}" e foi para o corretor ${corretorId} (rodízio).`,
      },
    }),
  ]);

  // ─── O RELÓGIO DO SLA, TAMBÉM AQUI ────────────────────────────────────────
  //
  // Quarto dos cinco caminhos de entrega, e um dos três que até 26/08 não
  // carimbavam nada: o card ganhava dono, a trava e o evento na timeline, e
  // ninguém sabia em que instante o cliente passou a esperar uma pessoa.
  //
  // O casamento é POR TELEFONE, e é uma ponte temporária: `Negocio` não tem FK
  // para `Lead` (dívida A3 do plano mestre). `registrarPassagemPorTelefone`
  // recusa telefone ambíguo em vez de chutar — ver lib/passagem.ts.
  //
  // Fora da transação e sem `await` que derrube a entrega: o card já está
  // entregue e o relógio é métrica. `registrarPassagem` não lança por
  // construção, mas o `.catch` é a segunda tranca, no mesmo desenho de
  // `distribuicao.ts`.
  const { registrarPassagemPorTelefone } = await import("@/lib/passagem");
  await registrarPassagemPorTelefone({
    imobiliariaId: negocio.imobiliariaId,
    telefone: negocio.contatoTelefone,
    gatilho: "CRM",
    corretorId,
    agora,
  }).catch((e) => console.error("[entrega-ia] relógio do SLA não aberto:", e));

  return { entregue: true, corretorId, fase: negocio.fase.nome };
}

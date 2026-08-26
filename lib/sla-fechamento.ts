// O fechamento do relógio: o vendedor respondeu, e em quanto tempo.
//
// ─── A REGRA QUE DECIDE UM NÚMERO, E POR ISSO PRECISA ESTAR ESCRITA ─────────
//
// **Só `ATENDENTE` fecha o SLA do vendedor. `IA` não.** Se a resposta automática
// da assistente fechasse o relógio, o follow-up de 1 hora fecharia o SLA de
// todo mundo sozinho e a casa inteira teria 100% — medindo, no fim, a
// pontualidade de um cron. É a mesma distinção que o schema já documenta em
// `Conversa.primeiraRespostaIaEm` × `primeiraRespostaHumanaEm`: "com IA mede o
// cliente esperando, só ATENDENTE mede o corretor".
//
// ─── DUAS FONTES, E A SEGUNDA É A QUE SALVA ────────────────────────────────
//
//  1. NO ATO, pelo webhook (`fecharSlaPorTelefone`), quando o corretor digita do
//     celular. É o caminho normal e o que dá o carimbo mais preciso.
//  2. NA VARREDURA, pelo cron `crm` (`fecharSlasPendentes`), porque o corretor
//     também responde pelo painel (`registrarRespostaEquipe`), pelo número da
//     casa, e porque webhook se perde. Sem a rede de segurança, um evento
//     perdido vira "esse vendedor nunca respondeu" para sempre.
//
// ─── O QUE ESTE MÓDULO NÃO CONSEGUE SABER (levar ao cliente) ───────────────
//
// QUEM respondeu. `Mensagem` não tem autor-usuário — o enum é
// `CLIENTE | IA | ATENDENTE` e mais nada. O relógio fecha quando ALGUÉM DA CASA
// respondeu àquele contato, não quando o vendedor dono do lead respondeu. Numa
// casa onde todo mundo atende pelo número central, o painel mede a casa, não a
// pessoa. A ponte que existiria — `Conversa.instanciaId →
// InstanciaWhatsApp.usuarioId` — só serve para quem conectou número próprio, e
// por isso ela NÃO é usada aqui como filtro: usá-la faria o relógio parar de
// fechar justamente nas casas de número único, transformando um limite de
// implantação num falso "ninguém respondeu".
//
// E o corretor que LIGA em vez de mandar mensagem não é visto por nenhuma das
// duas fontes. Não há heurística aqui para adivinhar isso, de propósito — ver
// o cabeçalho de lib/sla-vendedor.ts.
//
// ─── PRÉ-REQUISITO DE BUILD ────────────────────────────────────────────────
//
// `prisma.slaLead` exige `prisma generate` sobre a migration
// 20260827090000_sla_do_vendedor.

import { prisma } from "@/lib/db";
import { sufixoTelefone } from "@/lib/match";

export type ResultadoFechamento = {
  abertos: number;
  fechados: number;
};

/** Janela da varredura. Passagem aberta há mais de 30 dias não vai ser fechada
 *  por uma mensagem de hoje: aquilo já não é atraso, é entulho — e casar as
 *  duas coisas produziria "respondeu em 27 dias" no p95 de alguém que trocou de
 *  emprego. Mesmo número e mesmo motivo de `lib/follow-detectado.ts`. */
const DIAS_JANELA = 30;

type Aberto = {
  id: number;
  leadId: number;
  passouEm: Date;
  encerradoEm: Date | null;
  lead: { telefone: string | null };
};

/** Fecha uma linha, calculando `segundosResposta` no ato.
 *
 *  A conta é feita AQUI e gravada, e não recalculada na tela por SQL, pelo
 *  motivo registrado no schema: sobre duas colunas anuláveis, o "não respondeu"
 *  some da média por acidente. E porque subtração de `timestamp without time
 *  zone` no banco é onde o deslocamento de 3h do driver `pg` entra sem ninguém
 *  ver — em ms entre dois `Date`, fuso não existe.
 *
 *  `updateMany` com `respondidoEm: null` no WHERE: duas passadas simultâneas do
 *  cron, ou o webhook e o cron ao mesmo tempo, não podem reescrever um carimbo
 *  já gravado com uma resposta mais tardia. Mesma trava condicional de
 *  `lib/aviso-lead.ts:252-256`. */
async function fechar(id: number, passouEm: Date, quando: Date): Promise<boolean> {
  const segundos = Math.round((quando.getTime() - passouEm.getTime()) / 1000);
  // Negativo é evento fora de ordem. Não fecha: zerar mentiria para baixo no
  // p50, fabricando um atendimento instantâneo que nunca aconteceu.
  if (segundos < 0) return false;
  const { count } = await prisma.slaLead.updateMany({
    where: { id, respondidoEm: null },
    data: { respondidoEm: quando, segundosResposta: segundos },
  });
  return count > 0;
}

/** As passagens sem resposta desta casa, com o telefone do lead. Conjunto
 *  pequeno por natureza — são os leads passados e não respondidos, não a tabela
 *  de mensagens. */
async function abertosDaCasa(imobiliariaId: number, desde: Date): Promise<Aberto[]> {
  return prisma.slaLead.findMany({
    where: { imobiliariaId, respondidoEm: null, passouEm: { gte: desde } },
    select: {
      id: true,
      leadId: true,
      passouEm: true,
      encerradoEm: true,
      lead: { select: { telefone: true } },
    },
    orderBy: { passouEm: "desc" },
  });
}

/**
 * O corretor acabou de escrever para este telefone — fecha o relógio dele.
 *
 * Chamado pelo webhook logo depois de gravar a `Mensagem{ATENDENTE}`, com o
 * instante da mensagem. Não lança: um relógio que não fecha aqui é fechado pela
 * varredura do cron; uma exceção subindo daqui derruba o webhook do WhatsApp.
 *
 * Fecha a passagem ABERTA mais recente cujo `passouEm` seja anterior à
 * mensagem. "Mais recente" importa quando o lead trocou de mão: a resposta é do
 * dono atual, e a linha do dono anterior já está com `encerradoEm` — ela só
 * aceita mensagem anterior àquele instante.
 */
export async function fecharSlaPorTelefone(p: {
  imobiliariaId: number;
  telefone: string | null;
  quando: Date;
}): Promise<boolean> {
  const alvo = sufixoTelefone(p.telefone);
  if (!alvo) return false;
  try {
    const desde = new Date(p.quando.getTime() - DIAS_JANELA * 24 * 3_600_000);
    const abertos = await abertosDaCasa(p.imobiliariaId, desde);
    const candidato = abertos.find(
      (a) =>
        sufixoTelefone(a.lead.telefone) === alvo &&
        a.passouEm <= p.quando &&
        (a.encerradoEm == null || p.quando <= a.encerradoEm)
    );
    if (!candidato) return false;
    return await fechar(candidato.id, candidato.passouEm, p.quando);
  } catch (e) {
    console.error("[sla] fechamento no webhook falhou:", e);
    return false;
  }
}

/**
 * A rede de segurança: varre as passagens ainda abertas e fecha as que já têm
 * resposta humana na conversa.
 *
 * Roda no cron `crm`, ao lado de `detectarFollowsFeitos` — que já varre
 * `Mensagem` pelo mesmo motivo e com a mesma técnica de casamento. Colocar as
 * duas no mesmo cron não é economia: é a garantia de que a tarefa fechada e o
 * SLA fechado enxergam o mesmo conjunto de mensagens.
 *
 * ─── O CASAMENTO LEAD ↔ CONVERSA, E O QUE ELE ESPERA DO A2 ────────────────
 *
 * A ponte correta é `Conversa.leadId`. Ela existe no schema e está vazia em
 * produção (medido: 0 de 128 conversas). Enquanto o backfill não roda, o
 * casamento cai nos 8 dígitos finais do telefone — a mesma régua e o mesmo
 * motivo de `lib/follow-detectado.ts:64-69`. `Conversa.contatoChave` e
 * `Lead.telefoneChave`, que o schema promete "mantidas por gatilho", continuam
 * NULL porque o gatilho não existe; usá-las seria não casar nada, calado.
 *
 * Os dois caminhos convivem: `leadId` quando houver, sufixo quando não. Quando
 * o backfill do A2 rodar, o segundo vira redundância barata, não lixo.
 */
export async function fecharSlasPendentes(opcoes?: {
  imobiliariaId?: number;
  agora?: Date;
  teto?: number;
}): Promise<ResultadoFechamento> {
  const agora = opcoes?.agora ?? new Date();
  const desde = new Date(agora.getTime() - DIAS_JANELA * 24 * 3_600_000);

  const abertos = await prisma.slaLead.findMany({
    where: {
      respondidoEm: null,
      passouEm: { gte: desde },
      ...(opcoes?.imobiliariaId ? { imobiliariaId: opcoes.imobiliariaId } : {}),
    },
    select: {
      id: true,
      leadId: true,
      imobiliariaId: true,
      passouEm: true,
      encerradoEm: true,
      lead: { select: { telefone: true } },
    },
    orderBy: { passouEm: "asc" },
    take: opcoes?.teto ?? 300,
  });
  if (abertos.length === 0) return { abertos: 0, fechados: 0 };

  // Uma consulta para todas as conversas envolvidas, não uma por passagem.
  const tenants = [...new Set(abertos.map((a) => a.imobiliariaId))];
  const conversas = await prisma.conversa.findMany({
    where: { imobiliariaId: { in: tenants }, simulacao: false },
    select: { id: true, imobiliariaId: true, contatoTelefone: true, leadId: true },
  });
  const porLead = new Map<number, number[]>();
  const porChave = new Map<string, number[]>();
  for (const c of conversas) {
    if (c.leadId != null) porLead.set(c.leadId, [...(porLead.get(c.leadId) ?? []), c.id]);
    const sufixo = sufixoTelefone(c.contatoTelefone);
    if (!sufixo) continue;
    const k = `${c.imobiliariaId}:${sufixo}`;
    porChave.set(k, [...(porChave.get(k) ?? []), c.id]);
  }

  let fechados = 0;
  for (const a of abertos) {
    const sufixo = sufixoTelefone(a.lead.telefone);
    const ids = [
      ...new Set([
        ...(porLead.get(a.leadId) ?? []),
        ...(sufixo ? (porChave.get(`${a.imobiliariaId}:${sufixo}`) ?? []) : []),
      ]),
    ];
    if (ids.length === 0) continue;

    // A primeira resposta HUMANA depois da passagem — e, quando o lead já
    // trocou de mão, antes de ele sair da mão deste vendedor.
    const resposta = await prisma.mensagem.findFirst({
      where: {
        conversaId: { in: ids },
        autor: "ATENDENTE",
        criadaEm: { gt: a.passouEm, ...(a.encerradoEm ? { lte: a.encerradoEm } : {}) },
      },
      select: { criadaEm: true },
      orderBy: { criadaEm: "asc" },
    });
    if (!resposta) continue;
    if (await fechar(a.id, a.passouEm, resposta.criadaEm)) fechados++;
  }

  return { abertos: abertos.length, fechados };
}

// A cadência que faz a atividade nascer sozinha.
//
// O QUE ESTAVA ERRADO ATÉ AQUI. A aba Atividades mostrava só o que alguém
// digitou no formulário do negócio — medido em 12/08: 91 atividades no banco,
// todas em três blocos de carga, nenhuma criada no uso do dia a dia. O quadro
// tinha 254 negócios abertos e ninguém sendo lembrado de tocar em nenhum.
//
// A cadência de `lib/followup.ts` não resolve isso e não deve: ela fala com o
// CLIENTE pelo WhatsApp (1h, dia seguinte, 3º dia). Esta aqui fala com o
// CORRETOR — é tarefa na agenda dele, não mensagem para o cliente. Por isso os
// intervalos são outros e a unidade é dia, não hora.
//
// Sem Prisma de propósito: cada número abaixo é uma regra de negócio ("três
// dias parado é esquecimento"), e regra que não dá para testar sem banco é
// regra que ninguém confere.

/** Degraus da cadência, em HORAS desde o último contato conhecido do negócio.
 *
 *  1 dia → +3 dias → +7 dias. Três degraus pelo mesmo motivo que o follow-up do
 *  cliente tem três (decisão do dono em 01/08): a quarta cobrança não traz
 *  resposta, traz bloqueio. Aqui o efeito é outro — a quarta tarefa não é
 *  ignorada pelo cliente, é ignorada pelo corretor, e uma lista de tarefas que
 *  o corretor aprendeu a ignorar vale menos que uma lista vazia. */
export const CADENCIA_ATIVIDADES_HORAS = [24, 72, 168];

export const TOTAL_DEGRAUS = CADENCIA_ATIVIDADES_HORAS.length;

/** O que a tarefa pede, por degrau. Escala o meio, não o tom: o texto é para o
 *  corretor ler na correria, então diz o VERBO primeiro. */
const TITULO_POR_DEGRAU = [
  "Ligar para retomar o contato",
  "Mandar mensagem — 3 dias sem resposta",
  "Última tentativa antes de esfriar",
];

const TIPO_POR_DEGRAU = ["LIGACAO", "TAREFA", "TAREFA"] as const;

export type TipoDaCadencia = (typeof TIPO_POR_DEGRAU)[number];

export type NegocioParaCadencia = {
  id: number;
  /** Quando o card entrou na fase atual. */
  faseDesde: Date;
  /** Quantas atividades automáticas já nasceram para este negócio. */
  degrausJaCriados: number;
  /** Tem tarefa PENDENTE agora? Com uma aberta, a cadência não empilha outra. */
  temPendente: boolean;
  /** O contato mais recente que o sistema conhece: última mensagem trocada no
   *  WhatsApp, última atividade concluída, ou nada. */
  ultimoContatoEm: Date | null;
};

export type AtividadeSugerida = {
  negocioId: number;
  titulo: string;
  tipo: TipoDaCadencia;
  quando: Date;
  explicacao: string;
};

const HORA = 3_600_000;

// ─── Horário comercial ──────────────────────────────────────────────────────
//
// NÃO importa de lib/followup.ts de propósito: aquele módulo puxa Prisma,
// WhatsApp e auditoria junto, e este aqui existe para ser testável sem nada
// disso. A janela também é OUTRA — lá é "quando a Maitê pode mandar mensagem
// para o cliente" (inclui sábado de manhã e estica até 21h no primeiro toque);
// aqui é "quando o corretor está trabalhando". Fundir as duas faria a mudança
// de uma mexer na outra sem ninguém perceber.
const TZ_OFFSET_MS = 3 * HORA; // America/Sao_Paulo, UTC-3 fixo (o Brasil não tem DST)
const ABRE = 9;
const FECHA = 18;

function partesSP(d: Date) {
  const sp = new Date(d.getTime() - TZ_OFFSET_MS);
  return {
    dia: sp.getUTCDay(),
    hora: sp.getUTCHours(),
    y: sp.getUTCFullYear(),
    mo: sp.getUTCMonth(),
    da: sp.getUTCDate(),
  };
}

function emSP(y: number, mo: number, da: number, h: number): Date {
  return new Date(Date.UTC(y, mo, da, h, 0, 0) + TZ_OFFSET_MS);
}

/** Empurra o instante para o próximo horário em que existe alguém para atender.
 *
 *  Tarefa marcada para as 3h de domingo aparece atrasada na segunda de manhã e
 *  já nasce com cara de dívida — a lista fica vermelha sem ninguém ter falhado. */
export function dentroDoExpediente(d: Date): boolean {
  const { dia, hora } = partesSP(d);
  return dia >= 1 && dia <= 5 && hora >= ABRE && hora < FECHA;
}

export function proximoExpediente(d: Date): Date {
  const p = partesSP(d);
  // Ainda hoje, antes de abrir: vale hoje às 9h.
  if (p.dia >= 1 && p.dia <= 5 && p.hora < ABRE) return emSP(p.y, p.mo, p.da, ABRE);
  // Depois de fechar, ou fim de semana: primeiro dia útil seguinte às 9h.
  let candidato = emSP(p.y, p.mo, p.da + 1, ABRE);
  for (let i = 0; i < 7; i++) {
    const c = partesSP(candidato);
    if (c.dia >= 1 && c.dia <= 5) return candidato;
    candidato = emSP(c.y, c.mo, c.da + 1, ABRE);
  }
  return candidato;
}

/**
 * A próxima tarefa deste negócio — ou `null` quando não há o que criar.
 *
 * `null` em quatro situações, e cada uma é uma decisão:
 *   · já existe tarefa pendente → a cadência não empilha cobrança em cima de
 *     cobrança; ela espera o corretor fechar a que está aberta;
 *   · a cadência esgotou → depois do terceiro degrau o card precisa de decisão
 *     humana (perder ou reaquecer), não de uma quarta tarefa;
 *   · o degrau ainda não venceu → a tarefa só nasce quando o silêncio já dura
 *     o intervalo inteiro;
 *   · negócio recém-criado com contato de agora → nada a cobrar ainda.
 */
export function proximaAtividadeDaCadencia(
  n: NegocioParaCadencia,
  agora: Date,
  cadencia: number[] = CADENCIA_ATIVIDADES_HORAS
): AtividadeSugerida | null {
  if (n.temPendente) return null;
  const degrau = n.degrausJaCriados;
  if (degrau >= cadencia.length) return null;

  const intervalo = cadencia[degrau]!;
  // A régua é o contato mais recente que o sistema CONHECE. Sem nenhum, é a
  // entrada na fase: um card parado em "Novo" há duas semanas é exatamente o
  // caso que esta cadência existe para pegar.
  const base = n.ultimoContatoEm ?? n.faseDesde;
  const vence = new Date(base.getTime() + intervalo * HORA);
  if (vence.getTime() > agora.getTime()) return null;

  const quando = dentroDoExpediente(agora) ? agora : proximoExpediente(agora);
  const dias = Math.floor((agora.getTime() - base.getTime()) / (24 * HORA));

  return {
    negocioId: n.id,
    titulo: TITULO_POR_DEGRAU[degrau] ?? TITULO_POR_DEGRAU[TOTAL_DEGRAUS - 1]!,
    tipo: TIPO_POR_DEGRAU[degrau] ?? "TAREFA",
    quando,
    explicacao:
      dias >= 1
        ? `${dias} dia(s) sem contato — ${degrau + 1}º toque da cadência.`
        : `${degrau + 1}º toque da cadência (sem contato desde a entrada na fase).`,
  };
}

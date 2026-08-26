// O SLA do vendedor: quanto tempo entre a PASSAGEM do lead e a primeira
// resposta humana.
//
// ─── O QUE ISTO MEDE, E POR QUE O ZERO É A PASSAGEM ─────────────────────────
//
// Pedido do cliente em 26/08: "a hora que terminou a triagem, passou para o
// Gabriel assumir, salva o horário". O relógio NÃO começa quando o lead chega —
// começa quando ele vira responsabilidade de uma pessoa. Enquanto a IA
// qualifica, o cliente está sendo atendido; o que a régua de 10 minutos cobra é
// o intervalo em que ele passou a esperar um ser humano.
//
// A régua de 60 segundos de `/leads-portais` mede outra coisa (chegada do lead
// → primeira mensagem da IA) e continua valendo para o que ela mede. Duas
// réguas com o mesmo nome seriam a próxima confusão de reunião — por isso os
// nomes daqui dizem "vendedor" em todo lugar.
//
// ─── MÓDULO PURO, SEM PRISMA, E ISSO NÃO É ESTILO ───────────────────────────
//
// Este arquivo é a REGRA; `lib/passagem.ts` abre o relógio e
// `lib/sla-fechamento.ts` o fecha. Separado assim, a conta que vai penalizar um
// corretor tem teste que roda em milissegundos e sem banco — que é o mínimo
// para um número que alguém vai usar numa conversa sobre comissão.
//
// ─── O QUE FOI REUSADO DE lib/metricas-entrega.ts ───────────────────────────
//
// `percentil` e `AMOSTRA_MINIMA` vêm de lá, e a regra de descartar valor
// negativo também. O que MUDA, e o motivo de mudar:
//
//   · lá o relógio começa em "o cliente escreveu"; aqui, em "o lead foi passado";
//   · lá o balde mistura IA e ATENDENTE (a assistente respondendo em 3s puxa o
//     p50 para baixo e esconde o corretor que sumiu); aqui só ATENDENTE conta;
//   · lá agrega por instância de WhatsApp; aqui, por pessoa;
//   · lá existe `TETO_PAREAMENTO_MS` (6h) para não contar mensagem proativa como
//     resposta. AQUI NÃO HÁ TETO, de propósito: o outlier de lá é um erro de
//     pareamento, e o daqui é exatamente o pecado que se quer medir. Um lead
//     respondido 3 dias depois DEVE arrastar o p95 do vendedor. Quem protege a
//     leitura do outlier é a MEDIANA, que é o número que vai na tela primeiro.
//
// ─── DOIS LIMITES QUE ESTA CONTA NÃO RESOLVE (levar ao cliente) ─────────────
//
//  1. SEM NÚMERO PRÓPRIO POR CORRETOR, O SLA É DA CASA E NÃO DO VENDEDOR.
//     `Mensagem` não tem autor-usuário (só CLIENTE | IA | ATENDENTE), então
//     "quem respondeu" só existe por `Conversa.instanciaId →
//     InstanciaWhatsApp.usuarioId`. Numa casa onde todo mundo atende pelo número
//     central, o painel mostra uma linha só — e ela é honesta: é o SLA da casa.
//     Não é bug de código, é pré-requisito de implantação.
//  2. QUEM LIGA EM VEZ DE MANDAR MENSAGEM APARECE COMO SE NÃO TIVESSE
//     RESPONDIDO. Não há heurística silenciosa aqui de propósito: inventar uma
//     ("teve visita agendada, então ele deve ter ligado") transformaria o painel
//     numa afirmação que ninguém consegue conferir. O limite fica visível na
//     tela, com o número de não respondidas ao lado do percentual, e a saída é
//     de produto — registrar a ligação — não de estatística.

import { AMOSTRA_MINIMA, percentil, type Tom } from "@/lib/metricas-entrega";

/** O padrão da casa quando `Imobiliaria.slaVendedorMinutos` não diz outra
 *  coisa. 10 minutos é o número da reunião de 26/08, e ele tem dono: o estudo
 *  de conversão que o cliente citou, confirmado pela linha de frente ("quando eu
 *  demoro 10 minutos para responder, o cliente já não me responde mais"). */
export const SLA_VENDEDOR_MINUTOS_PADRAO = 10;

/** Reexportado para a tela não precisar conhecer dois módulos para pintar uma
 *  célula — e para deixar escrito que a régua de amostra é a MESMA de
 *  `/admin/entrega`, não uma segunda inventada aqui. */
export { AMOSTRA_MINIMA };
/** Reexportado pelo mesmo motivo: a tela do gestor pinta a célula com o tom
 *  desta régua, e não precisa conhecer o painel do operador para isso. */
export type { Tom };

/** Uma passagem, do jeito que a conta precisa dela. Deliberadamente sem `id`,
 *  sem Prisma e sem nada que exija banco: é o que permite provar a regra sem
 *  subir Postgres. */
export type PassagemMedida = {
  corretorId: number | null;
  passouEm: Date;
  respondidoEm: Date | null;
  /** A passagem foi superada por outra (o lead mudou de mão sem resposta).
   *  Fecha a janela de cobrança do vendedor anterior no instante da troca. */
  encerradoEm?: Date | null;
};

/**
 * Os segundos entre a passagem e a resposta. `null` quando não houve resposta.
 *
 * Valor negativo é descartado, e não zerado, pelo mesmo motivo de
 * `esperasEmMs` em `metricas-entrega.ts`: evento fora de ordem existe (a uazapi
 * reentrega `messages_update` atrasado), e zero mentiria para baixo no p50 —
 * fabricando um atendimento instantâneo que nunca aconteceu.
 */
export function segundosDeResposta(p: PassagemMedida): number | null {
  if (!p.respondidoEm) return null;
  const ms = p.respondidoEm.getTime() - p.passouEm.getTime();
  if (ms < 0) return null;
  return Math.round(ms / 1000);
}

/**
 * O estado de UMA passagem em relação à régua.
 *
 * "PENDENTE" é o estado que quase todo painel de SLA erra: a passagem que
 * aconteceu há 2 minutos ainda não estourou nada, e contá-la como falha faz o
 * percentual do corretor piorar sozinho a cada lead novo que ele recebe — no
 * exato instante em que ele ainda está dentro do prazo. Ela fica FORA do
 * denominador até o prazo vencer.
 */
export type EstadoSla = "DENTRO" | "FORA" | "PENDENTE";

export function estadoDaPassagem(
  p: PassagemMedida,
  slaSegundos: number,
  agora: Date
): EstadoSla {
  const segundos = segundosDeResposta(p);
  if (segundos != null) return segundos <= slaSegundos ? "DENTRO" : "FORA";
  // Sem resposta. O relógio para no encerramento quando a passagem foi
  // superada: depois que o lead saiu da mão dele, o tempo que passa não é mais
  // dele.
  const fim = p.encerradoEm ?? agora;
  const decorrido = (fim.getTime() - p.passouEm.getTime()) / 1000;
  return decorrido > slaSegundos ? "FORA" : "PENDENTE";
}

export type ResumoSla = {
  /** Passagens na janela, incluindo as ainda pendentes. */
  passagens: number;
  /** Quantas tiveram resposta humana. */
  respondidas: number;
  /** Respondidas dentro da régua. */
  dentro: number;
  /** Estouraram: respondidas tarde, ou sem resposta com o prazo já vencido. */
  fora: number;
  /** Ainda dentro do prazo, sem resposta. Não entram no percentual. */
  pendentes: number;
  /**
   * `dentro / (dentro + fora)`, ou `null` quando nada foi decidido ainda.
   *
   * `null` e `0` são estados diferentes e não podem virar o mesmo número numa
   * tela que vai ser usada para cobrar gente — a própria /dados-comerciais já
   * defende isso por escrito: "número inventado num painel de decisão é pior
   * que espaço vazio, porque alguém demite corretor por causa dele".
   */
  percentualDentro: number | null;
  /** Mediana e p95 do tempo de resposta, em segundos. Só sobre as RESPONDIDAS —
   *  não existe duração de uma resposta que não veio. Por isso `naoRespondidas`
   *  vai junto na tela: sem ele, o corretor que respondeu 2 de 20 leads em 30
   *  segundos aparece com a melhor mediana da casa. */
  p50Segundos: number | null;
  p95Segundos: number | null;
  /** Quantas respostas sustentam o p50/p95 (= `respondidas`). */
  amostras: number;
  /** Passagens sem resposta nenhuma, decididas ou não. É o número que impede a
   *  mediana de mentir. */
  naoRespondidas: number;
};

export function resumirSla(
  passagens: PassagemMedida[],
  slaSegundos: number,
  agora: Date
): ResumoSla {
  let dentro = 0;
  let fora = 0;
  let pendentes = 0;
  const duracoes: number[] = [];

  for (const p of passagens) {
    switch (estadoDaPassagem(p, slaSegundos, agora)) {
      case "DENTRO":
        dentro++;
        break;
      case "FORA":
        fora++;
        break;
      default:
        pendentes++;
    }
    const s = segundosDeResposta(p);
    if (s != null) duracoes.push(s);
  }

  const decididas = dentro + fora;
  return {
    passagens: passagens.length,
    respondidas: duracoes.length,
    dentro,
    fora,
    pendentes,
    percentualDentro: decididas === 0 ? null : dentro / decididas,
    p50Segundos: percentil(duracoes, 50),
    p95Segundos: percentil(duracoes, 95),
    amostras: duracoes.length,
    naoRespondidas: passagens.length - duracoes.length,
  };
}

export type LinhaSlaVendedor = ResumoSla & {
  /** `null` = a passagem saiu SEM DONO (rodízio desligado, sem cota). Continua
   *  na lista: é o caso da casa que mais precisa aparecer, não o que sumir. */
  corretorId: number | null;
};

/**
 * A mesma conta, quebrada por vendedor — que é a diferença entre este módulo e
 * `medirEntregaPorInstancia`, que quebra por número de WhatsApp.
 *
 * Ordena do PIOR para o melhor, com quem não tem percentual no fim: quem abre a
 * tela precisa ver o problema, não a ordem de cadastro. Mesma regra de ordenação
 * de `medirEntregaPorInstancia`.
 */
export function slaPorVendedor(
  passagens: (PassagemMedida & { corretorId: number | null })[],
  slaSegundos: number,
  agora: Date
): LinhaSlaVendedor[] {
  const porCorretor = new Map<number | null, PassagemMedida[]>();
  for (const p of passagens) {
    const lista = porCorretor.get(p.corretorId);
    if (lista) lista.push(p);
    else porCorretor.set(p.corretorId, [p]);
  }
  return [...porCorretor.entries()]
    .map(([corretorId, lista]) => ({ corretorId, ...resumirSla(lista, slaSegundos, agora) }))
    .sort((a, b) => (a.percentualDentro ?? 2) - (b.percentualDentro ?? 2));
}

// ─── Tradução para a tela ───────────────────────────────────────────────────

/** Minutos da configuração da casa → segundos, com o padrão da reunião quando
 *  a casa não configurou nada. Um único lugar faz essa conversão porque
 *  "minutos ou segundos?" espalhado é como um SLA de 10 minutos vira 10
 *  segundos numa tela e ninguém percebe. */
export function slaEmSegundos(minutos: number | null | undefined): number {
  const m = minutos == null || minutos <= 0 ? SLA_VENDEDOR_MINUTOS_PADRAO : minutos;
  return m * 60;
}

/**
 * O tom da célula. Amostra pequena não ganha cor, pela mesma razão que em
 * `metricas-entrega.ts` — só que aqui a consequência do vermelho é maior: lá o
 * alarme acusa uma instância de WhatsApp, aqui acusa uma pessoa.
 *
 * Os cortes: abaixo de 50% das passagens dentro da régua é vermelho; abaixo de
 * 80%, atenção. Não são números de estudo nenhum — são a leitura direta do que
 * a régua já significa: metade dos leads passados esfriando é operação
 * quebrada, e 1 em 5 é o começo dela.
 */
export const SLA_PERCENTUAL_RUIM = 0.5;
export const SLA_PERCENTUAL_ATENCAO = 0.8;

export function tomDoSla(percentual: number | null, decididas: number): Tom {
  if (percentual == null || decididas < AMOSTRA_MINIMA) return "default";
  if (percentual < SLA_PERCENTUAL_RUIM) return "bad";
  if (percentual < SLA_PERCENTUAL_ATENCAO) return "warn";
  return "good";
}

/** Duração em segundos para a tela. Minutos acima de 1 min, horas acima de 1h —
 *  "4.812 s" faz quem lê fazer conta de cabeça no meio de uma conversa sobre
 *  desempenho. Segue o desenho de `formatarDuracao` de metricas-entrega, com a
 *  faixa esticada porque aqui a resposta pode demorar um dia. */
export function formatarEspera(segundos: number | null): string {
  if (segundos == null) return "—";
  if (segundos < 60) return `${segundos} s`;
  if (segundos < 3600) {
    const min = Math.floor(segundos / 60);
    const s = segundos % 60;
    return s === 0 ? `${min} min` : `${min} min ${s} s`;
  }
  if (segundos < 86400) {
    const h = Math.floor(segundos / 3600);
    const min = Math.round((segundos % 3600) / 60);
    return min === 0 ? `${h} h` : `${h} h ${min} min`;
  }
  const dias = Math.floor(segundos / 86400);
  const h = Math.round((segundos % 86400) / 3600);
  return h === 0 ? `${dias} d` : `${dias} d ${h} h`;
}

/** Percentual para a tela, preservando a diferença entre "0%" e "nada decidido
 *  ainda". */
export function formatarPercentualSla(p: number | null): string {
  return p == null ? "—" : `${Math.round(p * 100)}%`;
}

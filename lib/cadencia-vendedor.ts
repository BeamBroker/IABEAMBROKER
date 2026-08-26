// A TERCEIRA cadência: a que cobra o VENDEDOR no WhatsApp dele.
//
// ─── AS TRÊS CADÊNCIAS, E POR QUE ESTA É UM ARQUIVO NOVO ────────────────────
//
// O sistema já tinha duas, e elas estão certas. O erro seria enfiar a terceira
// dentro de uma delas:
//
//   1. lib/followup.ts            fala com o CLIENTE, por WhatsApp, 1h/1d/3d.
//   2. lib/atividades-cadencia.ts fala com o CORRETOR, por TAREFA na agenda,
//                                 24h/72h/168h.
//   3. este arquivo               fala com o CORRETOR, por WhatsApp DELE,
//                                 15min/4h/24h.
//
// A 1 e a 3 nunca podem se encontrar, e essa é a regra da reunião de 26/08:
// enquanto o cliente não responde, a IA faz o follow-up; depois que ela
// qualifica e PASSA para o vendedor, a IA não fala mais com o cliente — só
// lembra o corretor (Júlia formulou, Samuel confirmou com "exato"). Fundir os
// dois módulos é literalmente desfazer essa fronteira.
//
// A 2 e a 3 se parecem e não são a mesma coisa. A 2 escreve uma linha numa
// lista que o corretor abre quando quiser; a 3 faz o celular dele apitar. Samuel
// pediu a 3 com essas palavras: "vai mandar tipo uma mensagem mesmo no WhatsApp
// do corretor", "avisa ele até a cabeça estourar, ele tem que tentar fazer os
// três". E a 2 roda sobre `Negocio`; um lead entregue que nunca virou negócio
// não recebe cobrança nenhuma dela — este módulo roda sobre `Lead` e fecha
// exatamente esse buraco.
//
// ─── SEM PRISMA, DE PROPÓSITO ───────────────────────────────────────────────
//
// Mesma decisão de lib/atividades-cadencia.ts: cada número aqui é uma regra de
// negócio ("quinze minutos calado é atraso", "depois do terceiro o gestor entra
// no assunto"), e regra que só dá para conferir com banco em pé é regra que
// ninguém confere. O envio e a leitura moram em lib/cobranca-vendedor.ts.
//
// ─── NADA DE RELÓGIO DE PAREDE NO TEXTO ─────────────────────────────────────
//
// As mensagens daqui falam em "há 38 min", nunca em "hoje 14:20". Não é estilo:
// é a única forma de o texto ser imune ao fuso. Formatar data significa escolher
// timezone, e este código roda em container BRT lendo Postgres UTC, com o driver
// `pg` deslocando `timestamp without time zone` em 3h ao serializar. Duração é
// subtração de dois Date em ms e não tem como errar.

import { dentroDoExpediente, proximoExpediente } from "@/lib/atividades-cadencia";
import { linkWhatsApp } from "@/lib/telefone";

const HORA = 3_600_000;

/** Degraus da cobrança, em HORAS desde a passagem do lead ao vendedor.
 *
 *  15 min → +4h → +24h. Três, e não cinco, pelo mesmo motivo que as outras duas
 *  cadências têm três: a quarta cobrança não é lida, é silenciada. Depois da
 *  terceira o caminho não é um quarto toque, é o gestor (ver `precisaEscalonar`).
 *
 *  O PRIMEIRO DEGRAU É EM MINUTOS, e essa é a decisão que carrega o recurso.
 *  Samuel: "estudo diz que quem responde em até 10 minutos converte muito mais".
 *  Um lembrete que chega no dia seguinte não é lembrete, é laudo. Está em 0,25h
 *  e não em 0,17h (10 min) porque o cron de maior frequência que existe roda de
 *  15 em 15 minutos — agendar para 10 min faria o toque sair, na prática, entre
 *  10 e 25 min, com a hora variando por sorte. 15 é o menor número que o sistema
 *  consegue cumprir de verdade.
 *
 *  O SLA de 10 minutos continua sendo 10 minutos: quem mede o atraso é o
 *  relógio da passagem (lib/passagem.ts / SlaLead, frente do A4). Este número é
 *  quando a COBRANÇA sai, não quando o atraso começa. */
export const CADENCIA_VENDEDOR_HORAS = [0.25, 4, 24];

export const TOTAL_TOQUES_VENDEDOR = CADENCIA_VENDEDOR_HORAS.length;

/** Depois de quantas horas desde a passagem o lead sai da esteira de cobrança.
 *
 *  Duas funções, e as duas importam:
 *
 *  · TETO. Passado esse prazo o assunto não é mais "responde rápido", é gestão
 *    de carteira — e continuar apitando no celular de alguém sobre um lead de
 *    cinco dias atrás é como a lista de tarefas perde a confiança dela.
 *
 *  · JANELA DE ADOÇÃO, que é a defesa que impede um acidente conhecido. No dia
 *    em que isto for ligado, o banco já tem lead atribuído de meses atrás; sem
 *    o teto, TODOS entrariam vencidos no primeiro minuto e o corretor receberia
 *    a carteira inteira de uma vez. Já aconteceu neste sistema: lib/followup.ts
 *    :456-461 registra a correção de bug que quase disparou 192 mensagens de
 *    uma vez para leads antigos.
 *
 *  72h cobre o degrau mais longo (24h) com folga para o cron de 3x/dia e para
 *  um fim de semana inteiro empurrando o toque para segunda. */
export const JANELA_COBRANCA_HORAS = 72;

/** Horas desde a passagem até o gestor ser avisado.
 *
 *  O terceiro toque sai em 24h; escalar em 24h+1min seria escalar antes de o
 *  corretor ter tido a chance de ler o último lembrete. 48h dá a ele o mesmo
 *  intervalo do último degrau — é o que separa "não cumpriu a cadência" de
 *  "ainda não abriu o WhatsApp hoje", e essa diferença importa porque a
 *  mensagem vai para o chefe da pessoa.
 *
 *  Cabe dentro de JANELA_COBRANCA_HORAS de propósito: fora da janela não há
 *  escalonamento nenhum, então ligar o recurso não gera enxurrada retroativa. */
export const HORAS_ATE_ESCALONAR = 48;

/** A passagem do lead ao vendedor, do ponto de vista de quem cobra.
 *
 *  Este tipo é a FRONTEIRA com o relógio do SLA (frente do A4): ele carimba
 *  `passouEm` e `respondidoEm`, este módulo só lê. Nada aqui sabe se o dado veio
 *  de `SlaLead`, de `Lead.atribuidoEm` ou de um teste. */
export type PassagemDoVendedor = {
  leadId: number;
  /** Quando o corretor respondeu "já falei com ele" ao lembrete. Encerra a
   *  cobrança sem escalonamento — ver `ehConfirmacaoDeFollow`. */
  dispensadaEm?: Date | null;
  /** O zero do relógio: quando o lead virou responsabilidade de alguém. */
  passouEm: Date;
  /** Primeira saída NOSSA por GENTE depois de `passouEm`. Null = ninguém falou.
   *
   *  Resposta da IA não conta e isso decide um número: o follow-up automático da
   *  própria Maitê fecharia o relógio do corretor uma hora depois e todo mundo
   *  teria 100% de cumprimento. */
  respondidoEm: Date | null;
  /** Quantos lembretes já saíram para o corretor (0..3). */
  toquesEnviados: number;
  /** Quando o gestor foi avisado. Trava de repetição, não relatório. */
  escalonadoEm: Date | null;
};

export type ToqueDoVendedor = {
  /** 1, 2 ou 3 — o número que aparece no texto ("toque 2 de 3"). */
  toque: number;
  /** Quando ENVIAR. Pode ser no futuro: fora do expediente o toque é empurrado
   *  para o próximo dia útil às 9h em vez de disparado. Quem chama compara com
   *  `agora` — `quando > agora` significa agendar, não enviar. */
  quando: Date;
  /** Há quanto tempo o lead está esperando, em minutos. Vai para o texto. */
  minutosEsperando: number;
};

/** O lead ainda está na janela em que a cobrança faz sentido? */
export function dentroDaJanelaDeCobranca(
  p: Pick<PassagemDoVendedor, "passouEm">,
  agora: Date,
  janelaHoras = JANELA_COBRANCA_HORAS
): boolean {
  const idade = agora.getTime() - p.passouEm.getTime();
  // Passagem no futuro é relógio torto (ou um teste): não cobra.
  return idade >= 0 && idade <= janelaHoras * HORA;
}

/**
 * O próximo lembrete deste lead — ou `null` quando não há o que cobrar.
 *
 * `null` em cinco situações, e cada uma é uma decisão, não um atalho:
 *
 *  · JÁ RESPONDEU → nunca mais. Assim que uma pessoa fala com o cliente, o
 *    trabalho foi feito e cobrar de novo é o que faz o corretor silenciar o
 *    número da casa. É definitivo: `respondidoEm` preenchido encerra o assunto.
 *
 *  · CADÊNCIA ESGOTADA → não existe quarto toque. O caminho depois do terceiro
 *    é `precisaEscalonar`, que é uma coisa diferente e vai para outra pessoa.
 *
 *  · FORA DA JANELA → lead velho não entra na esteira (ver JANELA_COBRANCA_HORAS).
 *
 *  · DEGRAU AINDA NÃO VENCEU → o lembrete só nasce quando o silêncio dura o
 *    intervalo inteiro.
 *
 *  · ESCALONADO → o gestor já foi avisado; a partir daí o assunto é dele.
 */
export function proximoToqueDoVendedor(
  p: PassagemDoVendedor,
  agora: Date,
  cadencia: number[] = CADENCIA_VENDEDOR_HORAS
): ToqueDoVendedor | null {
  if (p.respondidoEm) return null;
  if (p.dispensadaEm) return null;
  if (p.escalonadoEm) return null;
  if (!dentroDaJanelaDeCobranca(p, agora)) return null;

  const degrau = p.toquesEnviados;
  if (degrau < 0 || degrau >= cadencia.length) return null;

  const vence = new Date(p.passouEm.getTime() + cadencia[degrau]! * HORA);
  if (vence.getTime() > agora.getTime()) return null;

  return {
    toque: degrau + 1,
    // Fora do expediente EMPURRA, não dispara. O corretor que recebe cobrança
    // às 3h da manhã não acorda mais rápido — ele desliga a notificação do
    // número da casa, e aí nenhuma cobrança futura chega.
    quando: dentroDoExpediente(agora) ? agora : proximoExpediente(agora),
    minutosEsperando: Math.floor((agora.getTime() - p.passouEm.getTime()) / 60_000),
  };
}

/**
 * O gestor precisa entrar no assunto?
 *
 * Samuel, na reunião: "a gente vai ter essa métrica para avisar o gestor dele
 * para ter uma certa penalização". A régua é objetiva de propósito — três
 * lembretes saíram, ninguém falou com o cliente — porque uma penalização
 * baseada em julgamento é uma penalização que vira discussão.
 *
 * `escalonadoEm` preenchido devolve `false`: o gestor é avisado UMA vez por
 * passagem. Repetir transformaria a mensagem que existe para ser levada a sério
 * em ruído de rotina.
 *
 * Continua valendo dentro da janela: lead de cinco dias atrás não gera
 * escalonamento retroativo no dia em que isto for ligado.
 */
export function precisaEscalonar(
  p: PassagemDoVendedor,
  agora: Date,
  cadencia: number[] = CADENCIA_VENDEDOR_HORAS
): boolean {
  if (p.respondidoEm) return false;
  // A palavra do corretor vale, e vale ANTES do gestor. Ver a coluna
  // `Lead.cobrancaDispensadaEm` e `ehConfirmacaoDeFollow` abaixo.
  if (p.dispensadaEm) return false;
  if (p.escalonadoEm) return false;
  if (p.toquesEnviados < cadencia.length) return false;
  if (!dentroDaJanelaDeCobranca(p, agora)) return false;
  return agora.getTime() - p.passouEm.getTime() >= HORAS_ATE_ESCALONAR * HORA;
}

// ─── OS TEXTOS ──────────────────────────────────────────────────────────────
//
// TEMPLATE FIXO, e não a IA escrevendo. Mesma decisão de lib/aviso-lead.ts:16-21
// e pelo mesmo motivo, que aqui é ainda mais forte — isto chega três vezes por
// lead. Um resumo escrito pelo modelo muda de forma a cada mensagem e o olho
// perde o hábito de achar o link sempre no mesmo lugar. E gerar texto por LLM
// numa rotina em lote é custo de API multiplicado pelo tamanho da carteira.

/** Um lead na mensagem de cobrança. */
export type LeadCobrado = {
  nome: string;
  /** O telefone do CLIENTE, como está gravado. */
  telefone: string | null;
  /** "Compra · Apartamento no Centro (AP-0002)", já pronto. */
  interesse: string | null;
  toque: number;
  minutosEsperando: number;
};

/** "há 38 min", "há 3 h", "há 2 dias" — sem relógio de parede, sem fuso. */
export function haQuantoTempo(minutos: number): string {
  if (minutos < 1) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas}h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/**
 * A cobrança que chega no WhatsApp do corretor.
 *
 * UMA MENSAGEM COM OS N LEADS, nunca N mensagens. Dez leads vencendo na mesma
 * passada do cron viram dez notificações seguidas do mesmo número — que é
 * exatamente o padrão de rajada que o WhatsApp pune (provider_code 463), e
 * lib/ritmo-envio.ts espaça o envio mas não é teto de volume.
 *
 * A ÚLTIMA LINHA NÃO É GENTILEZA, é a correção de um falso positivo que o
 * sistema não tem como evitar sozinho: o corretor que LIGA em vez de mandar
 * mensagem fez o trabalho e o sistema não vê — `Mensagem` só existe para o que
 * passou pelo WhatsApp. lib/follow-detectado.ts:15-19 enfrentou a versão inversa
 * do mesmo dilema e escolheu errar para o lado de fechar demais, porque "cobrar
 * tarefa já feita é a lista perder a confiança dela". Aqui a consequência é
 * maior — a próxima parada desta cadência é o gestor —, então a mensagem admite
 * a dúvida e aceita a palavra do corretor como fechamento.
 */
export function textoDaCobranca(leads: LeadCobrado[]): string {
  if (leads.length === 0) return "";
  const linhas: string[] = [];

  if (leads.length === 1) {
    const l = leads[0]!;
    linhas.push("Follow pendente.", "");
    linhas.push(`Cliente: ${l.nome.trim() || "sem nome"}${l.telefone?.trim() ? ` (${l.telefone.trim()})` : ""}`);
    linhas.push(`Passou pra você: ${haQuantoTempo(l.minutosEsperando)}`);
    // Linha que falta some INTEIRA, não vira "Interesse: —". Mesma regra de
    // lib/aviso-lead.ts:125-128: rótulo com buraco do lado obriga quem lê a
    // decidir, a cada mensagem, se aquilo é ausência de dado ou defeito.
    if (l.interesse?.trim()) linhas.push(`Interesse: ${l.interesse.trim()}`);
    linhas.push(`Toque ${l.toque} de ${TOTAL_TOQUES_VENDEDOR}`);
    const link = linkWhatsApp(l.telefone);
    if (link) linhas.push("", `Chamar: ${link}`);
  } else {
    linhas.push(`Follow pendente — ${leads.length} clientes esperando você.`, "");
    leads.forEach((l, i) => {
      linhas.push(
        `${i + 1}) ${l.nome.trim() || "sem nome"}${l.telefone?.trim() ? ` (${l.telefone.trim()})` : ""} · ${haQuantoTempo(l.minutosEsperando)} · toque ${l.toque} de ${TOTAL_TOQUES_VENDEDOR}`
      );
      if (l.interesse?.trim()) linhas.push(`   ${l.interesse.trim()}`);
      const link = linkWhatsApp(l.telefone);
      if (link) linhas.push(`   ${link}`);
      linhas.push("");
    });
    if (linhas[linhas.length - 1] === "") linhas.pop();
  }

  linhas.push("", "Se você já falou com ele por telefone, me responde OK aqui que eu paro de cobrar.");
  return linhas.join("\n");
}

/**
 * O escalonamento que chega no WhatsApp do gestor.
 *
 * Diz o FATO e para. Não classifica o corretor, não sugere consequência, não
 * conta histórico: quem decide o que fazer com isso é o gestor, e um texto
 * automático que já vem com veredito pronto é o que faz a mensagem ser lida como
 * acusação em vez de informação. A frase do Samuel era "avisar o gestor dele
 * para ter uma certa penalização" — a penalização é dele, o aviso é nosso.
 *
 * `corretor` nulo é o caso da casa SEM rodízio: o lead foi entregue e não tem
 * dono. Continua valendo escalar — é justamente a casa em que ninguém assume.
 */
export function textoDoEscalonamento(d: {
  corretor: string | null;
  leads: LeadCobrado[];
}): string {
  const linhas: string[] = ["Cadência não cumprida.", ""];
  linhas.push(
    d.corretor?.trim()
      ? `Corretor: ${d.corretor.trim()}`
      : "Corretor: nenhum (o lead foi entregue sem dono — rodízio desligado ou sem cota)"
  );
  linhas.push(
    d.leads.length === 1
      ? "Lead sem retorno depois dos 3 lembretes:"
      : `${d.leads.length} leads sem retorno depois dos 3 lembretes:`
  );
  linhas.push("");
  for (const l of d.leads) {
    linhas.push(
      `· ${l.nome.trim() || "sem nome"}${l.telefone?.trim() ? ` (${l.telefone.trim()})` : ""} — esperando ${haQuantoTempo(l.minutosEsperando)}`
    );
    if (l.interesse?.trim()) linhas.push(`  ${l.interesse.trim()}`);
    const link = linkWhatsApp(l.telefone);
    if (link) linhas.push(`  ${link}`);
  }
  linhas.push(
    "",
    "Ninguém desta casa mandou mensagem para esses clientes no WhatsApp depois da passagem. Ligação não aparece aqui."
  );
  return linhas.join("\n");
}

// ─── A PALAVRA DO CORRETOR ──────────────────────────────────────────────────

/** Respostas que encerram a cobrança. Curtas de propósito: são o que alguém
 *  digita com uma mão no volante, e é exatamente essa pessoa que a cadência
 *  está cobrando. */
const CONFIRMACOES = [
  "ok",
  "okay",
  "blz",
  "beleza",
  "certo",
  "ciente",
  "feito",
  "resolvido",
  "ja falei",
  "ja liguei",
  "ja atendi",
  "falei",
  "liguei",
  "atendi",
  "sim",
];

/** Quanto texto ainda é uma confirmação, e não um assunto novo. */
const LIMITE_CONFIRMACAO = 40;

/**
 * O corretor está dizendo "já falei com ele"?
 *
 * ESTREITA DE PROPÓSITO, e a estreiteza é a regra. O mesmo número do corretor
 * conversa com a casa pelo Ajuda Corretor ("quais imóveis temos em Dianópolis?"),
 * e tratar qualquer mensagem dele como confirmação faria a cobrança se
 * desligar sozinha toda vez que ele usasse o assistente — sem ninguém notar,
 * porque o sintoma é a AUSÊNCIA de mensagens.
 *
 * Duas travas: começa com uma das palavras da lista, e é curta. "ok" fecha;
 * "ok, mas antes me manda a ficha do apartamento do Centro" não fecha, porque
 * é uma pergunta e a resposta dela não é parar de cobrar.
 *
 * Acento e caixa não importam: quem responde no celular escreve "ja falei".
 */
export function ehConfirmacaoDeFollow(texto: string | null | undefined): boolean {
  const limpo = (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    // Pontuação de fim ("ok!", "ok.") não muda o sentido.
    .replace(/[.!,;]+$/, "");
  if (!limpo || limpo.length > LIMITE_CONFIRMACAO) return false;
  return CONFIRMACOES.some((c) => limpo === c || limpo.startsWith(`${c} `));
}

// O BRINCO — o ponto ÚNICO onde um lead é marcado.
//
// ─── O QUE É ────────────────────────────────────────────────────────────────
//
// Da reunião de 26/08: "quando tem um rebanho de boi e eles têm um brinco com o
// número deles… a gente vai colocar um brinco naquele lead", e "quem não tiver
// esse brinco não vai ser atingido". O brinco é a marca que o lead recebe na
// ENTRADA — canal, detalhe, campanha, quem trouxe — e é ela que autoriza o
// atendimento automático.
//
// ─── POR QUE ISTO É UM MÓDULO, E NÃO UM CAMPO A MAIS EM CADA `create` ───────
//
// `Lead` é criado em QUATRO lugares que não se falam:
//
//   1. webhook de portal          app/api/webhooks/portal/route.ts
//   2. cadastro à mão no CRM      lib/acoes-locacao.ts (criarLead)
//   3. IA de locação              lib/agentes.ts (registrar_lead)
//   4. IA de compra               lib/agentes.ts (registrar_interesse_compra)
//
// Cada um inventava a própria marca: o portal grava três colunas de rastreio, a
// IA grava `origem: "WHATSAPP"` fixo, o cadastro à mão grava o que a pessoa
// digitar no FormData, e NENHUM grava quem trouxe. Foi assim que a mesma OLX
// virou "OLX", "Grupo OLX" e "PORTAL" em três lugares, e que o Canal Pro
// passou meses classificando como origem desconhecida.
//
// A regra deste arquivo: quem cria lead chama `montarBrinco()` e usa o que ele
// devolve. Quem quiser marcar diferente muda AQUI, e a mudança vale para os
// quatro caminhos no mesmo instante.
//
// ─── A PARTE QUE DECIDE NÃO TOCA O BANCO ────────────────────────────────────
//
// `montarBrinco` e `decidirGateBrinco` são puras: sem Prisma, sem relógio
// próprio, testáveis sem banco. É o molde de lib/distribuicao.ts, e o motivo é
// o mesmo — a decisão que cala a IA de um cliente precisa ser conferível numa
// reunião, linha a linha, sem subir ambiente.

import { prisma } from "@/lib/db";
import { leadPorTelefone } from "@/lib/lead-telefone";
import { procedenciaDoLead, type CanalLead } from "@/lib/origem-lead";

/**
 * Espelho de `enum CanalOrigem` em prisma/schema.prisma.
 *
 * Repetido aqui de propósito: o tipo gerado pelo Prisma Client só existe depois
 * de `prisma generate`, e este módulo precisa ser importável (e testável) antes
 * disso. `lib/brinco.test.ts` LÊ o schema e compara com esta lista, então as
 * duas não conseguem divergir em silêncio — que é exatamente como o bug do
 * CANAL_PRO nasceu, com duas listas digitadas em arquivos diferentes.
 */
export const CANAIS_ORIGEM = [
  "PORTAL",
  "META",
  "WHATSAPP",
  "SITE",
  "INDICACAO",
  "PLACA",
  "IMPORTACAO",
  "DESCONHECIDO",
] as const;

export type CanalOrigem = (typeof CANAIS_ORIGEM)[number];

/**
 * COMO o brinco foi posto. String no banco (não enum) porque um caminho de
 * entrada novo não pode custar migration — a mesma decisão de
 * `Lead.atribuicaoOrigem`.
 */
export type BrincoVia =
  /** Webhook de portal, Lead Ads, clique-para-WhatsApp: chegou por integração. */
  | "INTEGRACAO"
  /** Alguém cadastrou no CRM. É o "cadastrar no CRM significa que vai começar o
   *  atendimento" pedido na reunião. */
  | "CADASTRO_CRM"
  /** A IA abriu a ficha durante a conversa no WhatsApp. */
  | "IA_WHATSAPP"
  /** Carga de sistema antigo. */
  | "IMPORTACAO"
  /** scripts/backfill-brinco.mts, sobre lead que já existia. */
  | "BACKFILL";

export type EntradaBrinco = {
  /** O texto de origem que o caminho JÁ grava hoje ("ZAP", "CANAL_PRO",
   *  "WHATSAPP", o que a pessoa digitou). Continua sendo gravado: é a auditoria
   *  da classificação. */
  origem: string | null | undefined;
  via: BrincoVia;
  /** A campanha, quando quem chama conseguiu resolvê-la (ver `campanhaPorChave`). */
  campanhaId?: number | null;
  /** Quem TROUXE o lead. Ver `Lead.originadoPorId` — não é quem vai atender. */
  originadoPorId?: number | null;
  /** Injetável para o teste; nunca passar em produção. */
  agora?: Date;
};

export type Brinco = {
  /** Continua sendo gravado, com o mesmo texto de sempre. */
  origem: string;
  canalOrigem: CanalOrigem;
  origemDetalhe: string | null;
  campanhaId: number | null;
  originadoPorId: number | null;
  brincoEm: Date;
  brincoVia: BrincoVia;
};

/**
 * `CanalLead` (a régua de leitura, lib/origem-lead.ts) → `CanalOrigem` (a
 * coluna).
 *
 * Os nomes coincidem para os seis canais que existem nos dois. `PLACA` e
 * `IMPORTACAO` só existem na coluna: `procedenciaDoLead` não os conhece, e
 * acrescentá-los lá mudaria o tipo `CanalLead`, que já é consumido pelos
 * relatórios. Eles são resolvidos abaixo, ANTES de a régua ser consultada.
 */
const DO_CANAL_LEAD: Record<CanalLead, CanalOrigem> = {
  PORTAL: "PORTAL",
  META: "META",
  WHATSAPP: "WHATSAPP",
  SITE: "SITE",
  INDICACAO: "INDICACAO",
  DESCONHECIDO: "DESCONHECIDO",
};

/** Textos de origem que significam placa na rua. */
const PLACA = new Set(["PLACA", "PLACA_NA_RUA", "FACHADA"]);

/**
 * O brinco de um lead que está entrando. PURA.
 *
 * Nunca devolve `canalOrigem: null`: quem passa por aqui foi classificado, e
 * `DESCONHECIDO` é a resposta honesta quando o texto não bate com nada. O
 * `NULL` da coluna fica reservado para o lead ANTIGO, que nunca passou por
 * aqui — a distinção que o `@default("SITE")` de `Lead.origem` destruiu e que
 * este desenho existe para recuperar.
 */
export function montarBrinco(e: EntradaBrinco): Brinco {
  const o = (e.origem ?? "").trim().toUpperCase();

  const canal: CanalOrigem = !o
    ? // Origem vazia numa carga é IMPORTACAO; em qualquer outro caminho é
      // DESCONHECIDO. Nenhum dos dois vira SITE — foi o `@default("SITE")` de
      // `Lead.origem` que fez "não sabemos" virar "veio do site próprio",
      // justamente no relatório que existe para provar que o site cresce.
      e.via === "IMPORTACAO"
      ? "IMPORTACAO"
      : "DESCONHECIDO"
    : PLACA.has(o)
      ? "PLACA"
      : DO_CANAL_LEAD[procedenciaDoLead(o).canal];

  return {
    // O texto cru fica, em caixa alta — é o vocabulário que os quatro caminhos
    // já usam, e a auditoria da classificação. Vazio continua virando o default
    // histórico da coluna: mudar isso reescreveria o sentido de linhas antigas.
    origem: o || "SITE",
    canalOrigem: canal,
    // O detalhe é o que o enum não carrega: QUAL portal, QUAL rede, que texto a
    // pessoa digitou. Só existe quando ACRESCENTA — origem "SITE" dentro de
    // `canalOrigem: SITE` é ruído numa coluna que serve para filtrar, e origem
    // "PORTAL" não diz qual portal é.
    origemDetalhe: o && o !== canal ? o : null,
    campanhaId: e.campanhaId ?? null,
    originadoPorId: e.originadoPorId ?? null,
    brincoEm: e.agora ?? new Date(),
    brincoVia: e.via,
  };
}

/** O lead está marcado? A pergunta que o gate faz. */
export function temBrinco(lead: { brincoEm?: Date | null } | null | undefined): boolean {
  return Boolean(lead?.brincoEm);
}

// ─── O GATE: "sem brinco, a IA não atende" ──────────────────────────────────
//
// ⚠️  LEIA ANTES DE MEXER NA POLARIDADE.
//
// Hoje o padrão do sistema é ATENDER. lib/conversas.ts só cala a IA num número
// inédito quando a uazapi CONFIRMA que o aparelho já falava com o contato — e
// quando a checagem falha, atende assim mesmo, por escolha deliberada e escrita
// ("entre os dois erros, o recuperável").
//
// Inverter isso para "sem brinco não atende" NO NÚMERO CENTRAL cala a IA para a
// maior parte do atendimento — quem chama espontaneamente — SEM SINAL NENHUM NA
// TELA. Nada fica vermelho, nenhuma exceção sobe, e o silêncio só aparece no
// faturamento do mês seguinte.
//
// As três defesas, e nenhuma delas é opcional:
//
//   1. `exigirBrinco` é POR INSTÂNCIA e nasce `false`. Liga-se no WhatsApp
//      PESSOAL do corretor (onde chega mensagem de família — o caso levantado
//      na reunião), uma instância de cada vez. Nunca por configuração de tenant,
//      nunca global.
//   2. Instância que não informou `exigirBrinco` é tratada como `false`. Quem
//      não pediu o gate não pode ser calado por ele — nem por um `Pick` que
//      esqueceu o campo, nem por um mock de teste.
//   3. Calar SEMPRE deixa rastro: `motivo` volta preenchido e quem chama grava
//      `IA_CALADA_SEM_BRINCO` na auditoria, com o lead (ou a falta dele). Trava
//      que age em silêncio é trava que ninguém desfaz, porque ninguém descobre.

export type EntradaGate = {
  /** `InstanciaWhatsApp.exigirBrinco`. Ausente = `false`. */
  exigirBrinco?: boolean | null;
  /** O contato tem lead marcado? */
  temBrinco: boolean;
  /** O veredito que já existe hoje: o aparelho já falava com esse contato. */
  jaFalavaAntes: boolean;
  /** Para o texto da auditoria: qual lead foi olhado, se houve algum. */
  leadId?: number | null;
  /** A leitura do lead FALHOU (banco fora, timeout) — diferente de "não achou".
   *
   *  Aqui a escolha é OPOSTA à do histórico da uazapi, e de propósito. Lá,
   *  dúvida faz atender: errar atendendo um cliente antigo a equipe conserta
   *  assumindo a conversa. Aqui, `exigirBrinco` só está ligado no WhatsApp
   *  PESSOAL do corretor — o aparelho onde ele mesmo está olhando a tela. Um
   *  lead que ficou sem resposta ele responde; a IA respondendo a mãe dele é o
   *  defeito que o cliente pediu para não existir, e esse não tem conserto.
   *
   *  O que não pode acontecer é o motivo MENTIR: falha de leitura registrada
   *  como "nenhum lead casou" manda quem for depurar procurar o lead errado. */
  leituraFalhou?: boolean;
};

export type DecisaoGate = {
  /** A conversa nasce com a IA pausada? */
  pausar: boolean;
  /** Preenchido SÓ quando foi o brinco que calou — é o que vira auditoria.
   *  `null` quando a IA segue, e também quando quem calou foi o histórico
   *  (esse caso já tem o rastro dele). */
  motivo: string | null;
};

export function decidirGateBrinco(e: EntradaGate): DecisaoGate {
  // O histórico continua mandando primeiro, e sem mudança nenhuma: quem já
  // falava com o aparelho não é lead novo, tenha brinco ou não.
  if (e.jaFalavaAntes) return { pausar: true, motivo: null };

  // Instância que não pediu o gate atende como sempre atendeu. `?? false` e não
  // `?? true`: a ausência do dado NUNCA pode virar silêncio.
  if (!e.exigirBrinco) return { pausar: false, motivo: null };

  if (e.temBrinco) return { pausar: false, motivo: null };

  if (e.leituraFalhou)
    return {
      pausar: true,
      motivo: "NÃO DEU PARA LER o lead deste telefone (banco/timeout) — não é ausência de brinco",
    };

  return {
    pausar: true,
    motivo:
      e.leadId == null
        ? "sem brinco: nenhum lead casou com este telefone"
        : `sem brinco: lead ${e.leadId} existe mas está sem marcação (brincoEm nulo)`,
  };
}

// ─── A parte que TOCA O BANCO ───────────────────────────────────────────────
//
// Fica no mesmo arquivo que a parte pura, no molde de lib/distribuicao.ts: a
// decisão é conferível sem banco, e quem chama tem um import só para lembrar.

/**
 * A campanha ATIVA daquele tenant cuja chave do lado de lá é esta.
 *
 * É por aqui que o `ad_id` da Meta ou o id do anúncio do portal viram campanha
 * sem ninguém digitar nada. Campanha desativada não casa: o lead entra sem
 * campanha em vez de entrar amarrado a uma verba que já não existe.
 */
export async function campanhaPorChave(
  imobiliariaId: number,
  chave: string | null | undefined
): Promise<{ id: number; donoId: number | null } | null> {
  const c = (chave ?? "").trim();
  if (!c) return null;
  return prisma.campanha.findFirst({
    where: { imobiliariaId, chaveExterna: c, ativa: true },
    select: { id: true, donoId: true },
  });
}

/**
 * O brinco, com a campanha resolvida pela chave externa quando houver uma.
 *
 * `originadoPorId` HERDA o dono da campanha quando quem chama não informou um:
 * é o que faz "de qual corretor veio esse lead" ser respondido sem digitação —
 * lead que entra pela campanha do Marco nasce originado pelo Marco.
 *
 * Nunca joga: é chamada de dentro do webhook do portal, e uma exceção aqui
 * derrubaria a gravação do lead, que é a parte que não pode falhar. Campanha
 * que não resolve devolve lead SEM campanha, nunca lead nenhum.
 */
export async function resolverBrinco(
  e: EntradaBrinco & { imobiliariaId: number; chaveCampanha?: string | null }
): Promise<Brinco> {
  const campanha = e.campanhaId
    ? null
    : await campanhaPorChave(e.imobiliariaId, e.chaveCampanha).catch(() => null);
  return montarBrinco({
    ...e,
    campanhaId: e.campanhaId ?? campanha?.id ?? null,
    originadoPorId: e.originadoPorId ?? campanha?.donoId ?? null,
  });
}

/**
 * Este telefone tem lead marcado? A leitura que o gate faz.
 *
 * Casa pela régua de `lib/lead-telefone.ts` (sufixo + `mesmoTelefone`), nunca
 * por igualdade de texto: o mesmo celular chega como "5517999998888" pelo
 * portal, "17999998888" por formulário e "(17) 99999-8888" digitado à mão.
 * Igualdade exata aqui devolveria "sem brinco" para um lead marcado — e num
 * número com `exigirBrinco` isso é a IA calando sobre um cliente pago.
 *
 * Nunca joga: falha de banco devolve `{ temBrinco: false, leadId: null,
 * falhou: true }`, e quem chama decide. `decidirGateBrinco` só cala quando
 * `exigirBrinco` está ligado — então uma falha aqui não pode calar o número
 * central, e no número do corretor o rastro sai na auditoria.
 */
export async function brincoDoContato(params: {
  imobiliariaId: number;
  telefone: string | null | undefined;
}): Promise<{ temBrinco: boolean; leadId: number | null; falhou: boolean }> {
  try {
    const lead = await leadPorTelefone(params.imobiliariaId, params.telefone);
    return {
      temBrinco: temBrinco(lead as { brincoEm?: Date | null } | null),
      leadId: lead?.id ?? null,
      falhou: false,
    };
  } catch (erro) {
    // Instrumentar antes de teorizar: sem esta linha, "a IA parou de responder
    // no número do Marco" vira caça a bug de prompt.
    console.error(`[brinco ${params.telefone}] não deu para ler o lead:`, erro);
    return { temBrinco: false, leadId: null, falhou: true };
  }
}

/**
 * O rastro do silêncio.
 *
 * Toda vez que o gate cala a IA, alguém precisa conseguir descobrir isso sem
 * abrir o banco. `IA_PAUSADA_ROBO` já segue esse padrão em lib/conversas.ts;
 * esta é a irmã dela.
 */
export async function registrarSilencioDoBrinco(params: {
  conversaId: number;
  imobiliariaId: number;
  instanciaId: number;
  motivo: string;
}) {
  const { auditar } = await import("@/lib/auditoria");
  await auditar(
    "IA_CALADA_SEM_BRINCO",
    "Conversa",
    params.conversaId,
    `instância ${params.instanciaId} exige brinco — ${params.motivo}`,
    params.imobiliariaId
  ).catch(() => {});
}

/**
 * O brinco de um lead que a IA está abrindo no meio de uma conversa.
 *
 * Os dois caminhos de IA (`registrar_lead` e `registrar_interesse_compra`)
 * gravavam `origem: "WHATSAPP"` fixo e mais nada. Aqui eles ganham duas coisas
 * que só a conversa sabe:
 *
 *  · A PROCEDÊNCIA REAL. `Conversa.canal` guarda o portal quando o contato veio
 *    de um (o webhook do portal grava isso). Carimbar "WHATSAPP" por cima
 *    apagaria a origem paga — é a mesma perda que `lib/lead-telefone.ts` existe
 *    para evitar do outro lado. Só se aproveita o canal quando ele é PORTAL de
 *    verdade: "PAINEL" e os outros valores continuam virando WHATSAPP, que é o
 *    que eles são.
 *
 *  · QUEM TROUXE. `InstanciaWhatsApp.usuarioId` é "um corretor, um número". Se
 *    a mensagem entrou pelo WhatsApp do Marco, foi o Marco que trouxe o lead —
 *    o cenário do anúncio que cai direto no número do vendedor. É a resposta
 *    ao "o gestor precisa saber que esse lead veio desse corretor".
 *
 * Devolve as colunas prontas para o spread dentro do `create`. Nunca joga: uma
 * falha ao ler a instância vira lead sem `originadoPorId`, nunca lead nenhum.
 */
export async function brincoDaConversa(conversa: {
  imobiliariaId: number;
  instanciaId: number;
  canal?: string | null;
}): Promise<Omit<Brinco, "campanhaId"> & { campanhaId: number | null }> {
  const { ehDePortal } = await import("@/lib/etiqueta-origem");
  const canal = (conversa.canal ?? "").trim();
  const origem = ehDePortal(canal) ? canal.toUpperCase() : "WHATSAPP";

  const dono = await prisma.instanciaWhatsApp
    .findUnique({ where: { id: conversa.instanciaId }, select: { usuarioId: true } })
    .catch(() => null);

  return montarBrinco({
    origem,
    via: "IA_WHATSAPP",
    originadoPorId: dono?.usuarioId ?? null,
  });
}

// De onde o lead veio — uma resposta só, para todos os leads.
//
// ─── O PROBLEMA ─────────────────────────────────────────────────────────────
//
// `Lead.origem` é `String` com default "SITE", e é escrita por QUATRO caminhos
// que não se falam:
//
//   · webhook de portal   → "ZAP", "VIVAREAL", "OLX", "IMOVELWEB"
//   · e-mail de portal    → o mesmo, deduzido do domínio do remetente
//   · Lead Ads da Meta    → "FACEBOOK"
//   · a IA no WhatsApp    → "WHATSAPP"
//   · cadastro à mão      → o que a pessoa digitar, ou "SITE" por omissão
//
// Cada relatório que lê esse campo inventa a própria régua. `site/origem.ts`
// tem uma lista de quatro nomes e joga TODO O RESTO em "outros" — e faz isso
// de propósito, errando para baixo, porque não dá para confiar no campo.
//
// O custo aparece na hora de decidir verba: "outros" junta o ZAP (portal que
// você paga por lead), o Facebook (mídia que você paga por clique) e a
// indicação (que não custa nada). Três economias diferentes num número só.
//
// ─── O QUE ESTE MÓDULO FAZ, E O QUE ELE NÃO PODE FAZER ──────────────────────
//
// Ele classifica o texto que existe hoje, num lugar só, para que todas as telas
// respondam igual. É a ponte para o dado que já está gravado.
//
// O que ele NÃO conserta: o campo continua sendo texto livre na escrita. A
// correção de verdade é coluna estruturada no momento em que o lead nasce — e
// ela vale para os leads NOVOS, não para os 100% que já estão no banco. Por
// isso os dois existem: este módulo para trás, coluna para frente.
//
// ─── A DISTINÇÃO QUE MUDA DECISÃO DE VERBA ──────────────────────────────────
//
// `pago` separa o que consome orçamento do que não consome, e `atribuivel`
// separa o que você pode rastrear até a campanha do que não pode.
//
// Portal é PAGO e NÃO atribuível: quem anuncia é o portal, não você. Nenhuma
// UTM sua vai chegar num lead do ZAP — o máximo que existe é `portalAnuncio`,
// que diz qual imóvel SEU o dinheiro do portal está vendendo. Isso é rastreio
// de imóvel, não de campanha, e é um dado bom que já está gravado.
//
// Meta Lead Ads é PAGO e atribuível: o anúncio é seu, e o lead pode carregar
// id de campanha — hoje não carrega, e é aí que a atribuição de mídia paga
// começa.

import { ORIGENS_DE_PORTAL } from "@/lib/etiqueta-origem";

/** O canal de onde o lead chegou, normalizado. */
export type CanalLead =
  | "PORTAL"
  | "META"
  | "WHATSAPP"
  | "SITE"
  | "INDICACAO"
  | "DESCONHECIDO";

export type Procedencia = {
  canal: CanalLead;
  /** Qual portal, quando `canal === "PORTAL"`. Ex.: "ZAP". */
  portal: string | null;
  /** Consome orçamento de mídia ou de assinatura de portal. */
  pago: boolean;
  /** Dá para ligar até a campanha que o trouxe, se o rastreio existir. */
  atribuivel: boolean;
  /** O texto original, preservado. Sem isto não há como auditar a régua. */
  bruto: string;
};

const META = new Set(["FACEBOOK", "INSTAGRAM", "META", "FACEBOOK_ADS", "LEAD_ADS"]);

// Os portais, DERIVADOS da lista que o lado da escrita já mantém
// (`ORIGENS_DE_PORTAL`, em lib/etiqueta-origem.ts). Não é preciosismo: esta
// lista era escrita à mão e já discordava da outra em duas entradas — trazia
// "CANALPRO" sem o underscore que `lib/portais.ts:294` grava, e não trazia
// "PORTAL". As duas origens caíam em DESCONHECIDO com `pago: false`, no módulo
// que existe para separar o que consome verba do que não consome — e o Canal
// Pro é justamente o portal que a imobiliária paga. Enquanto forem duas listas
// digitadas, elas voltam a divergir; derivada, a régua de leitura acompanha
// quem escreve.
//
// META sai da derivação porque FACEBOOK entra pelo webhook de portal mas NÃO é
// portal na régua de verba: o anúncio é seu, é atribuível até a campanha. É a
// única diferença deliberada entre as duas listas, e o teste
// `as duas réguas concordam` a fixa.
const PORTAIS = new Set(
  (ORIGENS_DE_PORTAL as readonly string[]).filter((o) => !META.has(o))
);

// Site próprio e landing. Mesma lista de app/(comercial)/site/origem.ts, que é
// a régua que a tela de migração de origem já usa — repetir com outro conteúdo
// faria as duas telas discordarem sobre o mesmo lead.
const DO_SITE = new Set(["SITE", "SITE_PROPRIO", "LANDING", "ORGANICO"]);

const INDICACAO = new Set(["INDICACAO", "INDICAÇÃO", "REFERRAL", "AMIGO"]);

const WHATSAPP = new Set(["WHATSAPP", "WPP", "ZAP_WHATSAPP"]);

/**
 * Classifica a origem de um lead.
 *
 * Origem vazia ou desconhecida vira `DESCONHECIDO` — nunca é empurrada para
 * SITE, que é o default da coluna. Essa distinção é o ponto: "não sabemos" e
 * "veio do site" são respostas diferentes, e tratá-las como iguais é o que faz
 * o site próprio parecer maior do que é, exatamente no relatório que existe
 * para provar que ele cresce.
 */
export function procedenciaDoLead(origem: string | null | undefined): Procedencia {
  const bruto = (origem ?? "").trim();
  const o = bruto.toUpperCase();

  if (o === "") return base("DESCONHECIDO", bruto);

  if (PORTAIS.has(o)) {
    // Pago (assinatura ou pacote de leads) e NÃO atribuível: a campanha é do
    // portal. O que dá para rastrear é o anúncio — `Lead.portalAnuncio`.
    //
    // "PORTAL" cru devolve `portal: null` porque é o guarda-chuva que
    // `origemDoCanalPro` grava quando o payload NÃO diz em qual portal a pessoa
    // estava. Repetir "PORTAL" no campo que responde "qual portal?" seria
    // fingir uma resposta; `null` é a resposta certa, e `bruto` guarda o texto.
    return { canal: "PORTAL", portal: o === "PORTAL" ? null : o, pago: true, atribuivel: false, bruto };
  }
  if (META.has(o)) {
    // Pago E atribuível: o anúncio é seu. Falta o elo (id de campanha no lead).
    return { canal: "META", portal: null, pago: true, atribuivel: true, bruto };
  }
  if (WHATSAPP.has(o)) {
    // Não é canal de aquisição: é a PORTA por onde a pessoa entrou. Ela pode ter
    // vindo de um anúncio, de uma placa ou de um amigo, e o WhatsApp não sabe
    // qual. Marcado como não atribuível para não fingir que sabe.
    return { canal: "WHATSAPP", portal: null, pago: false, atribuivel: false, bruto };
  }
  if (DO_SITE.has(o)) {
    // Atribuível: é a única entrada onde uma UTM sua chegaria — quando houver
    // página pública. Hoje não há, então o campo virá vazio e tudo bem.
    return { canal: "SITE", portal: null, pago: false, atribuivel: true, bruto };
  }
  if (INDICACAO.has(o)) {
    return { canal: "INDICACAO", portal: null, pago: false, atribuivel: false, bruto };
  }

  // Texto que ninguém previu — cadastro à mão com o que a pessoa digitou.
  // Vira DESCONHECIDO e preserva o bruto, para alguém ler a lista e decidir se
  // vira regra. Adivinhar aqui é como o campo ficou impossível de auditar.
  return base("DESCONHECIDO", bruto);
}

function base(canal: CanalLead, bruto: string): Procedencia {
  return { canal, portal: null, pago: false, atribuivel: false, bruto };
}

/** Rótulo para a tela. */
export const ROTULO_CANAL: Record<CanalLead, string> = {
  PORTAL: "Portais",
  META: "Meta (Facebook/Instagram)",
  WHATSAPP: "WhatsApp direto",
  SITE: "Site próprio",
  INDICACAO: "Indicação",
  DESCONHECIDO: "Origem não informada",
};

/**
 * Agrupa leads por canal, somando quantos e quantos fecharam.
 *
 * Devolve TODOS os canais que apareceram, inclusive DESCONHECIDO. Esconder o
 * desconhecido faz os percentuais fecharem em 100% mentindo — e é justamente o
 * tamanho dele que diz se vale confiar no resto do relatório.
 */
export function porCanal(
  leads: { origem: string | null; fechado: boolean }[]
): { canal: CanalLead; rotulo: string; leads: number; fechados: number; pago: boolean }[] {
  const mapa = new Map<CanalLead, { leads: number; fechados: number; pago: boolean }>();
  for (const l of leads) {
    const p = procedenciaDoLead(l.origem);
    const atual = mapa.get(p.canal) ?? { leads: 0, fechados: 0, pago: p.pago };
    atual.leads++;
    if (l.fechado) atual.fechados++;
    mapa.set(p.canal, atual);
  }
  return [...mapa.entries()]
    .map(([canal, v]) => ({ canal, rotulo: ROTULO_CANAL[canal], ...v }))
    .sort((a, b) => b.fechados - a.fechados || b.leads - a.leads);
}

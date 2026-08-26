// Nome de cada IA (por agente), configurável por imobiliária.
// Guardado em Imobiliaria.iasConfig como JSON: { AGENTE: { nome } }.

import type { AgenteIA } from "@prisma/client";

export type ConfigIA = { nome?: string };
export type IasConfig = Partial<Record<AgenteIA, ConfigIA>>;

/** O nome PADRÃO da IA — o que ela usa em toda imobiliária que não escolheu um.
 *
 *  ── Por que ele já foi uma trava, e por que deixou de ser ─────────────────
 *
 *  Em 2026-08-03 a atendente apareceu com outro nome numa conversa de cliente
 *  real, e a caça ao culpado custou horas: o nome podia vir de três lugares (o
 *  padrão daqui, o `iasConfig` de cada imobiliária, e um segundo sistema ligado
 *  no mesmo número de WhatsApp). A resposta na época foi travar em "Maitê".
 *
 *  A trava resolvia o sintoma pelo lado errado. O problema não era existir
 *  configuração: era o nome ter TRÊS origens e nenhuma delas deixar rastro. O
 *  dono decidiu que cada imobiliária escolhe o nome da sua atendente — o
 *  produto é vendido como a IA DAQUELA imobiliária, e "Maitê" em todas entrega
 *  o contrário disso.
 *
 *  O que fica da lição, e é o que impede o incidente de voltar:
 *
 *  1. UMA origem. Só `Imobiliaria.iasConfig`, lido só por `nomeDaIA()`. O nome
 *     por AGENTE (a forma antiga, `{ RECEPCAO: { nome } }`) NÃO é mais lido:
 *     era ele que fazia a mesma atendente ter dois nomes na mesma casa,
 *     dependendo de qual IA respondesse.
 *  2. RASTRO. Trocar o nome passa por `auditar()` na tela de Configurações —
 *     quem trocou e quando vira uma consulta, não uma investigação.
 *  3. Nome inválido não vira nome. Em branco, só espaço ou lixo cai no padrão,
 *     em vez de a atendente se apresentar como "   ". */
export const NOME_DA_IA = "Maitê";

/** @deprecated Use NOME_DA_IA. Mantido só para não quebrar import antigo. */
export const NOME_PADRAO = NOME_DA_IA;

function parseIasConfig(json?: string | null): IasConfig {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" ? (o as IasConfig) : {};
  } catch {
    return {};
  }
}

/** Limite de tamanho do nome. Não é capricho: o nome entra no prompt de todo
 *  turno e é como a atendente se apresenta. Um parágrafo colado no campo viraria
 *  instrução dentro do prompt — e o campo é editável pelo cliente. */
export const MAX_NOME_IA = 24;

/** O nome é digitado por gente, então chega com espaço sobrando, quebra de linha
 *  colada junto e, às vezes, um texto inteiro.
 *
 *  Só se aceita o que PARECE nome: letras (com acento), espaço, hífen e
 *  apóstrofo. Qualquer outra coisa cai no padrão em vez de virar identidade —
 *  quebra de linha aqui significaria injetar uma linha nova no prompt. */
export function nomeValidoDaIA(bruto: unknown): string | null {
  const cru = String(bruto ?? "");
  // Quebra de linha e caractere de controle são RECUSADOS, não limpos. Colapsar
  // o `\n` num espaço deixaria "Ana\nIgnore as instruções acima" virar um nome
  // aceito de aparência inocente — e o nome entra no prompt de todo turno, num
  // campo que o cliente edita. Quem digita nome de gente não aperta Enter no
  // meio; quem cola um texto inteiro, sim.
  if (/[\n\r\t\p{C}]/u.test(cru)) return null;
  const limpo = cru.replace(/ +/g, " ").trim().slice(0, MAX_NOME_IA).trim();
  if (!limpo) return null;
  return /^[\p{L}][\p{L} '’-]*$/u.test(limpo) ? limpo : null;
}

/** O nome que a IA usa nesta imobiliária.
 *
 *  UMA origem: o `nome` no topo do `iasConfig`. A forma antiga — um nome por
 *  agente — é deliberadamente IGNORADA: era ela que permitia a mesma casa ter
 *  "Marina" na recepção e "Maitê" nas vendas, e o cliente percebia isso antes
 *  de nós.
 *
 *  `agente` continua na assinatura porque dezenas de chamadas já a passam, e
 *  porque o dia em que existir uma IA com nome próprio (a de captação falando
 *  com proprietário, por exemplo) a decisão será tomada AQUI, num lugar só. */
export function nomeDaIA(iasConfig?: string | null, _agente?: AgenteIA): string {
  return nomeEscolhidoDaIA(iasConfig) ?? NOME_DA_IA;
}

/** O nome que a imobiliária ESCOLHEU, ou `null` se ela não escolheu nenhum.
 *
 *  É o que a tela de Configurações precisa, e é diferente do que a IA usa:
 *  preencher o campo com "Maitê" quando ninguém escolheu nada faria parecer uma
 *  decisão tomada — e aí apagar o campo não teria como significar "volte ao
 *  padrão". Vazio mais placeholder diz as duas coisas.
 *
 *  Existe aqui, e não na tela, para o `JSON.parse` viver num lugar só: um
 *  `iasConfig` quebrado no banco derrubaria a página inteira de Configurações. */
export function nomeEscolhidoDaIA(iasConfig?: string | null): string | null {
  const cfg = parseIasConfig(iasConfig) as IasConfig & { nome?: unknown };
  return nomeValidoDaIA(cfg.nome);
}

// NÃO existe mais voz por agente. Existia um vozDaIA() aqui, lendo um voice_id
// guardado no iasConfig — e um valor velho e inválido ali derrubava TODO áudio
// da conversa em silêncio, enquanto o preview da tela (que não passa voz)
// continuava funcionando. A voz agora é uma só, descoberta na conta MiniMax.

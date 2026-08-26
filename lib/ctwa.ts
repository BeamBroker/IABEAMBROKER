// CLIQUE-PARA-WHATSAPP: o anúncio que trouxe a pessoa, lido da mensagem.
//
// ─── O QUE ISTO RESOLVE ─────────────────────────────────────────────────────
//
// FACEBOOK é a maior origem de leads da casa, e é a única para a qual não
// existe atribuição de anúncio nenhuma. As seis colunas que guardariam isso —
// `metaAnuncioId`, `metaConjuntoId`, `metaCampanhaId`, `metaFormularioId`,
// `metaLeadId`, `metaCtwaClid` — existem no schema desde a migration
// 20260811200000, com índice e `@@unique`, e NENHUMA linha de código as escreve.
//
// Quando alguém clica em "Enviar mensagem" num anúncio do Facebook ou do
// Instagram, a PRIMEIRA mensagem que chega carrega o anúncio de origem. É a
// única chance: da segunda em diante o contexto some. Perder essa mensagem é
// perder a atribuição daquele cliente para sempre.
//
// ─── DOIS DIALETOS, PORQUE A PONTE PODE NORMALIZAR ──────────────────────────
//
//  · WhatsApp Web / Baileys (o que a uazapi fala): o anúncio vem em
//    `contextInfo.externalAdReply` — `sourceId` (o id do anúncio), `sourceUrl`,
//    `ctwaClid` nas versões novas.
//  · Cloud API oficial: vem em `referral` — `source_id`, `source_url`,
//    `ctwa_clid`.
//
// Os dois são procurados porque não se sabe qual a uazapi repassa, e a resposta
// muda com a versão do servidor. Ler os dois custa nada; ler um só custa a
// atribuição inteira no dia em que ela mudar de dialeto.
//
// ─── POR QUE A BUSCA É EM PROFUNDIDADE ──────────────────────────────────────
//
// O envelope da uazapi varia: a mensagem chega na raiz, em `data`, em
// `data.message`, ou dentro de uma lista. `lib/payload-uazapi.ts` já documenta
// esse pântano em 80 linhas. Fixar um caminho aqui seria escolher um formato
// entre quinze e perder os outros catorze em silêncio — que é o defeito mais
// caro possível neste arquivo, porque ele não quebra nada: só devolve `null` e
// a atribuição some.
//
// A busca tem TETO de profundidade e de nós visitados: payload malformado (ou
// com ciclo) não pode virar laço infinito dentro do webhook.
//
// ─── SÓ LÊ. NÃO DECIDE, NÃO ESCREVE, NÃO CHAMA REDE ─────────────────────────
//
// Mesma regra de lib/payload-uazapi.ts, e pelo mesmo motivo: dá para testar o
// entendimento do payload sem banco e sem ambiente.

/** O anúncio de origem de uma mensagem de clique-para-WhatsApp. */
export type AnuncioDeOrigem = {
  /** `Lead.metaCtwaClid`. É ELE que se devolve à Meta na Conversions API para
   *  a venda ser atribuída ao anúncio — sem ele o algoritmo continua otimizando
   *  por quem clica em vez de por quem fecha. */
  ctwaClid: string | null;
  /** `Lead.metaAnuncioId`. A chave que junta o lead ao GASTO que lib/meta.ts já
   *  lê da Graph API — é ela que fecha CPL e custo por venda POR ANÚNCIO. */
  anuncioId: string | null;
  /** O link do anúncio, quando veio. Serve para conferência humana. */
  sourceUrl: string | null;
  /** O título do criativo, quando veio. Só para quem lê o log. */
  titulo: string | null;
  /** Qual dialeto reconheceu. Diagnóstico: diz se a ponte normaliza ou não. */
  dialeto: "externalAdReply" | "referral";
};

const PROFUNDIDADE_MAX = 12;
const NOS_MAX = 4000;

/** Texto útil, com teto. Id e clid são opacos; o que dá para exigir é que sejam
 *  curtos, sem espaço, e não vazios. Um valor com espaço é frase, não id. */
function chave(v: unknown, teto: number): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > teto || /\s/.test(t)) return null;
  return t;
}

function texto(v: unknown, teto = 300): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= teto ? t : null;
}

type Obj = Record<string, unknown>;

/**
 * Procura, em largura e com teto, o primeiro objeto que tenha alguma das
 * chaves pedidas. Devolve o VALOR da chave encontrada.
 */
function procurar(raiz: unknown, chaves: string[]): { valor: Obj; nome: string } | null {
  if (!raiz || typeof raiz !== "object") return null;
  const fila: Array<{ no: unknown; nivel: number }> = [{ no: raiz, nivel: 0 }];
  const vistos = new Set<unknown>();
  let visitados = 0;

  while (fila.length) {
    const { no, nivel } = fila.shift()!;
    if (!no || typeof no !== "object") continue;
    if (vistos.has(no)) continue; // payload com ciclo não vira laço infinito
    vistos.add(no);
    if (++visitados > NOS_MAX || nivel > PROFUNDIDADE_MAX) continue;

    if (!Array.isArray(no)) {
      const o = no as Obj;
      for (const nome of chaves) {
        const v = o[nome];
        if (v && typeof v === "object" && !Array.isArray(v)) return { valor: v as Obj, nome };
      }
    }

    for (const filho of Array.isArray(no) ? no : Object.values(no as Obj)) {
      if (filho && typeof filho === "object") fila.push({ no: filho, nivel: nivel + 1 });
    }
  }
  return null;
}

/**
 * O anúncio de origem desta mensagem, ou `null` quando não há um.
 *
 * `null` é a resposta normal e esperada: a esmagadora maioria das mensagens não
 * vem de anúncio. Quem chama NÃO deve tratar `null` como erro — nem logar, nem
 * alertar. O que vale medir é quantas vezes ele NÃO é null.
 *
 * Nunca joga: payload torto devolve `null`, nunca exceção. Este parser roda no
 * caminho de toda mensagem recebida, e uma exceção aqui derrubaria atendimento
 * por causa de um campo de marketing.
 */
export function anuncioDaMensagem(payload: unknown): AnuncioDeOrigem | null {
  try {
    // Baileys primeiro: é o dialeto que a uazapi fala hoje.
    const ext = procurar(payload, ["externalAdReply"]);
    if (ext) {
      const o = ext.valor;
      const achado: AnuncioDeOrigem = {
        // `ctwaClid` pode estar no irmão (`contextInfo`) em vez de dentro do
        // `externalAdReply`, dependendo da versão. Procurado nos dois.
        ctwaClid: chave(o.ctwaClid ?? o.ctwa_clid, 512) ?? clidSolto(payload),
        anuncioId: chave(o.sourceId ?? o.source_id, 64),
        sourceUrl: texto(o.sourceUrl ?? o.source_url, 2000),
        titulo: texto(o.title ?? o.headline),
        dialeto: "externalAdReply",
      };
      // Bloco de anúncio sem NENHUMA chave utilizável não é atribuição: é
      // ruído. Devolver um objeto todo nulo faria a medição contar como
      // sucesso o que não serve para nada.
      return achado.ctwaClid || achado.anuncioId ? achado : null;
    }

    // Cloud API oficial. Fica depois porque a chave `referral` é genérica o
    // bastante para aparecer em outros contextos; só conta quando traz id.
    const ref = procurar(payload, ["referral"]);
    if (ref) {
      const o = ref.valor;
      const achado: AnuncioDeOrigem = {
        ctwaClid: chave(o.ctwa_clid ?? o.ctwaClid, 512) ?? clidSolto(payload),
        anuncioId: chave(o.source_id ?? o.sourceId, 64),
        sourceUrl: texto(o.source_url ?? o.sourceUrl, 2000),
        titulo: texto(o.headline ?? o.title),
        dialeto: "referral",
      };
      return achado.ctwaClid || achado.anuncioId ? achado : null;
    }

    // Nem um nem outro, mas o clid pode ter sido promovido para a raiz por uma
    // ponte que "simplificou" o payload. Ele sozinho já vale: é a chave da
    // Conversions API.
    const solto = clidSolto(payload);
    return solto
      ? { ctwaClid: solto, anuncioId: null, sourceUrl: null, titulo: null, dialeto: "referral" }
      : null;
  } catch {
    return null;
  }
}

/** O `ctwaClid` em qualquer lugar do payload, quando não veio no bloco. */
function clidSolto(payload: unknown): string | null {
  const cru = (() => {
    try {
      return JSON.stringify(payload ?? {});
    } catch {
      return "";
    }
  })();
  const m = cru.match(/"(?:ctwaClid|ctwa_clid)"\s*:\s*"([^"\s]{4,512})"/);
  return m?.[1] ?? null;
}

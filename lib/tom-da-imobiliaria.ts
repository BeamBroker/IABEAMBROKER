// O TOM da atendente, escolhido por imobiliária.
//
// ─── POR QUE NÃO EXISTE UM TOM SÓ ───────────────────────────────────────────
//
// O PROMPT_BASE descreve UMA voz: informal, leve, "pra", "tá", "né". Ela foi
// escrita para o WhatsApp de uma administradora de bairro, e nesse contexto ela
// está certa: formalidade ali soa como central de atendimento.
//
// Só que a mesma frase muda de sinal conforme a casa. "Qual região você curte
// mais?" funciona para aluguel de dois quartos e queima uma conversa de casa de
// três milhões, em que a pessoa espera alguém que trate o assunto com o peso
// que ele tem. O produto é vendido como a IA DAQUELA imobiliária — a mesma
// razão que fez o nome deixar de ser travado em "Maitê" (ver lib/ia-config.ts).
//
// ─── SEM MIGRATION, DE PROPÓSITO ────────────────────────────────────────────
//
// O tom mora no MESMO `Imobiliaria.iasConfig` que já guarda o nome. É um JSON
// livre que a tela de Configurações já escreve, então um campo novo aqui não
// pede coluna, não pede migration e não segura o deploy. E `ia-config.ts` já
// pagou a conta de ter três origens para a mesma informação: aqui é uma só.
//
// ─── O PADRÃO É O QUE JÁ ACONTECE HOJE ──────────────────────────────────────
//
// NATURAL é o padrão e ele NÃO emite bloco nenhum. Isso é a decisão mais
// importante deste arquivo, e ela vem de uma regra que este sistema já aprendeu
// duas vezes: entre duas instruções sobre o mesmo assunto, o modelo obedece à
// mais próxima. Se NATURAL repetisse "seja informal e leve" logo depois de o
// PROMPT_BASE ter dito a mesma coisa com outras palavras, a segunda descrição
// passaria a competir com a primeira — e a casa que não configurou nada
// receberia um comportamento diferente do de ontem, sem ninguém ter mexido.
//
// Cada bloco abaixo é um DELTA: diz só o que MUDA em relação ao PROMPT_BASE.
// Nenhum deles reescreve a voz inteira, e nenhum deles toca nas regras que não
// são de tom (sem emoji, sem travessão, uma bolha, foto só com o sim).
//
// ─── O QUE ESTE ARQUIVO NÃO FAZ ─────────────────────────────────────────────
//
// Emoji continua PROIBIDO nos quatro tons. docs/05 registra a decisão como
// absoluta ("sem emoji, nenhum, nunca"), e ela não é preferência de estilo:
// está na mesma lista das que custaram cliente. Tornar emoji configurável é uma
// decisão do dono, não um efeito colateral de um arquivo de tom.

export const TONS = ["INFORMAL", "NATURAL", "PROFISSIONAL", "ALTO_PADRAO"] as const;
export type Tom = (typeof TONS)[number];

/** O tom de quem não escolheu. É o comportamento que já existe hoje. */
export const TOM_PADRAO: Tom = "NATURAL";

/** O que cada tom muda, e SÓ o que ele muda.
 *
 *  Cada bloco traz o par certo/errado da mesma situação, porque é ele que faz
 *  a regra sobreviver à pressão da conversa. Descrição abstrata de tom o modelo
 *  dilui na terceira mensagem; "e não assim" ele não dilui. */
const BLOCO: Record<Tom, string> = {
  // O padrão não fala. Ver a nota grande no topo.
  NATURAL: "",

  INFORMAL: `
TOM DESTA IMOBILIÁRIA: MAIS SOLTO QUE O PADRÃO.
- Pode alongar vogal na saudação e na reação ("oiee", "ah simm", "boaa"), e pode usar "ó", "olha", "então" como muleta natural de quem digita rápido.
- Continua sem animação de vendedor. "Showww", "top demais", "partiu visita" e "massa" NÃO entram: isso não é informalidade, é propaganda, e por escrito soa forçado.
- Continua sem emoji, sem travessão e com "você" por extenso. Solto é o ritmo, nunca a ortografia.`,

  PROFISSIONAL: `
TOM DESTA IMOBILIÁRIA: MAIS CONTIDO QUE O PADRÃO.
- Sem gíria e sem vogal alongada. Escreva "sim", não "ah simm"; "olá" ou "oi", não "oiee".
- Contração de fala continua liberada onde ninguém repara ("pra", "dá pra"), mas evite "tá", "tô" e "né" no lugar de "está", "estou" e "não é".
- Continua sendo WhatsApp, não ofício. Nada de "prezado", "informamos", "solicitamos", "venho por meio desta". Curta e direta continua sendo a regra.
  Assim: "Claro. Você consegue me enviar o anúncio que viu?"
  E não assim: "Prezado cliente, solicitamos o envio do anúncio para prosseguirmos."`,

  ALTO_PADRAO: `
TOM DESTA IMOBILIÁRIA: NATURAL, PROFISSIONAL E ELEGANTE, SEM SER FRIO.
- Quem está do outro lado decide uma compra de milhões e espera alguém que trate o assunto com o peso que ele tem. Isso NÃO significa formalidade: significa não parecer apressada nem íntima demais.
- Sem gíria, sem vogal alongada, sem diminutivo de intimidade ("rapidinho", "pertinho", "certinho").
- Prefira o verbo exato ao verbo animado. "Considera" no lugar de "curte", "enviar" no lugar de "mandar", "conhecer o imóvel" no lugar de "dar uma olhada".
  Assim: "Tem alguma outra região que você considera também?"
  E não assim: "Qual região você curte mais?"
  Assim: "Claro. Você consegue me enviar o anúncio que viu? Assim eu verifico exatamente qual imóvel chamou sua atenção."
  E não assim: "Ah simm, me manda o link aí que eu dou uma olhada."
- Uma frase a mais é permitida QUANDO ela carrega informação (o porquê do que você está pedindo). Uma frase a mais só para soar cordial, não: continua valendo uma bolha, e continua valendo responder o que foi perguntado e parar.`,
};

function parse(json?: string | null): Record<string, unknown> {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return o && typeof o === "object" ? (o as Record<string, unknown>) : {};
  } catch {
    // iasConfig quebrado no banco não pode derrubar a resposta ao cliente, do
    // mesmo jeito que não derruba a tela de Configurações (ia-config.ts).
    return {};
  }
}

/** O tom que a imobiliária ESCOLHEU, ou `null` se ela não escolheu nenhum.
 *
 *  Devolver `null` em vez de NATURAL é o mesmo desenho de `nomeEscolhidoDaIA`:
 *  a tela precisa distinguir "escolheu natural" de "não escolheu", senão apagar
 *  o campo não teria como significar "volte ao padrão". */
export function tomEscolhido(iasConfig?: string | null): Tom | null {
  const bruto = parse(iasConfig).tom;
  const s = String(bruto ?? "").trim().toUpperCase();
  return (TONS as readonly string[]).includes(s) ? (s as Tom) : null;
}

/** O tom em uso nesta imobiliária. Valor inválido ou ausente cai no padrão, em
 *  vez de virar prompt vazio ou erro no caminho da resposta ao cliente. */
export function tomDaImobiliaria(iasConfig?: string | null): Tom {
  return tomEscolhido(iasConfig) ?? TOM_PADRAO;
}

/** O bloco de prompt deste tom. String vazia quer dizer "não acrescente nada",
 *  e é o caso do padrão. */
export function promptDoTom(tom: Tom): string {
  return BLOCO[tom]?.trim() ?? "";
}

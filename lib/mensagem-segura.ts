// Última barreira antes do texto sair para o cliente final.
//
// Existiu por um motivo concreto: sem ANTHROPIC_API_KEY, a IA respondia a um
// cliente de verdade com "[modo demo: configure a ANTHROPIC_API_KEY para a IA
// operar de verdade]". Nome de variável de ambiente, no WhatsApp de quem quer
// comprar uma casa.
//
// A regra: NADA de infraestrutura chega ao cliente. Nem nome de variável, nem
// "modo demo", nem "cota", nem "plano", nem stack trace. O que o operador
// precisa saber vai para o log e para as telas internas — nunca para a conversa.
//
// Mas a regra tem um limite que custou caro: o julgamento é por SUBSTRING, e
// duas entradas da lista eram pedaço de palavra comum em português. "cota"
// engolia "cotação do seguro-fiança" — a frase mais esperada de uma IA de
// locação — e "claude" engolia "Claudemir". Como o descarte é da mensagem
// INTEIRA (paraOCliente abaixo), o cliente recebia a frase neutra no lugar da
// resposta que a IA tinha escrito certa. Ver PROIBIDOS_PALAVRA.

import { falaDeSistema } from "@/lib/fala-de-sistema";

// Termos que denunciam vazamento de infraestrutura. Case-insensitive.
const PROIBIDOS = [
  "anthropic",
  "api_key",
  "api key",
  "apikey",
  "modo demo",
  "variável de ambiente",
  "variavel de ambiente",
  "env var",
  "process.env",
  "openai",
  "prisma",
  "stack trace",
  "undefined",
  "null",
  "token de acesso",
  "plano contratado",
  "módulo não contratado",
  "modulo nao contratado",
  "uazapi",
  "elevenlabs",
  "minimax",
  "assinafy",
  "asaas",
  "vercel",
  "localhost",
];

// `null` e `undefined` ficam de fora da regra de palavra inteira DE PROPÓSITO.
// Nenhuma palavra portuguesa os contém, e eles aparecem grudados quando é
// vazamento de verdade — `nullPointerException`, `undefinedIndex` num stack
// trace colado. Exigir fronteira aqui só enfraqueceria a captura real.

// Termos que só vazam como PALAVRA INTEIRA.
//
// "cota" é o caso caro: a IA de locação fala "cotação do seguro-fiança" e
// "cotar" o dia todo, e o `includes` trocava a RESPOSTA INTEIRA pela neutra por
// causa de quatro letras. "claude" é o mesmo defeito com outra roupa —
// Claudemir, Claudete e Claudenir são nomes de cliente, e o cliente que se
// apresenta some da conversa.
//
// A fronteira NÃO pode ser \b: \w é [A-Za-z0-9_], "ç" fica de fora, e
// /\bcota\b/ CASA dentro de "cotação" — a correção ingênua não corrige nada.
// Por isso é \p{L}\p{N}, com flag u. Sem flag g: RegExp com g guarda lastIndex
// e .test() passa a alternar resultado entre chamadas.
const PROIBIDOS_PALAVRA = ["cota", "cotas", "claude"];
const PALAVRA_INTEIRA = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${PROIBIDOS_PALAVRA.join("|")})(?![\\p{L}\\p{N}])`,
  "iu"
);

// "cota" também é palavra de condomínio: cota extra, cota-parte, cota
// condominial. Isso é cobrança do cliente, não infraestrutura — some com o
// trecho antes de julgar. "cota mensal" e "sua cota de IA" seguem caindo.
// O g aqui é correto e necessário: `replace` reseta lastIndex, `test` não.
const COTA_DE_CONDOMINIO =
  /cotas?(?:[- ]parte|\s+(?:extra[\p{L}]*|condominial|ordin[\p{L}]*|extraordin[\p{L}]*|(?:d[oae]s?\s+)?condom[\p{L}]*))/giu;

export function contemVazamentoInterno(texto: string): boolean {
  const t = texto.toLowerCase();
  if (PROIBIDOS.some((p) => t.includes(p))) return true;
  return PALAVRA_INTEIRA.test(t.replace(COTA_DE_CONDOMINIO, " "));
}

// Resposta neutra quando não há o que dizer sem expor infraestrutura. Segue o
// tom da Maitê: curta, sem emoji e sem travessão.
export const RESPOSTA_NEUTRA =
  "Oi, aqui é a Maitê. Recebi sua mensagem, já te respondo por aqui.";

// Tira os trechos entre colchetes que carregam termo interno. É o formato em
// que a nota de diagnóstico costuma aparecer grudada na frase boa, então dá
// para salvar a frase em vez de descartar a mensagem inteira.
function semColchetesInternos(texto: string): string {
  return texto
    .replace(/\[[^\]]*\]/g, (trecho) => (contemVazamentoInterno(trecho) ? "" : trecho))
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Limpa o que dá para limpar; se ainda sobrar termo interno no texto, devolve a
// resposta neutra. Falhar para o lado de dizer pouco é sempre melhor do que
// mandar o nome de uma variável de ambiente para o cliente.
export function paraOCliente(texto: string): string {
  const limpo = semColchetesInternos(texto ?? "");
  if (!limpo) return RESPOSTA_NEUTRA;
  if (contemVazamentoInterno(limpo)) {
    console.error(
      "[VAZAMENTO-BLOQUEADO] resposta com termo interno foi substituída antes de sair:",
      limpo.slice(0, 300)
    );
    return RESPOSTA_NEUTRA;
  }

  // ── A FALA DE SISTEMA SÓ É MEDIDA AQUI. NÃO BLOQUEIA. ──────────────────
  //
  // "Não achei Damha na nossa carteira" não tem nome de variável nenhum: é
  // português perfeito contando ao cliente que existe uma consulta. O conserto
  // é o bloco NÃO NARRE O SISTEMA, no PROMPT_BASE; o que acontece aqui é a
  // medição de quanto ainda escapa.
  //
  // E é medição, e não bloqueio, por uma razão que este arquivo já pagou caro:
  // trocar a mensagem inteira pela neutra por causa de um padrão é o defeito do
  // "cota" engolindo "cotação do seguro-fiança". Metade destas frases tem uma
  // versão legítima a uma palavra de distância ("não achei casa disponível no
  // Centro" é a resposta CERTA), e o custo de silenciar a resposta boa é maior
  // que o da frase ruim. Se o log mostrar que continua saindo depois do prompt,
  // a decisão de bloquear passa a ter dado em cima. Hoje ela não tem.
  const fala = falaDeSistema(limpo);
  if (fala) {
    console.warn(
      `[FALA-DE-SISTEMA:${fala}] a resposta expôs o funcionamento interno ao cliente (não foi bloqueada):`,
      limpo.slice(0, 300)
    );
  }

  return limpo;
}

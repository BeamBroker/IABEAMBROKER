// Achar o bairro que a pessoa quis dizer.
//
// O caso real, em 03/08: o cliente pediu "São Diocleciano". O cadastro tem
// "Conjunto Habitacional São Deocleciano" — Deocleciano com E. A busca usava
// `contains`, que é substring literal, e "são diocleciano" não é substring de
// "conjunto habitacional são deocleciano". Resultado: a Maitê respondeu que não
// tinha nada, com DOIS apartamentos disponíveis naquele bairro, um deles dentro
// do valor pedido. E, pior, na mensagem seguinte ela inventou um bairro que não
// existe ("Santo Inocenciano") em vez de dizer que não tinha entendido.
//
// Três coisas quebram o `contains` num nome de bairro brasileiro, e todas as
// três aparecem naquele nome sozinho:
//
//   1. o prefixo genérico ("Conjunto Habitacional", "Jardim", "Residencial")
//      que o cadastro tem e o cliente nunca fala;
//   2. o acento, que quem digita no WhatsApp omite;
//   3. a letra trocada — de digitação ou de transcrição de áudio.
//
// Por isso a comparação é feita sobre o NÚCLEO do nome, sem acento e sem o
// genérico, tolerando erro pequeno de escrita. E quando não dá para ter certeza,
// a resposta é a LISTA de bairros parecidos que existem de verdade na carteira —
// para a IA perguntar "você quis dizer X?" em vez de inventar ou de negar.

// Prefixos e palavras que aparecem no cadastro e não na fala. "Jardim das
// Flores" e "Flores" são o mesmo bairro para quem procura casa.
const GENERICOS = [
  "conjunto habitacional",
  "conjunto residencial",
  "nucleo habitacional",
  "loteamento",
  "residencial",
  "condominio",
  "conjunto",
  "distrito",
  "recanto",
  "chacara",
  "chacaras",
  "jardim",
  "parque",
  "bairro",
  "setor",
  "nucleo",
  "cohab",
  "vila",
  "conj",
  "hab",
  "jd",
  "pq",
  "vl",
];

// O que a pessoa diz não é sempre um bairro: em Rio Preto ela diz "jk" e quer a
// Avenida Juscelino Kubitschek, que atravessa a cidade. O cadastro escreve
// "Avenida Presidente Juscelino K. de Oliveira" — com a abreviação — e o bairro
// daqueles imóveis é "Jardim Tarraf II". Nenhuma comparação de bairro liga uma
// coisa à outra: "jk" não se parece com "Jardim Tarraf", e "juscelino
// kubitschek" não é substring de "Juscelino K. de Oliveira".
//
// Por isso o apelido não vira "o bairro X". Ele vira TERMOS para procurar no
// ENDEREÇO, e o bairro sai de onde os imóveis daquela rua realmente estão.
//
// Para ACRESCENTAR um apelido: a chave é o que a pessoa digita (sem acento, sem
// "avenida"/"rua"), e os termos são pedaços que aparecem no endereço cadastrado.
// Prefira o termo mais distintivo e mais curto — "juscelino" acha tanto o nome
// inteiro quanto o abreviado. Termo genérico demais ("presidente", "avenida")
// casa com meia cidade e é pior que não achar.
export const APELIDOS: Record<string, { nome: string; termos: string[] }> = {
  jk: { nome: "Avenida Juscelino Kubitschek", termos: ["juscelino", "kubitschek"] },
  // Em Rio Preto, "Bady Bassitt" é a avenida que corta a cidade. Existe também
  // um BAIRRO "Eville Bady Bassitt" — na cidade vizinha de mesmo nome, na
  // Rodovia Transbrasiliana. Sem esta entrada a comparação de bairro casa com o
  // Eville e manda o cliente para outro município.
  "bady bassitt": { nome: "Avenida Bady Bassitt", termos: ["bady bassitt"] },
  bady: { nome: "Avenida Bady Bassitt", termos: ["bady bassitt"] },
};

// Tipo de logradouro: o cliente escreve "av jk", "avenida jk" ou só "jk". Some
// antes de procurar o apelido, senão a chave nunca bate.
const LOGRADOUROS = [
  "avenida",
  "alameda",
  "rodovia",
  "estrada",
  "travessa",
  "praca",
  "rua",
  "via",
  "rod",
  "al",
  "av",
  "r",
];

export function normalizar(texto: string): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // tira o acento, não a letra
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// O que sobra depois de tirar os genéricos. "Conjunto Habitacional São
// Deocleciano" vira "sao deocleciano".
//
// Se sobrar vazio (alguém cadastrou o bairro só como "Centro Residencial"), o
// normalizado inteiro volta — melhor comparar demais que não ter o que comparar.
export function nucleo(texto: string): string {
  let s = ` ${normalizar(texto)} `;
  for (const g of GENERICOS) s = s.replace(new RegExp(`\\s${g}\\s`, "g"), " ");
  const limpo = s.replace(/\s+/g, " ").trim();
  return limpo || normalizar(texto);
}

// Distância de edição. Iterativa e com duas linhas só — nome de bairro é curto,
// mas isto roda dentro de um laço sobre a carteira inteira.
export function distancia(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(atual[j - 1]! + 1, anterior[j]! + 1, anterior[j - 1]! + custo);
    }
    anterior = atual;
  }
  return anterior[b.length]!;
}

// Quanto erro de escrita é aceitável para uma palavra deste tamanho.
//
// Proporcional, e não um número fixo: em "Sé" um caractere de diferença é outro
// bairro; em "Deocleciano" é um dedo no teclado ao lado. Teto de 2 porque a
// partir daí começa a casar bairro com bairro — e oferecer o bairro errado é
// pior que perguntar.
function tolerancia(tamanho: number): number {
  if (tamanho <= 4) return 0;
  if (tamanho <= 7) return 1;
  return 2;
}

export function parecido(pedido: string, candidato: string): boolean {
  const a = nucleo(pedido);
  const b = nucleo(candidato);
  if (!a || !b) return false;
  if (a === b) return true;
  // Um contém o outro: "deocleciano" dentro de "sao deocleciano".
  if (b.includes(a) || a.includes(b)) return true;
  if (distancia(a, b) <= tolerancia(Math.max(a.length, b.length))) return true;
  // Palavra a palavra: "sao diocleciano" casa com "sao deocleciano" pelo termo
  // mais longo, que é o que de fato identifica o bairro. As curtas ("sao",
  // "dos", "de") são ignoradas justamente por casarem com tudo.
  const grandes = (s: string) => s.split(" ").filter((p) => p.length >= 5);
  for (const pa of grandes(a))
    for (const pb of grandes(b))
      if (pa === pb || distancia(pa, pb) <= tolerancia(Math.max(pa.length, pb.length)))
        return true;
  return false;
}

/** O que a pessoa disse, sem o tipo de logradouro. "av jk" e "avenida JK" → "jk". */
export function semLogradouro(texto: string): string {
  let s = ` ${normalizar(texto)} `;
  for (const l of LOGRADOUROS) s = s.replace(new RegExp(`\\s${l}\\s`, "g"), " ");
  return s.replace(/\s+/g, " ").trim();
}

/** Os termos para procurar no ENDEREÇO quando o que a pessoa disse não é bairro.
 *
 *  Devolve vazio quando não há o que procurar com segurança. O corte de 5 letras
 *  não é chute: `contains` com pedaço curto casa por acaso ("sul" está dentro de
 *  "Setsul", "vila" está dentro de meia carteira), e mandar o cliente para a rua
 *  errada é pior do que perguntar. Sigla curta só entra por APELIDOS, onde
 *  alguém decidiu conscientemente o que ela significa. */
export function termosDeRua(pedido: string): string[] {
  const chave = semLogradouro(pedido);
  if (!chave) return [];
  const apelido = APELIDOS[chave];
  if (apelido) return apelido.termos;
  return chave.split(" ").filter((p) => p.length >= 5);
}

/** O nome por extenso de um apelido conhecido, para tentar como bairro também.
 *  Custa uma comparação e cobre a carteira que batizou o bairro com o nome da
 *  avenida — acontece. */
export function nomeDoApelido(pedido: string): string | null {
  return APELIDOS[semLogradouro(pedido)]?.nome ?? null;
}

/** "região sul", "zona norte", "lado oeste": a pessoa disse uma REGIÃO, não um
 *  bairro. Devolve a região ("sul", "norte", "leste", "oeste") ou `null`.
 *
 *  Medido em 26/08, e é o segundo passo do mesmo atendimento que motivou a saída
 *  de área: "casa pra comprar até 200 mil na região sul". Nenhuma carteira grava
 *  "região sul" no campo bairro, então a comparação de bairro não acha nada e a
 *  busca terminava numa pergunta ("é o Setsul? o Solo Sagrado?") com 43 imóveis
 *  dentro do valor pedido esperando na carteira.
 *
 *  Região NÃO vira filtro: derivar "sul" das coordenadas esconderia a carteira,
 *  porque só 36% dos imóveis do tenant 3 têm latitude gravada (170 de 468). O que
 *  ela faz é DESLIGAR o filtro de bairro — a busca corre pelo resto (tipo, preço)
 *  e mostra o que existe, enquanto a IA pergunta o bairro de referência.
 *
 *  A palavra qualificadora é obrigatória: "sul" sozinho está dentro de "Setsul" e
 *  de "Zona Sul" cadastrado como bairro, e trocar um bairro real por uma região
 *  imaginária é o erro que este arquivo inteiro existe para evitar. */
export function regiaoCardinal(pedido: string): string | null {
  const s = normalizar(pedido);
  const m =
    s.match(/\b(?:regiao|zona|lado|parte)\s+(norte|sul|leste|oeste)\b/) ??
    s.match(/\b(norte|sul|leste|oeste)\s+da\s+cidade\b/);
  return m?.[1] ?? null;
}

/** "Damha" não é um bairro: é uma FAMÍLIA deles.
 *
 *  Medido em 26/08 numa conversa de cliente real (tenant 3, lead de R$ 2,3 mi):
 *
 *    cliente: "quero comprar uma casa no damha"
 *    Maitê:   "Não achei Damha na nossa carteira, nem como condomínio nem como
 *              bairro. Vou confirmar com a equipe se existe algo assim."
 *
 *  A carteira tem DOZE: Damha Fit, Damha III, Village Damha II, Village Damha 3,
 *  Parque Residencial Damha IV, Damha VI, Village Damha Mirassol IV. Nenhum se
 *  chama "Damha", então a comparação de nome inteiro não casa com nenhum — a
 *  distância de edição entre "damha" e "damha iv" já estoura a tolerância de um
 *  nome curto. E quando o cliente insistiu, a busca fixou UM deles e ela
 *  respondeu "não tenho mais nenhuma nos outros Damhas", com onze na prateleira.
 *
 *  Em Rio Preto isso é a regra, não a exceção: Damha, Gaivota, Quinta do Lago e
 *  Village são marcas com numeral romano atrás. Quem diz o nome da marca quer
 *  todos, e o filtro certo é o TERMO, não um bairro escolhido a dedo.
 *
 *  A palavra tem que aparecer INTEIRA no núcleo do bairro, e ter 4 letras ou
 *  mais. Sem isso "sul" viraria família de "Setsul" e "Sulina", e a busca
 *  passaria a devolver bairro por acaso de substring — que é o defeito que este
 *  arquivo inteiro existe para não cometer. */
export function familiaDeBairros(
  pedido: string,
  disponiveis: string[]
): { termo: string; bairros: string[] } | null {
  const palavras = nucleo(pedido).split(" ").filter((p) => p.length >= 4);
  if (palavras.length === 0) return null;
  const unicos = [...new Set(disponiveis.filter(Boolean))];

  let melhor: { termo: string; bairros: string[] } | null = null;
  for (const p of palavras) {
    const bairros = unicos.filter((b) => ` ${nucleo(b)} `.includes(` ${p} `));
    // DOIS é o mínimo: com um só, quem resolve é a comparação de nome, que
    // devolve o bairro certo em vez de um `contains` mais frouxo.
    if (bairros.length >= 2 && (!melhor || bairros.length > melhor.bairros.length))
      melhor = { termo: p, bairros };
  }
  return melhor;
}

export type Achado = { bairro: string; exato: boolean };

// O melhor bairro da carteira para o que foi pedido. `null` quer dizer "não sei"
// — e "não sei" tem que virar pergunta, nunca chute.
export function melhorBairro(pedido: string, disponiveis: string[]): Achado | null {
  const a = nucleo(pedido);
  if (!a) return null;

  let melhor: { bairro: string; d: number } | null = null;
  for (const cand of disponiveis) {
    if (!cand) continue;
    const b = nucleo(cand);
    if (a === b) return { bairro: cand, exato: true };
    if (!parecido(pedido, cand)) continue;
    const d = distancia(a, b);
    if (!melhor || d < melhor.d) melhor = { bairro: cand, d };
  }
  return melhor ? { bairro: melhor.bairro, exato: false } : null;
}

// Os bairros que MAIS se parecem com o pedido, mesmo sem bater o suficiente para
// escolher sozinho. É o que a IA lê em voz alta quando não entendeu: "não achei
// esse; temos Deocleciano e Redentora, é algum desses?".
export function bairrosParecidos(pedido: string, disponiveis: string[], max = 4): string[] {
  const a = nucleo(pedido);
  if (!a) return [];
  return [...new Set(disponiveis.filter(Boolean))]
    .map((b) => ({ b, d: distancia(a, nucleo(b)) }))
    .sort((x, y) => x.d - y.d)
    .slice(0, max)
    .map((x) => x.b);
}

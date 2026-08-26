// Como o CLIENTE reconhece o imóvel do qual estamos falando.
//
// POR QUE ISTO EXISTE
//
// Em 21/08/2026 a Maitê mandou este toque proativo, às 10:30:
//
//     "Oi Pablo, aqui é a Maitê. o casa de condomínio em Avenida Miguel Damha,
//      1515 (R$ 1.250.000,00) que você viu segue disponível. Quer que eu veja
//      as condições de financiamento pra ele?"
//
// Dois defeitos numa frase só, e o segundo é o caro.
//
// 1. "o casa", "pra ele". O artigo e o pronome estavam FIXOS no template
//    (`lib/followup.ts`), e o tipo do imóvel é string livre vinda dos portais.
//    Quebra em tudo que é feminino, que é metade do catálogo: casa, cobertura,
//    chácara, kitnet, sala, fazenda.
//
// 2. O imóvel foi identificado pela RUA. O cliente tinha procurado casa no
//    condomínio Gaivota I, e é lá que o imóvel fica — "Avenida Miguel Damha" é
//    só a avenida em que o condomínio tem portaria. Ele leu "Damha", entendeu
//    que era outro condomínio e veio perguntar por que recebeu oferta de coisa
//    que não pediu. O sistema TINHA o dado certo (`Imovel.condominioId` →
//    "Gaivota I") e escolheu mostrar o errado.
//
//    Ninguém decora o número da avenida do imóvel que viu. Decora o
//    condomínio, ou o bairro. `lib/abordagem-portal.ts` já sabia disso — "Como
//    a pessoa reconhece o imóvel. Tipo + bairro, sem código" — e o follow-up
//    não seguia a mesma régua.
//
// Este módulo é a régua única. Quem fala com o cliente sobre um imóvel passa
// por aqui.

/** O mínimo que precisamos saber para citar um imóvel numa conversa. */
export type ImovelCitavel = {
  tipo: string;
  bairro?: string | null;
  cidade?: string | null;
  endereco?: string | null;
  /** Nome do condomínio, quando o imóvel está em um. É o que mais identifica. */
  condominio?: string | null;
};

export type Genero = "m" | "f";

/**
 * Tipos femininos que a regra da terminação não pega.
 *
 * A heurística é "termina em -a, é feminino", e ela acerta a maioria do
 * catálogo (casa, cobertura, chácara, sala, fazenda, loja). Estes são os que
 * fogem dela e aparecem de verdade nos portais.
 */
const FEMININOS_IRREGULARES = new Set(["kitnet", "kitchenette", "suite", "suíte"]);

/** Masculinos terminados em -a, que a heurística marcaria errado. */
const MASCULINOS_IRREGULARES = new Set(["duplex", "triplex", "flat", "loft", "studio", "stúdio"]);

/**
 * O gênero do tipo do imóvel.
 *
 * Olha só a PRIMEIRA palavra, porque é ela que rege o artigo: "Casa de
 * Condomínio" é *a* casa; "Ponto Comercial/Loja" é *o* ponto;
 * "Fazenda/Sítio/Chácara" é *a* fazenda. Separadores `/` e `-` contam como fim
 * de palavra — os portais mandam "Sala/Conjunto" e "Galpão/Depósito/Armazém".
 */
export function generoDoTipo(tipo: string): Genero {
  const primeira = tipo
    .trim()
    .toLowerCase()
    .split(/[\s/\-,]+/)[0]
    ?.replace(/[^a-záàâãéêíóôõúüç]/g, "");

  if (!primeira) return "m";
  if (FEMININOS_IRREGULARES.has(primeira)) return "f";
  if (MASCULINOS_IRREGULARES.has(primeira)) return "m";
  return primeira.endsWith("a") ? "f" : "m";
}

/** "o" / "a" — para "o apartamento", "a casa". */
export function artigo(genero: Genero): string {
  return genero === "f" ? "a" : "o";
}

/** "ele" / "ela" — para "pra ele", "achou dele". */
export function pronome(genero: Genero): string {
  return genero === "f" ? "ela" : "ele";
}

/** "aquele" / "aquela", "esse" / "essa". */
export function demonstrativo(genero: Genero, forma: "aquele" | "esse"): string {
  if (genero === "m") return forma;
  return forma === "aquele" ? "aquela" : "essa";
}

/**
 * Onde o imóvel fica, do jeito que o cliente guarda na cabeça.
 *
 * A ordem é condomínio → bairro → cidade, e a rua NÃO entra. Foi ela que criou
 * o mal-entendido de 21/08: identifica para o carteiro, não para quem visitou.
 *
 * O condomínio vem com a palavra "condomínio" na frente por dois motivos: diz
 * ao cliente o que aquele nome é (sem ela, "no Gaivota I" pode soar como
 * bairro), e a preposição passa a concordar com "condomínio" — masculino,
 * sempre —, o que evita ter de adivinhar o gênero de um nome próprio.
 *
 * Para bairro a preposição segue a regra que o português usa de verdade, e que
 * a primeira versão disto errou nas duas pontas:
 *
 *   - bairro que começa com substantivo comum leva artigo, concordando com ELE:
 *     "no Centro", "no Jardim Paulista", "na Vila Nova", "na Cidade Nova";
 *   - nome próprio puro dispensa artigo: "em Copacabana", "em Gaivota I".
 *
 * A tentativa de usar "em" para tudo produzia "em Centro", que ninguém fala — e
 * um teste de `abordagem-portal` que já exigia "no Centro" reprovou na hora.
 * Tentar adivinhar o gênero do nome próprio inteiro é que não dá: "Ipiranga"
 * termina em -a e é masculino.
 */
const GENERICOS_MASCULINOS = new Set([
  "centro", "jardim", "parque", "conjunto", "residencial", "alto", "recanto",
  "distrito", "loteamento", "setor", "bosque", "sítio", "sitio", "núcleo", "nucleo",
]);
const GENERICOS_FEMININOS = new Set([
  "vila", "cidade", "chácara", "chacara", "colônia", "colonia", "granja", "quinta", "praia", "lagoa",
]);

/** A preposição certa para um bairro ou cidade. */
export function preposicaoDoLugar(lugar: string): string {
  const primeira = lugar.trim().toLowerCase().split(/[\s/\-,]+/)[0] ?? "";
  if (GENERICOS_MASCULINOS.has(primeira)) return "no";
  if (GENERICOS_FEMININOS.has(primeira)) return "na";
  // Nome próprio: sem artigo. "em Copacabana", "em Gaivota I".
  return "em";
}

export function ondeFica(im: ImovelCitavel): string | null {
  const cond = im.condominio?.trim();
  if (cond) return `no condomínio ${cond}`;

  const lugar = im.bairro?.trim() || im.cidade?.trim();
  return lugar ? `${preposicaoDoLugar(lugar)} ${lugar}` : null;
}

/**
 * A referência completa, sem artigo: "casa no condomínio Gaivota I".
 *
 * Sem artigo porque cada frase precisa do seu — "a casa que você viu", "sobre a
 * casa", "aquela casa". Quem chama decide, com `artigo(genero)`.
 */
export function descreverImovel(im: ImovelCitavel): { texto: string; genero: Genero } {
  const genero = generoDoTipo(im.tipo);
  const onde = ondeFica(im);

  // "casa de condomínio no condomínio Gaivota I" diz a mesma palavra duas
  // vezes. Quando o lugar já é um condomínio, o tipo encolhe para o substantivo
  // — "casa no condomínio Gaivota I", que é como a pessoa fala.
  const tipoCru = im.tipo.trim().toLowerCase();
  const tipo =
    onde?.startsWith("no condomínio") && /condom[íi]nio/.test(tipoCru)
      ? tipoCru.split(/[\s/\-,]+/)[0]
      : tipoCru;

  // Sem lugar nenhum, sobra o endereço — melhor do que dizer só "a casa" quando
  // o cliente viu três. É o último recurso, não o primeiro.
  if (!onde) {
    const rua = im.endereco?.trim();
    return { texto: rua ? `${tipo} em ${rua}` : tipo, genero };
  }

  return { texto: `${tipo} ${onde}`, genero };
}

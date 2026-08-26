// Reconhecer o condomínio no meio do texto que o corretor escreveu.
//
// O sistema nasceu com um campo `bairro` só, e ele acabou guardando três coisas
// diferentes conforme quem cadastrou: o bairro de verdade ("Vila Alegre"), o
// nome do condomínio ("Gaivota I") ou o do loteamento ("Residencial Marcia").
// O nome do condomínio, quando existe, costuma estar em outro lugar — no
// título ("Casa térrea 3 suítes - Cond. Gaivota I"), no endereço
// ("Condomínio Residencial Jardins") ou nas observações ("Condomínio: Jardins").
//
// Este arquivo lê esses textos e devolve o nome. Ele NÃO grava nada: quem grava
// é scripts/cadastrar-condominios.mjs, que roda em dry-run antes.
//
// A régua é conservadora. Um condomínio inventado é pior que nenhum: a IA
// passaria a afirmar com segurança um nome que não existe, que é exatamente o
// defeito que esta mudança existe para corrigir. Na dúvida, devolve null.

/** Prefixos que anunciam um condomínio no texto livre. */
const PREFIXOS = [
  "condomínio residencial",
  "condominio residencial",
  "cond. residencial",
  "condomínio",
  "condominio",
  "cond\\.",
  "cond ",
  "residencial",
  "resid\\.",
];

/** Palavras que NUNCA são nome de condomínio, mesmo vindo depois do prefixo.
 *  "Condomínio fechado" e "condomínio de R$ 500" aparecem o tempo todo e não
 *  nomeiam nada. */
const NAO_E_NOME = new RegExp(
  "^(" +
    // adjetivos e valores: "condomínio fechado", "condomínio de R$ 500"
    "fechado|clube|de\\s|da\\s|do\\s|r\\$|incluso|inclu[íi]do|a\\s+partir|mensal|aprox|valor|" +
    // VERBOS — o erro que o dry-run de 18/08 pegou antes de gravar: "condomínio
    // OFERECE piscina" e "condomínio POSSUI portaria" viraram condomínios
    // chamados "oferece" e "POSSUI", cada um com 5 imóveis ligados.
    "oferece|possui|conta|disp[õo]e|tem\\s|possue|apresenta|garante|inclui|" +
    // particípios: "condomínio ASSINADO por Oscar Niemeyer" virou um condomínio
    // chamado "assinado por Oscar Niemeyer" no dry-run.
    "assinado|projetado|localizado|situado|entregue|composto|formado|" +
    // adjetivos de anúncio: "residencial CONSOLIDADO", "condomínio NOVO"
    "consolidado|novo|nova|antigo|completo|pronto|exclusivo|moderno|" +
    // localização relativa: "condomínio AO LADO do Damha VI" — descreve onde
    // fica, não o nome. Os dois exemplos vieram do dry-run do tenant 5.
    "ao\\s|perto|pr[óo]ximo|junto|vizinho|defronte|em\\s+frente|" +
    // preposições e conectivos soltos
    "com\\s|sem\\s|para\\s|por\\s|em\\s|no\\s|na\\s|que\\s|" +
    "\\d)",
  "i"
);

/** Nome que é claramente descrição, não nome próprio.
 *
 *  Vem do mesmo dry-run: texto longo demais quase nunca é nome de lugar — é
 *  frase de anúncio que escapou do corte no separador. */
function pareceDescricao(nome: string): boolean {
  // Nome de condomínio raramente passa de cinco palavras.
  if (nome.split(/\s+/).length > 5) return true;
  // Frase inteira em MAIÚSCULAS costuma ser chamada de anúncio, não nome
  // cadastrado — e entra no banco desfigurando a lista para o cliente.
  return nome.length > 12 && nome === nome.toUpperCase() && /\s/.test(nome);
}

/** Corta o nome no primeiro separador: o texto costuma continuar com outra
 *  informação ("Cond. Gaivota I - 3 suítes", "Condomínio: Jardins, casa nova"). */
const SEPARADORES = /\s*[-–—|,;:/]|\s{2,}|\n/;

function limpar(bruto: string): string | null {
  let nome = bruto.split(SEPARADORES)[0]?.trim() ?? "";
  // Tira pontuação solta, aspas e parênteses nas pontas: o cadastro real tem
  // "( EviLLe )", que sem isto entraria no banco com os parênteses.
  nome = nome.replace(/^["'`\s.()\[\]]+|["'`\s.()\[\]]+$/g, "");
  if (!nome || nome.length < 3 || nome.length > 60) return null;
  if (NAO_E_NOME.test(nome)) return null;
  if (pareceDescricao(nome)) return null;
  // Nome só de número não identifica lugar ("Cond. 2").
  if (!/[a-zà-ú]{3}/i.test(nome)) return null;
  return nome;
}

/** O nome do condomínio dentro de um texto, ou null.
 *
 *  Procura o prefixo mais específico primeiro ("condomínio residencial" antes de
 *  "residencial"), porque o genérico casaria no meio do específico e devolveria
 *  a metade do nome. */
export function condominioNoTexto(texto: string | null | undefined): string | null {
  const t = (texto ?? "").trim();
  if (!t) return null;
  for (const p of PREFIXOS) {
    const re = new RegExp(`${p}\\s*:?\\s*(.+)`, "i");
    const m = t.match(re);
    if (!m) continue;
    const nome = limpar(m[1]);
    if (nome) {
      // "Residencial Santa Regina" — quando o prefixo é parte do nome próprio,
      // devolvemos o nome COM ele, que é como as pessoas chamam o lugar.
      const prefixoLimpo = p.replace(/\\\./g, ".").trim();
      return /^resid/i.test(prefixoLimpo) && !/^:/.test(m[1].trim())
        ? `${capitalizar(prefixoLimpo)} ${nome}`.replace(/\s+/g, " ").trim()
        : nome;
    }
  }
  return null;
}

function capitalizar(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/\.$/, "");
}

/** Onde procurar, em ordem de confiança.
 *
 *  O título vem primeiro porque é o campo em que o corretor escreve para o
 *  cliente ler — é lá que o nome sai completo e certo. As observações vêm por
 *  último: são o campo mais bagunçado, e é onde mais aparece "condomínio
 *  fechado" e "condomínio de R$ 500", que não nomeiam nada. */
export function condominioDoImovel(imovel: {
  titulo?: string | null;
  endereco?: string | null;
  bairro?: string | null;
  observacoes?: string | null;
}): { nome: string; origem: "titulo" | "endereco" | "bairro" | "observacoes" } | null {
  // OBSERVAÇÕES SAÍRAM DA LISTA, e a razão é um erro real do dry-run de 18/08.
  //
  // O imóvel 602 do tenant 5 é um lançamento no Line Impper. Suas observações
  // dizem "na região dos Damhas" e citam o Residencial Maria Júlia como
  // referência de vizinhança — e o extrator ligou a casa ao Maria Júlia. Ligar
  // um imóvel ao condomínio ERRADO é pior que deixá-lo sem condomínio: a IA
  // passaria a afirmar, com a segurança de um dado cadastrado, que a casa fica
  // num lugar onde ela não está. É a mesma classe de erro que fez o cliente
  // dizer "então deixa quieto, você não sabe".
  //
  // Observações é campo de texto de anúncio: fala da região, do que tem por
  // perto, do que o condomínio oferece. Serve para vender, não para localizar.
  // O ganho que ela daria (282 imóveis no tenant 3) não paga o risco de apontar
  // o lugar errado.
  const fontes: [string, string | null | undefined][] = [
    ["titulo", imovel.titulo],
    ["endereco", imovel.endereco],
    ["bairro", imovel.bairro],
  ];
  for (const [origem, texto] of fontes) {
    const nome = condominioNoTexto(texto);
    if (nome) return { nome, origem: origem as "titulo" | "endereco" | "bairro" | "observacoes" };
  }
  return null;
}

/** O texto do campo `bairro` diz mesmo onde o imóvel fica?
 *
 *  Cadastro real traz "Condomínio" como bairro — que não localiza nada. Usar
 *  isso faria a IA responder "o Set Life II fica no bairro Condomínio". */
export function bairroUtil(bairro: string | null | undefined): boolean {
  const b = chaveDoNome(bairro ?? "");
  if (b.length < 3) return false;
  return !["condominio", "cond", "residencial", "resid", "loteamento", "bairro", "centro0"].includes(b);
}

/** Dois nomes se referem ao mesmo condomínio?
 *
 *  Compara sem acento, sem caixa e sem os prefixos genéricos: "Cond. Gaivota I",
 *  "Gaivota I" e "Condomínio Gaivota I" são o mesmo lugar, e tratá-los como três
 *  é o que faria a IA voltar a listar o mesmo condomínio várias vezes. */
export function mesmoCondominio(a: string, b: string): boolean {
  return chaveDoNome(a) === chaveDoNome(b);
}

export function chaveDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(condominio|cond|residencial|resid)\b\.?\s*/g, "")
    // Espaço some da CHAVE (não do nome): "Set Life II" e "SetLife II" são o
    // mesmo lugar, e o dry-run de 18/08 mostrou os dois virando condomínios
    // separados — exatamente a duplicação que esta entidade veio impedir.
    // "Gaivota I" e "Gaivota II" continuam distintos ("gaivotai" ≠ "gaivotaii").
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}


/** Liga ao condomínio os imóveis cujo campo `bairro` É o nome dele.
 *
 *  Segunda passada, e ela importa mais do que parece. No cadastro real do
 *  Gaivota I havia duas casas: uma com "Cond. Gaivota I" no título e outra com
 *  apenas "Oportunidade no Gaivota I" — sem prefixo, invisível para a extração
 *  — mas com "Gaivota I" no campo `bairro`. Sem esta passada elas ficariam em
 *  lugares diferentes, que é exatamente o defeito original: o mesmo condomínio
 *  aparecendo como dois para o cliente.
 *
 *  Só liga a nomes JÁ reconhecidos em outro imóvel. Não inventa condomínio a
 *  partir de bairro — senão todo bairro da carteira viraria um. */
export function ligarPeloBairro<T extends { bairro?: string | null }>(
  imoveis: T[],
  nomesConhecidos: string[]
): Map<T, string> {
  const porChave = new Map(nomesConhecidos.map((n) => [chaveDoNome(n), n]));
  const ligacoes = new Map<T, string>();
  for (const im of imoveis) {
    const chave = chaveDoNome(im.bairro ?? "");
    if (!chave) continue;
    const nome = porChave.get(chave);
    if (nome) ligacoes.set(im, nome);
  }
  return ligacoes;
}


/** O imóvel PROVA que está num condomínio, ou só temos um nome plausível?
 *
 *  Reconhecer o nome no texto (acima) é metade do trabalho. A outra metade é
 *  saber se aquilo é mesmo um condomínio — porque no cadastro real o campo
 *  `bairro` guarda tanto "Gaivota I" (condomínio) quanto "Residencial Setsul II"
 *  (loteamento aberto), e os dois se parecem.
 *
 *  Medido no tenant 3 em 18/08: dos 72 nomes reconhecidos, 63 não tinham
 *  NENHUMA prova. Os dois maiores — Setsul II com 8 imóveis, Macedo Teles I com
 *  5 — não tinham um único imóvel com taxa ou tipo de condomínio, e espalhavam
 *  por 5 e 4 ruas. Cadastrá-los teria criado 63 condomínios inexistentes, e a
 *  IA passaria a afirmá-los com a segurança de um dado cadastrado.
 *
 *  TAXA NÃO VALE PARA APARTAMENTO, e essa é a parte que quase passou. Todo
 *  apartamento paga taxa de condomínio, porque está num PRÉDIO — isso não faz
 *  do lugar um condomínio fechado. Foi assim que "Residencial Maria Adélia"
 *  entrou na carga do tenant 3 e precisou ser removido: a taxa provava o
 *  prédio, e o nome tinha vindo do campo bairro, ou seja, era o bairro do
 *  prédio. Para apartamento só vale o endereço nomear o condomínio.
 *
 *  Casa que paga taxa é outra coisa: casa em rua aberta não paga condomínio. */
export function provaDeCondominio(imovel: {
  tipo?: string | null;
  endereco?: string | null;
  valorCondominio?: number | string | null;
}): "tipo" | "endereco" | "taxa" | null {
  if (/condom[íi]nio/i.test(imovel.tipo ?? "")) return "tipo";
  if (/condom[íi]nio/i.test(imovel.endereco ?? "")) return "endereco";
  const ehApartamento = /apart|flat|kitnet|studio|st[úu]dio|cobertura/i.test(imovel.tipo ?? "");
  if (ehApartamento) return null;
  return Number(imovel.valorCondominio ?? 0) > 0 ? "taxa" : null;
}

/** O grupo tem prova suficiente para virar um condomínio cadastrado?
 *
 *  Exige MAIORIA: um imóvel com taxa entre cinco sem taxa não faz do lugar um
 *  condomínio — pode ser o único apartamento de um bairro aberto. */
export function grupoTemProva(
  imoveis: Parameters<typeof provaDeCondominio>[0][]
): { aprovado: boolean; provas: string[]; comProva: number } {
  const provas = imoveis.map(provaDeCondominio).filter(Boolean) as string[];
  return {
    aprovado: provas.length * 2 > imoveis.length,
    provas: [...new Set(provas)],
    comProva: provas.length,
  };
}

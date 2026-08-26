// Qualificação de financiamento do comprador de EMPREENDIMENTO.
//
// Vender apartamento na planta é vender FINANCIAMENTO: o que decide a compra
// não é ter gostado do apartamento, é a renda passar no banco. Por isso, quando
// o interesse é um empreendimento, o atendimento tem uma escada fixa:
//
//   1. as PERGUNTAS abaixo, uma por vez, na ordem (as de cônjuge só entram
//      quando a pessoa é casada);
//   2. só depois de respondidas, os DOCUMENTOS.
//
// Pedir documento antes de saber a renda é o erro clássico: manda o cliente
// juntar papel para descobrir no fim que ele não se enquadra.

import { FAIXAS_MCMV, COMPROMETIMENTO_MAX, faixaPelaRenda, type Faixa } from "@/lib/empreendimentos";

export type ChavePergunta =
  | "quartosDesejados"
  | "banheirosDesejados"
  | "localizacaoDesejada"
  | "primeiroImovel"
  | "nomeRestrito"
  | "previsaoQuitacao"
  | "temOutroTitular"
  | "nomeAlternativo"
  | "estadoCivil"
  | "vinculo"
  | "tresAnosRegistro"
  | "dependentes"
  | "rendaBrutaMensal"
  | "rendaDeclaradaIr"
  | "dataNascimento"
  | "temFgts"
  | "conjugeImovelProprio"
  | "conjugeNome"
  | "conjugeVinculo"
  | "conjugeRendaBrutaMensal"
  | "conjugeDataNascimento"
  | "entradaDisponivel"
  | "querParcelarEntrada"
  | "parcelaDesejada";

export type Pergunta = {
  chave: ChavePergunta;
  rotulo: string; // como aparece na ficha, para a equipe
  pergunta: string; // como a IA pergunta no WhatsApp
  porque: string; // por que a resposta importa (documenta a regra)
  // Pergunta CONDICIONAL: só entra na escada quando isto for verdade. É o que
  // evita perguntar o nome da esposa para quem é solteiro.
  seAplica?: (r: Respostas) => boolean;
};

export const ESTADOS_CIVIS = [
  "SOLTEIRO",
  "CASADO",
  "UNIAO_ESTAVEL",
  "DIVORCIADO",
  "VIUVO",
] as const;
export type EstadoCivil = (typeof ESTADOS_CIVIS)[number];

// ESCOLHER UM IMÓVEL É RESPONDER PARTE DA ESCADA.
//
// Print do dono, 19/08: a IA perguntou "Quantos quartos você precisa?", ele
// respondeu escolhendo — "a com 4 suítes" — e nove minutos depois ela perguntou
// a mesma coisa. No banco (lead 341) estavam gravados `estadoCivil` e
// `primeiroImovel`, que ela PERGUNTOU, e NULL em quartos, banheiros e
// localização, que ele RESPONDEU escolhendo.
//
// A escolha é uma resposta melhor que a pergunta: quem escolhe a casa de 4
// suítes no Gaivota I disse quantos quartos quer, quantos banheiros aceita e
// onde quer morar, com menos ambiguidade do que responderia no abstrato.
//
// SÓ PREENCHE O QUE ESTÁ VAZIO. O que a pessoa disse com todas as letras manda
// sobre o que o imóvel sugere: ela pode escolher uma de 4 suítes e seguir
// querendo 3, e a preferência declarada continua valendo.
//
// A localização vem do CONDOMÍNIO quando existe, nunca do `bairro` cru — mesma
// razão de lugarDoImovel/fichaDoImovel em lib/agentes.ts: `bairro` guarda ora o
// bairro, ora o loteamento, ora o nome do próprio condomínio.
export function respostasDaEscolha(
  imovel: { quartos?: number | null; banheiros?: number | null; bairro?: string | null },
  condominioNome: string | null | undefined,
  atual: Respostas | null | undefined
): { quartosDesejados?: number; banheirosDesejados?: number; localizacaoDesejada?: string } {
  const out: { quartosDesejados?: number; banheirosDesejados?: number; localizacaoDesejada?: string } = {};
  if (atual?.quartosDesejados == null && imovel.quartos != null) out.quartosDesejados = imovel.quartos;
  if (atual?.banheirosDesejados == null && imovel.banheiros != null) out.banheirosDesejados = imovel.banheiros;
  if (atual?.localizacaoDesejada == null) {
    const lugar = condominioNome ?? imovel.bairro ?? null;
    if (lugar) out.localizacaoDesejada = lugar;
  }
  return out;
}

// Casado e união estável trazem o cônjuge para dentro da análise: os dados
// dele, os documentos dele e a renda dele somando na renda familiar.
export function temConjuge(r: Respostas): boolean {
  return r.estadoCivil === "CASADO" || r.estadoCivil === "UNIAO_ESTAVEL";
}

// Nome restrito abre duas perguntas: quando ela espera quitar, e se tem outra
// pessoa para pôr o imóvel. Uma das duas é o que destrava.
export function temRestricao(r: Respostas): boolean {
  return r.nomeRestrito === true;
}

// Sem entrada, a próxima pergunta é se ela quer parcelar. `entradaDisponivel`
// vem como 0 (respondida), nunca null — null é "ainda não perguntei".
export function semEntrada(r: Respostas): boolean {
  return r.entradaDisponivel === 0;
}

// A ordem importa: começa pelo que ELIMINA (ter outro imóvel barra o MCMV) e
// termina no que só ajusta a conta. Assim uma conversa interrompida no meio já
// deixou a informação mais cara colhida.
export const PERGUNTAS: Pergunta[] = [
  // ── Produto: o que a pessoa quer. Vem antes do financeiro porque é o que
  // filtra a busca — sem isto a IA qualifica renda e depois oferece qualquer
  // coisa. ───────────────────────────────────────────────────────────────────
  {
    chave: "quartosDesejados",
    rotulo: "Quartos",
    pergunta: "Quantos quartos você precisa?",
    porque: "É o filtro que mais elimina imóvel na prática.",
  },
  {
    chave: "banheirosDesejados",
    rotulo: "Banheiros",
    pergunta: "E quantos banheiros?",
    porque: "Separa o padrão do imóvel dentro da mesma metragem.",
  },
  {
    chave: "localizacaoDesejada",
    rotulo: "Localização",
    pergunta: "Em qual bairro ou região você quer morar?",
    porque: "Define onde buscar, e permite oferecer o que fica perto quando não há no bairro exato.",
  },
  {
    chave: "primeiroImovel",
    rotulo: "Primeiro imóvel",
    pergunta: "Esse vai ser seu primeiro imóvel ou você já tem algum no seu nome?",
    porque: "Ter outro imóvel no nome tira o comprador do MCMV.",
  },
  {
    chave: "estadoCivil",
    rotulo: "Estado civil",
    pergunta: "Você é casado, tem união estável, ou é solteiro?",
    porque:
      "Casado muda a coleta inteira: entram os dados e os documentos do cônjuge, e a renda dele soma na renda familiar.",
  },
  {
    // Fora de ordem de propósito: o resto do bloco do cônjuge fica no fim, mas
    // esta ELIMINA — e pergunta que elimina vem cedo.
    chave: "conjugeImovelProprio",
    rotulo: "Cônjuge tem imóvel",
    pergunta: "E seu cônjuge, já tem algum imóvel no nome dele(a)?",
    porque:
      "No financiamento os dois entram como compradores, então imóvel no nome do cônjuge tira o CASAL do MCMV.",
    seAplica: temConjuge,
  },
  // ── Restrição de nome: eliminador duro, perguntado antes de falar de
  // dinheiro. Nome restrito não financia, ponto. ───────────────────────────
  {
    chave: "nomeRestrito",
    rotulo: "Nome restrito",
    pergunta: "Seu nome está limpo ou tem alguma restrição (Serasa, SPC)?",
    porque: "Nome restrito não passa no banco. Descobrir depois de qualificar tudo desperdiça o atendimento inteiro.",
  },
  {
    chave: "previsaoQuitacao",
    rotulo: "Previsão de quitação",
    pergunta: "Você tem previsão de quando consegue quitar isso?",
    porque: "É a data em que a Maitê volta a falar com ela. Até lá, ninguém insiste.",
    seAplica: temRestricao,
  },
  {
    chave: "temOutroTitular",
    rotulo: "Tem outro titular",
    pergunta: "Tem outra pessoa da família que possa entrar no financiamento no lugar?",
    porque: "É o ÚNICO caminho para seguir agora. Sem outro nome, a compra fica esperando a quitação.",
    seAplica: temRestricao,
  },
  {
    chave: "nomeAlternativo",
    rotulo: "Nome do outro titular",
    pergunta: "Qual o nome completo dessa pessoa?",
    porque: "É em nome dela que o financiamento vai correr.",
    seAplica: (r) => temRestricao(r) && r.temOutroTitular === true,
  },
  // ── Entrada: determinante. Sem entrada e querendo parcelar, só na planta. ──
  {
    chave: "entradaDisponivel",
    rotulo: "Entrada disponível",
    pergunta: "Quanto você tem pra dar de entrada?",
    porque: "A entrada soma ao financiável e define o teto real do que ela pode comprar.",
  },
  {
    chave: "querParcelarEntrada",
    rotulo: "Quer parcelar a entrada",
    pergunta: "Sem entrada à vista, você gostaria de parcelar a entrada?",
    porque:
      "Só empreendimento NÃO ENTREGUE parcela entrada, direto com a construtora. Imóvel pronto exige entrada à vista.",
    seAplica: semEntrada,
  },
  {
    chave: "vinculo",
    rotulo: "Vínculo",
    pergunta: "Você trabalha registrado ou é autônomo?",
    porque: "Define como a renda é comprovada — e quais documentos existem.",
  },
  {
    chave: "tresAnosRegistro",
    rotulo: "3 anos de registro",
    pergunta: "Você tem 3 anos ou mais de carteira assinada, somando todos os empregos?",
    porque: "3 anos de FGTS liberam o uso do saldo na entrada e o Pró-Cotista.",
  },
  {
    chave: "dependentes",
    rotulo: "Dependentes",
    pergunta: "Você tem dependentes? Quantos?",
    porque: "Entra na análise de comprometimento de renda do banco.",
  },
  {
    chave: "rendaBrutaMensal",
    rotulo: "Renda bruta familiar",
    pergunta: "Qual a sua renda bruta por mês? Se for somar com alguém, me diz o total.",
    porque: "É a renda que define a faixa do MCMV e o teto da parcela.",
  },
  {
    chave: "rendaDeclaradaIr",
    rotulo: "Renda declarada no IR",
    pergunta: "Essa renda toda você declarou no último imposto de renda?",
    porque:
      "Renda que não aparece no IR o banco não enxerga. Perguntar agora evita descobrir na análise, com o cliente já comprado.",
  },
  {
    chave: "dataNascimento",
    rotulo: "Data de nascimento",
    pergunta: "Qual sua data de nascimento?",
    porque: "A idade limita o prazo do financiamento (idade + prazo até 80 anos e 6 meses).",
  },
  {
    chave: "temFgts",
    rotulo: "FGTS",
    pergunta: "Você tem saldo de FGTS?",
    porque: "O FGTS entra na entrada e muitas vezes é o que viabiliza a compra.",
  },
  // ── Cônjuge: só quando existe. Perguntar o nome da esposa para um solteiro é
  // o tipo de erro que faz a pessoa desconfiar do atendimento inteiro. ────────
  {
    chave: "conjugeNome",
    rotulo: "Nome do cônjuge",
    pergunta: "Qual o nome completo do seu cônjuge?",
    porque: "O cônjuge entra no financiamento como comprador, então precisa estar identificado.",
    seAplica: temConjuge,
  },
  {
    chave: "conjugeVinculo",
    rotulo: "Vínculo do cônjuge",
    pergunta: "E ele(a) trabalha registrado ou é autônomo?",
    porque: "Define quais documentos de renda existem do lado do cônjuge.",
    seAplica: temConjuge,
  },
  {
    chave: "conjugeRendaBrutaMensal",
    rotulo: "Renda do cônjuge",
    pergunta: "Qual a renda bruta mensal dele(a)?",
    porque: "Soma na renda familiar — é o que costuma fazer o casal caber na faixa.",
    seAplica: temConjuge,
  },
  {
    chave: "conjugeDataNascimento",
    rotulo: "Nascimento do cônjuge",
    pergunta: "E a data de nascimento dele(a)?",
    porque: "O prazo do financiamento é limitado pela idade do comprador MAIS VELHO do casal.",
    seAplica: temConjuge,
  },
  // Fecha a escada: só faz sentido depois de a pessoa saber em que faixa está.
  {
    chave: "parcelaDesejada",
    rotulo: "Parcela esperada",
    pergunta: "E qual valor de parcela cabe no seu mês?",
    porque:
      "O que ela ESPERA pagar, comparado ao que o banco aceita, revela expectativa fora da realidade antes da proposta.",
  },
];

export type ChaveDocumento =
  | "IDENTIDADE"
  | "ESTADO_CIVIL"
  | "RESIDENCIA"
  | "CTPS"
  | "HOLERITE"
  | "EXTRATO_FGTS"
  | "CONJUGE";

export type Documento = {
  chave: ChaveDocumento;
  glifo: string; // só a tela usa — a Maitê nunca manda emoji
  titulo: string;
  detalhe?: string;
  // Documento que só existe para quem tem carteira assinada. Para autônomo, a
  // renda é comprovada de outro jeito — pedir holerite a autônomo é pedir o
  // que não existe.
  soComCarteira?: boolean;
  alternativa?: string;
  // Documento que só existe quando há cônjuge. Vai como UM item para a lista
  // não dobrar de tamanho na tela e no WhatsApp.
  soComConjuge?: boolean;
};

export const DOCUMENTOS: Documento[] = [
  { chave: "IDENTIDADE", glifo: "🆔", titulo: "RG e CPF ou CNH" },
  { chave: "ESTADO_CIVIL", glifo: "📜", titulo: "Certidão de estado civil", detalhe: "nascimento ou casamento" },
  { chave: "RESIDENCIA", glifo: "🏠", titulo: "Comprovante de residência atualizado" },
  {
    chave: "CTPS",
    glifo: "📖",
    titulo: "Carteira de trabalho completa",
    detalhe: "digital em PDF, ou foto de todas as páginas de contrato da via física",
    soComCarteira: true,
    alternativa: "declaração de IR completa e contrato social ou comprovante de MEI",
  },
  {
    chave: "HOLERITE",
    glifo: "📄",
    titulo: "Holerite dos últimos 2 meses",
    soComCarteira: true,
    alternativa: "extratos bancários dos últimos 3 a 6 meses (ou DECORE do contador)",
  },
  {
    chave: "EXTRATO_FGTS",
    glifo: "🏦",
    titulo: "Extrato do FGTS",
    detalhe: "PDF exportado do aplicativo FGTS",
    soComCarteira: true,
    alternativa: "não se aplica sem FGTS — a entrada vem de recursos próprios",
  },
  {
    chave: "CONJUGE",
    glifo: "👥",
    titulo: "Mesma lista para o cônjuge",
    detalhe: "identidade, certidão, comprovante de renda e extrato do FGTS dele(a)",
    soComConjuge: true,
  },
];

// ─── Estado da qualificação ─────────────────────────────────────────────────

export type Respostas = {
  quartosDesejados?: number | null;
  banheirosDesejados?: number | null;
  localizacaoDesejada?: string | null;
  primeiroImovel?: boolean | null;
  nomeRestrito?: boolean | null;
  previsaoQuitacao?: Date | string | null;
  temOutroTitular?: boolean | null;
  nomeAlternativo?: string | null;
  estadoCivil?: string | null;
  vinculo?: string | null;
  tresAnosRegistro?: boolean | null;
  dependentes?: number | null;
  rendaBrutaMensal?: number | null;
  rendaDeclaradaIr?: boolean | null;
  dataNascimento?: Date | string | null;
  temFgts?: boolean | null;
  conjugeImovelProprio?: boolean | null;
  conjugeNome?: string | null;
  conjugeVinculo?: string | null;
  conjugeRendaBrutaMensal?: number | null;
  conjugeDataNascimento?: Date | string | null;
  entradaDisponivel?: number | null;
  querParcelarEntrada?: boolean | null;
  parcelaDesejada?: number | null;
  documentosRecebidos?: string[];
};

// A renda que o banco olha é a FAMILIAR: titular + cônjuge. É ela que define a
// faixa, e é por isso que casal que sozinho não passa muitas vezes passa junto.
export function rendaFamiliar(r: Respostas): number | null {
  const a = r.rendaBrutaMensal ?? null;
  const b = temConjuge(r) ? (r.conjugeRendaBrutaMensal ?? null) : null;
  if (a == null && b == null) return null;
  return (a ?? 0) + (b ?? 0);
}

// Converte a linha do banco em Respostas. Decimal vira number só aqui — o
// resto do módulo trabalha com tipos simples e testáveis sem Prisma.
export function respostasDaQualificacao(q: {
  quartosDesejados: number | null;
  banheirosDesejados: number | null;
  localizacaoDesejada: string | null;
  primeiroImovel: boolean | null;
  nomeRestrito: boolean | null;
  previsaoQuitacao: Date | null;
  temOutroTitular: boolean | null;
  nomeAlternativo: string | null;
  estadoCivil: string | null;
  vinculo: string | null;
  tresAnosRegistro: boolean | null;
  dependentes: number | null;
  rendaBrutaMensal: { toString(): string } | null;
  rendaDeclaradaIr: boolean | null;
  dataNascimento: Date | null;
  temFgts: boolean | null;
  conjugeImovelProprio: boolean | null;
  conjugeNome: string | null;
  conjugeVinculo: string | null;
  conjugeRendaBrutaMensal: { toString(): string } | null;
  conjugeDataNascimento: Date | null;
  entradaDisponivel: { toString(): string } | null;
  querParcelarEntrada: boolean | null;
  parcelaDesejada: { toString(): string } | null;
  documentosRecebidos: string[];
}): Respostas {
  return {
    quartosDesejados: q.quartosDesejados,
    banheirosDesejados: q.banheirosDesejados,
    localizacaoDesejada: q.localizacaoDesejada,
    primeiroImovel: q.primeiroImovel,
    nomeRestrito: q.nomeRestrito,
    previsaoQuitacao: q.previsaoQuitacao,
    temOutroTitular: q.temOutroTitular,
    nomeAlternativo: q.nomeAlternativo,
    estadoCivil: q.estadoCivil,
    vinculo: q.vinculo,
    tresAnosRegistro: q.tresAnosRegistro,
    dependentes: q.dependentes,
    rendaBrutaMensal: q.rendaBrutaMensal == null ? null : Number(q.rendaBrutaMensal),
    rendaDeclaradaIr: q.rendaDeclaradaIr,
    dataNascimento: q.dataNascimento,
    temFgts: q.temFgts,
    conjugeImovelProprio: q.conjugeImovelProprio,
    conjugeNome: q.conjugeNome,
    conjugeVinculo: q.conjugeVinculo,
    conjugeRendaBrutaMensal:
      q.conjugeRendaBrutaMensal == null ? null : Number(q.conjugeRendaBrutaMensal),
    conjugeDataNascimento: q.conjugeDataNascimento,
    entradaDisponivel: q.entradaDisponivel == null ? null : Number(q.entradaDisponivel),
    querParcelarEntrada: q.querParcelarEntrada,
    parcelaDesejada: q.parcelaDesejada == null ? null : Number(q.parcelaDesejada),
    documentosRecebidos: q.documentosRecebidos,
  };
}

export const VINCULOS = ["CLT", "AUTONOMO", "MEI", "EMPRESARIO", "SERVIDOR", "APOSENTADO"] as const;
export type Vinculo = (typeof VINCULOS)[number];

// Autônomo, MEI e empresário não têm carteira nem holerite. Servidor e
// aposentado têm contracheque (holerite), mas não CTPS de carteira assinada —
// para efeito de documento, o que importa é ter comprovante de renda mensal.
export function temCarteira(vinculo: string | null | undefined): boolean {
  return vinculo === "CLT" || vinculo === "SERVIDOR" || vinculo === "APOSENTADO";
}

export function respondida(r: Respostas, chave: ChavePergunta): boolean {
  const v = r[chave];
  return v !== null && v !== undefined && v !== "";
}

// As perguntas que valem para ESTE caso: as condicionais entram só quando a
// condição delas é verdade (cônjuge só para quem tem cônjuge).
export function perguntasAplicaveis(r: Respostas): Pergunta[] {
  return PERGUNTAS.filter((p) => !p.seAplica || p.seAplica(r));
}

// Nome restrito SEM outro titular: a escada para. Não adianta perguntar renda de
// quem o banco não vai aprovar, e insistir só queima o contato. Destrava quando
// aparece um nome alternativo (ou quando a restrição deixa de existir).
export function bloqueadoPorRestricao(r: Respostas): boolean {
  return temRestricao(r) && r.temOutroTitular !== true;
}

// A próxima pergunta a fazer — null quando a escada acabou. É isto que a IA usa
// para nunca repetir pergunta já respondida.
// Perguntas que continuam valendo mesmo com a escada bloqueada: são as que
// podem DESBLOQUEAR (outro titular) ou agendar a volta (previsão de quitação).
const DA_RESTRICAO: ChavePergunta[] = ["previsaoQuitacao", "temOutroTitular", "nomeAlternativo"];

export function proximaPergunta(r: Respostas): Pergunta | null {
  const pendentes = perguntasAplicaveis(r).filter((p) => !respondida(r, p.chave));
  // Bloqueado: procura a próxima DENTRO do bloco da restrição. Testar se a
  // primeira pendente global por acaso é uma delas não serve — quando o cliente
  // ABRE dizendo que tem restrição, a primeira pendente é "quantos quartos", e
  // a escada devolvia null antes de coletar a data da quitação.
  if (bloqueadoPorRestricao(r)) {
    return pendentes.find((p) => DA_RESTRICAO.includes(p.chave)) ?? null;
  }
  return pendentes[0] ?? null;
}

export function perguntasPendentes(r: Respostas): Pergunta[] {
  return perguntasAplicaveis(r).filter((p) => !respondida(r, p.chave));
}

// Quais documentos ainda faltam, já descontando os que não se aplicam ao
// vínculo declarado.
export function documentosAplicaveis(r: Respostas): Documento[] {
  const comCarteira = temCarteira(r.vinculo);
  return DOCUMENTOS.filter((d) => {
    // Cônjuge: só entra quando existe cônjuge. Enquanto o estado civil não foi
    // perguntado, fica fora — pedir documento de esposa a um solteiro é pior
    // que pedir depois.
    if (d.soComConjuge) return temConjuge(r);
    if (!d.soComCarteira) return true;
    // Enquanto o vínculo não foi declarado, o padrão é pedir a lista completa.
    if (r.vinculo == null) return true;
    if (d.chave === "EXTRATO_FGTS") return r.temFgts !== false;
    return comCarteira;
  });
}

export function documentosPendentes(r: Respostas): Documento[] {
  const recebidos = new Set(r.documentosRecebidos ?? []);
  return documentosAplicaveis(r).filter((d) => !recebidos.has(d.chave));
}

export function normalizarDocumentos(valores: unknown[]): ChaveDocumento[] {
  const validos = valores
    .map((v) => String(v).trim().toUpperCase())
    .filter((v): v is ChaveDocumento => DOCUMENTOS.some((d) => d.chave === v));
  return [...new Set(validos)];
}

// ─── Análise ────────────────────────────────────────────────────────────────

// Teto do prazo pela idade: a Caixa exige idade + prazo ≤ 80 anos e 6 meses,
// e o prazo máximo é de 420 meses (35 anos).
export const IDADE_LIMITE_MESES = 80 * 12 + 6;
export const PRAZO_MAX_MESES = 420;

export function idadeEmAnos(nascimento: Date | string, hoje: Date = new Date()): number {
  const n = new Date(nascimento);
  let anos = hoje.getUTCFullYear() - n.getUTCFullYear();
  const mes = hoje.getUTCMonth() - n.getUTCMonth();
  if (mes < 0 || (mes === 0 && hoje.getUTCDate() < n.getUTCDate())) anos--;
  return anos;
}

export function prazoMaximoMeses(nascimento: Date | string, hoje: Date = new Date()): number {
  const n = new Date(nascimento);
  const meses =
    (hoje.getUTCFullYear() - n.getUTCFullYear()) * 12 + (hoje.getUTCMonth() - n.getUTCMonth());
  return Math.max(0, Math.min(PRAZO_MAX_MESES, IDADE_LIMITE_MESES - meses));
}

export type Analise = {
  completa: boolean; // as 7 perguntas respondidas
  respondidas: number;
  total: number;
  faixa: Faixa | null;
  parcelaMaxima: number | null;
  prazoMaximoMeses: number | null;
  idade: number | null;
  podeUsarFgts: boolean | null; // null enquanto não dá para saber
  entradaDisponivel: number | null;
  parcelaDesejada: number | null;
  // Sem entrada e querendo parcelar: só empreendimento NÃO ENTREGUE serve.
  somenteNaPlanta: boolean;
  // Escada parada por nome restrito. `retomarEm` é quando a Maitê volta.
  bloqueio: { motivo: string; retomarEm: Date | null } | null;
  // O que a pessoa quer, para filtrar a busca.
  quartos: number | null;
  banheiros: number | null;
  localizacao: string | null;
  // Teto de compra pelo programa MAIS a entrada declarada. É o número que
  // realmente filtra o que apresentar.
  tetoComEntrada: number | null;
  // Barreiras de verdade (tiram do programa) e avisos (mudam o caminho).
  impeditivos: string[];
  atencoes: string[];
  documentosPendentes: Documento[];
};

export function analisar(r: Respostas, hoje: Date = new Date()): Analise {
  const aplicaveis = perguntasAplicaveis(r);
  const respondidas = aplicaveis.filter((p) => respondida(r, p.chave)).length;
  // A faixa é da renda FAMILIAR (titular + cônjuge), não só da do titular.
  const renda = rendaFamiliar(r);
  const faixa = renda != null ? (faixaPelaRenda(renda) ?? null) : null;

  const impeditivos: string[] = [];
  const atencoes: string[] = [];

  // Restrição de nome: o bloqueio vem antes de qualquer conta.
  const bloqueado = bloqueadoPorRestricao(r);
  if (bloqueado) {
    impeditivos.push(
      "Nome restrito e sem outro titular: NÃO siga a qualificação e NÃO apresente imóvel. " +
        (r.previsaoQuitacao
          ? `Retomar em ${new Date(r.previsaoQuitacao).toLocaleDateString("pt-BR")}.`
          : "Pegue a previsão de quitação para agendar a volta.")
    );
  } else if (temRestricao(r)) {
    atencoes.push(
      `Restrição no nome do interessado: o financiamento vai no nome de ${r.nomeAlternativo ?? "outro titular"}.`
    );
  }

  // Sem entrada e querendo parcelar: imóvel pronto não parcela entrada.
  const somenteNaPlanta = semEntrada(r) && r.querParcelarEntrada === true;
  if (somenteNaPlanta) {
    atencoes.push(
      "Sem entrada e quer parcelar: SÓ empreendimento não entregue (a construtora parcela). " +
        "Pronto exige entrada à vista, e aqui o FGTS é o caminho da entrada."
    );
  }

  if (temConjuge(r) && r.conjugeImovelProprio === true) {
    // Mesma regra do titular: no financiamento os dois entram como compradores,
    // então o imóvel do cônjuge conta como se fosse do casal.
    impeditivos.push(
      "Cônjuge já tem imóvel no nome: o CASAL fica fora do MCMV. A compra segue NORMAL, por SBPE/SFH."
    );
  }
  if (r.primeiroImovel === false) {
    // Não é recusa: é outra prateleira. Quem já tem imóvel compra normalmente,
    // só que fora do programa. Tratar como "não dá" perde a venda.
    impeditivos.push(
      "Já tem imóvel no nome: fora do MCMV. A compra segue NORMAL, por SBPE/SFH — não fale em faixa nem subsídio com esta pessoa."
    );
  }
  if (renda != null && !faixa) {
    const teto = FAIXAS_MCMV.at(-1)!.rendaAte;
    impeditivos.push(
      `Renda acima de ${teto.toLocaleString("pt-BR")} — fora do MCMV. Caminho é SBPE/SFH.`
    );
  }

  if (r.vinculo != null && !temCarteira(r.vinculo)) {
    atencoes.push("Autônomo/MEI: renda comprovada por IR e extratos, não por holerite.");
  }
  if (r.rendaDeclaradaIr === false) {
    // Não é impeditivo: parte da renda pode ser declarada. Mas muda a conta, e
    // descobrir isso na análise do banco é tarde demais.
    atencoes.push(
      "Renda NÃO declarada no último IR: o banco só considera renda comprovável. Confirme quanto é declarado."
    );
  }
  if (temConjuge(r) && r.conjugeRendaBrutaMensal != null && r.rendaBrutaMensal != null) {
    atencoes.push(
      `Renda familiar composta: ${r.rendaBrutaMensal.toLocaleString("pt-BR")} + ${r.conjugeRendaBrutaMensal.toLocaleString("pt-BR")} do cônjuge.`
    );
  }
  if (r.temFgts === false) {
    atencoes.push("Sem FGTS: a entrada tem de sair de recursos próprios.");
  } else if (r.temFgts === true && r.tresAnosRegistro === false) {
    atencoes.push("Tem FGTS mas menos de 3 anos de registro: sem Pró-Cotista.");
  }

  // Num casal, o prazo é limitado pelo comprador MAIS VELHO — usar só a idade do
  // titular daria um prazo que o banco não concede.
  let prazo: number | null = null;
  let idade: number | null = null;
  const nascimentos = [r.dataNascimento, temConjuge(r) ? r.conjugeDataNascimento : null].filter(
    (d): d is Date | string => !!d
  );
  if (nascimentos.length > 0) {
    idade = Math.max(...nascimentos.map((d) => idadeEmAnos(d, hoje)));
    prazo = Math.min(...nascimentos.map((d) => prazoMaximoMeses(d, hoje)));
    if (prazo < 120) {
      atencoes.push(
        `Idade ${idade}: prazo máximo de ${prazo} meses, então a parcela sai mais alta.`
      );
    }
  }

  // Expectativa de parcela contra o que o banco aceita. Descobrir isso agora
  // evita levar para a proposta quem só fecha num valor que não existe.
  if (r.parcelaDesejada != null && renda != null) {
    const teto = renda * COMPROMETIMENTO_MAX;
    if (r.parcelaDesejada > teto) {
      atencoes.push(
        `Parcela esperada de ${r.parcelaDesejada.toLocaleString("pt-BR")} acima do que a renda permite (${Math.round(teto).toLocaleString("pt-BR")}).`
      );
    }
  }

  const podeUsarFgts =
    r.temFgts == null || r.tresAnosRegistro == null ? null : r.temFgts && r.tresAnosRegistro;

  return {
    // Bloqueada NÃO é completa: faltou o que decide, não o que ajusta.
    completa: !bloqueado && respondidas === aplicaveis.length,
    respondidas,
    total: aplicaveis.length,
    faixa,
    parcelaMaxima: renda != null ? renda * COMPROMETIMENTO_MAX : null,
    prazoMaximoMeses: prazo,
    idade,
    podeUsarFgts,
    entradaDisponivel: r.entradaDisponivel ?? null,
    parcelaDesejada: r.parcelaDesejada ?? null,
    somenteNaPlanta,
    bloqueio: bloqueado
      ? {
          motivo: "nome restrito sem outro titular",
          retomarEm: r.previsaoQuitacao ? new Date(r.previsaoQuitacao) : null,
        }
      : null,
    quartos: r.quartosDesejados ?? null,
    banheiros: r.banheirosDesejados ?? null,
    localizacao: r.localizacaoDesejada ?? null,
    tetoComEntrada: faixa ? faixa.tetoImovel + (r.entradaDisponivel ?? 0) : null,
    impeditivos,
    atencoes,
    documentosPendentes: documentosPendentes(r),
  };
}

// Resumo em uma linha, para o card do CRM e para a IA se situar rápido.
export function resumo(r: Respostas): string {
  const a = analisar(r);
  const partes = [`${a.respondidas}/${a.total} perguntas`];
  if (a.bloqueio) partes.push("parado: nome restrito");
  else if (a.faixa) partes.push(a.faixa.rotulo);
  else if (a.impeditivos.length > 0) partes.push("fora do MCMV");
  if (a.completa) {
    const aplicaveis = documentosAplicaveis(r).length;
    partes.push(`${aplicaveis - a.documentosPendentes.length}/${aplicaveis} documentos`);
  }
  return partes.join(" · ");
}

/**
 * A FICHA: o que a pessoa respondeu, pergunta por pergunta.
 *
 * `resumo()` logo acima devolve o PLACAR — "8/14 perguntas · Faixa 2". Serve
 * para a tela, onde a ficha inteira está a um clique. Não serve para o aviso
 * que chega no WhatsApp de quem vai atender: em 21/08/2026 um corretor recebeu
 * "Qualificação: 8/14 perguntas" sobre um lead que tinha acabado de informar
 * 400 mil de entrada, união estável, autônomo e sem restrição no nome. Todo o
 * trabalho da IA ficou do lado de cá, e quem ia ligar não soube de nada.
 *
 * Devolve pares (rótulo, valor) só do que FOI respondido, na ordem em que a IA
 * pergunta — que é a ordem em que a conversa aconteceu, e por isso a mais fácil
 * de conferir contra o histórico logo abaixo dela na mensagem.
 *
 * Os rótulos saem de `PERGUNTAS`, os mesmos da ficha na tela: um segundo mapa
 * de rótulos aqui viraria a versão que discorda da outra quando alguém renomear
 * uma pergunta.
 */
export function fichaRespondida(r: Respostas): { rotulo: string; valor: string }[] {
  const linhas: { rotulo: string; valor: string }[] = [];

  for (const p of perguntasAplicaveis(r)) {
    if (!respondida(r, p.chave)) continue;
    const bruto = (r as Record<string, unknown>)[p.chave];
    const valor = formatarResposta(p.chave, bruto);
    if (valor) linhas.push({ rotulo: p.rotulo, valor });
  }

  return linhas;
}

/**
 * Enum do banco → o que se lê.
 *
 * Só entram os que o `Capitalizado` genérico erraria — os acentuados e o
 * composto. `CLT` fica como está de propósito: é sigla, e "Clt" seria pior.
 *
 * Existe uma tradução inline em `app/(comercial)/leads/[id]/page.tsx` fazendo
 * quase isto (e sem os acentos). Ela não foi mexida aqui para não colidir com
 * quem estiver na tela agora, mas é a mesma regra em dois lugares — quando uma
 * das duas mudar, esta é a que tem teste.
 */
const ROTULO_ENUM: Record<string, string> = {
  UNIAO_ESTAVEL: "União estável",
  AUTONOMO: "Autônomo",
  EMPRESARIO: "Empresário",
  SERVIDOR: "Servidor público",
  APOSENTADO: "Aposentado",
  VIUVO: "Viúvo",
  CLT: "CLT",
  MEI: "MEI",
};

export function rotuloDoEnum(valor: string): string {
  const pronto = ROTULO_ENUM[valor];
  if (pronto) return pronto;
  // Fallback: SOLTEIRO → Solteiro, CASADO → Casado.
  return valor.charAt(0) + valor.slice(1).toLowerCase().replace(/_/g, " ");
}

/** Traduz o valor cru para o que uma pessoa lê. */
function formatarResposta(chave: ChavePergunta, bruto: unknown): string | null {
  if (bruto == null || bruto === "") return null;

  // Booleano vira "sim"/"não" — menos `nomeRestrito`, onde "sim" sozinho é
  // ambíguo (sim, tem restrição? sim, está limpo?) e a resposta errada muda o
  // atendimento inteiro.
  if (typeof bruto === "boolean") {
    if (chave === "nomeRestrito") return bruto ? "SIM — tem restrição" : "não, nome limpo";
    return bruto ? "sim" : "não";
  }

  // Dinheiro: os campos de valor vêm como número ou Decimal do Prisma.
  if (chave === "rendaBrutaMensal" || chave === "conjugeRendaBrutaMensal" ||
      chave === "entradaDisponivel" || chave === "parcelaDesejada") {
    const n = Number(bruto);
    return Number.isFinite(n) ? `R$ ${n.toLocaleString("pt-BR")}` : null;
  }

  if (bruto instanceof Date) return bruto.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });

  // `dependentes: 0` é resposta, não ausência — e `respondida()` já sabe disso.
  // Sem este ramo o zero cairia no `!valor` do chamador e sumiria da ficha.
  if (typeof bruto === "number") return String(bruto);

  // String de enum (estado civil, vínculo) sai legível; texto livre
  // (localização, nomes) passa como a pessoa escreveu.
  const texto = String(bruto);
  return /^[A-Z_]+$/.test(texto) ? rotuloDoEnum(texto) : texto;
}

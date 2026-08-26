// Empreendimento: regras de ENTREGA e de ENQUADRAMENTO MCMV.
//
// Duas coisas moram aqui, e as duas existem porque a informação certa muda a
// conversa comercial:
//
//   1. Entrega — "quando fica pronto" tem TRÊS respostas diferentes, e misturá-las
//      é como a imobiliária promete o que não pode cumprir. Ver SITUACAO abaixo.
//   2. MCMV — a faixa é definida pela RENDA do comprador; o que o imóvel define é
//      só o TETO (se o preço passa do teto da faixa, aquele comprador não leva).
//      Por isso `faixasPeloPreco` responde "quem pode comprar isto", e não
//      "qual é a faixa deste imóvel" — a segunda pergunta não tem resposta.

export type Faixa = {
  faixa: 1 | 2 | 3 | 4;
  rendaDe: number; // renda bruta familiar mensal — piso (exclusivo)
  rendaAte: number; // teto da faixa
  tetoImovel: number; // valor máximo do imóvel financiável na faixa
  jurosAnoPct: number; // taxa de referência ao ano
  rotulo: string;
};

// Referência: regras do MCMV vigentes em 2026 (Faixa 4 criada em 2025 para a
// classe média). Os tetos de imóvel e as taxas mudam por portaria — estão aqui,
// numa tabela só, justamente para a atualização ser em um lugar.
export const FAIXAS_MCMV: Faixa[] = [
  { faixa: 1, rendaDe: 0, rendaAte: 2850, tetoImovel: 350_000, jurosAnoPct: 4, rotulo: "Faixa 1" },
  { faixa: 2, rendaDe: 2850, rendaAte: 4700, tetoImovel: 350_000, jurosAnoPct: 5, rotulo: "Faixa 2" },
  { faixa: 3, rendaDe: 4700, rendaAte: 8000, tetoImovel: 350_000, jurosAnoPct: 8.16, rotulo: "Faixa 3" },
  { faixa: 4, rendaDe: 8000, rendaAte: 13_000, tetoImovel: 600_000, jurosAnoPct: 10.5, rotulo: "Faixa 4" },
];

// Comprometimento máximo de renda aceito pelos bancos. É o primeiro filtro de
// qualquer simulação — antes dele, nenhuma conta de parcela significa nada.
export const COMPROMETIMENTO_MAX = 0.3;

export function faixa(n: number): Faixa | undefined {
  return FAIXAS_MCMV.find((f) => f.faixa === n);
}

// Quais faixas podem comprar um imóvel deste preço (as que têm teto suficiente).
// Preço acima do maior teto → nenhuma: é venda fora do programa.
export function faixasPeloPreco(preco: number | null | undefined): Faixa[] {
  if (preco == null || preco <= 0) return [];
  return FAIXAS_MCMV.filter((f) => preco <= f.tetoImovel);
}

// Faixa de uma renda familiar. Acima do teto da Faixa 4, fica fora do MCMV
// (SBPE/SFH) — devolve undefined em vez de "empurrar" para a última faixa.
export function faixaPelaRenda(renda: number | null | undefined): Faixa | undefined {
  if (renda == null || renda <= 0) return undefined;
  return FAIXAS_MCMV.find((f) => renda > f.rendaDe && renda <= f.rendaAte);
}

export function parcelaMaxima(rendaBruta: number): number {
  return rendaBruta * COMPROMETIMENTO_MAX;
}

// Só faixas válidas, sem repetição e em ordem — o formulário manda o que o
// usuário marcou, e marcação de formulário é entrada não confiável.
export function normalizarFaixas(valores: unknown[]): number[] {
  const validas = valores
    .map((v) => Number(v))
    .filter((n) => FAIXAS_MCMV.some((f) => f.faixa === n));
  return [...new Set(validas)].sort((a, b) => a - b);
}

// ─── Entrega ────────────────────────────────────────────────────────────────

export function somarMeses(base: Date, meses: number): Date {
  const d = new Date(base);
  const diaOriginal = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + meses);
  // 31/01 + 1 mês vira 03/03 no JS. Um contrato que vence "no mesmo dia do mês"
  // vence no último dia do mês curto, não no mês seguinte.
  if (d.getUTCDate() < diaOriginal) d.setUTCDate(0);
  return d;
}

// A data que gera direito: início da obra + prazo contratual. Sem um dos dois,
// não existe prazo contratual — e dizer que existe seria inventar.
export function entregaContratual(
  emp: Pick<EmpreendimentoDatas, "obraIniciadaEm" | "prazoObraMeses">
): Date | null {
  if (!emp.obraIniciadaEm || !emp.prazoObraMeses) return null;
  return somarMeses(new Date(emp.obraIniciadaEm), emp.prazoObraMeses);
}

// Contrato de incorporação costuma admitir atraso tolerado (Lei 13.786/2018:
// até 180 dias). Passou disto, o atraso é inadimplemento da construtora.
export function limiteTolerado(emp: EmpreendimentoDatas): Date | null {
  const contratual = entregaContratual(emp);
  if (!contratual) return null;
  return somarMeses(contratual, emp.toleranciaMeses ?? 0);
}

export type EmpreendimentoDatas = {
  obraIniciadaEm: Date | string | null;
  prazoObraMeses: number | null;
  toleranciaMeses: number;
  entregaPrevista: Date | string | null;
  entregaReal: Date | string | null;
};

export type Situacao =
  | "ENTREGUE"
  | "SEM_DATA" // nada informado: não dá para prometer nada ao cliente
  | "NA_PLANTA" // tem previsão, obra ainda não começou
  | "EM_OBRAS" // dentro do prazo (ou da tolerância)
  | "EM_TOLERANCIA" // passou do contratual, ainda dentro do atraso admitido
  | "ATRASADA"; // passou até da tolerância

export type Entrega = {
  situacao: Situacao;
  rotulo: string;
  // A data que vale para cobrar: contratual quando existe, senão a previsão.
  referencia: Date | null;
  contratual: Date | null;
  tolerado: Date | null;
  diasDeAtraso: number; // 0 quando não há atraso
};

const DIA = 86_400_000;

export function analisarEntrega(emp: EmpreendimentoDatas, hoje: Date = new Date()): Entrega {
  const contratual = entregaContratual(emp);
  const tolerado = limiteTolerado(emp);
  const prevista = emp.entregaPrevista ? new Date(emp.entregaPrevista) : null;
  const referencia = contratual ?? prevista;

  if (emp.entregaReal) {
    const real = new Date(emp.entregaReal);
    // Entregue com atraso continua sendo atraso — o histórico da construtora é
    // o argumento do corretor na próxima obra dela.
    const atraso = referencia ? Math.max(0, Math.floor((real.getTime() - referencia.getTime()) / DIA)) : 0;
    return {
      situacao: "ENTREGUE",
      rotulo: atraso > 0 ? `Entregue com ${atraso} dia(s) de atraso` : "Entregue",
      referencia,
      contratual,
      tolerado,
      diasDeAtraso: atraso,
    };
  }

  if (!referencia) {
    return {
      situacao: "SEM_DATA",
      rotulo: "Sem data de entrega informada",
      referencia: null,
      contratual,
      tolerado,
      diasDeAtraso: 0,
    };
  }

  const limite = tolerado ?? referencia;
  if (hoje.getTime() > limite.getTime()) {
    const dias = Math.floor((hoje.getTime() - referencia.getTime()) / DIA);
    return {
      situacao: "ATRASADA",
      rotulo: `Atrasada há ${dias} dia(s)`,
      referencia,
      contratual,
      tolerado,
      diasDeAtraso: dias,
    };
  }

  if (hoje.getTime() > referencia.getTime()) {
    const dias = Math.floor((hoje.getTime() - referencia.getTime()) / DIA);
    return {
      situacao: "EM_TOLERANCIA",
      rotulo: `${dias} dia(s) além do prazo, dentro da tolerância`,
      referencia,
      contratual,
      tolerado,
      diasDeAtraso: dias,
    };
  }

  if (!emp.obraIniciadaEm) {
    return { situacao: "NA_PLANTA", rotulo: "Na planta", referencia, contratual, tolerado, diasDeAtraso: 0 };
  }
  return { situacao: "EM_OBRAS", rotulo: "Em obras, no prazo", referencia, contratual, tolerado, diasDeAtraso: 0 };
}

export const TOM_SITUACAO: Record<Situacao, "green" | "blue" | "amber" | "red" | "slate"> = {
  ENTREGUE: "green",
  NA_PLANTA: "blue",
  EM_OBRAS: "blue",
  EM_TOLERANCIA: "amber",
  ATRASADA: "red",
  SEM_DATA: "slate",
};

// Entrada parcelada é coisa de obra: a construtora divide a entrada durante a
// construção. Prédio entregue não tem o que dividir — a entrada é à vista.
export function permiteParcelarEntrada(emp: { entregaReal: Date | string | null }): boolean {
  return emp.entregaReal == null;
}

// A situação é DERIVADA das datas, não é coluna. Para filtrar no banco (antes
// do take, senão a página vem torta), traduzimos para condições sobre as datas.
export function whereSituacao(situacao: Situacao | "PARCELA_ENTRADA"): Record<string, unknown> {
  switch (situacao) {
    case "NA_PLANTA":
      return { obraIniciadaEm: null, entregaReal: null };
    case "EM_OBRAS":
      return { obraIniciadaEm: { not: null }, entregaReal: null };
    case "ENTREGUE":
      return { entregaReal: { not: null } };
    // Quem parcela entrada é qualquer obra não entregue (planta ou em obras).
    case "PARCELA_ENTRADA":
      return { entregaReal: null };
    default:
      return {};
  }
}

// ─── Ficha para a IA ────────────────────────────────────────────────────────

// Como o empreendimento é descrito para o modelo. CADA CAMPO COM RÓTULO, de
// propósito: um formato tipo "Residencial X (Pacaembu) em Y" faz o modelo ler a
// construtora como lugar e escrever "no Pacaembu" — que é uma EMPRESA, não um
// bairro. Rótulo explícito é o que impede a confusão.
export function fichaParaIA(
  e: {
    nome: string;
    construtora: string;
    bairro: string | null;
    cidade: string;
    uf: string;
    pontoReferencia: string | null;
    metragemM2: number | null;
    precoAvaliacao: number | null;
    faixasMcmv: number[];
    quartos?: number | null;
    banheiros?: number | null;
    vagas?: number | null;
    bookUrl?: string | null;
    entregaReal?: Date | string | null;
  },
  opcoes: { unidadesComFoto?: string[]; hoje?: Date; entrega?: EmpreendimentoDatas } = {}
): string {
  const brl = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const campos = [
    `nome: ${e.nome}`,
    `construtora (EMPRESA, não é bairro): ${e.construtora}`,
    `bairro: ${e.bairro ?? "não informado"}`,
    `cidade: ${e.cidade}/${e.uf}`,
  ];
  if (e.pontoReferencia) campos.push(`ponto de referência: ${e.pontoReferencia}`);
  // Produto: é por aqui que o comprador elimina.
  if (e.quartos != null) campos.push(`quartos: ${e.quartos}`);
  if (e.banheiros != null) campos.push(`banheiros: ${e.banheiros}`);
  if (e.vagas != null) campos.push(`vagas: ${e.vagas}`);
  campos.push(`preço: ${brl(e.precoAvaliacao)}`);
  if (e.metragemM2) {
    const m2 = valorM2(e.precoAvaliacao, e.metragemM2);
    campos.push(`área: ${e.metragemM2} m²${m2 ? ` (${brl(m2)} por m²)` : ""}`);
  }
  if (opcoes.entrega) {
    const a = analisarEntrega(opcoes.entrega, opcoes.hoje);
    campos.push(
      `entrega: ${a.rotulo}` +
        (a.referencia ? ` (previsão ${a.referencia.toLocaleDateString("pt-BR")})` : "")
    );
  }
  campos.push(`MCMV: ${e.faixasMcmv.length ? `faixa ${e.faixasMcmv.join(", ")}` : "fora do programa"}`);
  // Foto é do IMÓVEL (unidade), nunca do empreendimento. Sem dizer isto, a IA
  // oferece "quer ver as fotos?" de algo que não tem foto nenhuma.
  const comFoto = opcoes.unidadesComFoto ?? [];
  campos.push(
    comFoto.length === 0
      ? "fotos: NÃO EXISTEM fotos deste empreendimento. NÃO ofereça fotos."
      : `fotos: só das unidades ${comFoto.join(", ")} — use enviar_fotos_imovel com o código da unidade`
  );
  // Book: material de venda em PDF. É o ÚNICO material que existe — e só quando
  // está aqui é que a IA pode oferecer.
  campos.push(
    e.bookUrl
      ? "book: DISPONÍVEL — use enviar_book_empreendimento para mandar o PDF"
      : "book: não tem. NÃO prometa material deste empreendimento."
  );
  // Entrada parcelada: obra não entregue parcela; pronto exige à vista.
  if (e.entregaReal !== undefined) {
    campos.push(
      permiteParcelarEntrada({ entregaReal: e.entregaReal ?? null })
        ? "entrada: pode ser PARCELADA com a construtora (obra não entregue)"
        : "entrada: à vista (já entregue, não parcela)"
    );
  }
  return campos.join(" | ");
}

// R$/m² — a única comparação que funciona entre empreendimentos de metragens
// diferentes. Sem os dois números, não há o que comparar.
export function valorM2(
  preco: number | null | undefined,
  metragem: number | null | undefined
): number | null {
  if (!preco || !metragem || metragem <= 0) return null;
  return preco / metragem;
}

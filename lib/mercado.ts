// Referência de preço para as IAs. Combina duas fontes, sempre honestas:
//  1. a NOSSA carteira (prioritária) — a faixa dos imóveis semelhantes que temos;
//  2. o MERCADO por comparáveis de anúncios (ZAP/VivaReal/OLX), via serviço
//     externo, quando configurado — dá noção de preço/bairro em qualquer cidade.
// O mercado serve só para a IA precificar com mais assertividade; NUNCA para
// oferecer imóvel ou mandar link de portal (a oferta é sempre da carteira).
// Sem base em nenhuma das duas, a IA oferece a avaliação do corretor (não inventa).

import { prisma } from "@/lib/db";
import { brl } from "@/lib/format";
import { buscarComparaveis } from "@/lib/comparaveis";

type Params = {
  imobiliariaId: number;
  finalidade: "LOCACAO" | "VENDA";
  tipo?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  areaM2?: number | null;
};

function estatisticas(valores: number[]) {
  const v = valores.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return null;
  const soma = v.reduce((s, x) => s + x, 0);
  const meio = Math.floor(v.length / 2);
  const mediana = v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
  return { n: v.length, min: v[0], max: v[v.length - 1], media: soma / v.length, mediana };
}

// Referência pela própria carteira (bairro primeiro; se pouco, cidade).
async function referenciaCarteira(p: Params): Promise<string | null> {
  const campo = p.finalidade === "VENDA" ? "valorVenda" : "valorSugerido";
  const finFiltro = p.finalidade === "VENDA" ? ["VENDA", "AMBOS"] : ["LOCACAO", "AMBOS"];
  const baseWhere = {
    imobiliariaId: p.imobiliariaId,
    finalidade: { in: finFiltro },
    ...(p.tipo ? { tipo: { contains: p.tipo, mode: "insensitive" as const } } : {}),
    [campo]: { not: null },
  };
  let imoveis = p.bairro
    ? await prisma.imovel.findMany({ where: { ...baseWhere, bairro: { contains: p.bairro, mode: "insensitive" } } })
    : [];
  let escopo = `bairro ${p.bairro}`;
  if (imoveis.length < 3) {
    imoveis = await prisma.imovel.findMany({
      where: { ...baseWhere, ...(p.cidade ? { cidade: { contains: p.cidade, mode: "insensitive" } } : {}) },
    });
    escopo = p.cidade ? `cidade ${p.cidade}` : "carteira";
  }
  const est = estatisticas(
    imoveis.map((i) => Number((p.finalidade === "VENDA" ? i.valorVenda : i.valorSugerido) ?? 0))
  );
  if (!est) return null;
  const unidade = p.finalidade === "VENDA" ? "" : "/mês";
  return `Na nossa carteira (${escopo}, ${est.n} imóvel(is) semelhantes): de ${brl(est.min)} a ${brl(est.max)}${unidade}, média ${brl(est.media)}${unidade}.`;
}

// Referência de mercado por comparáveis de anúncios (quando o serviço externo
// está configurado). Devolve uma frase com a faixa típica e o R$/m² mediano —
// SEM link, foto ou contato: é só para a IA precificar com mais noção.
async function referenciaComparaveis(p: Params): Promise<string | null> {
  const comps = await buscarComparaveis({
    finalidade: p.finalidade,
    cidade: p.cidade,
    uf: p.uf,
    bairro: p.bairro,
    tipo: p.tipo,
    areaM2: p.areaM2,
  });
  if (!comps || comps.length < 4) return null; // amostra pequena não vira referência

  const precos = estatisticas(comps.map((c) => c.price ?? 0));
  if (!precos) return null;
  const unidade = p.finalidade === "VENDA" ? "" : "/mês";
  const local = p.bairro ? `${p.bairro}${p.cidade ? `, ${p.cidade}` : ""}` : p.cidade ?? "região";

  // R$/m² mediano dos anúncios que têm área — permite estimar por metragem.
  const porM2 = comps
    .filter((c) => (c.price ?? 0) > 0 && (c.area_m2 ?? 0) > 0)
    .map((c) => (c.price as number) / (c.area_m2 as number));
  const m2 = estatisticas(porM2);

  let frase = `No mercado (anúncios em ${local}, ${precos.n} comparáveis): faixa típica de ${brl(precos.min)} a ${brl(precos.max)}${unidade}, mediana ${brl(precos.mediana)}${unidade}.`;
  if (m2) {
    frase += ` R$/m² mediano ~${brl(m2.mediana)}.`;
    if (p.areaM2 && p.areaM2 > 0) {
      frase += ` Para ~${Math.round(p.areaM2)} m², isso dá algo perto de ${brl(m2.mediana * p.areaM2)}${unidade}.`;
    }
  }
  return frase;
}

// Referência de mercado combinada. Carteira primeiro (o que temos de fato),
// depois o mercado por comparáveis (noção da cidade/bairro). Sem base em nenhuma,
// orienta a IA a oferecer a avaliação do corretor em vez de inventar preço.
export async function referenciaMercado(p: Params): Promise<string> {
  const [carteira, comparaveis] = await Promise.all([
    referenciaCarteira(p),
    referenciaComparaveis(p).catch(() => null),
  ]);

  const partes: string[] = [];
  if (carteira) partes.push(carteira);
  if (comparaveis) partes.push(comparaveis);

  if (!partes.length)
    return "Não temos base de preço (nem na carteira, nem no mercado) pra esse caso. Não invente valor: ofereça a avaliação do corretor pra chegar no número certo.";

  const fechamento = carteira
    ? " Use como referência aproximada; a avaliação do corretor é o mais preciso. Só ofereça imóveis da nossa carteira, nunca de portal, e nunca mande link de anúncio de fora."
    : " Isso é só uma referência de mercado pra te orientar; a avaliação do corretor crava o número. Só ofereça imóveis da nossa carteira, nunca de portal.";
  return partes.join(" ") + fechamento;
}

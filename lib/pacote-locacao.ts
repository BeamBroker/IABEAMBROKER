// O PACOTE: o que a pessoa paga por mês para morar ali.
//
// ─── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA CORRIGIR ────────────────────────
//
// Quando alguém diz "procuro até 1.700" na locação, ela está falando do que sai
// da conta dela todo mês. Não do aluguel isolado: do aluguel MAIS o condomínio
// MAIS o IPTU. Ninguém aluga metade de um boleto.
//
// A busca de locação filtrava por `Imovel.valorSugerido`, que é só o aluguel:
//
//     ...(input.valorMaximo ? { valorSugerido: { lte: input.valorMaximo } } : {})
//
// Resultado: quem pediu até 1.700 recebia um apartamento de aluguel 1.500 com
// 400 de condomínio e 100 de IPTU. Dois mil reais apresentados como se fossem
// mil e quinhentos, e a conta só aparece na assinatura — que é o pior momento
// possível para o cliente descobrir que o imóvel nunca coube.
//
// E o IPTU não chegava nem na apresentação. O prompt de VENDAS mandava mostrar
// "o valor TOTAL (aluguel + condomínio + IPTU)" e a ferramenta devolvia apenas
// aluguel e condomínio: o modelo estava sendo mandado somar um número que
// ninguém tinha entregue a ele. `Imovel.valorIptuMensal` existe e é lido em
// `detalhes_imovel` desde sempre — só a busca do cliente não o selecionava.
//
// ─── NULO É "NÃO SEI", NUNCA "É ZERO" ───────────────────────────────────────
//
// É a mesma regra de `nomeRestrito` em lib/qualificacao.ts, e ela vale aqui
// pelo mesmo motivo: condomínio em branco no cadastro pode significar que o
// imóvel não tem, ou que ninguém preencheu. Tratar como zero transforma um
// cadastro incompleto numa afirmação de preço para o cliente.
//
// Por isso o pacote sabe dizer que está INCOMPLETO, e o total dele é um piso,
// não uma promessa. Quem apresenta um pacote incompleto oferece confirmar; não
// arredonda para baixo e torce.
//
// ─── SEM PRISMA, DE PROPÓSITO ───────────────────────────────────────────────
//
// Mesma razão dos módulos de cadência: cada número aqui é regra de negócio
// ("orçamento na locação é o pacote", "10% acima ainda vale mostrar"), e regra
// que só dá para conferir com banco de pé é regra que ninguém confere.

/** O que precisamos de um imóvel para montar o pacote. Os nomes são os do
 *  schema, para não existir um segundo vocabulário no meio do caminho. */
export type ValoresDoImovel = {
  /** O aluguel. `Imovel.valorSugerido`. */
  valorSugerido?: unknown;
  valorCondominio?: unknown;
  valorIptuMensal?: unknown;
};

export type Pacote = {
  aluguel: number;
  /** `null` quer dizer NÃO CADASTRADO, nunca zero. */
  condominio: number | null;
  iptu: number | null;
  /** A soma do que se sabe. Quando `completo` é false, isto é um PISO. */
  total: number;
  completo: boolean;
  /** O que falta, do jeito que a Maitê fala com o cliente. */
  faltando: string[];
};

/** Decimal do Prisma, número ou string do banco viram número aqui. `null` e
 *  `undefined` continuam distinguíveis de zero, que é o ponto inteiro. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function pacoteMensal(i: ValoresDoImovel): Pacote {
  const aluguel = num(i.valorSugerido) ?? 0;
  const condominio = num(i.valorCondominio);
  const iptu = num(i.valorIptuMensal);
  const faltando: string[] = [];
  if (condominio === null) faltando.push("condomínio");
  if (iptu === null) faltando.push("IPTU");
  return {
    aluguel,
    condominio,
    iptu,
    total: aluguel + (condominio ?? 0) + (iptu ?? 0),
    completo: faltando.length === 0,
    faltando,
  };
}

/** Quanto acima do teto ainda vale mostrar.
 *
 *  10%, e o número tem origem: o pedido descreve mostrar 1.800 para quem falou
 *  1.700 (uma diferença de 6%) e NÃO mostrar 2.100 ou 2.500 pelo mesmo teto.
 *  10% cobre o primeiro caso com folga e corta os outros dois — 1.700 vira
 *  1.870, e 2.100 fica de fora sem precisar de nenhuma regra a mais.
 *
 *  Uma margem maior não seria "mais opções": seria a Maitê apresentando como
 *  possível o que a pessoa já disse que não cabe, que é como se perde a
 *  confiança que faz ela responder a próxima mensagem. */
export const MARGEM_ACIMA = 0.1;

export function tetoComMargem(teto: number): number {
  return teto * (1 + MARGEM_ACIMA);
}

export type Encaixe = "dentro" | "pouco_acima" | "fora";

/** Onde este pacote cai em relação ao que a pessoa disse que pode pagar.
 *
 *  Pacote INCOMPLETO nunca é promovido a "dentro": o total dele é um piso, e
 *  chamar de "dentro do orçamento" o que pode ter 400 de condomínio escondido é
 *  exatamente o erro que este arquivo existe para não cometer. Ele entra como
 *  `pouco_acima` quando o piso já está dentro, para a Maitê mostrar oferecendo
 *  confirmar os valores. */
export function encaixe(p: Pacote, teto: number | null | undefined): Encaixe {
  if (!teto || teto <= 0) return "dentro";
  if (p.total > tetoComMargem(teto)) return "fora";
  if (p.total > teto) return "pouco_acima";
  return p.completo ? "dentro" : "pouco_acima";
}

/** O pacote escrito para a Maitê ler, com a conta aberta.
 *
 *  A conta vai aberta de propósito: sem ela o modelo não tem como responder
 *  "esse valor é o pacote ou o condomínio é à parte?", que é a pergunta que
 *  todo mundo faz na segunda mensagem. */
export function descreverPacote(p: Pacote, brl: (v: number) => string): string {
  const partes = [`aluguel ${brl(p.aluguel)}`];
  if (p.condominio !== null) partes.push(`cond. ${brl(p.condominio)}`);
  if (p.iptu !== null) partes.push(`IPTU ${brl(p.iptu)}`);
  const conta = partes.length > 1 ? ` (${partes.join(" + ")})` : "";
  const aviso = p.completo
    ? ""
    : ` | ATENÇÃO: ${p.faltando.join(" e ")} não consta no cadastro, então este total é um PISO. Não afirme que é o pacote fechado: ofereça confirmar.`;
  return `pacote ${brl(p.total)}/mês${conta}${aviso}`;
}

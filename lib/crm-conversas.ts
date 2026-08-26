// A conversa alimenta o quadro. Sozinha.
//
// O pedido do dono: "movimentar o CRM de acordo com cada conversa" — e ele foi
// explícito no que NÃO quer: ler a conversa e guardar no histórico. Histórico
// ninguém lê. O que ele olha é o quadro de negócios, e hoje ele está vazio
// enquanto o WhatsApp tem conversa de verdade acontecendo.
//
// O que este módulo faz, em uma frase: lê a conversa, entende o lead, e ou CRIA
// o card ou MOVE o que já existe.
//
// O detalhe que justifica o módulo existir separado das ferramentas da IA: no
// tenant que mais conversa, quem responde é GENTE, não a Maitê. Medido em
// 05/08 — 35 respostas de atendente, nenhuma citando a persona, com frases
// ("Isso", "Ah sim", "Vou confirmar com o proprietário aqui e te falo") que
// ninguém escreve com prompt. O uazapi espelha o que a equipe digita no celular
// para dentro da nossa tabela. Por isso não adianta pendurar isto numa
// ferramenta que a IA chama durante o atendimento: nas conversas que importam
// ela não está atendendo. A leitura tem que ser DEPOIS, sobre o que aconteceu.
import { prisma } from "@/lib/db";
import { criarNegocio, indiceDeEntrega, moverFase, FUNIL_PADRAO } from "@/lib/negocios";
import { entregarNegocio } from "@/lib/entrega-ia";
import { registrarUso } from "@/lib/uso-ia";

export type TemperaturaExtraida = "FRIO" | "MORNO" | "QUENTE";

/** Para onde o interesse da pessoa aponta. É esta a fronteira, não o funil. */
export type FinalidadeExtraida = "COMPRA" | "LOCACAO" | "NENHUMA";

/** O que a IA extrai de uma conversa. Nada além disto entra no CRM. */
export type LeituraDaConversa = {
  ehNegocio: boolean;
  finalidade: FinalidadeExtraida;
  nome: string | null;
  titulo: string | null;
  valor: number | null;
  temperatura: TemperaturaExtraida;
  motivo: string;
};

// Temperatura → FRAÇÃO do alcance da IA, pela ORDEM da fase, nunca pelo nome.
//
// As fases são dado do tenant e podem ser renomeadas (decisão nº 1 do módulo
// comercial: trocar nome é UPDATE, não deploy). Uma tabela de nomes fixos
// quebraria calada na primeira imobiliária que renomeasse "Qualificado", e o
// card iria para lugar nenhum.
//
// POR QUE FRAÇÃO E NÃO ÍNDICE ABSOLUTO. O dono pediu (10/08) que a IA leve o
// card "até a hora dela" — a Visita. Com índices fixos (0, 1, 2), o QUENTE
// parava na terceira coluna fosse qual fosse o funil, e mudar o teto exigiria
// mexer nos três números um a um, torcendo para nenhum passar do fim do funil
// do cliente. Com fração, o teto é UM número (`indiceDeEntrega`) e os degraus
// se acomodam sozinhos a funis de tamanhos diferentes.
//
// Com o teto na Visita (índice 3), a conta devolve EXATAMENTE o que já existia
// para os dois primeiros — FRIO→0, MORNO→floor(0,5×3)=1 — e só o QUENTE muda,
// de 2 para 3. Isso é de propósito: o pedido foi um só, e um recurso que
// também reposiciona o card frio de quebra é um recurso que o dono desliga na
// primeira vez que estranha.
const FRACAO_POR_TEMPERATURA: Record<TemperaturaExtraida, number> = {
  FRIO: 0,
  MORNO: 0.5,
  QUENTE: 1,
};

// `indiceDeEntrega` mora em lib/negocios.ts, e não aqui, para não fechar um
// ciclo de import: lib/entrega-ia.ts precisa dele e este arquivo precisa da
// entrega. Com a função no módulo de domínio, a seta aponta numa direção só.

const INSTRUCAO = `Você lê a conversa de WhatsApp de uma imobiliária e decide se ali existe um NEGÓCIO DE VENDA para o quadro comercial.

Responda APENAS com JSON, sem cercas de código e sem preâmbulo:
{"ehNegocio":bool,"finalidade":"COMPRA"|"LOCACAO"|"NENHUMA","nome":string|null,"titulo":string|null,"valor":number|null,"temperatura":"FRIO"|"MORNO"|"QUENTE","motivo":string}

finalidade é a decisão mais importante desta leitura:
- COMPRA: a pessoa quer COMPRAR um imóvel, ou é proprietário querendo VENDER o dele.
- LOCACAO: a pessoa quer ALUGAR, procura imóvel para morar pagando aluguel mensal, pergunta de fiador, caução ou seguro-fiança, ou é proprietário querendo pôr o imóvel para alugar.
- NENHUMA: cobrança, segunda via de boleto, manutenção, reajuste, ou papo sem assunto de imóvel.

Na dúvida entre COMPRA e LOCACAO, olhe o VALOR que a pessoa cita. "Até R$ 2.000" num imóvel residencial é aluguel mensal; "R$ 350 mil" é compra. Quem fala em parcela, financiamento, entrada ou MCMV quer COMPRAR.

ehNegocio = true somente quando finalidade é COMPRA e há interesse concreto. Aluguel NÃO entra no quadro comercial — ele vive no CRM de locação, que é outra tela.

titulo: uma linha que identifique o negócio na visão de quem olha o quadro, como "Apartamento Higienópolis — permuta por veículo". Nunca escreva "Lead do WhatsApp" nem repita só o nome.

valor: o valor do imóvel ou da proposta em reais, se alguém tiver dito um número. Sem número dito, null. Não estime.

temperatura, pelo que a PESSOA demonstrou, não pelo que o atendente prometeu:
- QUENTE: marcou visita, fez proposta, mandou documento, falou em fechar, insistiu em prazo.
- MORNO: disse o que procura, mandou fotos, perguntou preço, respondeu às perguntas.
- FRIO: só cumprimentou, sumiu depois da primeira resposta, ou o interesse é vago.

motivo: até 15 palavras dizendo o que na conversa te levou a essa temperatura. É o que a pessoa lê para conferir se você acertou.`;

/** Lê a conversa com a IA. Devolve `null` quando não dá para decidir. */
export async function lerConversa(
  imobiliariaId: number,
  mensagens: { autor: string; texto: string }[]
): Promise<LeituraDaConversa | null> {
  // Conversa curta demais não paga a chamada, e é onde mora o "oi" abandonado:
  // metade das conversas paradas tinha 1 ou 2 mensagens. Guardar ANTES da
  // chamada é o que impede a varredura de virar custo fixo por conversa morta.
  if (mensagens.length < 3) return null;

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { MODELO } = await import("@/lib/agentes");
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: MODELO,
    max_tokens: 400,
    system: INSTRUCAO,
    messages: [
      {
        role: "user",
        content: mensagens.map((m) => `${m.autor}: ${m.texto}`).join("\n").slice(0, 24_000),
      },
    ],
  });

  // O consumo entra no CMV do cliente. Gasto de IA que não aparece no relatório
  // vira surpresa na fatura — mesma regra da marcação de modelo de documento.
  await registrarUso(imobiliariaId, "VENDAS", MODELO, {
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
  });

  const texto = resp.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();

  try {
    // O modelo às vezes devolve a cerca de código apesar da instrução. Recortar
    // do primeiro `{` ao último `}` custa uma linha e evita perder a leitura
    // inteira por causa de três crases.
    const bruto = texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1);
    const j = JSON.parse(bruto) as Partial<LeituraDaConversa>;
    if (typeof j.ehNegocio !== "boolean") return null;
    const t = j.temperatura;
    // `finalidade` ausente vira LOCACAO, não COMPRA. Um modelo que não respondeu
    // o campo não pode abrir a porta do funil de venda por omissão: o padrão
    // seguro é o que NÃO cria card.
    const f = j.finalidade === "COMPRA" || j.finalidade === "NENHUMA" ? j.finalidade : "LOCACAO";
    return {
      ehNegocio: j.ehNegocio,
      finalidade: f,
      nome: typeof j.nome === "string" && j.nome.trim() ? j.nome.trim() : null,
      titulo: typeof j.titulo === "string" && j.titulo.trim() ? j.titulo.trim() : null,
      valor: typeof j.valor === "number" && Number.isFinite(j.valor) ? j.valor : null,
      temperatura: t === "QUENTE" || t === "MORNO" ? t : "FRIO",
      motivo: typeof j.motivo === "string" ? j.motivo.slice(0, 200) : "",
    };
  } catch {
    return null;
  }
}

export type ResultadoSincronia =
  | { acao: "ignorado"; porque: string }
  | { acao: "criado"; negocioId: number; fase: string }
  | { acao: "movido"; negocioId: number; de: string; para: string }
  | { acao: "parado"; negocioId: number; fase: string; porque: string };

/**
 * Uma conversa → um card. Cria se não existe, move se existe.
 *
 * O casamento é por TELEFONE dentro do tenant, que é o único identificador que
 * conversa e negócio compartilham (`Negocio.contatoTelefone`). Por isso conversa
 * sem telefone é ignorada em vez de virar card órfão: sem o telefone, a próxima
 * mensagem da mesma pessoa criaria um segundo card, e o quadro encheria de
 * duplicata que ninguém consegue juntar depois.
 */
export async function sincronizarCrmDaConversa(conversaId: number): Promise<ResultadoSincronia> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    select: {
      imobiliariaId: true,
      contatoNome: true,
      contatoTelefone: true,
      mensagens: {
        orderBy: { criadaEm: "asc" },
        select: { autor: true, texto: true },
        // As 60 últimas. A conversa mais longa em produção tem 691 mensagens, e
        // mandar tudo é caro sem ser melhor: a temperatura é do estado ATUAL da
        // pessoa, não do que ela disse há três semanas.
        take: 60,
      },
    },
  });
  if (!conversa) return { acao: "ignorado", porque: "conversa não existe" };
  if (!conversa.contatoTelefone) return { acao: "ignorado", porque: "conversa sem telefone" };

  const leitura = await lerConversa(conversa.imobiliariaId, conversa.mensagens);
  if (!leitura) return { acao: "ignorado", porque: "conversa curta ou leitura inválida" };
  if (!leitura.ehNegocio) return { acao: "ignorado", porque: leitura.motivo || "não é negócio" };

  // A FRONTEIRA, e ela é pela FINALIDADE — não pelo nome do funil.
  //
  // A primeira versão deste arquivo confiava em `funilAceitaNegocio`, com um
  // comentário afirmando que era ele quem mandava. Era falso: como o alvo é
  // sempre o funil "Venda", a guarda NUNCA era acionada. O resultado foi medido
  // em produção no mesmo dia — 10 dos 18 cards criados eram de ALUGUEL, com o
  // aluguel MENSAL somado como valor de pipeline de venda:
  //
  //   Beam Broker  5 de 6 cards, R$ 9.200/mês virando "previsão de fechamento"
  //   WSP Prime    5 de 12 cards, R$ 9.250/mês
  //
  // Dois desses contatos estavam PERDIDO no CRM de locação e ABERTO no funil de
  // venda ao mesmo tempo: o follow-up desistiu e o quadro dizia que o dinheiro
  // estava vivo. É exatamente a "duas verdades sobre o mesmo cliente" que a §2
  // do PLANO-COMERCIAL previu ao separar as duas tabelas em 03/08.
  //
  // Guarda por nome de funil só funciona quando QUEM CRIA escolhe o funil. Um
  // escritor automático não escolhe — então a fronteira dele tem que ser a
  // intenção da pessoa.
  if (leitura.finalidade !== "COMPRA")
    return {
      acao: "ignorado",
      porque: `finalidade ${leitura.finalidade}: aluguel vive no CRM de locação`,
    };

  // O funil padrão do tenant. `criarNegocio` recusa funil de locação (fronteira
  // de 03/08), então é ele quem manda aqui — não uma escolha nossa.
  const funil = await prisma.funil.findFirst({
    where: { imobiliariaId: conversa.imobiliariaId, nome: FUNIL_PADRAO },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  if (!funil || funil.fases.length === 0)
    return { acao: "ignorado", porque: `tenant sem funil "${FUNIL_PADRAO}" provisionado` };

  const teto = indiceDeEntrega(funil.fases);
  const alvo =
    funil.fases[
      Math.min(Math.floor(FRACAO_POR_TEMPERATURA[leitura.temperatura] * teto), funil.fases.length - 1)
    ];

  const existente = await prisma.negocio.findFirst({
    where: {
      imobiliariaId: conversa.imobiliariaId,
      contatoTelefone: conversa.contatoTelefone,
      resultado: "ABERTO",
    },
    include: { fase: true },
  });

  if (!existente) {
    const novo = await criarNegocio({
      imobiliariaId: conversa.imobiliariaId,
      funilId: funil.id,
      faseId: alvo.id,
      titulo: leitura.titulo ?? conversa.contatoNome ?? conversa.contatoTelefone,
      valor: leitura.valor,
      contatoNome: leitura.nome ?? conversa.contatoNome,
      contatoTelefone: conversa.contatoTelefone,
    });
    // Um QUENTE nasce direto na fase de entrega — então a entrega é tentada já
    // na criação, não só no movimento. Sem isto o card mais valioso seria
    // exatamente o que ficaria sem dono.
    await entregarNegocio(novo.id);
    return { acao: "criado", negocioId: novo.id, fase: alvo.nome };
  }

  // SÓ PARA A FRENTE.
  //
  // Um card em "Proposta" não volta para "Novo" porque a última mensagem soou
  // fria — a pessoa pode ter só demorado a responder. Regressão automática
  // apagaria o trabalho de quem moveu o card na mão, que é exatamente a
  // confiança que este recurso precisa ganhar antes de poder mais.
  if (alvo.ordem <= existente.fase.ordem)
    return {
      acao: "parado",
      negocioId: existente.id,
      fase: existente.fase.nome,
      porque: `${leitura.temperatura} não avança além de "${existente.fase.nome}"`,
    };

  await moverFase(existente.id, alvo.id);
  await entregarNegocio(existente.id);
  return { acao: "movido", negocioId: existente.id, de: existente.fase.nome, para: alvo.nome };
}

/**
 * Varre as conversas que mudaram e sincroniza cada uma.
 *
 * `desde` existe para a primeira execução poder pegar o que já está no banco:
 * hoje são 33 conversas e 1 negócio, e sem retroativo o dono abriria o quadro e
 * continuaria vendo um card só.
 */
export async function varrerConversasParaCrm(opcoes?: {
  desde?: Date;
  limite?: number;
}): Promise<{ vistas: number; criados: number; movidos: number; ignorados: number }> {
  const desde = opcoes?.desde ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const conversas = await prisma.conversa.findMany({
    where: { simulacao: false, atualizadaEm: { gte: desde }, contatoTelefone: { not: null } },
    select: { id: true },
    orderBy: { atualizadaEm: "desc" },
    take: opcoes?.limite ?? 100,
  });

  let criados = 0;
  let movidos = 0;
  let ignorados = 0;
  for (const c of conversas) {
    // Uma conversa que explode não pode parar a varredura: o resto do quadro
    // vale mais que a linha que falhou.
    try {
      const r = await sincronizarCrmDaConversa(c.id);
      if (r.acao === "criado") criados++;
      else if (r.acao === "movido") movidos++;
      else ignorados++;
    } catch {
      ignorados++;
    }
  }
  return { vistas: conversas.length, criados, movidos, ignorados };
}

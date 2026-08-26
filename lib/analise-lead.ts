// A leitura profunda da conversa de um lead — o que o cartão do Meu dia mostra
// além dos números.
//
// O pedido do dono: "essa análise da IA precisa ser profunda, cheia de detalhes
// que são importantes". O score ao lado (lib/score-lead.ts) responde "quanto
// vale"; este arquivo responde o que número nenhum alcança:
//
//   • QUEM é a pessoa, numa linha — casal, primeiro imóvel, procura no Centro.
//   • O QUE FOI PROMETIDO a ela e não foi cumprido.
//   • O QUE ESTÁ PRESTES A DAR ERRADO nesta conversa.
//
// A promessa não cumprida é a razão principal deste módulo existir, e ela SÓ é
// alcançável por leitura da conversa. Medido em 05/08: no tenant que mais
// conversa, quem responde é GENTE, não a Maitê — 35 respostas de atendente,
// digitadas no celular, espelhadas pelo uazapi para dentro da nossa tabela.
// "Te mando as fotos hoje à noite" foi digitado por uma pessoa, não registrado
// por nenhuma ferramenta, e nenhuma tabela do sistema sabe que isso foi dito.
// É o tipo de coisa que faz o cliente sumir sem ninguém entender por quê.
//
// ── O que este módulo NÃO faz ─────────────────────────────────────────────
//
// Não escreve no funil, não move card, não manda mensagem. Ele LÊ e guarda um
// resumo. Quem move o quadro é lib/crm-conversas.ts, que já existe e já tem a
// responsabilidade — duas leituras escrevendo no mesmo card acabariam
// disputando a fase.
//
// Sem migration: o resultado mora no `resultado` de ExecucaoJob, que já é usado
// assim por lib/acoes-varredura.ts.
import { prisma } from "@/lib/db";
import { podeConsumirIA, registrarUso } from "@/lib/uso-ia";

export const TIPO_JOB = "analise-lead";

/** Uma promessa feita ao cliente dentro da conversa. */
export type PromessaDaConversa = {
  /** O que foi prometido, nas palavras de quem prometeu. */
  oQue: string;
  /** Quando foi prometido para, como foi dito ("hoje à noite", "segunda"). */
  quando: string | null;
  /** A conversa mostra que aconteceu? */
  cumprida: boolean;
};

export type AnaliseDoLead = {
  /** Quem é a pessoa, em uma linha. */
  perfil: string;
  promessas: PromessaDaConversa[];
  /** O que está prestes a dar errado, ou `null` quando não há nada. */
  atencao: string | null;
};

/** O que fica guardado por conversa, dentro do resultado do job. */
export type AnaliseGuardada = AnaliseDoLead & {
  conversaId: number;
  /** `Conversa.atualizadaEm` de quando a análise foi feita. É a chave que evita
   *  reanalisar (e repagar) uma conversa que não mudou. */
  lidaAte: string;
};

// Poucas mensagens não pagam chamada: com duas linhas trocadas não há perfil
// nem promessa, e o modelo preencheria os campos assim mesmo — inventando.
export const MINIMO_MENSAGENS = 3;

const INSTRUCAO = `Você lê a conversa de WhatsApp entre uma imobiliária e um cliente e extrai o que o corretor precisa saber ANTES de ligar para essa pessoa.

Responda APENAS com JSON, sem cercas de código e sem preâmbulo:
{"perfil":string,"promessas":[{"oQue":string,"quando":string|null,"cumprida":bool}],"atencao":string|null}

perfil: UMA linha sobre quem é a pessoa e o que ela procura. Use só o que está escrito na conversa. Exemplo: "Casal, primeiro imóvel, procura 2 quartos no Centro, quer se mudar antes das aulas."

promessas: tudo que a imobiliária disse que ia fazer e o cliente ficou esperando. Inclua o que a EQUIPE digitou, não só o que o robô respondeu.
- "oQue": o que foi prometido, curto.
- "quando": o prazo como foi dito ("hoje à noite", "segunda", "amanhã cedo"). null se não houve prazo.
- "cumprida": true SÓ se a conversa mostra que aconteceu depois. Na dúvida, false.
Promessa não cumprida é a informação mais valiosa desta leitura. Não invente: se ninguém prometeu nada, devolva lista vazia.

atencao: o que está prestes a dar errado — cliente esperando resposta, irritação, prazo passando, concorrente citado, condição que não temos. null se não houver.

Não repita o que já está no perfil dentro de atencao. Não dê conselho de vendas. Não escreva nada fora do JSON.`;

/** Recorta do primeiro `{` ao último `}` e valida CAMPO A CAMPO.
 *
 *  Separado da chamada para ser testável sem rede — e porque validar por
 *  `as AnaliseDoLead` seria uma mentira de tipo: o que vem de um modelo é
 *  `unknown` até prova em contrário. */
export function lerAnalise(texto: string): AnaliseDoLead | null {
  try {
    const bruto = texto.slice(texto.indexOf("{"), texto.lastIndexOf("}") + 1);
    const j = JSON.parse(bruto) as Record<string, unknown>;
    const perfil = typeof j.perfil === "string" ? j.perfil.trim() : "";
    // Sem perfil não há análise: é o único campo que sempre tem resposta
    // possível, então vazio aqui significa que a leitura falhou.
    if (!perfil) return null;

    const promessas: PromessaDaConversa[] = Array.isArray(j.promessas)
      ? j.promessas
          .map((p) => p as Record<string, unknown>)
          .filter((p) => p && typeof p.oQue === "string" && p.oQue.trim())
          .map((p) => ({
            oQue: String(p.oQue).trim().slice(0, 200),
            quando: typeof p.quando === "string" && p.quando.trim() ? p.quando.trim().slice(0, 60) : null,
            // `cumprida` ausente vira FALSE, e o padrão é deliberado: o erro de
            // dizer "está pendente" sobre algo já resolvido custa um olhar; o
            // erro contrário esconde do corretor a promessa que fez o cliente
            // sumir.
            cumprida: p.cumprida === true,
          }))
          // Teto para uma conversa longa não virar uma lista que ninguém lê no
          // cartão. As primeiras são as mais antigas — as que esperam há mais
          // tempo.
          .slice(0, 8)
      : [];

    const atencao =
      typeof j.atencao === "string" && j.atencao.trim() ? j.atencao.trim().slice(0, 300) : null;

    return { perfil: perfil.slice(0, 300), promessas, atencao };
  } catch {
    return null;
  }
}

export type ResultadoAnalise =
  | { estado: "analisado"; analise: AnaliseDoLead }
  | { estado: "pulado"; porque: string };

/**
 * Lê UMA conversa e devolve a análise, sem gravar.
 *
 * As guardas vêm antes de qualquer gasto, e nesta ordem de propósito: as duas
 * baratas (mensagens de menos, já analisada) antes da consulta de custo, e a
 * cota antes da chamada.
 */
export async function analisarConversa(
  conversaId: number,
  jaLidaAte?: string | null
): Promise<ResultadoAnalise> {
  const conversa = await prisma.conversa.findUnique({
    where: { id: conversaId },
    select: {
      imobiliariaId: true,
      atualizadaEm: true,
      mensagens: {
        orderBy: { criadaEm: "asc" },
        select: { autor: true, texto: true },
        // As 60 últimas, mesma régua de lib/crm-conversas.ts: a conversa mais
        // longa em produção tem 691 mensagens, e mandar tudo é caro sem ser
        // melhor.
        take: 60,
      },
    },
  });
  if (!conversa) return { estado: "pulado", porque: "conversa não existe" };
  if (conversa.mensagens.length < MINIMO_MENSAGENS)
    return { estado: "pulado", porque: "conversa curta demais para ter o que ler" };

  // Conversa que não mudou desde a última leitura não paga leitura de novo.
  // Sem isto, o cron relê a carteira inteira todo dia e a fatura de IA cresce
  // sem nada mudar na tela.
  if (jaLidaAte && new Date(jaLidaAte).getTime() >= conversa.atualizadaEm.getTime())
    return { estado: "pulado", porque: "nada novo desde a última análise" };

  // A cota é a última guarda antes do gasto, e ela existe aqui porque
  // lib/crm-conversas.ts esqueceu dela: um tenant com cota estourada continuava
  // gastando por lá. Não repetir o esquecimento é metade da razão deste bloco.
  if (!(await podeConsumirIA(conversa.imobiliariaId)))
    return { estado: "pulado", porque: "cota de IA do mês esgotada" };

  // A leitura da conversa é gasto do tenant dono dela: mesma regra da cota
  // logo acima — a chave sai de `credenciaisAnthropic`, nunca da env direto.
  const { credenciaisAnthropic } = await import("@/lib/credenciais-ia");
  const { apiKey } = await credenciaisAnthropic(conversa.imobiliariaId);
  if (!apiKey) return { estado: "pulado", porque: "sem chave da Anthropic para esta imobiliária" };

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const { MODELO } = await import("@/lib/agentes");
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: MODELO,
    max_tokens: 700,
    system: INSTRUCAO,
    messages: [
      {
        role: "user",
        content: conversa.mensagens
          .map((m) => `${m.autor}: ${m.texto}`)
          .join("\n")
          .slice(0, 24_000),
      },
    ],
  });

  // O consumo entra no CMV do cliente. Gasto de IA que não aparece no relatório
  // vira surpresa na fatura.
  await registrarUso(conversa.imobiliariaId, "VENDAS", MODELO, {
    inputTokens: resp.usage.input_tokens,
    outputTokens: resp.usage.output_tokens,
  });

  const texto = resp.content
    .flatMap((b) => (b.type === "text" ? [b.text] : []))
    .join("")
    .trim();

  const analise = lerAnalise(texto);
  return analise
    ? { estado: "analisado", analise }
    : { estado: "pulado", porque: "leitura inválida" };
}

/** O que está guardado hoje, por conversa. */
export async function analisesGuardadas(
  imobiliariaId: number
): Promise<Map<number, AnaliseGuardada>> {
  const job = await prisma.execucaoJob.findFirst({
    where: { imobiliariaId, tipo: TIPO_JOB, ok: true },
    orderBy: { iniciadoEm: "desc" },
    select: { resultado: true },
  });
  const mapa = new Map<number, AnaliseGuardada>();
  if (!job?.resultado) return mapa;
  try {
    const lista = JSON.parse(job.resultado) as unknown;
    if (!Array.isArray(lista)) return mapa;
    for (const item of lista as AnaliseGuardada[])
      if (item && typeof item.conversaId === "number") mapa.set(item.conversaId, item);
  } catch {
    // Resultado corrompido não pode derrubar a tela: sem análise é pior que
    // com, mas é MUITO melhor que erro.
  }
  return mapa;
}

/**
 * Passa pelas conversas ativas do tenant, analisa o que mudou e guarda tudo.
 *
 * `orcamentoMs` existe pelo mesmo motivo da varredura de parceiras: esta
 * rotina roda pendurada no cron diário, e uma imobiliária com 300 conversas não
 * pode atrasar a régua de cobrança de todas as outras.
 */
export async function analisarLeadsDoTenant(
  imobiliariaId: number,
  { limite = 40, orcamentoMs = 90_000 }: { limite?: number; orcamentoMs?: number } = {}
): Promise<{ analisadas: number; puladas: number }> {
  const comecou = Date.now();
  const anteriores = await analisesGuardadas(imobiliariaId);

  const conversas = await prisma.conversa.findMany({
    where: { imobiliariaId, simulacao: false },
    orderBy: { atualizadaEm: "desc" },
    select: { id: true },
    take: limite,
  });

  const guardar = new Map(anteriores);
  let analisadas = 0;
  let puladas = 0;

  for (const c of conversas) {
    if (Date.now() - comecou > orcamentoMs) break;
    const antes = anteriores.get(c.id);
    const r = await analisarConversa(c.id, antes?.lidaAte ?? null);
    if (r.estado === "pulado") {
      puladas++;
      continue;
    }
    const atual = await prisma.conversa.findUnique({
      where: { id: c.id },
      select: { atualizadaEm: true },
    });
    guardar.set(c.id, {
      ...r.analise,
      conversaId: c.id,
      lidaAte: (atual?.atualizadaEm ?? new Date()).toISOString(),
    });
    analisadas++;
  }

  // Uma linha por rodada, com TUDO — as novas e as que continuam valendo. A
  // poda (`podarExecucoesAntigas`) guarda a linha mais nova de cada
  // (imobiliariaId, tipo, ok), então o que não estiver aqui desaparece na
  // próxima limpeza.
  await prisma.execucaoJob.create({
    data: {
      tipo: TIPO_JOB,
      imobiliariaId,
      ok: true,
      resultado: JSON.stringify([...guardar.values()]),
      terminadoEm: new Date(),
    },
  });

  return { analisadas, puladas };
}

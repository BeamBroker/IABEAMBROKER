// O rodízio de leads entre corretores.
//
// ─── MENOR DÉFICIT, E POR QUE NÃO SORTEIO ───────────────────────────────────
//
// Para cada corretor elegível calcula-se quanto ele já recebeu contra quanto
// deveria ter recebido; o lead vai para quem está mais atrás. Empate desempata
// por quem está há mais tempo sem receber.
//
// Sorteio ponderado seria uma linha e está errado no volume que uma imobiliária
// tem. Com dezenas de leads por dia, e não milhares, a variância do sorteio
// produz 7/2/1 onde se configurou 50/30/20 — sem bug nenhum, só azar. O
// corretor de 30% abre a tela, vê que recebeu 20%, reclama, e ninguém consegue
// provar que o sistema está certo. Menor déficit converge sempre e é explicável
// linha a linha, que é a qualidade que importa quando a conversa é sobre
// divisão de comissão.
//
// A parte que decide é PURA: sem Prisma, sem relógio próprio, testável sem
// banco. É o que permite provar 50/30/20 exatos em 100 rodadas num teste que
// roda em milissegundos — e é o que alguém vai querer refazer na mão numa
// reunião.

import { prisma } from "@/lib/db";

export type Elegivel = {
  corretorId: number;
  percentual: number;
  recebidos: number;
  ultimoEm: Date | null;
  /** Este corretor já está com lead na mão AGORA (status EM_ATENDIMENTO).
   *  Não o tira do rodízio: só o manda para o fim da fila. Ver `escolherCorretor`. */
  emAtendimento?: boolean;
};

export function escolherCorretor(elegiveis: Elegivel[]): number | null {
  // PESO ZERO EM TODO MUNDO = "ninguém configurou", NÃO "ninguém recebe".
  //
  // A cota nasce com `percentual: 0` (ver o `create` lá embaixo), e até
  // 18/08/2026 isso significava que a casa que nunca abriu a tela de cotas
  // simplesmente não distribuía lead nenhum — para sempre, sem erro em lugar
  // nenhum. Medido na Mellim Imóveis (tenant 5): 3 cotas em 0%, 97 dos 192
  // leads sem dono. O rodízio "desligado" nunca foi uma escolha de ninguém.
  //
  // Quando ALGUÉM tem peso, nada muda: quem está em 0 continua de fora, que é o
  // jeito de tirar uma pessoa do rodízio sem apagar a cota dela.
  const comPeso = elegiveis.filter((e) => e.percentual > 0);
  const ativos = comPeso.length > 0 ? comPeso : elegiveis.map((e) => ({ ...e, percentual: 1 }));
  if (ativos.length === 0) return null;

  // QUEM ESTÁ ATENDENDO VAI PARA O FIM DA FILA, e não para fora dela.
  //
  // O pedido do dono: "cai igual para todos, a não ser que um esteja em
  // atendimento — aí joga para outro". Filtrar de vez teria um efeito que
  // ninguém pediu: dia movimentado, todo mundo atendendo, e o lead novo não
  // cairia para pessoa alguma. Então só ignora os ocupados ENQUANTO houver
  // alguém livre; se todos estiverem, o rodízio normal decide.
  const livres = ativos.filter((e) => !e.emAtendimento);
  const fila = livres.length > 0 ? livres : ativos;

  const totalPercentual = fila.reduce((s, e) => s + e.percentual, 0);
  const totalRecebidos = fila.reduce((s, e) => s + e.recebidos, 0);
  // +1 porque estamos decidindo o PRÓXIMO lead. Sem ele, na primeira
  // distribuição todo mundo tem déficit zero e o critério vira arbitrário.
  const base = totalRecebidos + 1;

  let melhor: Elegivel | null = null;
  let melhorDeficit = -Infinity;

  for (const e of fila) {
    const meta = (base * e.percentual) / totalPercentual;
    const deficit = meta - e.recebidos;
    if (
      deficit > melhorDeficit ||
      // Empate: quem está sem receber há mais tempo. Mantém o rodízio girando
      // em vez de martelar o primeiro da lista — que é o que aconteceria na
      // primeira distribuição do mês, com todos zerados.
      (deficit === melhorDeficit &&
        melhor !== null &&
        (e.ultimoEm?.getTime() ?? 0) < (melhor.ultimoEm?.getTime() ?? 0))
    ) {
      melhor = e;
      melhorDeficit = deficit;
    }
  }
  return melhor?.corretorId ?? null;
}

// Atribui o lead e devolve o corretor escolhido (null = ninguém elegível).
// Idempotente: lead que já tem dono não é redistribuído.
export async function distribuirLead(leadId: number): Promise<number | null> {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { id: true, imobiliariaId: true, corretorId: true, finalidade: true, nome: true },
  });
  if (lead.corretorId) return lead.corretorId;

  const cotas = await prisma.cotaDistribuicao.findMany({
    where: {
      imobiliariaId: lead.imobiliariaId,
      ativo: true,
      // Vazio = atende tudo; senão precisa incluir a finalidade deste lead.
      OR: [{ finalidades: { isEmpty: true } }, { finalidades: { has: lead.finalidade } }],
    },
  });

  // Quem está com lead na mão agora. Uma consulta só, agrupada: com 5 corretores
  // e 200 leads isso é um índice, não uma varredura — e sai do caminho antes de
  // qualquer escrita.
  //
  // `EM_ATENDIMENTO` é o corretor que ASSUMIU o lead (schema.prisma:1136).
  // `ATENDIMENTO` NÃO entra: esse é a IA qualificando, e a IA atende os leads
  // todos ao mesmo tempo — contá-lo deixaria a casa inteira "ocupada".
  const ocupados = new Set(
    (
      await prisma.lead.groupBy({
        by: ["corretorId"],
        where: {
          imobiliariaId: lead.imobiliariaId,
          status: "EM_ATENDIMENTO",
          corretorId: { in: cotas.map((c) => c.corretorId) },
        },
      })
    ).map((g) => g.corretorId)
  );

  const corretorId = escolherCorretor(
    cotas.map((c) => ({
      corretorId: c.corretorId,
      percentual: c.percentual,
      recebidos: c.recebidos,
      ultimoEm: c.ultimoEm,
      emAtendimento: ocupados.has(c.corretorId),
    }))
  );
  if (!corretorId) return null;

  // Transação: contador e atribuição andam juntos. Separados, duas chegadas
  // simultâneas leriam o mesmo `recebidos` e cairiam no mesmo corretor.
  const agora = new Date();
  await prisma.$transaction([
    prisma.lead.update({
      where: { id: leadId },
      data: { corretorId, atribuidoEm: agora, atribuicaoOrigem: "RODIZIO" },
    }),
    prisma.cotaDistribuicao.update({
      where: { corretorId },
      data: { recebidos: { increment: 1 }, ultimoEm: agora },
    }),
  ]);

  const { auditar } = await import("@/lib/auditoria");
  await auditar(
    "LEAD_DISTRIBUIDO",
    "Lead",
    leadId,
    `${lead.nome} → corretor ${corretorId} (rodízio)`,
    lead.imobiliariaId
  );
  return corretorId;
}

// Troca manual de dono. Ajusta os contadores dos dois lados: sem devolver o
// crédito de quem perdeu, ele passaria a receber a menos para sempre.
//
// Duas defesas que parecem detalhe e não são:
//
//   PISO EM ZERO no lado que perde. `recebidos` negativo infla o déficit da
//   pessoa e o rodízio passa a martelar só ela até o número voltar. O caso não
//   é hipotético: basta um lead atribuído à mão a quem tem contador zerado.
//
//   UPSERT no lado que ganha. Um `updateMany` sem linha de cota acerta zero
//   linhas e passa calado — o realizado dele nunca sobe e ele recebe para
//   sempre. A cota nova nasce com percentual 0: receber um lead à mão não pode
//   enfiar alguém no rodízio sem uma decisão em Configurações.
export async function reatribuirLead(leadId: number, novoCorretorId: number) {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { corretorId: true, imobiliariaId: true, nome: true },
  });
  if (lead.corretorId === novoCorretorId) return;

  const agora = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.lead.update({
      where: { id: leadId },
      data: { corretorId: novoCorretorId, atribuidoEm: agora, atribuicaoOrigem: "MANUAL" },
    });
    await tx.cotaDistribuicao.upsert({
      where: { corretorId: novoCorretorId },
      create: {
        imobiliariaId: lead.imobiliariaId,
        corretorId: novoCorretorId,
        percentual: 0,
        recebidos: 1,
        ultimoEm: agora,
      },
      update: { recebidos: { increment: 1 }, ultimoEm: agora },
    });
    if (lead.corretorId) {
      const anterior = await tx.cotaDistribuicao.findUnique({
        where: { corretorId: lead.corretorId },
        select: { recebidos: true },
      });
      if (anterior)
        await tx.cotaDistribuicao.update({
          where: { corretorId: lead.corretorId },
          data: { recebidos: Math.max(0, anterior.recebidos - 1) },
        });
    }
  });

  // Passagem NOVA, com dono novo. `registrarPassagem` fecha a linha do vendedor
  // anterior (`encerradoEm`) em vez de apagá-la: a prova de que ele não
  // respondeu costuma ser o motivo da troca, e é dela que o painel do gestor
  // precisa. Ver lib/passagem.ts.
  const { registrarPassagem } = await import("@/lib/passagem");
  await registrarPassagem({
    leadId,
    imobiliariaId: lead.imobiliariaId,
    gatilho: "MANUAL",
    corretorId: novoCorretorId,
    agora,
  });

  const { auditar } = await import("@/lib/auditoria");
  await auditar(
    "LEAD_REATRIBUIDO",
    "Lead",
    leadId,
    `${lead.nome} → corretor ${novoCorretorId} (manual)`,
    lead.imobiliariaId
  );
}

// Zera o realizado de todos. Serve para começar mês novo: sem isso, quem entrou
// depois passa meses recebendo a mais para pagar um atraso que já não existe.
export async function zerarContadores(imobiliariaId: number): Promise<number> {
  const { count } = await prisma.cotaDistribuicao.updateMany({
    where: { imobiliariaId },
    data: { recebidos: 0, ultimoEm: null },
  });
  return count;
}

// ─── O GATILHO ──────────────────────────────────────────────────────────────
//
// "Depois da qualificação" (dono, 10/08). É o momento em que a IA termina o
// trabalho dela — ela não marca mais visita, então a entrega ao corretor é
// exatamente aqui.
//
// Best-effort de propósito: distribuição que falha — ninguém elegível, banco
// lento — NÃO pode derrubar a qualificação que acabou de ser gravada. Lead sem
// dono a tela já sabe mostrar; resposta perdida ao cliente, não.
export async function distribuirAposQualificacao(leadId: number, imobiliariaId: number) {
  return distribuirEAvisar(leadId, imobiliariaId);
}

// A ENTREGA, com o nome do que ela FAZ: escolhe o dono no rodízio e chama o
// corretor de plantão.
//
// `distribuirAposQualificacao` continua existindo (é o gatilho da ficha fechada,
// e é assim que o resto do sistema a chama), mas desde 26/08 ela não é mais o
// único momento de entregar: o PEDIDO DE VISITA entrega também, e chega antes.
// Medido naquele dia: 105 fichas abertas, ZERO completas, zero avisos ao
// corretor em 321 leads — amarrar a entrega só ao fim da escada era amarrá-la a
// um evento que nunca acontece.
//
// O NOME NÃO É `entregarAoCorretor` DE PROPÓSITO. Existe uma função com esse
// nome em lib/followup.ts, e ela significa quase o CONTRÁRIO: lá é o lead que
// não respondeu cinco toques, sai da esteira da IA e volta para o painel como
// EM_ATENDIMENTO, sem avisar ninguém. Aqui é o lead QUENTE, que pediu visita.
// Duas funções com o mesmo nome e sentidos opostos é o tipo de coisa que a
// próxima pessoa confunde às duas da manhã.
//
// (26/08, integração: a de lib/followup.ts foi renomeada para
// `encerrarCadencia` no mesmo lote, pelo mesmo motivo, vindo do outro lado. Os
// dois nomes ficam — o homônimo deixou de existir por completo.)
export async function distribuirEAvisar(
  leadId: number,
  imobiliariaId: number,
  // De onde veio a entrega. Só muda o rótulo do relógio do SLA — a entrega é a
  // mesma. Default no caminho histórico para não obrigar os chamadores antigos
  // a saber de um campo de métrica.
  gatilho: "QUALIFICACAO" | "PEDIDO_VISITA" = "QUALIFICACAO"
) {
  let corretorId: number | null = null;
  try {
    const imob = await prisma.imobiliaria.findUnique({
      where: { id: imobiliariaId },
      select: { distribuicaoEm: true },
    });
    if ((imob?.distribuicaoEm ?? "QUALIFICACAO") === "QUALIFICACAO")
      corretorId = await distribuirLead(leadId);
  } catch (e) {
    console.error("[distribuicao] falhou depois da qualificação:", e);
  }

  // ─── O AVISO AO CORRETOR DE PLANTÃO ───────────────────────────────────────
  //
  // Mesmo instante da entrega, e é por isso que ele mora AQUI e não no lado de
  // lib/agentes.ts: quem chamar a entrega por outro caminho amanhã leva o aviso
  // junto, sem precisar lembrar dele. Colado no `distribuirLead` é onde a regra
  // "o corretor fica sabendo quando o lead vira dele" fica dita uma vez só.
  //
  // FORA do try acima, e independente do resultado da distribuição. Rodízio
  // desligado (soma 0%) devolve `null` sem erro nenhum — e é justamente a casa
  // sem rodízio que MAIS precisa do aviso, porque nela ninguém vira dono e o
  // lead não aparece na carteira de pessoa alguma. Amarrar o aviso ao sucesso
  // do rodízio o desligaria exatamente para quem depende dele.
  //
  // `avisarCorretorDoLead` já promete não jogar; o `.catch` é a segunda tranca,
  // porque a promessa é de um arquivo e a consequência de quebrá-la é a resposta
  // que o cliente está esperando no WhatsApp.
  try {
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    await avisarCorretorDoLead(leadId);
  } catch (e) {
    console.error("[distribuicao] aviso ao corretor falhou:", e);
  }

  // ─── O RELÓGIO DO SLA COMEÇA AQUI ─────────────────────────────────────────
  //
  // Este é o instante que o cliente descreveu em 26/08: "a hora que terminou a
  // triagem, passou para o Gabriel assumir, salva o horário".
  //
  // FORA do try do rodízio, pelo MESMO motivo do aviso logo acima, e o motivo é
  // o defeito que isto conserta: até 26/08 o carimbo morava dentro de
  // `distribuirLead`, então a casa com rodízio desligado entregava o lead,
  // avisava o corretor, e o relógio nunca começava. `Lead.atribuidoEm` era
  // escrito em 2 de ~5 caminhos e lido por nenhum.
  //
  // Sem `corretorId` explícito: o rodízio devolver `null` NÃO quer dizer que o
  // lead está sem dono — ele pode já ter um, e `distribuirLead` nem roda quando
  // a casa distribui noutro momento. Quem resolve o dono é `registrarPassagem`,
  // lendo o lead. Ver lib/passagem.ts.
  const { registrarPassagem } = await import("@/lib/passagem");
  await registrarPassagem({ leadId, imobiliariaId, gatilho });

  // ─── A FRONTEIRA DA IA (reunião de 26/08) ─────────────────────────────────
  //
  // Júlia formulou e Samuel confirmou com "exato": enquanto o cliente não
  // responde, a IA faz o follow-up; depois que ela qualifica e PASSA para o
  // vendedor, a IA NÃO fala mais com o cliente — só lembra o corretor.
  //
  // Mora AQUI pelo mesmo motivo que o aviso mora aqui: esta é a função por onde
  // passam os dois caminhos de entrega (ficha fechada e pedido de visita), e
  // quem escrever o terceiro amanhã leva a fronteira junto sem precisar lembrar
  // dela. Enfiada dentro de cada ferramenta de lib/agentes.ts, ela seria uma
  // regra dita duas vezes e cumprida uma.
  //
  // FORA do try do rodízio, e depois do aviso: o corretor precisa ser avisado
  // ANTES de a IA calar, senão existe um instante — curto, mas existe — em que
  // ninguém está atendendo aquela pessoa.
  //
  // `.catch` como segunda tranca, igual ao aviso: a função já promete não jogar,
  // mas a promessa é de outro arquivo e a consequência de quebrá-la é a resposta
  // que o cliente está esperando no WhatsApp.
  try {
    const { pausarIaNaEntregaAoCorretor } = await import("@/lib/fronteira-ia");
    await pausarIaNaEntregaAoCorretor(leadId, imobiliariaId);
  } catch (e) {
    console.error("[distribuicao] pausar a IA na entrega falhou:", e);
  }

  return corretorId;
}

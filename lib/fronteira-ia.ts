// A FRONTEIRA: onde a IA para de falar com o cliente.
//
// ─── A DECISÃO ──────────────────────────────────────────────────────────────
//
// Reunião de 26/08. Júlia formulou e Samuel confirmou com "exato":
//
//   enquanto o cliente não responde, a IA faz o follow-up dela;
//   depois que ela qualifica e PASSA para o vendedor,
//   a IA não fala mais com o cliente — só lembra o corretor.
//
// Até aqui a segunda metade não existia. `entregarAoCorretor` distribuía o lead,
// avisava o plantão e nunca tocava em `iaPausada`; o prompt de
// `passar_para_corretor` ainda mandava "depois disso siga a conversa
// normalmente, tirando dúvidas e completando o que faltar". Ou seja: o handoff
// acontecia e a Maitê continuava atendendo por cima do corretor.
//
// ─── POR QUE UM ARQUIVO, E NÃO DUAS LINHAS DENTRO DE distribuicao.ts ────────
//
// Porque achar a conversa daquele lead não é uma linha. `entregarAoCorretor`
// recebe `leadId` e `imobiliariaId`; a conversa se liga ao lead por
// `Conversa.leadId`, que é a ligação forte, e cai no telefone quando ela não
// existe — conversa aberta antes da FK, ou pelo número da casa antes de o lead
// existir. É a mesma ordem de preferência de aviso-lead.ts:362-366, e casar
// SÓ por telefone é o que fazia abrir a conversa errada.
//
// E porque a mesma resolução é usada em dois lugares opostos: aqui para pausar,
// e em lib/atendimento-humano.ts para o resgate automático NÃO despausar. Duas
// cópias dessa consulta é como uma das pontas passa a discordar da outra sem
// ninguém perceber.
//
// ─── NUNCA JOGA ─────────────────────────────────────────────────────────────
//
// Roda no mesmo instante da entrega, que roda dentro da ferramenta da IA, que
// roda no caminho de uma resposta que o cliente está esperando no WhatsApp.
// Mesma promessa de aviso-lead.ts: pausa perdida é a IA falando uma vez a mais;
// exceção subindo é o cliente falando sozinho.

import { prisma } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { log } from "@/lib/log";
import { sufixoTelefone } from "@/lib/match";

/**
 * As conversas deste lead, na ordem de confiança: pela FK primeiro, pelo
 * telefone depois. Devolve ids, não linhas — quem chama só precisa saber em
 * quais escrever.
 */
export async function conversasDoLead(
  leadId: number,
  imobiliariaId: number,
  telefone: string | null
): Promise<number[]> {
  const porFk = await prisma.conversa.findMany({
    where: { leadId, simulacao: false },
    select: { id: true },
  });
  if (porFk.length) return porFk.map((c) => c.id);

  const sufixo = sufixoTelefone(telefone);
  if (!sufixo) return [];
  // Casamento pelos 8 dígitos finais, calculado em JS: a coluna `contatoChave`
  // que o schema promete "mantida por gatilho" está NULL em 100% das linhas de
  // produção — não existe gatilho no banco (medido em 12/08, registrado em
  // follow-detectado.ts:66-69). Usar a coluna seria não casar nada, calado.
  const candidatas = await prisma.conversa.findMany({
    where: { imobiliariaId, simulacao: false, contatoTelefone: { not: null } },
    select: { id: true, contatoTelefone: true },
  });
  return candidatas.filter((c) => sufixoTelefone(c.contatoTelefone) === sufixo).map((c) => c.id);
}

/**
 * O handoff cala a IA nesta conversa.
 *
 * Chamada de `lib/distribuicao.ts:entregarAoCorretor`, que é o ponto único por
 * onde passam os dois caminhos de entrega (ficha de qualificação fechada e
 * pedido de visita). Colocar aqui, e não dentro de cada ferramenta da IA, é o
 * que faz quem escrever o terceiro caminho amanhã levar a fronteira junto sem
 * precisar lembrar dela.
 *
 * O QUE ISTO NÃO FAZ: não manda mensagem, não muda status e não encerra a
 * conversa. `iaPausada` é exatamente o mesmo estado que a equipe assumindo pelo
 * painel já produz (atendimento-humano.ts:44-57), então o painel continua
 * abrindo a conversa, o corretor continua podendo responder por ele, e reativar
 * é um clique. A diferença é só quem tomou a decisão.
 *
 * Devolve quantas conversas foram caladas — 0 é normal para lead que nunca teve
 * conversa (cadastro manual, importação).
 *
 * ─── UM EFEITO QUE PRECISA DE DECISÃO HUMANA, NÃO DE CÓDIGO ────────────────
 *
 * São DOIS os caminhos que passam por `entregarAoCorretor`, e o segundo tem uma
 * consequência que o primeiro não tem:
 *
 *   · PEDIDO DE VISITA (agentes.ts:4174) — a ferramenta já devolve ao modelo
 *     "esta é a sua última mensagem, encerre". Coerente: fala, se despede, cala.
 *
 *   · FICHA DE QUALIFICAÇÃO FECHADA (agentes.ts:3379, via
 *     `distribuirAposQualificacao`) — aqui a mesma chamada devolve, pela outra
 *     ponta, `situacaoDaQualificacao` com "AGORA APRESENTE" e a lista de imóveis
 *     que cabem. Ou seja: no MESMO turno a IA apresenta as opções e fica muda a
 *     partir da próxima mensagem do cliente. Se ela terminar perguntando "qual
 *     desses te interessa?", a resposta do cliente cai no vácuo da IA — e vai
 *     para o corretor, que é o que a reunião pediu, mas sem ninguém ter avisado
 *     o cliente disso.
 *
 * NÃO foi resolvido aqui de propósito. As duas saídas mexem em prompt
 * (`situacaoDaQualificacao`, agentes.ts:3130-3160), que é território de outra
 * decisão: ou o "AGORA APRESENTE" passa a se despedir como o da visita, ou a
 * pausa da ficha fechada espera o cliente responder uma vez. Escolher isso no
 * código seria decidir por baixo o que a reunião não decidiu.
 *
 * Mitigação enquanto isso: medido em 26/08, são 105 fichas abertas e ZERO
 * completas em produção — este caminho praticamente não dispara hoje.
 */
export async function pausarIaNaEntregaAoCorretor(
  leadId: number,
  imobiliariaId: number
): Promise<number> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, nome: true, telefone: true, imobiliariaId: true },
    });
    if (!lead || lead.imobiliariaId !== imobiliariaId) return 0;

    const ids = await conversasDoLead(lead.id, imobiliariaId, lead.telefone);
    if (ids.length === 0) return 0;

    // `iaPausada: false` no WHERE: sem ele, cada rechamada da ferramenta da IA
    // — e ela é rechamada a cada resposta do cliente que ainda fala de visita —
    // reescreveria a linha e geraria uma auditoria nova dizendo que o handoff
    // aconteceu de novo.
    const { count } = await prisma.conversa.updateMany({
      where: { id: { in: ids }, iaPausada: false },
      data: { iaPausada: true },
    });
    if (count === 0) return 0;

    await auditar(
      "IA_PAUSADA_NA_ENTREGA",
      "Lead",
      lead.id,
      `${lead.nome}: o lead passou para o corretor — a IA para de falar com o cliente (decisão da reunião de 26/08)`,
      imobiliariaId
    ).catch(() => {});
    return count;
  } catch (e) {
    // A promessa do cabeçalho, cumprida em um lugar só.
    log.warn("fronteira-ia: não consegui pausar na entrega", {
      leadId,
      erro: e instanceof Error ? e.message : String(e),
    });
    return 0;
  }
}

/**
 * Esta conversa está calada PORQUE o lead foi passado a um corretor?
 *
 * Existe para o resgate automático (`reativarConversasEsquecidas`) não desfazer
 * a fronteira 24h depois. Ver o comentário lá — a decisão está escrita naquele
 * ponto, aqui está só a consulta.
 *
 * Devolve o conjunto das conversas, entre as recebidas, que pertencem a um lead
 * entregue e ainda aberto. Uma consulta para todas, não uma por conversa: o
 * resgate roda no cron diário sobre a lista inteira de pausadas.
 */
export async function conversasDeLeadEntregue(
  conversas: { id: number; leadId: number | null; imobiliariaId: number; contatoTelefone: string | null }[]
): Promise<Set<number>> {
  const entregues = new Set<number>();
  if (conversas.length === 0) return entregues;

  const tenants = [...new Set(conversas.map((c) => c.imobiliariaId))];
  const leads = await prisma.lead.findMany({
    where: {
      imobiliariaId: { in: tenants },
      atribuidoEm: { not: null },
      status: { notIn: ["FECHADO", "PERDIDO"] },
    },
    select: { id: true, imobiliariaId: true, telefone: true },
  });
  if (leads.length === 0) return entregues;

  const idsEntregues = new Set(leads.map((l) => l.id));
  const sufixosPorTenant = new Map<number, Set<string>>();
  for (const l of leads) {
    const s = sufixoTelefone(l.telefone);
    if (!s) continue;
    const atual = sufixosPorTenant.get(l.imobiliariaId) ?? new Set<string>();
    atual.add(s);
    sufixosPorTenant.set(l.imobiliariaId, atual);
  }

  for (const c of conversas) {
    if (c.leadId && idsEntregues.has(c.leadId)) {
      entregues.add(c.id);
      continue;
    }
    const s = sufixoTelefone(c.contatoTelefone);
    if (s && sufixosPorTenant.get(c.imobiliariaId)?.has(s)) entregues.add(c.id);
  }
  return entregues;
}

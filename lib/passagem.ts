// A PASSAGEM do lead ao vendedor — o ponto único onde o relógio começa.
//
// ─── O DEFEITO QUE ESTE ARQUIVO EXISTE PARA CORRIGIR ────────────────────────
//
// O carimbo da passagem morava DENTRO de `distribuirLead` (lib/distribuicao.ts
// :142). Só que a função que faz a passagem descrita pelo cliente em 26/08 —
// "a hora que terminou a triagem, passou para o Gabriel assumir, salva o
// horário" — é `entregarAoCorretor`, e ela entrega o lead e manda o aviso ao
// corretor MESMO QUANDO o rodízio não devolve ninguém. O próprio comentário de
// lá já admitia o cenário: "rodízio desligado (soma 0%) devolve null sem erro
// nenhum — e é justamente a casa sem rodízio que MAIS precisa do aviso".
//
// Resultado medido em 26/08: `atribuidoEm` escrito em 2 de ~5 caminhos de
// entrega, e lido por ZERO linhas do sistema. Nas casas sem rodízio, o lead era
// entregue, o corretor era avisado, e o relógio nunca começava.
//
// A regra que este módulo impõe: **quem entrega, carimba** — em todos os
// caminhos, com ou sem rodízio, e num lugar só. Os cinco caminhos de entrega
// chamam esta função e mais nenhuma:
//
//   lib/distribuicao.ts :: entregarAoCorretor   (ficha fechada / pedido de visita)
//   lib/distribuicao.ts :: reatribuirLead       (troca manual de dono)
//   lib/followup.ts     :: encerrarCadencia     (fim da cadência da IA)
//   lib/entrega-ia.ts   :: entregarNegocio      (card do CRM na fase de entrega)
//   qualquer caminho novo                        ← é para isso que o módulo existe
//
// ─── BEST-EFFORT POR CONSTRUÇÃO ─────────────────────────────────────────────
//
// Esta função NÃO lança, nunca. Ela roda no caminho da resposta ao cliente, e o
// desenho é o mesmo de `distribuicao.ts:281-286`: relógio perdido é uma métrica
// a menos; exceção subindo daqui é o cliente falando sozinho no WhatsApp. O
// `try` mora aqui dentro, e não em cada chamador, porque a próxima pessoa a
// acrescentar um sexto caminho de entrega não vai lembrar de embrulhar.
//
// ─── PRÉ-REQUISITO DE BUILD ─────────────────────────────────────────────────
//
// `prisma.slaLead` só existe depois de `prisma generate` sobre a migration
// 20260827090000_sla_do_vendedor. Enquanto ela não for aplicada, o `tsc`
// reprova este arquivo — de propósito: é melhor o portão do deploy acusar a
// migration que falta do que o painel nascer vazio sem ninguém entender por quê.

import { prisma } from "@/lib/db";
import { sufixoTelefone } from "@/lib/match";

/**
 * De onde veio a passagem. String e não enum do banco: gatilho novo não pode
 * exigir migration para ser medido, e a lista aqui é a documentação viva do que
 * o sistema sabe entregar hoje.
 */
export type GatilhoPassagem =
  | "QUALIFICACAO"
  | "PEDIDO_VISITA"
  | "FIM_CADENCIA_IA"
  | "CRM"
  | "MANUAL";

/**
 * O vocabulário de `Lead.atribuicaoOrigem` é ANTERIOR a este módulo e tem só
 * três valores documentados no schema (RODIZIO, MANUAL, HERDADO). Enfiar
 * "PEDIDO_VISITA" ali criaria um segundo vocabulário na mesma coluna, e a tela
 * que responde "por que esse lead caiu pra mim?" passaria a ter dois idiomas.
 * O gatilho fino fica no `SlaLead`, que é onde ele é lido.
 */
function origemDaAtribuicao(gatilho: GatilhoPassagem): string {
  return gatilho === "MANUAL" ? "MANUAL" : "RODIZIO";
}

export type Passagem = {
  leadId: number;
  imobiliariaId: number;
  gatilho: GatilhoPassagem;
  /**
   * Quem recebeu.
   *
   *  · ausente (`undefined`) = "lê do lead". É o que quase todo chamador quer:
   *    o rodízio pode ter devolvido `null` sem que o lead esteja sem dono — ele
   *    já podia ter um de antes, e `distribuirLead` nem roda quando a casa
   *    distribui noutro momento (`distribuicaoEm !== "QUALIFICACAO"`). Passar o
   *    retorno do rodízio cru aqui fecharia o relógio do dono atual e abriria um
   *    "sem dono" por cima — o oposto do que aconteceu.
   *  · `null` explícito = entregue SEM DONO, de verdade.
   *  · número = este.
   */
  corretorId?: number | null;
  agora?: Date;
};

/**
 * Abre o relógio do SLA para esta passagem.
 *
 * Devolve o id do `SlaLead` criado, ou `null` quando não criou nada — seja
 * porque já havia um relógio aberto para o mesmo lead e o mesmo vendedor
 * (idempotência), seja porque a escrita falhou (best-effort).
 *
 * ─── IDEMPOTÊNCIA, E POR QUE ELA É OBRIGATÓRIA ────────────────────────────
 *
 * `entregarAoCorretor` roda TODA VEZ que a ficha do lead está completa, e a
 * ferramenta que a dispara é rechamada a cada resposta nova do cliente — é a
 * mesma armadilha que `Lead.avisoCorretorEm` já existe para resolver
 * (lib/aviso-lead.ts:243-256). Sem trava, o relógio reiniciaria a cada mensagem
 * e o atraso do vendedor seria zerado por ele mesmo, sozinho, para sempre.
 *
 * A trava é uma releitura dentro da transação, não uma restrição do banco.
 * Duas chamadas GENUINAMENTE simultâneas para o mesmo lead ainda podem abrir
 * duas linhas; o efeito é um denominador inflado no painel, não um alarme
 * falso. Se isso aparecer em produção, o conserto é um índice parcial
 * (`CREATE UNIQUE INDEX ... ON "SlaLead"("leadId") WHERE "respondidoEm" IS NULL
 * AND "encerradoEm" IS NULL`) — que ficou de fora de propósito, porque o Prisma
 * não sabe expressá-lo e a próxima `migrate dev` o derrubaria calada.
 *
 * ─── MUDANÇA DE DONO ABRE LINHA NOVA, E FECHA A ANTERIOR ──────────────────
 *
 * Quando a passagem é para OUTRO vendedor, a linha anterior não é apagada nem
 * reaproveitada: ela ganha `encerradoEm` e fica no histórico como o que é —
 * "ficou 4 horas com ele e ele não respondeu". Duas coisas dependem disso: a
 * prova do atraso do vendedor anterior (que costuma ser o motivo da troca) e a
 * garantia de que a mensagem do vendedor NOVO não vai fechar o relógio do
 * ANTIGO em `lib/sla-fechamento.ts`.
 */
export async function registrarPassagem(p: Passagem): Promise<number | null> {
  const agora = p.agora ?? new Date();
  try {
    return await prisma.$transaction(async (tx) => {
      // Quem é o dono, de verdade, neste instante. Ver o comentário de
      // `corretorId` acima para o motivo de isto não ser o retorno do rodízio.
      const corretorId =
        p.corretorId !== undefined
          ? p.corretorId
          : ((
              await tx.lead.findUnique({
                where: { id: p.leadId },
                select: { corretorId: true },
              })
            )?.corretorId ?? null);

      // O relógio aberto mais recente deste lead. "Aberto" = ninguém respondeu
      // E ninguém tomou o lead da mão dele.
      const aberto = await tx.slaLead.findFirst({
        where: { leadId: p.leadId, respondidoEm: null, encerradoEm: null },
        orderBy: { passouEm: "desc" },
        select: { id: true, corretorId: true },
      });

      // Mesmo vendedor (inclusive "ninguém" dos dois lados): é a mesma
      // passagem sendo anunciada de novo. Não cria, não reinicia.
      if (aberto && aberto.corretorId === corretorId) return null;

      if (aberto)
        await tx.slaLead.update({ where: { id: aberto.id }, data: { encerradoEm: agora } });

      const criado = await tx.slaLead.create({
        data: {
          imobiliariaId: p.imobiliariaId,
          leadId: p.leadId,
          corretorId,
          gatilho: p.gatilho,
          passouEm: agora,
        },
        select: { id: true },
      });

      // `Lead.atribuidoEm` para de mentir.
      //
      // Ele continua sendo o RETRATO de agora (o histórico é o SlaLead), e só é
      // escrito quando há dono: `atribuidoEm` preenchido com `corretorId` nulo
      // afirmaria uma atribuição que não houve. `updateMany` com a condição no
      // WHERE, em vez de ler-e-escrever: `distribuirLead` pode ter acabado de
      // gravar, e sobrescrever ali moveria o carimbo para depois do que ele diz.
      if (corretorId != null)
        await tx.lead.updateMany({
          where: { id: p.leadId, atribuidoEm: null },
          data: { atribuidoEm: agora, atribuicaoOrigem: origemDaAtribuicao(p.gatilho) },
        });

      return criado.id;
    });
  } catch (e) {
    // NÃO relança. Ver o cabeçalho: este código roda no caminho da resposta ao
    // cliente. O log é o que permite descobrir depois que o relógio parou de
    // ser aberto — silêncio total aqui seria a repetição exata do defeito que
    // este arquivo conserta.
    console.error(`[passagem] relógio não aberto para o lead ${p.leadId}:`, e);
    return null;
  }
}

/**
 * A mesma passagem, quando quem entrega só conhece o TELEFONE do contato.
 *
 * ─── ISTO É UMA PONTE TEMPORÁRIA, E ELA TEM DATA PARA CAIR ────────────────
 *
 * `Negocio` não tem FK para `Lead` (dívida A3 do plano mestre: a própria tela
 * /metricas-marketing admite isso ao cliente por escrito). Sem ela, a entrega do
 * card do CRM não sabe qual lead está passando de mão, e o relógio do vendedor
 * ficaria sem começar exatamente no caminho em que o gestor mais olha.
 *
 * O casamento é pelos 8 dígitos finais (`lib/match.ts :: sufixoTelefone`), a
 * mesma régua que `lib/follow-detectado.ts` já usa — e pelo mesmo motivo: as
 * colunas `telefoneChave`/`contatoChave` que o schema promete "mantidas por
 * gatilho" estão NULL em 100% das linhas de produção, porque o gatilho não
 * existe. Usar a coluna seria não casar nada, calado.
 *
 * AMBIGUIDADE NÃO VIRA CHUTE: dois leads com o mesmo sufixo no mesmo tenant
 * devolvem `null` e um log. Abrir o relógio no lead errado é pior que não abrir
 * — o painel passaria a cobrar um vendedor pelo atraso de outro.
 *
 * Quando `Negocio.leadId` existir, esta função sai e o chamador passa a usar
 * `registrarPassagem` direto.
 */
export async function registrarPassagemPorTelefone(p: {
  imobiliariaId: number;
  telefone: string | null;
  gatilho: GatilhoPassagem;
  corretorId?: number | null;
  agora?: Date;
}): Promise<number | null> {
  const alvo = sufixoTelefone(p.telefone);
  if (!alvo) return null;
  try {
    // O filtro final é em JS porque `Lead.telefone` não é normalizado
    // ("17 99999-8888" e "5517999998888" convivem no mesmo tenant) e um
    // `endsWith` no SQL casaria só um dos formatos, calado. O custo é duas
    // colunas de todos os leads da casa — as medições de agosto dão 192, 279 e
    // 321 leads por tenant, e esta consulta roda uma vez por entrega de card,
    // não por mensagem. Se um tenant crescer uma ordem de grandeza, o conserto
    // é a coluna `telefoneChave` finalmente ter um escritor.
    const leads = await prisma.lead.findMany({
      where: { imobiliariaId: p.imobiliariaId, telefone: { not: null } },
      select: { id: true, telefone: true },
      orderBy: { criadoEm: "desc" },
    });
    const casados = leads.filter((l) => sufixoTelefone(l.telefone) === alvo);
    if (casados.length !== 1) {
      if (casados.length > 1)
        console.error(
          `[passagem] ${casados.length} leads com o sufixo ${alvo} no tenant ${p.imobiliariaId} — relógio não aberto`
        );
      return null;
    }
    return await registrarPassagem({
      leadId: casados[0].id,
      imobiliariaId: p.imobiliariaId,
      gatilho: p.gatilho,
      corretorId: p.corretorId,
      agora: p.agora,
    });
  } catch (e) {
    console.error("[passagem] casamento por telefone falhou:", e);
    return null;
  }
}

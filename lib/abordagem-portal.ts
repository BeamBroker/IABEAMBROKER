// A primeira mensagem para quem preencheu o formulário do portal.
//
// O QUE ESTAVA ESCRITO NO CÓDIGO ATÉ AQUI. O webhook de portal gravava o lead,
// abria a conversa e parava, com um aviso no lugar de uma decisão: "⚠️ NÃO
// manda mensagem… a IA aborda sozinha quem preencheu formulário no portal, ou o
// lead entra na fila para um corretor dar o primeiro oi?". A decisão foi
// tomada em 10/08: manda, e o texto é NOSSO — montado por código, não gerado
// pelo modelo.
//
// POR QUE TEMPLATE E NÃO A IA. Três razões, e nenhuma é custo:
//   1. A primeira mensagem é a que decide se a pessoa responde ou bloqueia. Ela
//      precisa ser previsível, e a dona da imobiliária precisa poder LER o que
//      o sistema vai dizer em nome dela antes de ligar isso.
//   2. Ela sai em segundos, no meio do webhook do portal. Uma chamada de LLM
//      aqui põe latência e uma dependência que pode estar fora no caminho de
//      entrada do lead — e lead de portal descartado não volta.
//   3. Depois dela a conversa é da IA, normalmente: quando a pessoa responder,
//      o webhook do WhatsApp entrega a resposta ao agente como qualquer outra.
//      O template é o "oi", não o atendimento.
//
// O QUE ESTE MÓDULO NÃO FAZ: decidir sozinho. Ele só age quando
// `Imobiliaria.abordagemPortalAtiva` está ligado — desligado é o padrão, porque
// ligar isto faz o sistema falar com cliente real sem ninguém apertar nada.

import { prisma } from "@/lib/db";
import { descreverImovel } from "@/lib/referencia-imovel";
import { auditar } from "@/lib/auditoria";
import { ehCanalPro, rotuloDaOrigem } from "@/lib/etiqueta-origem";
import { dentroHorarioComercial, proximoHorarioComercial } from "@/lib/followup";
import { idDaCasa } from "@/lib/instancias";
import { log } from "@/lib/log";
import { enviarWhatsApp } from "@/lib/whatsapp";

// ── O texto ─────────────────────────────────────────────────────────────────

export type DadosDaAbordagem = {
  nome: string;
  imobiliaria: string;
  /** A origem gravada (ZAP, VIVAREAL, OLX) — vira "Zap Imóveis" no texto. */
  origem: string;
  /**
   * Como a pessoa reconhece o imóvel: bairro e tipo, NUNCA o código.
   * `null` quando o anúncio não casou com nenhum imóvel da carteira.
   */
  imovel: string | null;
};

/**
 * Modelo padrão. Os marcadores são os mesmos que a imobiliária pode usar em
 * `abordagemPortalTexto` para escrever o dela.
 *
 * O texto tem que responder, em uma linha, "quem é você e por que está me
 * escrevendo" — senão vira o que a pessoa lê como spam e bloqueia. Por isso ele
 * cita o PORTAL e o IMÓVEL: é o que prova que a mensagem é consequência do que
 * ela acabou de fazer, e não uma lista comprada.
 *
 * Sem código de imóvel de propósito: o código é nosso, da gaveta. Quem preencheu
 * o formulário reconhece "o apartamento no Centro", não "o 1650".
 */
export const MODELO_PADRAO =
  "Oi {nome}, aqui é da {imobiliaria}. Vi que você pediu informações sobre {imovel} pelo {portal}. " +
  "Estou aqui pra te ajudar: me diz o que você quer saber que eu já te respondo por aqui.";

/** Quando o anúncio não casou com nenhum imóvel: não dá para citar qual. */
export const MODELO_SEM_IMOVEL =
  "Oi {nome}, aqui é da {imobiliaria}. Vi que você deixou seu contato pelo {portal}. " +
  "Estou aqui pra te ajudar: me diz o que você procura que eu já te mando as opções.";

/**
 * Preenche o modelo. Puro de propósito — é o que o teste consegue conferir sem
 * banco, e é o que a tela de Configurações usa para mostrar a prévia do texto
 * que a imobiliária vai mandar.
 *
 * Um marcador desconhecido fica como está, visível: `{telefone}` aparecendo
 * cru na mensagem é feio, mas é MUITO melhor que sumir em silêncio — quem
 * escreveu o modelo vê o erro na prévia e corrige.
 */
export function textoDaAbordagem(dados: DadosDaAbordagem, modelo?: string | null): string {
  const base = (modelo?.trim() || (dados.imovel ? MODELO_PADRAO : MODELO_SEM_IMOVEL)).trim();
  // Primeiro nome: "Oi Maria Aparecida da Silva" não é como ninguém cumprimenta.
  const primeiro = dados.nome.trim().split(/\s+/)[0] || "tudo bem";
  const valores: Record<string, string> = {
    nome: primeiro,
    imobiliaria: dados.imobiliaria.trim(),
    portal: rotuloDaOrigem(dados.origem),
    // O modelo da casa pode citar {imovel} mesmo quando não houve casamento.
    // "sobre o imóvel" mantém a frase de pé em vez de deixar um buraco nela.
    imovel: dados.imovel?.trim() || "o imóvel",
  };
  return base
    .replace(/\{(\w+)\}/g, (marcador, chave: string) => valores[chave] ?? marcador)
    // Modelo escrito à mão vem com espaço duplo onde um marcador ficou vazio.
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

// ── O envio ─────────────────────────────────────────────────────────────────

export type ResultadoAbordagem =
  /** Saiu para o WhatsApp agora. */
  | { feito: "enviada"; conversaId: number; texto: string }
  /** Fora do horário: o primeiro toque do follow-up faz na próxima abertura. */
  | { feito: "agendada"; quando: Date }
  /** Não é caso de abordar (flag desligada, sem telefone, origem que não é do Canal Pro…). */
  | { feito: "nao"; motivo: string };

export type LeadParaAbordar = {
  id: number;
  imobiliariaId: number;
  nome: string;
  telefone: string | null;
  origem: string;
  /**
   * Por qual CAMINHO o lead entrou (`Parser.via`, em lib/portais.ts).
   *
   * Não dá para deduzir isto da origem, e a tentativa de deduzir foi um bug
   * pego pelo teste: o parser de e-mail também grava `VIVAREAL` (ele lê o
   * remetente), então "origem é do Canal Pro" era verdade para os dois
   * caminhos — e o lead de e-mail, cujo nome e telefone saem de uma regex que
   * ainda não viu e-mail real de cada portal, ia receber WhatsApp.
   */
  via: "API" | "EMAIL";
  /** Já casado com a carteira pelo webhook, quando o anúncio bateu. */
  imovelId: number | null;
};

/**
 * Aborda (ou não) o lead que acabou de entrar pelo portal.
 *
 * NUNCA joga: é chamada de dentro do webhook do portal, e uma exceção aqui
 * derrubaria a gravação do lead — que é a parte que não pode falhar. O portal
 * não reenvia lead no mês seguinte.
 */
export async function abordarLeadDePortal(
  lead: LeadParaAbordar,
  { agora = new Date() }: { agora?: Date } = {}
): Promise<ResultadoAbordagem> {
  // O caminho de e-mail entrega o lead minutos ou horas depois, com nome e
  // telefone extraídos por uma regex que ainda não viu e-mail real de cada
  // portal (ver o "ESQUELETO" em lib/portais.ts) — abordar em cima disso é
  // mandar "Oi Nome:" para um telefone possivelmente errado. Só o POST do
  // Canal Pro chega com campo nomeado.
  if (lead.via !== "API") return { feito: "nao", motivo: "lead entrou por e-mail" };
  if (!ehCanalPro(lead.origem)) return { feito: "nao", motivo: `origem ${lead.origem} não é Canal Pro` };
  if (!lead.telefone) return { feito: "nao", motivo: "lead sem telefone" };

  const imob = await prisma.imobiliaria.findUnique({
    where: { id: lead.imobiliariaId },
    select: {
      nome: true,
      abordagemPortalAtiva: true,
      abordagemPortalTexto: true,
      bloqueadaEm: true,
    },
  });
  if (!imob) return { feito: "nao", motivo: "imobiliária não existe" };
  if (!imob.abordagemPortalAtiva) return { feito: "nao", motivo: "abordagem desligada para este tenant" };
  // Conta bloqueada continua RECEBENDO lead (ver o webhook), mas não fala com o
  // cliente dela: bloqueio suspende IA e painel, e uma mensagem saindo em nome
  // de quem está com a conta suspensa é pior que o silêncio.
  if (imob.bloqueadaEm) return { feito: "nao", motivo: "imobiliária bloqueada" };

  // Fora do horário, não manda: uma mensagem às 3h da manhã custa o lead que
  // ela deveria ganhar. Em vez de inventar uma fila nova, marca o relógio que o
  // motor de follow-up já lê a cada 15 minutos (lib/followup.ts) — ele faz o
  // primeiro toque na próxima abertura. `true` é a janela estendida (até 21h nos
  // dias de semana), que existe justamente para o toque mais quente.
  if (!dentroHorarioComercial(agora, true)) {
    const quando = proximoHorarioComercial(agora, true);
    await prisma.lead.update({
      where: { id: lead.id },
      data: { followUpEm: quando, followUpEtapa: 0 },
    });
    return { feito: "agendada", quando };
  }

  // Como a pessoa reconhece o imóvel. Tipo + bairro, sem código.
  let imovel: string | null = null;
  if (lead.imovelId) {
    const im = await prisma.imovel.findUnique({
      where: { id: lead.imovelId },
      select: { tipo: true, bairro: true, cidade: true, condominio: { select: { nome: true } } },
    });
    if (im) {
      // Passou a usar a régua de lib/referencia-imovel.ts: o "no" era fixo e
      // saía "no Vila Nova"; e o condomínio, quando existe, identifica melhor
      // que o bairro — foi citar a rua que confundiu um cliente em 21/08.
      imovel = descreverImovel({ ...im, condominio: im.condominio?.nome ?? null }).texto;
    }
  }

  const texto = textoDaAbordagem(
    { nome: lead.nome, imobiliaria: imob.nome, origem: lead.origem, imovel },
    imob.abordagemPortalTexto
  );

  // A conversa já foi aberta pelo webhook; esta busca é a mesma que ele faz, e
  // pega também o caso do contato que já falava com a casa antes.
  const conversa = await prisma.conversa.findFirst({
    where: { imobiliariaId: lead.imobiliariaId, contatoTelefone: lead.telefone },
    orderBy: { atualizadaEm: "desc" },
    select: { id: true, instanciaId: true, contatoJid: true, leadId: true },
  });
  const conv =
    conversa ??
    (await prisma.conversa.create({
      data: {
        imobiliariaId: lead.imobiliariaId,
        instanciaId: await idDaCasa(lead.imobiliariaId),
        agente: "RECEPCAO",
        contatoNome: lead.nome,
        contatoTelefone: lead.telefone,
        canal: lead.origem.toUpperCase(),
        // A ponte Conversa → Lead. Este é o segundo dos dois lugares que a
        // deixavam vazia (o outro é o webhook do portal). Sem ela, a conversa
        // que chega ao roteador não sabe de qual lead é — e portanto não sabe
        // qual brinco tem.
        leadId: lead.id,
      },
      select: { id: true, instanciaId: true, contatoJid: true, leadId: true },
    }));

  // Conversa que já existia e ainda não apontava para lead nenhum. `leadId:
  // null` no filtro é o que impede este lead de sequestrar a conversa de outro,
  // e é o que torna a chamada repetível sem efeito colateral.
  if (conversa && conversa.leadId == null) {
    await prisma.conversa
      .updateMany({ where: { id: conversa.id, leadId: null }, data: { leadId: lead.id } })
      .catch(() => {});
  }

  const destinos = conv.contatoJid ? [conv.contatoJid, lead.telefone] : [lead.telefone];
  const envio = await enviarWhatsApp(lead.telefone, texto, { instanciaId: conv.instanciaId }, destinos);

  if (!envio.enviado && envio.provedor !== "demo") {
    // Não grava a mensagem que não saiu: o painel mostraria à equipe uma fala
    // que o cliente nunca recebeu, e alguém responderia "como eu te falei".
    // O lead fica para o follow-up tentar de novo daqui a pouco.
    log.warn("abordagem-portal: envio falhou", {
      leadId: lead.id,
      provedor: envio.provedor,
      detalhe: envio.detalhe,
    });
    await prisma.lead
      .update({ where: { id: lead.id }, data: { followUpEm: agora, followUpEtapa: 0 } })
      .catch(() => {});
    return { feito: "nao", motivo: `envio falhou: ${envio.provedor}` };
  }

  // Autor IA e não ATENDENTE: quem falou foi o sistema, e a bolha no painel
  // precisa dizer isso para a equipe não achar que um colega já respondeu.
  await prisma.mensagem.create({ data: { conversaId: conv.id, autor: "IA", texto } });
  await prisma.conversa.update({
    where: { id: conv.id },
    data: { atualizadaEm: agora },
  });

  // O relógio da cadência começa a contar daqui: se a pessoa não responder, o
  // follow-up existente assume, sem repetir o "oi".
  await prisma.lead.update({
    where: { id: lead.id },
    data: { status: "ATENDIMENTO", followUpEm: new Date(agora.getTime() + 3_600_000), followUpEtapa: 1 },
  });

  // O tenant vai EXPLÍCITO. `auditar` normalmente o deduz da sessão, e aqui não
  // há sessão nenhuma — é um webhook. Sem este argumento o registro nasceria com
  // imobiliariaId nulo, e /auditoria filtra estritamente pelo tenant: a linha
  // existiria no banco e não apareceria para ninguém.
  await auditar(
    "ABORDAGEM_PORTAL",
    "Lead",
    lead.id,
    `${rotuloDaOrigem(lead.origem)} · ${lead.nome}`,
    lead.imobiliariaId
  );

  return { feito: "enviada", conversaId: conv.id, texto };
}

// A COBRANÇA: quem manda o lembrete, para quem, e quando o gestor entra.
//
// A regra mora em lib/cadencia-vendedor.ts (pura, sem banco). Aqui é só o
// encanamento: ler o estado, decidir com aquele módulo, enviar, gravar.
//
// ─── O QUE ESTE ARQUIVO CONSOME DO RELÓGIO DO SLA ───────────────────────────
//
// A passagem do lead ao vendedor (`passouEm`) e a resposta humana
// (`respondidoEm`) são a MEDIÇÃO, e são de outra frente — o carimbo único
// (`lib/passagem.ts` / `SlaLead`) que resolve o buraco de `Lead.atribuidoEm` ser
// escrito em 2 dos ~5 caminhos de entrega.
//
// Este módulo não carimba nada e não mede latência: ele lê dois valores e decide
// se manda mensagem. A leitura está isolada em `respostasHumanasPorLead` e no
// `cobrancaBaseEm` justamente para o dia em que `SlaLead` existir: trocar a
// origem é trocar esses dois pontos, e o resto do arquivo não sabe a diferença.
//
// Enquanto ela não existe, a origem é `Lead.atribuidoEm`, e isso tem um limite
// que precisa estar escrito: os caminhos de entrega que NÃO carimbam
// `atribuidoEm` (rodízio desligado, entrega pelo card do CRM, fim da cadência da
// IA) não geram cobrança nenhuma hoje. A cobrança nasce cobrindo os caminhos que
// já carimbam e passa a cobrir os cinco no dia em que o carimbo único subir.
//
// ─── DUAS DEFESAS QUE NÃO SÃO OPCIONAIS ─────────────────────────────────────
//
// 1. UMA MENSAGEM COM OS N LEADS, não N mensagens. Dez leads vencendo na mesma
//    passada seriam dez notificações seguidas do mesmo chip — o padrão de rajada
//    que o WhatsApp pune com provider_code 463. lib/ritmo-envio.ts espaça em
//    1,2s mas não é teto de volume.
//
// 2. FALHA DE ENVIO NÃO AVANÇA O TOQUE. Mesmo desenho de followup.ts:655-680:
//    contar como enviado o que não saiu queima um dos três toques do corretor
//    sem ele ter recebido nada, e o gestor é avisado de uma cadência que nunca
//    aconteceu.
//
// ─── NUNCA JOGA ─────────────────────────────────────────────────────────────
//
// Roda dentro de cron. Uma exceção aqui derrubaria as outras rotinas da mesma
// rota (a de 15 min carrega monitor de instância e follow-up do cliente junto).

import { prisma } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import {
  TOTAL_TOQUES_VENDEDOR,
  JANELA_COBRANCA_HORAS,
  ehConfirmacaoDeFollow,
  precisaEscalonar,
  proximoToqueDoVendedor,
  textoDaCobranca,
  textoDoEscalonamento,
  type LeadCobrado,
  type PassagemDoVendedor,
} from "@/lib/cadencia-vendedor";
import { idDaCasa } from "@/lib/instancias";
import { log } from "@/lib/log";
import { sufixoTelefone } from "@/lib/match";
import { destinoDoLembrete, motivoDeNaoTerDestino } from "@/lib/telefone-do-corretor";
import { enviarWhatsApp } from "@/lib/whatsapp";

const HORA = 3_600_000;

/** Quantos leads cabem numa mensagem antes de ela virar parede de texto.
 *  Acima disso a mensagem diz quantos ficaram de fora — o corretor precisa saber
 *  que a fila é maior do que a lista, senão ele trabalha os cinco e acha que
 *  acabou. */
const LEADS_POR_MENSAGEM = 5;

/** Quanto esperar antes de tentar de novo depois de um envio que falhou.
 *  Sem isto o cron de 15 min bateria no mesmo número quebrado quatro vezes por
 *  hora. O teto é a própria janela de cobrança: passadas 72h o lead sai da
 *  esteira sozinho, sem precisar de um contador de falhas. */
const REAGENDAR_APOS_FALHA_HORAS = 2;

/** Status em que cobrar follow não faz mais sentido. */
const STATUS_ENCERRADOS = ["FECHADO", "PERDIDO"] as const;

export type ResultadoCobranca = {
  /** Casas com a cobrança ligada. Zero é o estado de todo tenant no dia em que
   *  isto sobe — e não é erro. */
  casas: number;
  leadsVistos: number;
  mensagensEnviadas: number;
  toquesRegistrados: number;
  escalonamentos: number;
  /** Leads que venceram e não tinham para onde mandar. É o número que diz se o
   *  cadastro de telefone da equipe está feito. */
  semDestino: number;
  dispensados: number;
};

const ZERO: ResultadoCobranca = {
  casas: 0,
  leadsVistos: 0,
  mensagensEnviadas: 0,
  toquesRegistrados: 0,
  escalonamentos: 0,
  semDestino: 0,
  dispensados: 0,
};

/** O recorte de `Conversa` de que esta rotina precisa. Lido uma vez por casa e
 *  passado adiante — ver `cobrarNaCasa`. */
type ConversaDaCasa = { id: number; leadId: number | null; contatoTelefone: string | null };

type LeadDaEsteira = {
  id: number;
  nome: string;
  telefone: string | null;
  finalidade: string | null;
  corretorId: number | null;
  atribuidoEm: Date | null;
  cobrancaBaseEm: Date | null;
  cobrancaToques: number;
  cobrancaDispensadaEm: Date | null;
  cobrancaEscalonadaEm: Date | null;
  imovel: { codigo: string; tipo: string; bairro: string | null; cidade: string } | null;
  empreendimento: { nome: string; bairro: string | null; cidade: string } | null;
  corretor: {
    id: number;
    nome: string;
    telefone: string | null;
    instanciaWhatsApp: { numero: string | null } | null;
  } | null;
};

/**
 * Uma passada da cobrança.
 *
 * Chamada de dois crons de propósito (ver app/api/cron/cobranca/route.ts):
 * a varredura 3x/dia que Samuel pediu literalmente, e o cron de 15 min, porque
 * o primeiro toque é em MINUTOS e 3x/dia o detectaria até 8h depois. É
 * idempotente — o que decide se algo sai é o estado gravado no lead, não quem
 * chamou.
 */
export async function cobrarFollowsPendentes(opcoes?: {
  imobiliariaId?: number;
  agora?: Date;
  teto?: number;
}): Promise<ResultadoCobranca> {
  const agora = opcoes?.agora ?? new Date();
  try {
    // O DESLIGADO SAI PRIMEIRO. `cobrancaVendedorAtiva` é false em todo tenant
    // até alguém ligar na tela, então este é o caminho normal e ele custa uma
    // consulta indexada. `bloqueadaEm` fora pela mesma regra de aviso-lead.ts:241:
    // conta suspensa continua recebendo lead, mas o sistema não fala em nome de
    // quem está suspenso.
    const casas = await prisma.imobiliaria.findMany({
      where: {
        cobrancaVendedorAtiva: true,
        bloqueadaEm: null,
        ...(opcoes?.imobiliariaId ? { id: opcoes.imobiliariaId } : {}),
      },
      select: { id: true, avisoLeadTelefone: true, gestorTelefone: true },
    });
    if (casas.length === 0) return { ...ZERO };

    const total: ResultadoCobranca = { ...ZERO, casas: casas.length };
    for (const casa of casas) {
      const r = await cobrarNaCasa(casa, agora, opcoes?.teto ?? 200).catch((e) => {
        // Uma casa que quebra não leva as outras. Multi-tenant: o dado torto de
        // um cliente não pode calar a cobrança dos demais.
        log.error("cobranca-vendedor: falhou na casa", {
          imobiliariaId: casa.id,
          erro: e instanceof Error ? e.message : String(e),
        });
        return { ...ZERO };
      });
      total.leadsVistos += r.leadsVistos;
      total.mensagensEnviadas += r.mensagensEnviadas;
      total.toquesRegistrados += r.toquesRegistrados;
      total.escalonamentos += r.escalonamentos;
      total.semDestino += r.semDestino;
      total.dispensados += r.dispensados;
    }
    return total;
  } catch (e) {
    log.error("cobranca-vendedor: falhou", { erro: e instanceof Error ? e.message : String(e) });
    return { ...ZERO };
  }
}

async function cobrarNaCasa(
  casa: { id: number; avisoLeadTelefone: string | null; gestorTelefone: string | null },
  agora: Date,
  teto: number
): Promise<ResultadoCobranca> {
  const desde = new Date(agora.getTime() - JANELA_COBRANCA_HORAS * HORA);

  // A JANELA DE ADOÇÃO ESTÁ NO `where`, não num filtro depois. É o que impede o
  // acidente do dia 1: no instante em que a casa liga o recurso, o banco já tem
  // lead atribuído há meses e todos entrariam vencidos de uma vez. O caso já
  // aconteceu neste sistema (followup.ts:456-461, 192 mensagens quase disparadas).
  const leads: LeadDaEsteira[] = await prisma.lead.findMany({
    where: {
      imobiliariaId: casa.id,
      atribuidoEm: { gte: desde, lte: agora },
      status: { notIn: [...STATUS_ENCERRADOS] },
      cobrancaEscalonadaEm: null,
      cobrancaDispensadaEm: null,
    },
    select: {
      id: true,
      nome: true,
      telefone: true,
      finalidade: true,
      corretorId: true,
      atribuidoEm: true,
      cobrancaBaseEm: true,
      cobrancaToques: true,
      cobrancaDispensadaEm: true,
      cobrancaEscalonadaEm: true,
      imovel: { select: { codigo: true, tipo: true, bairro: true, cidade: true } },
      empreendimento: { select: { nome: true, bairro: true, cidade: true } },
      corretor: {
        select: {
          id: true,
          nome: true,
          telefone: true,
          instanciaWhatsApp: { select: { numero: true } },
        },
      },
    },
    orderBy: { atribuidoEm: "asc" },
    take: teto,
  });
  if (leads.length === 0) return { ...ZERO };

  const r: ResultadoCobranca = { ...ZERO, leadsVistos: leads.length };

  // Reinício de ciclo: reatribuição é uma passagem NOVA e a contagem volta a
  // zero. Sem isto o corretor novo herdaria "toque 3 de 3" de quem tinha o lead
  // antes e seria escalado ao gestor sem ter recebido um lembrete sequer.
  for (const l of leads) {
    if (!l.atribuidoEm) continue;
    if (l.cobrancaBaseEm?.getTime() === l.atribuidoEm.getTime()) continue;
    await prisma.lead.update({
      where: { id: l.id },
      data: {
        cobrancaBaseEm: l.atribuidoEm,
        cobrancaToques: 0,
        cobrancaProximaEm: null,
        cobrancaEscalonadaEm: null,
        cobrancaDispensadaEm: null,
      },
    });
    l.cobrancaBaseEm = l.atribuidoEm;
    l.cobrancaToques = 0;
  }

  // UMA varredura de conversas por casa, e não uma por consumidor. `Conversa`
  // não tem por onde filtrar telefone no SQL — `contatoChave` está NULL em 100%
  // das linhas de produção porque o gatilho prometido no schema não existe —,
  // então o casamento é por sufixo em JS e a consulta traz a lista da casa.
  // Fazer isso duas vezes na mesma passada dobraria a parte cara da rotina.
  const conversasDaCasa = await prisma.conversa.findMany({
    where: { imobiliariaId: casa.id, simulacao: false },
    select: { id: true, leadId: true, contatoTelefone: true },
  });

  const respostas = await respostasHumanasPorLead(conversasDaCasa, leads, agora);

  // ── A palavra do corretor ────────────────────────────────────────────────
  // "Se você já falou com ele por telefone, me responde OK" é a saída que a
  // mensagem promete. Sem ela, quem faz o follow por LIGAÇÃO — que o sistema não
  // tem como ver, porque `Mensagem` só guarda o que passou pelo WhatsApp — é
  // acusado ao gestor por um trabalho que fez.
  const dispensados = await confirmacoesDosCorretores(conversasDaCasa, leads, agora);
  if (dispensados.size) {
    const ids = [...dispensados.keys()];
    await prisma.lead.updateMany({
      where: { id: { in: ids }, cobrancaDispensadaEm: null },
      data: { cobrancaDispensadaEm: agora },
    });
    r.dispensados = ids.length;
  }

  const passagens = new Map<number, PassagemDoVendedor>();
  for (const l of leads) {
    if (!l.cobrancaBaseEm) continue;
    passagens.set(l.id, {
      leadId: l.id,
      passouEm: l.cobrancaBaseEm,
      respondidoEm: respostas.get(l.id) ?? null,
      toquesEnviados: l.cobrancaToques,
      escalonadoEm: l.cobrancaEscalonadaEm,
      dispensadaEm: dispensados.has(l.id) ? agora : l.cobrancaDispensadaEm,
    });
  }

  // ── Agrupamento por corretor ─────────────────────────────────────────────
  // A chave é o corretor e não o telefone: dois corretores podem cair no mesmo
  // plantão, e juntar os leads dos dois numa mensagem só apagaria de quem é a
  // responsabilidade — que é a única informação que o escalonamento vai usar.
  const porCorretor = new Map<number | 0, LeadDaEsteira[]>();
  const escalar = new Map<number | 0, LeadDaEsteira[]>();

  for (const l of leads) {
    const p = passagens.get(l.id);
    if (!p) continue;
    const chave = l.corretorId ?? 0;

    if (precisaEscalonar(p, agora)) {
      escalar.set(chave, [...(escalar.get(chave) ?? []), l]);
      continue;
    }
    const toque = proximoToqueDoVendedor(p, agora);
    if (!toque) continue;
    if (toque.quando.getTime() > agora.getTime()) {
      // Fora do expediente: AGENDA, não envia. Gravar o horário é o que faz a
      // próxima passada saber que já existe hora marcada em vez de recalcular.
      await prisma.lead
        .update({ where: { id: l.id }, data: { cobrancaProximaEm: toque.quando } })
        .catch(() => {});
      continue;
    }
    porCorretor.set(chave, [...(porCorretor.get(chave) ?? []), l]);
  }

  for (const [chave, doGrupo] of porCorretor) {
    const enviado = await enviarCobrancaDoGrupo(casa, chave, doGrupo, passagens, agora);
    r.mensagensEnviadas += enviado.mensagens;
    r.toquesRegistrados += enviado.toques;
    r.semDestino += enviado.semDestino;
  }

  for (const [, doGrupo] of escalar) {
    r.escalonamentos += await escalonarGrupo(casa, doGrupo, passagens, agora);
  }

  return r;
}

// ── O envio da cobrança ─────────────────────────────────────────────────────

async function enviarCobrancaDoGrupo(
  casa: { id: number; avisoLeadTelefone: string | null },
  corretorId: number | 0,
  doGrupo: LeadDaEsteira[],
  passagens: Map<number, PassagemDoVendedor>,
  agora: Date
): Promise<{ mensagens: number; toques: number; semDestino: number }> {
  const corretor = doGrupo.find((l) => l.corretor)?.corretor ?? null;
  const destino = destinoDoLembrete({
    usuarioTelefone: corretor?.telefone,
    instanciaNumero: corretor?.instanciaWhatsApp?.numero,
    avisoLeadTelefone: casa.avisoLeadTelefone,
  });

  if (!destino) {
    // NÃO é silêncio, e não é erro: é cadastro faltando, e o log tem que dizer
    // qual dos três é o buraco — senão o gestor que digitou o número errado
    // passa meses achando que o recurso está quebrado. O número nunca vai no
    // log (aviso-lead.ts:229-231): produção é lida por mais gente do que a tela
    // onde ele foi digitado.
    log.warn("cobranca-vendedor: lembrete sem destino", {
      imobiliariaId: casa.id,
      corretorId: corretorId || null,
      leads: doGrupo.length,
      motivo: motivoDeNaoTerDestino({
        usuarioTelefone: corretor?.telefone,
        instanciaNumero: corretor?.instanciaWhatsApp?.numero,
        avisoLeadTelefone: casa.avisoLeadTelefone,
      }),
    });
    return { mensagens: 0, toques: 0, semDestino: doGrupo.length };
  }

  const mostrados = doGrupo.slice(0, LEADS_POR_MENSAGEM);
  // Id e texto andam JUNTOS. Montar as duas listas em paralelo e parear depois
  // por contagem (`slice(0, cobrados.length)`) é como o toque avançaria para um
  // lead que não entrou na mensagem: basta um `continue` no meio do laço para as
  // duas listas desalinharem, e o sintoma seria um corretor queimando um dos
  // três toques dele sem ter recebido nada sobre aquele cliente.
  const cobrados: { id: number; texto: LeadCobrado }[] = [];
  for (const l of mostrados) {
    const p = passagens.get(l.id)!;
    const t = proximoToqueDoVendedor(p, agora);
    if (!t) continue;
    cobrados.push({
      id: l.id,
      texto: {
        nome: l.nome,
        telefone: l.telefone,
        interesse: descreverInteresse(l),
        toque: t.toque,
        minutosEsperando: t.minutosEsperando,
      },
    });
  }
  if (cobrados.length === 0) return { mensagens: 0, toques: 0, semDestino: 0 };

  let texto = textoDaCobranca(cobrados.map((c) => c.texto));
  const sobraram = doGrupo.length - mostrados.length;
  if (sobraram > 0)
    texto += `\n\n(+${sobraram} lead(s) na mesma situação. O painel tem a lista inteira.)`;

  // Sai pelo número DA CASA, nunca pela instância do próprio corretor:
  // aviso-lead.ts:269-271 já documenta que corretor recebendo mensagem do
  // próprio número é conversa consigo mesmo, que o WhatsApp nem entrega direito.
  const envio = await enviarWhatsApp(destino.telefone, texto, {
    instanciaId: await idDaCasa(casa.id),
  }).catch(() => ({ enviado: false, provedor: "erro", detalhe: "exceção no envio" }));

  if (!envio.enviado && envio.provedor !== "demo") {
    // FALHA NÃO AVANÇA O TOQUE. Só empurra a próxima tentativa, para o cron de
    // 15 min não bater quatro vezes por hora no mesmo número quebrado. O teto é
    // a janela de cobrança: em 72h o lead sai da esteira sozinho.
    const retentar = new Date(agora.getTime() + REAGENDAR_APOS_FALHA_HORAS * HORA);
    await prisma.lead
      .updateMany({
        where: { id: { in: doGrupo.map((l) => l.id) } },
        data: { cobrancaProximaEm: retentar },
      })
      .catch(() => {});
    log.warn("cobranca-vendedor: envio falhou", {
      imobiliariaId: casa.id,
      corretorId: corretorId || null,
      fonte: destino.fonte,
      provedor: envio.provedor,
      detalhe: envio.detalhe,
    });
    return { mensagens: 0, toques: 0, semDestino: 0 };
  }

  // O toque avança SÓ para quem entrou na mensagem. Quem ficou de fora do corte
  // continua no degrau em que estava — contar como cobrado quem não apareceu no
  // texto queimaria um dos três toques dele em silêncio.
  const idsCobrados = cobrados.map((c) => c.id);
  await prisma.lead.updateMany({
    where: { id: { in: idsCobrados } },
    data: { cobrancaToques: { increment: 1 }, cobrancaProximaEm: null },
  });

  await auditar(
    "COBRANCA_FOLLOW_VENDEDOR",
    "Usuario",
    corretorId || 0,
    `${corretor?.nome ?? "sem corretor (plantão)"} · ${idsCobrados.length} lead(s) · destino ${destino.fonte}`,
    casa.id
  ).catch(() => {});

  return { mensagens: 1, toques: idsCobrados.length, semDestino: 0 };
}

// ── O escalonamento ─────────────────────────────────────────────────────────

async function escalonarGrupo(
  casa: { id: number; gestorTelefone: string | null },
  doGrupo: LeadDaEsteira[],
  passagens: Map<number, PassagemDoVendedor>,
  agora: Date
): Promise<number> {
  // Sem gestor cadastrado, a esteira PARA aqui e não repete. Marcar
  // `cobrancaEscalonadaEm` mesmo sem enviar é deliberado: sem isso, esses leads
  // voltariam para a fila de escalonamento a cada passada do cron até saírem da
  // janela, e a rotina gastaria consulta para nunca fazer nada. "Ligada sem
  // gestorTelefone" é um estado válido — cobra o corretor, não escala.
  const marcar = async () =>
    (
      await prisma.lead.updateMany({
        where: { id: { in: doGrupo.map((l) => l.id) }, cobrancaEscalonadaEm: null },
        data: { cobrancaEscalonadaEm: agora },
      })
    ).count;

  if (!casa.gestorTelefone?.trim()) {
    await marcar();
    return 0;
  }
  const destino = destinoDoLembrete({ usuarioTelefone: casa.gestorTelefone });
  if (!destino) {
    log.warn("cobranca-vendedor: gestorTelefone cadastrado é inválido", {
      imobiliariaId: casa.id,
      motivo: motivoDeNaoTerDestino({ usuarioTelefone: casa.gestorTelefone }),
    });
    await marcar();
    return 0;
  }

  // ── A TRAVA, tomada ANTES do envio ───────────────────────────────────────
  // `updateMany` com `cobrancaEscalonadaEm: null` no WHERE é a reserva atômica:
  // de duas passadas simultâneas do cron — e elas acontecem, porque a rotina é
  // chamada de dois timers — exatamente uma acerta as linhas. Mesmo desenho de
  // aviso-lead.ts:252-256. Ler antes não bastaria: as duas leriam null antes de
  // qualquer uma escrever, e o gestor receberia a reclamação em duplicata.
  const reservados = await marcar();
  if (reservados === 0) return 0;

  const corretor = doGrupo.find((l) => l.corretor)?.corretor ?? null;
  const texto = textoDoEscalonamento({
    corretor: corretor?.nome ?? null,
    leads: doGrupo.map((l) => {
      const p = passagens.get(l.id)!;
      return {
        nome: l.nome,
        telefone: l.telefone,
        interesse: descreverInteresse(l),
        toque: TOTAL_TOQUES_VENDEDOR,
        minutosEsperando: Math.floor((agora.getTime() - p.passouEm.getTime()) / 60_000),
      };
    }),
  });

  const envio = await enviarWhatsApp(destino.telefone, texto, {
    instanciaId: await idDaCasa(casa.id),
  }).catch(() => ({ enviado: false, provedor: "erro", detalhe: "exceção no envio" }));

  if (!envio.enviado && envio.provedor !== "demo") {
    // DEVOLVE A TRAVA, igual a aviso-lead.ts:282-284. Sem isto, a única
    // tentativa que este escalonamento teria na vida seria a que falhou.
    await prisma.lead
      .updateMany({
        where: { id: { in: doGrupo.map((l) => l.id) }, cobrancaEscalonadaEm: agora },
        data: { cobrancaEscalonadaEm: null },
      })
      .catch(() => {});
    log.warn("cobranca-vendedor: escalonamento não saiu", {
      imobiliariaId: casa.id,
      provedor: envio.provedor,
      detalhe: envio.detalhe,
    });
    return 0;
  }

  await auditar(
    "SLA_ESCALONADO",
    "Usuario",
    corretor?.id ?? 0,
    `${corretor?.nome ?? "sem corretor (lead entregue sem dono)"} · ${doGrupo.length} lead(s) sem retorno depois de ${TOTAL_TOQUES_VENDEDOR} lembretes`,
    casa.id
  ).catch(() => {});

  return doGrupo.length;
}

// ── A VARREDURA DO WHATSAPP ─────────────────────────────────────────────────

/**
 * Alguém desta casa falou com o cliente depois da passagem?
 *
 * SÓ `ATENDENTE` FECHA, e essa é a regra que decide o recurso inteiro. Se `IA`
 * contasse, o follow-up automático da própria Maitê fecharia o relógio do
 * corretor uma hora depois da passagem e todo mundo teria 100% de cumprimento —
 * a cadência existiria e nunca cobraria ninguém.
 *
 * Casa lead↔conversa por `Conversa.leadId` primeiro e por sufixo de telefone
 * depois, na mesma ordem que aviso-lead.ts:362-366 usa. NÃO usa `contatoChave`
 * nem `telefoneChave`: as duas colunas prometem gatilho que não existe e estão
 * NULL em 100% das linhas de produção (medido em 12/08, registrado em
 * follow-detectado.ts:66-69). Usar a coluna seria não casar nada, calado.
 */
async function respostasHumanasPorLead(
  conversas: ConversaDaCasa[],
  leads: LeadDaEsteira[],
  agora: Date
): Promise<Map<number, Date>> {
  const achadas = new Map<number, Date>();
  const maisAntiga = leads.reduce<Date>(
    (min, l) => (l.cobrancaBaseEm && l.cobrancaBaseEm < min ? l.cobrancaBaseEm : min),
    agora
  );

  const porLead = new Map<number, number[]>();
  const porSufixo = new Map<string, number[]>();
  for (const c of conversas) {
    if (c.leadId) porLead.set(c.leadId, [...(porLead.get(c.leadId) ?? []), c.id]);
    const s = sufixoTelefone(c.contatoTelefone);
    if (s) porSufixo.set(s, [...(porSufixo.get(s) ?? []), c.id]);
  }

  const idsPorLead = new Map<number, number[]>();
  const todos = new Set<number>();
  for (const l of leads) {
    const ids = porLead.get(l.id) ?? porSufixo.get(sufixoTelefone(l.telefone) ?? "") ?? [];
    if (!ids.length) continue;
    idsPorLead.set(l.id, ids);
    for (const id of ids) todos.add(id);
  }
  if (todos.size === 0) return achadas;

  // Uma consulta para tudo, e não uma por lead: `Mensagem` é a maior tabela do
  // sistema e esta rotina roda de 15 em 15 minutos.
  const mensagens = await prisma.mensagem.findMany({
    where: {
      conversaId: { in: [...todos] },
      autor: "ATENDENTE",
      criadaEm: { gte: maisAntiga },
    },
    select: { conversaId: true, criadaEm: true },
    orderBy: { criadaEm: "asc" },
  });
  const primeiraPorConversa = new Map<number, Date[]>();
  for (const m of mensagens)
    primeiraPorConversa.set(m.conversaId, [...(primeiraPorConversa.get(m.conversaId) ?? []), m.criadaEm]);

  for (const l of leads) {
    if (!l.cobrancaBaseEm) continue;
    const ids = idsPorLead.get(l.id);
    if (!ids) continue;
    for (const id of ids) {
      const quando = (primeiraPorConversa.get(id) ?? []).find((d) => d > l.cobrancaBaseEm!);
      if (quando && (!achadas.has(l.id) || quando < achadas.get(l.id)!)) achadas.set(l.id, quando);
    }
  }
  return achadas;
}

/**
 * Quais leads o corretor já disse ter atendido.
 *
 * O corretor responde no MESMO fio em que recebeu a cobrança — a conversa entre
 * o número dele e o da casa —, então a mensagem chega como `CLIENTE` numa
 * conversa cujo `contatoTelefone` é o telefone DELE. A dispensa vale para os
 * leads do grupo que foi cobrado junto, que é exatamente o que a mensagem
 * listou.
 *
 * SÓ VALE DEPOIS DO PRIMEIRO TOQUE. Sem essa trava, um "ok" que o corretor
 * mandou para outro assunto antes de qualquer lembrete desligaria uma cobrança
 * que ele nem sabe que existia.
 */
async function confirmacoesDosCorretores(
  conversas: ConversaDaCasa[],
  leads: LeadDaEsteira[],
  agora: Date
): Promise<Map<number, Date>> {
  const dispensados = new Map<number, Date>();
  const cobrados = leads.filter((l) => l.cobrancaToques > 0 && l.cobrancaBaseEm);
  if (cobrados.length === 0) return dispensados;

  // Um telefone por corretor: o mesmo número que recebeu o lembrete.
  const numeros = new Map<string, number[]>(); // sufixo → leadIds
  for (const l of cobrados) {
    const alvo = l.corretor?.telefone ?? l.corretor?.instanciaWhatsApp?.numero ?? null;
    const s = sufixoTelefone(alvo);
    if (!s) continue;
    numeros.set(s, [...(numeros.get(s) ?? []), l.id]);
  }
  if (numeros.size === 0) return dispensados;

  const desde = cobrados.reduce<Date>(
    (min, l) => (l.cobrancaBaseEm! < min ? l.cobrancaBaseEm! : min),
    agora
  );
  const alvos = conversas.filter((c) => numeros.has(sufixoTelefone(c.contatoTelefone) ?? ""));
  if (alvos.length === 0) return dispensados;

  const falas = await prisma.mensagem.findMany({
    where: { conversaId: { in: alvos.map((c) => c.id) }, autor: "CLIENTE", criadaEm: { gte: desde } },
    select: { conversaId: true, texto: true, criadaEm: true },
    orderBy: { criadaEm: "desc" },
    take: 200,
  });
  const conversaParaSufixo = new Map(alvos.map((c) => [c.id, sufixoTelefone(c.contatoTelefone)!]));

  for (const f of falas) {
    if (!ehConfirmacaoDeFollow(f.texto)) continue;
    const sufixo = conversaParaSufixo.get(f.conversaId);
    if (!sufixo) continue;
    for (const leadId of numeros.get(sufixo) ?? []) {
      const l = cobrados.find((x) => x.id === leadId);
      // A confirmação precisa ser POSTERIOR ao início do ciclo daquele lead.
      if (l?.cobrancaBaseEm && f.criadaEm > l.cobrancaBaseEm) dispensados.set(leadId, f.criadaEm);
    }
  }
  return dispensados;
}

/** "Compra · Apartamento no Centro (AP-0002)". Mesma composição de
 *  aviso-lead.ts:321-334, e o código do imóvel entra porque quem lê é o corretor
 *  e é ele que vai digitar o código na busca do sistema. */
function descreverInteresse(l: LeadDaEsteira): string | null {
  const finalidade =
    l.finalidade?.toUpperCase() === "COMPRA"
      ? "Compra"
      : l.finalidade?.toUpperCase() === "LOCACAO"
        ? "Locação"
        : null;
  let alvo: string | null = null;
  if (l.empreendimento) {
    const onde = l.empreendimento.bairro || l.empreendimento.cidade;
    alvo = onde ? `${l.empreendimento.nome} (${onde})` : l.empreendimento.nome;
  } else if (l.imovel) {
    const onde = l.imovel.bairro || l.imovel.cidade;
    alvo = `${l.imovel.tipo}${onde ? ` no ${onde}` : ""} (${l.imovel.codigo})`;
  }
  const linha = [finalidade, alvo].filter(Boolean).join(" · ");
  return linha || null;
}

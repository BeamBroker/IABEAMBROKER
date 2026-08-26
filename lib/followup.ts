// Motor de follow-up comercial (#7): cadência de reengajamento para nunca
// deixar um lead esfriar sem tentativa. A Maitê reengaja sozinha, com mensagens
// que escalam de tom, até o lead responder ou a cadência esgotar.
//
// Cadência (quando cada toque ACONTECE, contado do último contato):
//   1º toque:  1 hora
//   2º toque:  no dia seguinte
//   3º toque:  3 dias depois
//
// Eram cinco toques (2h, 6h, 24h, 72h, 7 dias). Mudou por decisão do dono em
// 01/08: três toques, mais espaçados, e cada mensagem RETOMANDO o assunto da
// última conversa em vez de repetir "e aí, pensou?" com outras palavras. Cinco
// cobranças em uma semana é o que faz o cliente bloquear o número.
//
// O array guarda o INTERVALO entre um toque e o seguinte, não o instante: 1h
// depois do último contato, +23h (cai no dia seguinte, na mesma hora da
// conversa), +48h (cai no terceiro dia).
// Só reengaja em HORÁRIO COMERCIAL: se o momento do toque cair fora do horário,
// adia para a próxima abertura (a Maitê não chama de madrugada). Responder ao
// cliente que escreve fora do horário continua normal — isto vale só pro toque
// proativo. Rodado pelo cron a cada 15 min (/api/cron/whatsapp).
//
// Estado no Lead: followUpEm (quando disparar o próximo toque) e followUpEtapa
// (quantos toques já foram enviados, 0..3). Cada mensagem RECEBIDA reinicia.

import { prisma } from "@/lib/db";
import { idDaCasa } from "@/lib/instancias";
import { auditar } from "@/lib/auditoria";
import { enviarWhatsApp, enviarPresenca } from "@/lib/whatsapp";
import { brl } from "@/lib/format";
import { artigo, demonstrativo, descreverImovel, pronome } from "@/lib/referencia-imovel";
import type { Lead, Imovel, Prisma } from "@prisma/client";

// Intervalo até o próximo toque. Ver o cabeçalho: 1h, dia seguinte, 3º dia.
const CADENCIA_HORAS = [1, 23, 48];
const TOTAL_TOQUES = CADENCIA_HORAS.length;

/** Falhas consecutivas de envio antes de a cadência desistir do toque.
 *
 *  Três é o número que separa "o momento está ruim" de "este número não
 *  recebe": com o reagendamento de 2h, são ~6h de janela comercial — folgado
 *  para instância que caiu e voltou, curto para um número inválido continuar
 *  consumindo IA e enchendo a conversa. */
const MAX_FALHAS_DE_TOQUE = 3;

// A cadência DESTE lead, quando alguém configurou uma pelo card. Vazio cai na
// de cima — imobiliária com array vazio no banco não pode derrubar o motor.
export function cadenciaDoLead(lead: { followUpCadencia?: number[] | null }): number[] {
  const dele = lead.followUpCadencia ?? [];
  return dele.length ? dele : CADENCIA_HORAS;
}

// Valida o que vem da tela. ZERO é o que mais importa recusar: um intervalo de
// zero hora faz o toque vencer no mesmo instante em que é agendado, e a
// varredura seguinte dispara de novo — laço de mensagem no WhatsApp do cliente.
export function validarCadencia(
  horas: number[]
): { ok: true; horas: number[] } | { ok: false; erro: string } {
  const limpa = horas.map((h) => Math.floor(Number(h))).filter((h) => Number.isFinite(h));
  if (limpa.length === 0) return { ok: false, erro: "Informe ao menos um intervalo." };
  if (limpa.length > 10) return { ok: false, erro: "No máximo 10 toques." };
  if (limpa.some((h) => h <= 0)) return { ok: false, erro: "Os intervalos têm que ser maiores que zero." };
  // Ordenada: fora de ordem, o 3º toque chegaria antes do 2º.
  return { ok: true, horas: [...limpa].sort((x, y) => x - y) };
}

const hora = 3_600_000;

// ─── Horário comercial (America/Sao_Paulo, UTC-3 fixo — o Brasil não tem DST) ─
const TZ_OFFSET_MS = 3 * hora;

function spParts(d: Date) {
  const sp = new Date(d.getTime() - TZ_OFFSET_MS);
  return { dia: sp.getUTCDay(), hora: sp.getUTCHours(), y: sp.getUTCFullYear(), mo: sp.getUTCMonth(), da: sp.getUTCDate() };
}
// instante UTC de um horário "de parede" de São Paulo
function horarioSP(y: number, mo: number, da: number, h: number): Date {
  return new Date(Date.UTC(y, mo, da, h, 0, 0) + TZ_OFFSET_MS);
}
// Janela de atendimento por dia da semana: seg-sex 9-18, sáb 9-12, dom fechado.
//
// O PRIMEIRO toque vai até as 21h nos dias de semana. Ele é o mais quente de
// todos — sai 1 hora depois de uma conversa viva —, e empurrar para as 9h do
// dia seguinte transforma "1 hora de silêncio" em doze. Quem escreveu às 19h30
// ainda está procurando imóvel às 20h30. Sábado e domingo NÃO esticam: uma
// mensagem de sábado à tarde chega quando não dá para marcar nada mesmo.
function janela(dia: number, primeiroToque = false): { abre: number; fecha: number } | null {
  if (dia === 0) return null;
  if (dia === 6) return { abre: 9, fecha: 12 };
  return { abre: 9, fecha: primeiroToque ? 21 : 18 };
}

export function dentroHorarioComercial(d: Date, primeiroToque = false): boolean {
  const p = spParts(d);
  const j = janela(p.dia, primeiroToque);
  return Boolean(j && p.hora >= j.abre && p.hora < j.fecha);
}

// Próximo instante dentro do horário comercial (o próprio d, se já estiver).
export function proximoHorarioComercial(d: Date, primeiroToque = false): Date {
  let cur = d;
  for (let i = 0; i < 10; i++) {
    const p = spParts(cur);
    const j = janela(p.dia, primeiroToque);
    if (j) {
      if (p.hora < j.abre) return horarioSP(p.y, p.mo, p.da, j.abre);
      if (p.hora < j.fecha) return cur;
    }
    // pula para o próximo dia às 9h (SP)
    const p2 = spParts(cur);
    cur = horarioSP(p2.y, p2.mo, p2.da + 1, 9);
  }
  return cur;
}

// Agenda um toque daqui a `horas`, mas dentro do horário comercial.
function agendarToque(base: Date, horas: number, primeiroToque = false): Date {
  const alvo = new Date(base.getTime() + horas * hora);
  return dentroHorarioComercial(alvo, primeiroToque)
    ? alvo
    : proximoHorarioComercial(alvo, primeiroToque);
}

const daqui = (horas: number) => agendarToque(new Date(), horas, horas === CADENCIA_HORAS[0]);

// Agenda o 1º toque (ou reagenda a partir de agora). Chamada quando a Maitê
// registra/atualiza um lead e quando o lead responde.
// Recomeça a régua a partir de agora, respeitando o horário comercial. Usada
// pelo botão do card: salvar às 23h não pode agendar o toque para meia-noite, e
// `agendarToque` é quem sabe empurrar para a abertura seguinte.
export async function agendarPrimeiroToque(leadId: number) {
  const lead = await prisma.lead.findUniqueOrThrow({
    where: { id: leadId },
    select: { followUpCadencia: true },
  });
  await prisma.lead.update({
    where: { id: leadId },
    data: { followUpEtapa: 0, followUpEm: daqui(cadenciaDoLead(lead)[0]!) },
  });
}

export async function iniciarCadencia(leadId: number) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { followUpEtapa: 0, followUpEm: daqui(CADENCIA_HORAS[0]) },
  });
}

// Lead respondeu: zera o relógio de silêncio (mantém a cadência viva sem
// disparar toque enquanto a conversa está quente).
export async function resetarCadencia(telefone: string, imobiliariaId: number) {
  await prisma.lead.updateMany({
    where: {
      imobiliariaId,
      telefone,
      status: { in: ["NOVO", "ATENDIMENTO", "VISITA_AGENDADA"] },
    },
    data: { followUpEtapa: 0, followUpEm: daqui(CADENCIA_HORAS[0]) },
  });
}

// ─── Lembretes da visita ────────────────────────────────────────────────────
//
// O único follow-up disparado por DATA, e não por silêncio: 24 horas antes e na
// manhã do dia. Os dois, porque resolvem coisas diferentes — o de 24h ainda dá
// tempo de remarcar; o da manhã é o que faz a pessoa lembrar de ir.
//
// Sem lembrete, quem não aparece não avisa, e o corretor descobre na porta.
//
// Não precisou de campo novo: `followUpEm` é o relógio ÚNICO do lead, e a regra
// é uma régua por vez. Enquanto há visita marcada, esse relógio pertence a ela;
// depois, volta para a cadência comercial. É o desenho que o dono pediu — "um
// follow específico dependendo do cenário, nunca vários".

export const LEMBRETE_ANTES_MS = 24 * hora;

// Mesmo dia no fuso de São Paulo, não em UTC: uma visita às 21h de segunda é
// 00h de terça em UTC, e "é hoje às 21h" viraria "é amanhã".
function mesmoDiaSP(a: Date, b: Date): boolean {
  const pa = spParts(a);
  const pb = spParts(b);
  return pa.y === pb.y && pa.mo === pb.mo && pa.da === pb.da;
}

// Os instantes de lembrete que ainda estão no futuro, em ordem.
export function instantesLembrete(visitaEm: Date, agora = new Date()): Date[] {
  const p = spParts(visitaEm);
  const manhaDoDia = horarioSP(p.y, p.mo, p.da, 9);
  return [new Date(visitaEm.getTime() - LEMBRETE_ANTES_MS), manhaDoDia]
    .filter((d) => d.getTime() > agora.getTime() && d.getTime() < visitaEm.getTime())
    .sort((a, b) => a.getTime() - b.getTime());
}

// Aponta o relógio do lead para o próximo lembrete. Chamada por agendar_visita e
// por remarcar_visita — sem isso o worker nunca acordaria a tempo, porque o
// relógio estaria marcado para a cadência comercial, lá na frente.
//
// Visita marcada em cima da hora (o mínimo é 2h) pode não ter lembrete nenhum:
// aí o relógio já vai para depois da visita, que é quando se descobre se a
// pessoa apareceu.
export async function agendarLembretesVisita(leadId: number, visitaEm: Date) {
  const proximo = instantesLembrete(visitaEm)[0];
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      followUpEtapa: 0,
      followUpEm: proximo ?? new Date(visitaEm.getTime() + 2 * hora),
    },
  });
}

// O que a Maitê precisa saber para retomar de onde parou, e não do zero.
type LeadToque = Lead & {
  imovel: (Imovel & { condominio?: { nome: string } | null }) | null;
  simulacoes: { status: string }[];
};

// O lembrete de visita. Curto: quem já marcou não precisa de discurso.
//
// O de 24h ainda dá tempo de remarcar, então ele OFERECE isso — é melhor
// remarcar na véspera do que o corretor descobrir na porta. O da manhã só
// confirma e diz onde pegar a chave, que é a dúvida prática do dia.
function lembreteVisita(
  nome: string,
  visitaEm: Date,
  endereco: string | null,
  naManha: boolean
): string {
  const p = spParts(visitaEm);
  const hhmm = `${String(p.hora).padStart(2, "0")}:${String(
    new Date(visitaEm.getTime() - TZ_OFFSET_MS).getUTCMinutes()
  ).padStart(2, "0")}`;
  const onde = endereco ? ` em ${endereco}` : "";
  return naManha
    ? `Oi ${nome}, é a Maitê. Sua visita é hoje às ${hhmm}${onde}. A chave você retira aqui na imobiliária, a não ser que alguém da equipe já tenha combinado de te encontrar lá. Tudo certo?`
    : `Oi ${nome}, é a Maitê. Passando pra confirmar sua visita amanhã às ${hhmm}${onde}. Consegue ir? Se precisar mudar o horário, me fala que eu remarco.`;
}

// Quem marcou e não apareceu. Três toques, e o tom é o que decide se essa
// pessoa volta: ela pode ter tido um imprevisto, e ser cobrada por isso é o que
// faz sumir de vez. A Maitê pergunta o que houve antes de oferecer outra coisa.
function naoApareceu(nome: string, endereco: string | null, etapa: number): string {
  const onde = endereco ? ` no imóvel${endereco ? ` em ${endereco}` : ""}` : "";
  if (etapa === 1)
    return `Oi ${nome}, é a Maitê. A gente te esperou${onde} e você não conseguiu ir, né? Aconteceu alguma coisa? Se quiser, eu remarco pra outro dia, sem problema nenhum.`;
  if (etapa === 2)
    return `${nome}, o imóvel continua disponível e dá pra visitar em outro horário. Me diz qual dia funciona melhor pra você que eu já deixo separado.`;
  return `${nome}, não quero ficar te cobrando. Só me diz se você já alugou outra coisa, ou se ficou algum motivo que eu possa resolver. Se preferir parar por aqui, tudo bem também.`;
}

// Texto do toque, no tom da Maitê (objetiva, sem emoji, sem travessão).
//
// A regra que o dono pediu: cada mensagem RETOMA a última conversa. Não é
// enfeite — o lead que sumiu sumiu de um PONTO específico, e mandar "ainda está
// procurando?" para quem já escolheu o apartamento e travou na hora do CPF é
// dizer que ninguém acompanhou nada. Por isso o texto olha onde ele parou:
//
//   - escolheu o imóvel e não mandou os dados  → é ali que ele travou, e é o
//     ponto mais frágil do funil inteiro: o primeiro pedido pesado da conversa
//   - simulação PENDENTE                        → ele está esperando NOSSA
//     resposta; cobrar dele seria constrangedor
//   - viu imóvel e não escolheu                 → o imóvel ainda é o gancho
//   - nem chegou a ver                          → volta para a triagem
/** Exportada pelo mesmo motivo de `textoDoAviso` em lib/aviso-lead.ts: é texto
 *  que chega no WhatsApp de um cliente, e precisa ser conferível sem banco. Foi
 *  a falta disso que deixou "o casa de condomínio" chegar em produção. */
export function mensagemToque(lead: LeadToque, etapa: number): string {
  const nome = lead.nome.split(" ")[0];
  const compra = lead.finalidade === "COMPRA";
  const acao = compra ? "comprar" : "alugar";
  const im = lead.imovel;
  const valor = im ? (compra ? im.valorVenda : im.valorSugerido) : null;

  // A referência e a CONCORDÂNCIA saem de lib/referencia-imovel.ts. Antes disto
  // o artigo era o literal "o" e o imóvel era citado pela RUA — os dois
  // defeitos da mensagem de 21/08 ("o casa de condomínio em Avenida Miguel
  // Damha"), que fez o cliente achar que era oferta de outro condomínio.
  const desc = im ? descreverImovel({ ...im, condominio: im.condominio?.nome ?? null }) : null;
  const g = desc?.genero ?? "m";
  const citado = desc
    ? `${desc.texto}${valor ? ` (${brl(valor)}${compra ? "" : "/mês"})` : ""}`
    : null;
  const refImovel = citado ? `${artigo(g)} ${citado}` : null;
  // A forma de RETOMADA: "daquela casa no condomínio Gaivota I". Cita o imóvel
  // sem afirmar nada sobre ele, que é o que sobra quando a disponibilidade não
  // foi conferida.
  const refLembrei = citado ? `d${demonstrativo(g, "aquele")} ${citado}` : null;

  // ── DISPONIBILIDADE SE CONFERE, NÃO SE SUPÕE ────────────────────────────
  //
  // O toque de 21/08 às 10:30 dizia "segue disponível" sobre um imóvel cujo
  // status ninguém tinha olhado: a consulta desta cadência (processarFollowUps)
  // filtra o LEAD, nunca o imóvel, e traz a linha inteira do Imovel no include.
  // Ou seja: o dado estava na mão o tempo todo e a frase o ignorava. Um imóvel
  // alugado na semana passada recebia "segue disponível" igual.
  //
  // Confirmado DISPONIVEL, a frase pode afirmar. Em qualquer outro caso ela não
  // afirma NEM O CONTRÁRIO: ALUGADO, EM_REFORMA e INATIVO querem dizer coisas
  // diferentes, e "esse já saiu" sobre um imóvel em reforma é uma segunda
  // mentira para consertar a primeira. Sem certeza, a Maitê oferece conferir,
  // que é o que uma corretora faz.
  const disponivel = im?.status === "DISPONIVEL";
  const sim = lead.simulacoes[0];

  // Simulação rodando: quem deve resposta somos NÓS. A Maitê dá notícia, não
  // cobra — cobrar quem está esperando por você é o pior toque possível.
  if (sim?.status === "PENDENTE") {
    if (etapa === 1)
      return `${nome}, sua simulação do seguro ainda está sendo processada. Assim que sair o retorno eu te falo aqui, pode deixar.`;
    if (etapa === 2)
      return `${nome}, ainda não voltou o resultado da simulação. Não esqueci de você. Enquanto isso, se quiser ver mais alguma opção, é só me falar.`;
    return `${nome}, seguimos sem retorno da seguradora e não quero te deixar no vácuo. Vou pedir para a equipe olhar e te retorno. Se preferir falar direto com alguém daqui, me avisa.`;
  }

  // Escolheu o imóvel e parou na hora dos dados. É AQUI que mais gente cai.
  if (refImovel && !sim && !compra) {
    if (etapa === 1)
      return `${nome}, ficou faltando só os seus dados pra eu fazer a consulta do seguro de ${refImovel}. É rapidinho, preciso do nome completo, CPF, data de nascimento, telefone e e-mail.`;
    if (etapa === 2)
      return disponivel
        ? `${nome}, ${refImovel} continua disponível. Se ficou alguma dúvida sobre o seguro ou sobre os dados que pedi, me pergunta. Prefiro resolver isso do que te deixar sem resposta.`
        : `${nome}, se ficou alguma dúvida sobre o seguro ou sobre os dados que pedi, me pergunta. Prefiro resolver isso do que te deixar sem resposta.`;
    return `${nome}, sem os dados eu não consigo destravar a visita, e não quero ficar te cobrando. Se mudou de ideia ou apareceu outra coisa, tudo bem, é só me dizer. Se ainda quiser ${demonstrativo(g, "esse")}, é só mandar que eu sigo na hora.`;
  }

  // Compra: quem escolheu imóvel de venda para na qualificação, não no seguro.
  if (refImovel && compra) {
    if (etapa === 1)
      return disponivel
        ? `${nome}, ${refImovel} que você viu segue disponível. Quer que eu veja as condições de financiamento pra ${pronome(g)}?`
        : `${nome}, lembrei ${refLembrei} que você viu. Quer que eu confirme as condições ${g === "f" ? "dela" : "dele"} pra você?`;
    if (etapa === 2)
      return disponivel
        ? `${nome}, ${refImovel} continua de pé. Se quiser, eu já adianto a parte da análise pra você saber quanto o banco libera antes de decidir.`
        : `${nome}, se quiser, eu já adianto a parte da análise pra você saber quanto o banco libera antes de decidir.`;
    return `${nome}, não quero te tomar tempo à toa. Se ainda faz sentido ${acao}, me responde aqui que eu retomo de onde a gente parou.`;
  }

  // Viu opções mas não escolheu nenhuma, ou nem chegou a ver.
  if (etapa === 1)
    return refImovel
      ? disponivel
        ? `${nome}, ${refImovel} segue disponível. O que você achou d${g === "f" ? "ela" : "ele"}?`
        : `${nome}, fiquei pensando ${refLembrei} que te mandei. O que você achou d${g === "f" ? "ela" : "ele"}?`
      : `${nome}, consegui separar umas opções pra você ${acao}. Me diz o bairro e a faixa de valor que já te mando.`;
  if (etapa === 2)
    return refImovel
      ? `${nome}, se ${demonstrativo(g, "aquele")} não te agradou, sem problema. Me diz o que não encaixou (tamanho, bairro, valor) que eu procuro outros com esse ajuste.`
      : `${nome}, seguem aparecendo opções boas pra ${acao}. Me passa o que procura (tipo, bairro, valor) que eu já filtro pra você.`;
  return `${nome}, vou parar de te chamar pra não ficar te enchendo. Se voltar a procurar, é só me mandar mensagem aqui que eu retomo na hora, com o que a gente já tinha conversado.`;
}

// Registra a mensagem proativa na conversa do lead e envia pelo WhatsApp.
async function enviarToque(lead: LeadToque, texto: string) {
  const agente = lead.finalidade === "COMPRA" ? "COMPRA_VENDA" : "VENDAS";
  const conversa = await prisma.conversa.findFirst({
    where: { imobiliariaId: lead.imobiliariaId, contatoTelefone: lead.telefone! },
    orderBy: { atualizadaEm: "desc" },
  });
  const conv =
    conversa ??
    (await prisma.conversa.create({
      data: {
        imobiliariaId: lead.imobiliariaId,
        instanciaId: await idDaCasa(lead.imobiliariaId),
        agente,
        contatoTelefone: lead.telefone!,
        contatoNome: lead.nome,
      },
    }));
  const destinos = conv.contatoJid ? [conv.contatoJid, lead.telefone!] : [lead.telefone!];

  // ── "DIGITANDO…" ANTES DE UM ENVIO PROATIVO ────────────────────────────────
  //
  // O follow-up era a ÚNICA mensagem do sistema que saía seca: sem presença e
  // sem `delay`, ou seja, instantânea. O atendimento sempre fez o contrário —
  // app/api/webhooks/uazapi/route.ts manda `composing` antes de responder e
  // entre as bolhas.
  //
  // A assimetria importa porque estas duas mensagens não são iguais para o
  // WhatsApp. A do atendimento é RESPOSTA: o cliente escreveu primeiro. O
  // follow-up é PROATIVO, não solicitado — o mesmo formato que o spam tem — e
  // chegava com latência de robô.
  //
  // O que foi medido em produção (22/08/2026), no número da Mellim:
  //
  //     14:15:05  cron envia 1 follow-up, instância ainda "conectado"
  //     14:15:08  WhatsApp emite LoggedOut
  //                 "401: logged out from another device with recentMessage"
  //     14:15:10  webhook de conexão confirma a queda
  //
  // Três segundos. E o mesmo aconteceu em 19/08, também logo após um follow-up.
  // Não é prova de causa — dos 6 follow-ups do histórico, 4 não derrubaram nada,
  // e o critério da Meta é caixa preta. Mas é a única variável sob nosso
  // controle que separa os envios que caem dos que não caem, e a própria uazapi
  // expõe `delay`/`presence` justamente para isto.
  //
  // O custo de estar errado aqui é ~5 segundos por follow-up. O de estar certo e
  // não fazer nada é o cliente sem WhatsApp até alguém reparar.
  //
  // `catch` de propósito nos dois: presença é best-effort e não pode impedir o
  // envio — mensagem que não sai é pior que mensagem sem "digitando…".
  const msDigitando = 3000 + Math.floor(Math.random() * 3000); // 3–6s, como um humano
  await enviarPresenca(
    lead.telefone!,
    "composing",
    { instanciaId: conv.instanciaId },
    destinos,
    msDigitando
  ).catch(() => {});
  const envio = await enviarWhatsApp(
    lead.telefone!,
    texto,
    { instanciaId: conv.instanciaId },
    destinos,
    msDigitando
  );
  // A mensagem entra na conversa DEPOIS do envio, e só se ele deu certo.
  //
  // Estava antes, e o efeito aparecia no painel: cada retry de um número que
  // não recebe gravava mais uma cópia do mesmo texto. A conversa do lead Hugo,
  // no tenant 1, acumulou 25 cópias da mesma frase sem que uma única tivesse
  // chegado. O histórico mostrava um atendimento insistente que nunca existiu.
  //
  // "demo" conta como enviado: é o modo sem credencial, onde a cadência precisa
  // progredir para os testes.
  if (envio.enviado || envio.provedor === "demo")
    await prisma.mensagem.create({ data: { conversaId: conv.id, autor: "IA", texto } });
  return envio;
}

// ─── O FIM DA CADÊNCIA: ENTREGA, NÃO DESISTÊNCIA ────────────────────────────
//
// "Não insistir, coletar dados e depois o corretor assume" (dono, 10/08).
//
// Até hoje o último toque marcava o lead como PERDIDO. Isso é uma AFIRMAÇÃO
// forte — "esse cliente não fecha" — tirada de uma única evidência: ele não
// respondeu a mensagens automáticas. Muita gente não responde robô e atende
// telefone. E PERDIDO tira o lead da esteira, da fila do Meu Dia e da métrica
// de conversão, sem ninguém ter olhado a conversa uma vez.
//
// Agora ele sai da IA e entra na mão do corretor: a cadência para (followUpEm
// nulo, então nenhuma mensagem nova sai) e o status vai para EM_ATENDIMENTO, que
// é a etapa de "corretor assumiu". Quem decide se está perdido passa a ser gente.
//
// ─── POR QUE ELA SE CHAMA `encerrarCadencia`, E NÃO `entregarAoCorretor` ────
//
// Porque existe uma em lib/distribuicao.ts que faz outra coisa: aquela roda o
// rodízio, avisa o corretor de plantão e abre o relógio do SLA. Esta aqui só
// desliga a cadência e muda o status. Duas funções com o mesmo nome e
// semânticas diferentes é o que faz a próxima pessoa importar a errada — e, no
// caso, achar que o aviso ao corretor sai daqui, que não sai.
//
// (26/08, integração: a de lá foi renomeada para `distribuirEAvisar` no mesmo
// lote, vindo do outro lado. As duas frentes atacaram o mesmo homônimo por
// pontas opostas, e os dois nomes ficam.)
async function encerrarCadencia(
  leadId: number,
  nome: string,
  toques: number,
  imobiliariaId: number
) {
  await prisma.lead.update({
    where: { id: leadId },
    data: { status: "EM_ATENDIMENTO", followUpEm: null },
  });
  // O RELÓGIO DO SLA COMEÇA TAMBÉM AQUI.
  //
  // Este é o terceiro dos cinco caminhos de entrega, e até 26/08 era o mais
  // invisível dos três que não carimbavam nada: a IA desistia, o lead virava
  // EM_ATENDIMENTO, e ninguém nunca soube em que instante ele passou a ser
  // responsabilidade de gente. Sem `corretorId` explícito — quem resolve o dono
  // é `registrarPassagem`, lendo o lead. Ver lib/passagem.ts.
  const { registrarPassagem } = await import("@/lib/passagem");
  await registrarPassagem({ leadId, imobiliariaId, gatilho: "FIM_CADENCIA_IA" });
  await auditar(
    "LEAD_ENTREGUE_AO_CORRETOR",
    "Lead",
    leadId,
    `${nome}: fim da cadência (${toques} toques) sem resposta — a IA parou e a equipe assume`,
    imobiliariaId
  );
}

// Worker da cadência (rodado pelo cron a cada 15 min). Dispara os toques
// vencidos DENTRO do horário comercial, avança a etapa e reprograma o próximo;
// ao esgotar os 5 toques, marca PERDIDO.
/** Janela em que um lead sem agenda ainda é "recém-chegado" e entra na régua
 *  sozinho. Além dela, a cadência é desligada em vez de disparada — ver
 *  `adotarLeadsSemAgenda`. */
export const JANELA_ADOCAO_HORAS = 48;

/**
 * Lead que se diz em cadência e não está em nenhuma.
 *
 * `followUpAtivo` é `@default(true)` no schema e `followUpEm` nasce nulo: quem
 * cria lead PELO APP chama `iniciarCadencia` logo em seguida (agentes.ts,
 * acoes-locacao.ts), mas quem entra por importação não chama nada. O resultado
 * é um lead com o interruptor ligado e nenhum relógio: `processarFollowUps`
 * exige `followUpEm` ou `retomarEm` vencido, então esse lead nunca é tocado —
 * e a tela continua dizendo que ele está em cadência. Medido em 18/08/2026:
 * 192 leads assim na Mellim Imóveis, parados desde a importação de 11/08.
 *
 * As duas saídas, e por que não uma só:
 *
 *  · CHEGOU AGORA (até 48h) → agenda o primeiro toque. É o que o produto
 *    promete e o que o corretor espera de um lead novo.
 *
 *  · CHEGOU FAZ TEMPO → desliga `followUpAtivo`. Agendar aqui faria o sistema
 *    abordar, de uma vez, gente que preencheu formulário semanas atrás e nunca
 *    ouviu falar da casa — 192 mensagens reais saindo de uma correção de bug.
 *    Retomar lead frio é decisão de quem responde pela conta, e o botão do card
 *    (`agendarPrimeiroToque`) continua ali para quando ela for tomada.
 *
 * Só mexe em quem tem telefone: sem telefone não há toque possível, e ligar ou
 * desligar a cadência dele não muda nada.
 */
export async function adotarLeadsSemAgenda(agora: Date): Promise<{ adotados: number; desligados: number }> {
  const semAgenda: Prisma.LeadWhereInput = {
    status: { in: ["NOVO", "ATENDIMENTO", "VISITA_AGENDADA"] },
    telefone: { not: null },
    followUpAtivo: true,
    followUpEm: null,
    retomarEm: null,
    followUpEtapa: 0,
  };
  const corte = new Date(agora.getTime() - JANELA_ADOCAO_HORAS * hora);

  const novos = await prisma.lead.findMany({
    where: { ...semAgenda, criadoEm: { gte: corte } },
    select: { id: true },
  });
  for (const l of novos) await agendarPrimeiroToque(l.id).catch(() => {});

  const { count: desligados } = await prisma.lead.updateMany({
    where: { ...semAgenda, criadoEm: { lt: corte } },
    data: { followUpAtivo: false },
  });

  return { adotados: novos.length, desligados };
}

export async function processarFollowUps(): Promise<number> {
  const agora = new Date();
  // Antes de disparar o que está vencido, acerta quem nunca teve relógio.
  // Não joga: uma falha aqui não pode segurar os toques que já estão na hora.
  await adotarLeadsSemAgenda(agora).catch((e) => console.error("[followup] adoção falhou:", e));
  const leads = await prisma.lead.findMany({
    where: {
      status: { in: ["NOVO", "ATENDIMENTO", "VISITA_AGENDADA"] },
      telefone: { not: null },
      // Pausa por lead. Sem isto no `where`, o botão do card gravaria o campo e
      // não pausaria nada — a pior espécie de configuração: a tela confirma e a
      // IA continua falando.
      followUpAtivo: true,
      // Lead com retomada agendada tem followUpEm nulo de propósito: quem manda
      // nele é retomarEm.
      OR: [{ followUpEm: { not: null, lte: agora } }, { retomarEm: { not: null, lte: agora } }],
    },
    include: {
      // `condominio` junto: é ele que identifica o imóvel para o cliente
      // (ver lib/referencia-imovel.ts). Sem isto a citação cai para o bairro.
      imovel: { include: { condominio: { select: { nome: true } } } },
      // A última simulação diz em que ponto o lead travou — é o que permite
      // retomar a conversa em vez de recomeçá-la.
      simulacoes: { orderBy: { criadaEm: "desc" }, take: 1, select: { status: true } },
      // A visita mais recente, futura OU passada. Uma consulta só, porque o
      // mesmo bloco decide os dois cenários: antes dela é lembrete, depois
      // dela é "você não apareceu".
      visitas: {
        where: { status: { not: "CANCELADA" } },
        orderBy: { em: "desc" },
        take: 1,
        select: { em: true, status: true, imovel: { select: { endereco: true } } },
      },
    },
    take: 60,
  });

  let enviados = 0;
  for (const lead of leads) {
    // Fora do horário comercial: adia o toque para a próxima abertura (não chama
    // de madrugada) e não avança a etapa.
    if (!dentroHorarioComercial(agora)) {
      await prisma.lead.update({ where: { id: lead.id }, data: { followUpEm: proximoHorarioComercial(agora) } });
      continue;
    }

    // Retomada agendada (hoje: nome restrito aguardando quitação). Enquanto a
    // data não chega, a Maitê NÃO toca no assunto — insistir com quem não pode
    // financiar só queima o contato. Na data, ela volta uma vez e a cadência
    // normal recomeça do zero.
    if (lead.retomarEm) {
      if (lead.retomarEm.getTime() > agora.getTime()) continue;
      const quandoDisse = lead.retomarEm.toLocaleDateString("pt-BR");
      // Sem reapresentação, mesmo depois de meses. A frase seguinte já é
      // "você tinha me falado" — anunciar "aqui é a Maitê" antes dela é dizer,
      // na mesma respiração, que a conversa continua e que ninguém lembra dela.
      const texto =
        `${lead.nome.split(" ")[0]}, você tinha me falado que ia resolver ` +
        `aquela pendência do nome até ${quandoDisse}. Conseguiu? Se já estiver limpo, a gente retoma de onde parou.`;
      const envio = await enviarToque(lead, texto).catch(() => null);
      if (envio?.enviado === false) continue; // tenta de novo no próximo ciclo
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          retomarEm: null,
          retomarMotivo: null,
          followUpEtapa: 0,
          followUpEm: daqui(CADENCIA_HORAS[0]!),
        },
      });
      await auditar(
        "LEAD_RETOMADO",
        "Lead",
        lead.id,
        `retomada agendada (${quandoDisse})`,
        lead.imobiliariaId
      );
      enviados++;
      continue;
    }

    // ── Cenário VISITA ──────────────────────────────────────────────────
    //
    // Enquanto existe visita, o relógio do lead pertence a ela. Isso também
    // fecha um bug real: a cadência mandava "quer que eu agende uma visita?"
    // para quem tinha acabado de agendar uma, porque VISITA_AGENDADA entra na
    // busca lá em cima.
    const visita = lead.visitas[0];
    if (visita && visita.em.getTime() > agora.getTime()) {
      const naManha = mesmoDiaSP(visita.em, agora);
      const texto = lembreteVisita(
        lead.nome.split(" ")[0]!,
        visita.em,
        visita.imovel?.endereco ?? null,
        naManha
      );
      const envio = await enviarToque(lead, texto).catch(() => null);
      if (!envio || (!envio.enviado && envio.provedor !== "demo")) continue; // tenta no próximo ciclo
      // Próximo lembrete, ou o instante de conferir se a pessoa apareceu.
      const proximo = instantesLembrete(visita.em, agora)[0];
      await prisma.lead.update({
        where: { id: lead.id },
        data: { followUpEm: proximo ?? new Date(visita.em.getTime() + 2 * hora) },
      });
      await auditar(
        "LEMBRETE_VISITA_IA",
        "Lead",
        lead.id,
        `${naManha ? "manhã do dia" : "24h antes"} · ${lead.nome}`,
        lead.imobiliariaId
      );
      enviados++;
      continue;
    }

    // ── Cenário NÃO APARECEU ────────────────────────────────────────────
    //
    // Quem marcou e faltou não é lead frio nem lead perdido: é alguém que teve
    // um imprevisto, ou desistiu e não contou. Os três toques existem para
    // descobrir qual dos dois, e o tom decide se essa pessoa volta.
    //
    // FALTOU é marcado pela EQUIPE, na tela. Se ninguém marcar, o lead cai na
    // cadência comercial normal — não dá para a IA adivinhar que houve falta.
    if (visita && visita.status === "FALTOU") {
      const etapaFalta = lead.followUpEtapa + 1;
      if (etapaFalta > TOTAL_TOQUES) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            status: "PERDIDO",
            followUpEm: null,
            // O MOTIVO, e não em branco (26/08). Este caminho marca PERDIDO
            // SOZINHO, sem ninguém decidir nada. Enquanto a coluna não existia,
            // ele alimentava o gráfico de motivos de perda com "não informado" —
            // e o painel do dono acusava "o maior motivo de perda é não
            // informado: isso é falha de processo". O sistema criava o problema
            // que depois denunciava.
            //
            // "Sumiu" é o motivo certo e está em `MOTIVOS_PERDA`: a pessoa
            // marcou visita, faltou, e não respondeu a três toques.
            motivoPerda: "Sumiu",
          },
        });
        await auditar(
          "LEAD_PERDIDO_SEM_RESPOSTA",
          "Lead",
          lead.id,
          "não compareceu e não respondeu",
          lead.imobiliariaId
        );
        continue;
      }
      const texto = naoApareceu(lead.nome.split(" ")[0]!, visita.imovel?.endereco ?? null, etapaFalta);
      const envio = await enviarToque(lead, texto).catch(() => null);
      if (!envio || (!envio.enviado && envio.provedor !== "demo")) continue;
      const ultimo = etapaFalta >= TOTAL_TOQUES;
      await prisma.lead.update({
        where: { id: lead.id },
        data: {
          followUpEtapa: etapaFalta,
          ...(ultimo
            // Mesmo motivo do bloco acima: PERDIDO automático grava "Sumiu" em
            // vez de deixar o gráfico do dono dizer "não informado lidera".
            ? { status: "PERDIDO" as const, followUpEm: null, motivoPerda: "Sumiu" }
            : { followUpEm: agendarToque(agora, CADENCIA_HORAS[etapaFalta]!) }),
        },
      });
      await auditar(
        "FOLLOWUP_FALTA_IA",
        "Lead",
        lead.id,
        `toque ${etapaFalta}/${TOTAL_TOQUES} (não compareceu)`,
        lead.imobiliariaId
      );
      enviados++;
      continue;
    }

    // Respeita o handoff humano (#8): se a equipe assumiu a conversa desse lead,
    // a IA fica quieta e NÃO manda follow-up (retoma quando reativarem a IA).
    const conversa = await prisma.conversa.findFirst({
      where: { imobiliariaId: lead.imobiliariaId, contatoTelefone: lead.telefone! },
      orderBy: { atualizadaEm: "desc" },
      select: { iaPausada: true },
    });
    if (conversa?.iaPausada) continue;

    const cadencia = cadenciaDoLead(lead);
    const total = cadencia.length;

    const etapa = lead.followUpEtapa + 1; // toque que vamos enviar agora
    // Também é por aqui que sai quem teve a cadência ENCURTADA depois de já ter
    // avançado: estava na etapa 4, a nova tem 3, encerra agora.
    if (etapa > total) {
      await encerrarCadencia(lead.id, lead.nome, total, lead.imobiliariaId);
      continue;
    }
    const texto = mensagemToque(lead, etapa);
    const envio = await enviarToque(lead, texto).catch(() => null);

    // Falha REAL de envio (provedor ativo mas não entregou): NÃO avança a etapa,
    // tenta de novo em ~2h (dentro do horário comercial). Modo demo conta como
    // enviado, para a cadência progredir nos testes sem loop.
    const falhaReal = !envio || (!envio.enviado && envio.provedor !== "demo");
    if (falhaReal) {
      // FALHA TEM TETO. Antes daqui a cadência reagendava para 2h e tentava o
      // mesmo toque para sempre — número que não recebe (inválido, bloqueado,
      // fora do WhatsApp) nunca ia receber, e o sistema nunca desistia.
      //
      // Três tentativas cobrem a falha temporária de verdade (instância caída,
      // oscilação de rede, restrição passageira): são ~6h de janela comercial.
      // Passou disso, o problema não é o momento — é o número.
      //
      // Esgotar NÃO é descartar o lead: `encerrarCadencia` é o mesmo caminho
      // do fim normal da cadência, e uma pessoa decide o que fazer com alguém
      // que a automação não alcança.
      const falhas = lead.followUpFalhas + 1;
      if (falhas >= MAX_FALHAS_DE_TOQUE) {
        await prisma.lead.update({
          where: { id: lead.id },
          data: { followUpEtapa: total, followUpEm: null, followUpFalhas: 0 },
        });
        await auditar(
          "FOLLOWUP_LEAD_IA",
          "Lead",
          lead.id,
          `cadência encerrada: toque ${etapa}/${total} falhou ${falhas}x seguidas para ${lead.nome} (${envio?.detalhe ?? "sem detalhe"})`,
          lead.imobiliariaId
        );
        await encerrarCadencia(lead.id, lead.nome, total, lead.imobiliariaId);
        continue;
      }
      await prisma.lead.update({
        where: { id: lead.id },
        data: { followUpEm: agendarToque(agora, 2), followUpFalhas: falhas },
      });
      continue;
    }

    if (etapa >= total) {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { followUpEtapa: etapa, followUpFalhas: 0 },
      });
      await auditar(
        "FOLLOWUP_LEAD_IA",
        "Lead",
        lead.id,
        `toque ${etapa}/${total} (último) para ${lead.nome}`,
        lead.imobiliariaId
      );
      await encerrarCadencia(lead.id, lead.nome, total, lead.imobiliariaId);
    } else {
      await prisma.lead.update({
        where: { id: lead.id },
        data: { followUpEtapa: etapa, followUpEm: agendarToque(agora, cadencia[etapa]!), followUpFalhas: 0 },
      });
      await auditar(
        "FOLLOWUP_LEAD_IA",
        "Lead",
        lead.id,
        `toque ${etapa}/${TOTAL_TOQUES} para ${lead.nome}`,
        lead.imobiliariaId
      );
    }
    enviados++;
  }
  return enviados;
}

// ─── Avisos ao proprietário agendados fora do horário comercial (M4) ────────
// Despachado pelo cron de 15 min. Só envia o que já venceu e ainda não foi
// avisado — a marcação de proprietarioAvisadoEm mantém a idempotência.
export async function enviarAvisosProprietarioAgendados(): Promise<number> {
  const agora = new Date();
  if (!dentroHorarioComercial(agora)) return 0;

  const pendentes = await prisma.ocorrencia.findMany({
    where: {
      avisoAgendadoPara: { lte: agora },
      proprietarioAvisadoEm: null,
      avisoTexto: { not: null },
    },
    include: { imovel: { include: { proprietario: true } } },
    take: 50,
  });

  let enviados = 0;
  for (const oc of pendentes) {
    const telefone = oc.imovel.proprietario?.telefone;
    if (!telefone) continue;
    try {
      const { enviarWhatsApp } = await import("@/lib/whatsapp");
      await enviarWhatsApp(telefone, oc.avisoTexto!, oc.imovel.imobiliariaId);
      await prisma.ocorrencia.update({
        where: { id: oc.id },
        data: { proprietarioAvisadoEm: new Date(), avisoAgendadoPara: null },
      });
      enviados++;
    } catch (e) {
      console.error("aviso ao proprietário falhou:", e);
    }
  }
  return enviados;
}

// Régua de cobrança em ESCADA — o follow-up de quem deve.
//
// A régua anterior era um degrau só: uma mensagem para toda fatura ATRASADA,
// repetida a cada 5 dias, sempre com o mesmo texto. Isso tem três problemas que
// custam dinheiro de verdade:
//
//   1. Só falava DEPOIS do vencimento. A maior parte do atraso no aluguel é
//      esquecimento, não falta de dinheiro — e um lembrete três dias antes
//      evita o atraso em vez de cobrar por ele.
//   2. Repetia o mesmo texto para sempre. Quem está há 40 dias em atraso recebe
//      a mesma frase educada do primeiro dia, e a mensagem vira ruído.
//   3. Não terminava. Não havia momento em que a régua dissesse "daqui a equipe
//      assume" — e cobrar por robô eternamente é o jeito mais rápido de perder
//      o inquilino e ainda não receber.
//
// Aqui a régua tem seis degraus ancorados no VENCIMENTO, o tom escala, ela
// oferece acordo antes de endurecer, e ela ACABA — o último toque entrega o
// caso para a equipe.
//
// Os textos são fixos, não escritos pela IA. Cobrança é o lugar do sistema onde
// um número inventado vira briga: o valor, a multa e o juro têm que ser
// exatamente os do banco. A IA entra na RESPOSTA — quando o inquilino responde,
// quem atende é a Maitê da Administração, com os dados reais em mãos.

import { log } from "@/lib/log";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { idDaCasa } from "@/lib/instancias";
import { auditar } from "@/lib/auditoria";
import { centavos } from "@/lib/financeiro";
import { dentroHorarioComercial } from "@/lib/followup";
import { brl, competenciaBr, dataBr } from "@/lib/format";

export type Degrau = {
  etapa: number;
  // dias em relação ao vencimento: negativo = antes, 0 = no dia, positivo = depois
  dias: number;
  chave: "LEMBRETE" | "VENCE_HOJE" | "VENCEU" | "ENCARGOS" | "ACORDO" | "ULTIMO";
};

// A escada. Os dois primeiros degraus são PREVENÇÃO — falam antes de existir
// atraso, e é onde a régua mais paga por si.
export const ESCADA: Degrau[] = [
  { etapa: 1, dias: -3, chave: "LEMBRETE" },
  { etapa: 2, dias: 0, chave: "VENCE_HOJE" },
  { etapa: 3, dias: 1, chave: "VENCEU" },
  { etapa: 4, dias: 5, chave: "ENCARGOS" },
  { etapa: 5, dias: 12, chave: "ACORDO" },
  { etapa: 6, dias: 25, chave: "ULTIMO" },
];

export const ULTIMA_ETAPA = ESCADA[ESCADA.length - 1]!.etapa;

// Dias inteiros entre duas datas, contando pelo DIA no calendário e não pelas
// 24 horas: uma fatura que vence hoje às 23h está vencendo hoje, não amanhã.
export function diasDeDiferenca(de: Date, ate: Date): number {
  const d = Date.UTC(de.getFullYear(), de.getMonth(), de.getDate());
  const a = Date.UTC(ate.getFullYear(), ate.getMonth(), ate.getDate());
  return Math.round((a - d) / 86_400_000);
}

// Qual degrau é devido hoje para uma fatura, dado o que já foi enviado.
//
// Devolve o MAIOR degrau já vencido — não o próximo da fila. É o que faz uma
// fatura que só entrou no sistema com 20 dias de atraso receber "vamos fechar
// um acordo" em vez de "vence em três dias", que seria constrangedor e perderia
// a etapa útil.
export function degrauDevido(
  vencimento: Date,
  etapaEnviada: number,
  agora: Date
): Degrau | null {
  const diasCorridos = diasDeDiferenca(vencimento, agora);
  let alvo: Degrau | null = null;
  for (const d of ESCADA) if (diasCorridos >= d.dias && d.etapa > etapaEnviada) alvo = d;

  // Uma exceção que vale dinheiro: na PRIMEIRA vez que falamos com alguém, o
  // salto não passa da oferta de acordo.
  //
  // Sem isto, uma fatura que só entra no sistema com 40 dias de atraso (carteira
  // importada, contrato cadastrado depois) recebia como primeira mensagem da
  // vida "as minhas mensagens não tiveram retorno, a equipe assume" — o que é
  // mentira, nenhuma mensagem foi enviada — e pulava exatamente o degrau que
  // recupera o dinheiro. Ela recebe a oferta de acordo hoje; o último toque sai
  // na rodada seguinte, se não houver resposta.
  if (etapaEnviada === 0 && alvo && alvo.chave === "ULTIMO")
    return ESCADA.find((d) => d.chave === "ACORDO") ?? alvo;
  return alvo;
}

type DadosDoToque = {
  nome: string;
  endereco: string;
  competencia: string;
  vencimento: Date;
  valorOriginal: Prisma.Decimal;
  valorAtualizado: Prisma.Decimal;
  diasAtraso: number;
  temPix: boolean;
};

// O texto de cada degrau, na voz da Maitê: direta, sem emoji, sem travessão.
// Escala de "lembrete" a "a equipe assume", passando por uma oferta real de
// acordo — que é o degrau que costuma recuperar o dinheiro.
export function textoDoToque(chave: Degrau["chave"], d: DadosDoToque): string {
  const nome = d.nome.split(" ")[0];
  const ref = `${competenciaBr(d.competencia)} do imóvel ${d.endereco}`;
  const pix = d.temPix ? " Te mando o PIX copia e cola na sequência." : "";

  switch (chave) {
    case "LEMBRETE":
      return (
        `Oi ${nome}, aqui é a Maitê. Passando só pra lembrar que o aluguel de ${ref} ` +
        `vence em ${dataBr(d.vencimento)}, no valor de ${brl(d.valorOriginal)}.${pix}`
      );
    case "VENCE_HOJE":
      return (
        `Oi ${nome}, aqui é a Maitê. O aluguel de ${ref} vence hoje: ${brl(d.valorOriginal)}. ` +
        `Se já pagou, é só desconsiderar.${pix}`
      );
    case "VENCEU":
      return (
        `Oi ${nome}, aqui é a Maitê. O aluguel de ${ref} venceu em ${dataBr(d.vencimento)} e ` +
        `ainda consta em aberto: ${brl(d.valorAtualizado)} com os encargos de hoje. ` +
        `Se o pagamento já saiu, me avisa aqui que eu confiro.${pix}`
      );
    case "ENCARGOS":
      return (
        `Oi ${nome}, aqui é a Maitê. O aluguel de ${ref} está com ${d.diasAtraso} dias de atraso. ` +
        `Hoje o valor é ${brl(d.valorAtualizado)} (${brl(d.valorOriginal)} mais multa e juros), e ele ` +
        `cresce um pouco a cada dia. Se ficou apertado esse mês, me fala que a gente vê o que dá pra fazer.${pix}`
      );
    case "ACORDO":
      return (
        `Oi ${nome}, aqui é a Maitê. O aluguel de ${ref} está há ${d.diasAtraso} dias em aberto, ` +
        `hoje em ${brl(d.valorAtualizado)}. Antes de isso virar um problema maior, quero te oferecer ` +
        `uma saída: dá pra parcelar esse valor num acordo. Me responde aqui quanto você consegue pagar ` +
        `de entrada e em quantas vezes, que eu levo pra aprovação.`
      );
    case "ULTIMO":
      return (
        `Oi ${nome}, aqui é a Maitê. O aluguel de ${ref} está há ${d.diasAtraso} dias em aberto, ` +
        `hoje em ${brl(d.valorAtualizado)}, e as minhas mensagens não tiveram retorno. ` +
        `A partir de agora quem cuida desse caso é a equipe da imobiliária, que vai te procurar ` +
        `para resolver. Se preferir adiantar, me responde aqui hoje que eu ainda consigo encaminhar ` +
        `uma proposta de acordo.`
      );
  }
}

// ─── Execução ────────────────────────────────────────────────────────────────

// Quantas cobranças SAIRIAM se a régua rodasse agora.
//
// O botão da tela de Inadimplência mostrava `atrasadas.length` — o número de
// faturas vencidas, que não é o número de mensagens. A régua só fala com quem
// tem degrau devido HOJE, tem telefone, não está coberto por acordo e ainda não
// chegou ao fim da escada. Clicar num "(12)" e ver 3 saírem faz a pessoa clicar
// de novo achando que falhou.
//
// Ela repete o MESMO filtro do laço abaixo de propósito, e por isso mora coladas
// a ele: o dia em que os dois discordarem é o dia em que o número volta a
// mentir.
export async function contarCobrancasDevidas(
  imobiliariaId: number,
  agora: Date = new Date()
): Promise<number> {
  if (!dentroHorarioComercial(agora)) return 0;
  const candidatas = await prisma.fatura.findMany({
    where: {
      status: { in: ["ABERTA", "ATRASADA"] },
      cobrancaEtapa: { lt: ULTIMA_ETAPA },
      acordoId: null,
      imobiliariaId,
    },
    select: {
      vencimento: true,
      cobrancaEtapa: true,
      contrato: { select: { inquilino: { select: { telefone: true } } } },
    },
    take: 300,
  });
  return candidatas.filter(
    (f) => f.contrato.inquilino.telefone && degrauDevido(f.vencimento, f.cobrancaEtapa, agora)
  ).length;
}

// Roda a escada. Sem imobiliariaId, roda para todos os tenants (só o cron faz
// isso). Devolve quantos toques saíram.
export async function processarReguaCobranca(imobiliariaId?: number): Promise<number> {
  const agora = new Date();
  // Cobrança fora de hora é o que mais gera bloqueio e raiva. O lembrete pode
  // esperar até amanhã de manhã; o dinheiro não some nesse meio tempo.
  //
  // MAS O SILÊNCIO AQUI CUSTOU MESES DE COBRANÇA. Este `return 0` era mudo, e o
  // cron registrava "sucesso: 0 cobranças" — indistinguível de "ninguém devia
  // nada". Enquanto isso o timer disparava às 11:00 UTC, que é 08:00 em São
  // Paulo, e esta linha recusava todo santo dia. Medido em produção em 11/08:
  // 15 faturas atrasadas há mais de 5 dias sem uma única cobrança, e as 4
  // marcações que existiam eram de um teste manual de 29/07 às 22:37.
  //
  // O horário foi corrigido (vercel.json e o timer do systemd, ambos em UTC). O
  // aviso fica porque a próxima causa será outra: fuso do host, feriado, horário
  // de verão. Recusar é legítimo; recusar em silêncio é o que impede alguém de
  // perceber que a régua parou de cobrar.
  if (!dentroHorarioComercial(agora)) {
    log.warn("régua: fora do horário comercial — nenhuma cobrança enviada", {
      agora: agora.toISOString(),
      imobiliariaId,
    });
    return 0;
  }

  const { calcularEncargosAtraso } = await import("@/lib/financeiro");
  const { diasEmAtraso } = await import("@/lib/format");
  const { enviarWhatsApp } = await import("@/lib/whatsapp");

  const candidatas = await prisma.fatura.findMany({
    where: {
      status: { in: ["ABERTA", "ATRASADA"] },
      cobrancaEtapa: { lt: ULTIMA_ETAPA },
      // Fatura coberta por acordo sai da régua: quem já negociou não pode
      // continuar recebendo cobrança da dívida original.
      acordoId: null,
      // Pela coluna da própria fatura, não por contrato → imóvel → imobiliária.
      // As mesmas linhas (conferido em produção: nenhuma fatura diverge do
      // imóvel do seu contrato), mas sem duas junções — e é o que permite o
      // índice parcial de cobranca_pendente entrar, porque ele começa em
      // imobiliariaId.
      ...(imobiliariaId ? { imobiliariaId } : {}),
    },
    include: { contrato: { include: { inquilino: true, imovel: true } } },
    take: 300,
  });

  let enviados = 0;
  for (const f of candidatas) {
    try {
      const degrau = degrauDevido(f.vencimento, f.cobrancaEtapa, agora);
      if (!degrau) continue;
      const inquilino = f.contrato.inquilino;
      if (!inquilino.telefone) continue;

      const atraso = Math.max(0, diasEmAtraso(f.vencimento));
      const { multa, juros } = calcularEncargosAtraso(
        f.valorTotal, atraso, f.contrato.multaPercent, f.contrato.jurosMesPercent
      );
      const atualizado = centavos(f.valorTotal.plus(multa).plus(juros));

      const texto = textoDoToque(degrau.chave, {
        nome: inquilino.nome,
        endereco: f.contrato.imovel.endereco,
        competencia: f.competencia,
        vencimento: f.vencimento,
        valorOriginal: f.valorTotal,
        valorAtualizado: atualizado,
        diasAtraso: atraso,
        temPix: Boolean(f.pixCopiaECola),
      });

      const conversa = await prisma.conversa.upsert({
        where: { pessoaId_perfil: { pessoaId: inquilino.id, perfil: "LOCATARIO" } },
        create: {
          imobiliariaId: inquilino.imobiliariaId,
          instanciaId: await idDaCasa(inquilino.imobiliariaId),
          pessoaId: inquilino.id,
          perfil: "LOCATARIO",
        },
        update: {},
      });
      // Conversa assumida pela equipe: a régua CALA. Nada pior que o humano
      // negociando de um lado e o robô cobrando do outro.
      if (conversa.iaPausada) continue;

      await prisma.mensagem.create({ data: { conversaId: conversa.id, autor: "IA", texto } });
      await enviarWhatsApp(inquilino.telefone, texto, { instanciaId: conversa.instanciaId });
      if (f.pixCopiaECola && degrau.chave !== "ACORDO" && degrau.chave !== "ULTIMO") {
        await prisma.mensagem.create({
          data: { conversaId: conversa.id, autor: "IA", texto: f.pixCopiaECola },
        });
        await enviarWhatsApp(inquilino.telefone, f.pixCopiaECola, { instanciaId: conversa.instanciaId });
      }

      await prisma.fatura.update({
        where: { id: f.id },
        data: { cobrancaEtapa: degrau.etapa, ultimaCobrancaEm: agora },
      });
      await auditar(
        degrau.etapa === ULTIMA_ETAPA ? "COBRANCA_ESGOTADA" : "COBRANCA_TOQUE",
        "Fatura",
        f.id,
        `etapa ${degrau.etapa}/${ULTIMA_ETAPA} (${degrau.chave}) · ${competenciaBr(f.competencia)} · ${brl(atualizado)}`,
        f.imobiliariaId
      );
      enviados++;
    } catch (e) {
      // Uma fatura com problema não pode calar a régua das outras.
      console.error(`régua: fatura ${f.id} falhou, seguindo:`, e);
    }
  }
  return enviados;
}

// Faturas cuja régua se esgotou e que a equipe precisa assumir. É o que a tela
// de Inadimplência mostra como "a IA já fez o que podia".
export async function casosParaAEquipe(imobiliariaId: number) {
  return prisma.fatura.findMany({
    where: {
      imobiliariaId,
      status: "ATRASADA",
      cobrancaEtapa: { gte: ULTIMA_ETAPA },
      acordoId: null,
    },
    include: { contrato: { include: { inquilino: true, imovel: true } } },
    orderBy: { vencimento: "asc" },
  });
}

// Relacionamento — a Maitê falando ANTES de o assunto virar problema.
//
// O sistema já falava em três momentos: quando o aluguel entra, quando o
// repasse sai, e quando a fatura atrasa. Todos são reativos: alguém pagou,
// alguém deixou de pagar. Faltavam os dois momentos que a imobiliária SABE que
// vêm — e que, quando pegam o cliente de surpresa, é onde a relação azeda:
//
//   REAJUSTE — o aluguel sobe no aniversário do contrato. Descobrir isso pelo
//   boleto é a reclamação clássica da locação. Avisado com 30 dias, vira
//   previsibilidade; avisado pelo boleto, vira ligação irritada.
//
//   RENOVAÇÃO — o contrato acaba. Quem não pergunta com antecedência descobre
//   a saída do inquilino com o imóvel já vazio, perde meses de aluguel e o
//   proprietário perde a confiança. Perguntar com 90, 60 e 30 dias é o que
//   transforma vencimento em decisão tomada.
//
// Os textos são fixos e os números vêm do banco, pela mesma razão da régua de
// cobrança: um valor inventado numa mensagem sobre reajuste é briga na certa.
// A IA entra na resposta — quem responde "não quero renovar" ou "por que subiu?"
// cai na Maitê da Administração, que tem os dados do contrato em mãos.

import { prisma } from "@/lib/db";
import { idDaCasa } from "@/lib/instancias";
import { auditar } from "@/lib/auditoria";
import { enviarWhatsApp } from "@/lib/whatsapp";
import { brl, dataBr } from "@/lib/format";
import type { Prisma } from "@prisma/client";
import { diasDeDiferenca } from "@/lib/regua-cobranca";
import type { PerfilConversa } from "@prisma/client";

// Marcos de antecedência, em dias. Do mais longe para o mais perto: a varredura
// escolhe o PRIMEIRO que já entrou na janela e ainda não foi avisado.
export const MARCOS_RENOVACAO = [90, 60, 30] as const;
export const MARCOS_REAJUSTE = [30] as const;

// O aniversário do contrato dentro da vigência: a data de início, no ano em que
// ela cai depois de hoje. É quando o reajuste é aplicado.
export function proximoAniversario(inicio: Date, hoje: Date): Date {
  // MEIO-DIA UTC, não meia-noite — é a convenção que `lib/format.ts:37` já
  // documenta e que estas duas linhas violavam. À meia-noite UTC, `dataBr`
  // formata em Brasília (UTC-3) e volta um dia: um contrato que começa em 22/09
  // virava "21/09/2026" na mensagem de reajuste que sai por WhatsApp — para o
  // inquilino, uma data errada vinda da imobiliária.
  //
  // O erro não dependia do fuso do servidor: `dataBr` fixa Brasília sempre,
  // então saía errado tanto na VPS (São Paulo) quanto na Vercel (UTC).
  //
  // A chave de idempotência não muda com isto (`2026-09-22:30` antes e depois),
  // então nenhum aviso já enviado é reenviado.
  const aoMeioDia = (ano: number) =>
    new Date(Date.UTC(ano, inicio.getUTCMonth(), inicio.getUTCDate(), 12));
  const alvo = aoMeioDia(hoje.getUTCFullYear());
  if (diasDeDiferenca(hoje, alvo) < 0) return aoMeioDia(hoje.getUTCFullYear() + 1);
  return alvo;
}

// Qual marco disparar para um evento que acontece em `diasAte` dias.
//
// A regra é "já entrou na janela", não "é exatamente hoje". Um cron que falha um
// dia — deploy, timeout, feriado do provedor — não pode fazer o aviso de 60 dias
// sumir para sempre; ele sai atrasado, que é infinitamente melhor que não sair.
export function marcoDevido(diasAte: number, marcos: readonly number[]): number | null {
  if (diasAte < 0) return null;
  // O marco vigente é o MENOR que ainda cobre o prazo restante — o degrau que
  // acabou de ser cruzado. Faltando 59 dias, o marco é o de 60 (já cruzado) e
  // não o de 90, que foi avisado há um mês. Pegar o maior faria o aviso de 60
  // dias nunca sair para um contrato visto pela primeira vez com 59.
  let vigente: number | null = null;
  for (const m of [...marcos].sort((a, b) => a - b))
    if (m >= diasAte) {
      vigente = m;
      break;
    }
  return vigente;
}

// Chave de idempotência: o evento + a antecedência. Amarrar na DATA do evento e
// não na data de envio é o que impede o aviso de renovação de 30 dias sair de
// novo no ano seguinte para o mesmo contrato renovado.
export function chaveDoMarco(evento: Date, marco: number): string {
  return `${evento.toISOString().slice(0, 10)}:${marco}`;
}

async function falarCom(
  pessoaId: number,
  imobiliariaId: number,
  perfil: PerfilConversa,
  telefone: string | null,
  texto: string
): Promise<boolean> {
  const conversa = await prisma.conversa.upsert({
    where: { pessoaId_perfil: { pessoaId, perfil } },
    create: {
      imobiliariaId,
      instanciaId: await idDaCasa(imobiliariaId),
      agente: "ADMINISTRACAO",
      pessoaId,
      perfil,
    },
    update: {},
  });
  // Equipe no comando desta conversa: o robô não entra por cima.
  if (conversa.iaPausada) return false;
  await prisma.mensagem.create({ data: { conversaId: conversa.id, autor: "IA", texto } });
  if (telefone) await enviarWhatsApp(telefone, texto, { instanciaId: conversa.instanciaId });
  return true;
}

// ─── Reajuste ────────────────────────────────────────────────────────────────

export function textoReajusteInquilino(p: {
  nome: string;
  endereco: string;
  quando: Date;
  indice: string;
  valorAtual: Prisma.Decimal;
}): string {
  return (
    `Oi ${p.nome.split(" ")[0]}, aqui é a Maitê. Passando pra te avisar com antecedência: ` +
    `o contrato do imóvel ${p.endereco} faz aniversário em ${dataBr(p.quando)}, e nessa data o ` +
    `aluguel é reajustado pelo ${p.indice}, como está em contrato. Hoje ele é ${brl(p.valorAtual)}. ` +
    `Assim que o índice do mês fechar eu te mando o valor novo, antes de qualquer boleto. ` +
    `Se tiver dúvida sobre como funciona, é só me perguntar aqui.`
  );
}

export function textoReajusteProprietario(p: {
  nome: string;
  endereco: string;
  quando: Date;
  indice: string;
  valorAtual: Prisma.Decimal;
}): string {
  return (
    `Oi ${p.nome.split(" ")[0]}, aqui é a Maitê. O contrato do seu imóvel ${p.endereco} faz ` +
    `aniversário em ${dataBr(p.quando)} e o aluguel será reajustado pelo ${p.indice}. ` +
    `O valor atual é ${brl(p.valorAtual)}. Já avisei o inquilino com antecedência para não ` +
    `haver surpresa, e te confirmo o valor novo assim que o índice fechar.`
  );
}

// ─── Renovação ───────────────────────────────────────────────────────────────

export function textoRenovacaoInquilino(p: {
  nome: string;
  endereco: string;
  fim: Date;
  marco: number;
}): string {
  const prazo =
    p.marco >= 90 ? "daqui uns três meses" : p.marco >= 60 ? "daqui uns dois meses" : "no mês que vem";
  const fecho =
    p.marco <= 30
      ? `Como já está perto, preciso da sua resposta nos próximos dias pra dar tempo de organizar tudo.`
      : `Não precisa decidir agora, é só pra você não ser pego de surpresa.`;
  return (
    `Oi ${p.nome.split(" ")[0]}, aqui é a Maitê. O contrato do imóvel ${p.endereco} termina em ` +
    `${dataBr(p.fim)}, ou seja, ${prazo}. Você pretende renovar e continuar aí? ` +
    `Me responde aqui com um sim ou não que eu já encaminho. ${fecho}`
  );
}

export function textoRenovacaoProprietario(p: {
  nome: string;
  endereco: string;
  fim: Date;
  marco: number;
}): string {
  return (
    `Oi ${p.nome.split(" ")[0]}, aqui é a Maitê. O contrato do seu imóvel ${p.endereco} termina em ` +
    `${dataBr(p.fim)} (faltam ${p.marco} dias). Já perguntei ao inquilino se ele pretende renovar e ` +
    `te aviso assim que ele responder. Se ele sair, a gente já começa a divulgar antes de o imóvel ` +
    `desocupar, pra não ficar vago.`
  );
}

// ─── Varredura diária ────────────────────────────────────────────────────────

export type ResumoRelacionamento = { reajuste: number; renovacao: number };

// Percorre os contratos ATIVOS e dispara o que estiver na janela. Sem
// imobiliariaId, roda para todos os tenants (só o cron faz isso).
export async function processarRelacionamento(
  imobiliariaId?: number,
  agora: Date = new Date()
): Promise<ResumoRelacionamento> {
  const contratos = await prisma.contrato.findMany({
    where: { status: "ATIVO", ...(imobiliariaId ? { imovel: { imobiliariaId } } : {}) },
    include: { inquilino: true, imovel: { include: { proprietario: true } } },
    take: 500,
  });

  const resumo: ResumoRelacionamento = { reajuste: 0, renovacao: 0 };

  for (const ct of contratos) {
    try {
      const inq = ct.inquilino;
      const prop = ct.imovel.proprietario;

      // ── Renovação: o fim do contrato ──────────────────────────────────────
      const diasAteFim = diasDeDiferenca(agora, ct.fim);
      const marcoRenov = marcoDevido(diasAteFim, MARCOS_RENOVACAO);
      if (marcoRenov !== null) {
        const chave = chaveDoMarco(ct.fim, marcoRenov);
        const jaFoi = await prisma.avisoContrato.findUnique({
          where: { contratoId_tipo_marco: { contratoId: ct.id, tipo: "RENOVACAO", marco: chave } },
        });
        if (!jaFoi) {
          // Grava ANTES de mandar. Se o envio falhar, perdemos um aviso; se
          // gravássemos depois, um erro no meio do lote reenviaria tudo na
          // rodada seguinte — e mandar duas vezes é pior que mandar tarde.
          await prisma.avisoContrato.create({
            data: { imobiliariaId: ct.imobiliariaId, contratoId: ct.id, tipo: "RENOVACAO", marco: chave },
          });
          await falarCom(inq.id, ct.imobiliariaId, "LOCATARIO", inq.telefone,
            textoRenovacaoInquilino({ nome: inq.nome, endereco: ct.imovel.endereco, fim: ct.fim, marco: marcoRenov }));
          await falarCom(prop.id, ct.imobiliariaId, "PROPRIETARIO", prop.telefone,
            textoRenovacaoProprietario({ nome: prop.nome, endereco: ct.imovel.endereco, fim: ct.fim, marco: marcoRenov }));
          await auditar("AVISO_RENOVACAO", "Contrato", ct.id, `${marcoRenov} dias · fim ${dataBr(ct.fim)}`, ct.imobiliariaId);
          resumo.renovacao++;
        }
      }

      // ── Reajuste: o aniversário do contrato ───────────────────────────────
      // Não faz sentido avisar de reajuste se o contrato termina antes dele.
      const aniversario = proximoAniversario(ct.inicio, agora);
      if (diasDeDiferenca(aniversario, ct.fim) < 0) continue;
      const marcoReaj = marcoDevido(diasDeDiferenca(agora, aniversario), MARCOS_REAJUSTE);
      if (marcoReaj === null) continue;
      const chaveR = chaveDoMarco(aniversario, marcoReaj);
      const jaFoiR = await prisma.avisoContrato.findUnique({
        where: { contratoId_tipo_marco: { contratoId: ct.id, tipo: "REAJUSTE", marco: chaveR } },
      });
      if (jaFoiR) continue;
      await prisma.avisoContrato.create({
        data: { imobiliariaId: ct.imobiliariaId, contratoId: ct.id, tipo: "REAJUSTE", marco: chaveR },
      });
      const dados = {
        endereco: ct.imovel.endereco,
        quando: aniversario,
        indice: ct.indiceReajuste,
        valorAtual: ct.valorAluguel,
      };
      await falarCom(inq.id, ct.imobiliariaId, "LOCATARIO", inq.telefone,
        textoReajusteInquilino({ nome: inq.nome, ...dados }));
      await falarCom(prop.id, ct.imobiliariaId, "PROPRIETARIO", prop.telefone,
        textoReajusteProprietario({ nome: prop.nome, ...dados }));
      await auditar("AVISO_REAJUSTE", "Contrato", ct.id, `${marcoReaj} dias · ${dataBr(aniversario)}`, ct.imobiliariaId);
      resumo.reajuste++;
    } catch (e) {
      // Um contrato com problema não pode calar o relacionamento dos outros.
      console.error(`relacionamento: contrato ${ct.id} falhou, seguindo:`, e);
    }
  }
  return resumo;
}

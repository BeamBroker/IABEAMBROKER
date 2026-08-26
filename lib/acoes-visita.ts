// O núcleo do agendamento de visita, compartilhável entre a IA e a tela.
//
// ATENÇÃO — ESTE ARQUIVO NÃO PODE GANHAR `"use server"`, NUNCA.
//
// Num arquivo com essa diretiva, todo `export` vira endpoint HTTP público. As
// funções daqui recebem `imobiliariaId` POR PARÂMETRO, então expostas assim
// aceitariam o tenant de quem chama — que é exatamente o furo descrito em
// lib/servidor-endpoints.test.ts: em 2026-07-31 uma função nesse formato
// permitia mandar um POST com o id de outro cliente e disparar WhatsApp real
// com as credenciais dele. O teste de lá varre os arquivos `"use server"`; este
// mora fora deles de propósito.
//
// O nome começa com `acoes-` porque o allowlist do deploy casa por PREFIXO
// (`"lib/acoes-"` em scripts/deploy-ia.sh), não porque seja um arquivo de
// server action.
//
// Por que existe: a IA agendava visita gravando só `Lead.visitaEm`, sem criar a
// linha `Visita`. A visita não aparecia em /agenda, não tinha hora nem corretor,
// e nunca podia receber COMPAREEU/FALTOU. O cliente combinava, a IA confirmava,
// e ninguém da equipe ficava sabendo — ele chegava no imóvel sem quem abrisse a
// porta.

import {
  combinarDataHora,
  conflita,
  DURACAO_PADRAO_MIN,
  horariosDoDia,
  HORA_ABRE,
  HORA_FECHA,
  limitesDoDia,
} from "@/lib/agenda";

// Recusa carrega SEMPRE um motivo escrito. Valor que não entra tem que ser
// dito: já custou caro aqui uma data em formato brasileiro que virava
// `undefined` e deixava a IA muda no meio da conversa.
export type Recusa = { ok: false; motivo: string };
export type DataHoraOk = { ok: true; em: Date; dataIso: string; horaHhmm: string };

const doisDigitos = (n: number) => String(n).padStart(2, "0");

// A data que o cliente escreve, não a que o banco quer.
//
// Aceita AAAA-MM-DD (o que o schema pede), DD/MM/AAAA com barra, ponto ou hífen
// (o que o brasileiro digita) e DD/MM sem ano, que no WhatsApp é o caso mais
// comum de todos ("dia 12/08"). Sem ano, resolve para a PRÓXIMA ocorrência.
//
// NÃO interpreta "amanhã" nem "sábado" de propósito: o modelo já recebe a data
// de hoje no contexto e resolve isso melhor que um regex — e um regex errando
// data é um cliente esperando no imóvel no dia errado.
export function normalizarData(bruta: string, agora = new Date()): string | null {
  const s = (bruta ?? "").trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return existe(+iso[1]!, +iso[2]!, +iso[3]!);

  const br = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (!br) return null;
  const dia = +br[1]!;
  const mes = +br[2]!;
  if (br[3]) {
    const bruto = +br[3];
    // "26" é 2026, não o ano 26.
    return existe(bruto < 100 ? 2000 + bruto : bruto, mes, dia);
  }
  // Sem ano: este ano, e se já passou, o que vem.
  const desteAno = existe(agora.getFullYear(), mes, dia);
  if (!desteAno) return null;
  const d = new Date(`${desteAno}T23:59:59`);
  return d >= agora ? desteAno : existe(agora.getFullYear() + 1, mes, dia);
}

// 31/02 vira 03/03 no Date, calado. Se o dia mudou de mês, a data não existe —
// e inventar março para quem disse fevereiro é pior que recusar.
function existe(ano: number, mes: number, dia: number): string | null {
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  const d = new Date(ano, mes - 1, dia);
  if (d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return `${ano}-${doisDigitos(mes)}-${doisDigitos(dia)}`;
}

// "14:30", "14h30", "9h", "15" — tudo vira HH:MM. "De manhã" NÃO vira nada: um
// horário chutado é o cliente e o corretor em horas diferentes no mesmo imóvel.
export function normalizarHora(bruta: string): string | null {
  const s = (bruta ?? "").trim().toLowerCase().replace(/\s/g, "");
  if (!s) return null;
  const m = s.match(/^(\d{1,2})(?:[:h](\d{2}))?h?$/);
  if (!m) return null;
  const hh = +m[1]!;
  const mm = m[2] ? +m[2] : 0;
  if (hh > 23 || mm > 59) return null;
  return `${doisDigitos(hh)}:${doisDigitos(mm)}`;
}

// Data + hora viram um instante, ou uma recusa que diz o que perguntar.
//
// A hora é OBRIGATÓRIA. Marcar "dia 17" sem hora foi o que produziu visitas
// que a equipe não conseguia atender: um dia inteiro não é um compromisso.
export function interpretarDataHora(
  data: string | undefined,
  hora: string | undefined,
  agora = new Date()
): DataHoraOk | Recusa {
  const dataIso = normalizarData(data ?? "", agora);
  if (!dataIso)
    return {
      ok: false,
      motivo: `não entendi a data${data ? ` "${data}"` : " (não veio)"}. Pergunte o dia e o mês ao cliente (ex.: "17/02") e me chame de novo. NÃO diga a ele que já agendei.`,
    };

  const horaHhmm = normalizarHora(hora ?? "");
  if (!horaHhmm)
    return {
      ok: false,
      motivo: hora
        ? `"${hora}" não é um horário. Pergunte a hora exata ("9h ou 10h30?") — "de manhã" não dá para agendar.`
        : `falta a HORA. Consulte os horários livres desse dia e ofereça DUAS opções ao cliente.`,
    };

  const em = combinarDataHora(dataIso, horaHhmm);
  if (!em) return { ok: false, motivo: `não consegui montar ${dataIso} às ${horaHhmm}. Confirme a data e a hora com o cliente.` };

  if (em.getTime() <= agora.getTime())
    return {
      ok: false,
      motivo: `${formatarBr(em)} já passou (agora é ${formatarBr(agora)}). Pergunte outra data ao cliente.`,
    };

  if (fechado(em))
    return {
      ok: false,
      motivo: `${formatarBr(em)} é domingo, e a imobiliária não abre. Ofereça o sábado antes ou a segunda depois — diga qual, não pergunte "que outro dia?".`,
    };

  const h = em.getHours();
  const fecha = fechaAs(em);
  if (h < HORA_ABRE || h >= fecha)
    return {
      ok: false,
      motivo:
        em.getDay() === 6
          ? `sábado a imobiliária atende só até ${doisDigitos(HORA_FECHA_SABADO)}:00, e ${horaHhmm} está fora disso. Ofereça um horário da manhã de sábado, ou outro dia à tarde.`
          : `${horaHhmm} está fora do horário de atendimento (${doisDigitos(HORA_ABRE)}:00 às ${doisDigitos(fecha)}:00). Ofereça um horário dentro dessa faixa.`,
    };

  // Antecedência mínima: alguém precisa pegar a chave e chegar lá.
  if (em.getTime() - agora.getTime() < ANTECEDENCIA_MIN_MS)
    return {
      ok: false,
      motivo: `${formatarBr(em)} é cedo demais — a equipe precisa de pelo menos 2 horas para separar a chave. Ofereça o primeiro horário depois disso.`,
    };

  return { ok: true, em, dataIso, horaHhmm };
}

// Domingo a imobiliária não abre. Sábado abre só de manhã.
//
// Não está em lib/agenda.ts porque `horariosDoDia()` monta a grade sem olhar o
// dia da semana — a TELA pode oferecer domingo, porque ali tem uma pessoa
// decidindo e às vezes um corretor encaixa mesmo. A IA não tem esse
// discernimento: ela ofereceria domingo às 8h com a maior naturalidade, e o
// cliente ia até um imóvel de porta fechada.
export function fechado(d: Date): boolean {
  return d.getDay() === 0;
}

// Sábado fecha ao meio-dia. `HORA_FECHA` (19h) continua valendo de segunda a
// sexta — vem de lib/agenda.ts, que é da tela e não se mexe.
export const HORA_FECHA_SABADO = 12;

export function fechaAs(d: Date): number {
  return d.getDay() === 6 ? HORA_FECHA_SABADO : HORA_FECHA;
}

// Duas horas de antecedência, no mínimo.
//
// Alguém precisa pegar a chave e se deslocar. Sem isto a IA marca para daqui a
// trinta minutos porque o horário "está livre" na grade — e livre na grade não
// é o mesmo que possível na vida.
export const ANTECEDENCIA_MIN_MS = 2 * 60 * 60 * 1000;

// A mesma chave não sai duas vezes ao mesmo tempo.
//
// O cliente fica com ela três a quatro horas. Isso NÃO bloqueia a agenda toda —
// outro corretor pode mostrar outro imóvel no mesmo horário —, mas o MESMO
// imóvel não pode receber duas visitas dentro dessa janela: a chave é uma só, e
// duas pessoas na mesma porta é o pior jeito de descobrir isso.
export const JANELA_CHAVE_MS = 4 * 60 * 60 * 1000;

// Feriados nacionais. A IA NÃO OFERECE feriado — mas aceita, se o cliente pedir:
// é decisão de quem atende, e um corretor pode muito bem topar.
//
// Só os nacionais. Feriado municipal varia por cidade e o sistema não tem onde
// guardar isso; quando tiver, é aqui que entra. Enquanto isso, a IA pode
// oferecer o aniversário da cidade — o cliente pede outro dia e ninguém morre.
export function feriado(d: Date): string | null {
  const mes = d.getMonth() + 1;
  const dia = d.getDate();
  const fixos: Record<string, string> = {
    "1-1": "Confraternização Universal",
    "4-21": "Tiradentes",
    "5-1": "Dia do Trabalho",
    "9-7": "Independência",
    "10-12": "Nossa Senhora Aparecida",
    "11-2": "Finados",
    "11-15": "Proclamação da República",
    "12-25": "Natal",
  };
  const fixo = fixos[`${mes}-${dia}`];
  if (fixo) return fixo;

  // Móveis, ancorados na Páscoa. Carnaval e Corpus Christi são ponto
  // facultativo no papel e feriado na prática: ninguém abre imobiliária.
  const pascoa = domingoDePascoa(d.getFullYear());
  const moveis: [number, string][] = [
    [-48, "Carnaval"],
    [-47, "Carnaval"],
    [-2, "Sexta-feira Santa"],
    [60, "Corpus Christi"],
  ];
  for (const [desloca, nome] of moveis) {
    const alvo = new Date(pascoa);
    alvo.setDate(alvo.getDate() + desloca);
    if (alvo.getMonth() === d.getMonth() && alvo.getDate() === d.getDate()) return nome;
  }
  return null;
}

// Algoritmo de Meeus/Jones/Butcher. Está aqui inteiro, e não numa dependência,
// porque são doze linhas e uma biblioteca a mais para calcular a Páscoa não se
// paga.
function domingoDePascoa(ano: number): Date {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}

export function formatarBr(d: Date): string {
  return `${doisDigitos(d.getDate())}/${doisDigitos(d.getMonth() + 1)} às ${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

// Os horários da grade que sobram depois de descontar o que já está ocupado.
//
// Encostar não é conflito: uma visita das 14:00 por 30 min deixa as 14:30
// livres — é a mesma regra de `conflita`, e é o que permite agendar em sequência.
export function horariosLivres(
  ocupadas: { em: Date; duracaoMin: number }[],
  dia: Date,
  duracaoMin: number = DURACAO_PADRAO_MIN,
  agora?: Date
): string[] {
  // Domingo não tem vaga nenhuma — quem varre dia a dia simplesmente pula.
  if (fechado(dia)) return [];
  // Sábado corta ao meio-dia. Feriado NÃO é cortado aqui: quem decide não
  // oferecer feriado é quem oferece (consultar_horarios_visita), porque marcar
  // em feriado continua permitido se o cliente pedir.
  const fecha = fechaAs(dia);
  return horariosDoDia()
    .filter((h) => Number(h.slice(0, 2)) < fecha)
    .filter((h) => {
      const em = combinarDataHora(
        `${dia.getFullYear()}-${doisDigitos(dia.getMonth() + 1)}-${doisDigitos(dia.getDate())}`,
        h
      );
      if (!em) return false;
      // A MESMA antecedência de `interpretarDataHora`, e tem que ser a mesma:
      // oferecer um horário que o agendamento vai recusar é a IA se corrigindo
      // na frente do cliente, que é onde ele para de confiar.
      if (agora && em.getTime() - agora.getTime() < ANTECEDENCIA_MIN_MS) return false;
      return !ocupadas.some((o) => conflita({ em, duracaoMin }, o));
    });
}

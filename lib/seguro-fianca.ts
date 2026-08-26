// Simulação do seguro-fiança — a peneira que vem logo depois da triagem, ANTES
// de qualquer imóvel ser mostrado.
//
// A ordem aqui é a coisa toda. Mandar opções para quem não vai passar no seguro
// gasta o tempo dele e o do corretor, e a recusa chega depois de ele já ter
// escolhido um apartamento e se imaginado morando nele. Rodar a simulação
// primeiro custa cinco minutos e, quando reprova, ainda dá tempo de tentar no
// nome de um familiar ou de ir ao proprietário propor outra garantia — tudo
// isso antes de o cliente criar expectativa com um imóvel específico.
//
// Isto vale SÓ para o comercial de locação. Compra e venda tem financiamento,
// que é outro processo (lib/qualificacao.ts), e a administração da carteira não
// tem nada a ver com isso.

export type StatusSimulacao = "PENDENTE" | "APROVADO" | "REPROVADO";

// ─── CPF ────────────────────────────────────────────────────────────────────

export function apenasDigitos(v: string): string {
  return (v ?? "").replace(/\D/g, "");
}

// Confere o CPF pelos dígitos verificadores. Vale a pena validar aqui: um CPF
// digitado errado só aparece como "reprovado" lá na seguradora, horas depois, e
// o cliente entende isso como "meu nome está sujo" — quando era um dígito.
export function cpfValido(entrada: string): boolean {
  const cpf = apenasDigitos(entrada);
  if (cpf.length !== 11) return false;
  // 111.111.111-11 e afins passam na conta dos dígitos, mas não são CPF.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (ate: number): number => {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(cpf[i]) * (ate + 1 - i);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(9) === Number(cpf[9]) && digito(10) === Number(cpf[10]);
}

export function formatarCpf(entrada: string): string {
  const c = apenasDigitos(entrada);
  if (c.length !== 11) return entrada;
  return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
}

// ─── Data de nascimento ─────────────────────────────────────────────────────

// O cliente escreve a data como quiser: "15/03/1990", "15-03-1990",
// "1990-03-15". Recusar por causa do formato é jogar de volta para ele um
// problema que é nosso.
export function lerNascimento(entrada: string): Date | null {
  const v = (entrada ?? "").trim();
  let a: number, m: number, d: number;

  const br = v.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  const iso = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (br) [d, m, a] = [Number(br[1]), Number(br[2]), Number(br[3])];
  else if (iso) [a, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else return null;

  const data = new Date(a, m - 1, d);
  // getMonth de volta pega 31/02: o Date acomoda em 03/03 sem reclamar.
  if (data.getFullYear() !== a || data.getMonth() !== m - 1 || data.getDate() !== d) return null;
  return data;
}

export function idadeEm(nascimento: Date, agora = new Date()): number {
  let idade = agora.getFullYear() - nascimento.getFullYear();
  const mes = agora.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && agora.getDate() < nascimento.getDate())) idade--;
  return idade;
}

// ─── Validação do conjunto ──────────────────────────────────────────────────

export type DadosSimulacao = {
  nomeCompleto: string;
  cpf: string;
  nascimento: string;
  telefone: string;
  email: string;
};

export type Validacao = { ok: true; nascimento: Date } | { ok: false; erros: string[] };

// Os cinco dados que a seguradora pede. Faltando um, a simulação não roda — e é
// melhor a IA descobrir isso na conversa, onde ela pode perguntar de novo, do
// que a equipe descobrir na tela de simulações com o cliente esperando.
export function validarDados(d: Partial<DadosSimulacao>): Validacao {
  const erros: string[] = [];

  const nome = (d.nomeCompleto ?? "").trim();
  // Nome COMPLETO: a seguradora consulta por nome + CPF, e só o primeiro nome
  // não identifica ninguém.
  if (nome.split(/\s+/).filter(Boolean).length < 2) erros.push("nome completo (nome e sobrenome)");

  if (!cpfValido(d.cpf ?? "")) erros.push("CPF válido");

  const nasc = lerNascimento(d.nascimento ?? "");
  if (!nasc) erros.push("data de nascimento");
  else if (idadeEm(nasc) < 18) erros.push("titular maior de 18 anos");
  else if (idadeEm(nasc) > 120) erros.push("data de nascimento plausível");

  if (apenasDigitos(d.telefone ?? "").length < 10) erros.push("telefone com DDD");

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((d.email ?? "").trim())) erros.push("e-mail válido");

  return erros.length > 0 ? { ok: false, erros } : { ok: true, nascimento: nasc! };
}

// ─── As mensagens ───────────────────────────────────────────────────────────

// Fixa de propósito: é a mensagem que explica POR QUE a IA está pedindo CPF e
// data de nascimento de alguém que só queria ver um apartamento. Pedir dado
// pessoal sem essa explicação é o momento em que o cliente desconfia e some.
//
// Ela vem logo depois da triagem, ANTES de qualquer imóvel ser mostrado — por
// isso fala da CARTEIRA, e não de "esse imóvel que você escolheu": nesse ponto
// da conversa o cliente ainda não escolheu nada.
export const PEDIDO_DE_DADOS = [
  "A maioria dos imóveis da nossa carteira é por seguro fiança, então antes de te mandar as opções eu vou pegar alguns dados pra fazer a simulação e ver se aprova, até mesmo pra não te fazer perder tempo com imóvel que não vai dar certo — e se não aprovar, dá pra eu conversar com o proprietário pra ver se ele aceita algum outro modelo de garantia, ok?",
  "Preciso desses dados:\n\nNome completo\nCPF\nData de nascimento\nTelefone\nE-mail",
].join("\n\n");

export const AGUARDE = "Perfeito, já mandei pra simulação. Aguarda uns 5 minutinhos que assim que der o retorno eu te falo aqui 👍🏼";

export const APROVADO = [
  "Boaa, deu tudo certo!",
  "Seu nome foi aprovado no seguro 🎉",
].join("\n\n");

// Reprovado NÃO é o fim: é a hora de pedir um familiar. O tom importa —
// "reprovado" é uma palavra pesada para quem está procurando onde morar, e
// tratar como um detalhe operacional é o que mantém a conversa viva.
export const REPROVADO = [
  "Oi! Voltou a simulação aqui.",
  "O seu nome não passou dessa vez, mas isso é bem comum e tem solução: dá pra fazer no nome de outra pessoa da família.",
  "Tem alguém — pai, mãe, irmão, cônjuge — que possa entrar como titular? Se tiver, me manda o nome completo, CPF, data de nascimento, telefone e e-mail dessa pessoa que eu já simulo.",
].join("\n\n");

// ─── A trava ────────────────────────────────────────────────────────────────

export type EstadoSeguro = {
  temSimulacao: boolean;
  status: StatusSimulacao | null;
};

// Pode seguir o funil — mostrar imóveis, mandar fotos, marcar visita? Só com
// simulação APROVADA. É trava de verdade, não instrução no prompt: o prompt é
// conselho, e a IA sob pressão do cliente ("mas eu só quero ver o
// apartamento") cede ao conselho.
//
// A trava fica ANTES de mostrar imóvel, não antes da visita. É a diferença
// entre o cliente descobrir que não passa no seguro agora, quando ainda é uma
// conversa, e descobrir depois de ter escolhido um apartamento e se imaginado
// morando nele.
export function podeSeguirFunil(e: EstadoSeguro): { pode: boolean; motivo: string | null } {
  if (!e.temSimulacao)
    return {
      pode: false,
      motivo:
        "a simulação do seguro-fiança ainda não foi feita. Peça os dados (nome completo, CPF, data de nascimento, telefone e e-mail) e registre a simulação antes de mostrar qualquer imóvel.",
    };
  if (e.status === "PENDENTE")
    return { pode: false, motivo: "a simulação do seguro-fiança ainda está aguardando o retorno." };
  if (e.status === "REPROVADO")
    return {
      pode: false,
      motivo:
        "a simulação foi reprovada. Peça os dados de outra pessoa da família para simular no nome dela.",
    };
  return { pode: true, motivo: null };
}

export const ROTULO_STATUS: Record<StatusSimulacao, { texto: string; tom: "amber" | "green" | "red" }> = {
  PENDENTE: { texto: "Aguardando retorno", tom: "amber" },
  APROVADO: { texto: "Aprovado", tom: "green" },
  REPROVADO: { texto: "Reprovado", tom: "red" },
};

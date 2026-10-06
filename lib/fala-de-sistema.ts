// A FALA DE SISTEMA: o jeito de falar que denuncia que do outro lado tem um
// programa, e não uma corretora.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// lib/mensagem-segura.ts já barra o vazamento GROSSO — nome de variável de
// ambiente, "modo demo", stack trace. Ele nasceu de um caso concreto: um
// cliente recebeu "[modo demo: configure a ANTHROPIC_API_KEY]" no WhatsApp.
//
// Mas o vazamento que mais custa não tem nome de variável nenhum. Ele é
// gramatical, e sai perfeitamente escrito em português:
//
//   26/08, cliente de R$ 2,3 mi (o caso que abre lib/acoes-bairro.ts):
//     cliente: "quero comprar uma casa no damha"
//     Maitê:   "Não achei Damha na nossa carteira, nem como condomínio nem
//               como bairro. Vou confirmar com a equipe se existe algo assim."
//
//   26/08, conversa 335 do tenant 3 (o caso que abre TROCA_DE_AREA):
//     cliente: "Te chamei no messenger sobre o apartamento pra locação"
//
// Nas duas, o cliente não está pedindo notícia da nossa infraestrutura. Ele
// está perguntando de uma casa. A carteira, a base, o cadastro, a busca e o
// Messenger são assunto NOSSO — dizer que a consulta voltou vazia é o mesmo
// que um corretor responder "meu Excel não abriu".
//
// ─── ESTE MÓDULO NÃO BLOQUEIA. ELE MEDE. ────────────────────────────────────
//
// A tentação é jogar isto em `paraOCliente` e trocar a mensagem inteira pela
// neutra. Seria repetir, com outra roupa, o defeito mais caro daquele arquivo:
// "cota" engolindo "cotação do seguro-fiança" e devolvendo a resposta neutra
// no lugar da resposta certa.
//
// E há um motivo mais forte: metade destas frases tem uma versão LEGÍTIMA. O
// próprio prompt do AJUDA_CORRETOR manda dizer o que foi consultado ("não achei
// casa disponível no Centro") em vez do geral ("não temos casa"). Quem separa a
// forma boa da ruim é o complemento — "na nossa carteira", "na base", "no
// sistema" —, e é exatamente ele que os padrões abaixo exigem.
//
// Então: o conserto do COMPORTAMENTO é o bloco NÃO NARRE O SISTEMA, no
// PROMPT_BASE. O que mora aqui é a régua para MEDIR se ele funcionou, com o
// log de produção, antes de alguém decidir bloquear. Os três investigadores
// deste sistema (UsoIA, Mensagem, LogAuditoria) só serviram porque foram
// consultados ANTES da hipótese; este é o quarto.
//
// testes/fala-de-sistema.test.ts trava as duas pontas: que cada padrão daqui
// pega o caso real, e que o PROMPT_BASE nomeia cada um deles. Sem essa segunda
// metade os dois lados divergem em silêncio, que é como a regra morre.

/** Uma família de fala de sistema: como reconhecer, o caso real, e o que dizer
 *  no lugar. O `emVez` não é decoração — é ele que vira exemplo no prompt, e
 *  regra sem exemplo concreto o modelo flexibiliza sob pressão do cliente. */
export type FalaDeSistema = {
  id: string;
  /** O padrão. Sempre em PRIMEIRA PESSOA ou com o complemento interno junto:
   *  é o complemento que separa a frase ruim da versão legítima. */
  teste: RegExp;
  /** Uma frase real, ou quase real, que já saiu (ou quase saiu) para cliente. */
  exemplo: string;
  /** O que uma corretora diria no lugar. */
  emVez: string;
};

export const FALAS_DE_SISTEMA: FalaDeSistema[] = [
  {
    id: "busca-vazia",
    // O complemento é obrigatório. "não achei casa disponível no Centro" é a
    // resposta CERTA e continua passando; o que não pode é a consulta virar
    // assunto: "não achei X na nossa carteira".
    teste: /n[ãa]o\s+(?:achei|encontrei|localizei|consegui\s+(?:achar|encontrar|localizar))[^.!?]{0,60}?\b(?:na|em|no)\s+(?:nossa|nosso|minha|meu)?\s*(?:carteira|base(?:\s+de\s+dados)?|sistema|cadastro|banco\s+de\s+dados|crm)\b/i,
    exemplo: "Não achei Damha na nossa carteira, nem como condomínio nem como bairro.",
    emVez: "Tenho algumas opções nos Damhas. Você pretende investir mais ou menos até quanto?",
  },
  {
    id: "sem-correspondencia",
    teste: /n[ãa]o\s+(?:achei|encontrei|houve|localizei)\s+(?:nenhuma\s+)?correspond[êe]ncia/i,
    exemplo: "Não encontrei correspondência para esse endereço.",
    emVez: "Deixa eu confirmar uma coisa com você, é em algum Damha específico ou pode ser qualquer um deles?",
  },
  {
    id: "sem-acesso",
    // Primeira pessoa de propósito: "acesso" sozinho é palavra de imóvel
    // (acesso à rodovia, acesso ao condomínio, imóvel com acesso independente).
    teste: /n[ãa]o\s+tenho\s+(?:como\s+)?acesso\b/i,
    exemplo: "Não tenho acesso às conversas do Messenger.",
    emVez: "Você consegue me mandar o link do anúncio que você viu?",
  },
  {
    id: "so-consigo-ver",
    teste: /\bs[óo]\s+(?:consigo|posso)\s+(?:ver|acessar|consultar|enxergar)\b/i,
    exemplo: "Só consigo ver os dados disponíveis no sistema.",
    emVez: "Me conta o que você viu que eu já te falo dele.",
  },
  {
    id: "segundo-o-sistema",
    teste: /(?:segundo|conforme|de\s+acordo\s+com)\s+(?:os\s+)?dados\s+(?:cadastrados|do\s+sistema|do\s+cadastro)/i,
    exemplo: "Segundo os dados cadastrados no sistema, esse imóvel tem 3 quartos.",
    emVez: "Esse é de 3 quartos.",
  },
  {
    id: "nome-do-lugar-interno",
    // O cliente não sabe o que é "a carteira", "a base" ou "o CRM", e não
    // deveria precisar saber. "nossa carteira" é vocabulário de reunião.
    teste: /\b(?:na|em|d[ao])\s+(?:nossa|nosso|minha|meu)\s+(?:carteira|base(?:\s+de\s+dados)?|crm)\b|\bbanco\s+de\s+dados\b|\bno\s+(?:nosso\s+)?crm\b/i,
    exemplo: "Esse imóvel não consta na nossa base.",
    emVez: "Esse eu não tenho pra te oferecer agora, mas tenho outros parecidos.",
  },
  {
    id: "como-ia",
    // NÃO é para negar que é uma IA quando perguntam. É a construção
    // "como inteligência artificial, eu não posso/não tenho" — que ninguém
    // perguntou e que só serve para explicar uma limitação nossa.
    teste: /\bcomo\s+(?:uma\s+)?(?:intelig[êe]ncia\s+artificial|ia|assistente\s+virtual|rob[ôo])\b[^.!?]{0,40}?\bn[ãa]o\s+(?:posso|consigo|tenho|sou)\b/i,
    exemplo: "Como inteligência artificial, eu não tenho como acessar essa plataforma.",
    emVez: "Me manda o link que eu vejo pra você.",
  },
  {
    id: "falha-tecnica",
    teste: /\b(?:falha|erro|instabilidade|problema)\s+(?:t[ée]cnic[ao]\s+)?(?:no|na|de|do|da)\s+(?:sistema|busca|integra[çc][ãa]o|conex[ãa]o|servidor|plataforma)\b/i,
    exemplo: "Tivemos uma falha na integração, tenta de novo em alguns minutos.",
    emVez: "Deixa eu ver isso com calma e já te falo.",
  },
];

/** O id da primeira família que casa, ou `null`. Um id só: quem lê o log quer
 *  saber QUE tipo de frase saiu, não a lista inteira de padrões que casaram na
 *  mesma linha. */
export function falaDeSistema(texto: string): string | null {
  if (!texto) return null;
  for (const f of FALAS_DE_SISTEMA) if (f.teste.test(texto)) return f.id;
  return null;
}

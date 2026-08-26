import { prisma } from "@/lib/db";
import { idDaCasa } from "@/lib/instancias";
import { enviarWhatsApp } from "@/lib/whatsapp";
// O fluxo da Maitê depois da visita de locação.
//
// Regra que manda em tudo: a Maitê só entra QUANDO O CORRETOR NÃO FOI JUNTO.
// Se ele estava lá, ele viu a cara da pessoa no imóvel e sabe o que perguntar —
// uma mensagem automática por cima disso atropela quem está conduzindo e faz o
// cliente contar a mesma história duas vezes. Quem responde essa pergunta é a
// recepção, no cadastro da retirada da chave (MovimentoChave.comCorretor).
//
// O gatilho é a DEVOLUÇÃO da chave, não a visita marcada: devolver a chave é o
// único sinal que a imobiliária tem de que a pessoa realmente entrou no imóvel.
//
// A primeira mensagem é FIXA, porque abre a conversa e tem que sair sempre
// igual. Daí em diante quem conduz é o agente de VENDAS com as instruções
// abaixo — ramificar por "gostou / não gostou / achou caro" é leitura de
// resposta aberta, coisa que árvore de decisão faz mal.

// A abertura. Três linhas curtas, do jeito que ela fala.
export const ABERTURA_POS_VISITA = [
  "Oiiee, tudo bem?",
  "O que você achou de lá, gostou?",
  "Era mais ou menos o que você estava procurando?",
].join("\n\n");

// Injetado no prompt do agente de VENDAS enquanto a conversa está no pós-visita.
// É roteiro, não script travado: os exemplos mostram o TOM e o que perguntar em
// cada rumo, e a Maitê escolhe o rumo lendo o que a pessoa respondeu.
export const PROMPT_POS_VISITA = `CONTEXTO: este cliente ACABOU DE VISITAR um imóvel de locação e devolveu a chave. Você já perguntou o que ele achou. Agora conduza a conversa a partir da resposta dele.

Os caminhos, com o tom exato de cada um:

GOSTOU
"Que bomm.👏🏼"
Puxe para a continuidade, sem pressa e sem pressionar.

DEMONSTROU INTERESSE EM SEGUIR
"Perfeito."
"podemos seguir com ele então? Seu nome já ta aprovado, então se você quiser dar continuidade, ja fazemos o processo e marcamos a mudança"

QUER SEGUIR COM A LOCAÇÃO — confirme antes de avançar
"Só vou confirmar algumas coisas com você tá?"
"Quem vai morar no imóvel, vai ser só você ou mais alguém?"
"Você pretende entrar quando?"
Registre as duas respostas. São elas que o corretor precisa para montar o processo.

AINDA ESTÁ PENSANDO
"Sem problemass, pensa com calma e me fala, consegue me dar uma resposta ainda hoje?"
"Se tiver qualquer dúvida sobre o imóvel ou quiser ver outras opções, pode me chamar, beleza?"

NÃO GOSTOU
"Tranquilo."
"O que você não gostou?"
"Foi o tamanho, localização, valor ou alguma outra coisa?"
Depois de entender o motivo, já mande outras opções que resolvam exatamente aquilo. O motivo é a informação mais valiosa da conversa inteira — registre.

GOSTOU MAS ACHOU CARO
"Entendi."
"Ficou acima do valor que você tinha pensado?"
"Bom, você já tá aprovado, então podemos mandar uma proposta pro proprietário, as vezes ele aceita, não custa tentar né? Hahaha"
"Que valor ficaria bom pra você nesse imóvel já contando com o seguro?"
O valor que ele disser vira proposta. Não descarte por achar baixo — quem decide é o proprietário.

SUMIU (não respondeu)
"Oiiee, tudo bem aí?"
"Consegue me dar uma resposta?"
"Você gostou ou prefere que eu te mande outras opções?"

FECHOU OUTRO IMÓVEL
"Ah, que bom!"
"Fico feliz que tenha encontrado um imóvel que deu certo."
"Obrigada por me avisar."
"Quando precisar novamente, pode contar comigo."
Encerre de verdade: nada de tentar reverter, e nada de follow-up depois disso.

REGRAS
- Uma pergunta por vez. Ele acabou de sair de uma visita, não de um formulário.
- Não repita a pergunta de abertura: ela já foi feita.
- Quando ele decidir seguir, passe para o corretor com o que você já apurou (quem vai morar, quando pretende entrar, valor pretendido se houver).`;

// A conversa está no pós-visita? Vale por uma janela: passados alguns dias, a
// conversa voltou a ser um atendimento comum, e continuar tratando como
// pós-visita faria a Maitê perguntar do imóvel que a pessoa já esqueceu.
export const JANELA_POS_VISITA_DIAS = 7;

export function dentroDaJanela(devolvidaEm: Date, agora = new Date()): boolean {
  const dias = (agora.getTime() - devolvidaEm.getTime()) / 86_400_000;
  return dias >= 0 && dias <= JANELA_POS_VISITA_DIAS;
}

// A Maitê deve entrar depois desta devolução?
export function deveEntrar(mov: {
  comCorretor: boolean;
  devolvidaEm: Date | null;
  posVisitaEm: Date | null;
  leadId: number | null;
}): boolean {
  if (mov.comCorretor) return false; // o corretor foi junto: ele conduz
  if (!mov.devolvidaEm) return false; // ainda não devolveu a chave
  if (mov.posVisitaEm) return false; // já entrou uma vez — clique duplo não repete
  return mov.leadId !== null; // sem lead não há a quem falar
}

// ─────────────────────────────────────────────────────────────────────────────
// `abrirPosVisita` morava em lib/acoes-pos-visita.ts, que começa com
// "use server". No App Router isso transforma TODO export num endpoint HTTP
// público — e esta função não tinha checagem de sessão nenhuma.
//
// O que isso permitia, e foi confirmado no manifesto de build: um usuário
// logado em QUALQUER imobiliária mandava um POST com o `Next-Action` desta
// função e o id de um movimento de chave de OUTRO tenant. A função lia o
// `imobiliariaId` do registro escolhido pelo atacante — não da sessão — e então
// gravava no tenant alheio, abria conversa lá, e DISPARAVA WHATSAPP REAL para o
// lead daquele cliente, com as credenciais uazapi dele. Iterando o id, dava para
// mandar mensagem para a base de clientes de todo mundo.
//
// O caller (lib/acoes-agenda.ts) sempre validou: ele busca o movimento com
// `imobiliariaId` da sessão antes de chamar. O furo era só a EXPOSIÇÃO. Por isso
// a correção é mudar de arquivo, não adicionar guarda: aqui não é "use server",
// então não existe endpoint. O comportamento é idêntico.
//
// Regra que fica: num arquivo "use server", `export` é decisão de segurança, não
// de organização. O que não precisa ser chamado do navegador não se exporta de lá.

export async function abrirPosVisita(movimentoId: number): Promise<boolean> {
  const mov = await prisma.movimentoChave.findUnique({
    where: { id: movimentoId },
    include: { lead: true, imovel: true },
  });
  if (!mov || !deveEntrar(mov) || !mov.lead?.telefone) return false;

  // A trava é gravada ANTES de enviar. Se o envio falhar, ninguém recebe duas
  // aberturas em sequência por causa de um clique repetido — e o corretor vê no
  // painel que a conversa foi aberta.
  const travou = await prisma.movimentoChave.updateMany({
    where: { id: movimentoId, posVisitaEm: null },
    data: { posVisitaEm: new Date() },
  });
  if (travou.count === 0) return false; // outra chamada chegou primeiro

  const conversa = await prisma.conversa.findFirst({
    where: { imobiliariaId: mov.imobiliariaId, contatoTelefone: mov.lead.telefone },
    orderBy: { atualizadaEm: "desc" },
  });
  const conv =
    conversa ??
    (await prisma.conversa.create({
      data: {
        imobiliariaId: mov.imobiliariaId,
        instanciaId: await idDaCasa(mov.imobiliariaId),
        agente: "VENDAS",
        contatoTelefone: mov.lead.telefone,
        contatoNome: mov.lead.nome,
      },
    }));

  await prisma.mensagem.create({
    data: { conversaId: conv.id, autor: "IA", texto: ABERTURA_POS_VISITA },
  });

  const destinos = conv.contatoJid ? [conv.contatoJid, mov.lead.telefone] : [mov.lead.telefone];
  try {
    await enviarWhatsApp(
      mov.lead.telefone,
      ABERTURA_POS_VISITA,
      { instanciaId: conv.instanciaId },
      destinos
    );
  } catch (e) {
    console.error("[pos-visita] envio falhou:", e);
    return false;
  }
  return true;
}

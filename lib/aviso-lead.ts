// O aviso ao corretor de plantão: "caiu um lead, e é assim que você aborda".
//
// ─── O PEDIDO ───────────────────────────────────────────────────────────────
//
// Do dono: "quando cair um lead, após algumas conversas do lead com a IA, uma
// mensagem deve ser enviada para um número cadastrado, com um template fixo,
// falando de onde caiu esse lead, o número dele, o nome do cliente, qual o
// interesse, e um pequeno histórico da conversa, para o corretor ter noção de
// como abordar o cliente".
//
// O que existia até aqui: o card mudava de coluna no painel. Ou seja, o sinal
// de que a Maitê tinha terminado dependia de alguém estar OLHANDO a tela. À
// noite, no fim de semana, no meio de uma visita — o lead mais quente do dia
// esfriava sem ninguém saber que ele existia.
//
// ─── TEMPLATE FIXO, E NÃO A IA ──────────────────────────────────────────────
//
// Mesma decisão de lib/abordagem-portal.ts, pelos mesmos motivos, mais um que
// só vale aqui: o corretor vai LER isto correndo, entre um compromisso e outro.
// Um resumo escrito pelo modelo muda de forma a cada lead, e o olho perde o
// hábito de achar o telefone sempre no mesmo lugar. Campo fixo, ordem fixa.
//
// E tem o custo: isto roda no meio do fechamento da qualificação, que já está
// dentro de uma chamada de LLM. Uma segunda chamada aqui põe latência no
// caminho em que o cliente está esperando resposta no WhatsApp.
//
// ─── O QUE NÃO ENTRA ────────────────────────────────────────────────────────
//
// `Lead.notasInternas` NÃO entra, e não é esquecimento: é anotação da equipe
// sobre a pessoa ("a cliente não gostou de nada"), e este texto sai por WhatsApp
// — o canal mais fácil de encaminhar para o grupo errado. E-mail e CPF também
// ficam de fora: nada aqui depende deles, e o que não é preciso mandar não se
// manda. O que vai é o que responde "como eu abordo essa pessoa".
//
// Nenhuma credencial, nenhum id interno de instância, nenhum token: o texto é
// montado só a partir do que a própria equipe já vê no painel do lead.

import { prisma } from "@/lib/db";
import { auditar } from "@/lib/auditoria";
import { rotuloDaOrigem } from "@/lib/etiqueta-origem";
import { idDaCasa } from "@/lib/instancias";
import { log } from "@/lib/log";
import { linkWhatsApp, telefoneValido } from "@/lib/telefone";
import { enviarWhatsApp } from "@/lib/whatsapp";

// ── O texto ─────────────────────────────────────────────────────────────────

export type DadosDoAviso = {
  nome: string;
  /** O telefone do LEAD, como está gravado. `null` some da mensagem. */
  telefone: string | null;
  /** A origem gravada (VIVAREAL, SITE, FACEBOOK…) — vira rótulo legível. */
  origem: string | null;
  /** "COMPRA" ou "LOCACAO". */
  finalidade: string | null;
  /** O imóvel ou empreendimento de interesse, já em uma linha. */
  interesse: string | null;
  /** `resumo()` de lib/qualificacao, quando existe ficha. O PLACAR. */
  qualificacao: string | null;
  /** O que a pessoa efetivamente respondeu, pergunta por pergunta
   *  (`fichaRespondida()`). É o que o corretor precisa para ligar sabendo com
   *  quem fala — o placar sozinho não diz nada sobre o lead. */
  ficha?: { rotulo: string; valor: string }[] | null;
  /** Memória da IA, ou recorte das últimas falas do cliente. */
  historico: string | null;
};

const ROTULO_FINALIDADE: Record<string, string> = {
  COMPRA: "Compra",
  LOCACAO: "Locação",
};

/** Quanto do histórico cabe antes de virar parede de texto no celular. */
export const LIMITE_HISTORICO = 420;

/**
 * Corta sem partir palavra no meio e sem prometer que acabou.
 *
 * As reticências não são enfeite: sem elas o corretor lê uma frase truncada
 * como se fosse a frase inteira, e "não tenho condição de dar entrada" vira
 * "não tenho condição".
 */
export function encurtar(texto: string, limite = LIMITE_HISTORICO): string {
  const limpo = texto.trim();
  if (limpo.length <= limite) return limpo;
  const corte = limpo.slice(0, limite);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > limite * 0.6 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

/**
 * O "pequeno histórico" que o dono pediu.
 *
 * PREFERE A MEMÓRIA DA IA, e essa é a decisão que importa. `Conversa.memoria` é
 * o resumo que o modelo já mantém do contato — ele diz o que a pessoa QUER, e
 * já custou o token que custou. Colar mensagem crua no lugar dele entrega ao
 * corretor "oi", "sim", "pode ser" e uma foto: as últimas mensagens de uma
 * conversa que fechou bem são justamente as menos informativas dela.
 *
 * O recorte de falas do cliente é o plano B, para a conversa curta demais para
 * ter gerado resumo (a memória só é escrita a partir de um número de mensagens).
 * Só falas do CLIENTE: repetir o que a IA disse ocupa o espaço com o que o
 * corretor já sabe que foi dito.
 *
 * Pura de propósito — é o que permite provar os dois caminhos sem banco.
 */
export function historicoDoLead(
  memoria: string | null | undefined,
  falasDoCliente: string[]
): string | null {
  if (memoria?.trim()) return encurtar(memoria);
  const falas = falasDoCliente
    .map((f) => f.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    // Nada de "ok"/"sim" sozinhos: ocupam linha e não dizem nada.
    .filter((f) => f.length > 3);
  if (falas.length === 0) return null;
  return encurtar(falas.map((f) => `"${f}"`).join("\n"));
}

/**
 * Monta a mensagem. Pura: é o que a tela de Configurações pode mostrar como
 * prévia e o que o teste confere sem banco.
 *
 * LINHA QUE FALTA SOME INTEIRA — não vira "Interesse: —". Um rótulo com buraco
 * do lado obriga o leitor a decidir se aquilo é ausência de dado ou defeito da
 * mensagem, e ele decide isso a cada lead. Sem a linha, o que está escrito é o
 * que se sabe.
 *
 * O CÓDIGO DO IMÓVEL ENTRA AQUI, ao contrário de lib/abordagem-portal.ts, e a
 * diferença é quem lê: lá é o cliente, que reconhece "o apartamento no Centro";
 * aqui é o corretor, que vai digitar o código na busca do sistema.
 */
export function textoDoAviso(d: DadosDoAviso): string {
  const linhas: string[] = ["Novo lead qualificado pela IA.", ""];

  linhas.push(`Nome: ${d.nome.trim() || "não informado"}`);
  if (d.telefone?.trim()) linhas.push(`Telefone: ${d.telefone.trim()}`);
  linhas.push(`Veio de: ${rotuloDaOrigem(d.origem)}`);

  // Finalidade e interesse na MESMA linha: são a mesma pergunta ("o que essa
  // pessoa quer") e separá-las faria o corretor ler duas para montar uma.
  const finalidade = d.finalidade ? ROTULO_FINALIDADE[d.finalidade.toUpperCase()] : null;
  const interesse = [finalidade, d.interesse?.trim()].filter(Boolean).join(" · ");
  if (interesse) linhas.push(`Interesse: ${interesse}`);

  if (d.qualificacao?.trim()) linhas.push(`Qualificação: ${d.qualificacao.trim()}`);

  // ── O QUE A PESSOA RESPONDEU ────────────────────────────────────────────
  //
  // Até 21/08/2026 esta seção não existia e a mensagem trazia só o placar
  // ("8/14 perguntas · Faixa 2"). O corretor recebia a contagem do trabalho da
  // IA em vez do resultado dele: nada de entrada, renda, vínculo ou estado
  // civil. Quem ia ligar tinha de abrir o sistema para saber com quem falava —
  // e o aviso existe justamente para não precisar disso.
  //
  // Uma linha por resposta, na ordem em que foram perguntadas: é a ordem da
  // conversa, então bate com o histórico logo abaixo e dá para conferir sem
  // procurar.
  if (d.ficha?.length) {
    linhas.push("", "O que ele respondeu:");
    for (const item of d.ficha) linhas.push(`· ${item.rotulo}: ${item.valor}`);
  }

  if (d.historico?.trim()) linhas.push("", "Como foi a conversa:", d.historico.trim());

  // O link fecha a mensagem porque é a ÚNICA parte acionável dela. O corretor
  // que já leu o resto não precisa procurar o telefone para copiar: toca aqui e
  // está falando com a pessoa. Some quando o telefone não dá um link válido —
  // um wa.me quebrado abre "número inválido" e gasta a única ação que existe.
  const link = linkWhatsApp(d.telefone);
  if (link) linhas.push("", `Chamar no WhatsApp: ${link}`);

  return linhas.join("\n");
}

// ── O envio ─────────────────────────────────────────────────────────────────

export type ResultadoAviso =
  | { feito: "enviado"; texto: string }
  /** Não era caso de avisar (sem número cadastrado, já avisado, conta bloqueada…). */
  | { feito: "nao"; motivo: string };

/**
 * Avisa o corretor de plantão sobre o lead que acabou de fechar a qualificação.
 *
 * NUNCA JOGA. É chamada no mesmo instante da entrega ao corretor
 * (lib/distribuicao.ts), que por sua vez roda logo depois de a qualificação ter
 * sido GRAVADA: uma exceção aqui subiria pela ferramenta da IA e derrubaria a
 * resposta que o cliente está esperando no WhatsApp. Aviso perdido é um
 * telefonema a menos; resposta perdida é o cliente falando sozinho.
 *
 * `agora` entra por parâmetro para o teste não depender do relógio.
 */
export async function avisarCorretorDoLead(
  leadId: number,
  { agora = new Date() }: { agora?: Date } = {}
): Promise<ResultadoAviso> {
  try {
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: {
        id: true,
        imobiliariaId: true,
        nome: true,
        telefone: true,
        origem: true,
        finalidade: true,
        avisoCorretorEm: true,
        imovel: { select: { codigo: true, tipo: true, bairro: true, cidade: true } },
        empreendimento: { select: { nome: true, bairro: true, cidade: true } },
        qualificacao: true,
        imobiliaria: {
          select: { avisoLeadTelefone: true, bloqueadaEm: true },
        },
      },
    });
    if (!lead) return { feito: "nao", motivo: "lead não existe" };

    // O DESLIGADO. Nenhum número cadastrado é o estado de TODO tenant no dia em
    // que esta migration sobe, e ele não é erro nem aviso: é a casa que ainda
    // não pediu isso. Sai antes de qualquer consulta a mais.
    const destino = lead.imobiliaria.avisoLeadTelefone?.trim();
    if (!destino) return { feito: "nao", motivo: "nenhum número cadastrado" };

    // Número gravado antes desta validação existir, ou colado com um dígito a
    // menos. Vale um log — é configuração quebrada, e o sintoma sem ele seria a
    // dona jurando que cadastrou e nunca recebendo nada. O NÚMERO não vai no
    // log: log de produção é lido por mais gente do que a tela onde ele foi
    // digitado.
    if (!telefoneValido(destino)) {
      log.warn("aviso-lead: telefone de plantão inválido", {
        leadId,
        imobiliariaId: lead.imobiliariaId,
      });
      return { feito: "nao", motivo: "número cadastrado é inválido" };
    }

    // Mesma regra de lib/abordagem-portal.ts: conta bloqueada continua
    // recebendo lead, mas o sistema não fala em nome de quem está suspenso.
    if (lead.imobiliaria.bloqueadaEm) return { feito: "nao", motivo: "imobiliária bloqueada" };

    if (lead.avisoCorretorEm) return { feito: "nao", motivo: "aviso já enviado" };

    // ── A TRAVA, tomada ANTES do envio ──────────────────────────────────────
    //
    // `updateMany` com `avisoCorretorEm: null` no WHERE é a reserva atômica: de
    // duas passadas simultâneas — e elas acontecem, porque a ferramenta da IA é
    // rechamada a cada resposta do cliente — exatamente uma acerta uma linha.
    // A leitura logo acima não bastaria: as duas leriam null antes de qualquer
    // uma escrever, e o corretor receberia a mensagem em duplicata.
    const reserva = await prisma.lead.updateMany({
      where: { id: lead.id, avisoCorretorEm: null },
      data: { avisoCorretorEm: agora },
    });
    if (reserva.count !== 1) return { feito: "nao", motivo: "aviso já enviado" };

    const texto = textoDoAviso({
      nome: lead.nome,
      telefone: lead.telefone,
      origem: lead.origem,
      finalidade: lead.finalidade,
      interesse: descreverInteresse(lead.imovel, lead.empreendimento),
      qualificacao: await resumoDaQualificacao(lead.qualificacao),
      ficha: await fichaDaQualificacao(lead.qualificacao),
      historico: await historicoDaConversa(lead.id, lead.imobiliariaId, lead.telefone),
    });

    // Sai pelo número DA CASA. Não pelo do corretor dono do lead: quem recebe é
    // um corretor, e um corretor recebendo aviso do próprio número é uma
    // conversa consigo mesmo, que o WhatsApp nem entrega direito.
    const envio = await enviarWhatsApp(destino, texto, {
      instanciaId: await idDaCasa(lead.imobiliariaId),
    });

    if (!envio.enviado && envio.provedor !== "demo") {
      // DEVOLVE A TRAVA. Sem isto, a única tentativa que este lead teria na vida
      // seria a que falhou — e a próxima resposta do cliente, que reentra por
      // aqui, não conseguiria mais avisar ninguém. Best-effort: se o rollback
      // falhar, o pior caso é o lead nunca ser avisado, que é o mesmo estado em
      // que ele já está.
      await prisma.lead
        .updateMany({ where: { id: lead.id, avisoCorretorEm: agora }, data: { avisoCorretorEm: null } })
        .catch(() => {});
      log.warn("aviso-lead: envio falhou", {
        leadId,
        provedor: envio.provedor,
        detalhe: envio.detalhe,
      });
      return { feito: "nao", motivo: `envio falhou: ${envio.provedor}` };
    }

    // O tenant vai EXPLÍCITO: não há sessão nenhuma aqui (isto roda dentro de um
    // webhook), e sem o argumento a linha nasceria com imobiliariaId nulo — /
    // auditoria filtra estritamente pelo tenant e ela não apareceria para
    // ninguém. Sem o telefone de destino no texto: a trilha é lida na tela por
    // quem já pode ver o cadastro, e repetir o número ali só multiplica cópias.
    await auditar(
      "AVISO_LEAD_CORRETOR",
      "Lead",
      lead.id,
      `${lead.nome} · ${rotuloDaOrigem(lead.origem)}`,
      lead.imobiliariaId
    );

    return { feito: "enviado", texto };
  } catch (e) {
    // A promessa do cabeçalho, cumprida em um lugar só.
    log.error("aviso-lead: falhou", { leadId, erro: e instanceof Error ? e.message : String(e) });
    return { feito: "nao", motivo: "erro inesperado" };
  }
}

/**
 * "O que essa pessoa quer ver", em uma linha.
 *
 * O empreendimento tem precedência sobre o imóvel porque é o interesse mais
 * específico que existe na ficha: na planta não há unidade ainda, então um lead
 * apontado para o prédio está apontado para o produto inteiro.
 */
function descreverInteresse(
  imovel: { codigo: string; tipo: string; bairro: string | null; cidade: string } | null,
  empreendimento: { nome: string; bairro: string | null; cidade: string } | null
): string | null {
  if (empreendimento) {
    const onde = empreendimento.bairro || empreendimento.cidade;
    return onde ? `${empreendimento.nome} (${onde})` : empreendimento.nome;
  }
  if (imovel) {
    const onde = imovel.bairro || imovel.cidade;
    return `${imovel.tipo}${onde ? ` no ${onde}` : ""} (${imovel.codigo})`;
  }
  return null;
}

/** O resumo de uma linha da ficha de financiamento, quando ela existe. */
/** As respostas da ficha, para o corpo do aviso. Import tardio pelo mesmo
 *  motivo da função abaixo: `lib/qualificacao` puxa a régua inteira do MCMV e
 *  este arquivo roda no caminho de uma resposta que o cliente está esperando. */
async function fichaDaQualificacao(
  qualificacao: unknown
): Promise<{ rotulo: string; valor: string }[] | null> {
  if (!qualificacao) return null;
  const { respostasDaQualificacao, fichaRespondida } = await import("@/lib/qualificacao");
  const ficha = fichaRespondida(
    respostasDaQualificacao(qualificacao as Parameters<typeof respostasDaQualificacao>[0])
  );
  return ficha.length ? ficha : null;
}

async function resumoDaQualificacao(qualificacao: unknown): Promise<string | null> {
  if (!qualificacao) return null;
  // Import tardio pelo mesmo motivo do resto do arquivo chamador: lib/qualificacao
  // é grande e só faz sentido carregar quando há ficha.
  const { respostasDaQualificacao, resumo } = await import("@/lib/qualificacao");
  return resumo(respostasDaQualificacao(qualificacao as Parameters<typeof respostasDaQualificacao>[0]));
}

/**
 * O histórico, buscado no banco.
 *
 * Entra por `Conversa.leadId`, que é a ligação forte, e só cai no telefone
 * quando ela não existe — conversa aberta antes da FK, ou pelo número da casa
 * antes de o lead existir. É a mesma ordem de preferência que o painel do lead
 * usa; casar só por telefone é o que fazia abrir a conversa errada.
 */
async function historicoDaConversa(
  leadId: number,
  imobiliariaId: number,
  telefone: string | null
): Promise<string | null> {
  const conversa =
    (await prisma.conversa.findFirst({
      where: { leadId },
      orderBy: { atualizadaEm: "desc" },
      select: { id: true, memoria: true },
    })) ??
    (telefone
      ? await prisma.conversa.findFirst({
          where: { imobiliariaId, contatoTelefone: telefone },
          orderBy: { atualizadaEm: "desc" },
          select: { id: true, memoria: true },
        })
      : null);
  if (!conversa) return null;
  if (conversa.memoria?.trim()) return historicoDoLead(conversa.memoria, []);

  // Sem memória: as últimas falas do cliente, em ordem de leitura. `take` no
  // desc + reverse, e não asc, porque o que interessa é o FIM da conversa e a
  // tabela de mensagens é a maior do sistema.
  const falas = await prisma.mensagem.findMany({
    where: { conversaId: conversa.id, autor: "CLIENTE" },
    orderBy: { criadaEm: "desc" },
    take: 4,
    select: { texto: true },
  });
  return historicoDoLead(null, falas.map((m) => m.texto).reverse());
}

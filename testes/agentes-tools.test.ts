// Critérios de aceite do M3: o mapa de ferramentas por agente e a economia de
// contexto que ele produz. As tools são construídas dentro de toolsPorAgente
// (função interna), então aqui a verificação é sobre o ARQUIVO — é o que trava
// uma remoção intencional de voltar por descuido num merge.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { agentesAtivos, PRODUTOS } from "@/lib/planos";
import { areaQueDeveriaAtender } from "@/lib/agentes";

const fonte = readFileSync(new URL("./agentes.ts", import.meta.url), "utf8");

// Extrai o array de tools de um agente no mapa retornado por toolsPorAgente.
function toolsDe(agente: string): string[] {
  const m = fonte.match(new RegExp(`^\\s*${agente}: \\[([^\\]]*)\\]`, "m"));
  if (!m) throw new Error(`agente ${agente} não encontrado no mapa`);
  return m[1]!
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

describe("mapa de ferramentas por agente", () => {
  it("RECEPCAO só direciona", () => {
    expect(toolsDe("RECEPCAO")).toEqual(["direcionarAtendimento"]);
  });

  it("VENDAS tem exatamente 4 tools: ela para na COLETA", () => {
    // Decisão do dono em 10/08: "ela para na coleta de dados". Agendar visita
    // era o principal resultado dela até então; agora o resultado é a ficha
    // cheia, e quem marca compromisso é a equipe, na agenda.
    const t = toolsDe("VENDAS");
    // 6 = as 4 da coleta + as DUAS de passagem, que entraram em 26/08: a saída
    // de área (o assunto mudou) e a entrega ao corretor (ele pediu a visita).
    // Nenhuma das duas faz o trabalho da área: elas dizem de quem ele é. O teto
    // continua valendo para o que ela FAZ no assunto dela — a agenda segue fora.
    expect(t).toHaveLength(6);
    // A ordem conta a história do gesto: consultar horário vem ANTES de
    // agendar, porque a IA PROPÕE o horário mais próximo em vez de perguntar
    // "quando você pode?" e descobrir o conflito depois. Remarcar e cancelar
    // vêm logo atrás porque escrevem na mesma linha que agendar cria.
    expect(t).toEqual([
      "direcionarAtendimento",
      "buscarImoveisDisponiveis",
      "enviarFotosImovel",
      "registrarLead",
      "simularSeguroFianca",
      "passarParaCorretor",
    ]);
    // As quatro de agenda saíram em 10/08; proposta e fechamento já estavam fora.
    for (const fora of [
      "consultarHorariosTool",
      "agendarVisitaTool",
      "remarcarVisitaTool",
      "cancelarVisitaTool",
      "solicitarFechamento",
      "registrarProposta",
    ])
      expect(t, fora).not.toContain(fora);
    expect(t).not.toContain("consultarMercado");
  });

  it("COMPRA_VENDA qualifica e entrega, sem fechar negócio", () => {
    const t = toolsDe("COMPRA_VENDA");
    expect(t).toEqual([
      "direcionarAtendimento",
      "buscarImoveisVenda",
      // Entrou em 18/08: o cliente perguntou o nome de um condomínio e a IA
      // respondeu o campo `bairro` do imóvel, que guardava o loteamento. Sem
      // uma ferramenta que saiba o que É condomínio, ela só podia adivinhar.
      "condominiosDaCarteira",
      "buscarEmpreendimentos",
      "enviarFotosImovel",
      "registrarInteresseCompra",
      "qualificarComprador",
      "registrarDocumentos",
      "enviarBookEmpreendimento",
      "passarParaCorretor",
    ]);
    // Mesma decisão de 10/08 do agente de locação: a agenda saiu inteira.
    for (const fora of [
      "consultarHorariosTool",
      "agendarVisitaTool",
      "remarcarVisitaTool",
      "cancelarVisitaTool",
      "registrarPropostaCompra",
      "consultarMercado",
    ])
      expect(t, fora).not.toContain(fora);
  });

  it("nenhum agente comercial mexe na AGENDA", () => {
    // Agendar sem poder remarcar é a origem da conversa morta: "consigo mudar
    // para sexta?" é a mensagem mais comum depois do agendamento. E consultar
    // sem agendar oferece horário que ninguém marca. Ou entram as três, ou o
    // percurso até a visita fica pela metade.
    for (const agente of ["VENDAS", "COMPRA_VENDA"]) {
      const t = toolsDe(agente);
      for (const tool of [
        "consultarHorariosTool",
        "agendarVisitaTool",
        "remarcarVisitaTool",
        "cancelarVisitaTool",
      ]) {
        expect(t, `${agente} · ${tool}`).not.toContain(tool);
      }
    }
  });

  it("a qualificação de financiamento é SÓ do agente de compra e venda", () => {
    // Empreendimento e financiamento são conversa de compra. Locação não pede
    // holerite nem extrato de FGTS.
    for (const agente of ["RECEPCAO", "VENDAS", "CAPTACAO", "ADMINISTRACAO", "AJUDA_CORRETOR"]) {
      expect(toolsDe(agente)).not.toContain("qualificarComprador");
      expect(toolsDe(agente)).not.toContain("registrarDocumentos");
      expect(toolsDe(agente)).not.toContain("buscarEmpreendimentos");
      expect(toolsDe(agente)).not.toContain("enviarBookEmpreendimento");
    }
  });

  it("consultar_mercado existe SÓ em CAPTACAO", () => {
    for (const agente of ["RECEPCAO", "VENDAS", "COMPRA_VENDA", "ADMINISTRACAO", "AJUDA_CORRETOR"]) {
      expect(toolsDe(agente)).not.toContain("consultarMercado");
    }
    expect(toolsDe("CAPTACAO")).toContain("consultarMercado");
  });

  it("CAPTACAO capta, e agora também MOSTRA a carteira", () => {
    const t = toolsDe("CAPTACAO");
    // `enviarProcuracaoTool` entrou em 03/08: a procuração é o PRIMEIRO
    // documento do fluxo — o proprietário autoriza a imobiliária a alugar o
    // imóvel dele — e quem capta é a Maitê. Deixar isso para uma tela é deixar
    // a casa anunciando imóvel sem autorização escrita do dono.
    //
    // `buscarImoveisDisponiveis` entrou em 10/08, a pedido do dono: "ela precisa
    // mostrar os imóveis na carteira". A última linha deste teste PROIBIA isso,
    // com o argumento de que captação não vende. O argumento não se sustentou na
    // prática: o proprietário pergunta o que já temos na região e por quanto, e
    // a captação terminava a frase em "vou confirmar com a equipe" — largando o
    // melhor argumento de captação que existe em cima da mesa.
    expect(t).toEqual([
      "direcionarAtendimento",
      "buscarImoveisDisponiveis",
      "cadastrarProprietario",
      "cadastrarImovel",
      "cadastrarImovelVenda",
      "enviarProcuracaoTool",
      "agendarAvaliacao",
      "consultarMercado",
    ]);
    // O que ela continua NÃO fazendo: conduzir quem quer alugar. Mostrar a
    // carteira é argumento de captação; atender o inquilino é VENDAS.
    for (const fora of ["registrarLead", "simularSeguroFianca", "agendarVisitaTool"])
      expect(t, fora).not.toContain(fora);
  });

  it("ADMINISTRACAO atende os DOIS lados (as 4 do locatário + as 4 do proprietário)", () => {
    // As 4 últimas são a intermediação com o proprietário (M4), que é o que o
    // módulo Administração promete e antes não existia.
    //
    // `enviarCobrancaAoLocatario` entrou em 03/08: a fatura nascia sem cobrança
    // emitida no gateway, e a 2ª via respondia "cobrança sendo emitida" para
    // sempre porque nada emitia. Ela é a única ferramenta da IA que GASTA
    // dinheiro do cliente (cada emissão é um registro cobrado no Asaas) — por
    // isso exige a forma escolhida e não emite as duas.
    // As QUATRO ÚLTIMAS entraram em 10/08 (item 16, "faça tudo isso e deixa
    // funcional"): são as perguntas que chegam toda semana e que ela respondia
    // com "vou confirmar com a equipe".
    expect(toolsDe("ADMINISTRACAO")).toEqual([
      "direcionarAtendimento",
      "enviarSegundaVia",
      "enviarCobrancaAoLocatario",
      "abrirOcorrencia",
      "consultarPendencias",
      "consultarRepasse",
      "consultarSituacaoImovel",
      "aprovarOrcamento",
      "notificarProprietario",
      "consultarIptu",
      "consultarAcordo",
      "agendarVistoria",
      "consultarReajuste",
    ]);
  });

  it("nenhuma das novas aceita apontar QUAL contrato", () => {
    // Do outro lado está o CLIENTE. Um parâmetro de contrato aqui seria deixá-lo
    // consultar o contrato de outra pessoa escrevendo outro número — e as quatro
    // leem dinheiro, dívida e histórico do imóvel.
    const fonte = readFileSync("lib/agentes.ts", "utf8");
    for (const tool of ["consultar_iptu", "consultar_acordo", "consultar_reajuste"]) {
      const bloco = fonte.slice(fonte.indexOf(`name: "${tool}"`));
      const ateOFim = bloco.slice(0, bloco.indexOf("\n  });"));
      expect(ateOFim, tool).toContain("ctx.conversa.pessoaId");
      expect(ateOFim, tool).toMatch(/properties: {}/);
    }
  });

  it("o pedido de vistoria NÃO grava uma vistoria feita", () => {
    // `Vistoria` guarda o LAUDO de uma vistoria que aconteceu. Criar uma linha
    // lá com a data de hoje registraria vistoria que não houve, e o laudo em
    // branco viraria histórico falso do imóvel. Pedido é ocorrência.
    const fonte = readFileSync("lib/agentes.ts", "utf8");
    const bloco = fonte.slice(fonte.indexOf(`name: "agendar_vistoria"`));
    const ateOFim = bloco.slice(0, bloco.indexOf("\n  });"));
    expect(ateOFim).toContain("prisma.ocorrencia.create");
    expect(ateOFim).not.toContain("prisma.vistoria.create");
  });

  it("AJUDA_CORRETOR segue o mapa", () => {
    // A busca em parceiras entra SÓ aqui. É informação interna: quem recebe é a
    // equipe, que decide o que fazer. O cliente continua recebendo só imóvel da
    // casa — por isso ela não aparece em VENDAS nem em COMPRA_VENDA.
    //
    // As três últimas entraram em 10/08: até então ele só CONSULTAVA, e o
    // corretor tinha que abrir o sistema para registrar o que acabara de
    // acontecer na rua — que é justamente quando ninguém registra.
    //
    // `resumoDaCarteira` e `leadsRecentes` entraram em 12/08, as duas por
    // resposta ERRADA em produção, não por pedido de função nova:
    //   · "quantas casas temos?" → "não temos nenhuma casa disponível na
    //     carteira" com 5 casas DISPONIVEL. Contagem estava caindo na
    //     ferramenta de BUSCA, que lista no máximo 20 e volta vazia sem filtro;
    //   · "temos leads hoje?" → "não tenho acesso a um sistema de leads", e
    //     ali ela estava certa: `minha_agenda` é de VISITAS, e nada lia `Lead`.
    expect(toolsDe("AJUDA_CORRETOR")).toEqual([
      "buscarImoveisCorretor",
      "resumoDaCarteira",
      "leadsRecentes",
      "detalhesImovel",
      "enviarFotosImovel",
      "buscarEmParceirosTool",
      "minhaAgendaTool",
      "atualizarStatusLead",
      "anotarNoLead",
    ]);
  });

  it("as ferramentas de CRM do corretor exigem QUAL lead", () => {
    // A armadilha desta fatia, e a razão de existirem ferramentas novas em vez
    // de reaproveitar as de cliente: nas conversas de cliente o lead é achado
    // pelo telefone de quem fala. No Ajuda Corretor quem fala é o CORRETOR —
    // sem `telefoneLead` obrigatório, o sistema procuraria um lead com o
    // telefone dele e, quando ele também fosse cliente da casa, escreveria na
    // ficha errada.
    const fonte = readFileSync("lib/agentes.ts", "utf8");
    for (const tool of ["atualizar_status_lead", "anotar_no_lead"]) {
      const bloco = fonte.slice(fonte.indexOf(`name: "${tool}"`));
      const ateOFim = bloco.slice(0, bloco.indexOf("});"));
      expect(ateOFim, tool).toMatch(/required: \[[^\]]*"telefoneLead"/);
    }
  });

  it("o corretor da agenda vem do TELEFONE da conversa, não de um nome digitado", () => {
    // Deixar o corretor dizer de quem é a agenda seria deixá-lo ler a agenda de
    // qualquer colega escrevendo outro nome.
    const fonte = readFileSync("lib/agentes.ts", "utf8");
    const bloco = fonte.slice(fonte.indexOf('name: "minha_agenda"'));
    const ateOFim = bloco.slice(0, bloco.indexOf("\n  });"));
    expect(ateOFim).toContain("ctx.conversa.contatoTelefone");
    expect(ateOFim).toContain("ctx.conversa.imobiliariaId");
    // E o tenant nunca vem do que ele digita.
    expect(ateOFim).not.toMatch(/input\.(imobiliaria|tenant)/);
  });

  it("parceiras NÃO aparecem para o cliente", () => {
    for (const agente of ["RECEPCAO", "VENDAS", "COMPRA_VENDA", "CAPTACAO", "ADMINISTRACAO"])
      expect(toolsDe(agente), agente).not.toContain("buscarEmParceirosTool");
  });
});

describe("custo de contexto do VENDAS", () => {
  // Este bloco existia como "economia": o M3 tinha tirado registrar_proposta e
  // consultar_mercado de VENDAS e devolvido simular_seguro_fianca, fechando em
  // 6 contra 7 originais. A agenda inverte o sinal, e isso fica ESCRITO em vez
  // de silenciosamente ajustado — o número é uma decisão, não um placar.
  const TOKENS_POR_TOOL = 184; // estimativa do doc por schema de ferramenta

  it("tirar a agenda devolveu 920 tokens por turno ao VENDAS", () => {
    // A conta ao contrário da que estava aqui. Eram 9 ferramentas; a agenda e o
    // fechamento saíram em 10/08 e sobraram 4. Cinco a menos em TODO turno de
    // TODA conversa de locação, que é o contexto mais quente do sistema.
    const antes = 9;
    // Duas ferramentas voltaram para a conta em 26/08, e as duas se pagam: sem
    // `direcionar_atendimento`, quem chegava aqui querendo comprar ouvia "um
    // atendente vai entrar em contato" e o turno era perdido inteiro; sem
    // `passar_para_corretor`, quem pedia visita não era entregue a ninguém
    // (medido: 0 avisos ao corretor em 321 leads).
    const agora = toolsDe("VENDAS").length - 2;
    expect(antes - agora).toBe(5);
    expect((antes - agora) * TOKENS_POR_TOOL).toBe(920);
    // Por que vale: sem consultar_horarios a IA aceita qualquer horário que o
    // cliente disser e o conflito só aparece na hora de abrir a porta; sem
    // remarcar/cancelar, a visita marcada é imutável e o cliente que quer mudar
    // não tem para onde ir. 552 tokens é mais barato que um corretor deslocado
    // à toa.
  });

  it("VENDAS e COMPRA_VENDA continuam abaixo do teto de 12 ferramentas", () => {
    // Não há limite duro na API, mas acima de ~12 o modelo começa a errar a
    // escolha da ferramenta com mais frequência — e estes dois agentes rodam em
    // Sonnet. É o número que dispara a conversa "o que sai daqui?".
    for (const agente of ["VENDAS", "COMPRA_VENDA"]) {
      expect(toolsDe(agente).length, agente).toBeLessThanOrEqual(12);
    }
  });
});

describe("destinos da recepção", () => {
  it("NAO_CONTRATADO existe como destino", () => {
    expect(fonte).toContain("NAO_CONTRATADO");
  });

  it("o enum de áreas é montado a partir dos agentes ativos", () => {
    // Não pode ser uma lista fixa: cliente sem módulo não pode receber o destino.
    expect(fonte).toContain("enum: areasDisponiveis");
    expect(fonte).toMatch(/const ativos = agentesAtivos\(ctx\.modulos, ctx\.addons\)/);
  });

  it("cliente de Recepção não tem VENDAS entre os agentes ativos", () => {
    expect(agentesAtivos(PRODUTOS.RECEPCAO.modulos)).not.toContain("VENDAS");
  });

  it("cliente sem add-on não tem CAPTACAO", () => {
    expect(agentesAtivos(PRODUTOS.COMPLETO.modulos, PRODUTOS.COMPLETO.addons)).not.toContain(
      "CAPTACAO"
    );
    expect(agentesAtivos(PRODUTOS.COMPLETO.modulos, ["CAPTACAO"])).toContain("CAPTACAO");
  });
});

describe("prompts não prometem ferramenta que não existe mais", () => {
  const prompts = fonte.slice(fonte.indexOf("const PROMPTS"));

  it("VENDAS não promete NADA que ela não alcança mais", () => {
    // Prompt que manda chamar ferramenta que saiu do array vira promessa não
    // cumprida — o erro mais caro que já apareceu neste sistema.
    const vendas = prompts.slice(prompts.indexOf("VENDAS: `"), prompts.indexOf("ADMINISTRACAO: `"));
    for (const some of [
      "registrar_proposta",
      "solicitar_fechamento",
      "agendar_visita",
      "consultar_horarios_visita",
    ])
      expect(vendas, some).not.toContain(some);
    expect(vendas).toContain("SEU TRABALHO TERMINA NA COLETA");
    // O pedido de visita passa por FERRAMENTA desde 26/08. Prometer que "a
    // equipe entra em contato" sem chamá-la é a promessa que não chega a
    // ninguém — foi assim que 321 leads não geraram um aviso sequer.
    expect(vendas).toMatch(/chame passar_para_corretor NA MESMA RESPOSTA/);
    expect(vendas).toMatch(/um corretor entra em contato para combinar o dia e o horário/);
  });

  it("a Recepção é instruída a não revelar o limite comercial", () => {
    const recepcao = prompts.slice(prompts.indexOf("RECEPCAO: `"), prompts.indexOf("CAPTACAO: `"));
    expect(recepcao).toContain("NAO_CONTRATADO");
    expect(recepcao).toMatch(/[Nn]unca mencione plano, módulo/);
    // A frase que a recepção NÃO diz mais nesse caminho: até 26/08 o prompt
    // mandava anunciar que "um atendente da equipe vai continuar", enquanto a
    // ferramenta já respondia "NÃO ESCREVA NADA" — e entre duas ordens opostas o
    // modelo segue a mais próxima, que era a do prompt. O cliente ouvia uma
    // promessa de retorno que ninguém tinha feito.
    expect(recepcao).not.toMatch(/diga apenas que um atendente/);
  });
});

describe("Minha Casa Minha Vida é condição de financiamento, não catálogo à parte", () => {
  // O caso real, no WhatsApp de cliente: "Quero comprar um apartamento pelo
  // minha casa minha vida" e a Maitê respondeu que "isso é programa do governo"
  // e que "aqui a gente trabalha com imóveis de mercado, não com Minha Casa
  // Minha Vida" — recusando um comprador de primeiro imóvel, que é o lead mais
  // decidido que entra.
  //
  // O erro não foi de roteamento (isso o PISTAS_COMPRA já resolvia) nem do
  // prompt de COMPRA_VENDA, que trata MCMV com profundidade. Foi de CONHECIMENTO,
  // num agente que não carrega aquele texto. Por isso a definição mora no
  // PROMPT_BASE, que TODOS compartilham: o assunto aparece na recepção e na
  // locação, não só na compra.
  const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("const PROMPTS"));

  it("a definição está na base compartilhada, não só no agente de compra", () => {
    expect(base).toContain("MINHA CASA MINHA VIDA");
    expect(base).toMatch(/CONDIÇÃO DE FINANCIAMENTO/);
  });

  it("desmente as três frases que fizeram a IA recusar o cliente", () => {
    // Cada uma apareceu, literalmente, na conversa que motivou isto.
    expect(base).toContain("não trabalha com Minha Casa Minha Vida");
    expect(base).toContain("isso é programa do governo");
    expect(base).toMatch(/PROIBIDO/);
  });

  it("diz que o programa se aplica a imóvel da NOSSA carteira", () => {
    // A confusão de fundo: tratar MCMV como um estoque separado, de outro lugar.
    expect(base).toMatch(/imóvel COMUM de mercado/);
    expect(base).toMatch(/nossa carteira/i);
  });

  it("o enquadramento é da PESSOA; do imóvel, só o teto", () => {
    expect(base).toMatch(/quem define o enquadramento é a PESSOA/i);
    expect(base).toMatch(/teto/i);
  });

  it("sem COMPRA_VENDA contratada, encaminha calado — não nega o programa", () => {
    // A saída errada seria trocar "não trabalhamos com MCMV" por uma recusa
    // igualmente falsa; o combinado do produto é encaminhar sem expor limite.
    expect(base).toMatch(/SEM nunca dizer que não trabalhamos com o programa/);
  });
});

describe("MCMV não é só lançamento, e busca vazia não encerra conversa", () => {
  // O caso real: comprador qualificado na faixa até R$350 mil ouviu "não achei
  // nenhum LANÇAMENTO com 3 quartos perto da represa" e, na mesma bolha, um
  // pedido de documentos. Três defeitos de uma vez — só olhou empreendimento,
  // tratou busca vazia como fim de papo, e pediu holerite a quem acabara de
  // ouvir que não havia imóvel.
  //
  // A causa da primeira: a instrução pós-qualificação citava `faixaMcmv`, que é
  // parâmetro de buscar_empreendimentos. A IA lia aquilo como "procure
  // lançamento" e nunca tocava na carteira pronta.
  const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("const PROMPTS"));
  // COMPRA_VENDA é o ÚLTIMO do mapa — fatiar até AJUDA_CORRETOR devolvia vazio,
  // e um slice vazio faz o teste passar por engano em toda asserção `not`.
  const compra = fonte.slice(fonte.indexOf("COMPRA_VENDA: `${PROMPT_BASE}"));

  it("o programa vale para casa e apartamento PRONTOS, não só na planta", () => {
    expect(base).toMatch(/NÃO é só de lançamento/i);
    expect(base).toMatch(/CASA e APARTAMENTO, PRONTOS ou na planta/);
  });

  it("o que é exclusivo do não-entregue é a ENTRADA PARCELADA, não o programa", () => {
    // Confundir as duas coisas é o que fez a IA achar que pronto não entra.
    expect(base).toMatch(/PARCELAMENTO DA ENTRADA/);
    expect(base).toMatch(/não tira o imóvel pronto do programa/);
  });

  it("a instrução pós-qualificação manda buscar nos DOIS lugares", () => {
    expect(fonte).toContain("busque nos DOIS lugares antes de responder");
    expect(fonte).toMatch(/buscar_imoveis_venda \(valorMaximo=\$\{teto\}/);
    expect(fonte).toMatch(/E buscar_empreendimentos \(precoMaximo=\$\{teto\}/);
  });

  it("proíbe responder 'nenhum lançamento' a quem pediu um imóvel", () => {
    expect(fonte).toMatch(/nunca em "nenhum lançamento"/);
    expect(base).toMatch(/a pessoa não pediu lançamento, pediu um imóvel/);
  });

  it("busca vazia manda ALARGAR antes de responder", () => {
    expect(compra).toMatch(/BUSCA VAZIA NÃO ENCERRA CONVERSA/);
    expect(compra).toMatch(/ALARGUE antes de responder/);
  });

  it("não emenda 'não achei nada' com pedido de documento", () => {
    // Foi exatamente a bolha que o cliente recebeu.
    expect(compra).toMatch(/NUNCA emende "não achei nada" com o pedido de documentos/);
  });

  it("a foto é oferecida, não esperada", () => {
    expect(compra).toMatch(/OFEREÇA a foto você, não espere pedirem/);
  });
});

describe("a visita marcada pela IA existe para a equipe", () => {
  // O buraco: `agendar_visita` gravava só `Lead.visitaEm` e o status. A linha
  // `Visita` — a que aparece em /agenda, tem corretor, duração e recebe
  // COMPARECEU/FALTOU — só nascia pela tela. O cliente combinava, a IA
  // confirmava, e ninguém da equipe ficava sabendo: ele chegava no imóvel e não
  // tinha quem abrisse a porta.
  //
  // O âncora de fim tem que ser a PRÓXIMA declaração, sempre. Era
  // `registrarProposta`; quando remarcar/cancelar entraram no meio, o slice
  // engoliu as duas e os `not` daqui passaram a olhar código de outra
  // ferramenta — que é como um teste já passou por engano antes (ver o
  // comentário do COMPRA_VENDA lá embaixo). Se inserir algo entre
  // `agendarVisitaTool` e `visitaFuturaDaConversa`, mova este âncora junto.
  const tool = fonte.slice(
    fonte.indexOf("const agendarVisitaTool"),
    fonte.indexOf("async function visitaFuturaDaConversa")
  );

  it("cria a linha Visita, não só carimba o lead", () => {
    expect(tool).toMatch(/prisma\.visita\.create/);
    expect(tool).not.toMatch(/visitaEm: new Date\(input\.data\)/);
  });

  it("a HORA é obrigatória — um dia inteiro não é compromisso", () => {
    expect(tool).toMatch(/required: \["data", "hora"\]/);
    expect(tool).toMatch(/OBRIGATÓRIA/);
  });

  it("a data passa pelo parser, nunca por new Date solto", () => {
    // `new Date("17/02/2026")` é Invalid Date, e o cliente escreve assim.
    expect(tool).toMatch(/interpretarDataHora\(input\.data, input\.hora/);
    expect(tool).toMatch(/if \(!quando\.ok\) return `NÃO agendei: \$\{quando\.motivo\}`/);
  });

  it("nasce sem corretor, que é o gesto da tela", () => {
    // "o corretor puxa para si a visita que estava sem dono" (acoes-agenda.ts)
    expect(tool).not.toMatch(/corretorId:/);
    expect(tool).toMatch(/sem corretor/);
  });

  it("não marca duas visitas para o mesmo cliente", () => {
    expect(tool).toMatch(/JÁ tem visita marcada/);
    expect(tool).toMatch(/status: \{ not: "CANCELADA" \}/);
  });

  it("recusa imóvel indisponível em vez de mandar o cliente até lá", () => {
    expect(tool).toMatch(/não está mais disponível/);
    expect(tool).toMatch(/status !== "DISPONIVEL"/);
  });

  it("as três travas que já existiam continuam de pé", () => {
    for (const trava of ["travaSeguroLocacao", "empreendimentoId", "proximaPergunta"])
      expect(tool, trava).toContain(trava);
  });

  it("a auditoria leva o tenant e aponta para a Visita", () => {
    // Antes ia sem imobiliariaId e apontando para "Lead". A tela /auditoria
    // filtra por tenant: nenhum agendamento da IA aparecia na trilha de ninguém.
    expect(tool).toMatch(/"VISITA_AGENDADA_IA",\s*"Visita"/);
    expect(tool).toMatch(/ctx\.conversa\.imobiliariaId\s*\)/);
  });

  it("usa o mesmo mapa de status da tela, não um literal", () => {
    expect(tool).toMatch(/statusDoLead\("AGENDADA"\)/);
    expect(tool).not.toMatch(/status: "VISITA_AGENDADA"/);
  });
});

describe("feriado: não oferece, mas aceita", () => {
  const tool = fonte.slice(
    fonte.indexOf("const consultarHorariosTool"),
    fonte.indexOf("const agendarVisitaTool")
  );

  it("a varredura pula feriado junto com domingo", () => {
    expect(tool).toMatch(/if \(fechado\(dia\) \|\| feriado\(dia\)\)/);
  });

  it("mas quem PEDE o feriado é atendido, e avisado que é feriado", () => {
    // A regra é só não OFERECER — quem atende decide, e um corretor pode topar.
    // Recusar seria a IA inventando uma política que a imobiliária não tem.
    expect(tool).toMatch(/é feriado, mas se o cliente pediu esse dia, tudo bem/);
    expect(tool).toMatch(/para ninguém ser pego de surpresa/);
  });

  it("marcar em feriado não é barrado no agendamento", () => {
    const agendar = fonte.slice(
      fonte.indexOf("const agendarVisitaTool"),
      fonte.indexOf("async function visitaFuturaDaConversa")
    );
    expect(agendar).not.toMatch(/feriado/);
  });
});

describe("a chave é uma só", () => {
  const helper = fonte.slice(
    fonte.indexOf("// A MESMA chave não sai duas vezes"),
    fonte.indexOf("// A agenda é DA IMOBILIÁRIA")
  );
  const agendar = fonte.slice(
    fonte.indexOf("const agendarVisitaTool"),
    fonte.indexOf("async function visitaFuturaDaConversa")
  );

  it("a janela é do MESMO imóvel, não da agenda inteira", () => {
    // O cliente fica 3-4h com a chave. Se isso bloqueasse a agenda toda, a
    // imobiliária faria duas visitas por dia — outro corretor pode mostrar
    // outro imóvel no mesmo horário sem problema nenhum.
    expect(helper).toMatch(/imovelId,/);
    expect(helper).toMatch(/JANELA_CHAVE_MS/);
  });

  it("olha para trás E para a frente do horário pedido", () => {
    // Chave que saiu às 14h ainda está fora às 16h: a janela é simétrica.
    expect(helper).toMatch(/gt: new Date\(em\.getTime\(\) - JANELA_CHAVE_MS\)/);
    expect(helper).toMatch(/lt: new Date\(em\.getTime\(\) \+ JANELA_CHAVE_MS\)/);
  });

  it("a recusa diz o horário da outra visita e o que fazer", () => {
    expect(agendar).toMatch(/já há visita a este mesmo imóvel às/);
    expect(agendar).toMatch(/umas 4 horas/);
    expect(agendar).toMatch(/fora dessa janela/);
  });

  it("vale para o imóvel do código E para o que o cliente escolheu antes", () => {
    expect(agendar).toMatch(/const alvoImovelId = imovel\?\.id \?\? lead\.imovelId/);
  });
});

describe("o cliente sai da conversa sabendo para onde ir", () => {
  const agendar = fonte.slice(
    fonte.indexOf("const agendarVisitaTool"),
    fonte.indexOf("async function visitaFuturaDaConversa")
  );

  it("confirma o ENDEREÇO, não só o dia e a hora", () => {
    // Antes ela confirmava "só o dia e a hora" e o cliente ficava sem saber
    // onde é.
    expect(agendar).toMatch(/Confirme ao cliente o dia, a hora e onde é/);
    expect(agendar).not.toMatch(/Confirme ao cliente só o dia e a hora/);
  });

  it("o código continua proibido — é gaveta nossa", () => {
    expect(agendar).toMatch(/NÃO diga o código do imóvel/);
  });

  it("diz onde se pega a chave, porque a visita nasce sem corretor", () => {
    expect(agendar).toMatch(/chave se retira na imobiliária/);
    expect(agendar).toMatch(/a não ser que um corretor da equipe vá junto/);
  });

  it("visita sem imóvel nenhum é sinalizada, não escondida", () => {
    // Sem imóvel ninguém sabe que chave separar. Melhor a IA perguntar de novo
    // do que o cliente aparecer e a equipe não saber do que se trata.
    expect(agendar).toMatch(/esta visita ficou SEM imóvel/);
    expect(agendar).toMatch(/que chave separar/);
  });
});

describe("a visita manda no relógio do lead", () => {
  // O desenho: um follow-up por vez. Enquanto existe visita, `followUpEm`
  // pertence a ela (24h antes, manhã do dia); sem visita, volta para a cadência
  // comercial. Sem estes três pontos o worker nunca acordaria na hora certa —
  // o relógio estaria marcado para a cadência, lá na frente.
  const agendar = fonte.slice(
    fonte.indexOf("const agendarVisitaTool"),
    fonte.indexOf("async function visitaFuturaDaConversa")
  );
  const remarcar = fonte.slice(
    fonte.indexOf("const remarcarVisitaTool"),
    fonte.indexOf("const cancelarVisitaTool")
  );
  const cancelar = fonte.slice(
    fonte.indexOf("const cancelarVisitaTool"),
    fonte.indexOf("const registrarProposta")
  );

  it("agendar aponta o relógio para o primeiro lembrete", () => {
    expect(agendar).toMatch(/agendarLembretesVisita\(lead\.id, quando\.em\)/);
  });

  it("remarcar move os lembretes junto com a data", () => {
    // Senão a Maitê confirma a visita antiga na véspera da que não existe mais.
    expect(remarcar).toMatch(/agendarLembretesVisita\(alvo\.lead\.id, quando\.em\)/);
    expect(remarcar).toMatch(/senão a Maitê confirma a visita antiga/);
  });

  it("cancelar devolve o relógio para a cadência comercial", () => {
    // Sem isso o lead ficaria apontando para lembretes de um compromisso que
    // não existe — parado para sempre.
    expect(cancelar).toMatch(/iniciarCadencia\(alvo\.lead\.id\)/);
    expect(cancelar).toMatch(/if \(!outra\)/);
  });
});

describe("a IA sabe que já marcou visita com este cliente", () => {
  const bloco = fonte.slice(
    fonte.indexOf("// A visita que este cliente JÁ tem marcada"),
    fonte.indexOf("// Pós-visita:")
  );

  it("não oferece agendar de novo para quem já agendou", () => {
    // Mesmo defeito de "ninguém está lendo o que eu escrevo" que o bloco da
    // simulação existe para evitar.
    expect(bloco).toMatch(/VISITA JÁ MARCADA DESTE CLIENTE/);
    expect(bloco).toMatch(/NÃO ofereça agendar de novo/);
  });

  it("é o que dá sentido a remarcar e cancelar", () => {
    // Sem saber que existe visita, o modelo nunca chama essas duas.
    expect(bloco).toMatch(/remarcar_visita/);
    expect(bloco).toMatch(/cancelar_visita/);
  });

  it("olha o funil certo — o mesmo telefone pode ter compra E locação", () => {
    expect(bloco).toMatch(/conversa\.agente === "COMPRA_VENDA" \? "COMPRA" : "LOCACAO"/);
  });

  it("visita cancelada ou no passado não conta", () => {
    expect(bloco).toMatch(/em: \{ gte: new Date\(\) \}/);
    expect(bloco).toMatch(/status: \{ not: "CANCELADA" \}/);
  });

  it("vale para os dois comerciais", () => {
    expect(bloco).toMatch(/conversa\.agente === "VENDAS" \|\|\s*conversa\.agente === "COMPRA_VENDA"/);
  });
});

describe("o contexto da simulação segue a ordem nova", () => {
  const bloco = fonte.slice(
    fonte.indexOf("// O estado real da simulação deste cliente"),
    fonte.indexOf("// A visita que este cliente JÁ tem marcada")
  );

  it("PENDENTE não segura mais imóvel nem foto", () => {
    // Era "não mande imóvel nem marque visita". Só a visita espera.
    expect(bloco).not.toMatch(/não mande imóvel/);
    expect(bloco).toMatch(/Pode continuar mostrando imóveis e mandando fotos/);
    // A frase sobre "não marcar visita" saiu junto com a ferramenta em 10/08:
    // não se avisa alguém de que não vai fazer o que ela nunca pôde fazer.
    expect(bloco).not.toMatch(/marcar visita/);
  });

  it("APROVADO diz o VALOR e passa para a equipe", () => {
    // Aprovação sem próximo passo esfria — continua verdade. O que mudou em
    // 10/08 é QUAL é o próximo passo: era a IA marcar a visita; agora é ela
    // dizer o número e avisar que a equipe assume.
    expect(bloco).toMatch(/Diga o valor do seguro/);
    expect(bloco).toMatch(/equipe entra em contato para marcar a visita/);
    expect(bloco).not.toMatch(/consultar_horarios_visita/);
  });

  it("REPROVADO não interrompe a conversa", () => {
    expect(bloco).toMatch(/alguém da família/);
    expect(bloco).toMatch(/Continue mostrando imóveis normalmente/);
  });
});

describe("a peneira do seguro-fiança mudou de lugar, e não sumiu", () => {
  // ANTES: a trava barrava buscar imóvel, mandar foto E marcar visita — a
  // simulação vinha logo depois da triagem, antes de qualquer imóvel aparecer.
  // AGORA: barra só a visita.
  //
  // Três motivos, todos escritos no código: (1) a ordem antiga contradizia o
  // PROMPT_BASE, que proíbe condicionar imóvel a dado — o sistema tinha duas
  // regras opostas brigando; (2) a simulação depende de uma pessoa e não tem
  // prazo, então segurar tudo atrás dela aposta que a resposta chega antes de o
  // cliente esfriar; (3) pedir CPF a quem só perguntou o que tem é onde o
  // cliente some.
  const busca = fonte.slice(
    fonte.indexOf("const buscarImoveisDisponiveis"),
    fonte.indexOf("const enviarFotosImovel")
  );
  const fotos = fonte.slice(
    fonte.indexOf("const enviarFotosImovel"),
    fonte.indexOf("const consultarMercado")
  );
  const agendar = fonte.slice(
    fonte.indexOf("const agendarVisitaTool"),
    fonte.indexOf("async function visitaFuturaDaConversa")
  );

  // A asserção é sobre a CHAMADA, não sobre o nome: os dois comentários citam
  // `travaSeguroLocacao` para explicar por que ela não está ali.
  it("mostrar imóvel não depende mais de simulação", () => {
    expect(busca).not.toMatch(/await travaSeguroLocacao\(/);
  });

  it("mandar foto não depende mais de simulação", () => {
    expect(fotos).not.toMatch(/await travaSeguroLocacao\(/);
  });

  it("a ausência é EXPLICADA nos dois, senão alguém devolve a trava", () => {
    // Trava removida sem motivo escrito parece esquecimento, e quem vier depois
    // "conserta" de volta. É a regra deste repositório: o porquê fica do lado.
    expect(busca).toMatch(/NÃO há trava de seguro-fiança|Aqui NÃO há trava/);
    expect(fotos).toMatch(/Sem trava de seguro-fiança/);
  });

  it("a VISITA continua barrada — a peneira sobreviveu", () => {
    expect(agendar).toMatch(/travaSeguroLocacao\("agendei a visita"\)/);
  });

  it("a trava explica por que mudou de lugar", () => {
    const helper = fonte.slice(
      fonte.indexOf("// A peneira do seguro-fiança"),
      fonte.indexOf("const buscarImoveisDisponiveis")
    );
    expect(helper).toMatch(/ONDE ELA FICA, E POR QUE MUDOU DE LUGAR/);
    expect(helper).toMatch(/onde o custo ACONTECE/);
    expect(helper).toMatch(/NÃO tem prazo definido/);
    // E continua sendo trava de código, não conselho de prompt.
    expect(helper).toMatch(/Trava de verdade, e não conselho no prompt/);
  });

  it("o pedido de dados não fala mais em 'antes de te mandar as opções'", () => {
    // A constante de lib/seguro-fianca.ts descreve a ordem antiga e ficou
    // órfã; a mensagem nova mora em lib/prompt-seguro-fianca.ts, que é desta
    // área. Usar a antiga faria a IA dizer que ainda não mandou as opções
    // depois de já ter mandado.
    const helper = fonte.slice(
      fonte.indexOf("// A peneira do seguro-fiança"),
      fonte.indexOf("const buscarImoveisDisponiveis")
    );
    expect(helper).toMatch(/PEDIDO_APOS_ESCOLHA/);
    expect(helper).not.toMatch(/PEDIDO_DE_DADOS\b(?!` de)/);
  });

  it("a ferramenta de simulação não manda mais simular antes de mostrar", () => {
    const sim = fonte.slice(
      fonte.indexOf('name: "simular_seguro_fianca"'),
      fonte.indexOf('name: "simular_seguro_fianca"') + 900
    );
    expect(sim).toMatch(/DEPOIS de o cliente escolher um imóvel/);
    expect(sim).not.toMatch(/ANTES de mostrar qualquer imóvel/);
    expect(sim).toMatch(/o que depende de simulação APROVADA é marcar visita/i);
  });
});

describe("a Maitê escreve 'você' por extenso, sempre", () => {
  // O "cê" não era desvio do modelo: estava AUTORIZADO no PROMPT_BASE, na linha
  // que listava as informalidades permitidas ('Pode usar "pra", "tá",
  // "cê"/"você"'). Ele parece desleixo, não intimidade, e quem está decidindo
  // onde vai morar repara.
  const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("const PROMPTS"));

  it("a autorização saiu da lista de informalidades", () => {
    expect(base).not.toMatch(/Pode usar[^\n]*"cê"/);
  });

  it("a proibição é explícita, e cobre as três formas", () => {
    expect(base).toMatch(/É SEMPRE "você"/);
    for (const forma of ['"cê"', '"ocê"', '"vc"']) expect(base, forma).toContain(forma);
  });

  it("nenhuma frase pronta do arquivo escreve 'cê'", () => {
    // As mensagens fixas (saudações, contingência, follow-up) não passam pelo
    // modelo: se o "cê" estiver escrito ali, nenhuma regra de prompt segura.
    for (const [nome, arquivo] of [
      ["agentes.ts", fonte],
      ["followup.ts", readFileSync(new URL("./followup.ts", import.meta.url), "utf8")],
      ["prompt-seguro-fianca.ts", readFileSync(new URL("./prompt-seguro-fianca.ts", import.meta.url), "utf8")],
    ] as const) {
      const falas = arquivo.match(/`[^`]*`|"[^"\n]*"/g) ?? [];
      const comCe = falas.filter((f) => /\b(cê|ocê|vc)\b/i.test(f) && !/NUNCA escreva|É SEMPRE "você"/.test(f));
      expect(comCe, `${nome}: ${comCe.slice(0, 2).join(" | ")}`).toEqual([]);
    }
  });

  it("informal continua permitido — o que saiu foi só o 'cê'", () => {
    // Proibir "cê" não é virar formal: o que deixa formal é "prezado",
    // "informamos", "solicitamos".
    expect(base).toMatch(/"pra", "tá"/);
    expect(base).toMatch(/não deixa a conversa formal/);
  });
});

describe("a recepção cumprimenta antes de perguntar", () => {
  const prompts = fonte.slice(fonte.indexOf("const PROMPTS"));
  const recepcao = prompts.slice(prompts.indexOf("RECEPCAO: `"), prompts.indexOf("CAPTACAO: `"));

  it("a saudação é a que o dono escreveu, ao pé da letra", () => {
    expect(recepcao).toContain(
      "Oiee, tudo bem? É a Maitê, me fala mais ou menos o que você tá procurando que eu já te passo tudo que temos aqui"
    );
  });

  it("o menu de três opções saiu da abertura", () => {
    // "alugar, anunciar ou já é cliente?" é eficiente para nós e frio para quem
    // chegou. Ninguém começa conversa escolhendo item de lista.
    const abertura = recepcao.slice(recepcao.indexOf("A SAUDAÇÃO DE TRIAGEM"));
    const primeiraFrase = abertura.slice(0, abertura.indexOf("Esta é a primeira impressão"));
    expect(primeiraFrase).not.toMatch(/alugar, quer anunciar/);
  });

  it("mas continua existindo para quando a resposta não disser a área", () => {
    // Tom não pode custar roteamento: "quero informações" ainda precisa de uma
    // pergunta, só que em uma frase e sem cara de formulário.
    expect(recepcao).toMatch(/quero informações/);
    expect(recepcao).toMatch(/em UMA frase e sem cara de formulário/);
  });

  it("quem já disse o que quer não é perguntado", () => {
    expect(recepcao).toMatch(/NÃO faça pergunta nenhuma/);
  });

  it("a resposta de contingência usa a MESMA saudação", () => {
    // Quando a IA não pode rodar, quem está do outro lado não tem por que
    // perceber diferença nenhuma.
    const cont = fonte.slice(fonte.indexOf("function respostaDemoAgente"));
    expect(cont).toContain("Oiee, tudo bem? É a Maitê");
  });
});

describe("a vitrine: uma capa por imóvel, e uma pergunta no fim", () => {
  const tool = fonte.slice(
    fonte.indexOf("const enviarFotosImovel"),
    fonte.indexOf("const consultarMercado")
  );
  // A vitrine é regra dos DOIS comerciais, mas mora no roteiro de cada um, não
  // no PROMPT_BASE: a base é compartilhada com recepção, captação e
  // administração, que não mostram carteira nenhuma.
  const prompts = fonte.slice(fonte.indexOf("const PROMPTS"));
  const vendas = prompts.slice(prompts.indexOf("VENDAS: `"), prompts.indexOf("ADMINISTRACAO: `"));
  const compra = fonte.slice(fonte.indexOf("COMPRA_VENDA: `${PROMPT_BASE}"));

  it("apenasCapa manda UMA foto, não o álbum", () => {
    // Três imóveis com oito fotos cada são 24 imagens no celular de quem só
    // perguntou o que tem — e o cliente já reclamou da demora de um lote só.
    expect(tool).toMatch(/apenasCapa/);
    expect(tool).toMatch(/urls\.slice\(0, 1\)/);
  });

  it("o padrão continua sendo o álbum inteiro", () => {
    // Quem escolheu um imóvel quer ver tudo dele. A capa é para a vitrine.
    expect(tool).toMatch(/input\.apenasCapa === true/);
    expect(tool).toMatch(/capaOnly \? urls\.slice\(0, 1\) : urls/);
  });

  it("cada capa vem com o resumo daquele imóvel, senão não dá para escolher", () => {
    expect(tool).toMatch(/tipo, quartos, bairro e o valor TOTAL/);
    expect(tool).toMatch(/sem o código/);
  });

  it("o valor é o TOTAL, e o seguro fica de fora porque ainda não existe", () => {
    // Dizer só o aluguel e o cliente descobrir condomínio e IPTU depois é a
    // mesma frustração do preço escondido. Já o seguro-fiança não tem valor
    // até a simulação rodar — inventá-lo no resumo seria pior.
    expect(tool).toMatch(/aluguel \+ condomínio \+ IPTU/);
    expect(tool).toMatch(/só sai na simulação/);
  });

  it("a pergunta final é UMA, no fim de todas, e continua leve", () => {
    expect(tool).toMatch(/Gostou de algum\? Quer ver mais fotos de algum deles\?/);
    expect(tool).toMatch(/sem falar de visita ainda/);
  });

  it("o valor no resumo NÃO reabre o preço despejado antes da foto", () => {
    // A regra antiga continua: preço antes de a pessoa ter visto qualquer coisa
    // é o que incomodou. No resumo da vitrine ele serve para ESCOLHER — e o
    // código explica essa diferença, para ninguém tratar como contradição.
    expect(tool).toMatch(/serve para ESCOLHER/);
  });

  it("os dois comerciais apresentam em TEXTO e só mandam foto depois da escolha", () => {
    // MUDANÇA DE DECISÃO (2026-08-07, pelo dono): a apresentação era uma CAPA
    // por imóvel. Passou a ser texto, e a foto só sai depois que a pessoa
    // escolhe qual quer ver.
    //
    // O motivo veio de teste em produção: com seis capas chegando de uma vez, o
    // celular recebe seis notificações antes de a pessoa dizer o que interessa,
    // e ela responde à última que viu em vez da que serve. Uma lista curta se lê
    // em cinco segundos.
    //
    // A FERRAMENTA continua com `apenasCapa` (os testes acima seguem valendo):
    // o que mudou é o prompt deixar de pedir capa na apresentação, não a
    // capacidade sumir.
    for (const [nome, p] of [["locação", vendas], ["compra", compra]] as const) {
      expect(p, nome).toMatch(/em TEXTO/);
      // Era /DEPOIS QUE ELA ESCOLHER/ até 20/08. A regra apertou por decisão do
      // dono: escolher não é pedir foto, e ele viu a IA disparar imagens em cima
      // de um "gostei dessa". Agora a foto espera o SIM — pedido ou aceite.
      expect(p, nome).toMatch(/FOTO SÓ COM O SIM DA PESSOA/);
      expect(p, nome).toMatch(/ESCOLHER UM IMÓVEL NÃO É PEDIR FOTO/);
      expect(p, nome).toMatch(/Quer ver as fotos de algum deles\?/);
    }
  });
});

describe("em compra e venda, a visita exige o nome aprovado", () => {
  // A peneira equivalente à do seguro-fiança na locação, no MESMO ponto: a
  // visita, onde o custo acontece (deslocamento, chave, agenda de alguém).
  const agendar = fonte.slice(
    fonte.indexOf("const agendarVisitaTool"),
    fonte.indexOf("async function visitaFuturaDaConversa")
  );

  it("a trava é só de COMPRA_VENDA — locação tem a do seguro", () => {
    expect(agendar).toMatch(/ctx\.conversa\.agente === "COMPRA_VENDA"/);
    expect(agendar).toMatch(/travaSeguroLocacao/);
  });

  it("não duplica a qualificação completa do lead de empreendimento", () => {
    // Empreendimento já é barrado pela qualificação inteira logo acima; a trava
    // do nome é para o imóvel avulso de venda, que não passava por nada.
    expect(agendar).toMatch(/!lead\.empreendimentoId/);
  });

  it("nome não perguntado NÃO é nome sujo", () => {
    // `nomeRestrito` nulo é "não perguntei ainda". Deduzir restrição de silêncio
    // foi literalmente a alucinação que apareceu em produção.
    expect(agendar).toMatch(/q\.nomeRestrito === null/);
    expect(agendar).toMatch(/"Seu nome está limpo\?"/);
  });

  it("a pergunta tem UMA polaridade, como o resto do sistema", () => {
    // "está limpo ou tem restrição?" é a pergunta disjuntiva que fez a IA ler
    // "tá sim" como "tenho restrição".
    expect(agendar).not.toMatch(/limpo ou tem/);
  });

  it("restrição não é fim: oferece o outro titular da família", () => {
    expect(agendar).toMatch(/q\.nomeRestrito === true && !q\.nomeAlternativo/);
    expect(agendar).toMatch(/FAMÍLIA/);
    expect(agendar).not.toMatch(/dar um jeito/);
  });
});

describe("a visita sem dono chega em alguém", () => {
  const helper = fonte.slice(
    fonte.indexOf("// A visita nasce sem dono"),
    fonte.indexOf("// A agenda é DA IMOBILIÁRIA")
  );

  it("usa a MESMA lista que decide quem fala com o AJUDA_CORRETOR", () => {
    // Duas listas de corretor seria o erro que este projeto já cometeu antes:
    // dois caminhos para a mesma coisa, divergindo em silêncio.
    expect(helper).toMatch(/telefonesCorretores/);
    // A trava mudou de forma em 04/08 e ficou MAIS forte. Antes ela exigia que
    // os dois lados repetissem o mesmo regex de split — ou seja, garantia que
    // dois parsers fossem iguais. Agora exige que exista UM parser só: os dois
    // lados chamam lib/corretores.ts, e não há segundo lugar para divergir.
    expect(helper).toMatch(/telefonesDosCorretores\(/);
  });

  it("lista vazia é silêncio, não erro", () => {
    expect(helper).toMatch(/if \(!numeros\.length\) return/);
  });

  it("WhatsApp fora do ar não derruba o agendamento", () => {
    // A visita gravada com aviso falho é recuperável (está na agenda); a visita
    // não gravada é uma conversa perdida.
    expect(helper).toMatch(/try \{/);
    expect(helper).toMatch(/catch/);
  });

  it("avisa nos TRÊS momentos, e sempre depois de gravar", () => {
    const agendar = fonte.slice(
      fonte.indexOf("const agendarVisitaTool"),
      fonte.indexOf("async function visitaFuturaDaConversa")
    );
    expect(agendar.indexOf("prisma.visita.create")).toBeLessThan(
      agendar.indexOf("avisarCorretores")
    );
    for (const [nome, inicio, fim] of [
      ["remarcar", "const remarcarVisitaTool", "const cancelarVisitaTool"],
      ["cancelar", "const cancelarVisitaTool", "const registrarProposta"],
    ] as const) {
      const t = fonte.slice(fonte.indexOf(inicio), fonte.indexOf(fim));
      expect(t, nome).toMatch(/avisarCorretores/);
    }
  });

  it("o aviso diz o que o corretor precisa para decidir", () => {
    const agendar = fonte.slice(
      fonte.indexOf("const agendarVisitaTool"),
      fonte.indexOf("async function visitaFuturaDaConversa")
    );
    // Sem dono, quando, quem e onde — e o gesto que se espera dele.
    expect(agendar).toMatch(/sem corretor: \$\{fmt\(quando\.em\)\}/);
    expect(agendar).toMatch(/Cliente: \$\{lead\.nome\}/);
    expect(agendar).toMatch(/assume na agenda/);
  });
});

describe("a IA propõe o horário em vez de perguntar 'quando você pode?'", () => {
  const tool = fonte.slice(
    fonte.indexOf("const consultarHorariosTool"),
    fonte.indexOf("const agendarVisitaTool")
  );

  it("varre dia a dia até achar vaga, com teto", () => {
    // Sem varredura ela responde "esse dia não tem" e devolve o problema ao
    // cliente. O teto de 14 dias é para não varrer o ano inteiro: agenda cheia
    // por duas semanas é problema de equipe, não de horário.
    expect(tool).toMatch(/for \(let i = 0; i < 14; i\+\+\)/);
    expect(tool).toMatch(/próximos 14 dias/);
  });

  it("limita o que a IA pode despejar na conversa", () => {
    // Cinco horários numa mensagem de WhatsApp é um menu; duas é uma pergunta.
    expect(tool).toMatch(/slice\(0, 5\)/);
    expect(tool).toMatch(/MÁXIMO DUAS/);
    expect(tool).toMatch(/começando pelas mais cedo/);
  });

  it("diz o dia da semana, não só a data", () => {
    // "sábado, dia 15" é uma frase; "15/08" é um formulário.
    expect(tool).toMatch(/SEMANA\[dia\.getDay\(\)\]/);
  });

  it("domingo é DITO, nunca pulado calado", () => {
    // Pular para segunda em silêncio faria a IA responder "tenho 10h e 11h" a
    // quem pediu domingo, e a troca de dia passaria batida.
    expect(tool).toMatch(/Domingo a imobiliária não abre/);
    expect(tool).toMatch(/if \(fechado\(dia\)\)/);
  });
});

describe("a agenda é da imobiliária, e ninguém marca em cima de ninguém", () => {
  // Começa no COMENTÁRIO, não na função: o porquê da decisão mora acima dela,
  // e é justamente o porquê que este bloco existe para travar.
  const helper = fonte.slice(
    fonte.indexOf("// A agenda é DA IMOBILIÁRIA"),
    fonte.indexOf("const consultarHorariosTool")
  );

  it("o conflito olha a casa inteira, não a agenda de um corretor", () => {
    // Decisão do dono: a agenda é da imobiliária. Diverge do comentário de
    // `conflita` (lib/agenda.ts), que descreve a TELA — e a divergência está
    // explicada no código, para ninguém "consertar" de volta.
    expect(helper).toMatch(/imobiliariaId: ctx\.conversa\.imobiliariaId/);
    expect(helper).not.toMatch(/corretorId/);
    expect(helper).toMatch(/A agenda é DA IMOBILIÁRIA/);
  });

  it("visita cancelada não ocupa horário", () => {
    expect(helper).toMatch(/status: \{ not: "CANCELADA" \}/);
  });

  it("remarcar ignora a própria visita, senão ela conflita consigo mesma", () => {
    expect(helper).toMatch(/ignorarVisitaId/);
    const remarcar = fonte.slice(
      fonte.indexOf("const remarcarVisitaTool"),
      fonte.indexOf("const cancelarVisitaTool")
    );
    expect(remarcar).toMatch(/horarioOcupado\(quando\.em, alvo\.visita\.id\)/);
  });

  it("agendar checa conflito ANTES de criar a linha", () => {
    const agendar = fonte.slice(
      fonte.indexOf("const agendarVisitaTool"),
      fonte.indexOf("async function visitaFuturaDaConversa")
    );
    expect(agendar.indexOf("horarioOcupado")).toBeGreaterThan(-1);
    expect(agendar.indexOf("horarioOcupado")).toBeLessThan(
      agendar.indexOf("prisma.visita.create")
    );
    expect(agendar).toMatch(/já está ocupado na agenda da imobiliária/);
  });
});

describe("remarcar e cancelar: o que vem depois de agendar", () => {
  const remarcar = fonte.slice(
    fonte.indexOf("const remarcarVisitaTool"),
    fonte.indexOf("const cancelarVisitaTool")
  );
  const cancelar = fonte.slice(
    fonte.indexOf("const cancelarVisitaTool"),
    fonte.indexOf("const registrarProposta")
  );

  it("nenhuma das duas pede visitaId ao modelo", () => {
    // Ele nunca viu esse número: pedir seria convite para alucinação. As duas
    // acham a visita futura pelo telefone da conversa.
    for (const [nome, t] of [["remarcar", remarcar], ["cancelar", cancelar]] as const) {
      expect(t, nome).toMatch(/visitaFuturaDaConversa\(\)/);
      expect(t, nome).not.toMatch(/visitaId/);
    }
  });

  it("sem visita marcada, cada uma diz o que fazer em vez de errar", () => {
    expect(remarcar).toMatch(/Não há visita marcada[\s\S]*agendar_visita/);
    expect(cancelar).toMatch(/Não há visita marcada/);
  });

  it("remarcar move o lead junto, senão o funil aponta para o dia velho", () => {
    expect(remarcar).toMatch(/prisma\.visita\.update/);
    expect(remarcar).toMatch(/prisma\.lead\.update[\s\S]*visitaEm: quando\.em/);
    expect(remarcar).toMatch(/"VISITA_REMARCADA_IA",\s*"Visita"/);
  });

  it("cancelar não apaga a visita — marca CANCELADA e guarda o motivo", () => {
    // Apagar seria perder o histórico de quem desmarca sempre.
    expect(cancelar).not.toMatch(/prisma\.visita\.delete/);
    expect(cancelar).toMatch(/status: "CANCELADA"/);
    expect(cancelar).toMatch(/observacoes:/);
  });

  it("cancelar solta o lead do VISITA_AGENDADA, divergindo da tela de propósito", () => {
    // lib/agenda.ts devolve null para CANCELADA ("quem decide é o corretor"),
    // regra escrita para a tela, onde alguém está olhando. Aqui o cliente DISSE
    // que não vai: deixar visitaEm preenchido faz o funil mentir e o follow-up
    // tratar como agendado.
    expect(cancelar).toMatch(/Divergência CONSCIENTE/);
    expect(cancelar).toMatch(/visitaEm: null/);
    expect(cancelar).toMatch(/status: "ATENDIMENTO"/);
  });

  it("com outra visita futura, o lead NÃO volta para atendimento", () => {
    expect(cancelar).toMatch(/id: \{ not: alvo\.visita\.id \}/);
    expect(cancelar).toMatch(/if \(!outra\)/);
  });
});

describe("o que o cliente pede vem antes da fila de perguntas", () => {
  // Duas conversas de produção: o lead recusou três vezes passar o nome da
  // esposa e pediu, explícito, para ver os imóveis. A IA insistiu nas três e
  // respondeu "assim que você me passar, já te mando os imóveis" — segurando o
  // único ativo que ele queria como refém do formulário. E justificou com "é
  // obrigatório pro banco", que é falso nesse estágio: composição de renda é
  // opcional, e anuência do cônjuge é etapa de contrato.
  const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("const PROMPTS"));
  const compra = fonte.slice(fonte.indexOf("COMPRA_VENDA: `${PROMPT_BASE}"));

  it("entrega primeiro o que foi pedido", () => {
    expect(base).toMatch(/O QUE ELE PEDE VEM ANTES DA SUA FILA/);
    expect(base).toMatch(/ENTREGUE PRIMEIRO, na mesma resposta/);
  });

  it("proíbe condicionar imóvel a dado", () => {
    expect(base).toMatch(/É PROIBIDO condicionar/);
    expect(base).toContain('assim que você me passar X, eu te mando os imóveis');
    expect(base).toMatch(/chantagem de formulário/);
  });

  it("com informação parcial, entrega parcial", () => {
    expect(base).toMatch(/Com informação parcial, entrega parcial/);
  });

  it("recua depois da segunda recusa, em vez de contornar", () => {
    expect(base).toMatch(/QUANDO ELE NÃO QUER RESPONDER/);
    expect(base).toMatch(/PARE de pedir aquele dado nesta conversa/);
    expect(base).toMatch(/não contorne por outro caminho/);
  });

  it("a reformulação é por benefício, e uma só", () => {
    expect(base).toMatch(/reformular UMA vez, e só pelo BENEFÍCIO/);
    expect(base).toMatch(/Nunca por obrigação/);
  });

  it("não inventa obrigatoriedade bancária", () => {
    expect(base).toMatch(/O QUE VOCÊ NÃO PODE AFIRMAR SOBRE BANCO/);
    expect(base).toContain('"obrigatório pro banco"');
    expect(base).toMatch(/colocar o CÔNJUGE na composição de renda é OPCIONAL/);
    expect(base).toMatch(/anuência do cônjuge é etapa de CONTRATO/);
  });

  it("a ordem 'qualificar antes' virou padrão, não tranca — sem contradição", () => {
    // Duas regras opostas no mesmo prompt é pior que qualquer uma das duas.
    expect(compra).toMatch(/é a ORDEM PADRÃO, não uma tranca/);
    expect(compra).not.toMatch(/Não abra catálogo antes de qualificar/);
  });
});

describe("os documentos saem da ferramenta, não de uma lista decorada", () => {
  // A IA pediu extrato de FGTS de quem tinha acabado de dizer que não tem FGTS,
  // e documentos de cônjuge que ninguém derivou. A causa não era falta de
  // arquitetura: documentosAplicaveis() JÁ desconta esses casos. Era a lista
  // numerada escrita à mão no prompt, competindo com a derivada — e uma lista
  // concreta sempre vence uma instrução abstrata.
  const compra = fonte.slice(fonte.indexOf("COMPRA_VENDA: `${PROMPT_BASE}"));

  it("a lista fixa saiu do prompt", () => {
    expect(compra).not.toMatch(/1\) RG e CPF, ou CNH; 2\) certidão de estado civil/);
    expect(compra).not.toMatch(/6\) extrato do FGTS \(PDF exportado do app FGTS\)/);
  });

  it("manda pedir exatamente o que a ferramenta devolveu", () => {
    expect(compra).toMatch(/A LISTA VEM DA FERRAMENTA, e só dela/);
    expect(compra).toMatch(/NÃO ACRESCENTE NENHUM ITEM que a ferramenta não devolveu/);
  });

  it("a lista inteira aparece uma vez; depois é um item por vez", () => {
    expect(compra).toMatch(/A lista completa aparece UMA VEZ/);
    expect(compra).toMatch(/Nunca repita a lista inteira a cada resposta/);
  });

  it("a derivação que já existia continua de pé", () => {
    // Se alguém apagar isto de lib/qualificacao.ts, o prompt sozinho não salva.
    const q = readFileSync("lib/qualificacao.ts", "utf8");
    expect(q).toMatch(/if \(d\.soComConjuge\) return temConjuge\(r\)/);
    expect(q).toMatch(/EXTRATO_FGTS.*r\.temFgts !== false/);
  });
});

describe("vários dados numa mensagem só", () => {
  // O lead mandou RG, CPF e o nome completo juntos. A IA anotou RG e CPF,
  // perdeu o nome, e devolveu a lista inteira de pendências.
  const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("const PROMPTS"));

  it("aproveita tudo que veio, não só o primeiro", () => {
    expect(base).toMatch(/VÁRIOS DADOS NUMA MENSAGEM SÓ/);
    expect(base).toMatch(/APROVEITE TUDO/);
    expect(base).toMatch(/reconheça os três, não só o primeiro/);
  });

  it("e segue com o próximo item, não com o muro de pendências", () => {
    expect(base).toMatch(/Não devolva o resumo do que falta inteiro/);
    expect(base).toMatch(/muro de pendências/);
  });
});

describe("data em formato brasileiro não pode emudecer a IA", () => {
  // A conversa real: o cliente respondeu "17/02/2002" à data de nascimento da
  // esposa, e a Maitê parou de responder ali. Nunca mais escreveu nada.
  //
  // A cadeia era silenciosa de ponta a ponta: dataOuIndefinida só aceitava
  // AAAA-MM-DD e devolvia `undefined` para o resto; `undefined` significa "não
  // mexe no campo", então a data não gravava; a escada seguia pedindo a MESMA
  // pergunta; e a regra "se a ferramenta repetir uma pergunta que você já fez,
  // ignore" mandava a IA não dizer nada. Nenhum erro em lugar nenhum — só uma
  // conversa morta com um cliente qualificado do outro lado.
  const tool = fonte.slice(
    fonte.indexOf("const dataOuIndefinida"),
    fonte.indexOf("const registrarDocumentos")
  );

  it("aceita o formato que o brasileiro escreve", () => {
    expect(tool).toMatch(/\\d\{1,2\}\)\[\/\.-\]/); // DD/MM/AAAA, com / . ou -
    expect(tool).toMatch(/^\s*const iso = s\.match/m); // e continua aceitando ISO
  });

  it("recusa data que não existe, em vez de inventar março", () => {
    // new Date(2002, 1, 31) vira 03/03 calado. Se o mês mudou, a data é falsa.
    expect(tool).toMatch(/31\/02 vira 03\/03 no Date/);
    expect(tool).toMatch(/dt\.getUTCMonth\(\) === Number\(m\) - 1/);
  });

  it("valor recusado é DITO, nunca engolido", () => {
    expect(tool).toMatch(/datasRecusadas/);
    expect(tool).toMatch(/ATENÇÃO: não consegui gravar/);
    expect(tool).toMatch(/NÃO siga para a próxima pergunta enquanto isso não entrar/);
  });

  it("as três datas da qualificação passam pelo mesmo caminho, com rótulo", () => {
    // Sem o rótulo, a recusa não teria como dizer QUAL data não entrou.
    expect(fonte).toContain('dataOuIndefinida(input.dataNascimento, "data de nascimento")');
    expect(fonte).toContain(
      'dataOuIndefinida(input.conjugeDataNascimento, "data de nascimento do cônjuge")'
    );
    expect(fonte).toContain('dataOuIndefinida(input.previsaoQuitacao, "previsão de quitação")');
  });
});

describe("restrição no nome: só quando a pessoa DIZ que tem", () => {
  // A conversa real: a IA perguntou "Seu nome tá limpo, OU tem alguma restrição
  // tipo Serasa, SPC?" e o cliente respondeu "Tá sim meu amigo" — querendo dizer
  // que estava limpo. Ela leu como restrição, seguiu perguntando entrada e
  // carteira, e minutos depois soltou "com restrição no nome não rola aprovar
  // financiamento agora". Recusou um comprador que nunca disse ter restrição.
  //
  // A pergunta de duas pontas é a raiz: diante dela, "sim" não tem resposta
  // possível — e o chute caiu para o lado que encerra a venda.
  const compra = fonte.slice(fonte.indexOf("COMPRA_VENDA: `${PROMPT_BASE}"));

  it("a pergunta tem uma polaridade só", () => {
    expect(compra).toMatch(/A PERGUNTA É DE UMA POLARIDADE SÓ/);
    expect(compra).toMatch(/NUNCA pergunte "está limpo OU tem restrição\?"/);
  });

  it("'tá sim' para 'seu nome está limpo?' significa LIMPO", () => {
    expect(compra).toMatch(/significam LIMPO/);
    expect(fonte).toMatch(/um 'sim'\/'tá sim'\/'isso' significa LIMPO — mande false/);
  });

  it("na dúvida pergunta de novo, em vez de registrar", () => {
    // Uma mensagem a mais custa menos que a venda inteira.
    expect(compra).toMatch(/PERGUNTE DE NOVO/);
    expect(fonte).toMatch(/Na dúvida, NÃO mande este campo/);
  });

  it("não deduz restrição de nada que não foi dito", () => {
    expect(compra).toMatch(/NUNCA afirme que a pessoa tem restrição se ela não disse/);
    expect(compra).toMatch(/Se não foi dito, não existe/);
  });
});

describe("trocar o titular não existe em compra", () => {
  // Em financiamento, quem assina fica com o imóvel: trocar o nome é trocar o
  // comprador, não um contorno para restrição. Em locação é outra história —
  // outro titular ou fiador é caminho normal, e por isso o campo continua vivo.
  const compra = fonte.slice(fonte.indexOf("COMPRA_VENDA: `${PROMPT_BASE}"));

  it("o roteiro de compra não oferece outro titular", () => {
    expect(compra).toMatch(/NÃO EXISTE "colocar no nome de outra pessoa" em COMPRA/);
    expect(compra).toMatch(/Nunca ofereça isso, nem pergunte por cônjuge ou familiar/);
  });

  it("a ferramenta desencoraja o campo em compra, sem apagá-lo da locação", () => {
    expect(fonte).toMatch(/NÃO USE em compra\/financiamento — só existe para locação/);
    expect(fonte).toContain("temOutroTitular"); // continua existindo
  });

  it("some do roteiro a pergunta das 'duas perguntas' antigas", () => {
    expect(compra).not.toMatch(/Faça só duas perguntas: quando ela espera quitar, e se tem OUTRA PESSOA/);
  });
});

describe("as fotos vão limpas, e a conversa vem depois", () => {
  // A conversa real: as fotos chegaram com a legenda
  // "1650: Casa em Avenida Bady Bassitt, 001, Boa Vista · R$ 300.000,00" e, logo
  // atrás, "Manda ver, olha as fotos aí. Quer agendar uma visita?".
  //
  // Quatro erros num fôlego: o código, que é gaveta nossa; o preço, antes de a
  // pessoa ter olhado a casa; o anúncio do que já estava na tela dela; e o
  // empurrão para a visita antes de saber se gostou.
  const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("const PROMPTS"));
  const compra = fonte.slice(fonte.indexOf("COMPRA_VENDA: `${PROMPT_BASE}"));
  const ferramenta = fonte.slice(
    fonte.indexOf("const enviarFotosImovel"),
    fonte.indexOf("const consultarMercado")
  );

  it("a ferramenta não monta mais legenda com código e preço", () => {
    // A legenda inteira saiu: as fotos vão sem texto colado.
    expect(ferramenta).not.toMatch(/const legenda =/);
    expect(ferramenta).toMatch(/SEM LEGENDA, de propósito/);
  });

  it("depois das fotos, a pergunta é leve — sem preço, código nem visita", () => {
    expect(ferramenta).toMatch(/NÃO repita preço, NÃO diga o código, NÃO empurre visita ainda/);
    expect(ferramenta).toMatch(/Tem algum outro bairro ou região/);
  });

  it("não anuncia foto que já chegou", () => {
    expect(base).toMatch(/NÃO ANUNCIE O QUE JÁ CHEGOU/);
    expect(ferramenta).toMatch(/não anuncie as fotos/);
  });

  it("o código do imóvel não é dito ao cliente", () => {
    expect(base).toMatch(/O CÓDIGO DO IMÓVEL É NOSSO, não dele/);
    expect(base).toMatch(/Nunca escreva "código 1650"/);
  });

  it("bairro leva artigo: 'no Boa Vista', não 'em Boa Vista'", () => {
    expect(base).toMatch(/BAIRRO PEDE ARTIGO/);
    expect(base).toContain('"no Boa Vista"');
    expect(base).toMatch(/nunca "em Boa Vista"/);
  });

  it("nada de animação de vendedor, e confirmação só quando muda algo", () => {
    // "Manda ver" veio daqui: entusiasmo de propaganda em texto escrito.
    expect(base).toMatch(/NADA DE ANIMAÇÃO DE VENDEDOR/);
    expect(base).toContain('"Manda ver"');
    expect(base).toMatch(/CONFIRMAÇÃO SÓ QUANDO MUDA ALGO/);
  });

  it("a ordem depois da foto está escrita no roteiro de compra", () => {
    expect(compra).toMatch(/A ORDEM DEPOIS DAS FOTOS/);
    expect(compra).toMatch(/Preço, código e visita ficam para DEPOIS/);
  });
});

describe("a Recepção sabe o que existe do outro lado", () => {
  // Ela não conduz assunto nenhum — mas precisa RECONHECER. Sem saber que
  // COMPRA_VENDA cobre financiamento e MCMV, ela trata como impossível algo
  // que a casa faz todo dia, e o atendimento quebra antes de começar.
  const prompts = fonte.slice(fonte.indexOf("const PROMPTS"));
  const recepcao = prompts.slice(prompts.indexOf("RECEPCAO: `"), prompts.indexOf("CAPTACAO: `"));

  it("conhece o escopo das quatro áreas", () => {
    expect(recepcao).toMatch(/O QUE CADA ÁREA RESOLVE/);
    for (const area of ["COMPRA_VENDA", "VENDAS", "CAPTACAO", "ADMINISTRACAO"])
      expect(recepcao, area).toContain(area);
  });

  it("sabe que financiamento e MCMV são de COMPRA_VENDA", () => {
    const escopo = recepcao.slice(recepcao.indexOf("O QUE CADA ÁREA RESOLVE"));
    for (const t of ["Minha Casa Minha Vida", "financiamento", "FGTS", "primeiro imóvel"])
      expect(escopo, t).toContain(t);
  });

  it("continua proibida de responder ao mérito", () => {
    // Saber o que existe não é licença para explicar: ela não tem o roteiro.
    expect(recepcao).toMatch(/NUNCA responda ao mérito do assunto/);
    expect(recepcao).toMatch(/encaminhar É a resposta/i);
  });
});

describe("a IA não joga para um humano o que ela mesma atende", () => {
  const TODAS = ["CAPTACAO", "VENDAS", "COMPRA_VENDA", "ADMINISTRACAO", "NAO_CONTRATADO"];

  it("Minha Casa Minha Vida e empreendimento são COMPRA_VENDA, não humano", () => {
    // O caso real: "quero um Minha Casa Minha Vida" virava NAO_CONTRATADO e
    // caía no colo de alguém — sendo que a IA atende isso do começo ao fim.
    for (const pedido of [
      "quer um Minha Casa Minha Vida",
      "quer apartamento na planta",
      "perguntou de um lançamento da construtora",
      "quer saber sobre financiamento",
      "quer comprar um apartamento de 2 quartos",
      "interesse em empreendimento no Centro",
    ]) {
      expect(areaQueDeveriaAtender(undefined, pedido, TODAS)).toBe("COMPRA_VENDA");
    }
  });

  it("quando a própria IA diz qual área resolveria, e ela existe, é ela", () => {
    expect(areaQueDeveriaAtender("COMPRA_VENDA", "qualquer coisa", TODAS)).toBe("COMPRA_VENDA");
    expect(areaQueDeveriaAtender("ADMINISTRACAO", "2ª via de boleto", TODAS)).toBe("ADMINISTRACAO");
  });

  it("sem o módulo contratado, o encaminhamento ao humano continua valendo", () => {
    // Aqui NÃO é a IA fugindo: a imobiliária realmente não tem essa área.
    const semCompra = ["VENDAS", "ADMINISTRACAO", "NAO_CONTRATADO"];
    expect(areaQueDeveriaAtender(undefined, "quer comprar um apartamento", semCompra)).toBeNull();
    expect(areaQueDeveriaAtender("COMPRA_VENDA", "quer comprar", semCompra)).toBeNull();
  });

  it("assunto que é mesmo de humano continua indo para humano", () => {
    expect(areaQueDeveriaAtender(undefined, "quer propor uma parceria comercial", TODAS)).toBeNull();
    expect(areaQueDeveriaAtender(undefined, "reclamação grave sobre um corretor", TODAS)).toBeNull();
    expect(areaQueDeveriaAtender(undefined, undefined, TODAS)).toBeNull();
  });
});

// O print do WhatsApp: depois de "/reset", o cliente escreveu "Oi" e logo
// "Quero comprar uma casa mas tenho restrição no nome". A Maitê respondeu com
// três bolhas — a saudação de triagem repetida, um papagaio do que ele acabou
// de escrever e uma pergunta inventada que não existe na escada. A causa era
// estrutural: `direcionar_atendimento` trocava a área no banco, mas o turno
// continuava escrevendo com o prompt da RECEPÇÃO, que não conhece o roteiro do
// destino. Estes testes travam as três correções no arquivo.
describe("o encaminhamento não deixa a recepção improvisar", () => {
  const prompts = fonte.slice(fonte.indexOf("const PROMPTS"));
  const recepcao = prompts.slice(prompts.indexOf("RECEPCAO: `"), prompts.indexOf("CAPTACAO: `"));

  it("a saudação de triagem é CONDICIONAL, não abertura obrigatória", () => {
    expect(recepcao).toMatch(/SAUDAÇÃO DE TRIAGEM É CONDICIONAL/);
    expect(recepcao).toMatch(/JÁ DISSE o que quer/);
  });

  it("depois de encaminhar, a recepção fica calada", () => {
    expect(recepcao).toMatch(/DEPOIS DE CHAMAR A FERRAMENTA, NÃO ESCREVA NADA/);
    expect(recepcao).toMatch(/NUNCA invente uma pergunta/);
  });

  it("o recibo da tool é seco — sem briefing que a recepção tente executar", () => {
    const tool = fonte.slice(fonte.indexOf("const direcionarAtendimento"));
    const recibo = tool.slice(0, tool.indexOf("const cadastrarProprietario"));
    expect(recibo).toContain("Não escreva nada.");
    // Um briefing aqui compete com o prompt do agente de destino.
    expect(recibo).not.toMatch(/Assuma as vendas/);
    expect(recibo).not.toMatch(/entenda o que procura e apresente/);
  });

  it("o turno REENTRA com o prompt do novo agente quando a área muda", () => {
    // Sem a reentrada, quem escreve a primeira mensagem da nova área ainda é a
    // recepção — sem a escada e sem as ferramentas dela.
    expect(fonte).toMatch(/umaPassadaDoAgente/);
    expect(fonte).toMatch(/trocouPara/);
    expect(fonte).toMatch(/for \(let passada = 0; passada < 2; passada\+\+\)/);
  });

  it("o texto escrito com o prompt errado é DESCARTADO, não enviado", () => {
    const laco = fonte.slice(fonte.indexOf("for (let passada = 0"));
    expect(laco.slice(0, 600)).toMatch(/if \(r\.trocouPara && passada === 0\)/);
  });

  it("a base proíbe papagaiar o cliente", () => {
    const base = fonte.slice(fonte.indexOf("const PROMPT_BASE"), fonte.indexOf("const PROMPTS"));
    expect(base).toMatch(/NÃO PAPAGAIE O CLIENTE/);
  });
});

// ─── Mostrar imóvel vem antes do questionário ───────────────────────────────
//
// O prompt de VENDAS mandava "QUALIFICAR BEM antes de sair mostrando imóvel" e
// "só depois de entender isso, apresente opções reais" — depois de oito
// perguntas. Isso contradizia frontalmente a regra absoluta do PROMPT_BASE ("o
// que ele pede vem antes da sua fila", "é PROIBIDO condicionar"), e entre as
// duas a IA obedecia a mais próxima: o questionário.
//
// O sintoma, relatado pelo dono: "ela precisa mandar os imóveis disponíveis".
// Chegava gente pedindo apartamento e levava interrogatório.
//
// Estes testes existem porque a contradição é INVISÍVEL na leitura: cada metade
// parece razoável sozinha, e só quem lê o prompt inteiro percebe que uma anula
// a outra. É o tipo de coisa que volta sozinha na próxima edição.
describe("a carteira vem antes da fila de perguntas", () => {
  const fonte = readFileSync("lib/agentes.ts", "utf8");
  const semComentario = fonte.replace(/^\s*\/\/.*$/gm, "");
  const vendas = semComentario.slice(
    semComentario.indexOf("  VENDAS: `${PROMPT_BASE}"),
    semComentario.indexOf("  ADMINISTRACAO: `${PROMPT_BASE}")
  );
  const compra = semComentario.slice(semComentario.indexOf("  COMPRA_VENDA: `${PROMPT_BASE}"));

  it("VENDAS não manda mais qualificar antes de mostrar", () => {
    expect(vendas).not.toMatch(/QUALIFICAR BEM antes de sair mostrando/);
    expect(vendas).not.toMatch(/Só depois de entender isso, apresente opções/);
  });

  it("VENDAS manda mostrar com QUALQUER pista, e mostrar o que tem perto", () => {
    expect(vendas).toMatch(/MOSTRE IMÓVEL LOGO/);
    expect(vendas).toMatch(/um só desses já basta/);
    expect(vendas).toMatch(/mostre o que tem PERTO/);
  });

  it("VENDAS proíbe segurar imóvel esperando resposta", () => {
    expect(vendas).toMatch(/nunca segure imóvel esperando resposta/);
  });

  it("a foto continua esperando a escolha — a LISTA é que não espera", () => {
    // A regra da foto é de outra pessoa e é deliberada (seis fotos de uma vez
    // viram seis notificações antes de a pessoa dizer qual interessa). As duas
    // convivem: a lista em TEXTO responde na hora quem pediu imóvel, e a foto
    // espera. Desfazer a dela junto com a minha seria trocar um problema por
    // outro.
    //
    // 20/08: o que a foto espera deixou de ser a ESCOLHA e passou a ser o SIM.
    // A razão de quem escreveu esta regra continua valendo inteira — seis fotos
    // viram seis notificações antes de a pessoa dizer o que interessa; o que
    // mudou é que "gostei dessa" também não basta para abrir a torneira.
    expect(vendas).toMatch(/FOTO SÓ COM O SIM DA PESSOA/);
    expect(vendas).toMatch(/A LISTA é imediata; a FOTO é que espera o SIM/);
  });

  it("COMPRA_VENDA também mostra cedo", () => {
    expect(compra).not.toMatch(/QUALIFICAR PRIMEIRO, APRESENTAR DEPOIS/);
    expect(compra).toMatch(/MOSTRAR CEDO, QUALIFICAR EM CIMA DO INTERESSE/);
  });

  it("a regra absoluta do PROMPT_BASE continua de pé", () => {
    // Se um dia ela sair, os dois prompts acima voltam a ser a única palavra
    // sobre a ordem — e não é neles que a decisão deve morar.
    expect(semComentario).toMatch(/O QUE ELE PEDE VEM ANTES DA SUA FILA/);
    expect(semComentario).toMatch(/É PROIBIDO condicionar/);
  });
});

// O NOME DO CONDOMÍNIO É O QUE DÁ VALOR AO IMÓVEL — e o que a IA jogava fora.
//
// Em 18/08 o dono da imobiliária perguntou o nome do condomínio, a IA respondeu
// o campo `bairro` ("Residencial Marcia") e defendeu o cadastro com "é assim que
// está cadastrado". Ele encerrou: "Não é esse nome. Então deixa quieto, você não
// sabe". O imóvel 587 está no Gaivota I — o vínculo estava certo, o campo bairro
// é que mente.
//
// A ficha já lidera com "Cond. <nome>" (fichaDoImovel). O que faltava era o
// prompt: em Rio Preto, Gaivota/Damha/Quinta do Lago são o que o cliente
// reconhece, e anunciar o loteamento no lugar do condomínio joga fora o
// argumento de valor. A trava do meio é tão importante quanto: usar o NOME não
// autoriza inventar piscina, portaria nem "alto padrão".
describe("o prompt ensina a liderar pelo condomínio sem inventar o resto", () => {
  const base = fonte.slice(fonte.indexOf("CONDOMÍNIO FECHADO"), fonte.indexOf("const PROMPTS"));

  it("a seção existe no PROMPT_BASE, valendo para todos os agentes", () => {
    expect(base.length).toBeGreaterThan(200);
    expect(base).toMatch(/é esse nome que LIDERA a apresentação/);
  });

  it("proíbe inventar estrutura que não está cadastrada", () => {
    // Sem isto, "venda o padrão do condomínio" vira promessa de piscina.
    expect(base).toMatch(/NÃO INVENTE O RESTO/);
    expect(base).toMatch(/piscina/);
    expect(base).toMatch(/não adjetive/);
  });

  it("proíbe a frase que encerrou a conversa do dono", () => {
    expect(base).toMatch(/NÃO DEFENDA O CADASTRO/);
    expect(base).toMatch(/Nunca diga "é assim que está cadastrado"/);
  });
});

// LISTA DE IMÓVEL EMENDADA NUM PARÁGRAFO — o print que o dono mandou em 19/08.
//
// A IA acertou o condomínio ("Casa no Gaivota I") e ainda assim a mensagem ficou
// ilegível: três imóveis e um resumo, tudo corrido, num bloco cinza. Quem lê no
// celular não consegue comparar preço com preço nem apontar qual quer.
//
// A causa não era um defeito: era ausência. O PROMPT_BASE manda "UMA BOLHA...
// nada de textão" e nunca disse COMO formatar uma lista, então o modelo aplicou
// a regra da bolha ao conteúdo e emendou tudo.
//
// O detalhe que faz a regra funcionar está em dividirEmBolhas (lib/whatsapp.ts:30):
// ela quebra por LINHA EM BRANCO (/\n\s*\n/), não por quebra simples. Uma quebra
// só organiza a lista sem espalhá-la em várias mensagens — e é por isso que o
// prompt precisa dizer "sem linha em branco no meio", senão o remédio vira pior
// que a doença.
describe("o prompt ensina a listar imóvel um por linha", () => {
  const bloco = fonte.slice(
    fonte.indexOf("LISTA DE IMÓVEL É UM POR LINHA"),
    fonte.indexOf("RESPONDA O QUE FOI PERGUNTADO")
  );

  it("a regra existe e proíbe o parágrafo corrido", () => {
    expect(bloco.length).toBeGreaterThan(200);
    expect(bloco).toMatch(/cada imóvel ocupa UMA LINHA SÓ/);
    expect(bloco).toMatch(/NUNCA emende os imóveis num parágrafo corrido/);
  });

  it("avisa que linha EM BRANCO espalha a lista em bolhas", () => {
    // Sem isto o modelo separa os imóveis com \n\n e dividirEmBolhas manda uma
    // mensagem por imóvel — pior que o bloco corrido.
    expect(bloco).toMatch(/sem deixar linha em branco/);
    expect(bloco).toMatch(/bolhas diferentes/);
  });

  it("o exemplo do próprio prompt está no formato que ele ensina", () => {
    // Um exemplo com linha em branco entre os imóveis ensinaria exatamente o
    // erro que a regra proíbe. Aqui o exemplo é a especificação.
    const exemplo = bloco.slice(bloco.indexOf("Assim:"), bloco.indexOf("E não assim"));
    const linhas = exemplo.split("\n").filter((l) => l.includes("R$"));
    expect(linhas.length).toBe(3);
    expect(exemplo).not.toMatch(/\n\s*\n/);
    // Preço fecha cada linha: é o que deixa as linhas comparáveis na vertical.
    for (const l of linhas) expect(l.trim()).toMatch(/R\$ [\d.]+$/);
  });

  it("proíbe numeração e marcador, que poluem no WhatsApp", () => {
    expect(bloco).toMatch(/NÃO numere/);
    expect(bloco).toMatch(/asterisco de negrito/);
  });
});

// ─── A saída de área (26/08) ────────────────────────────────────────────────
//
// O atendimento que motivou tudo isto está medido em produção, na conversa 329
// do tenant 3 (WSP Prime), às 11:13 BRT de 26/08:
//
//   cliente: "Estou procurando uma casa pra comprar até 200 mil na região sul"
//   Maitê:   "Deixa eu confirmar com a equipe qual é a melhor opção pra essa
//             busca. Um atendente vai entrar em contato em breve."
//
// A IA rodou (UsoIA grava agente ADMINISTRACAO, haiku, no mesmo segundo), o
// módulo COMERCIAL está contratado nesse tenant, e a carteira tinha 43 imóveis à
// venda dentro dos 200 mil. O que faltava era a PORTA: `direcionar_atendimento`
// só existia na recepção, e quem é da carteira nunca passa por ela — o telefone
// é reconhecido e a conversa nasce em ADMINISTRACAO, para sempre.
describe("toda área de cliente tem saída", () => {
  for (const agente of ["CAPTACAO", "VENDAS", "ADMINISTRACAO", "COMPRA_VENDA"]) {
    it(`${agente} pode encaminhar para a área certa`, () => {
      expect(toolsDe(agente)).toContain("direcionarAtendimento");
    });
  }

  it("AJUDA_CORRETOR fica de fora, e isso é deliberado", () => {
    // Do outro lado está o corretor da equipe, não um cliente: a conversa dele
    // nasce do telefone cadastrado em Configurações. Trocar a área ali tiraria o
    // corretor do atendimento interno sem nada para colocar no lugar.
    expect(toolsDe("AJUDA_CORRETOR")).not.toContain("direcionarAtendimento");
  });

  it("a regra da troca acompanha a ferramenta, e só ela", () => {
    // Prompt que manda trocar de área sem a ferramenta na mão é promessa que a
    // IA não cumpre — o erro mais caro deste sistema. RECEPCAO tem regra própria
    // (mais detalhada), AJUDA_CORRETOR não pode trocar.
    for (const agente of ["CAPTACAO", "VENDAS", "ADMINISTRACAO", "COMPRA_VENDA"])
      expect(fonte, agente).toMatch(new RegExp(`${agente}: \`\\$\\{PROMPT_BASE\\}\\$\\{TROCA_DE_AREA\\}`));
    for (const agente of ["RECEPCAO", "AJUDA_CORRETOR"])
      expect(fonte, agente).toMatch(new RegExp(`${agente}: \`\\$\\{PROMPT_BASE\\}\n`));
  });

  it("a regra proíbe LITERALMENTE a frase que o cliente ouviu", () => {
    const regra = fonte.slice(fonte.indexOf("const TROCA_DE_AREA"), fonte.indexOf("const PROMPTS"));
    expect(regra).toMatch(/um atendente vai entrar em contato/);
    expect(regra).toMatch(/PROIBIDO/);
    // E diz por que ser da carteira não encerra o assunto: o caso real é um
    // proprietário cadastrado querendo comprar.
    expect(regra).toMatch(/SER DA CARTEIRA NÃO TIRA NINGUÉM DO COMERCIAL/);
    expect(regra).toMatch(/COMPRAR imóvel é COMPRA_VENDA/);
  });

  it("encaminhar para a própria área é recusado", () => {
    // Sem isto a IA se transfere para si mesma: a reentrada do turno é gasta, o
    // recibo seco volta ("não escreva nada") e o cliente fica sem resposta.
    const run = fonte.slice(fonte.indexOf('run: async (input: { area: string'), fonte.indexOf('if (input.area === "NAO_CONTRATADO")'));
    expect(run).toMatch(/input\.area === ctx\.conversa\.agente/);
    expect(run).toMatch(/Você JÁ está em/);
  });
});

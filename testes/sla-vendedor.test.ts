// O SLA do vendedor: os casos que decidem um número que vai ser usado para
// cobrar gente.
//
// Testes PUROS de propósito — sem banco, sem Prisma. A conta que penaliza um
// corretor precisa ser provável em milissegundos, e nada aqui depende de a
// máquina ter Postgres.
//
// ─── FUSO ───────────────────────────────────────────────────────────────────
//
// Uma régua de "10 minutos" é subtração de dois instantes e é IMUNE a fuso — e
// tem que continuar assim. As datas abaixo são escritas com offset explícito
// (`-03:00`) justamente para que a suíte rodando em `TZ=UTC` (o portão 5 do
// deploy) e em `TZ=America/Sao_Paulo` (a produção) veja exatamente o mesmo
// resultado. O teste "o relógio não sabe que horas são" prende esse invariante:
// se alguém trocar a subtração por `getHours()`, ele quebra numa das duas.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  AMOSTRA_MINIMA,
  SLA_VENDEDOR_MINUTOS_PADRAO,
  estadoDaPassagem,
  formatarEspera,
  formatarPercentualSla,
  resumirSla,
  segundosDeResposta,
  slaEmSegundos,
  slaPorVendedor,
  tomDoSla,
  type PassagemMedida,
} from "@/lib/sla-vendedor";

const SLA = 10 * 60; // segundos
/** Um instante de Brasília, escrito com o offset na mão. */
const sp = (hhmm: string, dia = 20) => new Date(`2026-08-${dia}T${hhmm}:00-03:00`);

function passagem(p: Partial<PassagemMedida> = {}): PassagemMedida {
  return { corretorId: 7, passouEm: sp("14:20"), respondidoEm: null, ...p };
}

describe("estadoDaPassagem — quem entra no denominador", () => {
  it("respondeu em 6 min: dentro", () => {
    const p = passagem({ respondidoEm: sp("14:26") });
    expect(estadoDaPassagem(p, SLA, sp("18:00"))).toBe("DENTRO");
  });

  it("respondeu em 11 min: fora", () => {
    const p = passagem({ respondidoEm: sp("14:31") });
    expect(estadoDaPassagem(p, SLA, sp("18:00"))).toBe("FORA");
  });

  it("exatamente 10 min ainda é dentro — o corte é <=, não <", () => {
    const p = passagem({ respondidoEm: sp("14:30") });
    expect(estadoDaPassagem(p, SLA, sp("18:00"))).toBe("DENTRO");
  });

  it("sem resposta e ainda no prazo: PENDENTE, e por isso fora da conta", () => {
    // Este é o caso que quase todo painel de SLA erra. Contar como falha faria
    // o percentual do corretor piorar sozinho a cada lead novo que ele recebe —
    // no exato instante em que ele ainda está dentro do prazo.
    expect(estadoDaPassagem(passagem(), SLA, sp("14:29"))).toBe("PENDENTE");
  });

  it("sem resposta e com o prazo vencido: fora", () => {
    expect(estadoDaPassagem(passagem(), SLA, sp("14:36"))).toBe("FORA");
  });

  it("o lead saiu da mão dele antes do prazo: não é falha dele", () => {
    // Reatribuído às 14:25, sem ter respondido. Ele teve 5 dos 10 minutos: o
    // tempo que passou DEPOIS não é dele, e cobrá-lo por isso puniria o
    // vendedor pela decisão do gestor de tirar o lead.
    const p = passagem({ encerradoEm: sp("14:25") });
    expect(estadoDaPassagem(p, SLA, sp("23:59"))).toBe("PENDENTE");
  });

  it("o lead saiu da mão dele DEPOIS do prazo: continua sendo falha dele", () => {
    const p = passagem({ encerradoEm: sp("16:00") });
    expect(estadoDaPassagem(p, SLA, sp("23:59"))).toBe("FORA");
  });
});

describe("segundosDeResposta — o que não pode virar zero", () => {
  it("resposta anterior à passagem é DESCARTADA, não zerada", () => {
    // Evento fora de ordem existe (a uazapi reentrega `messages_update`
    // atrasado). Zero mentiria para baixo no p50, fabricando um atendimento
    // instantâneo que nunca aconteceu.
    const p = passagem({ passouEm: sp("14:20"), respondidoEm: sp("14:19") });
    expect(segundosDeResposta(p)).toBeNull();
  });

  it("mede em segundos, do carimbo da passagem ao da resposta", () => {
    expect(segundosDeResposta(passagem({ respondidoEm: sp("14:26") }))).toBe(360);
  });
});

describe("resumirSla — os números da tela", () => {
  it("percentual é sobre as DECIDIDAS; pendente não entra", () => {
    const r = resumirSla(
      [
        passagem({ respondidoEm: sp("14:25") }), // dentro
        passagem({ respondidoEm: sp("14:45") }), // fora
        passagem({ passouEm: sp("14:28") }), // pendente às 14:30
      ],
      SLA,
      sp("14:30")
    );
    expect(r.dentro).toBe(1);
    expect(r.fora).toBe(1);
    expect(r.pendentes).toBe(1);
    expect(r.percentualDentro).toBe(0.5);
  });

  it("nada decidido devolve null, NUNCA 0%", () => {
    // "Número inventado num painel de decisão é pior que espaço vazio, porque
    // alguém demite corretor por causa dele" — a própria /dados-comerciais.
    const r = resumirSla([passagem({ passouEm: sp("14:28") })], SLA, sp("14:30"));
    expect(r.percentualDentro).toBeNull();
    expect(formatarPercentualSla(r.percentualDentro)).toBe("—");
  });

  it("mediana, não média: dois leads de três dias não afundam dezoito de 4 min", () => {
    const passagens = [
      ...Array.from({ length: 18 }, () => passagem({ respondidoEm: sp("14:24") })),
      passagem({ respondidoEm: sp("14:20", 23) }), // 3 dias depois
      passagem({ respondidoEm: sp("14:20", 23) }),
    ];
    const r = resumirSla(passagens, SLA, sp("14:20", 24));
    // A MEDIANA é o número que vai na tela primeiro: ela descreve o dia normal
    // do vendedor. Uma média aqui daria ~7 horas e não descreveria nada.
    expect(r.p50Segundos).toBe(240); // 4 min
    // E o p95 SOBE com a cauda, que é o desejado: aqui o atraso é o pecado que
    // se quer medir, não um erro de pareamento como em metricas-entrega.ts.
    expect(r.p95Segundos).toBe(3 * 24 * 3600);
  });

  it("as não respondidas aparecem: sem elas a mediana mente", () => {
    // Quem respondeu 2 de 20 leads em 30 segundos teria a melhor mediana da
    // casa. `naoRespondidas` é o que impede essa leitura.
    const r = resumirSla(
      [
        passagem({ respondidoEm: sp("14:21") }),
        passagem({ respondidoEm: sp("14:21") }),
        ...Array.from({ length: 18 }, () => passagem()),
      ],
      SLA,
      sp("18:00")
    );
    expect(r.amostras).toBe(2);
    expect(r.naoRespondidas).toBe(18);
    expect(r.percentualDentro).toBe(2 / 20);
  });
});

describe("slaPorVendedor — por PESSOA, que é a diferença para /admin/entrega", () => {
  it("separa por corretor e mantém a passagem SEM DONO na lista", () => {
    const linhas = slaPorVendedor(
      [
        { ...passagem({ respondidoEm: sp("14:25") }), corretorId: 7 },
        { ...passagem({ respondidoEm: sp("15:25") }), corretorId: 9 },
        // Rodízio desligado: entregue à casa, sem dono. É o caso que mais
        // precisa aparecer — some do painel se alguém filtrar null "para
        // limpar".
        { ...passagem({ respondidoEm: sp("14:22") }), corretorId: null },
      ],
      SLA,
      sp("18:00")
    );
    expect(linhas).toHaveLength(3);
    expect(linhas.map((l) => l.corretorId)).toContain(null);
    // Pior primeiro: quem abre a tela precisa ver o problema.
    expect(linhas[0].corretorId).toBe(9);
    expect(linhas[0].percentualDentro).toBe(0);
  });
});

describe("tomDoSla — amostra pequena não pinta ninguém de vermelho", () => {
  it(`abaixo de ${AMOSTRA_MINIMA} passagens decididas não ganha cor`, () => {
    // Mesma régua de /admin/entrega ("um p95 sobre 4 atendimentos não sustenta
    // um vermelho") — só que aqui o vermelho acusa uma PESSOA.
    expect(tomDoSla(0, AMOSTRA_MINIMA - 1)).toBe("default");
  });

  it("com amostra, 0% é vermelho e 100% é verde", () => {
    expect(tomDoSla(0, AMOSTRA_MINIMA)).toBe("bad");
    expect(tomDoSla(1, AMOSTRA_MINIMA)).toBe("good");
  });

  it("nada decidido nunca ganha cor, por mais leads que existam", () => {
    expect(tomDoSla(null, 500)).toBe("default");
  });
});

describe("o relógio não sabe que horas são", () => {
  // Se alguém trocar a subtração de instantes por `getHours()`/`getDate()`,
  // este teste quebra em UM dos dois fusos — e é por isso que o portão do
  // deploy roda a suíte em TZ=UTC.
  it("passagem 23:58 e resposta 00:03 do dia seguinte são 5 minutos", () => {
    const p = passagem({ passouEm: sp("23:58", 20), respondidoEm: sp("00:03", 21) });
    expect(segundosDeResposta(p)).toBe(300);
    expect(estadoDaPassagem(p, SLA, sp("12:00", 21))).toBe("DENTRO");
  });

  it("o mesmo instante escrito em UTC dá o mesmo resultado", () => {
    // 14:20 BRT == 17:20 UTC. Mesma passagem, escrita dos dois jeitos.
    const brt = passagem({
      passouEm: new Date("2026-08-20T14:20:00-03:00"),
      respondidoEm: new Date("2026-08-20T14:26:00-03:00"),
    });
    const utc = passagem({
      passouEm: new Date("2026-08-20T17:20:00Z"),
      respondidoEm: new Date("2026-08-20T17:26:00Z"),
    });
    expect(segundosDeResposta(brt)).toBe(segundosDeResposta(utc));
  });
});

describe("formatação", () => {
  it("segundos, minutos, horas e dias — nunca 4.812 s", () => {
    expect(formatarEspera(null)).toBe("—");
    expect(formatarEspera(45)).toBe("45 s");
    expect(formatarEspera(360)).toBe("6 min");
    expect(formatarEspera(390)).toBe("6 min 30 s");
    expect(formatarEspera(4812)).toBe("1 h 20 min");
    expect(formatarEspera(3 * 86400)).toBe("3 d");
  });

  it("0% e 'nada decidido' não viram o mesmo texto", () => {
    expect(formatarPercentualSla(0)).toBe("0%");
    expect(formatarPercentualSla(null)).toBe("—");
  });
});

describe("a régua da casa", () => {
  it("o padrão é o número da reunião de 26/08: 10 minutos", () => {
    // Doc viva: se alguém mudar o default sem mudar a conversa com o cliente,
    // este teste é o que acusa.
    expect(SLA_VENDEDOR_MINUTOS_PADRAO).toBe(10);
    expect(slaEmSegundos(null)).toBe(600);
  });

  it("configuração da casa vence o padrão", () => {
    expect(slaEmSegundos(15)).toBe(900);
  });

  it("zero ou negativo caem no padrão em vez de zerar a régua", () => {
    // Régua de 0 segundos faria toda passagem estourar no instante em que nasce.
    expect(slaEmSegundos(0)).toBe(600);
    expect(slaEmSegundos(-5)).toBe(600);
  });
});

// ─── Doc viva: o carimbo mora num lugar só, e em TODOS os caminhos ──────────
//
// Regra da casa (memória `doc-viva-por-mecanismo`): afirmação em comentário sem
// teste que a reconte apodrece. O defeito que este trabalho conserta era
// exatamente esse — o carimbo existia em 2 de ~5 caminhos e ninguém notava.
describe("todos os caminhos de entrega carimbam a passagem", () => {
  const fonte = (p: string) => readFileSync(p, "utf8");

  it("a entrega ao corretor carimba, e FORA do try do rodízio", () => {
    const s = fonte("lib/distribuicao.ts");
    expect(s).toMatch(/registrarPassagem/);
    // `avisarCorretorDoLead` já está documentado como fora do try — o carimbo
    // vem depois dele, logo também está. Amarrar na ordem é o jeito de detectar
    // alguém movendo a chamada para dentro do `try` do rodízio, que é
    // literalmente o bug original.
    expect(s.indexOf("registrarPassagem({ leadId")).toBeGreaterThan(
      s.indexOf("avisarCorretorDoLead(leadId)")
    );
  });

  it("a reatribuição manual carimba", () => {
    const s = fonte("lib/distribuicao.ts");
    expect(s).toMatch(/gatilho: "MANUAL"/);
  });

  it("o fim da cadência da IA carimba", () => {
    expect(fonte("lib/followup.ts")).toMatch(/gatilho: "FIM_CADENCIA_IA"/);
  });

  it("a entrega do card do CRM carimba", () => {
    expect(fonte("lib/entrega-ia.ts")).toMatch(/gatilho: "CRM"/);
  });

  it("só ATENDENTE fecha o relógio — a IA não", () => {
    // A regra que decide o número: se a IA fechasse, o follow-up automático
    // daria 100% de SLA para a casa inteira.
    const s = fonte("lib/sla-fechamento.ts");
    expect(s).toMatch(/autor: "ATENDENTE"/);
    expect(s).not.toMatch(/autor: \{ in: \["IA", "ATENDENTE"\] \}/);
  });

  it("o webhook CRIA a conversa do primeiro fromMe em vez de descartá-la", () => {
    // O bug: `if (conversa)` sem `else`. A primeira mensagem do corretor a um
    // lead recém-atribuído não tem conversa naquela instância — e era
    // exatamente o evento que define o SLA.
    const s = fonte("app/api/webhooks/uazapi/route.ts");
    expect(s).toMatch(/conversaParaMensagemDoNegocio/);
    expect(s).toMatch(/fecharSlaPorTelefone/);
  });
});

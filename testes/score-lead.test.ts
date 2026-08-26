// O score, cobrado nas três regras que o tornam honesto.
//
// Este arquivo existe porque um score é a coisa mais fácil de aceitar sem
// conferir: o número aparece, parece autoridade, e ninguém volta para
// perguntar de onde veio. Três lugares do sistema recusaram um score por
// escrito antes deste (lib/contatos.ts, components/painel-lead.tsx,
// lib/tinder-imoveis.ts), e a recusa era CONDICIONAL — valia enquanto não
// houvesse dado real. O que estes testes protegem é exatamente a condição.
import { describe, expect, it } from "vitest";
import { BLOCOS_MINIMOS, PESO_BLOCO, scoreDoLead, type EntradaScore } from "@/lib/score-lead";
import type { Respostas } from "@/lib/qualificacao";

const AGORA = new Date("2026-08-11T12:00:00Z");
const diasAtras = (n: number) => new Date(AGORA.getTime() - n * 86_400_000);

// Uma ficha cheia e saudável: renda familiar de 3.5x a parcela pretendida.
const FICHA_CHEIA: Respostas = {
  primeiroImovel: true,
  vinculo: "CLT",
  tresAnosRegistro: true,
  dependentes: 1,
  rendaBrutaMensal: 7000,
  dataNascimento: new Date("1990-01-01"),
  temFgts: true,
  estadoCivil: "SOLTEIRO",
  rendaDeclaradaIr: true,
  nomeRestrito: false,
  quartosDesejados: 2,
  banheirosDesejados: 1,
  localizacaoDesejada: "Centro",
  entradaDisponivel: 30000,
  querParcelarEntrada: false,
  parcelaDesejada: 2000,
};

describe("sem base, não há nota — e a tela diz o que perguntar", () => {
  it("lead recém-criado não ganha número nenhum", () => {
    // Só temperatura MORNO, que é o DEFAULT da coluna. Nada foi perguntado,
    // ninguém respondeu, ninguém avaliou. Uma nota aqui seria invenção pura.
    const r = scoreDoLead({ temperatura: "MORNO" }, AGORA);
    expect(r.nota).toBeNull();
    expect(r.faltando.length).toBeGreaterThan(0);
  });

  it("um bloco só com dado ainda não é nota", () => {
    // Conversando hoje, mas nada mais. Um bloco de quatro é repetir o único
    // campo preenchido com cara de conclusão.
    const r = scoreDoLead(
      { ultimaRespostaDoCliente: AGORA, mensagensDoCliente: 9 },
      AGORA
    );
    expect(r.blocos.filter((b) => b.pontos != null)).toHaveLength(1);
    expect(r.nota).toBeNull();
  });

  it("dois blocos com dado já bastam", () => {
    const r = scoreDoLead(
      { ultimaRespostaDoCliente: AGORA, mensagensDoCliente: 9, visitaEm: diasAtras(-2) },
      AGORA
    );
    expect(r.blocos.filter((b) => b.pontos != null).length).toBeGreaterThanOrEqual(BLOCOS_MINIMOS);
    expect(r.nota).not.toBeNull();
  });

  it("ficha vazia é AUSÊNCIA de dado, não completude zero", () => {
    // Se "nenhuma resposta" virasse 0 pontos, todo lead novo teria um bloco
    // pontuado e a regra dos dois blocos deixaria de proteger quem chegou
    // agora — que é justamente quem ela existe para proteger.
    const r = scoreDoLead({ ficha: {} }, AGORA);
    expect(r.blocos.find((b) => b.nome === "Completude")!.pontos).toBeNull();
  });
});

describe("bloco sem dado sai da conta, e não vira zero", () => {
  it("o denominador encolhe em vez de punir o que ninguém perguntou", () => {
    // Só engajamento e urgência. Se Capacidade e Completude valessem zero, a
    // nota seria ~50 — e diria "meia-boca" sobre um lead do qual só sabemos
    // coisas boas.
    const entrada: EntradaScore = {
      ultimaRespostaDoCliente: AGORA,
      mensagensDoCliente: 12,
      visitaEm: diasAtras(-1),
    };
    const r = scoreDoLead(entrada, AGORA);
    expect(r.nota).toBe(100);
    expect(r.blocos.find((b) => b.nome === "Capacidade")!.pontos).toBeNull();
    expect(r.blocos.find((b) => b.nome === "Completude")!.pontos).toBeNull();
  });

  it("a nota é a soma dos blocos COM dado sobre o máximo deles", () => {
    // A conta que o ⓘ do cartão mostra tem que fechar com o número exibido.
    // Divergir aqui é a forma mais rápida de a tela perder credibilidade.
    const r = scoreDoLead(
      { ficha: FICHA_CHEIA, temperatura: "QUENTE", ultimaRespostaDoCliente: diasAtras(2), mensagensDoCliente: 8 },
      AGORA
    );
    const comDado = r.blocos.filter((b) => b.pontos != null);
    const obtidos = comDado.reduce((s, b) => s + b.pontos!, 0);
    const possiveis = comDado.reduce((s, b) => s + b.max, 0);
    expect(r.nota).toBe(Math.round((obtidos / possiveis) * 100));
  });

  it("todo bloco vale o mesmo — pesos equilibrados, decisão do dono", () => {
    const r = scoreDoLead({ ficha: FICHA_CHEIA }, AGORA);
    for (const b of r.blocos) expect(b.max).toBe(PESO_BLOCO);
  });
});

describe("todo bloco se explica em português", () => {
  it("nenhum `porque` sai vazio, com ou sem dado", () => {
    for (const entrada of [
      {},
      { ficha: FICHA_CHEIA },
      { temperatura: "QUENTE", ultimaRespostaDoCliente: AGORA, mensagensDoCliente: 3 },
    ] as EntradaScore[]) {
      for (const b of scoreDoLead(entrada, AGORA).blocos) {
        expect(b.porque.trim().length, `${b.nome}`).toBeGreaterThan(0);
      }
    }
  });

  it("a capacidade mostra a RAZÃO, que é a régua de mercado", () => {
    const r = scoreDoLead({ ficha: FICHA_CHEIA }, AGORA);
    expect(r.blocos.find((b) => b.nome === "Capacidade")!.porque).toMatch(/3,5x a parcela/);
  });
});

describe("capacidade", () => {
  it("nome restrito sem outro titular zera — e isso NÃO é falta de dado", () => {
    // Aqui nós sabemos, e é o que o corretor precisa ler antes de ligar.
    const r = scoreDoLead(
      { ficha: { ...FICHA_CHEIA, nomeRestrito: true, temOutroTitular: false } },
      AGORA
    );
    const b = r.blocos.find((x) => x.nome === "Capacidade")!;
    expect(b.pontos).toBe(0);
    expect(b.porque).toMatch(/restrito/i);
  });

  it("renda maior sobre a mesma parcela dá nota maior", () => {
    const magra = scoreDoLead({ ficha: { ...FICHA_CHEIA, rendaBrutaMensal: 4000 } }, AGORA);
    const folgada = scoreDoLead({ ficha: { ...FICHA_CHEIA, rendaBrutaMensal: 9000 } }, AGORA);
    const p = (x: typeof magra) => x.blocos.find((b) => b.nome === "Capacidade")!.pontos!;
    expect(p(folgada)).toBeGreaterThan(p(magra));
  });
});

describe("urgência", () => {
  it("MORNO não conta como sinal — é o default da coluna", () => {
    // Sem esta regra, todo lead recém-criado entraria com meia nota de urgência
    // sem ninguém ter olhado para ele.
    const r = scoreDoLead({ temperatura: "MORNO" }, AGORA);
    expect(r.blocos.find((b) => b.nome === "Urgência")!.pontos).toBeNull();
  });

  it("QUENTE e FRIO contam, porque alguém (ou a IA) avaliou", () => {
    const quente = scoreDoLead({ temperatura: "QUENTE" }, AGORA);
    const frio = scoreDoLead({ temperatura: "FRIO" }, AGORA);
    const p = (x: typeof quente) => x.blocos.find((b) => b.nome === "Urgência")!.pontos!;
    expect(p(quente)).toBeGreaterThan(p(frio));
  });

  it("visita marcada vale mais que qualquer temperatura", () => {
    const comVisita = scoreDoLead({ temperatura: "FRIO", visitaEm: diasAtras(-1) }, AGORA);
    const soQuente = scoreDoLead({ temperatura: "QUENTE" }, AGORA);
    const p = (x: typeof comVisita) => x.blocos.find((b) => b.nome === "Urgência")!.pontos!;
    expect(p(comVisita)).toBeGreaterThan(p(soQuente));
  });

  it("visita que JÁ passou não conta como urgência futura", () => {
    const r = scoreDoLead({ visitaEm: diasAtras(3) }, AGORA);
    expect(r.blocos.find((b) => b.nome === "Urgência")!.pontos).toBeNull();
  });
});

describe("engajamento", () => {
  it("quem respondeu hoje vale mais que quem respondeu há um mês", () => {
    const hoje = scoreDoLead({ ultimaRespostaDoCliente: AGORA, mensagensDoCliente: 5 }, AGORA);
    const velho = scoreDoLead({ ultimaRespostaDoCliente: diasAtras(30), mensagensDoCliente: 5 }, AGORA);
    const p = (x: typeof hoje) => x.blocos.find((b) => b.nome === "Engajamento")!.pontos!;
    expect(p(hoje)).toBeGreaterThan(p(velho));
  });

  it("uma mensagem só é passagem, não conversa", () => {
    // "esse ainda tá disponível?" e nunca mais não pode valer o mesmo que uma
    // troca de vinte mensagens no mesmo dia.
    const passagem = scoreDoLead({ ultimaRespostaDoCliente: AGORA, mensagensDoCliente: 1 }, AGORA);
    const conversa = scoreDoLead({ ultimaRespostaDoCliente: AGORA, mensagensDoCliente: 20 }, AGORA);
    const p = (x: typeof passagem) => x.blocos.find((b) => b.nome === "Engajamento")!.pontos!;
    expect(p(passagem)).toBeLessThan(p(conversa));
  });

  it("só a nossa mensagem não é engajamento", () => {
    // O que mede interesse é o cliente VOLTAR, não nós insistirmos.
    const r = scoreDoLead({ mensagensDoCliente: 0 }, AGORA);
    expect(r.blocos.find((b) => b.nome === "Engajamento")!.pontos).toBeNull();
  });
});

describe("o mesmo lead dá sempre a mesma nota", () => {
  it("é determinístico — nada de Math.random nem relógio escondido", () => {
    const entrada: EntradaScore = {
      ficha: FICHA_CHEIA,
      temperatura: "QUENTE",
      ultimaRespostaDoCliente: diasAtras(1),
      mensagensDoCliente: 7,
    };
    const notas = new Set(Array.from({ length: 20 }, () => scoreDoLead(entrada, AGORA).nota));
    expect(notas.size).toBe(1);
  });

  // Herdado da suíte que este arquivo substituiu (o score de 10/08, que usava
  // `calcularScore`). A API mudou, o invariante não: o `agora` entra por
  // parâmetro, e nada aqui olha o relógio do processo. Sem isto, o teste passa
  // hoje e falha à meia-noite — e o mesmo lead muda de nota entre dois cliques.
  it("não lê o relógio do processo — o `agora` entra por parâmetro", () => {
    const entrada: EntradaScore = {
      ficha: FICHA_CHEIA,
      temperatura: "QUENTE",
      ultimaRespostaDoCliente: diasAtras(2),
      mensagensDoCliente: 7,
    };
    const emAgosto = scoreDoLead(entrada, AGORA).nota;
    // Um ano depois, com a MESMA distância entre a resposta e o "agora", a nota
    // tem que ser idêntica: o que pontua é a distância, não a data.
    const daquiUmAno = new Date(AGORA.getTime() + 365 * 86_400_000);
    const mesmaDistancia = scoreDoLead(
      { ...entrada, ultimaRespostaDoCliente: new Date(daquiUmAno.getTime() - 2 * 86_400_000) },
      daquiUmAno
    ).nota;
    expect(mesmaDistancia).toBe(emAgosto);
  });
});

// Herdados da suíte anterior, e mantidos porque continuam sendo o que impede a
// nota de virar um número sem sentido na tela. A implementação mudou (os pontos
// agora são degraus fixos em vez de conta contínua), então eles deixaram de ser
// possíveis por construção — mas é exatamente por isso que ficam: o dia em que
// alguém voltar a calcular pontos por regra de três, o teto e o piso já estão
// cobrados.
describe("a nota vive dentro de 0–100, sempre", () => {
  it("nunca passa de 100, nem com renda absurda", () => {
    const r = scoreDoLead(
      {
        ficha: { ...FICHA_CHEIA, rendaBrutaMensal: 900_000, parcelaDesejada: 1 },
        temperatura: "QUENTE",
        visitaEm: new Date(AGORA.getTime() + 86_400_000),
        ultimaRespostaDoCliente: AGORA,
        mensagensDoCliente: 400,
      },
      AGORA
    );
    expect(r.nota).not.toBeNull();
    expect(r.nota!).toBeLessThanOrEqual(100);
    for (const b of r.blocos) if (b.pontos != null) expect(b.pontos).toBeLessThanOrEqual(b.max);
  });

  it("nunca é negativo, nem no lead mais frio possível", () => {
    const r = scoreDoLead(
      {
        ficha: { ...FICHA_CHEIA, rendaBrutaMensal: 1, parcelaDesejada: 90_000 },
        temperatura: "FRIO",
        ultimaRespostaDoCliente: diasAtras(400),
        mensagensDoCliente: 1,
      },
      AGORA
    );
    expect(r.nota).not.toBeNull();
    expect(r.nota!).toBeGreaterThanOrEqual(0);
    for (const b of r.blocos) if (b.pontos != null) expect(b.pontos).toBeGreaterThanOrEqual(0);
  });
});

// ── A REGRESSÃO QUE MOTIVOU A TROCA DE IMPLEMENTAÇÃO ───────────────────────
//
// O score anterior (`calcularScore`, 10/08) tinha a mesma regra escrita no
// cabeçalho — "abaixo de dois blocos com dado não há nota" — e ela NUNCA
// disparava em produção. O motivo não estava na regra, estava no adapter:
//
//   · `temperatura` é NOT NULL com `@default(MORNO)` no schema, e o bloco de
//     urgência de lá contava MORNO como sinal (2.5 pontos);
//   · `ultimaRespostaDoClienteEm` recebia `lead.atualizadoEm`, que é
//     `@updatedAt` — nunca nulo, e movido por QUALQUER escrita na linha.
//
// Com os dois sempre preenchidos, dois blocos sempre tinham dado. Medido nas 18
// combinações possíveis de (temperatura × etapa × visita) para um lead sem
// ficha nenhuma: 18 com nota, 0 sem. Um lead criado há um segundo, que ninguém
// olhou, saía com "30" e o texto "respondeu hoje" — sobre alguém que nunca
// escreveu uma linha.
//
// Este teste é o que impede a volta: ele cobra o CASO, não a implementação.
describe("lead que ninguém tocou não recebe nota de consolo", () => {
  it("recém-criado, ficha vazia, MORNO e sem nenhuma resposta do cliente ⇒ sem nota", () => {
    const r = scoreDoLead(
      {
        ficha: null,
        // O default da coluna, não uma avaliação de ninguém.
        temperatura: "MORNO",
        status: "NOVO",
        visitaEm: null,
        // O cliente NUNCA respondeu. Não é "respondeu hoje".
        ultimaRespostaDoCliente: null,
        mensagensDoCliente: null,
      },
      AGORA
    );
    expect(r.nota).toBeNull();
    expect(r.faltando.length).toBeGreaterThan(0);
  });

  it("MORNO sozinho não é sinal de urgência, em nenhuma etapa do funil", () => {
    for (const status of ["NOVO", "ATENDIMENTO", "VISITA_AGENDADA"]) {
      const r = scoreDoLead(
        { ficha: null, temperatura: "MORNO", status, ultimaRespostaDoCliente: null },
        AGORA
      );
      expect(r.blocos.find((b) => b.nome === "Urgência")!.pontos, `status=${status}`).toBeNull();
      expect(r.nota, `status=${status}`).toBeNull();
    }
  });
});

import { describe, expect, it } from "vitest";
import {
  CADENCIA_VENDEDOR_HORAS,
  HORAS_ATE_ESCALONAR,
  JANELA_COBRANCA_HORAS,
  TOTAL_TOQUES_VENDEDOR,
  dentroDaJanelaDeCobranca,
  ehConfirmacaoDeFollow,
  haQuantoTempo,
  precisaEscalonar,
  proximoToqueDoVendedor,
  textoDaCobranca,
  textoDoEscalonamento,
  type PassagemDoVendedor,
} from "@/lib/cadencia-vendedor";

// Horário de parede de São Paulo (UTC-3) escrito em UTC, para o teste não
// depender do fuso da máquina. Mesmo padrão de lib/atividades-cadencia.test.ts:12
// — e é o que faz a suíte passar tanto no portão do deploy (TZ=UTC) quanto na
// produção (TZ=America/Sao_Paulo).
const sp = (dia: number, hora: number, min = 0) =>
  new Date(Date.UTC(2026, 7, dia, hora + 3, min, 0));

// 03/08/2026 é uma SEGUNDA. Os dias usados abaixo dependem disso.
const passagem = (over: Partial<PassagemDoVendedor> = {}): PassagemDoVendedor => ({
  leadId: 1,
  passouEm: sp(3, 14, 20), // segunda, 14:20
  respondidoEm: null,
  toquesEnviados: 0,
  escalonadoEm: null,
  ...over,
});

describe("os números são a regra de negócio", () => {
  // Doc viva: o PLANO-CADENCIA-SLA-26-08.md e o relatório desta frente citam
  // "3 toques" e "o primeiro degrau é em minutos". Número em documento sem
  // teste que o reconte apodrece em silêncio.
  it("são três toques, nem mais nem menos", () => {
    expect(CADENCIA_VENDEDOR_HORAS).toHaveLength(3);
    expect(TOTAL_TOQUES_VENDEDOR).toBe(3);
  });

  it("o primeiro degrau é em MINUTOS, não em dias", () => {
    // O erro que este teste existe para pegar: alguém "arredondar" 0.25 para 24
    // por simetria com as outras cadências, e o lembrete do SLA de 10 minutos
    // virar um laudo do dia seguinte.
    expect(CADENCIA_VENDEDOR_HORAS[0]).toBeLessThan(1);
    expect(CADENCIA_VENDEDOR_HORAS[0]! * 60).toBe(15);
  });

  it("a cadência é crescente e o escalonamento vem depois do último toque", () => {
    for (let i = 1; i < CADENCIA_VENDEDOR_HORAS.length; i++)
      expect(CADENCIA_VENDEDOR_HORAS[i]!).toBeGreaterThan(CADENCIA_VENDEDOR_HORAS[i - 1]!);
    expect(HORAS_ATE_ESCALONAR).toBeGreaterThan(
      CADENCIA_VENDEDOR_HORAS[CADENCIA_VENDEDOR_HORAS.length - 1]!
    );
    // E cabe dentro da janela: fora dela não há cobrança nem escalonamento, e
    // um escalonamento inalcançável seria a promessa ao Samuel que nunca sai.
    expect(HORAS_ATE_ESCALONAR).toBeLessThanOrEqual(JANELA_COBRANCA_HORAS);
  });
});

describe("o primeiro toque", () => {
  it("não sai antes dos 15 minutos", () => {
    expect(proximoToqueDoVendedor(passagem(), sp(3, 14, 29))).toBeNull();
  });

  it("sai assim que os 15 minutos vencem, dentro do expediente", () => {
    const t = proximoToqueDoVendedor(passagem(), sp(3, 14, 36));
    expect(t?.toque).toBe(1);
    expect(t?.quando).toEqual(sp(3, 14, 36)); // agora, não empurrado
    expect(t?.minutosEsperando).toBe(16);
  });
});

describe("quem já respondeu não é cobrado nunca mais", () => {
  it("respondeu em 6 min → null, mesmo com o degrau vencido", () => {
    const p = passagem({ respondidoEm: sp(3, 14, 26) });
    expect(proximoToqueDoVendedor(p, sp(3, 14, 36))).toBeNull();
  });

  it("respondeu → null também no fim da cadência, e sem escalonamento", () => {
    // O caso que decide se o corretor confia na cadência: ele respondeu no
    // primeiro minuto e mesmo assim o gestor recebe "cadência não cumprida".
    const p = passagem({ respondidoEm: sp(3, 14, 26), toquesEnviados: 3 });
    expect(proximoToqueDoVendedor(p, sp(5, 14, 30))).toBeNull();
    expect(precisaEscalonar(p, sp(5, 14, 30))).toBe(false);
  });
});

describe("o expediente do corretor empurra, não dispara", () => {
  it("toque vencido às 3h da manhã de terça vale só às 9h", () => {
    const p = passagem({ passouEm: sp(4, 2, 0), toquesEnviados: 0 });
    const t = proximoToqueDoVendedor(p, sp(4, 3, 0));
    expect(t?.toque).toBe(1);
    expect(t?.quando).toEqual(sp(4, 9, 0));
  });

  it("passagem na sexta 17:55 → o 2º toque cai na SEGUNDA às 9h, não no sábado", () => {
    // Sexta 07/08/2026. O 2º degrau (4h) vence 21:55 de sexta, fora do
    // expediente; o próximo dia útil é segunda 10/08.
    const p = passagem({ passouEm: sp(7, 17, 55), toquesEnviados: 1 });
    const t = proximoToqueDoVendedor(p, sp(7, 22, 0));
    expect(t?.toque).toBe(2);
    expect(t?.quando).toEqual(sp(10, 9, 0));
  });
});

describe("o fim da cadência é o gestor, não um quarto toque", () => {
  it("três toques enviados → proximoToqueDoVendedor devolve null", () => {
    const p = passagem({ toquesEnviados: 3 });
    expect(proximoToqueDoVendedor(p, sp(5, 10, 0))).toBeNull();
  });

  it("escalona só depois de HORAS_ATE_ESCALONAR", () => {
    const p = passagem({ toquesEnviados: 3 });
    // 24h depois da passagem: o 3º toque acabou de sair, ainda não escala.
    expect(precisaEscalonar(p, sp(4, 14, 20))).toBe(false);
    // 48h depois: escala.
    expect(precisaEscalonar(p, sp(5, 14, 20))).toBe(true);
  });

  it("não escalona com a cadência ainda em andamento", () => {
    expect(precisaEscalonar(passagem({ toquesEnviados: 2 }), sp(5, 14, 20))).toBe(false);
  });

  it("escalona UMA vez — a segunda passada do cron não repete", () => {
    const p = passagem({ toquesEnviados: 3, escalonadoEm: sp(5, 14, 20) });
    expect(precisaEscalonar(p, sp(5, 15, 0))).toBe(false);
    // E, escalado, também para de cobrar o corretor: o assunto passou de dono.
    expect(proximoToqueDoVendedor(p, sp(5, 15, 0))).toBeNull();
  });
});

describe("a janela de adoção impede a enxurrada do dia 1", () => {
  it("lead passado há 5 dias não entra na esteira", () => {
    // O acidente que isto evita está registrado em lib/followup.ts:456-461: uma
    // correção de bug quase disparou 192 mensagens de uma vez para leads
    // antigos. No dia em que a cobrança for ligada, o banco já tem lead
    // atribuído de meses atrás.
    const p = passagem({ passouEm: sp(3, 14, 20) });
    expect(dentroDaJanelaDeCobranca(p, sp(8, 14, 20))).toBe(false);
    expect(proximoToqueDoVendedor(p, sp(8, 14, 20))).toBeNull();
    expect(precisaEscalonar(passagem({ passouEm: sp(3, 14, 20), toquesEnviados: 3 }), sp(8, 14, 20))).toBe(
      false
    );
  });

  it("passagem com data no futuro (relógio torto) não cobra ninguém", () => {
    const p = passagem({ passouEm: sp(5, 10, 0) });
    expect(proximoToqueDoVendedor(p, sp(3, 10, 0))).toBeNull();
  });
});

describe("o texto da cobrança", () => {
  const lead = {
    nome: "Carlos Alberto",
    telefone: "17999998888",
    interesse: "Compra · Apartamento no Centro (AP-0002)",
    toque: 1,
    minutosEsperando: 38,
  };

  it("um lead: traz nome, espera, interesse, toque e link", () => {
    const t = textoDaCobranca([lead]);
    expect(t).toContain("Carlos Alberto");
    expect(t).toContain("há 38 min");
    expect(t).toContain("Apartamento no Centro (AP-0002)");
    expect(t).toContain("Toque 1 de 3");
    expect(t).toContain("https://wa.me/5517999998888");
  });

  it("N leads viram UMA mensagem, não N", () => {
    // Dez notificações seguidas do mesmo chip é o padrão de rajada que o
    // WhatsApp pune. Uma mensagem com a lista é a defesa.
    const t = textoDaCobranca([lead, { ...lead, nome: "Ana Paula", toque: 2 }]);
    expect(t).toContain("2 clientes esperando você");
    expect(t).toContain("Carlos Alberto");
    expect(t).toContain("Ana Paula");
    expect(t.split("\n\n")[0]).not.toContain("Ana Paula"); // um cabeçalho só
  });

  it("admite a dúvida do corretor que ligou em vez de mandar mensagem", () => {
    // Ligação não passa pela tabela Mensagem. Sem esta frase, a próxima parada
    // da cadência (o gestor) recebe um falso positivo sem saída.
    expect(textoDaCobranca([lead])).toContain("já falou com ele por telefone");
  });

  it("linha sem dado some inteira, não vira 'Interesse: —'", () => {
    const t = textoDaCobranca([{ ...lead, interesse: null }]);
    expect(t).not.toContain("Interesse:");
  });

  it("telefone inválido não gera link quebrado", () => {
    const t = textoDaCobranca([{ ...lead, telefone: "123" }]);
    expect(t).not.toContain("wa.me");
  });

  it("lista vazia não produz mensagem", () => {
    expect(textoDaCobranca([])).toBe("");
  });
});

describe("o texto do escalonamento", () => {
  const lead = {
    nome: "Carlos Alberto",
    telefone: "17999998888",
    interesse: null,
    toque: 3,
    minutosEsperando: 2880,
  };

  it("nomeia o corretor e diz o fato, sem veredito", () => {
    const t = textoDoEscalonamento({ corretor: "Gabriel Souza", leads: [lead] });
    expect(t).toContain("Gabriel Souza");
    expect(t).toContain("Cadência não cumprida");
    expect(t).toContain("há 2 dias");
  });

  it("avisa que ligação não aparece — o gestor precisa saber o limite da medida", () => {
    expect(textoDoEscalonamento({ corretor: "Gabriel", leads: [lead] })).toContain(
      "Ligação não aparece"
    );
  });

  it("lead sem dono (casa sem rodízio) escala mesmo assim", () => {
    const t = textoDoEscalonamento({ corretor: null, leads: [lead] });
    expect(t).toContain("nenhum");
    expect(t).toContain("Carlos Alberto");
  });
});

describe("haQuantoTempo", () => {
  it("escolhe a unidade que o corretor lê sem converter", () => {
    expect(haQuantoTempo(0)).toBe("agora há pouco");
    expect(haQuantoTempo(38)).toBe("há 38 min");
    expect(haQuantoTempo(59)).toBe("há 59 min");
    expect(haQuantoTempo(60)).toBe("há 1h");
    expect(haQuantoTempo(1439)).toBe("há 23h");
    expect(haQuantoTempo(1440)).toBe("há 1 dia");
    expect(haQuantoTempo(2880)).toBe("há 2 dias");
  });
});

describe("a palavra do corretor encerra a cobrança", () => {
  it("dispensada → não cobra e não escala", () => {
    const p = passagem({ toquesEnviados: 3, dispensadaEm: sp(3, 15, 0) });
    expect(proximoToqueDoVendedor(p, sp(5, 14, 20))).toBeNull();
    // Este é o teste que impede a cadência de acusar ao gestor quem fez o
    // follow por telefone — o falso positivo que o sistema não vê sozinho.
    expect(precisaEscalonar(p, sp(5, 14, 20))).toBe(false);
  });
});

describe("ehConfirmacaoDeFollow", () => {
  it("aceita o que alguém digita com uma mão no volante", () => {
    for (const t of ["ok", "OK!", "Blz", "já falei", "ja liguei", "feito.", "Resolvido"])
      expect(ehConfirmacaoDeFollow(t)).toBe(true);
  });

  it("aceita a confirmação com um complemento curto", () => {
    expect(ehConfirmacaoDeFollow("já falei com ele agora")).toBe(true);
  });

  it("NÃO fecha com uma pergunta que começa por 'ok'", () => {
    // O sintoma de errar aqui é a AUSÊNCIA de mensagens, que ninguém percebe:
    // o corretor usaria o Ajuda Corretor e desligaria a própria cobrança.
    expect(
      ehConfirmacaoDeFollow("ok, mas antes me manda a ficha do apartamento do Centro")
    ).toBe(false);
  });

  it("NÃO fecha com o uso normal do Ajuda Corretor", () => {
    expect(ehConfirmacaoDeFollow("quais imóveis temos em Dianópolis?")).toBe(false);
    expect(ehConfirmacaoDeFollow("")).toBe(false);
    expect(ehConfirmacaoDeFollow(null)).toBe(false);
  });

  it("'okapi' não é 'ok' — a palavra precisa terminar ali", () => {
    expect(ehConfirmacaoDeFollow("okapi")).toBe(false);
    expect(ehConfirmacaoDeFollow("simulação enviada")).toBe(false);
  });
});

// O aviso que sai para o corretor de plantão.
//
// Duas metades, testadas por caminhos diferentes de propósito:
//
//   O TEXTO é função pura, e é a parte que um humano lê no celular. Cada campo
//   ausente tem um caso próprio porque "some a linha inteira" é uma promessa —
//   a alternativa (rótulo com buraco do lado) já é o defeito.
//
//   O ENVIO roda com Prisma e WhatsApp mockados. O que ele prova é o que decide
//   comportamento: número não cadastrado não manda nada, a trava não deixa o
//   mesmo lead avisar duas vezes, e nada aqui joga exceção para cima — porque
//   acima está a resposta que o cliente espera no WhatsApp.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  encurtar,
  historicoDoLead,
  textoDoAviso,
  type DadosDoAviso,
} from "@/lib/aviso-lead";

// ── O texto ─────────────────────────────────────────────────────────────────

const MARIA: DadosDoAviso = {
  nome: "Maria Aparecida Souza",
  telefone: "(17) 98113-4070",
  origem: "VIVAREAL",
  finalidade: "COMPRA",
  interesse: "Residencial Vila Nova (Centro)",
  qualificacao: "7/7 perguntas · Faixa 2 · 3/5 documentos",
  historico: "Procura apartamento de 2 quartos no Centro, tem FGTS e quer parcelar a entrada.",
};

describe("o texto que o corretor recebe", () => {
  it("traz as cinco coisas que o dono pediu, cada uma no seu lugar", () => {
    const t = textoDoAviso(MARIA);
    expect(t).toContain("Nome: Maria Aparecida Souza"); // nome do cliente
    expect(t).toContain("Telefone: (17) 98113-4070"); // o número dele
    expect(t).toContain("Veio de: Viva Real"); // de onde caiu o lead
    expect(t).toContain("Interesse: Compra · Residencial Vila Nova (Centro)");
    expect(t).toContain("Como foi a conversa:"); // o pequeno histórico
    expect(t).toContain("apartamento de 2 quartos");
  });

  it("o nome completo fica INTEIRO — quem vai ligar precisa dele, não do apelido", () => {
    // Contraste deliberado com lib/abordagem-portal.ts, que cumprimenta o
    // cliente pelo primeiro nome. Aqui o leitor é o corretor.
    expect(textoDoAviso(MARIA)).toContain("Maria Aparecida Souza");
  });

  it("termina com o link de WhatsApp, que é a única parte acionável", () => {
    const t = textoDoAviso(MARIA);
    expect(t.trimEnd().endsWith("Chamar no WhatsApp: https://wa.me/5517981134070")).toBe(true);
  });

  it("traduz a origem em vez de despejar a chave do banco", () => {
    expect(textoDoAviso({ ...MARIA, origem: "OLX" })).toContain("Veio de: OLX");
    expect(textoDoAviso({ ...MARIA, origem: "FACEBOOK" })).toContain("Veio de: Facebook");
    expect(textoDoAviso({ ...MARIA, origem: "VIVAREAL" })).not.toContain("VIVAREAL");
  });

  it("sem telefone: não inventa linha vazia e não monta link quebrado", () => {
    // wa.me sem número abre "número inválido", e gastaria a única ação da
    // mensagem levando o corretor a um beco.
    const t = textoDoAviso({ ...MARIA, telefone: null });
    expect(t).not.toContain("Telefone:");
    expect(t).not.toContain("wa.me");
    expect(t).toContain("Nome: Maria Aparecida Souza");
  });

  it("telefone curto demais não vira link, mas continua escrito", () => {
    // O dígito que falta é do cadastro; o corretor ainda consegue conferir na
    // ficha. Esconder o número seria esconder o problema.
    const t = textoDoAviso({ ...MARIA, telefone: "98113-4070" });
    expect(t).toContain("Telefone: 98113-4070");
    expect(t).not.toContain("wa.me");
  });

  it("sem origem gravada, diz isso — não mente uma procedência", () => {
    expect(textoDoAviso({ ...MARIA, origem: null })).toContain("Veio de: sem origem");
  });

  it("sem imóvel/empreendimento, a finalidade sozinha ainda vale a linha", () => {
    // E sem o "·" pendurado, que é o que denuncia o campo montado por concatenação.
    expect(textoDoAviso({ ...MARIA, interesse: null })).toContain("Interesse: Compra\n");
    expect(textoDoAviso({ ...MARIA, interesse: null, finalidade: "LOCACAO" })).toContain(
      "Interesse: Locação\n"
    );
  });

  it("sem finalidade nem interesse, a linha inteira some", () => {
    const t = textoDoAviso({ ...MARIA, finalidade: null, interesse: null });
    expect(t).not.toContain("Interesse:");
  });

  it("sem ficha de qualificação, a linha some — não vira 'Qualificação: —'", () => {
    const t = textoDoAviso({ ...MARIA, qualificacao: null });
    expect(t).not.toContain("Qualificação:");
    expect(t).toContain("Nome: Maria Aparecida Souza");
  });

  it("sem histórico, o bloco inteiro some (rótulo incluído)", () => {
    const t = textoDoAviso({ ...MARIA, historico: null });
    expect(t).not.toContain("Como foi a conversa:");
    expect(t).toContain("Chamar no WhatsApp:");
  });

  it("com TUDO faltando, ainda sai uma mensagem que se sustenta de pé", () => {
    // O pior lead possível: nome e nada mais. A mensagem não pode virar uma
    // casca de rótulos vazios nem uma string em branco.
    const t = textoDoAviso({
      nome: "João",
      telefone: null,
      origem: null,
      finalidade: null,
      interesse: null,
      qualificacao: null,
      historico: null,
    });
    expect(t).toContain("Novo lead qualificado");
    expect(t).toContain("Nome: João");
    expect(t).toContain("Veio de: sem origem");
    expect(t).not.toMatch(/:\s*$/m); // nenhum rótulo sem valor
  });

  it("string em branco conta como ausente, não como valor", () => {
    // O banco guarda "" com a mesma facilidade com que guarda null, e um
    // `if (campo)` que não faz trim deixa passar "   ".
    const t = textoDoAviso({ ...MARIA, qualificacao: "   ", historico: "  ", interesse: " " });
    expect(t).not.toContain("Qualificação:");
    expect(t).not.toContain("Como foi a conversa:");
    expect(t).toContain("Interesse: Compra");
  });

  it("não carrega nada além do que foi pedido", () => {
    // A garantia é estrutural: o template só sabe imprimir os campos de
    // `DadosDoAviso`, e notasInternas/e-mail/CPF não estão nele. Este caso
    // prende isso — quem acrescentar um campo novo passa por aqui.
    const t = textoDoAviso(MARIA);
    expect(t.split("\n").filter((l) => l.includes(":")).map((l) => l.split(":")[0])).toEqual([
      "Nome",
      "Telefone",
      "Veio de",
      "Interesse",
      "Qualificação",
      "Como foi a conversa",
      "Chamar no WhatsApp",
    ]);
  });
});

// ── O histórico ─────────────────────────────────────────────────────────────

describe("o pequeno histórico da conversa", () => {
  it("prefere a MEMÓRIA da IA às mensagens cruas", () => {
    // A memória diz o que a pessoa quer; o fim da conversa costuma ser "ok".
    const h = historicoDoLead("Quer casa de 3 quartos até 400 mil, em Rio Preto.", [
      "ok",
      "obrigada",
    ]);
    expect(h).toBe("Quer casa de 3 quartos até 400 mil, em Rio Preto.");
  });

  it("sem memória, cai nas últimas falas do CLIENTE, entre aspas", () => {
    const h = historicoDoLead(null, ["quero um apê de 2 quartos", "pode ser no Centro, até 250 mil"]);
    expect(h).toBe('"quero um apê de 2 quartos"\n"pode ser no Centro, até 250 mil"');
  });

  it("descarta o 'ok' e o 'sim' — ocupam linha e não dizem nada", () => {
    const h = historicoDoLead(null, ["ok", "sim", "quero financiar pelo Minha Casa"]);
    expect(h).toBe('"quero financiar pelo Minha Casa"');
  });

  it("memória em branco não engole o plano B", () => {
    // "" e "   " são o que o banco guarda quando a memória ainda não foi
    // escrita; tratá-los como texto deixaria o histórico vazio para sempre.
    expect(historicoDoLead("   ", ["procuro apartamento no Centro"])).toBe(
      '"procuro apartamento no Centro"'
    );
  });

  it("sem memória e sem fala aproveitável, devolve null (e a seção some)", () => {
    expect(historicoDoLead(null, [])).toBeNull();
    expect(historicoDoLead(null, ["ok", "sim", "   "])).toBeNull();
    expect(textoDoAviso({ ...MARIA, historico: historicoDoLead(null, []) })).not.toContain(
      "Como foi a conversa:"
    );
  });

  it("normaliza a quebra de linha que o cliente mandou", () => {
    // Mensagem colada do teclado do celular vem com \n no meio; sem normalizar,
    // uma fala vira três linhas e a aspa de fechamento fica órfã.
    expect(historicoDoLead(null, ["quero\n\ncasa   grande"])).toBe('"quero casa grande"');
  });

  it("corta o texto longo sem partir palavra e AVISA que cortou", () => {
    const longo = "palavra ".repeat(200);
    const h = historicoDoLead(longo, [])!;
    expect(h.length).toBeLessThanOrEqual(430);
    expect(h.endsWith("…")).toBe(true);
    expect(h).not.toContain("palav…"); // não parte no meio da palavra
  });

  it("encurtar deixa em paz o que já cabe", () => {
    expect(encurtar("curto", 100)).toBe("curto");
    expect(encurtar("  com espaço em volta  ", 100)).toBe("com espaço em volta");
  });
});

// ── O envio ─────────────────────────────────────────────────────────────────
//
// O cliente de WhatsApp é MOCKADO: nenhum número real pode receber mensagem
// porque alguém rodou a suíte.

const enviarWhatsApp = vi.fn(async () => ({ enviado: true, provedor: "uazapi" }));
vi.mock("@/lib/whatsapp", () => ({ enviarWhatsApp: (...a: unknown[]) => enviarWhatsApp(...(a as [])) }));
vi.mock("@/lib/instancias", () => ({ idDaCasa: vi.fn(async () => 7) }));
vi.mock("@/lib/auditoria", () => ({ auditar: vi.fn(async () => {}) }));

/** O lead que o `findUnique` devolve. Cada caso muda só o que está testando. */
let leadNoBanco: Record<string, unknown> | null;
/** Quantas linhas o `updateMany` da trava acerta — 0 simula a corrida perdida. */
let travaAcerta = 1;
const updatesDeLead: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  prisma: {
    lead: {
      findUnique: vi.fn(async () => leadNoBanco),
      updateMany: vi.fn(async ({ where, data }: Record<string, Record<string, unknown>>) => {
        updatesDeLead.push({ where, data });
        // A devolução da trava (avisoCorretorEm: <data>) sempre acerta; a
        // reserva inicial (avisoCorretorEm: null) obedece ao cenário.
        return { count: where.avisoCorretorEm === null ? travaAcerta : 1 };
      }),
    },
    conversa: { findFirst: vi.fn(async () => ({ id: 1, memoria: "Quer apê de 2 quartos." })) },
    mensagem: { findMany: vi.fn(async () => []) },
  },
}));

const LEAD_PADRAO = {
  id: 10,
  imobiliariaId: 3,
  nome: "Maria Aparecida Souza",
  telefone: "(17) 98113-4070",
  origem: "VIVAREAL",
  finalidade: "COMPRA",
  avisoCorretorEm: null,
  imovel: null,
  empreendimento: null,
  qualificacao: null,
  imobiliaria: { avisoLeadTelefone: "(17) 99117-0597", bloqueadaEm: null },
};

describe("avisarCorretorDoLead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enviarWhatsApp.mockResolvedValue({ enviado: true, provedor: "uazapi" });
    leadNoBanco = { ...LEAD_PADRAO };
    travaAcerta = 1;
    updatesDeLead.length = 0;
  });

  it("com número cadastrado, manda UMA mensagem para ele", async () => {
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    const r = await avisarCorretorDoLead(10);

    expect(r.feito).toBe("enviado");
    expect(enviarWhatsApp).toHaveBeenCalledTimes(1);
    const [destino, texto, origem] = enviarWhatsApp.mock.calls[0] as unknown as [
      string,
      string,
      { instanciaId: number },
    ];
    expect(destino).toBe("(17) 99117-0597");
    expect(texto).toContain("Maria Aparecida Souza");
    expect(texto).toContain("Quer apê de 2 quartos.");
    // Sai pelo número DA CASA, não pelo do corretor dono do lead.
    expect(origem).toEqual({ instanciaId: 7 });
  });

  it("SEM número cadastrado não envia nada e não explode", async () => {
    // O estado de todo tenant no dia em que a migration sobe. É o caso que não
    // pode custar uma exceção no meio do atendimento.
    leadNoBanco = { ...LEAD_PADRAO, imobiliaria: { avisoLeadTelefone: null, bloqueadaEm: null } };
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    const r = await avisarCorretorDoLead(10);

    expect(r).toEqual({ feito: "nao", motivo: "nenhum número cadastrado" });
    expect(enviarWhatsApp).not.toHaveBeenCalled();
    // Nem sequer marca a trava: o lead continua elegível para quando a casa
    // cadastrar o número.
    expect(updatesDeLead).toHaveLength(0);
  });

  it("número em branco/espaço conta como não cadastrado", async () => {
    leadNoBanco = { ...LEAD_PADRAO, imobiliaria: { avisoLeadTelefone: "   ", bloqueadaEm: null } };
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    expect((await avisarCorretorDoLead(10)).feito).toBe("nao");
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("número cadastrado inválido não vira envio para um destino torto", async () => {
    leadNoBanco = {
      ...LEAD_PADRAO,
      imobiliaria: { avisoLeadTelefone: "99117-0597", bloqueadaEm: null },
    };
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    const r = await avisarCorretorDoLead(10);
    expect(r).toEqual({ feito: "nao", motivo: "número cadastrado é inválido" });
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("lead já avisado não avisa de novo", async () => {
    // `registrar_qualificacao` é rechamada a cada resposta nova do cliente. Sem
    // esta guarda o corretor recebe o mesmo resumo a cada mensagem trocada.
    leadNoBanco = { ...LEAD_PADRAO, avisoCorretorEm: new Date("2026-08-11T10:00:00Z") };
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    expect(await avisarCorretorDoLead(10)).toEqual({ feito: "nao", motivo: "aviso já enviado" });
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("na corrida, quem perde a reserva não envia", async () => {
    // Duas passadas simultâneas leem `avisoCorretorEm: null` antes de qualquer
    // uma escrever. Quem decide é o updateMany condicional, não a leitura.
    travaAcerta = 0;
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    expect(await avisarCorretorDoLead(10)).toEqual({ feito: "nao", motivo: "aviso já enviado" });
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("a trava é tomada ANTES do envio", async () => {
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    await avisarCorretorDoLead(10, { agora: new Date("2026-08-11T12:00:00Z") });
    expect(updatesDeLead[0]).toEqual({
      where: { id: 10, avisoCorretorEm: null },
      data: { avisoCorretorEm: new Date("2026-08-11T12:00:00Z") },
    });
  });

  it("envio que falha DEVOLVE a trava, para a próxima passada tentar", async () => {
    // Sem o rollback, a única tentativa que este lead teria na vida seria a que
    // falhou — e nenhuma resposta seguinte do cliente conseguiria avisar.
    enviarWhatsApp.mockResolvedValue({ enviado: false, provedor: "uazapi" });
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    const r = await avisarCorretorDoLead(10, { agora: new Date("2026-08-11T12:00:00Z") });

    expect(r).toEqual({ feito: "nao", motivo: "envio falhou: uazapi" });
    expect(updatesDeLead[1]).toEqual({
      where: { id: 10, avisoCorretorEm: new Date("2026-08-11T12:00:00Z") },
      data: { avisoCorretorEm: null },
    });
  });

  it("imobiliária bloqueada não fala em nome de quem está suspenso", async () => {
    leadNoBanco = {
      ...LEAD_PADRAO,
      imobiliaria: { avisoLeadTelefone: "(17) 99117-0597", bloqueadaEm: new Date() },
    };
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    expect((await avisarCorretorDoLead(10)).feito).toBe("nao");
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("NUNCA joga: banco fora do ar vira um resultado, não uma exceção", async () => {
    // Acima daqui está a ferramenta da IA, no meio da resposta que o cliente
    // espera no WhatsApp. Aviso perdido é um telefonema a menos; resposta
    // perdida é o cliente falando sozinho.
    const { prisma } = await import("@/lib/db");
    vi.mocked(prisma.lead.findUnique).mockRejectedValueOnce(new Error("conexão recusada"));
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    await expect(avisarCorretorDoLead(10)).resolves.toEqual({
      feito: "nao",
      motivo: "erro inesperado",
    });
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("lead que não existe não vira exceção", async () => {
    leadNoBanco = null;
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    expect(await avisarCorretorDoLead(10)).toEqual({ feito: "nao", motivo: "lead não existe" });
    expect(enviarWhatsApp).not.toHaveBeenCalled();
  });

  it("o modo demo conta como enviado — senão a trava voltaria a cada rodada", async () => {
    enviarWhatsApp.mockResolvedValue({ enviado: false, provedor: "demo" });
    const { avisarCorretorDoLead } = await import("@/lib/aviso-lead");
    expect((await avisarCorretorDoLead(10)).feito).toBe("enviado");
  });
});

describe("a ficha do lead na mensagem (21/08)", () => {
  // O corretor recebia "Qualificação: 8/14 perguntas" sobre alguém que tinha
  // acabado de informar 400 mil de entrada. O placar não é o resultado.
  const FICHA = [
    { rotulo: "Estado civil", valor: "União estável" },
    { rotulo: "Entrada disponível", valor: "R$ 400.000" },
    { rotulo: "Vínculo", valor: "Autônomo" },
    { rotulo: "Dependentes", valor: "0" },
  ];

  it("lista cada resposta, uma por linha", () => {
    const t = textoDoAviso({ nome: "Carlos", origem: "WHATSAPP", ficha: FICHA } as unknown as Parameters<typeof textoDoAviso>[0]);
    expect(t).toContain("O que ele respondeu:");
    expect(t).toContain("· Entrada disponível: R$ 400.000");
    expect(t).toContain("· Vínculo: Autônomo");
  });

  it("mantém a ordem em que a IA perguntou — bate com o histórico logo abaixo", () => {
    const t = textoDoAviso({ nome: "Carlos", origem: "WHATSAPP", ficha: FICHA } as unknown as Parameters<typeof textoDoAviso>[0]);
    expect(t.indexOf("Estado civil")).toBeLessThan(t.indexOf("Entrada disponível"));
    expect(t.indexOf("Entrada disponível")).toBeLessThan(t.indexOf("Vínculo"));
  });

  it("sem ficha, a seção some inteira — não vira cabeçalho vazio", () => {
    const t = textoDoAviso({ nome: "Carlos", origem: "WHATSAPP" } as unknown as Parameters<typeof textoDoAviso>[0]);
    expect(t).not.toContain("O que ele respondeu");
  });

  it("ficha vazia também não imprime o cabeçalho", () => {
    const t = textoDoAviso({ nome: "Carlos", origem: "WHATSAPP", ficha: [] } as unknown as Parameters<typeof textoDoAviso>[0]);
    expect(t).not.toContain("O que ele respondeu");
  });
});

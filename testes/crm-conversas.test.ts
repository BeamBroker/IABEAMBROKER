// A conversa alimentando o quadro, exercitada contra o BANCO.
//
// Regex sobre a fonte não serve aqui: o que precisa ser provado é que o card
// APARECE e ANDA. Este arquivo cria tenant, funil, conversa e mensagens de
// verdade, e confere o `Negocio` que sobrou no banco.
//
// A leitura da IA é injetada — a chamada ao modelo é mockada. O que está sob
// teste é a REGRA (qual coluna, criar ou mover, quando parar), não a qualidade
// da extração, que é do modelo e muda sem o nosso código mudar.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { idDaCasa } from "@/lib/instancias";
import { FUNIL_PADRAO, FASES_PADRAO } from "@/lib/negocios";

const lerConversaMock = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(lerConversaMock()) }],
        usage: { input_tokens: 100, output_tokens: 40 },
      }),
    };
  },
}));

const { sincronizarCrmDaConversa } = await import("@/lib/crm-conversas");

let imobiliariaId: number;
let funilId: number;
let fases: { id: number; nome: string; ordem: number }[];

async function criarConversa(
  telefone: string,
  quantasMensagens = 5,
  agente: "RECEPCAO" | "VENDAS" | "COMPRA_VENDA" = "RECEPCAO"
) {
  const c = await prisma.conversa.create({
    data: {
      imobiliariaId,
      instanciaId: await idDaCasa(imobiliariaId),
      agente,
      contatoNome: "Silvanei",
      contatoTelefone: telefone,
      simulacao: false,
    },
  });
  await prisma.mensagem.createMany({
    data: Array.from({ length: quantasMensagens }, (_, i) => ({
      conversaId: c.id,
      autor: i % 2 === 0 ? ("CLIENTE" as const) : ("ATENDENTE" as const),
      texto: `mensagem ${i}`,
    })),
  });
  return c.id;
}

beforeEach(async () => {
  const imob = await prisma.imobiliaria.create({
    data: { nome: `CRM Conversas ${Date.now()}${Math.trunc(performance.now())}`, modulos: ["COMERCIAL"] },
  });
  imobiliariaId = imob.id;
  const funil = await prisma.funil.create({
    data: {
      imobiliariaId,
      nome: FUNIL_PADRAO,
      fases: { create: FASES_PADRAO.map((nome, ordem) => ({ nome, ordem })) },
    },
    include: { fases: { orderBy: { ordem: "asc" } } },
  });
  funilId = funil.id;
  fases = funil.fases.map((f) => ({ id: f.id, nome: f.nome, ordem: f.ordem }));
  lerConversaMock.mockReset();
});

afterEach(async () => {
  await prisma.imobiliaria.delete({ where: { id: imobiliariaId } }).catch(() => {});
});

const leitura = (temperatura: string, extra: Record<string, unknown> = {}) => ({
  ehNegocio: true,
  finalidade: "COMPRA",
  nome: "Silvanei",
  titulo: "Apartamento Higienópolis — permuta por veículo",
  valor: null,
  temperatura,
  motivo: "ofereceu permuta e mandou fotos",
  ...extra,
});

describe("a conversa cria o card quando ele não existe", () => {
  it("QUENTE nasce na fase de ENTREGA — a Visita", async () => {
    // É o ponto do pedido: o quadro do dono tinha 1 card com 33 conversas no
    // WhatsApp. Nascer sempre em "Novo" devolveria o mesmo problema com outro
    // nome — uma pilha na primeira coluna que ninguém consegue priorizar.
    //
    // Era ordem 2 até 11/08, com índice absoluto no código. Passou a 3 porque o
    // dono pediu que a IA trabalhe "até a hora dela", e a hora dela é a Visita.
    // O teto agora vem de `FaseFunil.entregaIa`, não de um número fixo.
    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    const r = await sincronizarCrmDaConversa(await criarConversa("16999990001"));

    expect(r.acao).toBe("criado");
    const n = await prisma.negocio.findFirstOrThrow({
      where: { imobiliariaId },
      include: { fase: true },
    });
    expect(n.fase.ordem).toBe(3);
    expect(n.titulo).toBe("Apartamento Higienópolis — permuta por veículo");
    expect(n.contatoTelefone).toBe("16999990001");
  });

  it("FRIO e MORNO caem nas colunas 0 e 1", async () => {
    lerConversaMock.mockReturnValue(leitura("FRIO"));
    await sincronizarCrmDaConversa(await criarConversa("16999990002"));
    lerConversaMock.mockReturnValue(leitura("MORNO"));
    await sincronizarCrmDaConversa(await criarConversa("16999990003"));

    const ns = await prisma.negocio.findMany({ where: { imobiliariaId }, include: { fase: true } });
    expect(ns.map((n) => n.fase.ordem).sort()).toEqual([0, 1]);
  });

  it("o mesmo telefone NÃO vira dois cards, mesmo em conversas separadas", async () => {
    // Este é o caso REAL de duplicata, e ele só apareceu porque o teste anterior
    // quebrou: `Conversa` é única por (imobiliária, telefone, AGENTE). Uma mesma
    // pessoa que fala com a recepção e depois é encaminhada para vendas tem DUAS
    // linhas de conversa — e cada uma passaria por aqui.
    //
    // Um quadro cheio de duplicata do mesmo cliente é o jeito mais rápido de o
    // recurso ser desligado: ninguém consegue juntar depois.
    lerConversaMock.mockReturnValue(leitura("MORNO"));
    await sincronizarCrmDaConversa(await criarConversa("16999990004", 5, "RECEPCAO"));
    await sincronizarCrmDaConversa(await criarConversa("16999990004", 5, "VENDAS"));

    expect(await prisma.negocio.count({ where: { imobiliariaId } })).toBe(1);
  });
});

describe("a conversa move o card que já existe", () => {
  it("MORNO depois de FRIO avança a coluna", async () => {
    lerConversaMock.mockReturnValue(leitura("FRIO"));
    const conversaId = await criarConversa("16999990005");
    await sincronizarCrmDaConversa(conversaId);

    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    const r = await sincronizarCrmDaConversa(conversaId);

    expect(r.acao).toBe("movido");
    const n = await prisma.negocio.findFirstOrThrow({
      where: { imobiliariaId },
      include: { fase: true },
    });
    expect(n.fase.ordem).toBe(3);
  });

  it("NUNCA volta para trás — nem quando a leitura esfria", async () => {
    // Uma pessoa que demora a responder não é uma pessoa que desistiu. Regressão
    // automática apagaria o trabalho de quem moveu o card na mão, e é isso que
    // faria a equipe perder a confiança no recurso na primeira semana.
    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    const conversaId = await criarConversa("16999990006");
    await sincronizarCrmDaConversa(conversaId);

    lerConversaMock.mockReturnValue(leitura("FRIO"));
    const r = await sincronizarCrmDaConversa(conversaId);

    expect(r.acao).toBe("parado");
    const n = await prisma.negocio.findFirstOrThrow({
      where: { imobiliariaId },
      include: { fase: true },
    });
    expect(n.fase.ordem).toBe(3);
  });

  it("card movido À MÃO para o fim do funil não é puxado de volta", async () => {
    lerConversaMock.mockReturnValue(leitura("MORNO"));
    const conversaId = await criarConversa("16999990007");
    await sincronizarCrmDaConversa(conversaId);

    const proposta = fases.find((f) => f.ordem === 4)!;
    await prisma.negocio.updateMany({
      where: { imobiliariaId },
      data: { faseId: proposta.id },
    });

    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    const r = await sincronizarCrmDaConversa(conversaId);
    expect(r.acao).toBe("parado");
    const n = await prisma.negocio.findFirstOrThrow({ where: { imobiliariaId }, include: { fase: true } });
    expect(n.fase.ordem).toBe(4);
  });
});

describe("o que NÃO vira card", () => {
  it("conversa que a IA não considera negócio", async () => {
    // Cobrança, segunda via e manutenção não são funil de venda. Sem esta
    // recusa, o quadro do dono viraria a caixa de entrada inteira.
    lerConversaMock.mockReturnValue({ ...leitura("QUENTE"), ehNegocio: false });
    const r = await sincronizarCrmDaConversa(await criarConversa("16999990008"));

    expect(r.acao).toBe("ignorado");
    expect(await prisma.negocio.count({ where: { imobiliariaId } })).toBe(0);
  });

  it("conversa curta demais não gasta chamada nem cria card", async () => {
    // Metade das conversas paradas em produção tinha 1 ou 2 mensagens: é o "oi"
    // abandonado. A guarda vem ANTES do modelo, senão a varredura vira custo
    // fixo por conversa morta.
    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    const r = await sincronizarCrmDaConversa(await criarConversa("16999990009", 2));

    expect(r.acao).toBe("ignorado");
    expect(lerConversaMock).not.toHaveBeenCalled();
    expect(await prisma.negocio.count({ where: { imobiliariaId } })).toBe(0);
  });

  it("conversa sem telefone não vira card órfão", async () => {
    const c = await prisma.conversa.create({
      data: {
        imobiliariaId,
        instanciaId: await idDaCasa(imobiliariaId),
        agente: "RECEPCAO",
        contatoNome: "Anônimo",
        simulacao: false,
      },
    });
    await prisma.mensagem.createMany({
      data: [0, 1, 2, 3].map((i) => ({ conversaId: c.id, autor: "CLIENTE" as const, texto: `m${i}` })),
    });

    const r = await sincronizarCrmDaConversa(c.id);
    expect(r).toEqual({ acao: "ignorado", porque: "conversa sem telefone" });
    expect(await prisma.negocio.count({ where: { imobiliariaId } })).toBe(0);
  });

  it("tenant sem funil de venda é ignorado, não explode", async () => {
    await prisma.funil.delete({ where: { id: funilId } });
    lerConversaMock.mockReturnValue(leitura("QUENTE"));

    const r = await sincronizarCrmDaConversa(await criarConversa("16999990010"));
    expect(r.acao).toBe("ignorado");
  });
});

describe("a fronteira comercial continua valendo", () => {
  it("o card nasce no funil de VENDA, nunca no de locação", async () => {
    // A decisão de 03/08 dá o aluguel para `Lead`, e `criarNegocio` recusa funil
    // de locação. Este módulo não pode ser a porta dos fundos que a contorna.
    lerConversaMock.mockReturnValue(leitura("MORNO"));
    await sincronizarCrmDaConversa(await criarConversa("16999990011"));

    const n = await prisma.negocio.findFirstOrThrow({
      where: { imobiliariaId },
      include: { funil: true },
    });
    expect(n.funil.nome).toBe(FUNIL_PADRAO);
  });

  it("a IA do chefe não foi tocada", async () => {
    // O dono pediu explicitamente cautela com o cérebro da IA. Este módulo lê a
    // conversa DEPOIS que ela aconteceu; não é ferramenta, não entra em prompt,
    // e não aparece em lib/agentes.ts. Se alguém pendurar isto lá dentro, o
    // comportamento da Maitê muda — e aí é conversa com o Marco, não commit.
    const { readFileSync } = await import("node:fs");
    const agentes = readFileSync("lib/agentes.ts", "utf8");
    expect(agentes).not.toMatch(/crm-conversas/);
    expect(agentes).not.toMatch(/sincronizarCrmDaConversa/);
  });
});

describe("a fronteira é pela FINALIDADE, não pelo nome do funil", () => {
  // Esta é a correção de um defeito que chegou a produção em 05/08, medido no
  // banco: 10 dos 18 cards criados eram de ALUGUEL, dentro do funil de VENDA,
  // com o aluguel MENSAL somado como valor de pipeline. A guarda que existia
  // (`funilAceitaNegocio`) nunca era acionada, porque o alvo é sempre "Venda".
  //
  // Dois daqueles contatos estavam PERDIDO no CRM de locação e ABERTO no funil
  // de venda ao mesmo tempo — as "duas verdades sobre o mesmo cliente" que a
  // separação de 03/08 existia para evitar.
  it("LOCACAO não vira card, mesmo QUENTE", async () => {
    lerConversaMock.mockReturnValue(leitura("QUENTE", { finalidade: "LOCACAO" }));
    const r = await sincronizarCrmDaConversa(await criarConversa("16999990020"));

    expect(r.acao).toBe("ignorado");
    expect(await prisma.negocio.count({ where: { imobiliariaId } })).toBe(0);
  });

  it("NENHUMA não vira card", async () => {
    lerConversaMock.mockReturnValue(leitura("MORNO", { finalidade: "NENHUMA" }));
    const r = await sincronizarCrmDaConversa(await criarConversa("16999990021"));

    expect(r.acao).toBe("ignorado");
    expect(await prisma.negocio.count({ where: { imobiliariaId } })).toBe(0);
  });

  it("finalidade AUSENTE não abre a porta por omissão", async () => {
    // Padrão seguro: modelo que não respondeu o campo não cria card de venda.
    // O contrário — assumir COMPRA — é como o defeito original passou.
    const semFinalidade = leitura("QUENTE");
    delete (semFinalidade as Record<string, unknown>).finalidade;
    lerConversaMock.mockReturnValue(semFinalidade);

    const r = await sincronizarCrmDaConversa(await criarConversa("16999990022"));
    expect(r.acao).toBe("ignorado");
    expect(await prisma.negocio.count({ where: { imobiliariaId } })).toBe(0);
  });

  it("COMPRA continua virando card — a fronteira não fechou a porta certa", async () => {
    lerConversaMock.mockReturnValue(leitura("QUENTE", { finalidade: "COMPRA" }));
    const r = await sincronizarCrmDaConversa(await criarConversa("16999990023"));
    expect(r.acao).toBe("criado");
  });

  it("o prompt diz à IA que aluguel não entra no quadro", async () => {
    // A guarda de código é a que vale; o prompt evita gastar chamada e evita a
    // IA inventar título de aluguel que depois é descartado.
    const { readFileSync } = await import("node:fs");
    const fonte = readFileSync("lib/crm-conversas.ts", "utf8");
    const instrucao = fonte.slice(fonte.indexOf("const INSTRUCAO"), fonte.indexOf("/** Lê a conversa"));
    expect(instrucao).toContain("LOCACAO");
    expect(instrucao).toContain("aluguel mensal");
  });
});

describe("até onde a IA leva o card", () => {
  // A trava desta fatia. O funil é DADO do tenant: renomear fase é UPDATE, não
  // deploy. Se o alcance da IA dependesse do NOME "Visita", ele quebraria calado
  // na primeira imobiliária que renomeasse a coluna — e o card pararia numa
  // posição que ninguém pediu, sem erro em log nenhum.
  //
  // O teste RENOMEIA a fase no banco e roda a sincronização de novo. Ler o
  // código-fonte não provaria nada: a asserção de fonte que existia neste repo
  // em 04/08 passou verde com a regra removida.
  it("renomear a fase de entrega NÃO muda onde o card para", async () => {
    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    const r1 = await sincronizarCrmDaConversa(await criarConversa("16999990031"));
    expect(r1.acao).toBe("criado");
    const antes = await prisma.negocio.findFirstOrThrow({
      where: { imobiliariaId, contatoTelefone: "16999990031" },
      include: { fase: true },
    });

    // A imobiliária resolve chamar a etapa de outro jeito.
    await prisma.faseFunil.update({
      where: { id: antes.faseId },
      data: { nome: "Vistoria agendada" },
    });

    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    await sincronizarCrmDaConversa(await criarConversa("16999990032"));
    const depois = await prisma.negocio.findFirstOrThrow({
      where: { imobiliariaId, contatoTelefone: "16999990032" },
      include: { fase: true },
    });

    // Mesma POSIÇÃO, nome diferente.
    expect(depois.fase.ordem).toBe(antes.fase.ordem);
    expect(depois.fase.nome).toBe("Vistoria agendada");
  });

  it("a marca de entrega manda, mesmo mudada de lugar", async () => {
    // O dono pode querer que a IA pare mais cedo. Mover a marca é UPDATE.
    const todas = await prisma.faseFunil.findMany({
      where: { funilId },
      orderBy: { ordem: "asc" },
    });
    await prisma.faseFunil.updateMany({ where: { funilId }, data: { entregaIa: false } });
    await prisma.faseFunil.update({ where: { id: todas[1]!.id }, data: { entregaIa: true } });

    lerConversaMock.mockReturnValue(leitura("QUENTE"));
    await sincronizarCrmDaConversa(await criarConversa("16999990033"));
    const n = await prisma.negocio.findFirstOrThrow({
      where: { imobiliariaId, contatoTelefone: "16999990033" },
      include: { fase: true },
    });
    // Teto na segunda fase (ordem 1): o QUENTE para ali, não na Visita.
    expect(n.fase.ordem).toBe(1);
  });
});

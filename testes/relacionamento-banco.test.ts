// Relacionamento rodando contra o BANCO.
//
// O teste ao lado prova as janelas como função. Aqui está o que quebra na vida
// real: o cron roda TODO DIA e a janela de um marco dura semanas. Sem a chave de
// idempotência, o inquilino receberia "seu contrato termina em outubro" todo dia
// por três meses — que é como se destrói a confiança num aviso útil.
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { idDaCasa } from "@/lib/instancias";
import { comSimulacao } from "@/lib/simulacao";
import { processarRelacionamento } from "@/lib/relacionamento";

const uniq = `Rel${process.pid}`;
let imobId = 0;
let contratoId = 0;

// Contrato: começa 22/09/2025, termina 30/10/2026.
const INICIO = new Date("2025-09-22T12:00:00Z");
const FIM = new Date("2026-10-30T12:00:00Z");

beforeAll(async () => {
  const imob = await prisma.imobiliaria.create({
    data: { nome: `${uniq} Imobiliária`, taxaAdmPercent: 10 },
  });
  imobId = imob.id;
  const prop = await prisma.pessoa.create({
    data: { imobiliariaId: imobId, nome: "Carlos Andrade", cpfCnpj: `${uniq}-P`, telefone: "5516999990002" },
  });
  const inq = await prisma.pessoa.create({
    data: { imobiliariaId: imobId, nome: "Juliana Castro", cpfCnpj: `${uniq}-I`, telefone: "5516999990001" },
  });
  const imovel = await prisma.imovel.create({
    data: {
      imobiliariaId: imobId, codigo: `${uniq}-AP1`, tipo: "Apartamento",
      endereco: "Rua das Palmeiras, 120", cidade: "Araraquara", uf: "SP",
      valorSugerido: new Prisma.Decimal(1850), proprietarioId: prop.id,
    },
  });
  const ct = await prisma.contrato.create({
    data: {
      imobiliariaId: imobId, codigo: `${uniq}-CT1`, imovelId: imovel.id, inquilinoId: inq.id,
      inicio: INICIO, fim: FIM, valorAluguel: new Prisma.Decimal(1850), diaVencimento: 10,
    },
  });
  contratoId = ct.id;
});

afterAll(async () => {
  await prisma.avisoContrato.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.mensagem.deleteMany({ where: { conversa: { imobiliariaId: imobId } } });
  await prisma.conversa.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.logAuditoria.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.contrato.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.imovel.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.pessoa.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.imobiliaria.delete({ where: { id: imobId } });
});

beforeEach(async () => {
  await prisma.avisoContrato.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.mensagem.deleteMany({ where: { conversa: { imobiliariaId: imobId } } });
});

const rodar = (quando: string) =>
  comSimulacao(async () => processarRelacionamento(imobId, new Date(`${quando}T13:00:00Z`)))
    .then((r) => r.resultado);

const textos = async () =>
  (await prisma.mensagem.findMany({
    where: { conversa: { imobiliariaId: imobId } },
    orderBy: { criadaEm: "asc" },
  })).map((m) => m.texto);

describe("renovação", () => {
  it("avisa os DOIS lados quando entra na janela de 90 dias", async () => {
    // 01/08/2026 → faltam 90 dias para 30/10.
    expect(await rodar("2026-08-01")).toEqual({ reajuste: 0, renovacao: 1 });
    const msgs = await textos();
    expect(msgs.length).toBe(2);
    expect(msgs.some((t) => t.startsWith("Oi Juliana") && t.includes("pretende renovar"))).toBe(true);
    expect(msgs.some((t) => t.startsWith("Oi Carlos") && t.includes("divulgar"))).toBe(true);
  });

  it("rodando todo dia, avisa UMA vez por marco", async () => {
    // É o erro clássico deste tipo de rotina: a janela dura semanas.
    expect((await rodar("2026-08-01")).renovacao).toBe(1);
    for (const d of ["2026-08-02", "2026-08-15", "2026-08-30"])
      expect((await rodar(d)).renovacao, d).toBe(0);
    // conta só os avisos de renovação: 30/08 já entra na janela do reajuste,
    // que é outro assunto e tem a idempotência dele.
    expect((await textos()).filter((t) => /termina em/.test(t)).length).toBe(2);
  });

  it("o marco de 60 dias é um aviso NOVO, não repetição", async () => {
    await rodar("2026-08-01"); // marco 90
    expect((await rodar("2026-09-01")).renovacao).toBe(1); // 59 dias → marco 60
    // dois avisos de renovação por marco (inquilino + proprietário)
    const renov = (await textos()).filter((t) => /termina em/.test(t));
    expect(renov.length).toBe(4);
  });

  it("longe demais, não fala nada", async () => {
    expect(await rodar("2026-01-15")).toEqual({ reajuste: 0, renovacao: 0 });
    expect((await textos()).length).toBe(0);
  });
});

describe("reajuste", () => {
  it("avisa 30 dias antes do aniversário, sem inventar o valor novo", async () => {
    // Aniversário em 22/09/2026; 30 dias antes = 23/08.
    const r = await rodar("2026-08-25");
    expect(r.reajuste).toBe(1);
    const msgs = await textos();
    expect(msgs.some((t) => /IGPM/.test(t) && /1\.850,00/.test(t))).toBe(true);
    // nenhum valor futuro chutado
    expect(msgs.some((t) => /assim que o índice/i.test(t))).toBe(true);
  });

  it("não repete no dia seguinte", async () => {
    expect((await rodar("2026-08-25")).reajuste).toBe(1);
    expect((await rodar("2026-08-26")).reajuste).toBe(0);
  });
});

describe("quem manda calar", () => {
  it("conversa assumida pela equipe não recebe aviso automático", async () => {
    const inq = await prisma.pessoa.findFirst({ where: { imobiliariaId: imobId, cpfCnpj: `${uniq}-I` } });
    await prisma.conversa.upsert({
      where: { pessoaId_perfil: { pessoaId: inq!.id, perfil: "LOCATARIO" } },
      create: {
        imobiliariaId: imobId,
        instanciaId: await idDaCasa(imobId),
        pessoaId: inq!.id,
        perfil: "LOCATARIO",
        iaPausada: true,
      },
      update: { iaPausada: true },
    });
    await rodar("2026-08-01");
    const msgs = await textos();
    // o proprietário recebeu; o inquilino, não. (O texto ao proprietário também
    // fala de "renovar", então o que distingue é a quem a mensagem se dirige.)
    expect(msgs.some((t) => t.startsWith("Oi Carlos"))).toBe(true);
    expect(msgs.some((t) => t.startsWith("Oi Juliana"))).toBe(false);
    await prisma.conversa.updateMany({ where: { pessoaId: inq!.id }, data: { iaPausada: false } });
  });

  it("contrato encerrado sai do relacionamento", async () => {
    await prisma.contrato.update({ where: { id: contratoId }, data: { status: "ENCERRADO" } });
    expect(await rodar("2026-08-01")).toEqual({ reajuste: 0, renovacao: 0 });
    await prisma.contrato.update({ where: { id: contratoId }, data: { status: "ATIVO" } });
  });
});

// A régua rodando contra o BANCO, não só a lógica pura.
//
// O teste ao lado (regua-cobranca.test.ts) prova a escada como função. Este aqui
// prova a coisa que quebra na vida real: idempotência. Rodar a régua duas vezes
// no mesmo dia não pode mandar dois toques, e o degrau tem que avançar um por
// vez conforme a data anda.
//
// Roda dentro de comSimulacao(): nenhuma mensagem sai para o WhatsApp de
// ninguém, mas TODO o resto do caminho é o de produção.
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { idDaCasa } from "@/lib/instancias";
import { comSimulacao } from "@/lib/simulacao";
import { processarReguaCobranca, ULTIMA_ETAPA } from "@/lib/regua-cobranca";

const uniq = `Reg${process.pid}`;
let imobId = 0;
let contratoId = 0;
let inquilinoId = 0;

// Uma quarta-feira às 10h de Brasília (13h UTC) — dentro do horário comercial,
// que é pré-requisito da régua.
const QUARTA_10H = new Date("2026-07-15T13:00:00Z");

beforeAll(async () => {
  const imob = await prisma.imobiliaria.create({
    data: { nome: `${uniq} Imobiliária`, taxaAdmPercent: 10 },
  });
  imobId = imob.id;
  const prop = await prisma.pessoa.create({
    data: { imobiliariaId: imobId, nome: "Proprietário Teste", cpfCnpj: `${uniq}-P` },
  });
  const inq = await prisma.pessoa.create({
    data: {
      imobiliariaId: imobId, nome: "Juliana Castro", cpfCnpj: `${uniq}-I`,
      telefone: "5516999990001",
    },
  });
  inquilinoId = inq.id;
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
      inicio: new Date("2025-09-22"), fim: new Date("2028-03-22"),
      valorAluguel: new Prisma.Decimal(1850), diaVencimento: 10,
    },
  });
  contratoId = ct.id;
});

afterAll(async () => {
  await prisma.mensagem.deleteMany({ where: { conversa: { imobiliariaId: imobId } } });
  await prisma.conversa.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.logAuditoria.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.fatura.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.contrato.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.imovel.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.pessoa.deleteMany({ where: { imobiliariaId: imobId } });
  await prisma.imobiliaria.delete({ where: { id: imobId } });
});

async function faturaVencendoEm(iso: string) {
  await prisma.mensagem.deleteMany({ where: { conversa: { imobiliariaId: imobId } } });
  await prisma.fatura.deleteMany({ where: { imobiliariaId: imobId } });
  return prisma.fatura.create({
    data: {
      imobiliariaId: imobId, contratoId, competencia: "2026-07",
      vencimento: new Date(`${iso}T12:00:00Z`),
      valorAluguel: new Prisma.Decimal(1850), valorTotal: new Prisma.Decimal(1850),
      status: "ABERTA",
    },
  });
}

const mensagens = () =>
  prisma.mensagem.findMany({
    where: { conversa: { imobiliariaId: imobId } },
    orderBy: { criadaEm: "asc" },
  });

// Congela o relógio: a régua lê `new Date()` internamente.
async function reguaEm(momento: Date): Promise<number> {
  vi.useFakeTimers();
  vi.setSystemTime(momento);
  try {
    return await comSimulacao(async () => processarReguaCobranca(imobId)).then((r) => r.resultado);
  } finally {
    vi.useRealTimers();
  }
}

beforeEach(async () => {
  await prisma.mensagem.deleteMany({ where: { conversa: { imobiliariaId: imobId } } });
});

describe("a régua contra o banco", () => {
  it("manda o lembrete três dias antes e grava a etapa", async () => {
    await faturaVencendoEm("2026-07-18"); // 3 dias depois de 15/07
    expect(await reguaEm(QUARTA_10H)).toBe(1);
    const [msg] = await mensagens();
    expect(msg!.texto).toMatch(/vence em/);
    const f = await prisma.fatura.findFirst({ where: { imobiliariaId: imobId } });
    expect(f!.cobrancaEtapa).toBe(1);
  });

  it("rodar de novo no mesmo dia NÃO manda outra vez", async () => {
    // É o bug que a régua antiga tinha na prática: o cron roda todo dia e a
    // janela de um degrau dura até o próximo.
    await faturaVencendoEm("2026-07-18");
    expect(await reguaEm(QUARTA_10H)).toBe(1);
    expect(await reguaEm(QUARTA_10H)).toBe(0);
    expect((await mensagens()).length).toBe(1);
  });

  it("com o tempo, sobe um degrau por vez", async () => {
    await faturaVencendoEm("2026-07-15"); // vence no próprio dia do teste
    expect(await reguaEm(QUARTA_10H)).toBe(1); // VENCE_HOJE
    expect(await reguaEm(new Date("2026-07-16T13:00:00Z"))).toBe(1); // VENCEU
    expect(await reguaEm(new Date("2026-07-17T13:00:00Z"))).toBe(0); // nada novo
    expect(await reguaEm(new Date("2026-07-20T13:00:00Z"))).toBe(1); // ENCARGOS
    const f = await prisma.fatura.findFirst({ where: { imobiliariaId: imobId } });
    expect(f!.cobrancaEtapa).toBe(4);
  });

  it("fatura antiga: primeiro o acordo, só depois a entrega à equipe", async () => {
    await faturaVencendoEm("2026-06-01"); // 44 dias de atraso, nunca cobrada
    expect(await reguaEm(QUARTA_10H)).toBe(1);
    const [primeira] = await mensagens();
    expect(primeira!.texto).toMatch(/parcelar/); // ofereceu acordo
    expect(primeira!.texto).not.toMatch(/não tiveram retorno/);

    expect(await reguaEm(new Date("2026-07-16T13:00:00Z"))).toBe(1);
    const f = await prisma.fatura.findFirst({ where: { imobiliariaId: imobId } });
    expect(f!.cobrancaEtapa).toBe(ULTIMA_ETAPA);
  });

  it("acaba: depois do último degrau, silêncio", async () => {
    await faturaVencendoEm("2026-06-01");
    for (const d of ["2026-07-15", "2026-07-16"]) await reguaEm(new Date(`${d}T13:00:00Z`));
    expect(await reguaEm(new Date("2026-08-30T13:00:00Z"))).toBe(0);
  });

  it("de madrugada não cobra ninguém", async () => {
    await faturaVencendoEm("2026-07-18");
    // 03h de Brasília (06h UTC)
    expect(await reguaEm(new Date("2026-07-15T06:00:00Z"))).toBe(0);
    expect((await mensagens()).length).toBe(0);
  });

  it("conversa assumida pela equipe silencia a régua daquele inquilino", async () => {
    // Humano negociando de um lado e robô cobrando do outro é o pior cenário.
    await faturaVencendoEm("2026-07-18");
    await prisma.conversa.upsert({
      where: { pessoaId_perfil: { pessoaId: inquilinoId, perfil: "LOCATARIO" } },
      create: {
        imobiliariaId: imobId,
        instanciaId: await idDaCasa(imobId),
        pessoaId: inquilinoId,
        perfil: "LOCATARIO",
        iaPausada: true,
      },
      update: { iaPausada: true },
    });
    expect(await reguaEm(QUARTA_10H)).toBe(0);
    await prisma.conversa.updateMany({
      where: { pessoaId: inquilinoId, perfil: "LOCATARIO" },
      data: { iaPausada: false },
    });
  });

  it("fatura paga sai da régua", async () => {
    const f = await faturaVencendoEm("2026-07-18");
    await prisma.fatura.update({ where: { id: f.id }, data: { status: "PAGA", pagaEm: new Date() } });
    expect(await reguaEm(QUARTA_10H)).toBe(0);
  });
});

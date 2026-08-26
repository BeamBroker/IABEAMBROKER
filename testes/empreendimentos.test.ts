// Empreendimento: as três datas de entrega são coisas diferentes, e a faixa do
// MCMV é da RENDA — o imóvel só impõe o teto. Estes testes travam as duas coisas.
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import {
  COMPROMETIMENTO_MAX,
  FAIXAS_MCMV,
  analisarEntrega,
  entregaContratual,
  faixaPelaRenda,
  faixasPeloPreco,
  fichaParaIA,
  limiteTolerado,
  normalizarFaixas,
  parcelaMaxima,
  permiteParcelarEntrada,
  somarMeses,
  valorM2,
  whereSituacao,
} from "@/lib/empreendimentos";

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);
const base = {
  obraIniciadaEm: null,
  prazoObraMeses: null,
  toleranciaMeses: 6,
  entregaPrevista: null,
  entregaReal: null,
};

describe("as três datas de entrega", () => {
  it("a contratual é início da obra + prazo — sem os dois, não existe", () => {
    expect(entregaContratual({ obraIniciadaEm: d("2025-03-10"), prazoObraMeses: 36 })).toEqual(
      d("2028-03-10")
    );
    expect(entregaContratual({ obraIniciadaEm: d("2025-03-10"), prazoObraMeses: null })).toBeNull();
    expect(entregaContratual({ obraIniciadaEm: null, prazoObraMeses: 36 })).toBeNull();
  });

  it("somar meses não escorrega para o mês seguinte em mês curto", () => {
    // 31/01 + 1 mês é 28/02, não 03/03 (que é o que o JS faz sozinho).
    expect(somarMeses(d("2026-01-31"), 1)).toEqual(d("2026-02-28"));
    expect(somarMeses(d("2024-01-31"), 1)).toEqual(d("2024-02-29")); // bissexto
  });

  it("a tolerância estende a contratual, nunca a previsão sozinha", () => {
    const emp = { ...base, obraIniciadaEm: d("2025-01-15"), prazoObraMeses: 24, toleranciaMeses: 6 };
    expect(limiteTolerado(emp)).toEqual(d("2027-07-15"));
    // Só com previsão da construtora não há prazo contratual — nem tolerância.
    expect(limiteTolerado({ ...base, entregaPrevista: d("2027-01-15") })).toBeNull();
  });

  it("a previsão vale como referência quando não há prazo contratual", () => {
    const r = analisarEntrega({ ...base, entregaPrevista: d("2030-01-01") }, d("2026-07-27"));
    expect(r.situacao).toBe("NA_PLANTA");
    expect(r.referencia).toEqual(d("2030-01-01"));
    expect(r.contratual).toBeNull();
  });

  it("dentro do prazo é EM_OBRAS; passou do prazo mas dentro da tolerância é EM_TOLERANCIA", () => {
    const emp = { ...base, obraIniciadaEm: d("2024-01-10"), prazoObraMeses: 24 }; // contratual 2026-01-10
    expect(analisarEntrega(emp, d("2025-06-01")).situacao).toBe("EM_OBRAS");
    const tolerancia = analisarEntrega(emp, d("2026-03-01"));
    expect(tolerancia.situacao).toBe("EM_TOLERANCIA");
    expect(tolerancia.diasDeAtraso).toBeGreaterThan(0);
  });

  it("passou da tolerância vira ATRASADA, e o atraso conta do prazo contratual", () => {
    const emp = { ...base, obraIniciadaEm: d("2024-01-10"), prazoObraMeses: 24, toleranciaMeses: 6 };
    const r = analisarEntrega(emp, d("2026-08-10")); // contratual 2026-01-10, tolerado 2026-07-10
    expect(r.situacao).toBe("ATRASADA");
    expect(r.diasDeAtraso).toBe(212); // 10/01/2026 → 10/08/2026
  });

  it("entregue com atraso continua registrando o atraso", () => {
    const emp = {
      ...base,
      obraIniciadaEm: d("2024-01-10"),
      prazoObraMeses: 24,
      entregaReal: d("2026-04-10"),
    };
    const r = analisarEntrega(emp, d("2026-07-27"));
    expect(r.situacao).toBe("ENTREGUE");
    expect(r.diasDeAtraso).toBe(90);
    expect(r.rotulo).toContain("atraso");
  });

  it("entregue no prazo não inventa atraso", () => {
    const r = analisarEntrega(
      { ...base, obraIniciadaEm: d("2024-01-10"), prazoObraMeses: 24, entregaReal: d("2025-12-01") },
      d("2026-07-27")
    );
    expect(r.situacao).toBe("ENTREGUE");
    expect(r.diasDeAtraso).toBe(0);
  });

  it("sem nenhuma data, o sistema diz que não sabe — não chuta", () => {
    const r = analisarEntrega(base, d("2026-07-27"));
    expect(r.situacao).toBe("SEM_DATA");
    expect(r.referencia).toBeNull();
    expect(r.diasDeAtraso).toBe(0);
  });
});

describe("enquadramento MCMV", () => {
  it("a faixa vem da renda, e acima do teto da última fica fora do programa", () => {
    expect(faixaPelaRenda(2000)?.faixa).toBe(1);
    expect(faixaPelaRenda(2850)?.faixa).toBe(1); // limite pertence à própria faixa
    expect(faixaPelaRenda(2851)?.faixa).toBe(2);
    expect(faixaPelaRenda(8000)?.faixa).toBe(3);
    expect(faixaPelaRenda(12_000)?.faixa).toBe(4);
    expect(faixaPelaRenda(20_000)).toBeUndefined();
    expect(faixaPelaRenda(0)).toBeUndefined();
  });

  it("as faixas cobrem a renda sem buraco nem sobreposição", () => {
    for (let i = 1; i < FAIXAS_MCMV.length; i++) {
      expect(FAIXAS_MCMV[i]!.rendaDe).toBe(FAIXAS_MCMV[i - 1]!.rendaAte);
    }
  });

  it("o preço do imóvel só diz QUEM PODE comprar (o teto), não qual é a faixa", () => {
    expect(faixasPeloPreco(280_000).map((f) => f.faixa)).toEqual([1, 2, 3, 4]);
    // Acima do teto de 350 mil, só a Faixa 4 (teto de 600 mil) alcança.
    expect(faixasPeloPreco(420_000).map((f) => f.faixa)).toEqual([4]);
    // Acima de todos os tetos: venda fora do programa.
    expect(faixasPeloPreco(900_000)).toEqual([]);
    expect(faixasPeloPreco(null)).toEqual([]);
  });

  it("a parcela máxima é 30% da renda bruta", () => {
    expect(COMPROMETIMENTO_MAX).toBe(0.3);
    expect(parcelaMaxima(6000)).toBe(1800);
  });

  it("marcação de formulário é entrada não confiável", () => {
    expect(normalizarFaixas(["2", "2", "1", "9", "abc", ""])).toEqual([1, 2]);
    expect(normalizarFaixas([])).toEqual([]);
  });

  it("R$/m² só existe com os dois números", () => {
    expect(valorM2(350_000, 70)).toBe(5000);
    expect(valorM2(350_000, 0)).toBeNull();
    expect(valorM2(null, 70)).toBeNull();
  });
});

describe("ficha que a IA lê", () => {
  const CLARISSE = {
    nome: "Residencial Clarisse Novelli",
    construtora: "Pacaembu",
    bairro: "Jardim Aclimação",
    cidade: "São José do Rio Preto",
    uf: "SP",
    pontoReferencia: "em frente ao Fraternidade",
    metragemM2: 200,
    precoAvaliacao: 259_300,
    faixasMcmv: [2, 3],
  };

  it("cada campo vem com rótulo — construtora nunca pode virar bairro", () => {
    // O bug real: "Residencial X (Pacaembu) em Y" fez a IA escrever
    // "no Pacaembu". Pacaembu é EMPRESA. O rótulo é o que impede isso.
    const f = fichaParaIA(CLARISSE);
    expect(f).toContain("construtora (EMPRESA, não é bairro): Pacaembu");
    expect(f).toContain("bairro: Jardim Aclimação");
    expect(f).toContain("cidade: São José do Rio Preto/SP");
    // A construtora não pode aparecer solta, sem rótulo, em posição de lugar.
    expect(f).not.toContain("(Pacaembu)");
    expect(f).not.toMatch(/em Pacaembu|no Pacaembu/);
  });

  it("bairro ausente é dito, não substituído pela cidade nem pela construtora", () => {
    const f = fichaParaIA({ ...CLARISSE, bairro: null });
    expect(f).toContain("bairro: não informado");
  });

  it("sem unidade com foto, a ficha PROÍBE oferecer fotos", () => {
    const f = fichaParaIA(CLARISSE);
    expect(f).toContain("NÃO EXISTEM fotos deste empreendimento");
    expect(f).toContain("NÃO ofereça fotos");
  });

  it("com unidade cadastrada, aponta o código certo (a foto é da unidade)", () => {
    const f = fichaParaIA(CLARISSE, { unidadesComFoto: ["AP-0007", "AP-0008"] });
    expect(f).toContain("só das unidades AP-0007, AP-0008");
    expect(f).not.toContain("NÃO EXISTEM fotos");
  });

  it("a entrega entra pela análise, com a situação real da obra", () => {
    const f = fichaParaIA(CLARISSE, {
      entrega: { ...base, obraIniciadaEm: d("2024-01-10"), prazoObraMeses: 24 },
      hoje: d("2026-08-10"),
    });
    expect(f).toContain("entrega: Atrasada há");
  });

  it("preço e m² saem formatados, e o R$/m² é derivado", () => {
    // toLocaleString põe espaço NÃO separável depois de "R$" (U+00A0), então a
    // comparação normaliza — senão o teste falha por um caractere invisível.
    const f = fichaParaIA(CLARISSE).replace(/ /g, " ");
    expect(f).toContain("preço: R$ 259.300,00");
    expect(f).toContain("área: 200 m² (R$ 1.296,50 por m²)");
  });
});

describe("empreendimento no banco", () => {
  const uniq = `Emp${process.pid}`;

  afterAll(async () => {
    await prisma.imovel.deleteMany({ where: { imobiliaria: { nome: { startsWith: uniq } } } });
    await prisma.empreendimento.deleteMany({ where: { imobiliaria: { nome: { startsWith: uniq } } } });
    await prisma.pessoa.deleteMany({ where: { imobiliaria: { nome: { startsWith: uniq } } } });
    await prisma.imobiliaria.deleteMany({ where: { nome: { startsWith: uniq } } });
  });

  it("é escopado por imobiliária: o nome pode repetir entre tenants, não dentro", async () => {
    const a = await prisma.imobiliaria.create({ data: { nome: `${uniq}-A`, taxaAdmPercent: 10 } });
    const b = await prisma.imobiliaria.create({ data: { nome: `${uniq}-B`, taxaAdmPercent: 10 } });

    const dados = { nome: "Residencial Aurora", construtora: "Construtora X", cidade: "Araraquara", uf: "SP" };
    await prisma.empreendimento.create({ data: { imobiliariaId: a.id, ...dados } });
    // Mesmo nome em OUTRO tenant: permitido (são carteiras independentes).
    await expect(
      prisma.empreendimento.create({ data: { imobiliariaId: b.id, ...dados } })
    ).resolves.toBeTruthy();
    // Mesmo nome no MESMO tenant: recusado.
    await expect(
      prisma.empreendimento.create({ data: { imobiliariaId: a.id, ...dados } })
    ).rejects.toThrow();

    // E o quadro de A não enxerga o de B.
    const deA = await prisma.empreendimento.findMany({ where: { imobiliariaId: a.id } });
    expect(deA).toHaveLength(1);
  });

  it("a unidade aponta para o empreendimento, e apagar o prédio não apaga o imóvel", async () => {
    const imob = await prisma.imobiliaria.create({ data: { nome: `${uniq}-C`, taxaAdmPercent: 10 } });
    const dono = await prisma.pessoa.create({
      data: { imobiliariaId: imob.id, nome: "Dono", cpfCnpj: `${process.pid}00`, tipo: "FISICA" },
    });
    const emp = await prisma.empreendimento.create({
      data: {
        imobiliariaId: imob.id,
        nome: "Aurora C",
        construtora: "Construtora X",
        cidade: "Araraquara",
        uf: "SP",
        faixasMcmv: [3, 4],
        metragemM2: 70,
        precoAvaliacao: 350_000,
      },
    });
    const imovel = await prisma.imovel.create({
      data: {
        imobiliariaId: imob.id,
        codigo: "AP-9001",
        tipo: "Apartamento",
        endereco: "Av. Brasil, 1200",
        cidade: "Araraquara",
        uf: "SP",
        proprietarioId: dono.id,
        empreendimentoId: emp.id,
        unidade: "Torre B — 402",
      },
    });

    const comEmp = await prisma.imovel.findUniqueOrThrow({
      where: { id: imovel.id },
      include: { empreendimento: true },
    });
    expect(comEmp.empreendimento?.faixasMcmv).toEqual([3, 4]);
    expect(valorM2(Number(comEmp.empreendimento!.precoAvaliacao), comEmp.empreendimento!.metragemM2)).toBe(5000);

    // ON DELETE SET NULL: some o empreendimento, a unidade continua na carteira.
    await prisma.empreendimento.delete({ where: { id: emp.id } });
    const solto = await prisma.imovel.findUniqueOrThrow({ where: { id: imovel.id } });
    expect(solto.empreendimentoId).toBeNull();
  });
});

describe("planta × pronto: quem parcela a entrada", () => {
  it("obra não entregue parcela a entrada; entregue exige à vista", () => {
    // Quem divide a entrada é a construtora, durante a obra. Prédio pronto não
    // tem obra para diluir o pagamento.
    expect(permiteParcelarEntrada({ entregaReal: null })).toBe(true);
    expect(permiteParcelarEntrada({ entregaReal: d("2025-06-01") })).toBe(false);
  });

  it("a situação vira condição de banco, para filtrar antes do take", () => {
    expect(whereSituacao("NA_PLANTA")).toEqual({ obraIniciadaEm: null, entregaReal: null });
    expect(whereSituacao("EM_OBRAS")).toEqual({
      obraIniciadaEm: { not: null },
      entregaReal: null,
    });
    expect(whereSituacao("ENTREGUE")).toEqual({ entregaReal: { not: null } });
    // Parcelar entrada não é uma situação só: é qualquer obra não entregue.
    expect(whereSituacao("PARCELA_ENTRADA")).toEqual({ entregaReal: null });
  });
});

describe("a ficha diz o que a IA pode oferecer", () => {
  const BASE = {
    nome: "Residencial Aurora",
    construtora: "Pacaembu",
    bairro: "Centro",
    cidade: "São José do Rio Preto",
    uf: "SP",
    pontoReferencia: null,
    metragemM2: 48,
    precoAvaliacao: 240_000,
    faixasMcmv: [2, 3],
  };

  it("sem book, a IA é proibida de prometer material", () => {
    const f = fichaParaIA(BASE);
    expect(f).toContain("book: não tem");
    expect(f).toContain("NÃO prometa material");
  });

  it("com book, a ficha aponta a ferramenta de envio", () => {
    const f = fichaParaIA({ ...BASE, bookUrl: "https://blob.test/a.pdf" });
    expect(f).toContain("book: DISPONÍVEL");
    expect(f).toContain("enviar_book_empreendimento");
  });

  it("quartos e banheiros entram na ficha — é por eles que o comprador filtra", () => {
    const f = fichaParaIA({ ...BASE, quartos: 2, banheiros: 1, vagas: 1 });
    expect(f).toContain("quartos: 2");
    expect(f).toContain("banheiros: 1");
    expect(f).toContain("vagas: 1");
  });

  it("a ficha diz se a entrada pode ser parcelada", () => {
    expect(fichaParaIA({ ...BASE, entregaReal: null })).toContain("PARCELADA");
    expect(fichaParaIA({ ...BASE, entregaReal: d("2025-06-01") })).toContain("à vista");
  });
});

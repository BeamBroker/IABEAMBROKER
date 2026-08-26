// Cada caso aqui é um tipo que existe de verdade no catálogo de produção
// (`SELECT tipo, count(*) FROM "Imovel" GROUP BY tipo`), não um exemplo
// inventado: é string livre vinda dos portais, e é justamente a variedade dela
// que quebrou o template.
import { describe, expect, it } from "vitest";
import {
  artigo,
  demonstrativo,
  descreverImovel,
  generoDoTipo,
  ondeFica,
  pronome,
} from "@/lib/referencia-imovel";

describe("generoDoTipo", () => {
  it("acerta os femininos do catálogo real", () => {
    for (const t of ["Casa", "Casa de Condomínio", "Cobertura", "Chácara", "Sala/Conjunto", "Fazenda/Sítio/Chácara"])
      expect(generoDoTipo(t), t).toBe("f");
  });

  it("acerta os masculinos do catálogo real", () => {
    for (const t of ["Apartamento", "Apartamento Duplex", "Galpão", "Terreno", "Sobrado", "Lançamento", "Ponto Comercial/Loja", "Hotel/Motel/Pousada", "Outro"])
      expect(generoDoTipo(t), t).toBe("m");
  });

  it("olha só a PRIMEIRA palavra — é ela que rege o artigo", () => {
    // "Ponto Comercial/Loja" é *o* ponto, ainda que "Loja" seja feminino.
    expect(generoDoTipo("Ponto Comercial/Loja")).toBe("m");
    // "Fazenda/Sítio/Chácara" é *a* fazenda, ainda que "Sítio" seja masculino.
    expect(generoDoTipo("Fazenda/Sítio/Chácara")).toBe("f");
  });

  it("pega os irregulares que a terminação erraria", () => {
    expect(generoDoTipo("Kitnet")).toBe("f");
    expect(generoDoTipo("Loft")).toBe("m");
    expect(generoDoTipo("Studio")).toBe("m");
  });

  it("tipo vazio ou estranho não quebra", () => {
    expect(generoDoTipo("")).toBe("m");
    expect(generoDoTipo("   ")).toBe("m");
    expect(generoDoTipo("123")).toBe("m");
  });
});

describe("concordância", () => {
  it("artigo, pronome e demonstrativo seguem o gênero", () => {
    expect(artigo("f")).toBe("a");
    expect(pronome("f")).toBe("ela");
    expect(demonstrativo("f", "aquele")).toBe("aquela");
    expect(demonstrativo("f", "esse")).toBe("essa");
    expect(artigo("m")).toBe("o");
    expect(pronome("m")).toBe("ele");
    expect(demonstrativo("m", "aquele")).toBe("aquele");
  });
});

describe("ondeFica — o cliente decora o lugar, não a rua", () => {
  it("condomínio na frente de tudo, com a palavra 'condomínio' junto", () => {
    // O caso de 21/08: o imóvel fica no Gaivota I, na Av. Miguel Damha. Citar a
    // avenida fez o cliente achar que era outro condomínio.
    expect(ondeFica({ tipo: "Casa de Condomínio", condominio: "Gaivota I", bairro: "Gaivota I", endereco: "Avenida Miguel Damha, 1515" }))
      .toBe("no condomínio Gaivota I");
  });

  it("bairro com substantivo comum leva artigo, concordando com ele", () => {
    expect(ondeFica({ tipo: "Casa", bairro: "Centro" })).toBe("no Centro");
    expect(ondeFica({ tipo: "Casa", bairro: "Jardim Paulista" })).toBe("no Jardim Paulista");
    expect(ondeFica({ tipo: "Casa", bairro: "Vila Nova" })).toBe("na Vila Nova");
    expect(ondeFica({ tipo: "Casa", bairro: "Cidade Nova" })).toBe("na Cidade Nova");
  });

  it("nome próprio puro dispensa artigo — 'em Copacabana', não 'na Copacabana'", () => {
    expect(ondeFica({ tipo: "Casa", bairro: "Copacabana" })).toBe("em Copacabana");
    expect(ondeFica({ tipo: "Casa", bairro: "Gaivota I" })).toBe("em Gaivota I");
    // "Ipiranga" termina em -a e é masculino: é por isso que adivinhar o gênero
    // do nome próprio não funciona, e por isso ele fica sem artigo.
    expect(ondeFica({ tipo: "Casa", bairro: "Ipiranga" })).toBe("em Ipiranga");
  });

  it("sem bairro, cai para a cidade", () => {
    expect(ondeFica({ tipo: "Casa", cidade: "Ribeirão Preto" })).toBe("em Ribeirão Preto");
  });

  it("a RUA nunca é o lugar", () => {
    expect(ondeFica({ tipo: "Casa", endereco: "Avenida Miguel Damha, 1515" })).toBeNull();
  });
});

describe("descreverImovel", () => {
  it("monta a referência do caso real de 21/08", () => {
    const r = descreverImovel({
      tipo: "Casa de Condomínio",
      condominio: "Gaivota I",
      bairro: "Gaivota I",
      endereco: "Avenida Miguel Damha, 1515",
    });
    // "casa de condomínio no condomínio X" repetiria a palavra; o tipo encolhe.
    expect(r.texto).toBe("casa no condomínio Gaivota I");
    expect(r.genero).toBe("f");
    expect(`${artigo(r.genero)} ${r.texto}`).toBe("a casa no condomínio Gaivota I");
  });

  it("o tipo só encolhe quando o lugar É um condomínio", () => {
    // Sem condomínio cadastrado, "casa de condomínio" continua inteiro — é a
    // informação de que o imóvel fica em um, e aí ela não é redundante.
    const r = descreverImovel({ tipo: "Casa de Condomínio", bairro: "Gaivota I" });
    expect(r.texto).toBe("casa de condomínio em Gaivota I");
  });

  it("usa o endereço só quando não há lugar nenhum", () => {
    const r = descreverImovel({ tipo: "Apartamento", endereco: "Rua X, 10" });
    expect(r.texto).toBe("apartamento em Rua X, 10");
  });

  it("sem lugar e sem endereço, sobra o tipo", () => {
    expect(descreverImovel({ tipo: "Terreno" }).texto).toBe("terreno");
  });
});

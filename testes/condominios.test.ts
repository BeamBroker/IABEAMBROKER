import { describe, it, expect } from "vitest";
import {
  condominioNoTexto,
  condominioDoImovel,
  mesmoCondominio,
  chaveDoNome,
  bairroUtil,
  ligarPeloBairro,
  provaDeCondominio,
  grupoTemProva,
} from "@/lib/condominios";

// Os textos abaixo são reais, copiados de imóveis em produção (tenants 3 e 5).

describe("condominioNoTexto", () => {
  it("acha o nome no título, que é onde ele sai completo", () => {
    expect(condominioNoTexto("Casa térrea 3 suítes - Cond. Gaivota I - 230m²")).toBe("Gaivota I");
    expect(condominioNoTexto("Casa térrea 3 suítes - Cond. Village Provence")).toBe("Village Provence");
  });

  it("acha no endereço e nas observações", () => {
    expect(condominioNoTexto("Condomínio Residencial Jardins")).toBe("Jardins");
    expect(condominioNoTexto("Casa à VENDA no\n\n Condomínio: Jardins do Sul")).toBe("Jardins do Sul");
  });

  it("mantém 'Residencial' quando ele faz parte do nome próprio", () => {
    // As pessoas chamam o lugar de "Residencial Santa Regina", não de "Santa
    // Regina" — tirar o prefixo devolveria um nome que ninguém usa.
    expect(condominioNoTexto("Residencial Santa Regina")).toBe("Residencial Santa Regina");
  });

  it("NÃO inventa nome onde não há", () => {
    // Um condomínio inventado é pior que nenhum: a IA passaria a afirmar com
    // segurança um nome que não existe — o defeito que isto veio corrigir.
    expect(condominioNoTexto("condomínio fechado com portaria 24h")).toBeNull();
    expect(condominioNoTexto("condomínio de R$ 500")).toBeNull();
    expect(condominioNoTexto("valor do condomínio incluso")).toBeNull();
    expect(condominioNoTexto("Casa no centro, 3 quartos")).toBeNull();
    expect(condominioNoTexto("")).toBeNull();
    expect(condominioNoTexto(null)).toBeNull();
  });

  it("corta no separador, não engole o resto da frase", () => {
    expect(condominioNoTexto("Cond. Gaivota I, casa nova com piscina")).toBe("Gaivota I");
  });
});

describe("condominioDoImovel — ordem de confiança", () => {
  it("o título vence o resto", () => {
    const r = condominioDoImovel({
      titulo: "Casa - Cond. Gaivota I",
      bairro: "Residencial Marcia",
      observacoes: "Condomínio: Outro Nome",
    });
    expect(r).toEqual({ nome: "Gaivota I", origem: "titulo" });
  });

  it("sem título, cai para endereço e depois bairro", () => {
    expect(condominioDoImovel({ endereco: "Condomínio Residencial Jardins" })?.origem).toBe("endereco");
    expect(condominioDoImovel({ bairro: "Residencial Santa Regina" })?.origem).toBe("bairro");
  });

  it("imóvel de rua não ganha condomínio nenhum", () => {
    expect(condominioDoImovel({ titulo: "Casa 3 quartos", endereco: "Rua XV, 100", bairro: "Centro" })).toBeNull();
  });
});

describe("mesmoCondominio", () => {
  it("as variações do mesmo lugar batem", () => {
    // Sem isto a importação criaria três condomínios e a IA voltaria a listar o
    // mesmo lugar como se fossem vários — a origem de toda a confusão.
    expect(mesmoCondominio("Cond. Gaivota I", "Gaivota I")).toBe(true);
    expect(mesmoCondominio("Condomínio Gaivota I", "gaivota i")).toBe(true);
    expect(mesmoCondominio("Residencial Santa Regina", "Santa Regina")).toBe(true);
  });

  it("lugares diferentes NÃO batem", () => {
    expect(mesmoCondominio("Gaivota I", "Gaivota II")).toBe(false);
    expect(mesmoCondominio("Maria Julia", "Santa Regina")).toBe(false);
  });

  it("a chave ignora acento e caixa", () => {
    expect(chaveDoNome("Condomínio Jardins")).toBe(chaveDoNome("JARDINS"));
  });
});

describe("ligarPeloBairro — a segunda passada", () => {
  it("une o imóvel cujo bairro É o nome do condomínio", () => {
    // O caso real do Gaivota I: uma casa tinha "Cond. Gaivota I" no título e a
    // outra só "Oportunidade no Gaivota I" — sem prefixo, invisível para a
    // extração — mas com "Gaivota I" no campo bairro. Sem esta passada, o mesmo
    // condomínio apareceria como dois para o cliente, que foi o defeito de
    // origem.
    const semCond = [{ id: 577, bairro: "Gaivota I" }, { id: 999, bairro: "Centro" }];
    const r = ligarPeloBairro(semCond, ["Gaivota I", "Maria Julia"]);
    expect(r.get(semCond[0])).toBe("Gaivota I");
    expect(r.get(semCond[1])).toBeUndefined();
  });

  it("NÃO inventa condomínio a partir de bairro desconhecido", () => {
    // Senão todo bairro da carteira viraria um condomínio.
    const im = [{ id: 1, bairro: "Vila Alegre" }];
    expect(ligarPeloBairro(im, ["Gaivota I"]).size).toBe(0);
  });
});

describe("bairroUtil", () => {
  it("recusa o que não localiza nada", () => {
    // O cadastro real traz "Condomínio" no campo bairro. Usar isso faria a IA
    // dizer "o Set Life II fica no bairro Condomínio".
    expect(bairroUtil("Condomínio")).toBe(false);
    expect(bairroUtil("residencial")).toBe(false);
    expect(bairroUtil("")).toBe(false);
    expect(bairroUtil("Vila Alegre")).toBe(true);
  });
});

describe("o lixo que o dry-run de 18/08 pegou antes de gravar", () => {
  it("verbo e particípio depois de 'condomínio' não são nome", () => {
    expect(condominioNoTexto("condomínio oferece piscina e quadra")).toBeNull();
    expect(condominioNoTexto("Condomínio POSSUI portaria 24h")).toBeNull();
    expect(condominioNoTexto("condomínio assinado por Oscar Niemeyer")).toBeNull();
  });

  it("frase de anúncio não vira nome", () => {
    expect(condominioNoTexto("CONDOMÍNIO NOVA RESIDENCE COM LAZER COMPLETO E SEGURANÇA")).toBeNull();
  });
});

describe("provaDeCondominio — nome plausível não é prova", () => {
  it("tipo 'Casa de Condomínio' prova", () => {
    expect(provaDeCondominio({ tipo: "Casa de Condomínio" })).toBe("tipo");
  });

  it("'Condomínio' no endereço prova, inclusive para apartamento", () => {
    // Aqui o endereço NOMEIA o condomínio; é evidência sobre o lugar, não sobre
    // o imóvel pagar taxa.
    expect(provaDeCondominio({ tipo: "Apartamento", endereco: "Condominio Parque Rio das Flores I" })).toBe("endereco");
  });

  it("casa que paga taxa prova — casa em rua aberta não paga condomínio", () => {
    expect(provaDeCondominio({ tipo: "Casa", valorCondominio: 450 })).toBe("taxa");
  });

  it("APARTAMENTO com taxa NÃO prova — taxa só diz que existe um prédio", () => {
    // O caso "Residencial Maria Adélia", que entrou na carga do tenant 3 e
    // precisou ser removido: a taxa provava o prédio, e o nome tinha vindo do
    // campo bairro — era o bairro onde o prédio fica, não um condomínio.
    expect(provaDeCondominio({ tipo: "Apartamento", valorCondominio: 275 })).toBeNull();
    expect(provaDeCondominio({ tipo: "Cobertura", valorCondominio: 900 })).toBeNull();
  });

  it("imóvel sem nenhum sinal não prova nada", () => {
    expect(provaDeCondominio({ tipo: "Casa", endereco: "Rua XV, 100", valorCondominio: 0 })).toBeNull();
  });
});

describe("grupoTemProva — exige maioria", () => {
  it("um imóvel com prova entre cinco não basta", () => {
    const g = [{ tipo: "Casa de Condomínio" }, { tipo: "Casa" }, { tipo: "Casa" }, { tipo: "Casa" }, { tipo: "Casa" }];
    expect(grupoTemProva(g).aprovado).toBe(false);
  });

  it("maioria com prova aprova", () => {
    expect(grupoTemProva([{ tipo: "Casa de Condomínio" }, { tipo: "Casa de Condomínio" }, { tipo: "Casa" }]).aprovado).toBe(true);
  });
});

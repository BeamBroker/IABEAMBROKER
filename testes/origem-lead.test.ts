// A régua de "de onde o lead veio" — testes puros, sem banco.
//
// O que está sob teste não é aritmética: é a diferença entre um relatório de
// origem e um chute com cara de número. `Lead.origem` é texto livre escrito por
// quatro caminhos que não se falam, e cada tela que o lê inventava a própria
// régua. Uma régua errada não quebra nada — ela só manda cortar a verba certa.

import { describe, expect, it } from "vitest";

import { ORIGENS_DE_PORTAL, ehDePortal } from "@/lib/etiqueta-origem";
import { porCanal, procedenciaDoLead } from "@/lib/origem-lead";

describe("cada caminho de entrada cai no canal certo", () => {
  it("os portais do Grupo OLX e o ImovelWeb são PORTAL", () => {
    for (const p of ["ZAP", "VIVAREAL", "OLX", "IMOVELWEB"]) {
      const r = procedenciaDoLead(p);
      expect(r.canal).toBe("PORTAL");
      expect(r.portal).toBe(p);
    }
  });

  // O bug de uma letra, fixado. `lib/portais.ts:294` grava "CANAL_PRO" (com
  // underscore) e a régua daqui procurava "CANALPRO" — logo TODO lead do Canal
  // Pro classificava como DESCONHECIDO, `pago: false`, no módulo que existe
  // para decidir onde colocar dinheiro. O Canal Pro é o portal que a
  // imobiliária PAGA: o erro apagava exatamente a linha de custo que ele
  // deveria provar. Custo zero para reparar, invisível para quem só olha a tela.
  it("CANAL_PRO — com o underscore que o webhook realmente grava — é PORTAL e é PAGO", () => {
    const r = procedenciaDoLead("CANAL_PRO");
    expect(r.canal).toBe("PORTAL");
    expect(r.portal).toBe("CANAL_PRO");
    expect(r.pago).toBe(true);
  });

  it("PORTAL — o guarda-chuva de quando o payload não diz qual — é PORTAL e é PAGO", () => {
    // `origemDoCanalPro` grava "PORTAL" quando o `leadOrigin` é um valor novo do
    // fornecedor. Continua sendo lead comprado; só não dá para dizer de qual dos
    // três portais. Cair em DESCONHECIDO aqui subtraía 25 leads do censo da
    // coluna paga.
    const r = procedenciaDoLead("PORTAL");
    expect(r.canal).toBe("PORTAL");
    expect(r.pago).toBe(true);
    // Não sabemos QUAL portal — e o campo que responde isso diz `null` em vez de
    // repetir a palavra "PORTAL", que não é nome de portal nenhum.
    expect(r.portal).toBeNull();
  });

  it("Facebook é META, não portal — é mídia SUA", () => {
    // O erro que a régua antiga cometia: FACEBOOK caía no mesmo balde "outros"
    // que o ZAP. São economias diferentes — uma você compra por clique, a outra
    // por assinatura — e juntá-las num número só apaga a decisão de verba.
    expect(procedenciaDoLead("FACEBOOK").canal).toBe("META");
    expect(procedenciaDoLead("INSTAGRAM").canal).toBe("META");
  });

  it("WHATSAPP é porta de entrada, não canal de aquisição", () => {
    const r = procedenciaDoLead("WHATSAPP");
    expect(r.canal).toBe("WHATSAPP");
    // A pessoa pode ter vindo de anúncio, placa ou amigo — o WhatsApp não sabe.
    // Marcar como atribuível seria fingir que sabe.
    expect(r.atribuivel).toBe(false);
  });

  it("site próprio e landing são SITE", () => {
    for (const s of ["SITE", "SITE_PROPRIO", "LANDING", "ORGANICO"]) {
      expect(procedenciaDoLead(s).canal).toBe("SITE");
    }
  });

  it("não depende de maiúscula nem de espaço em volta", () => {
    // O cadastro à mão é digitado por gente.
    expect(procedenciaDoLead("  zap  ").canal).toBe("PORTAL");
    expect(procedenciaDoLead("Indicação").canal).toBe("INDICACAO");
  });
});

describe("as duas réguas de origem concordam", () => {
  // O bug do CANAL_PRO existiu porque duas listas de portal eram digitadas à
  // mão em arquivos diferentes: `ORIGENS_DE_PORTAL` (o que o webhook grava) e o
  // `PORTAIS` daqui (o que a régua de verba reconhece). Divergiram em silêncio.
  // Agora `PORTAIS` é DERIVADO de `ORIGENS_DE_PORTAL`, e este bloco é o que
  // impede a regressão de voltar: qualquer portal novo que alguém acrescentar
  // do lado da escrita precisa continuar caindo numa coluna paga aqui.
  it("nenhuma origem que o webhook grava como portal cai em DESCONHECIDO", () => {
    for (const o of ORIGENS_DE_PORTAL) {
      const r = procedenciaDoLead(o);
      expect(r.canal, `${o} caiu em ${r.canal}`).not.toBe("DESCONHECIDO");
      // Todas consomem verba: portal por assinatura/pacote, Meta por clique.
      expect(r.pago, `${o} não foi contado como pago`).toBe(true);
    }
  });

  it("o que a régua de verba chama de PORTAL, a etiqueta também chama", () => {
    for (const o of ORIGENS_DE_PORTAL) {
      if (procedenciaDoLead(o).canal !== "PORTAL") continue;
      expect(ehDePortal(o), `${o} é PORTAL na verba e não é portal na etiqueta`).toBe(true);
    }
  });

  it("FACEBOOK é a ÚNICA divergência deliberada entre as duas listas", () => {
    // Entra pelo webhook de portal (Lead Ads), mas não é portal na régua de
    // verba: o anúncio é seu, dá para rastrear até a campanha. Se um dia
    // aparecer uma segunda exceção, este teste quebra e obriga a decidir — que
    // é o oposto de divergir em silêncio.
    const divergem = ORIGENS_DE_PORTAL.filter((o) => procedenciaDoLead(o).canal !== "PORTAL");
    expect([...divergem]).toEqual(["FACEBOOK"]);
  });
});

describe("desconhecido é uma resposta, não um default", () => {
  it("origem vazia NÃO vira SITE", () => {
    // É o ponto do módulo. A coluna tem default "SITE", então empurrar o vazio
    // para lá faz o site próprio parecer maior do que é — no relatório que
    // existe justamente para provar que ele cresce.
    expect(procedenciaDoLead("").canal).toBe("DESCONHECIDO");
    expect(procedenciaDoLead(null).canal).toBe("DESCONHECIDO");
    expect(procedenciaDoLead(undefined).canal).toBe("DESCONHECIDO");
  });

  it("texto que ninguém previu vira DESCONHECIDO e guarda o bruto", () => {
    const r = procedenciaDoLead("placa da esquina");
    expect(r.canal).toBe("DESCONHECIDO");
    // Preservar o texto é o que permite alguém ler a lista e decidir se vira
    // regra. Adivinhar aqui foi como o campo virou impossível de auditar.
    expect(r.bruto).toBe("placa da esquina");
  });
});

describe("pago e atribuível são coisas diferentes", () => {
  it("portal é pago e NÃO atribuível — quem anuncia é o portal", () => {
    const r = procedenciaDoLead("ZAP");
    expect(r.pago).toBe(true);
    expect(r.atribuivel).toBe(false);
  });

  it("Meta é pago E atribuível — o anúncio é seu", () => {
    const r = procedenciaDoLead("FACEBOOK");
    expect(r.pago).toBe(true);
    expect(r.atribuivel).toBe(true);
  });

  it("indicação não é paga nem atribuível", () => {
    const r = procedenciaDoLead("INDICACAO");
    expect(r.pago).toBe(false);
    expect(r.atribuivel).toBe(false);
  });

  it("site é atribuível mesmo sem custo — é onde a UTM chegaria", () => {
    const r = procedenciaDoLead("SITE");
    expect(r.pago).toBe(false);
    expect(r.atribuivel).toBe(true);
  });
});

describe("o agrupado não esconde o que não sabe", () => {
  const leads = [
    { origem: "ZAP", fechado: true },
    { origem: "ZAP", fechado: false },
    { origem: "FACEBOOK", fechado: false },
    { origem: "", fechado: false },
    { origem: "placa", fechado: false },
  ];

  it("DESCONHECIDO aparece na lista, não some", () => {
    // O tamanho do desconhecido é o que diz se vale confiar no resto do
    // relatório. Escondê-lo faz os percentuais fecharem em 100% mentindo.
    const canais = porCanal(leads).map((c) => c.canal);
    expect(canais).toContain("DESCONHECIDO");
  });

  it("junta origens diferentes que são o mesmo desconhecido", () => {
    const desconhecido = porCanal(leads).find((c) => c.canal === "DESCONHECIDO");
    expect(desconhecido?.leads).toBe(2); // "" e "placa"
  });

  it("ordena por quem FECHA, não por volume", () => {
    // Mesma régua da tela de marketing, e pelo mesmo motivo: numa decisão de
    // verba, quem traz muito e não fecha não pode abrir a lista.
    expect(porCanal(leads)[0]?.canal).toBe("PORTAL");
  });

  it("conta fechados por canal", () => {
    const portal = porCanal(leads).find((c) => c.canal === "PORTAL");
    expect(portal).toMatchObject({ leads: 2, fechados: 1, pago: true });
  });

  it("lista vazia devolve lista vazia, não uma linha zerada", () => {
    expect(porCanal([])).toEqual([]);
  });
});

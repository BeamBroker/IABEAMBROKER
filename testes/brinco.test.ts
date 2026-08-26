// O brinco: a marca que autoriza a IA a atender.
//
// Estes testes são a rede embaixo da decisão mais cara do plano de 26/08.
// Errar a polaridade do gate cala a IA de um cliente inteiro SEM SINAL NA TELA
// — o silêncio só aparece no faturamento do mês seguinte. Por isso a maior
// parte do arquivo não testa o caso feliz: testa o que acontece quando falta
// dado, quando o campo não veio, quando o lead existe mas não foi marcado.
//
// Sem banco: `montarBrinco` e `decidirGateBrinco` são puras de propósito.

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  CANAIS_ORIGEM,
  decidirGateBrinco,
  montarBrinco,
  temBrinco,
  type BrincoVia,
} from "@/lib/brinco";

const AGORA = new Date("2026-08-26T15:00:00.000Z");

function brinco(origem: string | null | undefined, via: BrincoVia = "INTEGRACAO") {
  return montarBrinco({ origem, via, agora: AGORA });
}

describe("a lista de canais não pode divergir do schema", () => {
  // O bug do CANAL_PRO nasceu de duas listas digitadas em arquivos diferentes.
  // `CANAIS_ORIGEM` é a terceira lista da mesma família (schema.prisma tem o
  // enum, o Prisma Client teria o tipo, e aqui está o espelho que existe para o
  // módulo ser importável antes de `prisma generate`). Este teste é o que
  // impede a terceira de repetir a história das duas primeiras.
  it("bate valor a valor com `enum CanalOrigem` de prisma/schema.prisma", () => {
    const schema = readFileSync("prisma/schema.prisma", "utf-8");
    const bloco = schema.match(/enum CanalOrigem \{([\s\S]*?)\n\}/)?.[1];
    expect(bloco, "enum CanalOrigem não encontrado no schema").toBeTruthy();
    const doSchema = bloco!
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//") && !l.startsWith("///"));
    expect(doSchema).toEqual([...CANAIS_ORIGEM]);
  });
});

describe("montarBrinco classifica o que os quatro caminhos gravam", () => {
  it("o Canal Pro — com underscore, como o webhook grava — é PORTAL", () => {
    const b = brinco("CANAL_PRO");
    expect(b.canalOrigem).toBe("PORTAL");
    // O detalhe é o que diz QUAL portal: o enum sozinho não separa o que a
    // imobiliária paga por pacote do que ela paga por assinatura.
    expect(b.origemDetalhe).toBe("CANAL_PRO");
  });

  it("o guarda-chuva 'PORTAL' é PORTAL sem detalhe — não sabemos qual", () => {
    const b = brinco("PORTAL");
    expect(b.canalOrigem).toBe("PORTAL");
    // Repetir "PORTAL" no campo que responde "qual portal?" seria inventar uma
    // resposta. `null` é a resposta certa.
    expect(b.origemDetalhe).toBeNull();
  });

  it("Facebook e Instagram são META, com a rede no detalhe", () => {
    expect(brinco("FACEBOOK")).toMatchObject({ canalOrigem: "META", origemDetalhe: "FACEBOOK" });
    expect(brinco("INSTAGRAM")).toMatchObject({ canalOrigem: "META", origemDetalhe: "INSTAGRAM" });
  });

  it("a IA gravando 'WHATSAPP' fixo vira canal WHATSAPP, sem detalhe", () => {
    expect(brinco("WHATSAPP", "IA_WHATSAPP")).toMatchObject({
      canalOrigem: "WHATSAPP",
      origemDetalhe: null,
    });
  });

  it("placa é canal próprio — o enum tem PLACA e a régua de leitura não", () => {
    // `procedenciaDoLead` não conhece PLACA e devolveria DESCONHECIDO. Resolver
    // aqui evita mexer no tipo `CanalLead`, que os relatórios já consomem.
    expect(brinco("PLACA").canalOrigem).toBe("PLACA");
  });

  it("texto que ninguém previu vira DESCONHECIDO e o bruto sobrevive", () => {
    const b = brinco("indicação do porteiro");
    expect(b.canalOrigem).toBe("DESCONHECIDO");
    // O detalhe guarda o texto: é a lista que alguém lê para decidir se vira
    // regra. Adivinhar aqui é como `Lead.origem` ficou impossível de auditar.
    expect(b.origemDetalhe).toBe("INDICAÇÃO DO PORTEIRO");
    expect(b.origem).toBe("INDICAÇÃO DO PORTEIRO");
  });
});

describe("as origens que EXISTEM em produção caem onde devem", () => {
  // Não é teste de caso inventado: é a tabela que o backfill vai aplicar sobre
  // a base real. Um canal errado aqui não quebra nada — só manda cortar a verba
  // certa, que é o defeito mais caro deste módulo.
  //
  // Censo citado em app/atendimento/page.tsx:272-286:
  //   FACEBOOK=152 · ZAP=42 · INDICACAO=31 · SITE=26 · PORTAL=25 · VIVAREAL=3
  const censo: Array<[string, string, boolean]> = [
    // [origem gravada, canal esperado, consome verba]
    ["FACEBOOK", "META", true],
    ["ZAP", "PORTAL", true],
    ["INDICACAO", "INDICACAO", false],
    ["SITE", "SITE", false],
    ["PORTAL", "PORTAL", true],
    ["VIVAREAL", "PORTAL", true],
  ];

  it.each(censo)("origem %s → canal %s", (origem, canal) => {
    expect(brinco(origem).canalOrigem).toBe(canal);
  });

  it("os 25 leads 'PORTAL' e os do Canal Pro entram na coluna PAGA", () => {
    // Eram os dois buracos do bug de uma letra: os dois caíam em DESCONHECIDO
    // com `pago: false`, subtraindo da conta justamente o que a imobiliária
    // compra. 25 + os do Canal Pro saíam do lado pago da régua de verba.
    for (const o of ["PORTAL", "CANAL_PRO"]) expect(brinco(o).canalOrigem).toBe("PORTAL");
  });

  it("as 7 opções do <select> de /leads têm todas um canal, e OUTRO é honesto", () => {
    // O formulário oferece estas sete. Se alguma cair em lugar nenhum, o
    // cadastro à mão nasce sem brinco utilizável — e é o caminho que o
    // "cadastrar no CRM começa o atendimento" usa.
    const opcoes = ["SITE", "PORTAL", "FACEBOOK", "WHATSAPP", "INDICACAO", "PLACA", "OUTRO"];
    const canais = opcoes.map((o) => brinco(o, "CADASTRO_CRM").canalOrigem);
    expect(canais).toEqual([
      "SITE",
      "PORTAL",
      "META",
      "WHATSAPP",
      "INDICACAO",
      "PLACA",
      // "OUTRO" é literalmente "não sabemos". DESCONHECIDO é a resposta certa —
      // empurrá-lo para SITE seria repetir o erro que criou este módulo.
      "DESCONHECIDO",
    ]);
  });
});

describe("origem vazia não vira SITE por acidente", () => {
  it("sem origem, num caminho normal, o canal é DESCONHECIDO", () => {
    // A coluna `origem` continua nascendo "SITE" (é o default histórico dela e
    // mexer nisso reescreveria o sentido das linhas antigas), mas o CANAL —
    // que é o campo novo, o que vai decidir verba — diz a verdade.
    const b = brinco("");
    expect(b.origem).toBe("SITE");
    expect(b.canalOrigem).toBe("DESCONHECIDO");
  });

  it("sem origem, numa carga, o canal é IMPORTACAO", () => {
    expect(brinco("", "IMPORTACAO").canalOrigem).toBe("IMPORTACAO");
  });

  it("null e undefined caem no mesmo lugar que a string vazia", () => {
    expect(brinco(null).canalOrigem).toBe("DESCONHECIDO");
    expect(brinco(undefined).canalOrigem).toBe("DESCONHECIDO");
  });
});

describe("o brinco carrega quem trouxe e quando", () => {
  it("`brincoEm` é data, não booleano — é o que permite auditar a ordem", () => {
    // Booleano responde "tem brinco". A data responde QUANDO, e é ela que
    // responde "a IA atendeu antes ou depois de o lead ser marcado?" no dia em
    // que o gate calar alguém por engano.
    expect(brinco("ZAP").brincoEm).toEqual(AGORA);
  });

  it("originadoPor é quem TROUXE, e vem separado de quem vai atender", () => {
    const b = montarBrinco({ origem: "FACEBOOK", via: "CADASTRO_CRM", originadoPorId: 7 });
    expect(b.originadoPorId).toBe(7);
    // O brinco NÃO decide o dono do atendimento: isso é do rodízio
    // (lib/distribuicao.ts). O lead que o Marco trouxe pode ser atendido pela
    // Ana, e as duas coisas continuam verdadeiras ao mesmo tempo.
    expect(b).not.toHaveProperty("corretorId");
  });

  it("sem campanha resolvida, campanhaId é null — nunca 0", () => {
    // 0 é id válido em nada e FK inválida em tudo; o `?? null` existe para o
    // caminho que não achou campanha não gravar lixo.
    expect(brinco("ZAP").campanhaId).toBeNull();
  });
});

describe("temBrinco", () => {
  it("marcado é ter data", () => {
    expect(temBrinco({ brincoEm: AGORA })).toBe(true);
  });

  it("lead sem marcação, lead inexistente e campo ausente são todos 'sem brinco'", () => {
    expect(temBrinco({ brincoEm: null })).toBe(false);
    expect(temBrinco(null)).toBe(false);
    expect(temBrinco(undefined)).toBe(false);
    expect(temBrinco({})).toBe(false);
  });
});

// ─── O GATE ─────────────────────────────────────────────────────────────────

describe("o gate NUNCA cala quem não pediu para ser calado", () => {
  it("histórico manda primeiro: quem já falava antes nasce pausado de qualquer jeito", () => {
    // Esta regra é de 04/08 e é anterior ao brinco: "a IA só trata lead que não
    // tem histórico". Ela vale nas DUAS instâncias — a que exige brinco e a que
    // não exige — e vale INCLUSIVE para quem tem brinco: ter marcação não faz de
    // um cliente antigo um lead novo.
    //
    // Antes de 26/08 quem prendia isto era um doc-viva em
    // lib/acoes-historico.test.ts que casava com o literal `iaPausada:
    // jaFalavaAntes` em lib/conversas.ts. O literal saiu quando o gate passou a
    // escrever a coluna, e a regra ficou sem teste de comportamento nenhum por
    // um instante. Este é o teste que ela devia ter tido desde o começo.
    for (const exigirBrinco of [false, true, null, undefined])
      for (const temBrinco of [false, true]) {
        const d = decidirGateBrinco({ exigirBrinco, temBrinco, jaFalavaAntes: true });
        expect(d.pausar, `exigirBrinco=${String(exigirBrinco)} temBrinco=${temBrinco}`).toBe(true);
        // Sem motivo: o silêncio por HISTÓRICO já tem o rastro dele, e carimbar
        // "sem brinco" aqui mandaria quem depura procurar o lead errado.
        expect(d.motivo).toBeNull();
      }
  });

  it("número central (exigirBrinco false) atende contato sem brinco", () => {
    // O caso que paga a conta: quem chama espontaneamente é hoje a maior parte
    // do atendimento e não tem brinco nenhum. Ligar a regra aqui resolveria o
    // problema da mensagem de família criando um bem pior.
    expect(decidirGateBrinco({ exigirBrinco: false, temBrinco: false, jaFalavaAntes: false }))
      .toEqual({ pausar: false, motivo: null });
  });

  it("instância que NÃO informou o campo é tratada como 'não exige'", () => {
    // Ausência de dado nunca pode virar silêncio. Um `Pick` que esqueceu o
    // campo, ou um mock de teste antigo, não pode calar a IA de um cliente.
    expect(decidirGateBrinco({ temBrinco: false, jaFalavaAntes: false }).pausar).toBe(false);
    expect(decidirGateBrinco({ exigirBrinco: null, temBrinco: false, jaFalavaAntes: false }).pausar)
      .toBe(false);
    expect(
      decidirGateBrinco({ exigirBrinco: undefined, temBrinco: false, jaFalavaAntes: false }).pausar
    ).toBe(false);
  });

  it("com brinco, atende mesmo no número que exige", () => {
    expect(decidirGateBrinco({ exigirBrinco: true, temBrinco: true, jaFalavaAntes: false }))
      .toEqual({ pausar: false, motivo: null });
  });
});

describe("o gate cala — e sempre deixa rastro de por quê", () => {
  it("WhatsApp pessoal do corretor: contato sem lead não é atendido", () => {
    // O caso levantado na reunião: chega mensagem de família no número pessoal
    // e a IA não pode responder.
    const d = decidirGateBrinco({ exigirBrinco: true, temBrinco: false, jaFalavaAntes: false });
    expect(d.pausar).toBe(true);
    expect(d.motivo).toMatch(/nenhum lead/);
  });

  it("lead existe mas está sem marcação: o motivo diz o id", () => {
    // É o caso do lead ANTIGO, anterior ao brinco. Sem o id no texto, quem
    // abrir a auditoria não consegue conferir se é bug ou backfill pendente.
    const d = decidirGateBrinco({
      exigirBrinco: true,
      temBrinco: false,
      jaFalavaAntes: false,
      leadId: 341,
    });
    expect(d.pausar).toBe(true);
    expect(d.motivo).toContain("341");
  });

  it("falha de LEITURA não pode se disfarçar de 'sem brinco'", () => {
    // Banco fora ou timeout não é ausência de brinco. Registrar os dois com o
    // mesmo texto manda quem for depurar procurar um lead que existe.
    //
    // A polaridade aqui é OPOSTA à do histórico da uazapi, e de propósito:
    // `exigirBrinco` só está ligado no aparelho PESSOAL do corretor, onde ele
    // mesmo está olhando a tela. Lead sem resposta ele responde; a IA falando
    // com a família dele não tem conserto.
    const d = decidirGateBrinco({
      exigirBrinco: true,
      temBrinco: false,
      jaFalavaAntes: false,
      leituraFalhou: true,
    });
    expect(d.pausar).toBe(true);
    expect(d.motivo).toMatch(/NÃO DEU PARA LER/);
    expect(d.motivo).not.toMatch(/nenhum lead casou/);
  });

  it("falha de leitura NÃO cala o número central", () => {
    // A trava só age onde foi ligada. Uma queda de banco não pode calar a IA de
    // quem nunca pediu o gate.
    expect(
      decidirGateBrinco({ exigirBrinco: false, temBrinco: false, jaFalavaAntes: false, leituraFalhou: true })
        .pausar
    ).toBe(false);
  });

  it("todo silêncio causado pelo brinco tem motivo preenchido", () => {
    // A invariante que sustenta a auditoria: se `pausar` é true POR CAUSA do
    // brinco, `motivo` não pode ser null — senão o gate cala em silêncio, que é
    // exatamente o defeito que este desenho existe para não ter.
    for (const leadId of [null, 1]) {
      const d = decidirGateBrinco({
        exigirBrinco: true,
        temBrinco: false,
        jaFalavaAntes: false,
        leadId,
      });
      expect(d.pausar && d.motivo !== null).toBe(true);
    }
  });
});

describe("o histórico continua mandando primeiro", () => {
  it("quem já falava com o aparelho nasce pausado, com ou sem brinco", () => {
    // A trava que já existe não muda de comportamento: quem tem histórico não é
    // lead novo. O brinco só ACRESCENTA um motivo de pausa, nunca remove um.
    for (const temBrincoAgora of [true, false]) {
      expect(
        decidirGateBrinco({ exigirBrinco: false, temBrinco: temBrincoAgora, jaFalavaAntes: true })
          .pausar
      ).toBe(true);
    }
  });

  it("pausa por histórico não vira auditoria de brinco", () => {
    // O rastro do histórico já existe no caminho dele. Carimbar
    // IA_CALADA_SEM_BRINCO aqui faria a trilha acusar o gate por um silêncio
    // que não é dele — e é a trilha que alguém vai ler para decidir se desliga
    // o gate.
    expect(
      decidirGateBrinco({ exigirBrinco: true, temBrinco: false, jaFalavaAntes: true }).motivo
    ).toBeNull();
  });
});

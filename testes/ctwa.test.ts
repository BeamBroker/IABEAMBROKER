// O anúncio que trouxe a pessoa, lido da primeira mensagem.
//
// A pergunta de cada teste é a mesma: dado um payload nesta forma, a atribuição
// SAI ou some? Some em silêncio é o caso ruim — nada quebra, nenhuma exceção
// sobe, e o lead de anúncio pago vira "FACEBOOK" sem anúncio nenhum, que é
// exatamente o estado de hoje.
//
// Puro: sem banco, sem rede.

import { describe, expect, it } from "vitest";

import { anuncioDaMensagem } from "@/lib/ctwa";

// O formato que a uazapi fala (WhatsApp Web / Baileys), com o envelope que ela
// usa: a mensagem vem dentro de `data`, e o conteúdo dentro de `message`.
const BAILEYS = {
  event: "messages",
  data: {
    id: "abc:r123",
    chatid: "5517999998888@s.whatsapp.net",
    fromMe: false,
    message: {
      extendedTextMessage: {
        text: "Olá, vi o anúncio",
        contextInfo: {
          externalAdReply: {
            title: "Apartamento 2 quartos no Centro",
            sourceType: "ad",
            sourceId: "120209876543210987",
            sourceUrl: "https://fb.me/1a2b3c",
            ctwaClid: "ARBxYzAbCdEf0123456789",
          },
        },
      },
    },
  },
};

// O formato da Cloud API oficial, caso a ponte normalize para ele.
const CLOUD = {
  entry: [
    {
      changes: [
        {
          value: {
            messages: [
              {
                from: "5517999998888",
                text: { body: "Olá, vi o anúncio" },
                referral: {
                  source_url: "https://fb.me/1a2b3c",
                  source_id: "120209876543210987",
                  source_type: "ad",
                  headline: "Apartamento 2 quartos no Centro",
                  ctwa_clid: "ARBxYzAbCdEf0123456789",
                },
              },
            ],
          },
        },
      ],
    },
  ],
};

describe("os dois dialetos entregam a mesma atribuição", () => {
  it("WhatsApp Web / Baileys: externalAdReply", () => {
    const a = anuncioDaMensagem(BAILEYS);
    expect(a).toMatchObject({
      // O id que junta o lead ao GASTO que lib/meta.ts já lê da Graph API.
      anuncioId: "120209876543210987",
      // A chave que se devolve à Meta na Conversions API.
      ctwaClid: "ARBxYzAbCdEf0123456789",
      dialeto: "externalAdReply",
    });
  });

  it("Cloud API: referral", () => {
    // Ler só um dialeto custa a atribuição inteira no dia em que a ponte
    // trocar de formato — e ela troca sem avisar, numa atualização de versão.
    const a = anuncioDaMensagem(CLOUD);
    expect(a).toMatchObject({
      anuncioId: "120209876543210987",
      ctwaClid: "ARBxYzAbCdEf0123456789",
      dialeto: "referral",
    });
  });

  it("acha o bloco esteja ele onde estiver no envelope", () => {
    // O envelope da uazapi varia entre raiz, `data`, `data.message` e lista —
    // lib/payload-uazapi.ts documenta o pântano em 80 linhas. Fixar um caminho
    // seria escolher um formato entre quinze e perder catorze em silêncio.
    const naRaiz = { contextInfo: BAILEYS.data.message.extendedTextMessage.contextInfo };
    const emLista = [{ data: { message: BAILEYS.data.message } }];
    const fundo = { a: { b: { c: { d: { e: naRaiz } } } } };
    for (const p of [naRaiz, emLista, fundo]) {
      expect(anuncioDaMensagem(p)?.anuncioId).toBe("120209876543210987");
    }
  });
});

describe("mensagem comum não inventa anúncio", () => {
  it("conversa normal devolve null", () => {
    // `null` é a resposta ESPERADA para a esmagadora maioria das mensagens.
    // Quem chama não deve tratar isso como erro.
    expect(anuncioDaMensagem({ data: { message: { conversation: "oi, tudo bem?" } } })).toBeNull();
  });

  it("payload vazio, nulo ou de outro tipo devolve null sem jogar", () => {
    // Este parser roda no caminho de TODA mensagem recebida. Uma exceção aqui
    // derrubaria atendimento por causa de um campo de marketing.
    for (const p of [null, undefined, {}, [], "texto", 42, { data: null }]) {
      expect(() => anuncioDaMensagem(p)).not.toThrow();
      expect(anuncioDaMensagem(p)).toBeNull();
    }
  });

  it("bloco de anúncio SEM id e SEM clid não conta como atribuição", () => {
    // Devolver um objeto todo nulo faria a medição contar como sucesso um
    // payload que não serve para nada — e a decisão de escrever o parser de
    // verdade depende justamente dessa contagem.
    const so_titulo = { contextInfo: { externalAdReply: { title: "Anúncio", sourceType: "ad" } } };
    expect(anuncioDaMensagem(so_titulo)).toBeNull();
  });
});

describe("o que é aceito como chave", () => {
  it("id só com clid ainda vale — é a chave da Conversions API", () => {
    const a = anuncioDaMensagem({ contextInfo: { externalAdReply: { ctwaClid: "ARBxYz01" } } });
    expect(a?.ctwaClid).toBe("ARBxYz01");
    expect(a?.anuncioId).toBeNull();
  });

  it("clid promovido para a raiz pela ponte também é achado", () => {
    // Ponte que "simplifica" o payload achata o bloco. O clid sozinho já vale.
    expect(anuncioDaMensagem({ ctwa_clid: "ARBxYz01", from: "5517999998888" })?.ctwaClid).toBe(
      "ARBxYz01"
    );
  });

  it("valor com espaço é frase, não id — e é recusado", () => {
    // Sem esta recusa, um `sourceId: "Anúncio de teste"` viraria uma linha na
    // coluna que tem @@unique e que serve para casar com o gasto da Graph API.
    const a = anuncioDaMensagem({
      contextInfo: { externalAdReply: { sourceId: "anuncio de teste", ctwaClid: "ARBxYz01" } },
    });
    expect(a?.anuncioId).toBeNull();
    expect(a?.ctwaClid).toBe("ARBxYz01");
  });

  it("id numérico (não string) é aceito", () => {
    // Ponte que converte tipos manda number. Recusar aqui perderia a
    // atribuição por causa de um tipo.
    expect(
      anuncioDaMensagem({ contextInfo: { externalAdReply: { sourceId: 120209876543210 } } })
        ?.anuncioId
    ).toBe("120209876543210");
  });
});

describe("payload hostil não derruba nem trava o webhook", () => {
  it("ciclo no objeto não vira laço infinito", () => {
    const a: Record<string, unknown> = { nome: "x" };
    a.eu = a;
    expect(anuncioDaMensagem(a)).toBeNull();
  });

  it("aninhamento muito fundo termina", () => {
    // Teto de profundidade: o parser desiste em vez de varrer para sempre.
    let fundo: Record<string, unknown> = { fim: true };
    for (let i = 0; i < 500; i++) fundo = { n: fundo };
    expect(() => anuncioDaMensagem(fundo)).not.toThrow();
  });
});

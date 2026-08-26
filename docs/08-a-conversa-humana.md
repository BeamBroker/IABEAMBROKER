# A conversa humana — o que é prompt, o que é arquitetura

Escrito a partir de uma revisão de comportamento pedida em 26/08: fazer a Maitê
parecer uma corretora conduzindo o atendimento, e não um programa respondendo.

O pedido tinha 30 itens. Este documento separa os três destinos possíveis de
cada um, porque tentar resolver com prompt o que depende de contexto é como se
perde tempo aqui:

- **prompt e regra** — mudou neste repositório, está no diff
- **já existia** — o comportamento pedido já está implementado, e o que faltava
  era outra coisa
- **arquitetura** — depende de banco, integração ou tela, e é do outro lado

---

## 1. O que mudou aqui

| arquivo | o que mudou | itens |
|---|---|---|
| `lib/fala-de-sistema.ts` **(novo)** | a régua das frases que denunciam o sistema, com o caso real de cada uma | 1, 2 |
| `lib/agentes.ts` → `PROMPT_BASE` | três blocos no fim: **não narre o sistema**, **veio de outro canal**, **não afirme o que não conferiu** | 1, 2, 3, 17 |
| `lib/agentes.ts` → `PROMPT_BASE` | dois-pontos, nome do cliente, variação de forma, lista de pedido, reapresentação, pergunta que só vale se muda algo agora | 6, 7, 11, 13, 14, 15, 19, 26 |
| `lib/agentes.ts` → `COMPRA_VENDA` | a pergunta do imóvel no nome passa a vir **depois** da do financiamento | 10 |
| `lib/agentes.ts` → `umaPassadaDoAgente` | o bloco de tom entra no `parteB`, antes do áudio, fora do `AJUDA_CORRETOR` | 16, 23 |
| `lib/tom-da-imobiliaria.ts` **(novo)** | quatro tons, no `iasConfig` que já existe. Sem migration | 16, 23 |
| `lib/followup.ts` | não se reapresenta, e só afirma disponibilidade com o status conferido | 17, 18, 19 |
| `lib/regua-cobranca.ts` | só o **primeiro** toque da fatura se apresenta | 19 |
| `lib/qualificacao.ts` | a pergunta do nome volta a ter **uma polaridade só** | — |
| `lib/mensagem-segura.ts` | mede a fala de sistema no log, **sem bloquear** | 1, 2 |

### As três decisões dentro dessas mudanças

**A fala de sistema é medida, não bloqueada.** A tentação era trocar a mensagem
inteira pela neutra quando um padrão casasse. Seria repetir o defeito mais caro
de `mensagem-segura.ts`: `"cota"` engolindo `"cotação do seguro-fiança"` e
devolvendo a frase neutra no lugar da resposta certa. Metade destas frases tem
uma versão legítima a uma palavra de distância — "não achei casa disponível no
Centro" é a resposta **certa**, e é o complemento interno ("na nossa carteira")
que separa uma da outra. O conserto do comportamento é o prompt; o log
`[FALA-DE-SISTEMA:<id>]` é o que dá dado para decidir bloquear depois.

**O tom padrão não acrescenta bloco nenhum.** `NATURAL` devolve string vazia.
Se ele repetisse "seja informal e leve" logo depois de o `PROMPT_BASE` já ter
dito isso, passariam a existir duas descrições da mesma voz competindo — e a
casa que não configurou nada receberia comportamento novo sem ninguém ter
decidido isso.

**Perguntada direto, ela não nega ser uma IA.** O bloco proíbe *narrar* o
sistema; ele não autoriza mentir sobre ele. Se o cliente perguntar se está
falando com um robô, a Maitê responde curto e segue atendendo. Negar é a única
coisa pior que narrar: quem descobre depois que foi enganado não volta.

---

## 2. O que já existia

Vale mais que a lista de mudanças, porque é o que impede de consertar duas vezes.

**O histórico completo já vai para o modelo.** `executarAgente` recebe o
histórico e manda as últimas **40** mensagens; quando existe `conversa.memoria`
(o resumo de longo prazo), a janela cai para **12**, porque mandar resumo mais
40 é pagar duas vezes pela mesma informação. Além disso o `parteB` já carrega,
quando existe: o cadastro do cliente da carteira, a situação da simulação do
seguro, a visita já marcada, o imóvel visitado nos últimos dias e o contrato em
entrada de chaves.

Ou seja: a Maitê **não** recebe só a última mensagem. Quando ela repete uma
pergunta já respondida, não é falta de histórico — é a regra de continuidade
perdendo para o roteiro da área, que é problema de prompt.

**As mensagens picadas já chegam agrupadas.** O `PROMPT_BASE` diz "elas chegam
juntas para você, como um bloco", o que indica que o agrupamento existe do outro
lado. **A janela precisa ser confirmada** — ver a pergunta em aberto abaixo.

**A pausa quando o corretor assume já existe.** `lib/fronteira-ia.ts` grava
`iaPausada` no instante da passagem, e `lib/atendimento-humano.ts` (fora deste
repo) faz o resgate automático sem despausar. A trava é a coluna, não o prompt.

**Também já existem:** o nome do contato no prompt (`conversa.contatoNome`), a
origem do lead (`brinco.ts`, `ctwa.ts`, `origem-lead.ts`), o resumo fixo que vai
ao corretor na transferência (`aviso-lead.ts`), o envio de fotos
(`enviar_fotos_imovel`) e os fluxos separados de locação e venda (`PROMPTS.VENDAS`
e `PROMPTS.COMPRA_VENDA`).

---

## 3. O que depende do sistema

### 3.1 Memória estruturada do lead — a maior lacuna

Hoje existem duas memórias, e nenhuma delas é a ficha pedida:

- `conversa.memoria`: **texto livre**, resumo de conversas anteriores. Serve para
  continuidade genérica, não para "ele já disse que tem pet".
- `QualificacaoMcmv`: estruturada e boa, mas **só de compra**, e desenhada para
  financiamento, não para preferência de produto.

Não existe ficha estruturada de **locação**, e não existe em lugar nenhum o
histórico de **quais imóveis foram apresentados, quais ele gostou e quais
descartou** — que é justamente o que impede a Maitê de reoferecer o que a pessoa
já recusou.

`lib/analise-lead.ts` já extrai perfil, promessas e pontos de atenção da conversa
por IA, mas o destino é o **card do CRM**. Nada disso volta para o prompt.

**Proposta.** Uma tabela `MemoriaLead` (uma linha por lead, atualizada pelo cron
de CRM que já lê as conversas), com os campos: finalidade, tipo, região,
condomínio, faixa de valor, quartos, suítes, garagem, pet, mobiliado, prazo,
financiamento, entrada, imóveis apresentados, imóveis que gostou, imóveis
descartados, visitas, última etapa, pendências, próximo passo. E um bloco novo no
`parteB`, renderizando só os campos preenchidos — campo vazio não vira linha, ou
o prompt cresce com "não informado" repetido quinze vezes.

Quem escreve nela deve ser o **cron de CRM**, não a ferramenta da IA no caminho
da resposta: a leitura da conversa inteira já roda lá, e pendurar mais uma
chamada de modelo no turno do cliente é latência no lugar mais caro.

### 3.2 Reconhecimento de link de imóvel

O bloco **VEIO DE OUTRO CANAL** manda pedir o link do anúncio. Hoje, quando o
link chega, **nada o lê**: ele entra na conversa como texto solto.

**Proposta.** Um `lib/link-de-anuncio.ts` que (1) reconheça o portal pela URL
(VivaReal, ZAP, OLX, Facebook Marketplace, Instagram), (2) extraia o código do
anúncio quando ele está na própria URL, e (3) tente casar com `Imovel` por
código de portal, endereço ou condomínio mais valor. Casou: o imóvel vira o
assunto e a conversa segue por ele. Não casou: a URL é gravada na ficha do lead
e entra no aviso ao corretor — sem nunca dizer ao cliente que não deu para
identificar.

### 3.3 Primeiro contato x continuidade

O modelo hoje deduz isso do histórico que recebe. Dedução funciona quase sempre e
falha exatamente quando importa: no primeiro turno depois de uma janela longa.

**Proposta.** Uma linha determinística no `parteB`, barata:
`"Esta conversa começou em <data>. Já foram N mensagens. Você NÃO é primeiro
contato."` — ou o inverso, quando é. É o mesmo desenho da linha da cidade, que
existe porque a Maitê perguntou a cidade da única cidade em que a casa opera.

### 3.4 Debounce das mensagens consecutivas

**Pergunta aberta para o Pablo:** existe agrupamento hoje, e qual é a janela? O
`PROMPT_BASE` afirma que as mensagens chegam em bloco, e o comportamento descrito
no pedido (uma resposta por mensagem, colidindo) sugere que ou não existe, ou a
janela é curta demais. Se não existir, o lugar é a fila de mensagens (o cron
`processar`, de 1 minuto), não o prompt: nenhuma instrução faz o modelo esperar
por uma mensagem que ainda não chegou.

### 3.5 Confirmação real de disponibilidade

O caso do follow-up está resolvido neste diff, e ele era o mais grave: a consulta
já trazia `Imovel.status` no `include` e a frase o ignorava, então um imóvel
alugado na semana anterior recebia "segue disponível".

O que **não** tem fonte consultável: aceite de pet, aceite de proposta, condição
de pagamento e horário de visita. Enquanto não houver, o prompt manda oferecer
confirmar em vez de afirmar — que é o comportamento certo, mas é contorno.

### 3.6 A tela do tom

`lib/tom-da-imobiliaria.ts` lê `Imobiliaria.iasConfig`, o mesmo JSON do nome da
atendente. **Não precisa de migration.** Falta o seletor em Configurações → IA,
ao lado do campo do nome, e o `auditar()` na troca — pelo mesmo motivo que o nome
tem: trocar a voz da atendente precisa deixar rastro.

### 3.7 O que ficou dependendo de migration

Para a Maitê **pular** a pergunta do imóvel no nome quando a compra é à vista
(item 10 na sua forma completa), não basta o prompt: `proximaPergunta()` continua
devolvendo `primeiroImovel` como quarta pergunta, e entre a ferramenta e o prompt
o modelo segue a ferramenta. Precisa de um campo `formaPagamento` em
`QualificacaoMcmv` e de um `seAplica` nas perguntas do bloco MCMV.

O que este diff faz é o que dava para fazer sem migration: a pergunta deixa de
chegar solta e passa a vir emendada na do financiamento, que é o que a fazia
soar aleatória depois de apresentar uma casa de dois milhões.

---

## 4. Onde o pedido bateu numa decisão de `docs/05`

Três pontos do pedido contrariam regras que estão registradas como definitivas.
Nenhum deles foi aplicado por conta própria.

**Emoji.** Os exemplos do pedido usam emoji ("vou te mandar agora 👇") e o item
23 pede emoji configurável. `docs/05` proíbe de forma absoluta, e a proibição
está na lista das que custaram cliente. Os quatro tons mantêm a proibição, e há
teste travando isso. Liberar emoji é decisão do dono, não efeito colateral de um
arquivo de tom.

**"Vou te mandar agora".** O pedido quer que "manda fotos" seja respondido com
"claro, vou te mandar agora". A regra de 04/08 proíbe anunciar ação não
executada, e ela nasceu de "as fotos saem em poucos minutos" seguido de nada. As
duas convivem **se** a ferramenta for chamada no mesmo turno, que é o que o
prompt já manda. O que continua proibido é a frase sozinha.

**Mostrar cedo, na compra.** `docs/05` registra que o dono avaliou e decidiu
manter as três perguntas de produto antes da busca. Nada neste diff mexe nisso.

---

## 5. A segunda revisão: curadoria, pacote e "nunca só não tem"

Segunda leva de 31 itens, no mesmo dia. O eixo é outro: não é mais só o jeito de
falar, é **o que a Maitê faz antes de abrir a boca**.

### 5.1 As dez perguntas técnicas, respondidas

| # | pergunta | como era | como está |
|---|---|---|---|
| 1 | como obtém o aluguel | `Imovel.valorSugerido`, campo único | igual |
| 2 | como identifica condomínio e IPTU | `valorCondominio` chegava; **`valorIptuMensal` não** | os dois chegam |
| 3 | como calcula o pacote | **não calculava** | `lib/pacote-locacao.ts` |
| 4 | como sabe se um valor único já é o pacote | não sabe, e não há flag | continua sem saber, ver abaixo |
| 5 | o que acontece com dado incompleto | silêncio: aluguel virava o total | o pacote se declara **piso** e manda confirmar |
| 6 | como aceita margem acima do teto | não aceitava | `MARGEM_ACIMA` de 10% |
| 7 | envio individual com fotos | `enviar_fotos_imovel` com `apenasCapa=true` já faz | existe, mas o prompt proíbe — ver 5.3 |
| 8 | como impede o envio de listas | nada impedia | a ferramenta manda **mostrar no máximo 3** |
| 9 | segunda busca após flexibilização | o modelo chama a ferramenta de novo | igual, e a busca vazia agora ensina a ordem |
| 10 | acionar parceiros | `buscar_em_parceiros` só no AJUDA_CORRETOR | **não implementado** — ver 5.4 |

**O defeito central era o item 3, e ele era de código.** A busca de locação
filtrava assim:

```ts
...(input.valorMaximo ? { valorSugerido: { lte: input.valorMaximo } } : {})
```

`valorSugerido` é **só o aluguel**. Quem pedia até R$ 1.700 recebia um
apartamento de R$ 1.500 com R$ 400 de condomínio e R$ 100 de IPTU: dois mil
reais por mês apresentados como mil e quinhentos, com a conta aparecendo na
assinatura. E o IPTU não chegava nem na apresentação — o prompt mandava mostrar
"o valor TOTAL (aluguel + condomínio + IPTU)" e a ferramenta entregava dois dos
três números, então o modelo somava o que não tinha.

Agora o SQL peneira pelo **aluguel com a margem** (o pacote é sempre maior ou
igual ao aluguel, então nenhum candidato válido é descartado) e quem decide é o
cálculo do pacote em JS. Somar três colunas dentro do `where` não é uma linha de
Prisma, e não precisa ser.

**Sobre o item 4, e é o único que continua em aberto.** Não existe campo que
diga "este valor já é o pacote". `valorSugerido` é o aluguel por definição do
schema; se alguém cadastrou o pacote inteiro ali, nada no sistema percebe. Isso
é qualidade de cadastro, não de código, e o remédio é um **relatório de imóveis
de locação sem `valorCondominio` ou `valorIptuMensal` preenchidos** — mede o
tamanho do buraco antes de qualquer decisão. Enquanto ele não existir, o pacote
incompleto sai marcado como piso e a Maitê oferece confirmar.

### 5.2 A busca vazia virou ordem, não notícia

A ferramenta devolvia `"Nenhum imóvel disponível com esses critérios."` — uma
**informação**, que o modelo repassava. Agora devolve uma **instrução** com a
escada inteira: solte o filtro menos importante, tente a região em volta,
pergunte uma flexibilização (uma só), espere a resposta, busque de novo.

O texto foi para dentro da ferramenta, e não para o prompt, pelo motivo de
sempre neste sistema: entre duas instruções, o modelo segue a mais próxima da
decisão. O resultado da ferramenta é o que está mais perto.

### 5.3 O que ficou dependendo de decisão do dono

**A abertura em três bolhas.** O pedido descreve três mensagens seguidas
("Boa noitee, tudo bem? É a Maitê" / "Me fala em qual região..." / "Se puder me
passar também com quantos dormitórios..."). `docs/05` diz: uma bolha, duas só
quando a segunda carrega link ou código, **três nunca**. O que entrou foi a
substância numa bolha só — região e valor são a mesma decisão e cabem na mesma
frase — e a pergunta dos dormitórios ficou para o turno seguinte.

**"Vou ver o que eu tenho aqui, já te mando aí."** É literalmente a frase que a
regra de 04/08 proíbe: "não escreva 'já mando', 'deixa eu ver aqui', 'um
instante'". Ela nasceu de "as fotos saem em poucos minutos" seguido de nada, com
o lead esperando para sempre. Não entrou como bolha solta. O que entrou é a
versão que não mente: a busca roda no mesmo turno e a resposta já sai com o
resultado.

**Fotos de cada imóvel na apresentação.** O pedido quer capa e descrição por
imóvel; o prompt manda texto primeiro e foto só depois do sim. A decisão de
26/08 é a mais explícita do repositório: um cliente real respondeu **"chega de
mandar foto"**. A ferramenta já suporta (`apenasCapa=true`, uma chamada por
imóvel), e com a curadoria limitando a três a objeção original perde força — mas
reverter isso é decisão do dono, não efeito colateral de uma revisão de tom. É
uma linha de prompt quando ele decidir.

**Titular do seguro fora da família.** O prompt dizia "nunca sugira usar o nome
de alguém que não seja da família". Passou a aceitar **amigo próximo**, como
pedido, com a guarda que faltava: a pessoa precisa saber e concordar, porque é
ela quem assina.

### 5.4 O fluxo de parceiros — o que precisa existir

A frase pedida ("tenho alguns corretores parceiros que podem ter o que você
procura, vou entrar em contato com eles e já já te chamo aqui") **não foi
implementada**, e o próprio pedido pede que seja sinalizado se o fluxo não
existir. Ele não existe:

- `buscar_em_parceiros` existe e funciona, mas está só na lista do
  `AJUDA_CORRETOR` — é uma ferramenta de consulta para o corretor, que devolve
  anúncios com link e telefone do anunciante.
- Não há nada que **acione** um parceiro, nem que devolva a conversa ao cliente
  depois. "Já já te chamo aqui" seria uma promessa sem ninguém do outro lado.

O que precisa existir para a frase poder ser dita:

1. **Um destino.** Ou a ferramenta entra em VENDAS com resultado direto ao
   cliente (e aí a promessa some, porque a resposta é imediata), ou existe uma
   fila de "busca em parceiros" que gera tarefa para um corretor humano.
2. **Um retorno.** Se for a fila, ela precisa de um gatilho que reabra a
   conversa quando o corretor responder. Sem isso, a promessa vira o caso de
   04/08 com outra roupa.
3. **Um prazo que alguém assuma.** "Já já" não é prazo, e prazo que ninguém
   cumpre custa mais caro que o não.

Enquanto isso, o passo final da escada é o que dá para cumprir: dizer com
franqueza que o que a casa tem hoje não faz o perfil dela, registrar o perfil
com `registrar_lead` e oferecer que um corretor procure.

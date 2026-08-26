# Como a IA funciona — o caminho de uma mensagem

Do "oi" do cliente até a resposta na tela dele.

## 1. A mensagem chega

O WhatsApp de cada imobiliária é uma **instância** no uazapi. Quando alguém
escreve, o uazapi chama um webhook do sistema (`/api/webhooks/uazapi`, fora
deste repositório). É a instância que recebeu a mensagem que decide **de qual
imobiliária** aquela conversa é. Guarde isso: o tenant não vem do texto, nem do
cliente — vem da linha que tocou.

## 2. Qual conversa é esta

`lib/conversas.ts` (fora deste repositório) resolve o interlocutor, nesta ordem:

| Quem escreveu | Vai para |
|---|---|
| um telefone cadastrado como **corretor** da equipe | `AJUDA_CORRETOR` — atendimento interno, consulta à carteira |
| um telefone que é **Pessoa da carteira** (locatário ou proprietário) | `ADMINISTRACAO`, com o cadastro dele carregado |
| qualquer outro número | a conversa mais recente dele, ou `RECEPCAO` se for a primeira vez |

Duas consequências que já custaram tempo:

- **Quem é da carteira nunca passa pela recepção.** A conversa dele nasce em
  ADMINISTRACAO e fica lá — a conversa é única por pessoa+perfil. Até 26/08 isso
  era um beco sem saída: o proprietário que queria comprar ouvia "um atendente
  vai entrar em contato" porque a administração não tinha ferramenta nenhuma de
  imóvel. Hoje toda área de cliente tem `direcionar_atendimento` (ver
  `docs/02-os-agentes.md`).
- **Testar a IA de um número cadastrado não testa o funil comercial.** Você cai
  na administração. Para exercitar compra ou locação, use um número que não
  esteja em `Pessoa`.

## 3. O prompt é montado

`executarAgente()`, em `lib/agentes.ts`. O texto que o modelo recebe tem duas
partes, e a divisão existe por causa de dinheiro:

- **Parte A — estável e cacheável**: `PROMPT_BASE` (o jeito de falar, as regras
  que valem para tudo) + o prompt da área + `TROCA_DE_AREA` nas quatro áreas de
  cliente. É idêntica para todas as imobiliárias, então o cache da Anthropic
  aproveita entre elas.
- **Parte B — variável**: o nome da atendente naquela casa, a cidade que ela
  atende, a taxa de administração, o percentual do seguro-fiança, o contexto do
  cliente (quando é da carteira) e a data de hoje.

O nome da IA entra na parte B como uma linha, em vez de ser substituído dentro
do texto — trocar o nome no meio do prompt invalidaria o cache de todo mundo.

## 4. As ferramentas daquela área

Cada área recebe uma lista fechada de ferramentas (o mapa no fim de
`toolsPorAgente`). A IA só consegue fazer o que está nessa lista: buscar imóvel,
mandar foto, registrar lead, gravar qualificação, encaminhar para outra área.

**Ela não tem acesso ao banco por conta própria.** Toda leitura passa por uma
ferramenta, e toda ferramenta filtra por `ctx.conversa.imobiliariaId`.

O teto prático é ~12 ferramentas por área: acima disso o modelo começa a errar a
escolha. Há um teste que trava esse limite.

## 5. Até duas passadas por turno

Este é o detalhe mais importante do arquivo, e o mais fácil de quebrar sem
querer.

`direcionar_atendimento` troca a área **no banco, no meio do turno** — mas o
prompt, as ferramentas e o modelo já foram escolhidos na entrada. Sem reentrar,
quem escreveria a primeira mensagem da área nova seria a área velha, que não tem
o roteiro nem as ferramentas dela.

Então: se a área mudou durante a passada, o texto daquela passada é
**descartado** (saiu do prompt errado) e o turno **reentra** com o agente certo.
Uma reentrada só, para não virar laço.

Na prática, o cliente escreve uma vez e o sistema pode chamar o modelo duas
vezes — a segunda é quem fala com ele.

## 6. Que modelo roda

| Área | Modelo | Por quê |
|---|---|---|
| `RECEPCAO` | Haiku | classificação: barata e suficiente |
| `ADMINISTRACAO` | Haiku | consulta a dados que já vêm prontos no contexto |
| `VENDAS`, `COMPRA_VENDA`, `CAPTACAO` | Sonnet | negociação: onde a qualidade vira receita |
| `AJUDA_CORRETOR` | Sonnet | é quem mais tem ferramentas e ESCREVE no CRM |

Sobrescrevível por variável de ambiente, para testar sem deploy.

## 7. Quando a IA não pode rodar

Três caminhos, e nenhum deles conta o problema ao cliente:

- **Sem chave da Anthropic** (nem da imobiliária, nem da plataforma): sai uma
  frase fixa por área, escrita para ser indistinguível de uma resposta real. O
  aviso vai para o log e para a tela de Configurações.
- **Cota da imobiliária estourada**: uma frase neutra ("recebi sua mensagem, já
  te respondo"). Cota é assunto entre a plataforma e a imobiliária, nunca do
  cliente final.
- **Erro na chamada ou turno sem texto**: mesma frase fixa, e uma linha em
  `LogAuditoria` com a ação `IA_CONTINGENCIA`, que aparece na tela de auditoria
  do cliente.

**Como saber se foi contingência ou se a IA rodou de verdade:** a tabela `UsoIA`
grava um registro por passada, com a área e o modelo. Se há `UsoIA` no segundo
da resposta, o modelo rodou — a resposta ruim é comportamento, não infra. Foi
assim que se descartou "falta de crédito" em duas investigações.

## 8. Antes do texto sair

`lib/mensagem-segura.ts` é a última barreira: nenhuma mensagem vai ao cliente
sem passar por ela. E `dividirEmBolhas` transforma o texto em uma ou mais
mensagens — por isso a regra "uma quebra de linha entre imóveis, nunca uma linha
em branco": linha em branco separa a lista em bolhas diferentes e espalha a sua
resposta em mensagens picadas.

# Onde a IA para e a pessoa assume

A decisão do dono, em 10/08, foi curta: **"ela para na coleta de dados"**. O
único objetivo da IA no comercial é mostrar a carteira, entender quem é a pessoa
e registrar o que ela respondeu — e entregar isso ao corretor.

Naquele dia saíram das áreas comerciais: `consultar_horarios`, `agendar_visita`,
`remarcar_visita`, `cancelar_visita` e `solicitar_fechamento`. Agendar visita era
o "principal resultado" dela até então; passou a ser a ficha cheia.

**A IA não marca visita, não remarca, não cancela, não registra proposta e não
fecha negócio.** Prometer qualquer um deles é mentir para o cliente.

## Os dois gatilhos da entrega

### 1. O cliente pede para visitar — `passar_para_corretor`

É o gatilho principal, e o mais recente (26/08). Quando ele pede para conhecer o
imóvel, a IA chama a ferramenta **na mesma resposta** e só então diz que um
corretor entra em contato para combinar dia e hora.

O que a ferramenta faz:

- marca o lead como **QUENTE** e grava na ficha `[IA] pediu visita — <código>`,
  com a observação de horário se houver
- roda o rodízio (escolhe o dono) e **chama o corretor de plantão** no WhatsApp
- é idempotente: rechamar não manda dois avisos nem duplica a nota
- **e cala a IA**: no mesmo instante, a conversa recebe `iaPausada`. Depois da
  passagem a Maitê não fala mais com o cliente — só lembra o corretor. A última
  mensagem dela é uma despedida curta, sem pergunta. Ver `docs/07`.

**Dizer que a equipe vai marcar sem chamar a ferramenta é abandonar o cliente** —
ninguém fica sabendo e ele espera uma ligação que não foi pedida a ninguém.

As duas peneiras continuam guardando a visita, que é onde o custo acontece
(deslocamento, chave, agenda de alguém):

- **locação**: sem simulação de seguro-fiança aprovada, não entrega
- **compra**: nome restrito confirmado e sem outro titular, não entrega — e aí
  ela oferece o caminho do familiar como titular em vez de recusar

### 2. A qualificação fecha

Quando a ficha do comprador fica completa, a entrega dispara sozinha.

**Por que o gatilho 1 precisou existir:** medido em 26/08, este aqui nunca havia
disparado. Eram 105 fichas abertas, **zero completas**, e zero avisos ao corretor
em 321 leads. São 15 perguntas (19 para casado), e ninguém chega à décima quinta
antes de pedir para ver a casa. A entrega estava pendurada num evento que não
acontecia.

### E o fim da cadência não é entrega quente

`lib/followup.ts` tem uma função chamada `entregarAoCorretor` que significa
**quase o contrário**: é o lead que ignorou os três toques, sai da esteira da IA
e volta para o painel como `EM_ATENDIMENTO`, sem avisar ninguém.

Ele deixou de virar `PERDIDO` por decisão de 10/08: "não respondeu a mensagem
automática" é evidência fraca demais para afirmar que o cliente não fecha — muita
gente não responde robô e atende telefone. Quem decide se está perdido passa a
ser gente.

A função da entrega quente se chama `distribuirEAvisar`, em `lib/distribuicao.ts`,
e o nome é diferente de propósito.

## O rodízio — `lib/distribuicao.ts`

Escolhe o dono por **menor déficit**: para cada corretor elegível calcula quanto
já recebeu contra quanto deveria ter recebido, e o lead vai para quem está mais
atrás. Empate desempata por quem está há mais tempo sem receber.

Sorteio ponderado seria uma linha e está errado neste volume: com dezenas de
leads por dia, a variância produz 7/2/1 onde se configurou 50/30/20 — sem bug
nenhum, só azar. E aí ninguém consegue provar que o sistema está certo, numa
conversa que é sobre divisão de comissão.

Quem está **com lead na mão agora** vai para o fim da fila, não para fora dela:
se todo mundo estiver ocupado, o rodízio normal decide.

**Peso zero em todo mundo significa "ninguém configurou", não "ninguém recebe"** —
senão a casa que nunca abriu a tela de cotas simplesmente não distribuiria lead
nenhum, para sempre, sem erro em lugar nenhum.

## O aviso ao corretor — `lib/aviso-lead.ts`

Template **fixo**, não escrito pelo modelo: o corretor lê isso correndo, entre um
compromisso e outro, e um resumo que muda de forma a cada lead faz o olho perder
o hábito de achar o telefone sempre no mesmo lugar.

O que vai: nome, telefone, origem, finalidade, o imóvel de interesse, o placar da
qualificação e um trecho da conversa. O que **não** vai: anotação interna da
equipe, e-mail e CPF — o texto sai por WhatsApp, o canal mais fácil de encaminhar
para o grupo errado.

Sai pelo número **da casa**, nunca pelo do corretor dono do lead.

> **Depende de configuração.** Sem o telefone de plantão preenchido em
> Configurações → Equipe, o aviso não sai: o lead vira QUENTE no painel e para
> por aí. Em 26/08, nenhuma das seis imobiliárias tinha esse campo preenchido.

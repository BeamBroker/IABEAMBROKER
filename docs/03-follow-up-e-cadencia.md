# Follow-up e cadência — o que a IA faz quando ninguém escreve

Metade do trabalho da Maitê acontece sem o cliente ter mandado nada. São cinco
motores independentes, todos disparados por cron, todos respeitando horário
comercial de Brasília.

Nenhum deles é conversa: são mensagens que ela **inicia**. Por isso as regras
aqui são mais duras que no atendimento — uma mensagem indesejada faz a pessoa
bloquear o número, e um número bloqueado não atende mais ninguém daquela casa.

---

## 1. Cadência de reengajamento — `lib/followup.ts`

O lead conversou e sumiu. A Maitê volta sozinha, três vezes, e para.

| toque | quando | contado de |
|---|---|---|
| 1º | **1 hora** | o último contato |
| 2º | **+23h** (cai no dia seguinte, na mesma hora da conversa) | o toque anterior |
| 3º | **+48h** (o terceiro dia) | o toque anterior |

`CADENCIA_HORAS = [1, 23, 48]`, e o array guarda o **intervalo** entre um toque
e o seguinte, não o instante.

**Eram cinco toques** (2h, 6h, 24h, 72h, 7 dias). Mudou por decisão do dono em
01/08: três, mais espaçados, e cada mensagem **retomando o assunto da última
conversa** em vez de repetir "e aí, pensou?" com outras palavras. Cinco
cobranças em uma semana é o que faz o cliente bloquear o número.

Uma imobiliária pode configurar a própria cadência pelo card do lead
(`followUpCadencia`); array vazio cai na de cima.

**Horário comercial** (America/Sao_Paulo, sempre):

| dia | janela |
|---|---|
| segunda a sexta | 9h–18h (o **primeiro** toque vai até 21h) |
| sábado | 9h–12h |
| domingo | não toca |

Toque que cai fora é adiado para a próxima abertura. Isto vale só para a
mensagem proativa: **responder** a quem escreveu de madrugada continua normal.

**Estado no lead:** `followUpEm` (quando dispara o próximo) e `followUpEtapa`
(quantos já foram, 0..3). **Toda mensagem recebida reinicia a cadência** — a
Maitê nunca reengaja por cima de uma conversa quente.

**Quando o envio falha:** três falhas consecutivas encerram a cadência daquele
lead. Com o reagendamento de 2h, são ~6h de janela comercial — folgado para uma
instância que caiu e voltou, curto para um número inválido continuar consumindo
IA. E a mensagem só entra no histórico **depois** do envio dar certo: antes,
cada retry gravava uma cópia, e a conversa de um lead acumulou 25 cópias da
mesma frase sem que uma única tivesse chegado.

**No fim da cadência a IA não desiste do lead: ela o entrega.** Ver
`docs/04-entrega-ao-corretor.md`.

---

## 2. Régua de cobrança — `lib/regua-cobranca.ts`

Para quem está devendo, em **escada**: o texto muda conforme o atraso avança, e
a régua **termina** — chega um ponto em que ela diz "daqui a equipe assume" e
para de mandar.

A régua anterior era um degrau só: a mesma mensagem para toda fatura atrasada, a
cada 5 dias, para sempre. Três problemas que custam dinheiro: só falava **depois**
do vencimento (e a maior parte do atraso no aluguel é esquecimento, não falta de
dinheiro — um lembrete três dias antes evita o atraso em vez de cobrar por ele);
repetia o mesmo texto até virar ruído; e nunca acabava.

---

## 3. Relacionamento — `lib/relacionamento.ts`

A Maitê falando **antes** de o assunto virar problema. O sistema já falava em
três momentos, todos reativos (alguém pagou, alguém deixou de pagar). Faltavam
os que a imobiliária **sabe** que vêm:

- **Reajuste** — o aluguel sobe no aniversário do contrato. Descobrir isso pelo
  boleto é a reclamação clássica da locação. Avisado com 30 dias, vira
  previsibilidade.
- **Renovação** — o contrato vence e ninguém falou nada.

---

## 4. Pós-visita — `lib/pos-visita.ts`

O que ela fala depois que o corretor levou o cliente no imóvel: o retorno, o que
achou, o próximo passo.

## 5. Pós-documentos — `lib/pos-documentos.ts`

O que ela fala entre "recebi seus documentos" e "chave na mão" — o trecho em que
o cliente fica no escuro e começa a achar que foi esquecido.

## 6. Abordagem de portal — `lib/abordagem-portal.ts`

A **primeira** mensagem para quem preencheu formulário no VivaReal, ZAP e afins.
O texto é **fixo, de template**, não escrito pelo modelo — e isso é decisão, não
economia: quem chega de portal recebe cinco abordagens de cinco imobiliárias em
minutos, e a nossa tem que ser reconhecível e imediata.

---

## Onde isso roda

| cron | intervalo | o que dispara |
|---|---|---|
| `whatsapp` | 15 min | cadência de follow-up, avisos agendados |
| `processar` | 1 min | fila de mensagens |
| `crm` | 1 hora | análise das conversas, movimento do quadro |
| `rotinas` | diário | relacionamento, régua de cobrança |

O cron do CRM também grava `UsoIA` — com o rótulo fixo `"VENDAS"`, mesmo não
sendo atendimento. Se você vir turnos de IA sem mensagem nenhuma no mesmo
segundo, é ele lendo conversa para alimentar o quadro, não a IA falando sozinha.

---

## A regra que atravessa tudo

**Nunca prometa uma ação que você não acabou de fazer.** Em 04/08 a IA disse
"deixa eu confirmar o código aqui e já mando pra você", depois "deixa eu tentar
de novo", e terminou prometendo "as fotos saem em poucos minutos". Nada saiu. O
lead ficou esperando para sempre.

Vai mandar foto? Chame a ferramenta **agora**, na mesma resposta. Não escreva
"já mando", "um instante", "vou confirmar".

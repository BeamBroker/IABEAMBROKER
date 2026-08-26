# IABEAMBROKER

O comportamento da **Maitê** — a atendente de IA da Beam Broker que conversa com
clientes reais no WhatsApp sobre a compra e o aluguel da casa deles.

Este repositório existe para que o comportamento da IA possa ser lido, discutido
e alterado sem abrir o sistema inteiro. É a área da chefe.

## O que tem aqui

```
lib/        24 arquivos · o que a IA fala, quando fala e o que ela faz
testes/     23 arquivos · as regras travadas em teste, com o caso real que as criou
docs/       como tudo funciona, em português
CLAUDE.md   as instruções do agente — leia se for usar Claude aqui
scripts/    sincronização com o sistema
```

| Arquivo | O que decide |
|---|---|
| `lib/agentes.ts` | **o coração**: os prompts das seis áreas e todas as ferramentas |
| `lib/qualificacao.ts` | a escada de perguntas da compra, as faixas do MCMV, os documentos |
| `lib/followup.ts` | a cadência de reengajamento: quantos toques, quando, com que texto |
| `lib/regua-cobranca.ts` | a régua de quem está devendo |
| `lib/relacionamento.ts` | a Maitê falando antes de o assunto virar problema |
| `lib/distribuicao.ts` · `lib/aviso-lead.ts` | quando o lead vira do corretor, e o aviso que ele recebe |
| `lib/acoes-bairro.ts` · `lib/condominios.ts` | como ela entende o lugar que o cliente falou |
| `lib/abordagem-portal.ts` | a primeira mensagem para quem veio de um portal |
| `lib/pos-visita.ts` · `lib/pos-documentos.ts` | o que ela fala depois da visita e no meio da papelada |
| `lib/seguro-fianca.ts` · `lib/prompt-seguro-fianca.ts` | a peneira do seguro na locação |
| `lib/mensagem-segura.ts` | a última barreira antes de qualquer texto sair |
| `lib/prompt-audio.ts` | como ela escreve quando a resposta vira nota de voz |
| `lib/ia-config.ts` | o nome da atendente, configurável por imobiliária |
| `lib/analise-lead.ts` · `lib/crm-conversas.ts` | a IA lendo a conversa para alimentar o quadro |

## O que NÃO tem aqui

O sistema. Não há banco, telas, webhook do WhatsApp, autenticação, cobrança nem
`package.json`. **Nada neste repositório roda** — os arquivos importam dezenas
de módulos que ficaram do outro lado.

Isso é de propósito: aqui se edita **texto e regra**; quem executa, testa e sobe
para produção é o Pablo, com a suíte inteira e dez portões de deploy.

## Por onde começar a ler

1. `docs/01-como-a-ia-funciona.md` — o caminho de uma mensagem, do WhatsApp até
   a resposta
2. `docs/02-os-agentes.md` — as seis áreas, o que cada uma faz e o que ela pode
3. `docs/03-follow-up-e-cadencia.md` — o que acontece quando o cliente some
4. `docs/04-entrega-ao-corretor.md` — onde a IA para e a pessoa assume
5. `docs/05-decisoes-que-nao-se-desfazem.md` — **o mais importante**: as regras
   que custaram um cliente para existir
6. `docs/06-como-mexer-e-devolver.md` — o ciclo de trabalho, do `pull` ao deploy

## Como uma mudança chega ao cliente

```
você edita aqui  →  push  →  o Pablo traz para o sistema
                              roda 4.000+ testes e o build
                              sobe pelos dez portões do deploy
                              mede numa conversa real
```

Não existe caminho daqui direto para produção, e é assim por desenho: do outro
lado tem gente decidindo onde vai morar.

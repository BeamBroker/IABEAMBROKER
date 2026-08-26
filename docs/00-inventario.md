# Inventário — o que está aqui, e de onde veio

Todos os arquivos são cópia de `administrativo/lib/`, o CRM da Beam Broker.
Os testes moram em `lib/` lá também; aqui eles ficam em `testes/` só para
separar a leitura.

Gerado em 26/08/2026.

## Comportamento (`lib/`)

| arquivo | linhas | o que é |
|---|---|---|
| `abordagem-portal.ts` | 264 | A primeira mensagem para quem preencheu o formulário do portal. |
| `acoes-bairro.ts` | 292 | Achar o bairro que a pessoa quis dizer. |
| `acoes-visita.ts` | 284 | O núcleo do agendamento de visita, compartilhável entre a IA e a tela. |
| `agentes.ts` | 5312 | Os agentes de IA do sistema (persona única: Maitê) — todos com PODER DE |
| `analise-lead.ts` | 294 | A leitura profunda da conversa de um lead — o que o cartão do Meu dia mo |
| `atendimento.ts` | 246 | (sem cabeçalho) |
| `aviso-lead.ts` | 398 | O aviso ao corretor de plantão: "caiu um lead, e é assim que você aborda |
| `condominios.ts` | 258 | Reconhecer o condomínio no meio do texto que o corretor escreveu. |
| `crm-conversas.ts` | 316 | A conversa alimenta o quadro. Sozinha. |
| `distribuicao.ts` | 297 | O rodízio de leads entre corretores. |
| `empreendimentos.ts` | 305 | Empreendimento: regras de ENTREGA e de ENQUADRAMENTO MCMV. |
| `followup.ts` | 780 | Motor de follow-up comercial (#7): cadência de reengajamento para nunca |
| `ia-config.ts` | 104 | Nome de cada IA (por agente), configurável por imobiliária. |
| `mensagem-segura.ts` | 115 | Última barreira antes do texto sair para o cliente final. |
| `mercado.ts` | 115 | Referência de preço para as IAs. Combina duas fontes, sempre honestas: |
| `pos-documentos.ts` | 113 | O que a Maitê fala entre "recebi seus documentos" e "chave na mão". |
| `pos-visita.ts` | 175 | (sem cabeçalho) |
| `prompt-audio.ts` | 106 | Escrever para o OUVIDO é diferente de escrever para o olho, e o TTS não |
| `prompt-seguro-fianca.ts` | 136 | O roteiro do seguro-fiança para a IA de locação. |
| `qualificacao.ts` | 814 | Qualificação de financiamento do comprador de EMPREENDIMENTO. |
| `referencia-imovel.ts` | 169 | Como o CLIENTE reconhece o imóvel do qual estamos falando. |
| `regua-cobranca.ts` | 317 | Régua de cobrança em ESCADA — o follow-up de quem deve. |
| `relacionamento.ts` | 256 | Relacionamento — a Maitê falando ANTES de o assunto virar problema. |
| `seguro-fianca.ts` | 180 | Simulação do seguro-fiança — a peneira que vem logo depois da triagem, A |

## Testes (`testes/`)

| arquivo | linhas | o que trava |
|---|---|---|
| `acoes-bairro.test.ts` | 316 | O bairro que a pessoa falou e o bairro que está no cadastro. |
| `agente-contingencia.test.ts` | 201 | A CONTINGÊNCIA DA IA, EXERCITADA — os três caminhos em que o turno termi |
| `agentes-tools.test.ts` | 1745 | Critérios de aceite do M3: o mapa de ferramentas por agente e a economia |
| `aviso-lead.test.ts` | 426 | O aviso que sai para o corretor de plantão. |
| `bairro-sem-o-tipo.test.ts` | 528 | O bairro certo, o tipo errado — e o que a IA precisa saber para não perd |
| `carteira-nao-vaza.test.ts` | 152 | A CARTEIRA DE UM TENANT NÃO APARECE NO OUTRO — exercitado, não lido. |
| `condominios.test.ts` | 167 | (sem cabeçalho) |
| `crm-conversas.test.ts` | 379 | A conversa alimentando o quadro, exercitada contra o BANCO. |
| `distribuicao.test.ts` | 138 | A regra que divide comissão entre pessoas. |
| `empreendimentos.test.ts` | 339 | Empreendimento: as três datas de entrega são coisas diferentes, e a faix |
| `followup-texto.test.ts` | 75 | A mensagem que o cliente lê. Cada caso aqui é uma frase que chegou (ou q |
| `mensagem-segura.test.ts` | 130 | Um cliente que queria comprar uma casa recebeu, no WhatsApp: |
| `nome-da-ia.test.ts` | 148 | (sem cabeçalho) |
| `pedido-de-visita.test.ts` | 203 | O PEDIDO DE VISITA É A ENTREGA — exercitado contra o banco. |
| `prompt-audio.test.ts` | 118 | A decisão de mandar áudio passou a vir ANTES de a IA escrever. Sorteada |
| `prompt-seguro-fianca.test.ts` | 166 | O roteiro do seguro-fiança depois da inversão da ordem. |
| `qualificacao.test.ts` | 583 | A escada de qualificação de empreendimento: as perguntas na ordem, e só |
| `referencia-imovel.test.ts` | 119 | Cada caso aqui é um tipo que existe de verdade no catálogo de produção |
| `regua-cobranca-banco.test.ts` | 183 | A régua rodando contra o BANCO, não só a lógica pura. |
| `relacionamento-banco.test.ts` | 154 | Relacionamento rodando contra o BANCO. |
| `saida-de-area.test.ts` | 238 | A SAÍDA DE ÁREA, EXERCITADA — o turno inteiro, do assunto novo até a res |
| `score-lead.test.ts` | 321 | O score, cobrado nas três regras que o tornam honesto. |
| `seguro-fianca.test.ts` | 162 | (sem cabeçalho) |

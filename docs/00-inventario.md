# Inventário — o que está aqui, e de onde veio

Cópia de `administrativo/lib/`, o CRM da Beam Broker. Os testes moram em
`lib/` lá também; aqui ficam em `testes/` só para separar a leitura.

Atualizado em 26/08/2026, a partir de `feature/integracao-26-08` mais a troca
para Sonnet 5 (commit `7a5df1d` do sistema).

> **Atenção ao que ainda não está em produção.** Na hora deste espelho,
> produção rodava `075decf`. O ciclo do lead (brinco, passagem, fronteira,
> cadência do vendedor) e a troca para Sonnet estavam prontos e testados, mas
> ainda não deployados. Ver `docs/07`.

## Comportamento (`lib/`) — 35 arquivos, 14997 linhas

| arquivo | linhas | o que é |
|---|---|---|
| `abordagem-portal.ts` | 278 | A primeira mensagem para quem preencheu o formulário do portal. |
| `acoes-bairro.ts` | 292 | Achar o bairro que a pessoa quis dizer. |
| `acoes-visita.ts` | 284 | O núcleo do agendamento de visita, compartilhável entre a IA e a tela. |
| `agentes.ts` | 5369 | Os agentes de IA do sistema (persona única: Maitê) — todos com PODER D |
| `analise-lead.ts` | 294 | A leitura profunda da conversa de um lead — o que o cartão do Meu dia  |
| `atendimento.ts` | 246 | (sem cabeçalho) |
| `atividades-cadencia.ts` | 155 | A cadência que faz a atividade nascer sozinha. |
| `aviso-lead.ts` | 398 | O aviso ao corretor de plantão: "caiu um lead, e é assim que você abor |
| `brinco.ts` | 403 | O BRINCO — o ponto ÚNICO onde um lead é marcado. |
| `cadencia-vendedor.ts` | 396 | A TERCEIRA cadência: a que cobra o VENDEDOR no WhatsApp dele. |
| `cobranca-vendedor.ts` | 688 | A COBRANÇA: quem manda o lembrete, para quem, e quando o gestor entra. |
| `condominios.ts` | 258 | Reconhecer o condomínio no meio do texto que o corretor escreveu. |
| `crm-conversas.ts` | 356 | A conversa alimenta o quadro. Sozinha. |
| `ctwa.ts` | 185 | CLIQUE-PARA-WHATSAPP: o anúncio que trouxe a pessoa, lido da mensagem. |
| `distribuicao.ts` | 365 | O rodízio de leads entre corretores. |
| `empreendimentos.ts` | 305 | Empreendimento: regras de ENTREGA e de ENQUADRAMENTO MCMV. |
| `entrega-ia.ts` | 155 | A hora em que a IA solta o card e um humano assume. |
| `followup.ts` | 816 | Motor de follow-up comercial (#7): cadência de reengajamento para nunc |
| `fronteira-ia.ts` | 205 | A FRONTEIRA: onde a IA para de falar com o cliente. |
| `ia-config.ts` | 104 | Nome de cada IA (por agente), configurável por imobiliária. |
| `mensagem-segura.ts` | 115 | Última barreira antes do texto sair para o cliente final. |
| `mercado.ts` | 115 | Referência de preço para as IAs. Combina duas fontes, sempre honestas: |
| `origem-lead.ts` | 183 | De onde o lead veio — uma resposta só, para todos os leads. |
| `passagem.ts` | 251 | A PASSAGEM do lead ao vendedor — o ponto único onde o relógio começa. |
| `pos-documentos.ts` | 113 | O que a Maitê fala entre "recebi seus documentos" e "chave na mão". |
| `pos-visita.ts` | 175 | (sem cabeçalho) |
| `prompt-audio.ts` | 106 | Escrever para o OUVIDO é diferente de escrever para o olho, e o TTS nã |
| `prompt-seguro-fianca.ts` | 136 | O roteiro do seguro-fiança para a IA de locação. |
| `qualificacao.ts` | 814 | Qualificação de financiamento do comprador de EMPREENDIMENTO. |
| `referencia-imovel.ts` | 169 | Como o CLIENTE reconhece o imóvel do qual estamos falando. |
| `regua-cobranca.ts` | 317 | Régua de cobrança em ESCADA — o follow-up de quem deve. |
| `relacionamento.ts` | 256 | Relacionamento — a Maitê falando ANTES de o assunto virar problema. |
| `seguro-fianca.ts` | 180 | Simulação do seguro-fiança — a peneira que vem logo depois da triagem, |
| `sla-fechamento.ts` | 232 | O fechamento do relógio: o vendedor respondeu, e em quanto tempo. |
| `sla-vendedor.ts` | 283 | O SLA do vendedor: quanto tempo entre a PASSAGEM do lead e a primeira |

## Testes (`testes/`) — 34 arquivos, 9707 linhas

| arquivo | linhas | o que trava |
|---|---|---|
| `acoes-bairro.test.ts` | 316 | O bairro que a pessoa falou e o bairro que está no cadastro. |
| `agente-contingencia.test.ts` | 201 | A CONTINGÊNCIA DA IA, EXERCITADA — os três caminhos em que o turno ter |
| `agentes-tools.test.ts` | 1745 | Critérios de aceite do M3: o mapa de ferramentas por agente e a econom |
| `atividades-cadencia.test.ts` | 83 | (sem cabeçalho) |
| `aviso-lead.test.ts` | 426 | O aviso que sai para o corretor de plantão. |
| `bairro-sem-o-tipo.test.ts` | 528 | O bairro certo, o tipo errado — e o que a IA precisa saber para não pe |
| `brinco.test.ts` | 333 | O brinco: a marca que autoriza a IA a atender. |
| `cadencia-vendedor.test.ts` | 283 | (sem cabeçalho) |
| `carteira-nao-vaza.test.ts` | 177 | A CARTEIRA DE UM TENANT NÃO APARECE NO OUTRO — exercitado, não lido. |
| `cobranca-vendedor.test.ts` | 458 | A cobrança que sai para o WhatsApp do corretor. |
| `condominios.test.ts` | 167 | (sem cabeçalho) |
| `crm-conversas.test.ts` | 379 | A conversa alimentando o quadro, exercitada contra o BANCO. |
| `ctwa.test.ts` | 174 | O anúncio que trouxe a pessoa, lido da primeira mensagem. |
| `distribuicao.test.ts` | 138 | A regra que divide comissão entre pessoas. |
| `empreendimentos.test.ts` | 339 | Empreendimento: as três datas de entrega são coisas diferentes, e a fa |
| `entrega-ia.test.ts` | 219 | A entrega do card pela IA, contra o BANCO. |
| `followup-texto.test.ts` | 75 | A mensagem que o cliente lê. Cada caso aqui é uma frase que chegou (ou |
| `fronteira-ia.test.ts` | 153 | A fronteira: a IA para de falar com o cliente depois do handoff. |
| `mensagem-segura.test.ts` | 130 | Um cliente que queria comprar uma casa recebeu, no WhatsApp: |
| `nome-da-ia.test.ts` | 148 | (sem cabeçalho) |
| `origem-lead.test.ts` | 190 | A régua de "de onde o lead veio" — testes puros, sem banco. |
| `passagem.test.ts` | 267 | O carimbo da passagem: as regras que decidem se o relógio existe. |
| `pedido-de-visita.test.ts` | 203 | O PEDIDO DE VISITA É A ENTREGA — exercitado contra o banco. |
| `prompt-audio.test.ts` | 118 | A decisão de mandar áudio passou a vir ANTES de a IA escrever. Sortead |
| `prompt-seguro-fianca.test.ts` | 166 | O roteiro do seguro-fiança depois da inversão da ordem. |
| `qualificacao.test.ts` | 583 | A escada de qualificação de empreendimento: as perguntas na ordem, e s |
| `referencia-imovel.test.ts` | 119 | Cada caso aqui é um tipo que existe de verdade no catálogo de produção |
| `regua-cobranca-banco.test.ts` | 183 | A régua rodando contra o BANCO, não só a lógica pura. |
| `relacionamento-banco.test.ts` | 154 | Relacionamento rodando contra o BANCO. |
| `saida-de-area.test.ts` | 238 | A SAÍDA DE ÁREA, EXERCITADA — o turno inteiro, do assunto novo até a r |
| `score-lead.test.ts` | 321 | O score, cobrado nas três regras que o tornam honesto. |
| `seguro-fianca.test.ts` | 162 | (sem cabeçalho) |
| `sla-fechamento.test.ts` | 231 | O fechamento do relógio: a regra que decide se o vendedor "respondeu". |
| `sla-vendedor.test.ts` | 300 | O SLA do vendedor: os casos que decidem um número que vai ser usado pa |

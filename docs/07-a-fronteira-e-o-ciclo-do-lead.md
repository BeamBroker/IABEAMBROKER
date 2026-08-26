# A fronteira, e o ciclo inteiro do lead

Escrito depois da **reunião de 26/08**. Júlia formulou e Samuel confirmou com
"exato":

> enquanto o cliente não responde, a IA faz o follow-up dela;
> depois que ela qualifica e **passa** para o vendedor,
> a IA não fala mais com o cliente — só lembra o corretor.

A primeira metade já existia. A segunda não: a entrega distribuía o lead,
avisava o plantão e **nunca calava a IA** — o prompt ainda mandava "depois disso
siga a conversa normalmente, tirando dúvidas". O handoff acontecia e a Maitê
continuava atendendo por cima do corretor.

Este documento descreve o ciclo completo, na ordem em que ele acontece.

---

## 1. Entrada — o brinco · `lib/brinco.ts`

Da mesma reunião: *"quando tem um rebanho de boi e eles têm um brinco com o
número deles… a gente vai colocar um brinco naquele lead"*, e **"quem não tiver
esse brinco não vai ser atingido"**.

O brinco é a marca que o lead recebe na entrada — canal, detalhe, campanha e
quem o trouxe — e é ela que **autoriza o atendimento automático**. Sem brinco,
nenhuma cadência toca naquele lead.

É um módulo, e não um campo a mais em cada `create`, porque `Lead` nasce em
quatro lugares que não se falam. Ponto único ou os quatro divergem em silêncio.

`lib/ctwa.ts` lê o anúncio de clique-para-WhatsApp que trouxe a pessoa;
`lib/origem-lead.ts` dá **uma** resposta de origem para todos os leads.

## 2. Atendimento — a IA conversa

`lib/agentes.ts`. Ver `docs/01` e `docs/02`.

## 3. Enquanto o cliente não responde — a cadência com ele

`lib/followup.ts`: 1h, dia seguinte, terceiro dia. Ver `docs/03`.

## 4. A passagem — onde o relógio começa · `lib/passagem.ts`

O carimbo morava dentro do rodízio, e o rodízio nem sempre roda: casa sem cota
configurada devolve "ninguém" **sem erro**, e é justamente a casa que mais
precisa do aviso. Medido em 26/08: `atribuidoEm` era escrito em 2 de ~5 caminhos
de entrega, e lido por **zero** linhas do sistema.

Agora existe um ponto único, com gatilho nomeado, e ele cobre os cinco caminhos —
inclusive o mais invisível, o fim da cadência (`FIM_CADENCIA_IA`), em que a IA
desistia, o lead virava `EM_ATENDIMENTO` e ninguém nunca soube em que instante
ele passou a ser responsabilidade de gente.

## 5. A fronteira — a IA cala · `lib/fronteira-ia.ts`

No mesmo instante da passagem, a conversa daquele lead recebe `iaPausada`.

**Quem cala de verdade é a coluna, não o prompt.** O prompt de
`passar_para_corretor` também mudou — "esta é a sua ÚLTIMA mensagem: encerre com
uma despedida curta, não faça pergunta nenhuma" —, mas essa frase existe só para
a última mensagem ser uma despedida em vez de uma pergunta nova. Modelo não é
garantia; a trava é o banco.

Achar a conversa do lead não é uma linha: liga-se por `Conversa.leadId`, que é a
ligação forte, e cai no telefone quando ela não existe (conversa aberta antes da
FK). Casar **só** por telefone é o que fazia pausar a conversa errada.

A mesma resolução é usada em dois lugares opostos — aqui para pausar, e no
resgate automático para **não** despausar.

## 6. Depois da passagem — a cobrança do vendedor

Aqui a IA não fala mais com o cliente. Ela passa a **lembrar o corretor**.

### As três cadências, e por que são três arquivos

| # | arquivo | fala com | por onde | ritmo |
|---|---|---|---|---|
| 1 | `followup.ts` | o **cliente** | WhatsApp dele | 1h · 1d · 3d |
| 2 | `atividades-cadencia.ts` | o **corretor** | tarefa na agenda | 24h · 72h · 168h |
| 3 | `cadencia-vendedor.ts` | o **corretor** | WhatsApp **dele** | 15min · 4h · 24h |

**A 1 e a 3 nunca podem se encontrar** — fundir os dois módulos é literalmente
desfazer a fronteira desta página.

**A 2 e a 3 se parecem e não são a mesma coisa.** A 2 escreve uma linha numa
lista que o corretor abre quando quiser; a 3 faz o celular dele apitar. Samuel
pediu a 3 com estas palavras: *"vai mandar tipo uma mensagem mesmo no WhatsApp
do corretor"*, *"avisa ele até a cabeça estourar, ele tem que tentar fazer os
três"*. E a 2 roda sobre `Negocio`: um lead entregue que nunca virou negócio não
recebia cobrança nenhuma. A 3 roda sobre `Lead` e fecha esse buraco.

`lib/cobranca-vendedor.ts` é quem manda o lembrete, para quem, e quando o
**gestor** entra no assunto.

### Duas regras de escrita que valem aqui

**Sem Prisma nos módulos de cadência, de propósito.** Cada número é uma regra de
negócio ("quinze minutos calado é atraso", "depois do terceiro o gestor entra"),
e regra que só dá para conferir com banco de pé é regra que ninguém confere.

**Nada de relógio de parede no texto.** As mensagens falam em "há 38 min", nunca
em "hoje 14:20". Não é estilo: formatar data obriga a escolher fuso, e este
código roda em container BRT lendo Postgres UTC, com o driver `pg` deslocando
`timestamp without time zone` em 3h. Duração é subtração de dois `Date` em
milissegundos, e não tem como errar.

## 7. O relógio fecha · `lib/sla-vendedor.ts` e `lib/sla-fechamento.ts`

Quanto tempo entre a passagem e a primeira resposta do vendedor — e o fechamento
quando ele responde. `lib/entrega-ia.ts` é a hora em que a IA solta o card e um
humano assume.

---

## O que isso muda para quem edita prompt

Se você escrever, em qualquer área, algo como "continue ajudando depois de
passar para o corretor", está desfazendo a decisão da reunião — e o
`iaPausada` vai calar a IA de qualquer forma, produzindo o pior dos dois mundos:
uma despedida que promete continuidade, seguida de silêncio.

A última mensagem antes da passagem é uma **despedida curta, sem pergunta**.

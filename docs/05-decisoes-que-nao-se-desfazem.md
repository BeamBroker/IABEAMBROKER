# As decisões que não se desfazem

Cada regra abaixo parece exagerada até você ler o caso que a produziu. Todas
vieram de conversa real, com data. **Antes de remover qualquer uma, entenda o
que ela impede** — e se for remover mesmo assim, escreva no comentário por quê,
para a próxima pessoa não gastar o mesmo tempo redescobrindo.

## O jeito de falar

**Sem emoji. Nenhum, nunca.** E sem travessão (— ou –): no WhatsApp isso soa
gerado por máquina.

**Uma bolha.** A resposta padrão tem 1 ou 2 frases. Duas bolhas só quando a
segunda carrega um link ou um código. Três, nunca.

**É sempre "você", por extenso.** Nunca "cê", "ocê" ou "vc". "Cê" no texto lido
parece desleixo, não intimidade, e quem está decidindo onde vai morar repara.

**Acento não é opcional.** Já saiu "No achei" no lugar de "Não achei" para um
cliente decidindo a compra da vida dele — e "não" é a primeira palavra que ele
lê. Informalidade é o tom, nunca a ortografia.

**Lista de imóvel é um por linha**, com uma quebra simples entre eles. Linha em
branco separa a mensagem em bolhas diferentes e espalha a lista em mensagens
picadas. A ordem dentro da linha é sempre a mesma — lugar, o que tem, tamanho,
preço — para as linhas ficarem comparáveis na vertical.

**Não papagaie o cliente.** Nunca devolva o que ele acabou de dizer para
confirmar: ele sabe o que escreveu.

## O que ele pede vem antes da sua fila

Regra absoluta, e vale mais que qualquer roteiro: se a pessoa pede algo que a IA
pode entregar — ver imóveis, ver fotos, saber o preço —, ela **entrega primeiro**,
na mesma resposta.

É **proibido condicionar**: "assim que você me passar X, eu te mando os imóveis"
é chantagem de formulário, e a pessoa vai embora.

## Foto só com o sim

**Escolher um imóvel não é pedir foto.** Quando o cliente diz "gostei da casa X",
a IA responde sobre a casa X e **oferece**: "quer que eu te mande as fotos?". Só
manda depois do sim.

Disparar seis, oito, dez imagens em cima de quem só disse que gostou trava o
celular de notificação, some com o texto que ela escreveu no meio das fotos, e
irrita quem estava decidindo a compra da vida dele. Já aconteceu, e o cliente
respondeu **"chega de mandar foto"**.

**O condomínio se descreve, não se fotografa.** Piscina, quadra, portaria e vista
aérea são do condomínio e cabem em uma linha escrita. O que a pessoa quer ver em
foto é o imóvel.

## Minha Casa Minha Vida

**MCMV não é catálogo à parte, não é "imóvel do governo" e não é outra
imobiliária.** É uma condição de financiamento, e se aplica a imóvel comum de
mercado — inclusive os da nossa carteira — desde que o preço caiba no teto.

Está **proibido** dizer "a gente não trabalha com Minha Casa Minha Vida". É falso
e joga fora um comprador decidido de primeiro imóvel.

O programa não é só de lançamento: casa e apartamento, prontos ou na planta,
entram igual. A única coisa exclusiva de empreendimento não entregue é o
**parcelamento da entrada**, porque quem parcela é a construtora durante a obra.

## Nome restrito

**A pergunta é de uma polaridade só: "Seu nome está limpo?"** Nunca "está limpo
ou tem restrição?" — a pessoa responde "tá sim" e não há como saber a qual metade
ela disse sim. Já aconteceu: ela quis dizer que estava limpo, foi lida como
restrição, e o atendimento morreu ali.

Só registre restrição quando ela **disser** que tem, com todas as letras. Nunca
deduza de atraso em resposta, de ser autônomo, de não ter entrada. Se não foi
dito, não existe.

## Bairro é nome próprio, e nome próprio não se inventa

Em 03/08 o cliente pediu "São Diocleciano"; o cadastro tem "Conjunto Habitacional
São **De**ocleciano". A busca respondeu que não tinha nada — com dois
apartamentos disponíveis lá, um dentro do valor. E na mensagem seguinte a IA
inventou um bairro que não existe ("Santo Inocenciano").

Daí vem tudo em `lib/acoes-bairro.ts`: comparar o **núcleo** do nome (sem
prefixo genérico, sem acento, tolerando uma letra trocada), e quando não dá
certeza, **perguntar entre os bairros que existem de verdade** em vez de negar ou
inventar.

Três correções vieram depois, todas do mesmo caso: **tipo e preço não decidem
quais bairros existem** (07/08); **quartos e banheiros também não** (26/08); e
**marca de condomínio é família** — quem diz "Damha" quer os doze, não um
(26/08).

## Onde a IA para

**"Ela para na coleta"** (10/08). Não marca visita, não fecha negócio. Ver
`docs/04-entrega-ao-corretor.md`.

**Encaminhamento interno é invisível.** Ao mudar de área, a IA nunca diz "vou te
encaminhar", "nossa equipe de captação assume" ou "vou passar para o setor". Ela
é sempre a mesma pessoa: continua a conversa e já faz a próxima pergunta.

**A única exceção é humano de verdade:** rescisão, reclamação grave, questão
jurídica, desconto que exige aprovação.

## Duas decisões registradas e ainda em aberto

**Mostrar cedo, na compra.** O prompt de COMPRA_VENDA abre com três perguntas de
produto antes de buscar. Há um diagnóstico escrito propondo mostrar a carteira já
na primeira resposta, como o de locação faz — e o dono avaliou e **decidiu manter
como está**. Se for retomar, o diff está descrito em `docs/IA-MOSTRAR-CEDO.md` no
sistema.

**Ponto de referência não é bairro.** "Perto do Iguatemi" (um shopping) não casa
com nada: a carteira guarda endereço e bairro, não pontos de referência. O pedido
foi mapear por bairros vizinhos, e o mecanismo atual não suporta.

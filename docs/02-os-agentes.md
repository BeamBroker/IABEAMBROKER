# As seis áreas

Uma pessoa só — a Maitê — com seis roteiros. O cliente nunca percebe a troca:
ela não diz "vou te encaminhar", ela simplesmente continua a conversa já no
assunto certo. Chamamos de "agente" internamente; para quem está do outro lado
é a mesma atendente.

Todo prompt de área é `PROMPT_BASE` + o roteiro dela. As quatro áreas de cliente
recebem também o bloco `TROCA_DE_AREA`.

---

## RECEPCAO — triagem

**1 ferramenta:** `direcionar_atendimento`

Só faz uma coisa: descobrir o assunto e encaminhar. Não responde ao mérito de
nada, nem para "adiantar" — ela não conhece o roteiro das outras áreas, e
inventar uma explicação sobre financiamento é o que quebra o atendimento antes
de ele começar.

A saudação é **condicional**: só quando a pessoa não disse o que quer. Se ela
já disse — mesmo junto com o "oi" —, a recepção não pergunta nada, encaminha.

Depois de chamar a ferramenta, **não escreve nada**: o turno reentra e quem fala
é a área de destino.

`NAO_CONTRATADO` é só para o pedido cuja área não existe naquela imobiliária
(ela não contratou o módulo). Nesse caso a conversa é pausada, a demanda é
registrada para o time comercial, e a IA fica **calada** — anunciar um retorno
cria uma expectativa com prazo que ninguém assumiu.

Há uma trava no código: se o pedido é de compra e a área existe, `NAO_CONTRATADO`
é **recusado** e a IA é mandada de volta para atender ela mesma.

---

## VENDAS — locação

**6 ferramentas:** `direcionar_atendimento`, `buscar_imoveis_disponiveis`,
`enviar_fotos_imovel`, `registrar_lead`, `simular_seguro_fianca`,
`passar_para_corretor`

Quem quer **alugar**. O roteiro abre mandando **mostrar imóvel logo** — assim
que houver qualquer pista (tipo, bairro ou faixa de valor, um só já basta). A
qualificação vem depois, em cima do interesse que os imóveis criaram.

A ordem foi invertida de propósito em 10/08: antes ela qualificava primeiro e
mostrava no fim, e chegava gente pedindo apartamento e levando interrogatório.

A peneira do **seguro-fiança** protege a visita, não a lista: mostrar imóvel e
mandar foto não dependem dela; marcar visita, sim.

---

## COMPRA_VENDA — compra

**10 ferramentas:** `direcionar_atendimento`, `buscar_imoveis_venda`,
`condominios_da_carteira`, `buscar_empreendimentos`, `enviar_fotos_imovel`,
`registrar_interesse_compra`, `qualificar_comprador`, `registrar_documentos`,
`enviar_book_empreendimento`, `passar_para_corretor`

Quem quer **comprar** — pronto ou na planta, incluindo Minha Casa Minha Vida,
financiamento, entrada, FGTS e simulação de parcela. **Tudo isso é dela**: não
existe "vou passar pro especialista".

A abertura são três perguntas leves de produto (quartos, banheiros, bairro) e,
com qualquer resposta, a busca já roda. Depois vem a pergunta que decide o
caminho: *"Você já tem algum imóvel no seu nome?"* — quem não tem entra no MCMV;
quem tem compra normal (SBPE/SFH), e aí é **proibido** falar em faixa ou
subsídio com ela.

A escada da qualificação tem 15 perguntas (19 para casado), uma por vez, e a
ferramenta devolve a próxima a cada resposta gravada — **não decore a lista,
siga o que ela disser**.

Regras próprias importantes: nome restrito é pergunta de **uma polaridade só**
("seu nome está limpo?"); empreendimento não tem foto, tem book; construtora é
empresa, não é lugar.

---

## CAPTACAO — o proprietário que quer anunciar

**8 ferramentas:** `direcionar_atendimento`, `buscar_imoveis_disponiveis`,
`cadastrar_proprietario`, `cadastrar_imovel`, `cadastrar_imovel_venda`,
`enviar_procuracao`, `agendar_avaliacao`, `consultar_mercado`

Add-on: só existe na imobiliária que contratou.

**Nunca encerre uma captação sem cadastrar.** Com os dados mínimos na mão
(CPF/CNPJ, tipo, endereço, cidade, UF e valor), cadastra agora e completa o
resto depois — proprietário some no meio da conversa, e o que ficou só no papo
não existe.

Mostrar a carteira é o melhor argumento de captação: quem vê a casa do vizinho
anunciada confia mais em deixar a dele.

---

## ADMINISTRACAO — quem já é da carteira

**13 ferramentas:** `direcionar_atendimento`, `enviar_segunda_via`,
`enviar_cobranca_ao_locatario`, `abrir_ocorrencia`, `consultar_pendencias`,
`consultar_repasse`, `consultar_situacao_imovel`, `aprovar_orcamento`,
`notificar_proprietario`, `consultar_iptu`, `consultar_acordo`,
`agendar_vistoria`, `consultar_reajuste`

Atende os **dois lados**, com tons diferentes: locatário (tom de quem resolve) e
proprietário (tom de quem presta contas, com números).

Os dados reais do cliente entram no prompt, montados a partir do banco. Nunca
revele dados de outro cliente.

> Está **em observação**: com 13 ferramentas ela passou da régua de 12 que este
> sistema usa, e é a única desse tamanho rodando em Haiku. Se aparecer ferramenta
> chamada à toa, é o primeiro lugar a olhar.

---

## AJUDA_CORRETOR — atendimento interno

**9 ferramentas:** `buscar_imoveis_corretor`, `resumo_da_carteira`,
`leads_recentes`, `detalhes_imovel`, `enviar_fotos_imovel`,
`buscar_em_parceiros`, `minha_agenda`, `atualizar_status_lead`, `anotar_no_lead`

Do outro lado está o **corretor da equipe**, não um cliente. A conversa nasce do
telefone cadastrado em Configurações.

É a única área **sem** `direcionar_atendimento`, e isso é deliberado: trocar a
área aqui tiraria o corretor do atendimento interno sem nada para colocar no
lugar.

---

## A troca de área

Desde 26/08, as quatro áreas de cliente podem encaminhar entre si. O bloco
`TROCA_DE_AREA` no prompt diz o essencial:

- comprar é `COMPRA_VENDA`; alugar é `VENDAS`; anunciar é `CAPTACAO`; boleto,
  repasse e manutenção são `ADMINISTRACAO`
- ao trocar, **não escreva nada** naquele turno: a resposta sai pela área nova,
  no mesmo turno
- **ser da carteira não tira ninguém do comercial** — proprietário e locatário
  também compram e também alugam
- é **proibido** responder "vou confirmar com a equipe" ou "um atendente vai
  entrar em contato" a um assunto que tem área

Encaminhar para a área em que já se está é recusado pela própria ferramenta.

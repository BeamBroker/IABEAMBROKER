# IABEAMBROKER — instruções para o agente

Você está no repositório onde mora **o comportamento da Maitê**, a atendente de
IA da Beam Broker que fala com clientes reais no WhatsApp, todos os dias, sobre
a compra e o aluguel da casa deles.

Leia este arquivo inteiro antes de propor qualquer mudança. Depois leia
`docs/05-decisoes-que-nao-se-desfazem.md` — ele existe porque várias das regras
que parecem estranhas aqui foram escritas depois de custarem um cliente.

## O que este repositório é, e o que ele não é

**É** a cópia dos arquivos que decidem o que a IA fala, quando fala, para quem
encaminha e como persegue um lead que sumiu. São 24 arquivos de comportamento e
23 arquivos de teste, tirados do sistema `administrativo`, que é o CRM completo
da Beam Broker.

**Não é** o sistema. Aqui não há banco, não há telas, não há o webhook que
recebe a mensagem do WhatsApp, não há `package.json`. **Nada aqui roda.** Você
não consegue executar `npm test` neste repositório, e não deve tentar: o código
importa `@/lib/db`, `@prisma/client` e dezenas de módulos que ficaram do outro
lado.

Isso é deliberado. O que se edita aqui é **texto e regra**; quem executa, testa
e sobe para produção é o Pablo, na máquina dele, com a suíte inteira (4.000+
testes) e dez portões de deploy. Ver `docs/06-como-mexer-e-devolver.md`.

## O mapa em uma tela

```
WhatsApp do cliente
        │
        ▼
  webhook (fora deste repo)
        │
        ▼
  lib/conversas.ts (fora deste repo) — decide QUAL conversa é esta:
        │   • telefone é de um corretor cadastrado → AJUDA_CORRETOR
        │   • telefone é uma Pessoa da carteira    → ADMINISTRACAO
        │   • qualquer outro                        → RECEPCAO
        ▼
  lib/agentes.ts · executarAgente()      ← O CORAÇÃO. 5.300 linhas.
        │   monta o prompt = PROMPT_BASE + prompt da área (+ TROCA_DE_AREA)
        │   entrega ao modelo a lista de ferramentas daquela área
        │   até DUAS passadas: se a área mudou no meio, descarta o texto
        │   da primeira e refaz com o prompt certo
        ▼
  resposta ao cliente
```

Em paralelo, sem ninguém escrever nada, rodam os motores de perseguição:
`followup.ts` (reengajamento), `regua-cobranca.ts` (quem deve),
`relacionamento.ts` (antes de virar problema), `pos-visita.ts`,
`pos-documentos.ts`, `abordagem-portal.ts` (lead que veio de portal).

## Onde mexer o quê

| Você quer mudar… | Mexa em |
|---|---|
| o jeito de falar (tom, emoji, tamanho da bolha, ortografia) | `lib/agentes.ts` → `PROMPT_BASE` |
| o roteiro de uma área (o que ela pergunta e em que ordem) | `lib/agentes.ts` → `PROMPTS.RECEPCAO` / `.VENDAS` / `.COMPRA_VENDA` / `.CAPTACAO` / `.ADMINISTRACAO` / `.AJUDA_CORRETOR` |
| quando ela troca de assunto/área | `lib/agentes.ts` → `TROCA_DE_AREA` e a ferramenta `direcionar_atendimento` |
| o que ela **pode fazer** (as ferramentas de cada área) | `lib/agentes.ts` → o mapa no fim de `toolsPorAgente` |
| as perguntas da qualificação de compra e as faixas do MCMV | `lib/qualificacao.ts` |
| como ela entende o nome de um bairro/condomínio | `lib/acoes-bairro.ts`, `lib/condominios.ts` |
| quantos toques de reengajamento e de quanto em quanto tempo | `lib/followup.ts` → `CADENCIA_HORAS` |
| o texto das mensagens de reengajamento | `lib/followup.ts` |
| quando o corretor recebe o lead | `lib/distribuicao.ts` + o gatilho em `lib/agentes.ts` |
| o texto do aviso que chega ao corretor | `lib/aviso-lead.ts` |
| o nome da atendente | `lib/ia-config.ts` (mas o nome real vem do banco, por imobiliária) |
| como ela escreve quando a resposta virar áudio | `lib/prompt-audio.ts` |

## As cinco regras que você não pode violar

**1. Multi-tenant. Nenhum dado atravessa a parede.**
Cada imobiliária tem a própria carteira, os próprios leads, os próprios
contratos. Toda consulta ao banco filtra por `imobiliariaId`, que vem de
`ctx.conversa.imobiliariaId` — e essa conversa nasceu da **linha de WhatsApp**
que recebeu a mensagem. Se você mexer em qualquer objeto de filtro (`where`),
confira que o `imobiliariaId` continua lá. `testes/carteira-nao-vaza.test.ts`
existe só para isso, e ele pega o vazamento: remover o tenant do filtro de
bairros faz o teste falhar apontando a carteira do vizinho.

**2. Regra contraditória: o modelo obedece à mais próxima.**
Está escrito com todas as letras num comentário do próprio `agentes.ts`, depois
de custar caro duas vezes. Se você acrescentar uma instrução que contradiz outra
dez linhas acima, o resultado não é "ela pondera": é ela seguir a que estiver
mais perto do ponto de decisão. Antes de acrescentar, **procure a regra
existente sobre aquele assunto e edite-a**, em vez de escrever uma nova.

**3. Nunca prometa uma ferramenta que não existe.**
Se o prompt manda "chame `agendar_visita`" e a ferramenta não está na lista
daquela área, a IA promete ao cliente algo que nunca acontece. Foi o erro mais
caro deste sistema: em 04/08 ela disse "as fotos saem em poucos minutos" e o
lead esperou para sempre. Ao mexer no prompt de uma área, confira a lista de
ferramentas dela no fim de `toolsPorAgente`.

**4. Nada de segredo. Em lugar nenhum.**
Nem em código, nem em comentário, nem em prompt, nem em mensagem de erro. Chave
de API, senha, token e o telefone de cliente não entram neste repositório.

**5. O comentário é a documentação.**
Este código usa comentário como memória institucional: quase toda regra
estranha tem, do lado, o caso real que a produziu — com data e, muitas vezes, o
diálogo. **Quando mudar comportamento, escreva o porquê ao lado.** Sem isso, a
próxima pessoa desfaz sua decisão achando que é sobra.

## Como escrever prompt neste sistema

O prompt não é um pedido educado, é uma especificação. O estilo aqui é:

- **Regra em caixa alta quando é dura** (`NUNCA`, `PROIBIDO`, `SEMPRE`), e uma
  frase logo abaixo dizendo **por que** — a explicação é o que impede o modelo
  de "flexibilizar" a regra sob pressão do cliente.
- **Exemplo concreto do certo e do errado.** "E não assim: ..." vale mais que
  três parágrafos de teoria.
- **Ordem importa.** O que está perto da decisão pesa mais.
- **Nada de changelog dentro da string.** Se a regra mudou, a explicação da
  mudança vai no comentário do código, fora do prompt. Citar a regra velha lá
  dentro, mesmo para negá-la, é mandar o modelo lê-la.

## O que quebra quando você edita o prompt

Vários testes travam o **texto** do prompt de propósito — para uma remoção
intencional não voltar por descuido num merge. Se você mudar uma frase que um
teste cita, ele falha, e **isso é o desenho funcionando**, não um acidente.

Quando isso acontecer: abra o teste, entenda que decisão ele protege, e então
ou ajuste o teste junto com a mudança (dizendo no comentário por que a regra
mudou), ou desista da mudança. O que não se faz é apagar o teste.

Os principais: `testes/agentes-tools.test.ts` (mapa de ferramentas e frases do
prompt), `testes/saida-de-area.test.ts` (o encaminhamento entre áreas),
`testes/pedido-de-visita.test.ts` (a entrega ao corretor).

## O ciclo de trabalho

1. `git pull` — sempre antes de começar. O Pablo empurra para cá o que mudou no
   sistema, e trabalhar sobre uma cópia velha é como o trabalho se perde.
2. Edite. Um assunto por vez, e escreva o porquê no comentário.
3. `git commit` e `git push`.
4. **Avise o Pablo.** Ele traz para o sistema, roda a suíte inteira, sobe pelos
   dez portões e mede o resultado numa conversa real de produção.

Você **não** deploya, não roda migration e não tem acesso à VPS. Não existe
caminho daqui direto para o cliente — e é assim de propósito.

## Uma última coisa, e é a mais importante

Do outro lado dessa conversa tem uma pessoa decidindo onde vai morar. As regras
sobre não usar emoji, não mandar dez fotos de uma vez, não prometer o que não se
vai fazer e não dizer "vou confirmar com a equipe" não são preciosismo de
estilo: cada uma delas está escrita porque alguém real, num dia real, foi
embora.

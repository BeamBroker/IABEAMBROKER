# Como mexer, e como a mudança chega ao cliente

## O ciclo

```
  git pull          →   editar aqui   →   commit + push   →   avisar o Pablo
  (sempre primeiro)     (texto e regra)                          │
                                                                 ▼
                                          ele aplica no sistema, roda 4.000+ testes,
                                          sobe pelos dez portões e mede em produção
```

Não existe caminho daqui direto para o cliente. É por desenho: do outro lado tem
gente decidindo onde vai morar, e uma frase mal colocada num prompt atinge todas
as imobiliárias ao mesmo tempo.

## 1. Sempre `git pull` antes de começar

O comportamento também muda pelo lado do sistema — o Marco mexe em módulo
comercial e CRM, e correções de IA entram por lá. Editar sobre uma cópia velha é
como o trabalho se perde: você conserta o que já estava consertado, ou desfaz o
que alguém acabou de arrumar.

## 2. Edite um assunto por vez

E escreva **o porquê** no comentário, ao lado da regra. Este código usa
comentário como documentação primária. Quando a regra tem um caso real por trás,
o caso vale mais que a explicação abstrata:

```ts
// Foto SÓ com o sim. Disparar seis imagens em cima de quem só disse que gostou
// trava o celular de notificação — já aconteceu, e o cliente respondeu "chega de
// mandar foto".
```

## 3. Espere testes quebrarem — e leia o que eles protegem

Vários testes travam o **texto** do prompt de propósito, para uma decisão não
voltar por descuido num merge. Se você mudar uma frase citada por um teste, ele
falha. Isso é o desenho funcionando.

O que fazer: abrir o teste, entender que decisão ele protege e então **ajustar o
teste junto com a mudança**, dizendo no comentário por que a regra mudou. O que
não se faz é apagar o teste.

Você não consegue rodar os testes aqui (não há banco nem `package.json`), mas
consegue **lê-los** — e neste repositório eles são metade da documentação: quase
todo teste começa com o diálogo real que o produziu.

## 4. Commit e push

Mensagem em inglês, no padrão do projeto (`fix:`, `feat:`, `chore:`), dizendo o
que muda no comportamento e por quê. Nunca mencione ferramenta de IA na mensagem.

## 5. Avise o Pablo

Ele roda, na máquina dele:

```sh
./scripts/aplicar-no-sistema.sh    # traz daqui para o sistema, mostrando o diff
cd ~/beam2/administrativo
npx vitest run                     # a suíte inteira
npx tsc --noEmit
./scripts/deploy-dev.sh --conferir # dez portões, sem subir nada
./scripts/deploy-dev.sh            # sobe
```

E, depois de subir, **conversa com ela em produção**. Suíte verde prova que o
resto não quebrou; não prova que a IA ficou boa.

## Quando o sistema mudar e este repo ficar para trás

```sh
./scripts/puxar-do-sistema.sh
```

Ele recusa rodar se houver trabalho não commitado aqui — copiar por cima apagaria
o que você escreveu.

## Como saber se uma mudança funcionou

Não é pelo teste. É pelo banco de produção, e sempre com dado, nunca com
impressão:

- **`UsoIA`** — provou que a IA rodou de verdade (área, modelo, o segundo exato).
  É como se descarta "faltou crédito" antes de caçar bug de prompt.
- **`Mensagem` + `Conversa.agente`** — o diálogo como o cliente viu, e em que
  área ele estava.
- **`LogAuditoria`** — `LEAD_PEDIU_VISITA`, `AVISO_LEAD_CORRETOR`,
  `LEAD_DISTRIBUIDO`, `IA_CONTINGENCIA`.

Três investigações desta semana só chegaram à causa porque esses três foram
consultados **antes** de qualquer hipótese. Duas delas começaram com um palpite
errado que o dado derrubou em um minuto.

## O que nunca fazer

- **Deploy.** Não há caminho daqui, e a chave da VPS não sai da máquina do dono.
- **Mexer em schema, migration ou `.env`.** Não estão neste repositório, e não é
  por acaso.
- **Escrever segredo** em código, comentário, prompt ou mensagem de erro.
- **Copiar arquivo do sistema para cá na mão.** Use `puxar-do-sistema.sh`: cópia
  manual esquece um arquivo e ninguém percebe até a IA responder errado.

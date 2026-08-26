#!/usr/bin/env bash
# Leva o que mudou AQUI para o sistema `administrativo`, onde dá para testar.
#
# Roda na máquina de quem tem os dois repositórios (hoje, a do Pablo). O
# caminho inverso é `puxar-do-sistema.sh`.
#
# Ele NÃO commita, NÃO testa e NÃO deploya: só copia, depois de mostrar o que
# vai mudar e perguntar. O que acontece depois é sempre o mesmo:
#
#   cd <sistema> && npx vitest run && npx tsc --noEmit && ./scripts/deploy-dev.sh
#
# Por que copiar em vez de submódulo ou pacote: o sistema precisa desses
# arquivos compilando junto com o resto (eles importam `@/lib/db`,
# `@prisma/client` e dezenas de vizinhos). Um pacote publicado inverteria a
# dependência e faria o comportamento da IA virar release — que é exatamente o
# atrito que este repositório existe para tirar do caminho.
set -euo pipefail

SISTEMA=${SISTEMA:-$HOME/beam2/administrativo}
AQUI=$(cd "$(dirname "$0")/.." && pwd)

vermelho() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
titulo()   { printf '\n\033[1m── %s\033[0m\n' "$*"; }

[ -d "$SISTEMA/lib" ] || {
  vermelho "✕ não achei o sistema em $SISTEMA"
  echo "   Passe o caminho: SISTEMA=/caminho/do/administrativo $0" >&2
  exit 1
}

titulo "O que muda no sistema"
mudou=0
for f in "$AQUI"/lib/*.ts; do
  nome=$(basename "$f")
  destino="$SISTEMA/lib/$nome"
  if [ ! -f "$destino" ]; then
    echo "  NOVO      lib/$nome"
    mudou=1
  elif ! cmp -s "$f" "$destino"; then
    echo "  ALTERADO  lib/$nome  ($(diff "$destino" "$f" | grep -c '^>') linha(s) nova(s))"
    mudou=1
  fi
done
for f in "$AQUI"/testes/*.ts; do
  nome=$(basename "$f")
  destino="$SISTEMA/lib/$nome"
  if [ ! -f "$destino" ] || ! cmp -s "$f" "$destino"; then
    echo "  TESTE     lib/$nome"
    mudou=1
  fi
done

[ "$mudou" = 0 ] && { verde "✓ nada mudou — o sistema já está com este comportamento"; exit 0; }

# A árvore do sistema precisa estar limpa: o deploy manda a PASTA, então
# mudança de outra pessoa pendurada aqui iria junto sem ninguém perceber.
if [ -n "$(cd "$SISTEMA" && git status --porcelain)" ]; then
  titulo "ATENÇÃO: a árvore do sistema NÃO está limpa"
  (cd "$SISTEMA" && git status --short)
  echo
  echo "  Pode ser trabalho de outra pessoa. O deploy manda a pasta inteira:"
  echo "  o que estiver aqui sobe junto. Confira antes de seguir."
fi

printf '\nAplicar em %s? digite SIM: ' "$SISTEMA"
read -r RESP
[ "$RESP" = "SIM" ] || { echo "cancelado."; exit 0; }

cp "$AQUI"/lib/*.ts "$SISTEMA/lib/"
cp "$AQUI"/testes/*.ts "$SISTEMA/lib/"

verde "✓ aplicado"
cat <<FIM

Agora, no sistema, na ordem — e nenhum passo é opcional:

  cd $SISTEMA
  npx vitest run          # a suíte inteira (4.000+); prompt tem teste que trava texto
  npx tsc --noEmit        # tipos
  ./scripts/deploy-dev.sh --conferir   # os dez portões, sem subir nada

E, depois de subir, converse com ela em produção. Suíte verde prova que o resto
não quebrou; NÃO prova que a IA ficou boa — isso só se sabe conversando.
FIM

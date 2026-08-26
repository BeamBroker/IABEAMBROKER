#!/usr/bin/env bash
# Traz para cá o que mudou no sistema `administrativo`.
#
# Roda na máquina de quem tem os dois repositórios (hoje, a do Pablo). O caminho
# inverso é `aplicar-no-sistema.sh`.
#
# Use SEMPRE que alguém mexer no comportamento pelo lado do sistema — o Marco
# mexe em módulo comercial e CRM, e uma correção de IA feita lá some daqui em
# silêncio. Repositório espelho que não é atualizado vira retrato de um sistema
# que não existe mais, e aí quem edita está editando o passado.
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

titulo "O que muda aqui"
mudou=0
for f in "$AQUI"/lib/*.ts "$AQUI"/testes/*.ts; do
  nome=$(basename "$f")
  origem="$SISTEMA/lib/$nome"
  if [ ! -f "$origem" ]; then
    echo "  SUMIU DO SISTEMA  $nome  (renomeado ou removido lá — resolva à mão)"
  elif ! cmp -s "$origem" "$f"; then
    echo "  ATUALIZA  $nome"
    mudou=1
  fi
done

[ "$mudou" = 0 ] && { verde "✓ já está igual ao sistema"; exit 0; }

# Trabalho não commitado aqui seria sobrescrito sem aviso.
if [ -n "$(cd "$AQUI" && git status --porcelain)" ]; then
  vermelho "✕ há mudanças não commitadas NESTE repositório"
  (cd "$AQUI" && git status --short)
  echo
  echo "  Copiar por cima apagaria esse trabalho. Commite (ou guarde) antes." >&2
  exit 1
fi

printf '\nTrazer do sistema? digite SIM: '
read -r RESP
[ "$RESP" = "SIM" ] || { echo "cancelado."; exit 0; }

for f in "$AQUI"/lib/*.ts; do
  nome=$(basename "$f")
  [ -f "$SISTEMA/lib/$nome" ] && cp "$SISTEMA/lib/$nome" "$f"
done
for f in "$AQUI"/testes/*.ts; do
  nome=$(basename "$f")
  [ -f "$SISTEMA/lib/$nome" ] && cp "$SISTEMA/lib/$nome" "$f"
done

verde "✓ atualizado — confira com 'git diff' e commite"

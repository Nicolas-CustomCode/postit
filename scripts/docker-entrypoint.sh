#!/bin/sh
# Ponto de entrada da imagem (docs/10, tabela de comandos).
#
#   web     Next em produção, na porta WEB_PORT (3010 se não definida)
#   api     prisma migrate deploy e, em seguida, o processo HTTP da API
#   worker  o processo worker
#   outro   executado como está — por exemplo, npm run admin:create
#
# `exec` troca o shell pelo processo: é ele que recebe o sinal de parada do
# Docker e tem a chance de terminar o que está fazendo.
set -e

case "$1" in
  web)
    cd /app/apps/web
    exec node scripts/next.cjs start
    ;;
  api)
    # Só a API aplica migrations, e ela é a primeira a subir no deploy. O dump
    # manual vem antes (docs/adr/0021).
    npm run deploy -w @repo/database
    cd /app/apps/api
    exec node dist/main.js
    ;;
  worker)
    cd /app/apps/api
    exec node dist/worker.js
    ;;
  *)
    exec "$@"
    ;;
esac

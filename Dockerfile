# Uma imagem para os três processos da etapa 1 (docs/10, "Etapa 1 — Easypanel").
#
# O comando escolhe o processo — web, api ou worker — e qualquer outro é
# executado como está, que é por onde rodam os comandos admin:* no terminal do
# serviço. Quem despacha é scripts/docker-entrypoint.sh.
#
#   docker build -t postit .
#   docker run --env-file .env postit api
#
# Nenhum segredo entra na construção: as variáveis chegam só na hora de rodar,
# pela aba Environment de cada serviço do Easypanel.

# ---------- Construção ----------
FROM node:22.19-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TURBO_TELEMETRY_DISABLED=1

# Só os package.json primeiro: enquanto as dependências não mudam, o Docker
# reaproveita esta camada e não reinstala tudo a cada mudança de código.
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY scripts/install-hooks.mjs scripts/
RUN npm ci

COPY . .
RUN npx turbo run build \
 && rm -rf apps/web/.next/cache \
 && npm prune --omit=dev

# ---------- Execução ----------
FROM node:22.19-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1

COPY --from=build --chown=node:node /app /app

# Sem root: um processo invadido não ganha a máquina de brinde.
USER node

ENTRYPOINT ["sh", "scripts/docker-entrypoint.sh"]
CMD ["web"]

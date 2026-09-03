# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma.config.ts resolves DIRECT_URL eagerly via Prisma's env() helper,
# which throws PrismaConfigEnvError if the variable is unset. .env is
# excluded by .dockerignore (real secrets don't belong in the image), so
# `prisma generate` needs a placeholder here purely to satisfy that check —
# it never connects to a database; migrations run as a separate deploy step.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DIRECT_URL="postgresql://build:build@localhost:5432/build"
RUN pnpm prisma generate && pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Docker sets $HOSTNAME to the container id by default, and the standalone
# server.js falls back to `process.env.HOSTNAME || "0.0.0.0"` — so without
# this override it binds only to the container's internal IP instead of all
# interfaces, and `docker run -p` can't reach it (connection reset).
ENV HOSTNAME=0.0.0.0
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/prisma ./prisma
USER app
EXPOSE 3000
CMD ["node", "server.js"]

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
# Obviously-fake placeholders, scoped to this one RUN rather than declared as
# ENV: they then exist for the build command and nowhere else — not in this
# stage's image config, not inherited by the worker stage below, and not in the
# runtime stage (which declares only NODE_ENV and HOSTNAME). Nothing reads them
# through NEXT_PUBLIC_, so nothing is inlined into the bundle either, and
# `docker build` does not warn about a secret in an ENV instruction.
#
# Two things need them, neither of which connects to a database or signs
# anything:
#   * prisma.config.ts resolves DIRECT_URL eagerly via Prisma's env() helper
#     and throws PrismaConfigEnvError if it is unset;
#   * `next build` imports every route module while collecting page data, so
#     src/lib/auth/better-auth.ts runs, and src/lib/env.ts requires
#     APP_BASE_URL and BETTER_AUTH_SECRET rather than silently defaulting.
# .env is excluded by .dockerignore: real secrets do not belong in an image,
# and migrations and the worker run as separate deploy steps with real values.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" \
    DIRECT_URL="postgresql://build:build@localhost:5432/build" \
    APP_BASE_URL="http://build.invalid" \
    BETTER_AUTH_SECRET="build-only-never-signs-anything" \
    sh -c "pnpm prisma generate && pnpm build"

# The scheduled-transition worker, `prisma migrate deploy` and `db:seed` all
# need what the runtime stage deliberately does not carry: node_modules, the
# Prisma CLI, tsx and src/. They run from this target instead of the slim
# runtime image — `docker build --target worker` — which is why it exists as a
# named stage rather than as a comment in the deploy docs. It carries no
# connection string of any kind, so a deployment that forgets to supply one
# fails immediately with src/lib/env.ts's "Missing required environment
# variable" rather than quietly addressing a database that does not exist.
FROM build AS worker
ENV NODE_ENV=production
CMD ["pnpm", "worker"]

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

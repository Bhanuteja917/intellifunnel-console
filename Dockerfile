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
# Obviously-fake build-stage placeholders, never present in the runtime stage
# (which declares only NODE_ENV and HOSTNAME) and never inlined into the
# bundle (nothing reads them through NEXT_PUBLIC_). Two things need them:
#   * prisma.config.ts resolves DIRECT_URL eagerly via Prisma's env() helper
#     and throws PrismaConfigEnvError if it is unset;
#   * `next build` imports every route module while collecting page data, so
#     src/lib/auth/better-auth.ts runs, and src/lib/env.ts requires
#     APP_BASE_URL and BETTER_AUTH_SECRET rather than silently defaulting.
# .env is excluded by .dockerignore — real secrets do not belong in an image —
# and none of these placeholders is ever connected to or signed with:
# migrations and the worker run as separate deploy steps with real values.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
ENV DIRECT_URL="postgresql://build:build@localhost:5432/build"
ENV APP_BASE_URL="http://build.invalid"
ENV BETTER_AUTH_SECRET="build-only-not-a-secret"
RUN pnpm prisma generate && pnpm build

# The scheduled-transition worker and `prisma migrate deploy` both need what
# the runtime stage deliberately does not carry: node_modules, the Prisma CLI,
# tsx and src/. They run from this target instead of the slim runtime image —
# `docker build --target worker` — which is why it exists as a named stage
# rather than as a comment in the deploy docs.
#
# The build stage's placeholder connection and auth variables are blanked out
# so a deployment that forgets to supply the real ones fails immediately with
# src/lib/env.ts's "Missing required environment variable" instead of quietly
# talking to a database that does not exist.
FROM build AS worker
ENV NODE_ENV=production
ENV DATABASE_URL=""
ENV DIRECT_URL=""
ENV APP_BASE_URL=""
ENV BETTER_AUTH_SECRET=""
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

# Deployment

## Environments (DEP-3)

| Environment | Database |
|---|---|
| local | `docker compose up postgres` |
| preview | a Neon branch per git branch |
| staging | Neon staging project |
| production | Neon production project |

## Images

The Dockerfile has two runnable targets, and they are not interchangeable.

| Target | Build | Contains | Runs |
|---|---|---|---|
| `runtime` (default) | `docker build -t console .` | `.next/standalone`, `.next/static`, `public`, `prisma` — no `node_modules`, no `src`, no CLIs | the web server (`node server.js`) |
| `worker` | `docker build --target worker -t console-worker .` | the full build tree: `node_modules`, `src`, `tsx`, the Prisma CLI | the scheduled-transition worker (`pnpm worker`), `prisma migrate deploy`, `db:seed` |

Anything that needs `node_modules`, `tsx`, `src/` or a CLI — the worker,
migrations, the seed — runs from the `worker` image. The `runtime` image is a
standalone bundle (DEP-1) and cannot run any of them.

## Release sequence (DEP-4)

1. Build both images from the same commit: `docker build -t console .` and `docker build --target worker -t console-worker .`.
2. Run `docker run --rm -e DIRECT_URL=... console-worker pnpm prisma migrate deploy` as a discrete step, before any new container accepts traffic.
3. Roll out the web containers (`console`). Migrations must be backwards-compatible with the previous application version, so the old and new versions run against the same schema during the roll.
4. Roll out the worker container (`console-worker`, whose default command is `pnpm worker`).
5. Run `docker run --rm -e DATABASE_URL=... console-worker pnpm db:seed` in any environment that has not been seeded. The seed is idempotent (DEP-6).

## Environment variables (DEP-5)

Required. `src/lib/env.ts` raises a named "Missing required environment
variable" error rather than substituting a fallback, so a missing value is a
startup failure (the first three, read as the application boots) or an
immediate operation failure (the salt, read by the first import that needs it).
An empty string counts as missing.

| Variable | Needed by |
|---|---|
| `DATABASE_URL` | the pooled application connection, and the worker |
| `BETTER_AUTH_SECRET` | session and token signing (web only) |
| `APP_BASE_URL` | absolute links in invitation and password-reset emails (web only) |
| `SUPPRESSION_HASH_SALT` | suppression value hashes; a substituted salt writes hashes that can never be matched again |

Optional:

| Variable | Default behaviour |
|---|---|
| `DIRECT_URL` | required by `prisma migrate`/`prisma db` only, which fail loudly without it |
| `EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM` | an absent or empty API key means emails are logged, not sent |
| `WORKER_INTERVAL_MS` | 60000 |

No environment-specific code paths exist; behaviour differences come from these values only.

## Health checks (NFR-O-3)

- Liveness: `GET /api/health`
- Readiness: `GET /api/health/ready`

# Deployment

## Environments (DEP-3)

| Environment | Database |
|---|---|
| local | `docker compose up postgres` |
| preview | a Neon branch per git branch |
| staging | Neon staging project |
| production | Neon production project |

## Release sequence (DEP-4)

1. Build the image.
2. Run `pnpm prisma migrate deploy` against `DIRECT_URL` as a discrete step, before any new container accepts traffic.
3. Roll out the web containers. Migrations must be backwards-compatible with the previous application version, so the old and new versions run against the same schema during the roll.
4. Roll out the worker container (`CMD ["node", "--import", "tsx", "src/worker/index.ts"]` or `pnpm worker`).
5. Run `pnpm db:seed` in any environment that has not been seeded. The seed is idempotent (DEP-6).

## Environment variables (DEP-5)

`DATABASE_URL`, `DIRECT_URL`, `APP_BASE_URL`, `BETTER_AUTH_SECRET`, `EMAIL_FROM`,
`EMAIL_PROVIDER_URL`, `EMAIL_PROVIDER_API_KEY`, `SUPPRESSION_HASH_SALT`, `WORKER_INTERVAL_MS`.

No environment-specific code paths exist; behaviour differences come from these values only.

## Health checks (NFR-O-3)

- Liveness: `GET /api/health`
- Readiness: `GET /api/health/ready`

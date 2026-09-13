# intellifunnel-console

## Prereqs

- Node >=24 (see `.nvmrc`)
- pnpm 11.25.0
- Docker (for local Postgres)

## Setup

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env   # fill in BETTER_AUTH_SECRET, SUPPRESSION_HASH_SALT, DB password
pnpm db:migrate
pnpm db:generate
pnpm db:seed
```

## Run

```bash
pnpm dev        # app at http://localhost:3000
pnpm worker     # background jobs (delivery, campaign lifecycle, etc.) — separate process
```

Demo account logins: see `DEMO_ACCOUNTS.md`.

## Test

```bash
pnpm test         # vitest, run once
pnpm test:watch
pnpm typecheck
pnpm lint
```

## Other scripts

- `pnpm build` / `pnpm start` — production build/run
- `pnpm db:migrate` — apply migrations (dev, interactive)
- `pnpm db:deploy` — apply migrations (prod, non-interactive)
- `pnpm db:seed` — seed demo data

# Phase 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build SRS Phase 1 — organisations, invitations, RBAC, identity resolution, campaign configuration, channel type admin and the approval workflow — on a deployable Next.js + Prisma + Neon foundation that already carries currency, audit and settings infrastructure.

**Architecture:** A single Next.js (App Router) application deployed as a standalone Node server in a container. All business logic lives in `src/lib/*` service modules that take an explicit `Actor` (the authenticated user plus organisation and roles) as their first argument; server components and server actions are thin callers. Authorisation is enforced inside those service modules, never in the UI (AUTH-8, NFR-S-1). Prisma owns the schema and migrations; a Testcontainers Postgres gives every integration test a real database, which is the only way the transactional and unique-constraint requirements can actually be verified.

**Tech Stack:** Node 24 (LTS), Next.js (App Router), TypeScript strict, Prisma, Neon (serverless Postgres), Better Auth, shadcn/ui + Tailwind for every UI surface, Zustand for client state, Vitest, `@testcontainers/postgresql`, Docker (multi-stage), pnpm. **No dependency version is pinned** — see the version policy below.

**Spec:** `srs.md` (Software Requirements Specification v0.2) and `prd.md` (Product Requirements Document v0.2), both at repository root. Requirement identifiers used throughout this plan (`AUTH-3`, `FR-CT-2`, `CUR-6`, …) refer to the SRS.

**Phase scope:** SRS §10 Phase 1 only — "Organisations, invitations, RBAC, identity resolution, campaign configuration, channel type admin, approval workflow", plus the currency infrastructure SRS §10 explicitly forbids deferring, plus the seed data DEP-6 requires. Assets, form capture, allocation, lead intake, verification, delivery, metrics and commercials are Phases 2–6 and get their own plans. Where a Phase 1 table exists only so a later phase can use it (`DoNotContact`, `Holiday`, `RejectReason`), this plan creates the table and the seed data and stops there.

---

## Global Constraints

Every task's requirements implicitly include this section.

- **Runtime:** Node 24 (current LTS). Package manager pnpm. TypeScript `strict: true` (SRS §2).
- **Dependency versions are never pinned in this plan.** Every install resolves the latest published version (`pnpm add <pkg>`, or `<pkg>@latest` where a tag is needed), and `pnpm-lock.yaml` is the record of what was resolved. Installing an older version requires a stated reason and the user's explicit approval — it is not a judgement call for the implementer.
- **UI is assembled from shadcn/ui, not written from scratch.** Invoke the `shadcn/ui` skill (installed in Task 1) before touching any UI code. Build screens from shadcn blocks first, then compose shadcn components; a bespoke component written from scratch requires the user's approval before it is written. Styling is Tailwind through shadcn's tokens.
- **Client state uses Zustand**, not React's own Context APIs. Server state stays in server components and server actions; Zustand holds only what the browser owns (open dialogs, table filters, selection, unsent drafts).
- **Application:** Next.js App Router, `output: "standalone"`. Server components for data-heavy views, server actions for mutations, route handlers for public and machine-facing endpoints (SRS §2). Deployed as a Node server in a container, not serverless-only (SRS §2.1).
- **Database:** Neon serverless Postgres. Prisma for ORM and migrations; migrations checked into version control (SRS §2). The application connects through the pooled connection string (`DATABASE_URL`); migrations run against the direct connection (`DIRECT_URL`) (SRS §2.1).
- **Auth:** Better Auth owns session handling, credential storage, password reset and email verification. Roles and organisation binding live in application tables joined to the Better Auth user record (AUTH-7).
- **No public registration.** All accounts originate from an invitation (AUTH-1).
- **Authorisation is server-side, in the data access layer, not the UI** (AUTH-8, NFR-S-1). Client-scoped queries are filtered by organisation at the query level (AUTH-9).
- **Money:** every monetary field stores an explicit currency alongside the amount; there is no implicit default (CUR-1). Amounts are stored as integer minor units with the currency's exponent, never as floating point (CUR-6).
- **Reporting currency:** `INR`. **Operating timezone:** `Asia/Kolkata`. Both are `PlatformSetting` rows, read through the settings service, never hard-coded at call sites.
- **Platform setting launch values** (SRS §4.9): `reportingCurrency=INR`, `defaultVerificationSlaBusinessDays=3`, `operatingTimezone=Asia/Kolkata`, `workingDays=MO,TU,WE,TH,FR`, `workingHours=09:00–18:00`, `personalDataRetentionMonths=12`, `invitationExpiryDays=7`.
- **Every table** carries `id`, `createdAt`, `updatedAt`, and where mutable by users, `createdById` and `updatedById` (SRS §4).
- **Audit:** every mutation to campaign configuration, allocation, lead status, counters, pricing and user roles writes an audit entry with actor, timestamp and before/after state (NFR-A-1). Audit entries are append-only and not editable through any application path (NFR-A-2).
- **Normalisation:** domain normalisation is lowercase, strip protocol, strip `www.`, strip trailing dot, take registrable domain. Applied at write time and stored, never computed at query time (SRS §4.2).
- **Soft deletion** for entities referenced by leads or financial records; hard deletion is reserved for erasure requests (NFR-D-3).
- **Unique constraints** required in Phase 1: normalised contact email, normalised account domain, campaign code (NFR-D-2).
- **Migrations must be backwards-compatible with the previous application version** to allow rolling deploys (DEP-4).
- **Configuration is entirely environment-variable driven. No environment-specific code paths** (DEP-5).
- **Commit style:** Conventional Commits. Commit at the end of every task's final step, never mid-task.

---

## File Structure

Created across the plan. Each module has one responsibility; files that change together live together.

```
prisma/
  schema.prisma                     single schema, sectioned by domain
  migrations/                       checked in
  seed/index.ts                     seed runner (DEP-6)
  seed/roles.ts                     role definitions
  seed/settings.ts                  PlatformSetting launch values
  seed/funnel-stages.ts             PROGRAMMATIC | TOFU | MOFU | BOFU
  seed/channel-types.ts             base channel types + published v1
  seed/reject-reasons.ts            controlled reject vocabulary
src/
  lib/db.ts                         PrismaClient singleton
  lib/errors.ts                     typed application errors
  lib/normalise/domain.ts           normalizeDomain
  lib/normalise/email.ts            normalizeEmail
  lib/normalise/name.ts             normalizeCompanyName
  lib/money/currency.ts             Money type, minor-unit conversion
  lib/money/exchange-rate.ts        rate lookup + conversion (CUR-3..CUR-7)
  lib/settings/settings.ts          typed PlatformSetting reader/writer
  lib/auth/better-auth.ts           Better Auth server instance
  lib/auth/actor.ts                 Actor resolution from session
  lib/auth/permissions.ts           role → permission matrix, assertPermission
  lib/audit/audit.ts                withAudit wrapper
  lib/invitations/invitations.ts    invitation lifecycle (AUTH-3..AUTH-6)
  lib/identity/account-resolution.ts  resolveAccount (FR-ID-1, FR-ID-2)
  lib/identity/contact.ts           upsertContact (FR-ID-3)
  lib/identity/merge.ts             mergeAccounts (FR-ID-4)
  lib/channel-types/crud.ts         channel type CRUD + deactivate (FR-CT-1, FR-CT-4)
  lib/channel-types/versions.ts     publishChannelTypeVersion (FR-CT-2)
  lib/campaigns/crud.ts             campaign + ICP + field spec + channels
  lib/campaigns/state-machine.ts    transitions (SRS §5.1)
  lib/campaigns/snapshot.ts         config snapshot + version freeze (FR-CS-1)
  lib/campaigns/clone.ts            cloneCampaign (E3)
  lib/lists/csv.ts                  row parsing + column mapping
  lib/lists/target-accounts.ts      TAL import + matching + cap overrides
  lib/lists/suppression.ts          suppression list import
  components/ui/                    shadcn primitives, added by the shadcn CLI
  components/                       screen-level compositions of shadcn parts
  lib/stores/                       Zustand client stores (one per screen concern)
  app/api/health/route.ts           liveness/readiness (NFR-O-3)
  app/invite/[token]/page.tsx       invitation acceptance (SRS §7.1)
  app/(admin)/...                   admin console routes
tests/
  helpers/db.ts                     Testcontainers lifecycle + truncation
  helpers/factories.ts              test data builders
  *.test.ts                         colocated by domain under tests/
Dockerfile                          multi-stage, standalone runtime (DEP-1)
docker-compose.yml                  local Postgres + app
```

---

### Task 1: Tooling, skills and MCP configuration — **BREAKPOINT**

> **This task is the plan's first review breakpoint.** Nothing else starts until the skills and MCP servers below are installed and verified, because Task 23 writes no UI without the `shadcn/ui` skill loaded, and Task 3 needs the Neon project's real connection strings and Postgres major version.

**Files:**
- Create: `.mcp.json`, `docs/tooling.md`
- Create: `.claude/skills/` entries (written by the `skills` CLI, not by hand)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - The `shadcn/ui` skill, invocable before any UI work.
  - A configured shadcn MCP server for component and block discovery.
  - A verified Neon MCP connection, plus the recorded Neon project id, Postgres major version, pooled `DATABASE_URL` and direct `DIRECT_URL`.
  - `docs/tooling.md` recording the resolved versions of everything installed, since this plan pins nothing.

- [ ] **Step 1: Confirm the toolchain versions**

Node 24 is the current LTS line and is what every later task assumes.

```bash
node --version   # must be v24.x
corepack enable
pnpm --version
```

If Node is not on 24.x, install it (`nvm install 24 && nvm use 24`) and create `.nvmrc`:

```bash
echo "24" > .nvmrc
```

- [ ] **Step 2: Add the shadcn/ui skill**

```bash
npx skills add shadcn/ui
```

Expected: the command reports the skill installed. Verify it is discoverable:

```bash
ls .claude/skills
```

Expected: a `shadcn/ui` (or `shadcn-ui`) entry is listed.

- [ ] **Step 3: Configure the shadcn MCP server**

```bash
pnpm dlx shadcn@latest mcp init --client claude
```

This writes an `.mcp.json` in the project root registering the shadcn MCP server. Verify:

```bash
cat .mcp.json
```

Expected: a `mcpServers` entry for shadcn. Restart the Claude Code session so the server is picked up, then confirm the shadcn MCP tools resolve — a registry search for `button` should return the component.

- [ ] **Step 4: Verify the Neon MCP connection and record the project facts**

Through the Neon MCP server, not the web console:

1. List organisations and projects; create the project if it does not exist.
2. Read the project's Postgres major version.
3. Fetch the pooled connection string (`DATABASE_URL`) and the direct one (`DIRECT_URL`).
4. Confirm branching works by creating and then deleting a throwaway branch — this is what Task 3's preview environments and DEP-3 depend on.

Do not paste the connection strings into any committed file. They go into a local `.env` only, with placeholders in `.env.example`.

- [ ] **Step 5: Record the tooling state**

```markdown
<!-- docs/tooling.md -->
# Tooling

| Tool | Version | How it was resolved |
|---|---|---|
| Node | 24.x (LTS) | `.nvmrc`, `engines` in package.json |
| pnpm | (record `pnpm --version`) | corepack |
| Postgres | (record the Neon project's major version) | Neon MCP |

## Skills

- `shadcn/ui` — installed via `npx skills add shadcn/ui`. **Invoke it before writing or editing any UI code** (Task 23).

## MCP servers

- **shadcn** — component and block discovery. Registered in `.mcp.json` via `pnpm dlx shadcn@latest mcp init --client claude`.
- **Neon** — database project, branch and connection-string management.

## Version policy

No dependency version is pinned in this plan. Every install uses the latest published version
(`pnpm add <pkg>` / `pnpm add <pkg>@latest`), and the lockfile is the record of what was resolved.
Pinning an older version requires an explicit reason and the user's approval.
```

- [ ] **Step 6: Verify and commit**

```bash
node --version && pnpm --version
ls .claude/skills && cat .mcp.json
```

Expected: Node 24.x, the skill listed, the shadcn MCP registered, and the Neon facts recorded in `docs/tooling.md`.

```bash
git init
git add .nvmrc .mcp.json docs/tooling.md
git commit -m "chore: configure node 24, shadcn/ui skill and shadcn + neon mcp servers"
```

**Stop here for review before starting Task 2.**

---

### Task 2: Repository bootstrap

The repository holds only `prd.md`, `srs.md` and Task 1's tooling files. This task produces a committed, type-checked, test-running Next.js application on Node 24.

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `vitest.config.ts`, `.gitignore`, `.env.example`, `eslint.config.mjs`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`
- Test: `tests/bootstrap.test.ts`

**Interfaces:**
- Consumes: Task 1's Node 24 toolchain, pnpm and the version policy in `docs/tooling.md`.
- Produces: `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build` scripts that every later task relies on. Path alias `@/*` → `src/*`.

- [ ] **Step 1: Add the ignore file**

The repository was initialised in Task 1.

```bash
cat > .gitignore <<'EOF'
node_modules/
.next/
.env
.env.local
coverage/
*.tsbuildinfo
EOF
```

- [ ] **Step 2: Create `package.json` and install the latest dependencies**

Write the manifest with scripts and engines only — no dependency versions. The installs in the next command resolve the latest published version of each package and write the real versions into `package.json` and `pnpm-lock.yaml`.

```json
{
  "name": "intellifunnel-console",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "packageManager": "pnpm@latest",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "node .next/standalone/server.js",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

```bash
pnpm add next react react-dom
pnpm add -D typescript @types/node @types/react @types/react-dom eslint eslint-config-next vitest
```

Record the resolved versions in the table in `docs/tooling.md` created in Task 1.

- [ ] **Step 3: Create `tsconfig.json` with strict mode**

`strict: true` is a spec requirement (SRS §2), not a preference.

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["dom", "dom.iterable", "ES2023"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Create `next.config.ts` and `vitest.config.ts`**

`output: "standalone"` is what DEP-1's slim runtime image copies.

```typescript
// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  typedRoutes: true,
};

export default nextConfig;
```

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
```

- [ ] **Step 5: Write the failing test**

```typescript
// tests/bootstrap.test.ts
import { describe, expect, it } from "vitest";
import { appName } from "@/lib/app-info";

describe("bootstrap", () => {
  it("exposes the application name through the @ alias", () => {
    expect(appName).toBe("intellifunnel-console");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test`
Expected: FAIL — `Failed to resolve import "@/lib/app-info"`.

- [ ] **Step 7: Write the minimal implementation**

```typescript
// src/lib/app-info.ts
export const appName = "intellifunnel-console";
```

Also create the minimal App Router shell so `pnpm build` succeeds:

```tsx
// src/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

```tsx
// src/app/page.tsx
export default function Page() {
  return <main>Console</main>;
}
```

- [ ] **Step 8: Run the full check**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: test PASS, typecheck clean, build emits `.next/standalone`.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: bootstrap next.js app with strict typescript and vitest"
```

---

### Task 3: Prisma, Neon connection and the Testcontainers test harness

Every later task's tests need a real Postgres. This task builds that harness once.

**Prisma major version note (superseded 2026-09-02 by the user, mid-Task-3):** the original plan text below was written against Prisma 6's schema-level `datasource { url / directUrl }` config. Prisma 7 is now stable (latest, not the `prisma`-package RC that a first `pnpm add prisma` may resolve — confirm you land on the stable tag, not a `-rc.` prerelease) and removed `url`/`directUrl` from `schema.prisma` entirely in favour of a `prisma.config.ts` file plus driver adapters (`@prisma/adapter-pg` for Postgres). The user's explicit instruction: use Prisma 7 latest stable, not a 6.x pin. Steps 1–5 below are rewritten for that model; Steps 6–10 are unchanged in intent. This API is new enough that exact syntax may have shifted again since this note was written — verify against the installed package's own types/README and the current `pnpm add prisma` stable tag rather than trusting this note as gospel; document any deviation in the report the same way Task 2's implementer documented its version-pin deviations.

**Files:**
- Create: `prisma/schema.prisma`, `prisma.config.ts`, `src/lib/db.ts`, `tests/helpers/db.ts`, `vitest.globalSetup.ts`, `docker-compose.yml`
- Modify: `package.json` (prisma scripts, dependencies), `vitest.config.ts` (globalSetup), `.env.example`
- Test: `tests/db-harness.test.ts`

**Interfaces:**
- Consumes: Task 2's scripts and alias.
- Produces:
  - `src/lib/db.ts` → `export const db: PrismaClient` (singleton).
  - `tests/helpers/db.ts` → `export function testDb(): PrismaClient`, `export async function resetDb(): Promise<void>`.
  - Env vars `DATABASE_URL` (pooled, used by the app's driver adapter) and `DIRECT_URL` (unpooled, used by `prisma.config.ts` for migration CLI commands).

- [ ] **Step 1: Install Prisma 7 (stable, not RC), the pg driver adapter, and Testcontainers**

```bash
pnpm add @prisma/client @prisma/adapter-pg pg
pnpm add -D prisma @testcontainers/postgresql @types/pg dotenv
```

Confirm `prisma`/`@prisma/client` resolved to the same stable major (7.x) — not a `-rc.` prerelease on one and stable on the other, which is a broken pairing. If `pnpm add prisma` resolves a prerelease, pin explicitly to the latest stable 7.x tag instead (that is a version-policy-compliant choice, not the kind of pin needing approval, since it's "latest stable" not "latest").

Add scripts to `package.json`:

```json
{
  "scripts": {
    "db:generate": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:deploy": "prisma migrate deploy",
    "db:seed": "tsx prisma/seed/index.ts"
  }
}
```

Install `tsx` as a dev dependency: `pnpm add -D tsx`.

- [ ] **Step 2: Create the Prisma schema skeleton and `prisma.config.ts`**

Prisma 7 moves connection config for CLI commands (`migrate dev`, `migrate deploy`) out of `schema.prisma` and into `prisma.config.ts`. Point it at `DIRECT_URL` — the unpooled connection SRS §2.1 requires for migrations.

```prisma
// prisma/schema.prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
}

model PlatformSetting {
  id          String   @id @default(cuid())
  key         String   @unique
  valueJson   Json
  updatedById String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}
```

```typescript
// prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DIRECT_URL"),
  },
});
```

Verify where `prisma generate` actually places the generated client (Prisma 7 may default to a custom output path rather than `node_modules/@prisma/client`) and adjust every `import { PrismaClient } from "..."` below to match reality, not this note's guess.

- [ ] **Step 3: Create the Prisma client singleton using the pg driver adapter**

The app's runtime connection uses the pooled `DATABASE_URL` via `@prisma/adapter-pg`, independent of the CLI's `DIRECT_URL` in `prisma.config.ts`.

```typescript
// src/lib/db.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

export const db: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
```

- [ ] **Step 4: Create the Testcontainers global setup**

One container per test run, migrated once. Individual tests truncate rather than re-migrate — re-migrating per file makes the suite unusably slow.

```typescript
// vitest.globalSetup.ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { execSync } from "node:child_process";

let container: StartedPostgreSqlContainer;

export async function setup() {
  // Must match the Neon project's Postgres major version, recorded in
  // docs/tooling.md during Task 1. A mismatch hides version-specific failures.
  container = await new PostgreSqlContainer(
    `postgres:${process.env.POSTGRES_MAJOR ?? "17"}-alpine`,
  ).start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.DIRECT_URL = url;
  execSync("pnpm prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
}

export async function teardown() {
  await container?.stop();
}
```

Wire it in `vitest.config.ts` by adding to the `test` block:

```typescript
    globalSetup: ["./vitest.globalSetup.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
```

`singleFork` matters: parallel workers sharing one database would see each other's truncations.

- [ ] **Step 5: Create the test database helper**

Construct the adapter lazily, inside `testDb()`, not at module load time — `DATABASE_URL` isn't set until `vitest.globalSetup.ts`'s `setup()` has run.

```typescript
// tests/helpers/db.ts
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

let client: PrismaClient | undefined;

export function testDb(): PrismaClient {
  client ??= new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  return client;
}

export async function resetDb(): Promise<void> {
  const prisma = testDb();
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"public"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
```

- [ ] **Step 6: Write the failing test**

```typescript
// tests/db-harness.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";

describe("test database harness", () => {
  beforeEach(resetDb);

  it("applies migrations and round-trips a row", async () => {
    const db = testDb();
    await db.platformSetting.create({
      data: { key: "reportingCurrency", valueJson: "INR" },
    });
    const found = await db.platformSetting.findUnique({
      where: { key: "reportingCurrency" },
    });
    expect(found?.valueJson).toBe("INR");
  });

  it("truncates between tests", async () => {
    expect(await testDb().platformSetting.count()).toBe(0);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm test tests/db-harness.test.ts`
Expected: FAIL — no migrations exist yet, `migrate deploy` finds nothing and the `PlatformSetting` table is missing.

- [ ] **Step 8: Create the initial migration**

Start a local Postgres for migration authoring:

Use the same Postgres major version recorded in `docs/tooling.md`.

```bash
cat > docker-compose.yml <<'EOF'
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: console
    ports: ["5432:5432"]
EOF
docker compose up -d postgres
```

```bash
cat > .env <<'EOF'
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/console"
DIRECT_URL="postgresql://postgres:postgres@localhost:5432/console"
EOF
pnpm prisma migrate dev --name init_platform_settings
```

Copy `.env` to `.env.example` with placeholder values and commit `.env.example` only.

- [ ] **Step 9: Run the tests to verify they pass**

Run: `pnpm test tests/db-harness.test.ts`
Expected: PASS — both tests.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add prisma schema, neon connection config and testcontainers harness"
```

---

### Task 4: Normalisation utilities

Every downstream rule — suppression, TAL matching, dedupe, account resolution — depends on these three functions producing the same string every time. SRS §11 names identity resolution quality as the top risk, so this is built first and tested hard.

**Files:**
- Create: `src/lib/normalise/domain.ts`, `src/lib/normalise/email.ts`, `src/lib/normalise/name.ts`
- Test: `tests/normalise.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `normalizeDomain(input: string): string | null` — null when no registrable domain can be extracted.
  - `normalizeEmail(input: string): string` — throws `ValidationError` on a syntactically invalid address.
  - `emailDomain(input: string): string | null` — normalised domain part of an email.
  - `normalizeCompanyName(input: string): string`.

- [ ] **Step 1: Install the public-suffix helper**

Registrable-domain extraction ("take registrable domain", SRS §4.2) needs the public suffix list; hand-rolling it produces wrong answers for `.co.uk`, `.com.au` and similar.

```bash
pnpm add tldts
```

- [ ] **Step 2: Write the failing test**

```typescript
// tests/normalise.test.ts
import { describe, expect, it } from "vitest";
import { normalizeDomain } from "@/lib/normalise/domain";
import { emailDomain, normalizeEmail } from "@/lib/normalise/email";
import { normalizeCompanyName } from "@/lib/normalise/name";
import { ValidationError } from "@/lib/errors";

describe("normalizeDomain", () => {
  it.each([
    ["https://www.Acme.com/pricing?x=1", "acme.com"],
    ["WWW.ACME.COM.", "acme.com"],
    ["acme.co.uk", "acme.co.uk"],
    ["mail.eu.acme.co.uk", "acme.co.uk"],
    ["http://acme.com", "acme.com"],
    ["  acme.com  ", "acme.com"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it.each(["", "not a domain", "localhost", "10.0.0.1"])(
    "returns null for %s",
    (input) => {
      expect(normalizeDomain(input)).toBeNull();
    },
  );
});

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Jane.Doe@Acme.COM ")).toBe("jane.doe@acme.com");
  });

  it("does not strip gmail dots or plus tags", () => {
    // Two addresses that differ only by a plus tag are two different people
    // as far as a client's CRM is concerned. Collapsing them loses leads.
    expect(normalizeEmail("jane+news@acme.com")).toBe("jane+news@acme.com");
  });

  it("rejects a syntactically invalid address", () => {
    expect(() => normalizeEmail("jane(at)acme.com")).toThrow(ValidationError);
  });

  it("extracts the registrable domain", () => {
    expect(emailDomain("Jane@mail.Acme.co.uk")).toBe("acme.co.uk");
  });
});

describe("normalizeCompanyName", () => {
  it.each([
    ["  Acme  Corporation, Inc. ", "acme corporation"],
    ["ACME Ltd", "acme"],
    ["Acme Pvt. Ltd.", "acme"],
    ["Acme GmbH", "acme"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizeCompanyName(input)).toBe(expected);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/normalise.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/normalise/domain"`.

- [ ] **Step 4: Write the error type**

```typescript
// src/lib/errors.ts
export class ApplicationError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR");
  }
}

export class NotFoundError extends ApplicationError {
  constructor(message: string) {
    super(message, "NOT_FOUND");
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string) {
    super(message, "FORBIDDEN");
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}

export class InvalidStateTransitionError extends ApplicationError {
  constructor(message: string) {
    super(message, "INVALID_STATE_TRANSITION");
  }
}
```

- [ ] **Step 5: Write the implementations**

```typescript
// src/lib/normalise/domain.ts
import { parse } from "tldts";

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") return null;
  const parsed = parse(trimmed, { allowPrivateDomains: false });
  if (parsed.isIp) return null;
  const domain = parsed.domain;
  if (domain === null || domain === "") return null;
  return domain.toLowerCase().replace(/\.$/, "");
}
```

```typescript
// src/lib/normalise/email.ts
import { ValidationError } from "@/lib/errors";
import { normalizeDomain } from "@/lib/normalise/domain";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normalizeEmail(input: string): string {
  const normalised = input.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalised)) {
    throw new ValidationError(`Invalid email address: ${input}`);
  }
  return normalised;
}

export function emailDomain(input: string): string | null {
  const normalised = normalizeEmail(input);
  const [, host] = normalised.split("@");
  return host === undefined ? null : normalizeDomain(host);
}
```

```typescript
// src/lib/normalise/name.ts
const LEGAL_SUFFIXES = [
  "inc", "incorporated", "llc", "ltd", "limited", "plc", "gmbh", "ag", "sa",
  "srl", "bv", "nv", "oy", "ab", "as", "pty", "pvt", "private", "corp",
  "corporation", "co", "company", "llp", "lp",
];

export function normalizeCompanyName(input: string): string {
  const base = input
    .toLowerCase()
    .replace(/[.,'"()]/g, " ")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();

  const words = base.split(" ");
  while (words.length > 1) {
    const last = words[words.length - 1];
    if (last !== undefined && LEGAL_SUFFIXES.includes(last)) {
      words.pop();
      continue;
    }
    break;
  }
  return words.join(" ");
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/normalise.test.ts`
Expected: PASS — all cases.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add domain, email and company name normalisation"
```

---

### Task 5: Money primitives and the exchange rate table

SRS §10 states currency handling is not deferrable to Phase 5 — the columns, minor-unit storage and `ExchangeRate` table must exist now because retrofitting currency onto amount columns after live data exists is a migration with no safe default.

**Files:**
- Create: `src/lib/money/currency.ts`, `src/lib/money/exchange-rate.ts`
- Modify: `prisma/schema.prisma` (add `ExchangeRate`)
- Test: `tests/money.test.ts`

**Interfaces:**
- Consumes: `src/lib/errors.ts` (Task 4).
- Produces:
  - `type Money = { amountMinor: bigint; currency: string }`
  - `toMinorUnits(amount: string, currency: string): bigint`
  - `fromMinorUnits(amountMinor: bigint, currency: string): string`
  - `formatMoney(money: Money): string`
  - `getRateOn(client, from, to, onDate): Promise<{ id: string; rate: Prisma.Decimal }>` — throws `MissingExchangeRateError`
  - `convertToReporting(client, money, onDate, reportingCurrency): Promise<{ amountMinor: bigint; currency: string; exchangeRateId: string | null }>` — the id is null for an identity conversion
  - `class MissingExchangeRateError extends ApplicationError`

- [ ] **Step 1: Add the `ExchangeRate` model**

Unique on (`fromCurrency`, `toCurrency`, `effectiveDate`) per SRS §4.9. `rate` is `Decimal`, never `Float`.

```prisma
// prisma/schema.prisma — append
enum RateSource {
  manual
  feed
}

model ExchangeRate {
  id            String     @id @default(cuid())
  fromCurrency  String     @db.Char(3)
  toCurrency    String     @db.Char(3)
  rate          Decimal    @db.Decimal(20, 10)
  effectiveDate DateTime   @db.Date
  source        RateSource @default(manual)
  enteredById   String?
  createdAt     DateTime   @default(now())
  updatedAt     DateTime   @updatedAt

  @@unique([fromCurrency, toCurrency, effectiveDate])
  @@index([fromCurrency, toCurrency, effectiveDate])
}
```

Run: `pnpm prisma migrate dev --name add_exchange_rate`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/money.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { resetDb, testDb } from "./helpers/db";
import { formatMoney, fromMinorUnits, toMinorUnits } from "@/lib/money/currency";
import {
  MissingExchangeRateError,
  convertToReporting,
  getRateOn,
} from "@/lib/money/exchange-rate";
import { ValidationError } from "@/lib/errors";

describe("minor units", () => {
  it.each([
    ["10.50", "USD", 1050n],
    ["10", "USD", 1000n],
    ["1234.05", "INR", 123405n],
    ["1000", "JPY", 1000n],
  ])("converts %s %s to %s minor units", (amount, currency, expected) => {
    expect(toMinorUnits(amount, currency)).toBe(expected);
  });

  it("round-trips", () => {
    expect(fromMinorUnits(toMinorUnits("99.99", "USD"), "USD")).toBe("99.99");
  });

  it("rejects more decimal places than the currency has", () => {
    expect(() => toMinorUnits("10.005", "USD")).toThrow(ValidationError);
  });

  it("rejects an unknown currency", () => {
    expect(() => toMinorUnits("10.00", "XYZ")).toThrow(ValidationError);
  });

  it("formats with the currency code", () => {
    expect(formatMoney({ amountMinor: 123405n, currency: "INR" })).toBe("INR 1234.05");
  });
});

describe("exchange rates", () => {
  beforeEach(resetDb);

  it("returns the most recent rate on or before the transaction date", async () => {
    const db = testDb();
    await db.exchangeRate.createMany({
      data: [
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("83.0"), effectiveDate: new Date("2026-01-01") },
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("85.0"), effectiveDate: new Date("2026-03-01") },
      ],
    });

    const rate = await getRateOn(db, "USD", "INR", new Date("2026-02-15"));
    expect(rate.rate.toString()).toBe("83");
  });

  it("throws rather than falling back to 1.0 when no rate exists", async () => {
    await expect(
      getRateOn(testDb(), "EUR", "INR", new Date("2026-02-15")),
    ).rejects.toBeInstanceOf(MissingExchangeRateError);
  });

  it("never interpolates between rates", async () => {
    const db = testDb();
    await db.exchangeRate.createMany({
      data: [
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("80.0"), effectiveDate: new Date("2026-01-01") },
        { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("90.0"), effectiveDate: new Date("2026-02-01") },
      ],
    });
    const rate = await getRateOn(db, "USD", "INR", new Date("2026-01-20"));
    expect(rate.rate.toString()).toBe("80");
  });

  it("converts and persists the rate used", async () => {
    const db = testDb();
    const created = await db.exchangeRate.create({
      data: { fromCurrency: "USD", toCurrency: "INR", rate: new Prisma.Decimal("83.5"), effectiveDate: new Date("2026-01-01") },
    });

    const result = await convertToReporting(
      db,
      { amountMinor: 10_000n, currency: "USD" },
      new Date("2026-02-01"),
      "INR",
    );

    // 100.00 USD * 83.5 = 8350.00 INR = 835000 paise
    expect(result.amountMinor).toBe(835_000n);
    expect(result.currency).toBe("INR");
    expect(result.exchangeRateId).toBe(created.id);
  });

  it("is an identity conversion when the currencies match", async () => {
    const result = await convertToReporting(
      testDb(),
      { amountMinor: 500n, currency: "INR" },
      new Date("2026-02-01"),
      "INR",
    );
    expect(result.amountMinor).toBe(500n);
    expect(result.exchangeRateId).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/money.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/money/currency"`.

- [ ] **Step 4: Write `currency.ts`**

```typescript
// src/lib/money/currency.ts
import { ValidationError } from "@/lib/errors";

/** Currencies the platform accepts, with their ISO 4217 minor-unit exponent. */
export const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  AUD: 2,
  SGD: 2,
  AED: 2,
  JPY: 0,
};

export type CurrencyCode = keyof typeof CURRENCY_EXPONENTS;

export type Money = {
  amountMinor: bigint;
  currency: string;
};

export function exponentFor(currency: string): number {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new ValidationError(`Unsupported currency: ${currency}`);
  }
  return exponent;
}

/** Parses a decimal string into integer minor units. Never uses floating point. */
export function toMinorUnits(amount: string, currency: string): bigint {
  const exponent = exponentFor(currency);
  const trimmed = amount.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (match === null) {
    throw new ValidationError(`Invalid amount: ${amount}`);
  }
  const [, sign = "", whole = "0", fraction = ""] = match;
  if (fraction.length > exponent) {
    throw new ValidationError(
      `${currency} has ${exponent} minor unit digits; got "${amount}"`,
    );
  }
  const padded = fraction.padEnd(exponent, "0");
  return BigInt(`${sign}${whole}${padded}`);
}

export function fromMinorUnits(amountMinor: bigint, currency: string): string {
  const exponent = exponentFor(currency);
  if (exponent === 0) return amountMinor.toString();
  const negative = amountMinor < 0n;
  const digits = (negative ? -amountMinor : amountMinor).toString().padStart(exponent + 1, "0");
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export function formatMoney(money: Money): string {
  return `${money.currency} ${fromMinorUnits(money.amountMinor, money.currency)}`;
}
```

- [ ] **Step 5: Write `exchange-rate.ts`**

```typescript
// src/lib/money/exchange-rate.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { ApplicationError } from "@/lib/errors";
import { exponentFor, type Money } from "@/lib/money/currency";

export class MissingExchangeRateError extends ApplicationError {
  constructor(from: string, to: string, onDate: Date) {
    super(
      `No exchange rate for ${from}->${to} effective on or before ${onDate.toISOString().slice(0, 10)}`,
      "MISSING_EXCHANGE_RATE",
    );
  }
}

/** Any Prisma client or interactive transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * CUR-7: the most recent entry with effectiveDate on or before the transaction
 * date. Rates are never interpolated.
 */
export async function getRateOn(
  client: Db,
  fromCurrency: string,
  toCurrency: string,
  onDate: Date,
): Promise<{ id: string; rate: Prisma.Decimal }> {
  const row = await client.exchangeRate.findFirst({
    where: { fromCurrency, toCurrency, effectiveDate: { lte: onDate } },
    orderBy: { effectiveDate: "desc" },
    select: { id: true, rate: true },
  });
  // CUR-5: a missing rate is a hard error, never a silent fallback to 1.0.
  if (row === null) throw new MissingExchangeRateError(fromCurrency, toCurrency, onDate);
  return row;
}

/**
 * CUR-3: converts at the transaction date and returns the rate id so the
 * caller can persist it alongside the converted amount.
 */
export async function convertToReporting(
  client: Db,
  money: Money,
  onDate: Date,
  reportingCurrency: string,
): Promise<{ amountMinor: bigint; currency: string; exchangeRateId: string | null }> {
  if (money.currency === reportingCurrency) {
    return { amountMinor: money.amountMinor, currency: reportingCurrency, exchangeRateId: null };
  }

  const { id, rate } = await getRateOn(client, money.currency, reportingCurrency, onDate);
  const fromExponent = exponentFor(money.currency);
  const toExponent = exponentFor(reportingCurrency);

  const converted = new Prisma.Decimal(money.amountMinor.toString())
    .div(new Prisma.Decimal(10).pow(fromExponent))
    .mul(rate)
    .mul(new Prisma.Decimal(10).pow(toExponent))
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);

  return {
    amountMinor: BigInt(converted.toFixed(0)),
    currency: reportingCurrency,
    exchangeRateId: id,
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/money.test.ts`
Expected: PASS — all cases.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add minor-unit money primitives and exchange rate lookup"
```

---

### Task 6: Organisations, users, roles and the audit log schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/seed/roles.ts`, `prisma/seed/index.ts`, `tests/helpers/factories.ts`
- Test: `tests/schema-organisations.test.ts`

**Interfaces:**
- Consumes: Task 3's harness, Task 4's normalisation.
- Produces: Prisma models `Organization`, `OrganizationDomain`, `User`, `Role`, `UserRole`, `Invitation`, `AuditLog`; the `RoleCode` and `Portal` enums; the seed runner `prisma/seed/index.ts`; factories `createOrganization`, `createUser` in `tests/helpers/factories.ts`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/schema-organisations.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";

describe("organisation schema", () => {
  beforeEach(resetDb);

  it("supports an organisation that is both client and partner", async () => {
    const db = testDb();
    const org = await db.organization.create({
      data: {
        name: "Acme",
        isClient: true,
        isPartner: true,
        isInternal: false,
        status: "active",
        country: "IN",
        defaultBillingCurrency: "USD",
        defaultPayoutCurrency: "INR",
        payoutTrigger: "monthlyArrears",
      },
    });
    expect(org.isClient && org.isPartner).toBe(true);
  });

  it("enforces a unique normalised organisation domain", async () => {
    const db = testDb();
    const org = await db.organization.create({
      data: { name: "Acme", isClient: true, status: "active" },
    });
    await db.organizationDomain.create({ data: { organizationId: org.id, domain: "acme.com" } });
    await expect(
      db.organizationDomain.create({ data: { organizationId: org.id, domain: "acme.com" } }),
    ).rejects.toThrow();
  });

  it("enforces a unique normalised user email", async () => {
    const db = testDb();
    const org = await db.organization.create({
      data: { name: "Acme", isClient: true, status: "active" },
    });
    await db.user.create({
      data: { email: "jane@acme.com", name: "Jane", organizationId: org.id, status: "active" },
    });
    await expect(
      db.user.create({
        data: { email: "jane@acme.com", name: "Jane Two", organizationId: org.id, status: "active" },
      }),
    ).rejects.toThrow();
  });

  it("seeds all ten roles across three portals", async () => {
    const db = testDb();
    await seedRoles(db);
    expect(await db.role.count()).toBe(10);
    expect(await db.role.count({ where: { portal: "admin" } })).toBe(6);
    expect(await db.role.count({ where: { portal: "client" } })).toBe(2);
    expect(await db.role.count({ where: { portal: "partner" } })).toBe(2);
  });

  it("is idempotent when the role seed runs twice", async () => {
    const db = testDb();
    await seedRoles(db);
    await seedRoles(db);
    expect(await db.role.count()).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/schema-organisations.test.ts`
Expected: FAIL — `Property 'organization' does not exist` and the seed module is missing.

- [ ] **Step 3: Add the models to `prisma/schema.prisma`**

`AuditLog` has no `updatedAt` and no update path — NFR-A-2 makes it append-only.

```prisma
// prisma/schema.prisma — append
enum OrganizationStatus {
  active
  suspended
  archived
}

enum PayoutTrigger {
  monthlyArrears
  campaignClose
}

enum Portal {
  admin
  client
  partner
}

enum UserStatus {
  invited
  active
  suspended
}

enum InvitationStatus {
  pending
  accepted
  revoked
  expired
}

model Organization {
  id                     String             @id @default(cuid())
  name                   String
  legalName              String?
  isClient               Boolean            @default(false)
  isPartner              Boolean            @default(false)
  isInternal             Boolean            @default(false)
  status                 OrganizationStatus @default(active)
  country                String?
  defaultBillingCurrency String?            @db.Char(3)
  defaultPayoutCurrency  String?            @db.Char(3)
  payoutTrigger          PayoutTrigger      @default(monthlyArrears)
  notes                  String?
  deletedAt              DateTime?
  createdAt              DateTime           @default(now())
  updatedAt              DateTime           @updatedAt
  createdById            String?
  updatedById            String?

  domains     OrganizationDomain[]
  users       User[]
  invitations Invitation[]

  @@index([isClient])
  @@index([isPartner])
}

model OrganizationDomain {
  id             String       @id @default(cuid())
  organizationId String
  domain         String       @unique
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  organization   Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId])
}

model User {
  id             String       @id @default(cuid())
  email          String       @unique
  name           String
  organizationId String
  status         UserStatus   @default(invited)
  lastLoginAt    DateTime?
  authUserId     String?      @unique
  deletedAt      DateTime?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  createdById    String?
  updatedById    String?

  organization Organization @relation(fields: [organizationId], references: [id])
  roles        UserRole[]

  @@index([organizationId])
}

model Role {
  id        String     @id @default(cuid())
  code      String     @unique
  name      String
  portal    Portal
  createdAt DateTime   @default(now())
  updatedAt DateTime   @updatedAt

  users       UserRole[]
  invitations Invitation[]
}

model UserRole {
  id        String   @id @default(cuid())
  userId    String
  roleId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  user User @relation(fields: [userId], references: [id])
  role Role @relation(fields: [roleId], references: [id])

  @@unique([userId, roleId])
}

model Invitation {
  id             String           @id @default(cuid())
  email          String
  organizationId String
  roleId         String
  tokenHash      String           @unique
  expiresAt      DateTime
  invitedById    String
  status         InvitationStatus @default(pending)
  acceptedAt     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  role         Role         @relation(fields: [roleId], references: [id])

  @@index([email, status])
  @@index([organizationId])
}

model AuditLog {
  id                  String   @id @default(cuid())
  actorUserId         String?
  actorOrganizationId String?
  entityType          String
  entityId            String
  action              String
  beforeJson          Json?
  afterJson           Json?
  occurredAt          DateTime @default(now())
  ipAddress           String?

  @@index([entityType, entityId, occurredAt])
  @@index([actorUserId, occurredAt])
}
```

Run: `pnpm prisma migrate dev --name add_organisations_users_roles_audit`

- [ ] **Step 4: Write the role seed**

The ten roles come from SRS §3.2 verbatim.

```typescript
// prisma/seed/roles.ts
import type { Portal, PrismaClient } from "@prisma/client";

export const ROLE_DEFINITIONS: ReadonlyArray<{ code: string; name: string; portal: Portal }> = [
  { code: "SUPER_ADMIN", name: "Super Admin", portal: "admin" },
  { code: "CAMPAIGN_MANAGER", name: "Campaign Manager", portal: "admin" },
  { code: "OPERATIONS", name: "Operations", portal: "admin" },
  { code: "QUALITY", name: "Quality", portal: "admin" },
  { code: "ACCOUNT_MANAGER", name: "Account Manager", portal: "admin" },
  { code: "FINANCE", name: "Finance", portal: "admin" },
  { code: "CLIENT_ADMIN", name: "Client Admin", portal: "client" },
  { code: "CLIENT_VIEWER", name: "Client Viewer", portal: "client" },
  { code: "PARTNER_ADMIN", name: "Partner Admin", portal: "partner" },
  { code: "PARTNER_OPERATOR", name: "Partner Operator", portal: "partner" },
];

export async function seedRoles(db: PrismaClient): Promise<void> {
  for (const role of ROLE_DEFINITIONS) {
    await db.role.upsert({
      where: { code: role.code },
      update: { name: role.name, portal: role.portal },
      create: role,
    });
  }
}
```

- [ ] **Step 5: Write the seed runner**

```typescript
// prisma/seed/index.ts
import { PrismaClient } from "@prisma/client";
import { seedRoles } from "./roles";

const db = new PrismaClient();

async function main(): Promise<void> {
  await seedRoles(db);
  console.log("seed complete");
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void db.$disconnect());
```

- [ ] **Step 6: Write the test factories**

Later tasks reuse these instead of repeating create calls.

```typescript
// tests/helpers/factories.ts
import type { PrismaClient } from "@prisma/client";
import { normalizeEmail } from "@/lib/normalise/email";

let counter = 0;
const unique = () => `${Date.now()}-${counter++}`;

export async function createOrganization(
  db: PrismaClient,
  overrides: Partial<{ name: string; isClient: boolean; isPartner: boolean; isInternal: boolean; defaultBillingCurrency: string; defaultPayoutCurrency: string }> = {},
) {
  return db.organization.create({
    data: {
      name: overrides.name ?? `Org ${unique()}`,
      isClient: overrides.isClient ?? true,
      isPartner: overrides.isPartner ?? false,
      isInternal: overrides.isInternal ?? false,
      status: "active",
      country: "IN",
      defaultBillingCurrency: overrides.defaultBillingCurrency ?? "USD",
      defaultPayoutCurrency: overrides.defaultPayoutCurrency ?? "INR",
    },
  });
}

export async function createUser(
  db: PrismaClient,
  organizationId: string,
  roleCode: string,
  overrides: Partial<{ email: string; name: string }> = {},
) {
  const role = await db.role.findUniqueOrThrow({ where: { code: roleCode } });
  return db.user.create({
    data: {
      email: normalizeEmail(overrides.email ?? `user-${unique()}@example.com`),
      name: overrides.name ?? "Test User",
      organizationId,
      status: "active",
      roles: { create: { roleId: role.id } },
    },
    include: { roles: { include: { role: true } } },
  });
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm test tests/schema-organisations.test.ts`
Expected: PASS — all five tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add organisation, user, role, invitation and audit schema with role seed"
```

---

### Task 7: The Actor, the permission matrix and `assertPermission`

AUTH-8 requires every data access path to resolve the acting user's organisation and role before returning data. This task builds the primitive every later service takes as its first argument.

**Files:**
- Create: `src/lib/auth/permissions.ts`, `src/lib/auth/actor.ts`
- Test: `tests/permissions.test.ts`

**Interfaces:**
- Consumes: Task 6's `Role`, `UserRole` models; `ForbiddenError` from Task 4.
- Produces:
  - `type RoleCode` — union of the ten codes from `ROLE_DEFINITIONS`.
  - `type Permission` — union of permission strings.
  - `type Actor = { userId: string; organizationId: string; portal: Portal; roles: RoleCode[]; isClient: boolean; isPartner: boolean; isInternal: boolean }`
  - `hasPermission(actor: Actor, permission: Permission): boolean`
  - `assertPermission(actor: Actor, permission: Permission): void` — throws `ForbiddenError`
  - `assertOrganizationAccess(actor: Actor, organizationId: string): void` — throws `ForbiddenError` unless the actor is internal or the ids match (AUTH-9)
  - `loadActor(db, userId): Promise<Actor>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/permissions.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import {
  assertOrganizationAccess,
  assertPermission,
  hasPermission,
  loadActor,
} from "@/lib/auth/permissions";
import { ForbiddenError } from "@/lib/errors";

const actorOf = (roles: string[], orgId = "org-1", overrides = {}) => ({
  userId: "user-1",
  organizationId: orgId,
  portal: "admin" as const,
  roles: roles as never,
  isClient: false,
  isPartner: false,
  isInternal: true,
  ...overrides,
});

describe("permission matrix", () => {
  it("gives Super Admin every permission", () => {
    expect(hasPermission(actorOf(["SUPER_ADMIN"]), "channelType:publish")).toBe(true);
    expect(hasPermission(actorOf(["SUPER_ADMIN"]), "campaign:approveClient")).toBe(true);
  });

  it("lets a Campaign Manager write campaigns but not publish channel types", () => {
    const actor = actorOf(["CAMPAIGN_MANAGER"]);
    expect(hasPermission(actor, "campaign:write")).toBe(true);
    expect(hasPermission(actor, "channelType:publish")).toBe(false);
  });

  it("gives Client Viewer read only", () => {
    const actor = actorOf(["CLIENT_VIEWER"], "org-2", { portal: "client", isInternal: false, isClient: true });
    expect(hasPermission(actor, "campaign:read")).toBe(true);
    expect(hasPermission(actor, "campaign:write")).toBe(false);
    expect(hasPermission(actor, "campaign:approveClient")).toBe(false);
  });

  it("gives only Client Admin the client approval permission", () => {
    const admin = actorOf(["CLIENT_ADMIN"], "org-2", { portal: "client", isInternal: false, isClient: true });
    expect(hasPermission(admin, "campaign:approveClient")).toBe(true);
  });

  it("unions permissions across multiple roles", () => {
    const actor = actorOf(["FINANCE", "CAMPAIGN_MANAGER"]);
    expect(hasPermission(actor, "exchangeRate:write")).toBe(true);
    expect(hasPermission(actor, "campaign:write")).toBe(true);
  });

  it("assertPermission throws ForbiddenError when denied", () => {
    expect(() => assertPermission(actorOf(["CLIENT_VIEWER"]), "campaign:write")).toThrow(ForbiddenError);
  });
});

describe("organisation scoping (AUTH-9)", () => {
  it("allows an internal actor to reach any organisation", () => {
    expect(() => assertOrganizationAccess(actorOf(["OPERATIONS"]), "org-999")).not.toThrow();
  });

  it("blocks a client actor from another organisation", () => {
    const actor = actorOf(["CLIENT_ADMIN"], "org-2", { portal: "client", isInternal: false, isClient: true });
    expect(() => assertOrganizationAccess(actor, "org-3")).toThrow(ForbiddenError);
    expect(() => assertOrganizationAccess(actor, "org-2")).not.toThrow();
  });
});

describe("loadActor", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("builds an actor from the database record", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isClient: false, isInternal: true });
    const user = await createUser(db, org.id, "OPERATIONS");

    const actor = await loadActor(db, user.id);

    expect(actor.organizationId).toBe(org.id);
    expect(actor.roles).toEqual(["OPERATIONS"]);
    expect(actor.portal).toBe("admin");
    expect(actor.isInternal).toBe(true);
  });

  it("refuses a suspended user", async () => {
    const db = testDb();
    const org = await createOrganization(db);
    const user = await createUser(db, org.id, "CLIENT_ADMIN");
    await db.user.update({ where: { id: user.id }, data: { status: "suspended" } });

    await expect(loadActor(db, user.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/permissions.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/permissions"`.

- [ ] **Step 3: Write the permission matrix**

The matrix is explicit and closed. An unlisted role/permission pair is denied — there is no wildcard except `SUPER_ADMIN`, which SRS §3.2 defines as "All".

```typescript
// src/lib/auth/permissions.ts
import type { Portal, PrismaClient } from "@prisma/client";
import { ForbiddenError } from "@/lib/errors";

export type RoleCode =
  | "SUPER_ADMIN"
  | "CAMPAIGN_MANAGER"
  | "OPERATIONS"
  | "QUALITY"
  | "ACCOUNT_MANAGER"
  | "FINANCE"
  | "CLIENT_ADMIN"
  | "CLIENT_VIEWER"
  | "PARTNER_ADMIN"
  | "PARTNER_OPERATOR";

export type Permission =
  | "organization:read"
  | "organization:write"
  | "user:invite"
  | "user:manageRoles"
  | "account:read"
  | "account:write"
  | "account:merge"
  | "channelType:read"
  | "channelType:write"
  | "channelType:publish"
  | "campaign:read"
  | "campaign:write"
  | "campaign:submitInternal"
  | "campaign:approveInternal"
  | "campaign:approveClient"
  | "campaign:clone"
  | "list:read"
  | "list:write"
  | "exchangeRate:write"
  | "setting:write"
  | "audit:read";

const CLIENT_READ: Permission[] = ["campaign:read", "account:read", "list:read", "organization:read"];

const MATRIX: Readonly<Record<RoleCode, readonly Permission[]>> = {
  SUPER_ADMIN: [], // handled by the explicit check below
  CAMPAIGN_MANAGER: [
    "organization:read", "account:read", "channelType:read",
    "campaign:read", "campaign:write", "campaign:submitInternal",
    "campaign:approveInternal", "campaign:clone",
    "list:read", "list:write", "audit:read",
  ],
  OPERATIONS: [
    "organization:read", "account:read", "account:write", "channelType:read",
    "campaign:read", "list:read", "list:write",
  ],
  QUALITY: ["organization:read", "account:read", "campaign:read", "channelType:read"],
  ACCOUNT_MANAGER: [
    "organization:read", "organization:write", "user:invite",
    "account:read", "campaign:read", "list:read", "channelType:read",
  ],
  FINANCE: ["organization:read", "campaign:read", "exchangeRate:write", "audit:read"],
  CLIENT_ADMIN: [...CLIENT_READ, "campaign:approveClient", "user:invite", "list:write"],
  CLIENT_VIEWER: [...CLIENT_READ],
  PARTNER_ADMIN: ["organization:read", "campaign:read", "user:invite"],
  PARTNER_OPERATOR: ["organization:read", "campaign:read"],
};

export type Actor = {
  userId: string;
  organizationId: string;
  portal: Portal;
  roles: RoleCode[];
  isClient: boolean;
  isPartner: boolean;
  isInternal: boolean;
};

export function hasPermission(actor: Actor, permission: Permission): boolean {
  if (actor.roles.includes("SUPER_ADMIN")) return true;
  return actor.roles.some((role) => MATRIX[role].includes(permission));
}

export function assertPermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor, permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
}

/**
 * AUTH-9: a client or partner actor can never reach another organisation's
 * data. Internal actors are unrestricted at this layer; per-portal read
 * models (AUTH-10, AUTH-11) constrain what they return.
 */
export function assertOrganizationAccess(actor: Actor, organizationId: string): void {
  if (actor.isInternal) return;
  if (actor.organizationId !== organizationId) {
    throw new ForbiddenError("Cross-organisation access denied");
  }
}

export async function loadActor(db: PrismaClient, userId: string): Promise<Actor> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { organization: true, roles: { include: { role: true } } },
  });

  if (user === null || user.deletedAt !== null) throw new ForbiddenError("Unknown user");
  if (user.status !== "active") throw new ForbiddenError("User is not active");
  if (user.organization.status !== "active") throw new ForbiddenError("Organisation is not active");

  const roles = user.roles.map((r) => r.role.code as RoleCode);
  const portal = user.roles[0]?.role.portal;
  if (portal === undefined) throw new ForbiddenError("User has no role");

  return {
    userId: user.id,
    organizationId: user.organizationId,
    portal,
    roles,
    isClient: user.organization.isClient,
    isPartner: user.organization.isPartner,
    isInternal: user.organization.isInternal,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/permissions.test.ts`
Expected: PASS — all tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add actor resolution and the rbac permission matrix"
```

---

### Task 8: The audit log writer

NFR-A-1 requires an audit entry with actor, timestamp and before/after state on every configuration mutation. NFR-A-2 requires those entries to be unmodifiable through any application path.

**Files:**
- Create: `src/lib/audit/audit.ts`
- Modify: `prisma/schema.prisma` (add the update/delete revoking migration)
- Test: `tests/audit.test.ts`

**Interfaces:**
- Consumes: `Actor` (Task 7), `AuditLog` model (Task 6).
- Produces:
  - `writeAudit(client, actor, entry): Promise<void>` where `entry = { entityType: string; entityId: string; action: string; before?: unknown; after?: unknown; ipAddress?: string }`
  - `withAudit<T>(client, actor, entry, fn: (tx) => Promise<T>): Promise<T>` — runs `fn` and the audit write in one transaction (NFR-D-1's principle applied to audit).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/audit.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { withAudit, writeAudit } from "@/lib/audit/audit";

describe("audit log", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("records actor, entity, action and before/after state", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    await writeAudit(db, actor, {
      entityType: "Organization",
      entityId: org.id,
      action: "update",
      before: { name: "Old" },
      after: { name: "New" },
    });

    const entry = await db.auditLog.findFirstOrThrow();
    expect(entry.actorUserId).toBe(user.id);
    expect(entry.actorOrganizationId).toBe(org.id);
    expect(entry.entityType).toBe("Organization");
    expect(entry.action).toBe("update");
    expect(entry.beforeJson).toEqual({ name: "Old" });
    expect(entry.afterJson).toEqual({ name: "New" });
  });

  it("rolls the audit entry back when the wrapped work fails", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);

    await expect(
      withAudit(db, actor, { entityType: "Organization", entityId: org.id, action: "update" }, async (tx) => {
        await tx.organization.update({ where: { id: org.id }, data: { name: "Renamed" } });
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(await db.auditLog.count()).toBe(0);
    const unchanged = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(unchanged.name).toBe(org.name);
  });

  it("rejects UPDATE and DELETE on the audit table at the database level", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, user.id);
    await writeAudit(db, actor, { entityType: "Organization", entityId: org.id, action: "create" });

    await expect(db.$executeRawUnsafe(`UPDATE "AuditLog" SET action = 'tampered'`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`DELETE FROM "AuditLog"`)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/audit.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/audit/audit"`.

- [ ] **Step 3: Write the audit module**

```typescript
// src/lib/audit/audit.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import type { Actor } from "@/lib/auth/permissions";

export type AuditEntry = {
  entityType: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
  ipAddress?: string;
};

type Tx = Prisma.TransactionClient;

const toJson = (value: unknown): Prisma.InputJsonValue | undefined =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

export async function writeAudit(
  client: PrismaClient | Tx,
  actor: Actor,
  entry: AuditEntry,
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: actor.userId,
      actorOrganizationId: actor.organizationId,
      entityType: entry.entityType,
      entityId: entry.entityId,
      action: entry.action,
      beforeJson: toJson(entry.before),
      afterJson: toJson(entry.after),
      ipAddress: entry.ipAddress,
    },
  });
}

/**
 * NFR-A-1: the mutation and its audit entry commit together or not at all.
 * `entry.entityId` may be empty when the id is only known inside `fn`; pass a
 * function for `entry` in that case.
 */
export async function withAudit<T>(
  db: PrismaClient,
  actor: Actor,
  entry: AuditEntry | ((result: T) => AuditEntry),
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    const result = await fn(tx);
    const resolved = typeof entry === "function" ? entry(result) : entry;
    await writeAudit(tx, actor, resolved);
    return result;
  });
}
```

- [ ] **Step 4: Add the append-only database guard**

Prisma cannot express this, so it goes in a hand-written migration. Without it, NFR-A-2 is a convention rather than a guarantee.

```bash
mkdir -p prisma/migrations/20260902000000_audit_log_append_only
cat > prisma/migrations/20260902000000_audit_log_append_only/migration.sql <<'EOF'
CREATE OR REPLACE FUNCTION audit_log_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update
  BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();

CREATE TRIGGER audit_log_no_delete
  BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
EOF
```

The trigger blocks `TRUNCATE`-less deletes only; `resetDb` uses `TRUNCATE`, which triggers do not intercept, so the test harness still works.

- [ ] **Step 5: Apply and run the tests**

Run: `pnpm prisma migrate deploy && pnpm test tests/audit.test.ts`
Expected: PASS — all three tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add transactional audit writer with append-only database guard"
```

---

### Task 9: Platform settings, holiday table and the typed settings service

**Files:**
- Create: `src/lib/settings/settings.ts`, `prisma/seed/settings.ts`
- Modify: `prisma/schema.prisma` (add `Holiday`, add `updatedById` relation fields), `prisma/seed/index.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `Actor`, `assertPermission` (Task 7), `withAudit` (Task 8).
- Produces:
  - `type SettingKey` — union of the seven launch keys.
  - `getSetting<K extends SettingKey>(client, key: K): Promise<SettingValue<K>>` — throws `NotFoundError` when unseeded.
  - `setSetting(db, actor, key, value): Promise<void>` — requires `setting:write`, audited.
  - `seedSettings(db): Promise<void>`.
  - `Holiday` model, used by Phase 3's SLA clock.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/settings.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { getSetting, setSetting } from "@/lib/settings/settings";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

describe("platform settings", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("seeds every launch value from SRS §4.9", async () => {
    const db = testDb();
    await seedSettings(db);

    expect(await getSetting(db, "reportingCurrency")).toBe("INR");
    expect(await getSetting(db, "defaultVerificationSlaBusinessDays")).toBe(3);
    expect(await getSetting(db, "operatingTimezone")).toBe("Asia/Kolkata");
    expect(await getSetting(db, "workingDays")).toEqual(["MO", "TU", "WE", "TH", "FR"]);
    expect(await getSetting(db, "personalDataRetentionMonths")).toBe(12);
    expect(await getSetting(db, "invitationExpiryDays")).toBe(7);
  });

  it("throws rather than guessing when a setting is missing", async () => {
    await expect(getSetting(testDb(), "reportingCurrency")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("lets a Super Admin change a setting and audits the change", async () => {
    const db = testDb();
    await seedSettings(db);
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "SUPER_ADMIN");
    const actor = await loadActor(db, user.id);

    await setSetting(db, actor, "invitationExpiryDays", 14);

    expect(await getSetting(db, "invitationExpiryDays")).toBe(14);
    const entry = await db.auditLog.findFirstOrThrow({ where: { entityType: "PlatformSetting" } });
    expect(entry.beforeJson).toEqual({ value: 7 });
    expect(entry.afterJson).toEqual({ value: 14 });
  });

  it("refuses a non-Super-Admin", async () => {
    const db = testDb();
    await seedSettings(db);
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "OPERATIONS");
    const actor = await loadActor(db, user.id);

    await expect(setSetting(db, actor, "invitationExpiryDays", 14)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/settings.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/settings/settings"`.

- [ ] **Step 3: Add the `Holiday` model**

Created now so Phase 3's SLA clock (FR-VF-2b) has its table from the start.

```prisma
// prisma/schema.prisma — append
model Holiday {
  id        String   @id @default(cuid())
  date      DateTime @db.Date
  name      String
  country   String
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([country, date])
  @@index([date, isActive])
}
```

Run: `pnpm prisma migrate dev --name add_holiday`

- [ ] **Step 4: Write the settings service**

The value type is bound to the key so callers cannot read `workingDays` as a number.

```typescript
// src/lib/settings/settings.ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type WeekDay = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export type SettingValues = {
  reportingCurrency: string;
  defaultVerificationSlaBusinessDays: number;
  operatingTimezone: string;
  workingDays: WeekDay[];
  workingHours: string;
  personalDataRetentionMonths: number;
  invitationExpiryDays: number;
};

export type SettingKey = keyof SettingValues;

export const SETTING_DEFAULTS: SettingValues = {
  reportingCurrency: "INR",
  defaultVerificationSlaBusinessDays: 3,
  operatingTimezone: "Asia/Kolkata",
  workingDays: ["MO", "TU", "WE", "TH", "FR"],
  workingHours: "09:00-18:00",
  personalDataRetentionMonths: 12,
  invitationExpiryDays: 7,
};

type Db = PrismaClient | Prisma.TransactionClient;

export async function getSetting<K extends SettingKey>(
  client: Db,
  key: K,
): Promise<SettingValues[K]> {
  const row = await client.platformSetting.findUnique({ where: { key } });
  if (row === null) {
    throw new NotFoundError(`Platform setting not configured: ${key}. Run the seed.`);
  }
  return row.valueJson as SettingValues[K];
}

export async function setSetting<K extends SettingKey>(
  db: PrismaClient,
  actor: Actor,
  key: K,
  value: SettingValues[K],
): Promise<void> {
  assertPermission(actor, "setting:write");
  if (!(key in SETTING_DEFAULTS)) throw new ValidationError(`Unknown setting: ${key}`);

  const existing = await db.platformSetting.findUnique({ where: { key } });

  await withAudit(
    db,
    actor,
    {
      entityType: "PlatformSetting",
      entityId: key,
      action: existing === null ? "create" : "update",
      before: existing === null ? undefined : { value: existing.valueJson },
      after: { value },
    },
    async (tx) => {
      await tx.platformSetting.upsert({
        where: { key },
        update: { valueJson: value as Prisma.InputJsonValue, updatedById: actor.userId },
        create: { key, valueJson: value as Prisma.InputJsonValue, updatedById: actor.userId },
      });
    },
  );
}
```

- [ ] **Step 5: Write the settings seed and wire it into the runner**

```typescript
// prisma/seed/settings.ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { SETTING_DEFAULTS } from "@/lib/settings/settings";

export async function seedSettings(db: PrismaClient): Promise<void> {
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await db.platformSetting.upsert({
      where: { key },
      update: {}, // never overwrite an operator's change
      create: { key, valueJson: value as Prisma.InputJsonValue },
    });
  }
}
```

Add to `prisma/seed/index.ts`, after `seedRoles(db)`:

```typescript
import { seedSettings } from "./settings";
// ...
  await seedSettings(db);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/settings.test.ts`
Expected: PASS — all four tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add typed platform settings service, holiday table and settings seed"
```

---

### Task 10: Better Auth integration

AUTH-7 delegates session handling, credential storage, password reset and email verification to Better Auth. Application roles and organisation binding stay in the tables from Task 6, joined to the Better Auth user record.

**Files:**
- Create: `src/lib/auth/better-auth.ts`, `src/lib/auth/session.ts`, `src/app/api/auth/[...all]/route.ts`, `src/lib/email/send.ts`
- Modify: `prisma/schema.prisma` (Better Auth tables), `.env.example`
- Test: `tests/auth-session.test.ts`

**Interfaces:**
- Consumes: `db` (Task 3), `loadActor` (Task 7).
- Produces:
  - `auth` — the Better Auth server instance.
  - `getCurrentActor(): Promise<Actor>` — reads the request session, throws `ForbiddenError` when absent. This is what server components and server actions call.
  - `sendEmail(input: { to: string; subject: string; body: string }): Promise<void>` — provider-agnostic; logs in non-production.

- [ ] **Step 1: Install Better Auth and generate its schema**

```bash
pnpm add better-auth
```

- [ ] **Step 2: Configure the Better Auth server**

`emailAndPassword.disableSignUp` is what enforces AUTH-1 at the framework level — invitation acceptance creates users through the server API, not through a public signup route.

```typescript
// src/lib/auth/better-auth.ts
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email/send";

export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  baseURL: process.env.APP_BASE_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    // AUTH-1: there is no public registration. Users are created only by the
    // invitation acceptance path, which calls the server API directly.
    disableSignUp: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Reset your password",
        body: `Reset your password: ${url}`,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        body: `Verify your email: ${url}`,
      });
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
});
```

- [ ] **Step 3: Write the email sender and the route handler**

```typescript
// src/lib/email/send.ts
export type EmailInput = { to: string; subject: string; body: string };

export async function sendEmail(input: EmailInput): Promise<void> {
  if (process.env.EMAIL_PROVIDER_API_KEY === undefined) {
    console.info("[email:dev]", input.to, input.subject, input.body);
    return;
  }
  const response = await fetch(`${process.env.EMAIL_PROVIDER_URL}/send`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.EMAIL_PROVIDER_API_KEY}`,
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM,
      to: input.to,
      subject: input.subject,
      text: input.body,
    }),
  });
  if (!response.ok) {
    throw new Error(`Email send failed: ${response.status} ${await response.text()}`);
  }
}
```

```typescript
// src/app/api/auth/[...all]/route.ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth/better-auth";

export const { GET, POST } = toNextJsHandler(auth);
```

- [ ] **Step 4: Generate and apply the Better Auth schema**

```bash
pnpm dlx @better-auth/cli generate --output prisma/schema.prisma
pnpm prisma migrate dev --name add_better_auth_tables
```

Then link the application `User` to the Better Auth user record: `User.authUserId` (added in Task 6) holds the Better Auth user id.

- [ ] **Step 5: Write the failing test**

`getCurrentActor` is the join between the two systems, and that join is what the test pins down.

```typescript
// tests/auth-session.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { ForbiddenError } from "@/lib/errors";

const getSession = vi.fn();
vi.mock("@/lib/auth/better-auth", () => ({ auth: { api: { getSession: () => getSession() } } }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

describe("getCurrentActor", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    getSession.mockReset();
    vi.resetModules();
  });

  it("resolves the actor from the session's auth user id", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    await db.user.update({ where: { id: user.id }, data: { authUserId: "auth-1" } });
    getSession.mockResolvedValue({ user: { id: "auth-1" } });

    const { getCurrentActor } = await import("@/lib/auth/session");
    const actor = await getCurrentActor(db);

    expect(actor.userId).toBe(user.id);
    expect(actor.roles).toEqual(["CAMPAIGN_MANAGER"]);
  });

  it("throws when there is no session", async () => {
    getSession.mockResolvedValue(null);
    const { getCurrentActor } = await import("@/lib/auth/session");
    await expect(getCurrentActor(testDb())).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws when the session user has no application record", async () => {
    getSession.mockResolvedValue({ user: { id: "auth-unknown" } });
    const { getCurrentActor } = await import("@/lib/auth/session");
    await expect(getCurrentActor(testDb())).rejects.toBeInstanceOf(ForbiddenError);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm test tests/auth-session.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/session"`.

- [ ] **Step 7: Write the session bridge**

```typescript
// src/lib/auth/session.ts
import { headers } from "next/headers";
import type { PrismaClient } from "@prisma/client";
import { auth } from "@/lib/auth/better-auth";
import { db as defaultDb } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { loadActor, type Actor } from "@/lib/auth/permissions";

export async function getCurrentActor(client: PrismaClient = defaultDb): Promise<Actor> {
  const session = await auth.api.getSession({ headers: await headers() });
  const authUserId = session?.user?.id;
  if (authUserId === undefined) throw new ForbiddenError("Not authenticated");

  const user = await client.user.findUnique({ where: { authUserId }, select: { id: true } });
  if (user === null) throw new ForbiddenError("No application user for this session");

  return loadActor(client, user.id);
}
```

- [ ] **Step 8: Record the environment variables**

Append to `.env.example`:

```
APP_BASE_URL="http://localhost:3000"
BETTER_AUTH_SECRET="replace-me"
EMAIL_FROM="no-reply@example.com"
EMAIL_PROVIDER_URL=""
EMAIL_PROVIDER_API_KEY=""
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm test tests/auth-session.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: integrate better auth with session-to-actor resolution"
```

---

### Task 11: Invitation lifecycle

AUTH-3 through AUTH-6. This is the only path by which a user account comes into existence.

**Files:**
- Create: `src/lib/invitations/invitations.ts`
- Test: `tests/invitations.test.ts`

**Interfaces:**
- Consumes: `Actor`, `assertPermission`, `assertOrganizationAccess` (Task 7); `withAudit` (Task 8); `getSetting` (Task 9); `auth` (Task 10); `normalizeEmail` (Task 4).
- Produces:
  - `createInvitation(db, actor, input): Promise<{ invitation: Invitation; token: string }>` where `input = { email: string; organizationId: string; roleCode: RoleCode }`
  - `resendInvitation(db, actor, invitationId): Promise<{ invitation: Invitation; token: string }>`
  - `revokeInvitation(db, actor, invitationId): Promise<void>`
  - `acceptInvitation(db, input: { token: string; name: string; password: string }): Promise<{ userId: string }>`
  - `hashToken(token: string): string`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/invitations.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import {
  acceptInvitation,
  createInvitation,
  hashToken,
  resendInvitation,
  revokeInvitation,
} from "@/lib/invitations/invitations";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";

const signUpEmail = vi.fn(async () => ({ user: { id: "auth-new" } }));
vi.mock("@/lib/auth/better-auth", () => ({
  auth: { api: { signUpEmail: (args: unknown) => signUpEmail(args as never) } },
}));

async function internalActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

describe("invitations", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedSettings(testDb());
    signUpEmail.mockClear();
  });

  it("stores only the token hash and returns the raw token once", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);

    const { invitation, token } = await createInvitation(db, actor, {
      email: "Jane@Acme.com",
      organizationId: client.id,
      roleCode: "CLIENT_ADMIN",
    });

    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    expect(invitation.tokenHash).toBe(hashToken(token));
    expect(invitation.tokenHash).not.toBe(token);
    expect(invitation.email).toBe("jane@acme.com");
  });

  it("expires after invitationExpiryDays", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);

    const before = Date.now();
    const { invitation } = await createInvitation(db, actor, {
      email: "jane@acme.com",
      organizationId: client.id,
      roleCode: "CLIENT_ADMIN",
    });

    const days = (invitation.expiresAt.getTime() - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
  });

  it("rejects a role from a portal the organisation cannot use", async () => {
    const db = testDb();
    const actor = await internalActor();
    const clientOnly = await createOrganization(db, { isClient: true, isPartner: false });

    await expect(
      createInvitation(db, actor, {
        email: "jane@acme.com",
        organizationId: clientOnly.id,
        roleCode: "PARTNER_ADMIN",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks a client admin inviting into another organisation (AUTH-9)", async () => {
    const db = testDb();
    const orgA = await createOrganization(db);
    const orgB = await createOrganization(db);
    const clientAdmin = await createUser(db, orgA.id, "CLIENT_ADMIN");
    const actor = await loadActor(db, clientAdmin.id);

    await expect(
      createInvitation(db, actor, { email: "x@b.com", organizationId: orgB.id, roleCode: "CLIENT_VIEWER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("blocks a client viewer inviting at all", async () => {
    const db = testDb();
    const org = await createOrganization(db);
    const viewer = await createUser(db, org.id, "CLIENT_VIEWER");
    const actor = await loadActor(db, viewer.id);

    await expect(
      createInvitation(db, actor, { email: "x@a.com", organizationId: org.id, roleCode: "CLIENT_VIEWER" }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("invalidates the old token on resend (AUTH-5)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const first = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });

    const second = await resendInvitation(db, actor, first.invitation.id);

    expect(second.token).not.toBe(first.token);
    await expect(
      acceptInvitation(db, { token: first.token, name: "Jane", password: "correct horse battery" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("creates the user, binds the role and marks the email verified (AUTH-4)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });

    const { userId } = await acceptInvitation(db, {
      token, name: "Jane Doe", password: "correct horse battery staple",
    });

    const user = await db.user.findUniqueOrThrow({
      where: { id: userId }, include: { roles: { include: { role: true } } },
    });
    expect(user.email).toBe("jane@acme.com");
    expect(user.organizationId).toBe(client.id);
    expect(user.status).toBe("active");
    expect(user.roles.map((r) => r.role.code)).toEqual(["CLIENT_ADMIN"]);

    const invitation = await db.invitation.findFirstOrThrow({ where: { email: "jane@acme.com" } });
    expect(invitation.status).toBe("accepted");
  });

  it("is single-use (AUTH-3)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });
    await acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" });

    await expect(
      acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an expired token", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { invitation, token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });
    await db.invitation.update({
      where: { id: invitation.id }, data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(
      acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a revoked token", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    const { invitation, token } = await createInvitation(db, actor, {
      email: "jane@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });
    await revokeInvitation(db, actor, invitation.id);

    await expect(
      acceptInvitation(db, { token, name: "Jane", password: "correct horse battery staple" }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses to invite an email that already has an account (AUTH-6)", async () => {
    const db = testDb();
    const actor = await internalActor();
    const client = await createOrganization(db);
    await createUser(db, client.id, "CLIENT_VIEWER", { email: "taken@acme.com" });

    await expect(
      createInvitation(db, actor, {
        email: "taken@acme.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/invitations.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/invitations/invitations"`.

- [ ] **Step 3: Write the invitation module**

```typescript
// src/lib/invitations/invitations.ts
import { createHash, randomBytes } from "node:crypto";
import type { Invitation, PrismaClient } from "@prisma/client";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
  type RoleCode,
} from "@/lib/auth/permissions";
import { withAudit, writeAudit } from "@/lib/audit/audit";
import { getSetting } from "@/lib/settings/settings";
import { normalizeEmail } from "@/lib/normalise/email";
import { auth } from "@/lib/auth/better-auth";
import { sendEmail } from "@/lib/email/send";

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/** A role is only offerable to an organisation carrying the matching capability flag. */
async function assertRoleFitsOrganization(
  db: PrismaClient,
  organizationId: string,
  roleCode: RoleCode,
): Promise<{ roleId: string }> {
  const role = await db.role.findUnique({ where: { code: roleCode } });
  if (role === null) throw new ValidationError(`Unknown role: ${roleCode}`);

  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (org === null || org.deletedAt !== null) throw new NotFoundError("Organisation not found");

  const permitted =
    (role.portal === "admin" && org.isInternal) ||
    (role.portal === "client" && org.isClient) ||
    (role.portal === "partner" && org.isPartner);

  if (!permitted) {
    throw new ValidationError(
      `Organisation ${org.name} cannot hold a ${role.portal} role`,
    );
  }
  return { roleId: role.id };
}

export async function createInvitation(
  db: PrismaClient,
  actor: Actor,
  input: { email: string; organizationId: string; roleCode: RoleCode },
): Promise<{ invitation: Invitation; token: string }> {
  assertPermission(actor, "user:invite");
  assertOrganizationAccess(actor, input.organizationId);

  const email = normalizeEmail(input.email);
  const { roleId } = await assertRoleFitsOrganization(db, input.organizationId, input.roleCode);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing !== null) {
    // AUTH-6: one user, one organisation. A second organisation needs a second address.
    throw new ConflictError(`${email} already has an account`);
  }

  const pending = await db.invitation.findFirst({ where: { email, status: "pending" } });
  if (pending !== null) throw new ConflictError(`${email} already has a pending invitation`);

  const expiryDays = await getSetting(db, "invitationExpiryDays");
  const token = newToken();

  const invitation = await withAudit<Invitation>(
    db,
    actor,
    (created) => ({
      entityType: "Invitation",
      entityId: created.id,
      action: "create",
      after: { email, organizationId: input.organizationId, roleCode: input.roleCode },
    }),
    (tx) =>
      tx.invitation.create({
        data: {
          email,
          organizationId: input.organizationId,
          roleId,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
          invitedById: actor.userId,
          status: "pending",
        },
      }),
  );

  await sendEmail({
    to: email,
    subject: "You have been invited",
    body: `Accept your invitation: ${process.env.APP_BASE_URL}/invite/${token}`,
  });

  return { invitation, token };
}

export async function resendInvitation(
  db: PrismaClient,
  actor: Actor,
  invitationId: string,
): Promise<{ invitation: Invitation; token: string }> {
  assertPermission(actor, "user:invite");

  const existing = await db.invitation.findUnique({ where: { id: invitationId } });
  if (existing === null) throw new NotFoundError("Invitation not found");
  assertOrganizationAccess(actor, existing.organizationId);
  if (existing.status !== "pending") {
    throw new ValidationError(`Cannot resend a ${existing.status} invitation`);
  }

  const expiryDays = await getSetting(db, "invitationExpiryDays");
  const token = newToken();

  // AUTH-5: a resend issues a new token and invalidates the old one, which is
  // what replacing tokenHash accomplishes.
  const invitation = await withAudit<Invitation>(
    db,
    actor,
    { entityType: "Invitation", entityId: invitationId, action: "resend" },
    (tx) =>
      tx.invitation.update({
        where: { id: invitationId },
        data: {
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + expiryDays * 86_400_000),
        },
      }),
  );

  await sendEmail({
    to: invitation.email,
    subject: "Your invitation, resent",
    body: `Accept your invitation: ${process.env.APP_BASE_URL}/invite/${token}`,
  });

  return { invitation, token };
}

export async function revokeInvitation(
  db: PrismaClient,
  actor: Actor,
  invitationId: string,
): Promise<void> {
  assertPermission(actor, "user:invite");

  const existing = await db.invitation.findUnique({ where: { id: invitationId } });
  if (existing === null) throw new NotFoundError("Invitation not found");
  assertOrganizationAccess(actor, existing.organizationId);
  if (existing.status !== "pending") {
    throw new ValidationError(`Cannot revoke a ${existing.status} invitation`);
  }

  await withAudit(
    db,
    actor,
    { entityType: "Invitation", entityId: invitationId, action: "revoke" },
    async (tx) => {
      await tx.invitation.update({
        where: { id: invitationId },
        data: { status: "revoked", revokedAt: new Date() },
      });
    },
  );
}

/**
 * Unauthenticated by design — the token is the credential. AUTH-4: the email
 * on the invitation cannot be changed at acceptance.
 */
export async function acceptInvitation(
  db: PrismaClient,
  input: { token: string; name: string; password: string },
): Promise<{ userId: string }> {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(input.token) },
    include: { role: true },
  });

  if (invitation === null) throw new ValidationError("Invalid invitation token");
  if (invitation.status !== "pending") throw new ValidationError("Invitation is no longer valid");
  if (invitation.expiresAt.getTime() <= Date.now()) {
    await db.invitation.update({ where: { id: invitation.id }, data: { status: "expired" } });
    throw new ValidationError("Invitation has expired");
  }

  const signUp = await auth.api.signUpEmail({
    body: { email: invitation.email, password: input.password, name: input.name },
  });

  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        email: invitation.email,
        name: input.name,
        organizationId: invitation.organizationId,
        status: "active",
        authUserId: signUp.user.id,
        roles: { create: { roleId: invitation.roleId } },
      },
    });

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "accepted", acceptedAt: new Date() },
    });

    await writeAudit(
      tx,
      {
        userId: created.id,
        organizationId: invitation.organizationId,
        portal: invitation.role.portal,
        roles: [invitation.role.code as RoleCode],
        isClient: false,
        isPartner: false,
        isInternal: false,
      },
      {
        entityType: "Invitation",
        entityId: invitation.id,
        action: "accept",
        after: { userId: created.id },
      },
    );

    return created;
  });

  return { userId: user.id };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/invitations.test.ts`
Expected: PASS — all eleven tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add invitation lifecycle with hashed single-use tokens"
```

---

### Task 12: Account and contact identity resolution

SRS §11 lists this as the risk that degrades every downstream rule, and mandates an admin resolution queue from day one.

**Files:**
- Create: `src/lib/identity/account-resolution.ts`, `src/lib/identity/contact.ts`
- Modify: `prisma/schema.prisma` (`Account`, `AccountAlias`, `Contact`, `DoNotContact`)
- Test: `tests/identity-resolution.test.ts`

**Interfaces:**
- Consumes: normalisation (Task 4), `Actor` (Task 7), `withAudit` (Task 8).
- Produces:
  - `type AccountMatch = { status: "matched"; accountId: string; matchedOn: "domain" | "nameCountry" | "alias" } | { status: "unmatched" } | { status: "ambiguous"; candidateIds: string[] }`
  - `resolveAccount(client, input: { name?: string; domain?: string; country?: string }): Promise<AccountMatch>`
  - `createAccount(db, actor, input): Promise<Account>`
  - `upsertContact(db, input: { email: string; accountId: string; firstName?: string; lastName?: string; jobTitle?: string; ... }): Promise<Contact>`

- [ ] **Step 1: Add the identity models**

`DoNotContact` is created now and left unenforced — SRS §4.2 says the table lands in Phase 1 and enforcement in Phase 5.

```prisma
// prisma/schema.prisma — append
enum AliasType {
  name
  domain
}

enum DoNotContactType {
  email
  domain
  phone
}

model Account {
  id               String    @id @default(cuid())
  name             String
  normalizedName   String
  primaryDomain    String?   @unique
  parentAccountId  String?
  country          String?
  industry         String?
  employeeRange    String?
  revenueRange     String?
  enrichmentSource String?
  enrichedAt       DateTime?
  mergedIntoId     String?
  deletedAt        DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  createdById      String?
  updatedById      String?

  parentAccount Account?       @relation("AccountHierarchy", fields: [parentAccountId], references: [id])
  children      Account[]      @relation("AccountHierarchy")
  mergedInto    Account?       @relation("AccountMerge", fields: [mergedIntoId], references: [id])
  mergeSources  Account[]      @relation("AccountMerge")
  aliases       AccountAlias[]
  contacts      Contact[]

  @@index([normalizedName, country])
  @@index([mergedIntoId])
}

model AccountAlias {
  id        String    @id @default(cuid())
  accountId String
  value     String    @unique
  type      AliasType
  createdAt DateTime  @default(now())
  updatedAt DateTime  @updatedAt

  account Account @relation(fields: [accountId], references: [id])

  @@index([accountId])
}

model Contact {
  id              String    @id @default(cuid())
  accountId       String
  email           String
  emailNormalized String    @unique
  firstName       String?
  lastName        String?
  jobTitle        String?
  seniority       String?
  jobFunction     String?
  phone           String?
  country         String?
  linkedinUrl     String?
  anonymisedAt    DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  account Account @relation(fields: [accountId], references: [id])

  @@index([accountId])
}

/// FR-CP-5: scoped to a client organisation. Enforcement lands in phase 5.
model DoNotContact {
  id                   String           @id @default(cuid())
  type                 DoNotContactType
  value                String
  valueHash            String
  clientOrganizationId String
  reason               String?
  addedAt              DateTime         @default(now())
  expiresAt            DateTime?
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt

  @@unique([clientOrganizationId, type, value])
  @@index([clientOrganizationId, type, valueHash])
}
```

Run: `pnpm prisma migrate dev --name add_identity_resolution`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/identity-resolution.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";
import { upsertContact } from "@/lib/identity/contact";

async function opsActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "OPERATIONS");
  return loadActor(db, user.id);
}

describe("resolveAccount (FR-ID-1)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("matches on normalised primary domain first", async () => {
    const db = testDb();
    const actor = await opsActor();
    const acme = await createAccount(db, actor, { name: "Acme Inc", domain: "acme.com", country: "US" });
    await createAccount(db, actor, { name: "Acme Incorporated", domain: "acme.io", country: "US" });

    const match = await resolveAccount(db, { name: "Totally Different Name", domain: "https://www.acme.com/x" });

    expect(match).toEqual({ status: "matched", accountId: acme.id, matchedOn: "domain" });
  });

  it("falls back to normalised name plus country", async () => {
    const db = testDb();
    const actor = await opsActor();
    const acme = await createAccount(db, actor, { name: "Acme Corporation", domain: "acme.com", country: "IN" });

    const match = await resolveAccount(db, { name: "  ACME  Corporation, Ltd. ", country: "IN" });

    expect(match).toEqual({ status: "matched", accountId: acme.id, matchedOn: "nameCountry" });
  });

  it("falls back to alias", async () => {
    const db = testDb();
    const actor = await opsActor();
    const acme = await createAccount(db, actor, { name: "Acme Corporation", domain: "acme.com", country: "US" });
    await db.accountAlias.create({ data: { accountId: acme.id, value: "acmeco.com", type: "domain" } });

    const match = await resolveAccount(db, { domain: "www.acmeco.com" });

    expect(match).toEqual({ status: "matched", accountId: acme.id, matchedOn: "alias" });
  });

  it("flags ambiguity rather than guessing (FR-ID-2)", async () => {
    const db = testDb();
    const actor = await opsActor();
    const a = await createAccount(db, actor, { name: "Acme", domain: "acme-one.com", country: "US" });
    const b = await createAccount(db, actor, { name: "Acme", domain: "acme-two.com", country: "US" });

    const match = await resolveAccount(db, { name: "Acme", country: "US" });

    expect(match.status).toBe("ambiguous");
    if (match.status === "ambiguous") {
      expect(match.candidateIds.sort()).toEqual([a.id, b.id].sort());
    }
  });

  it("returns unmatched when nothing fits", async () => {
    expect(await resolveAccount(testDb(), { name: "Nobody", domain: "nobody.test" }))
      .toEqual({ status: "unmatched" });
  });

  it("never matches a merged-away account", async () => {
    const db = testDb();
    const actor = await opsActor();
    const survivor = await createAccount(db, actor, { name: "Survivor", domain: "survivor.com" });
    const merged = await createAccount(db, actor, { name: "Merged", domain: "merged.com" });
    await db.account.update({ where: { id: merged.id }, data: { mergedIntoId: survivor.id } });

    expect(await resolveAccount(db, { domain: "merged.com" })).toEqual({ status: "unmatched" });
  });
});

describe("upsertContact (FR-ID-3)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("reuses the existing record for the same normalised email", async () => {
    const db = testDb();
    const actor = await opsActor();
    const account = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });

    const first = await upsertContact(db, { email: "Jane@Acme.com", accountId: account.id, firstName: "Jane" });
    const second = await upsertContact(db, { email: "  jane@acme.com ", accountId: account.id, jobTitle: "CTO" });

    expect(second.id).toBe(first.id);
    expect(second.firstName).toBe("Jane");
    expect(second.jobTitle).toBe("CTO");
    expect(await db.contact.count()).toBe(1);
  });

  it("does not overwrite a populated field with undefined", async () => {
    const db = testDb();
    const actor = await opsActor();
    const account = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    await upsertContact(db, { email: "jane@acme.com", accountId: account.id, phone: "+911234567890" });

    const updated = await upsertContact(db, { email: "jane@acme.com", accountId: account.id, jobTitle: "CTO" });

    expect(updated.phone).toBe("+911234567890");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/identity-resolution.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/identity/account-resolution"`.

- [ ] **Step 4: Write the resolution module**

```typescript
// src/lib/identity/account-resolution.ts
import type { Account, Prisma, PrismaClient } from "@prisma/client";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { normalizeDomain } from "@/lib/normalise/domain";
import { normalizeCompanyName } from "@/lib/normalise/name";

export type AccountMatch =
  | { status: "matched"; accountId: string; matchedOn: "domain" | "nameCountry" | "alias" }
  | { status: "unmatched" }
  | { status: "ambiguous"; candidateIds: string[] };

type Db = PrismaClient | Prisma.TransactionClient;

const LIVE = { deletedAt: null, mergedIntoId: null } as const;

/** FR-ID-1: domain first, then normalised name plus country, then alias. */
export async function resolveAccount(
  client: Db,
  input: { name?: string; domain?: string; country?: string },
): Promise<AccountMatch> {
  const domain = input.domain === undefined ? null : normalizeDomain(input.domain);

  if (domain !== null) {
    const byDomain = await client.account.findFirst({ where: { primaryDomain: domain, ...LIVE } });
    if (byDomain !== null) {
      return { status: "matched", accountId: byDomain.id, matchedOn: "domain" };
    }
  }

  if (input.name !== undefined && input.country !== undefined) {
    const normalizedName = normalizeCompanyName(input.name);
    const byName = await client.account.findMany({
      where: { normalizedName, country: input.country, ...LIVE },
      select: { id: true },
    });
    if (byName.length === 1 && byName[0] !== undefined) {
      return { status: "matched", accountId: byName[0].id, matchedOn: "nameCountry" };
    }
    // FR-ID-2: ambiguous matches are flagged rather than guessed.
    if (byName.length > 1) {
      return { status: "ambiguous", candidateIds: byName.map((a) => a.id) };
    }
  }

  const aliasValues = [
    domain,
    input.name === undefined ? null : normalizeCompanyName(input.name),
  ].filter((value): value is string => value !== null);

  if (aliasValues.length > 0) {
    const aliases = await client.accountAlias.findMany({
      where: { value: { in: aliasValues }, account: LIVE },
      select: { accountId: true },
      distinct: ["accountId"],
    });
    if (aliases.length === 1 && aliases[0] !== undefined) {
      return { status: "matched", accountId: aliases[0].accountId, matchedOn: "alias" };
    }
    if (aliases.length > 1) {
      return { status: "ambiguous", candidateIds: aliases.map((a) => a.accountId) };
    }
  }

  return { status: "unmatched" };
}

export async function createAccount(
  db: PrismaClient,
  actor: Actor,
  input: {
    name: string;
    domain?: string;
    country?: string;
    industry?: string;
    employeeRange?: string;
    revenueRange?: string;
    parentAccountId?: string;
  },
): Promise<Account> {
  assertPermission(actor, "account:write");
  const primaryDomain = input.domain === undefined ? null : normalizeDomain(input.domain);

  return withAudit<Account>(
    db,
    actor,
    (created) => ({
      entityType: "Account",
      entityId: created.id,
      action: "create",
      after: { name: created.name, primaryDomain: created.primaryDomain },
    }),
    (tx) =>
      tx.account.create({
        data: {
          name: input.name,
          normalizedName: normalizeCompanyName(input.name),
          primaryDomain,
          country: input.country,
          industry: input.industry,
          employeeRange: input.employeeRange,
          revenueRange: input.revenueRange,
          parentAccountId: input.parentAccountId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}
```

- [ ] **Step 5: Write the contact module**

```typescript
// src/lib/identity/contact.ts
import type { Contact, Prisma, PrismaClient } from "@prisma/client";
import { normalizeEmail } from "@/lib/normalise/email";

type Db = PrismaClient | Prisma.TransactionClient;

export type ContactInput = {
  email: string;
  accountId: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  seniority?: string;
  jobFunction?: string;
  phone?: string;
  country?: string;
  linkedinUrl?: string;
};

/**
 * FR-ID-3: contacts are unique on normalised email across the platform, and a
 * contact appearing in a second campaign reuses the existing record. Undefined
 * fields are omitted from the update so a sparse submission cannot blank data
 * a richer one already supplied.
 */
export async function upsertContact(client: Db, input: ContactInput): Promise<Contact> {
  const emailNormalized = normalizeEmail(input.email);

  const updatable = {
    firstName: input.firstName,
    lastName: input.lastName,
    jobTitle: input.jobTitle,
    seniority: input.seniority,
    jobFunction: input.jobFunction,
    phone: input.phone,
    country: input.country,
    linkedinUrl: input.linkedinUrl,
  };
  const update = Object.fromEntries(
    Object.entries(updatable).filter(([, value]) => value !== undefined),
  ) as Prisma.ContactUpdateInput;

  return client.contact.upsert({
    where: { emailNormalized },
    update,
    create: {
      email: input.email.trim(),
      emailNormalized,
      accountId: input.accountId,
      ...updatable,
    },
  });
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/identity-resolution.test.ts`
Expected: PASS — all eight tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add account resolution and contact deduplication"
```

---

### Task 13: Account merge with a reversal window

FR-ID-4: account merge reassigns all child records, writes an audit entry, and is reversible within a configurable window.

**Files:**
- Create: `src/lib/identity/merge.ts`
- Modify: `prisma/schema.prisma` (`AccountMerge` record)
- Test: `tests/account-merge.test.ts`

**Interfaces:**
- Consumes: `createAccount` (Task 12), `withAudit` (Task 8), `assertPermission` (Task 7).
- Produces:
  - `mergeAccounts(db, actor, input: { sourceAccountId: string; targetAccountId: string }): Promise<{ mergeId: string }>`
  - `unmergeAccounts(db, actor, mergeId: string): Promise<void>` — throws `ValidationError` past the window.
  - `ACCOUNT_MERGE_REVERSAL_HOURS = 72`

- [ ] **Step 1: Add the `AccountMerge` model**

The reversal needs to know which contacts and aliases moved; recomputing that after the fact is impossible.

```prisma
// prisma/schema.prisma — append
model AccountMerge {
  id              String    @id @default(cuid())
  sourceAccountId String
  targetAccountId String
  movedJson       Json
  mergedById      String
  mergedAt        DateTime  @default(now())
  reversedAt      DateTime?
  reversedById    String?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  @@index([sourceAccountId])
  @@index([targetAccountId])
}
```

Run: `pnpm prisma migrate dev --name add_account_merge`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/account-merge.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";
import { upsertContact } from "@/lib/identity/contact";
import { ACCOUNT_MERGE_REVERSAL_HOURS, mergeAccounts, unmergeAccounts } from "@/lib/identity/merge";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function adminActor() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

describe("mergeAccounts (FR-ID-4)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("moves contacts and aliases to the target and marks the source merged", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com", country: "US" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com", country: "US" });
    const contact = await upsertContact(db, { email: "jane@acme-co.com", accountId: source.id });

    await mergeAccounts(db, actor, { sourceAccountId: source.id, targetAccountId: target.id });

    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).accountId).toBe(target.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: source.id } })).mergedIntoId).toBe(target.id);
    // The source's domain becomes an alias of the target so future lookups land right.
    const alias = await db.accountAlias.findUniqueOrThrow({ where: { value: "acme-co.com" } });
    expect(alias.accountId).toBe(target.id);
  });

  it("routes a lookup for the merged domain to the target", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com", country: "US" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com", country: "US" });

    await mergeAccounts(db, actor, { sourceAccountId: source.id, targetAccountId: target.id });

    expect(await resolveAccount(db, { domain: "acme-co.com" }))
      .toEqual({ status: "matched", accountId: target.id, matchedOn: "alias" });
  });

  it("writes an audit entry", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com" });

    await mergeAccounts(db, actor, { sourceAccountId: source.id, targetAccountId: target.id });

    const entry = await db.auditLog.findFirstOrThrow({
      where: { entityType: "Account", action: "merge" },
    });
    expect(entry.actorUserId).toBe(actor.userId);
  });

  it("refuses to merge an account into itself", async () => {
    const db = testDb();
    const actor = await adminActor();
    const account = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });

    await expect(
      mergeAccounts(db, actor, { sourceAccountId: account.id, targetAccountId: account.id }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("requires the account:merge permission", async () => {
    const db = testDb();
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "OPERATIONS");
    const ops = await loadActor(db, user.id);
    const admin = await adminActor();
    const target = await createAccount(db, admin, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, admin, { name: "Acme Co", domain: "acme-co.com" });

    await expect(
      mergeAccounts(db, ops, { sourceAccountId: source.id, targetAccountId: target.id }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("reverses within the window", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com" });
    const contact = await upsertContact(db, { email: "jane@acme-co.com", accountId: source.id });
    const { mergeId } = await mergeAccounts(db, actor, {
      sourceAccountId: source.id, targetAccountId: target.id,
    });

    await unmergeAccounts(db, actor, mergeId);

    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).accountId).toBe(source.id);
    expect((await db.account.findUniqueOrThrow({ where: { id: source.id } })).mergedIntoId).toBeNull();
  });

  it("refuses to reverse past the window", async () => {
    const db = testDb();
    const actor = await adminActor();
    const target = await createAccount(db, actor, { name: "Acme", domain: "acme.com" });
    const source = await createAccount(db, actor, { name: "Acme Co", domain: "acme-co.com" });
    const { mergeId } = await mergeAccounts(db, actor, {
      sourceAccountId: source.id, targetAccountId: target.id,
    });
    await db.accountMerge.update({
      where: { id: mergeId },
      data: { mergedAt: new Date(Date.now() - (ACCOUNT_MERGE_REVERSAL_HOURS + 1) * 3_600_000) },
    });

    await expect(unmergeAccounts(db, actor, mergeId)).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/account-merge.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/identity/merge"`.

- [ ] **Step 4: Write the merge module**

```typescript
// src/lib/identity/merge.ts
import type { PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export const ACCOUNT_MERGE_REVERSAL_HOURS = 72;

type MovedRecords = {
  contactIds: string[];
  aliasIds: string[];
  childAccountIds: string[];
  sourcePrimaryDomain: string | null;
  createdAliasId: string | null;
};

export async function mergeAccounts(
  db: PrismaClient,
  actor: Actor,
  input: { sourceAccountId: string; targetAccountId: string },
): Promise<{ mergeId: string }> {
  assertPermission(actor, "account:merge");
  if (input.sourceAccountId === input.targetAccountId) {
    throw new ValidationError("Cannot merge an account into itself");
  }

  const [source, target] = await Promise.all([
    db.account.findUnique({ where: { id: input.sourceAccountId } }),
    db.account.findUnique({ where: { id: input.targetAccountId } }),
  ]);
  if (source === null || target === null) throw new NotFoundError("Account not found");
  if (source.mergedIntoId !== null) throw new ValidationError("Source is already merged");
  if (target.mergedIntoId !== null) throw new ValidationError("Target is already merged");

  const result = await withAudit<{ mergeId: string }>(
    db,
    actor,
    (merged) => ({
      entityType: "Account",
      entityId: input.sourceAccountId,
      action: "merge",
      before: { mergedIntoId: null, primaryDomain: source.primaryDomain },
      after: { mergedIntoId: input.targetAccountId, mergeId: merged.mergeId },
    }),
    async (tx) => {
      const contacts = await tx.contact.findMany({
        where: { accountId: source.id }, select: { id: true },
      });
      const aliases = await tx.accountAlias.findMany({
        where: { accountId: source.id }, select: { id: true },
      });
      const children = await tx.account.findMany({
        where: { parentAccountId: source.id }, select: { id: true },
      });

      await tx.contact.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
      await tx.accountAlias.updateMany({ where: { accountId: source.id }, data: { accountId: target.id } });
      await tx.account.updateMany({
        where: { parentAccountId: source.id }, data: { parentAccountId: target.id },
      });

      // The source's domain must keep resolving, now to the target. Freeing it
      // from the source first respects the unique constraint on primaryDomain.
      let createdAliasId: string | null = null;
      if (source.primaryDomain !== null) {
        await tx.account.update({ where: { id: source.id }, data: { primaryDomain: null } });
        const alias = await tx.accountAlias.create({
          data: { accountId: target.id, value: source.primaryDomain, type: "domain" },
        });
        createdAliasId = alias.id;
      }

      await tx.account.update({
        where: { id: source.id },
        data: { mergedIntoId: target.id, updatedById: actor.userId },
      });

      const moved: MovedRecords = {
        contactIds: contacts.map((c) => c.id),
        aliasIds: aliases.map((a) => a.id),
        childAccountIds: children.map((c) => c.id),
        sourcePrimaryDomain: source.primaryDomain,
        createdAliasId,
      };

      const merge = await tx.accountMerge.create({
        data: {
          sourceAccountId: source.id,
          targetAccountId: target.id,
          movedJson: moved,
          mergedById: actor.userId,
        },
      });

      return { mergeId: merge.id };
    },
  );

  return result;
}

export async function unmergeAccounts(
  db: PrismaClient,
  actor: Actor,
  mergeId: string,
): Promise<void> {
  assertPermission(actor, "account:merge");

  const merge = await db.accountMerge.findUnique({ where: { id: mergeId } });
  if (merge === null) throw new NotFoundError("Merge record not found");
  if (merge.reversedAt !== null) throw new ValidationError("Merge is already reversed");

  const elapsedHours = (Date.now() - merge.mergedAt.getTime()) / 3_600_000;
  if (elapsedHours > ACCOUNT_MERGE_REVERSAL_HOURS) {
    throw new ValidationError(
      `Merges are reversible for ${ACCOUNT_MERGE_REVERSAL_HOURS} hours; this one is ${Math.floor(elapsedHours)} hours old`,
    );
  }

  const moved = merge.movedJson as MovedRecords;

  await withAudit(
    db,
    actor,
    {
      entityType: "Account",
      entityId: merge.sourceAccountId,
      action: "unmerge",
      after: { mergeId },
    },
    async (tx) => {
      if (moved.createdAliasId !== null) {
        await tx.accountAlias.delete({ where: { id: moved.createdAliasId } });
      }
      await tx.contact.updateMany({
        where: { id: { in: moved.contactIds } }, data: { accountId: merge.sourceAccountId },
      });
      await tx.accountAlias.updateMany({
        where: { id: { in: moved.aliasIds } }, data: { accountId: merge.sourceAccountId },
      });
      await tx.account.updateMany({
        where: { id: { in: moved.childAccountIds } }, data: { parentAccountId: merge.sourceAccountId },
      });
      await tx.account.update({
        where: { id: merge.sourceAccountId },
        data: { mergedIntoId: null, primaryDomain: moved.sourcePrimaryDomain },
      });
      await tx.accountMerge.update({
        where: { id: mergeId },
        data: { reversedAt: new Date(), reversedById: actor.userId },
      });
    },
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/account-merge.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add reversible account merge with moved-record tracking"
```

---

### Task 14: Channel type schema, qualification forms and the reject reason vocabulary

Channel types are data, not code (PRD §6.2). This task builds the tables and the DEP-6 seed data; publishing and versioning are Task 15.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/seed/funnel-stages.ts`, `prisma/seed/channel-types.ts`, `prisma/seed/reject-reasons.ts`, `src/lib/channel-types/crud.ts`
- Modify: `prisma/seed/index.ts`
- Test: `tests/channel-types-crud.test.ts`

**Interfaces:**
- Consumes: `Actor`, `assertPermission` (Task 7), `withAudit` (Task 8).
- Produces:
  - Models `FunnelStage`, `ChannelType`, `ChannelTypeVersion`, `QualificationForm`, `QualificationQuestion`, `RejectReason`.
  - `createChannelType(db, actor, input): Promise<ChannelType>`
  - `updateChannelType(db, actor, id, input): Promise<ChannelType>`
  - `deactivateChannelType(db, actor, id): Promise<ChannelType>`
  - `seedFunnelStages(db)`, `seedChannelTypes(db)`, `seedRejectReasons(db)`.

- [ ] **Step 1: Add the models**

```prisma
// prisma/schema.prisma — append
enum MetricMode {
  event
  aggregate
}

enum PricingUnit {
  CPL
  CPM
  CPA
  flat
}

enum QuestionType {
  single
  multi
  text
  boolean
  date
}

enum RejectReasonCategory {
  dataQuality
  icpMismatch
  suppression
  duplicate
  consent
  qualification
  contactability
}

model FunnelStage {
  id        String        @id @default(cuid())
  code      String        @unique
  name      String
  sortOrder Int
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  channelTypes ChannelType[]
}

model ChannelType {
  id                          String      @id @default(cuid())
  code                        String      @unique
  name                        String
  funnelStageId               String
  producesLeads               Boolean     @default(true)
  requiresAsset               Boolean     @default(false)
  metricMode                  MetricMode  @default(event)
  allowedMetricFieldsJson     Json        @default("[]")
  pricingUnit                 PricingUnit
  defaultQualificationFormId  String?
  verificationRuleSetId       String?
  requiresTeleVerification    Boolean     @default(false)
  verificationSlaBusinessDays Int?
  isActive                    Boolean     @default(true)
  currentVersion              Int         @default(0)
  createdAt                   DateTime    @default(now())
  updatedAt                   DateTime    @updatedAt
  createdById                 String?
  updatedById                 String?

  funnelStage              FunnelStage          @relation(fields: [funnelStageId], references: [id])
  defaultQualificationForm QualificationForm?   @relation(fields: [defaultQualificationFormId], references: [id])
  versions                 ChannelTypeVersion[]

  @@index([funnelStageId])
}

model ChannelTypeVersion {
  id             String   @id @default(cuid())
  channelTypeId  String
  version        Int
  definitionJson Json
  publishedAt    DateTime @default(now())
  publishedById  String
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  channelType ChannelType @relation(fields: [channelTypeId], references: [id])

  @@unique([channelTypeId, version])
}

model QualificationForm {
  id        String   @id @default(cuid())
  name      String
  version   Int      @default(1)
  isActive  Boolean  @default(true)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  questions    QualificationQuestion[]
  channelTypes ChannelType[]
}

model QualificationQuestion {
  id                    String       @id @default(cuid())
  formId                String
  sortOrder             Int
  text                  String
  type                  QuestionType
  optionsJson           Json?
  isRequired            Boolean      @default(true)
  isQualifying          Boolean      @default(false)
  acceptableAnswersJson Json?
  createdAt             DateTime     @default(now())
  updatedAt             DateTime     @updatedAt

  form QualificationForm @relation(fields: [formId], references: [id])

  @@unique([formId, sortOrder])
  @@index([formId])
}

model RejectReason {
  id                   String               @id @default(cuid())
  code                 String               @unique
  label                String
  category             RejectReasonCategory
  isPartnerReplaceable Boolean
  isActive             Boolean              @default(true)
  createdAt            DateTime             @default(now())
  updatedAt            DateTime             @updatedAt
}
```

Run: `pnpm prisma migrate dev --name add_channel_types_and_reject_reasons`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/channel-types-crud.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { seedRejectReasons } from "../prisma/seed/reject-reasons";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createChannelType, deactivateChannelType } from "@/lib/channel-types/crud";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function actorWithRole(role: string) {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, role);
  return loadActor(db, user.id);
}

describe("seed data (DEP-6)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("seeds the four funnel stages in order", async () => {
    const db = testDb();
    await seedFunnelStages(db);
    const stages = await db.funnelStage.findMany({ orderBy: { sortOrder: "asc" } });
    expect(stages.map((s) => s.code)).toEqual(["PROGRAMMATIC", "TOFU", "MOFU", "BOFU"]);
  });

  it("seeds base channel types bound to their stages", async () => {
    const db = testDb();
    await seedFunnelStages(db);
    await seedChannelTypes(db);

    const programmatic = await db.channelType.findUniqueOrThrow({
      where: { code: "PROGRAMMATIC_DISPLAY" }, include: { funnelStage: true },
    });
    expect(programmatic.producesLeads).toBe(false);
    expect(programmatic.requiresAsset).toBe(false);
    expect(programmatic.metricMode).toBe("aggregate");
    expect(programmatic.pricingUnit).toBe("CPM");
    expect(programmatic.funnelStage.code).toBe("PROGRAMMATIC");

    const contentSyndication = await db.channelType.findUniqueOrThrow({
      where: { code: "CONTENT_SYNDICATION" },
    });
    expect(contentSyndication.requiresAsset).toBe(true);
    expect(contentSyndication.metricMode).toBe("event");
    expect(contentSyndication.pricingUnit).toBe("CPL");
  });

  it("seeds a reject reason vocabulary marking which reasons are replaceable", async () => {
    const db = testDb();
    await seedRejectReasons(db);

    const total = await db.rejectReason.count();
    expect(total).toBeGreaterThanOrEqual(10);

    const duplicate = await db.rejectReason.findUniqueOrThrow({ where: { code: "DUPLICATE_IN_CAMPAIGN" } });
    expect(duplicate.isPartnerReplaceable).toBe(true);
    expect(duplicate.category).toBe("duplicate");

    const suppressed = await db.rejectReason.findUniqueOrThrow({ where: { code: "SUPPRESSED_ACCOUNT" } });
    expect(suppressed.isPartnerReplaceable).toBe(true);

    const consent = await db.rejectReason.findUniqueOrThrow({ where: { code: "CONSENT_MISSING" } });
    expect(consent.isPartnerReplaceable).toBe(false);
  });
});

describe("channel type CRUD (FR-CT-1, FR-CT-4)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("lets a Super Admin create a channel type with no deployment", async () => {
    const db = testDb();
    const actor = await actorWithRole("SUPER_ADMIN");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });

    const created = await createChannelType(db, actor, {
      code: "MQL_3Q_TELE",
      name: "MQL – 3 questions + tele-verification",
      funnelStageId: stage.id,
      producesLeads: true,
      requiresAsset: true,
      metricMode: "event",
      pricingUnit: "CPL",
      requiresTeleVerification: true,
      allowedMetricFields: [],
    });

    expect(created.code).toBe("MQL_3Q_TELE");
    expect(created.currentVersion).toBe(0);
    expect(created.isActive).toBe(true);
  });

  it("refuses a Campaign Manager", async () => {
    const db = testDb();
    const actor = await actorWithRole("CAMPAIGN_MANAGER");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });

    await expect(
      createChannelType(db, actor, {
        code: "X", name: "X", funnelStageId: stage.id, producesLeads: true,
        requiresAsset: false, metricMode: "event", pricingUnit: "CPL",
        requiresTeleVerification: false, allowedMetricFields: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects a duplicate code", async () => {
    const db = testDb();
    const actor = await actorWithRole("SUPER_ADMIN");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const input = {
      code: "DUP", name: "Dup", funnelStageId: stage.id, producesLeads: true,
      requiresAsset: false, metricMode: "event" as const, pricingUnit: "CPL" as const,
      requiresTeleVerification: false, allowedMetricFields: [],
    };
    await createChannelType(db, actor, input);

    await expect(createChannelType(db, actor, input)).rejects.toBeInstanceOf(ValidationError);
  });

  it("deactivates rather than deletes (FR-CT-4)", async () => {
    const db = testDb();
    const actor = await actorWithRole("SUPER_ADMIN");
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "TOFU" } });
    const created = await createChannelType(db, actor, {
      code: "TEMP", name: "Temp", funnelStageId: stage.id, producesLeads: true,
      requiresAsset: false, metricMode: "event", pricingUnit: "CPL",
      requiresTeleVerification: false, allowedMetricFields: [],
    });

    const deactivated = await deactivateChannelType(db, actor, created.id);

    expect(deactivated.isActive).toBe(false);
    expect(await db.channelType.count({ where: { id: created.id } })).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/channel-types-crud.test.ts`
Expected: FAIL — the seed modules and `@/lib/channel-types/crud` do not exist.

- [ ] **Step 4: Write the seeds**

```typescript
// prisma/seed/funnel-stages.ts
import type { PrismaClient } from "@prisma/client";

export const FUNNEL_STAGES = [
  { code: "PROGRAMMATIC", name: "Programmatic", sortOrder: 1 },
  { code: "TOFU", name: "Top of funnel", sortOrder: 2 },
  { code: "MOFU", name: "Middle of funnel", sortOrder: 3 },
  { code: "BOFU", name: "Bottom of funnel", sortOrder: 4 },
] as const;

export async function seedFunnelStages(db: PrismaClient): Promise<void> {
  for (const stage of FUNNEL_STAGES) {
    await db.funnelStage.upsert({
      where: { code: stage.code },
      update: { name: stage.name, sortOrder: stage.sortOrder },
      create: stage,
    });
  }
}
```

```typescript
// prisma/seed/channel-types.ts
import type { MetricMode, PricingUnit, PrismaClient } from "@prisma/client";

type Seed = {
  code: string;
  name: string;
  stageCode: string;
  producesLeads: boolean;
  requiresAsset: boolean;
  metricMode: MetricMode;
  pricingUnit: PricingUnit;
  requiresTeleVerification: boolean;
  allowedMetricFields: string[];
};

export const BASE_CHANNEL_TYPES: readonly Seed[] = [
  {
    code: "PROGRAMMATIC_DISPLAY", name: "Programmatic display", stageCode: "PROGRAMMATIC",
    producesLeads: false, requiresAsset: false, metricMode: "aggregate", pricingUnit: "CPM",
    requiresTeleVerification: false, allowedMetricFields: ["impressions", "clicks", "spend"],
  },
  {
    code: "CONTENT_SYNDICATION", name: "Content syndication", stageCode: "TOFU",
    producesLeads: true, requiresAsset: true, metricMode: "event", pricingUnit: "CPL",
    requiresTeleVerification: false, allowedMetricFields: [],
  },
  {
    code: "MQL", name: "Marketing qualified lead", stageCode: "MOFU",
    producesLeads: true, requiresAsset: true, metricMode: "event", pricingUnit: "CPL",
    requiresTeleVerification: false, allowedMetricFields: [],
  },
  {
    code: "HQL_TELE", name: "Highly qualified lead with tele-verification", stageCode: "MOFU",
    producesLeads: true, requiresAsset: true, metricMode: "event", pricingUnit: "CPL",
    requiresTeleVerification: true, allowedMetricFields: [],
  },
  {
    code: "APPOINTMENT_GENERATION", name: "Appointment generation", stageCode: "BOFU",
    producesLeads: true, requiresAsset: false, metricMode: "event", pricingUnit: "CPA",
    requiresTeleVerification: true, allowedMetricFields: [],
  },
];

export async function seedChannelTypes(db: PrismaClient): Promise<void> {
  for (const seed of BASE_CHANNEL_TYPES) {
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: seed.stageCode } });
    await db.channelType.upsert({
      where: { code: seed.code },
      update: {},
      create: {
        code: seed.code,
        name: seed.name,
        funnelStageId: stage.id,
        producesLeads: seed.producesLeads,
        requiresAsset: seed.requiresAsset,
        metricMode: seed.metricMode,
        pricingUnit: seed.pricingUnit,
        requiresTeleVerification: seed.requiresTeleVerification,
        allowedMetricFieldsJson: seed.allowedMetricFields,
      },
    });
  }
}
```

```typescript
// prisma/seed/reject-reasons.ts
import type { PrismaClient, RejectReasonCategory } from "@prisma/client";

type Seed = {
  code: string;
  label: string;
  category: RejectReasonCategory;
  isPartnerReplaceable: boolean;
};

/**
 * FR-IN-5: free-text reject reasons are not permitted, so this vocabulary is
 * the whole set. isPartnerReplaceable drives FR-VF-4's replacement obligation:
 * a partner owes a replacement only where the failure was theirs to avoid.
 */
export const REJECT_REASONS: readonly Seed[] = [
  { code: "MISSING_REQUIRED_FIELD", label: "Required field missing", category: "dataQuality", isPartnerReplaceable: true },
  { code: "INVALID_EMAIL_FORMAT", label: "Invalid email format", category: "dataQuality", isPartnerReplaceable: true },
  { code: "INVALID_PHONE_FORMAT", label: "Invalid phone format", category: "dataQuality", isPartnerReplaceable: true },
  { code: "GENERIC_EMAIL_DOMAIN", label: "Personal or generic email domain", category: "dataQuality", isPartnerReplaceable: true },
  { code: "ICP_INDUSTRY_MISMATCH", label: "Industry outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "ICP_SIZE_MISMATCH", label: "Company size outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "ICP_GEO_MISMATCH", label: "Geography outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "ICP_SENIORITY_MISMATCH", label: "Seniority or title outside ICP", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "NOT_ON_TARGET_ACCOUNT_LIST", label: "Account not on the target account list", category: "icpMismatch", isPartnerReplaceable: true },
  { code: "SUPPRESSED_ACCOUNT", label: "Account is suppressed", category: "suppression", isPartnerReplaceable: true },
  { code: "SUPPRESSED_CONTACT", label: "Contact is suppressed", category: "suppression", isPartnerReplaceable: true },
  { code: "DO_NOT_CONTACT", label: "On the client do-not-contact list", category: "suppression", isPartnerReplaceable: true },
  { code: "DUPLICATE_IN_CAMPAIGN", label: "Duplicate within the campaign", category: "duplicate", isPartnerReplaceable: true },
  { code: "DUPLICATE_CROSS_CAMPAIGN", label: "Duplicate across the client's live campaigns", category: "duplicate", isPartnerReplaceable: true },
  { code: "ACCOUNT_CAP_REACHED", label: "Per-account lead cap reached", category: "duplicate", isPartnerReplaceable: false },
  { code: "ALLOCATION_CAP_EXCEEDED", label: "Allocation cap exceeded", category: "duplicate", isPartnerReplaceable: false },
  { code: "CONSENT_MISSING", label: "Consent evidence missing", category: "consent", isPartnerReplaceable: false },
  { code: "CONSENT_INVALID", label: "Consent evidence incomplete or invalid", category: "consent", isPartnerReplaceable: false },
  { code: "QUALIFYING_ANSWER_UNACCEPTABLE", label: "Answer outside acceptable values", category: "qualification", isPartnerReplaceable: true },
  { code: "QUALIFYING_ANSWER_MISSING", label: "Qualifying question unanswered", category: "qualification", isPartnerReplaceable: true },
  { code: "TELE_UNREACHABLE", label: "Unreachable on tele-verification", category: "contactability", isPartnerReplaceable: true },
  { code: "TELE_DENIED_INTEREST", label: "Denied interest on tele-verification", category: "contactability", isPartnerReplaceable: true },
];

export async function seedRejectReasons(db: PrismaClient): Promise<void> {
  for (const reason of REJECT_REASONS) {
    await db.rejectReason.upsert({
      where: { code: reason.code },
      update: { label: reason.label, category: reason.category, isPartnerReplaceable: reason.isPartnerReplaceable },
      create: reason,
    });
  }
}
```

Add all three to `prisma/seed/index.ts` after `seedSettings(db)`:

```typescript
import { seedFunnelStages } from "./funnel-stages";
import { seedChannelTypes } from "./channel-types";
import { seedRejectReasons } from "./reject-reasons";
// ...
  await seedFunnelStages(db);
  await seedChannelTypes(db);
  await seedRejectReasons(db);
```

- [ ] **Step 5: Write the CRUD module**

```typescript
// src/lib/channel-types/crud.ts
import type { ChannelType, MetricMode, PricingUnit, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type ChannelTypeInput = {
  code: string;
  name: string;
  funnelStageId: string;
  producesLeads: boolean;
  requiresAsset: boolean;
  metricMode: MetricMode;
  pricingUnit: PricingUnit;
  requiresTeleVerification: boolean;
  allowedMetricFields: string[];
  defaultQualificationFormId?: string;
  verificationSlaBusinessDays?: number;
};

export async function createChannelType(
  db: PrismaClient,
  actor: Actor,
  input: ChannelTypeInput,
): Promise<ChannelType> {
  assertPermission(actor, "channelType:write");

  const existing = await db.channelType.findUnique({ where: { code: input.code } });
  if (existing !== null) throw new ValidationError(`Channel type code already exists: ${input.code}`);

  const stage = await db.funnelStage.findUnique({ where: { id: input.funnelStageId } });
  if (stage === null) throw new NotFoundError("Funnel stage not found");

  if (input.metricMode === "aggregate" && input.allowedMetricFields.length === 0) {
    throw new ValidationError("An aggregate channel type must declare its metric fields");
  }

  return withAudit<ChannelType>(
    db,
    actor,
    (created) => ({
      entityType: "ChannelType", entityId: created.id, action: "create", after: input,
    }),
    (tx) =>
      tx.channelType.create({
        data: {
          code: input.code,
          name: input.name,
          funnelStageId: input.funnelStageId,
          producesLeads: input.producesLeads,
          requiresAsset: input.requiresAsset,
          metricMode: input.metricMode,
          pricingUnit: input.pricingUnit,
          requiresTeleVerification: input.requiresTeleVerification,
          allowedMetricFieldsJson: input.allowedMetricFields,
          defaultQualificationFormId: input.defaultQualificationFormId,
          verificationSlaBusinessDays: input.verificationSlaBusinessDays,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}

export async function updateChannelType(
  db: PrismaClient,
  actor: Actor,
  id: string,
  input: Partial<Omit<ChannelTypeInput, "code">>,
): Promise<ChannelType> {
  assertPermission(actor, "channelType:write");

  const before = await db.channelType.findUnique({ where: { id } });
  if (before === null) throw new NotFoundError("Channel type not found");

  return withAudit<ChannelType>(
    db,
    actor,
    { entityType: "ChannelType", entityId: id, action: "update", before, after: input },
    (tx) =>
      tx.channelType.update({
        where: { id },
        data: {
          name: input.name,
          funnelStageId: input.funnelStageId,
          producesLeads: input.producesLeads,
          requiresAsset: input.requiresAsset,
          metricMode: input.metricMode,
          pricingUnit: input.pricingUnit,
          requiresTeleVerification: input.requiresTeleVerification,
          allowedMetricFieldsJson: input.allowedMetricFields,
          defaultQualificationFormId: input.defaultQualificationFormId,
          verificationSlaBusinessDays: input.verificationSlaBusinessDays,
          updatedById: actor.userId,
        },
      }),
  );
}

/** FR-CT-4: a channel type is never deleted, only deactivated. */
export async function deactivateChannelType(
  db: PrismaClient,
  actor: Actor,
  id: string,
): Promise<ChannelType> {
  assertPermission(actor, "channelType:write");

  const before = await db.channelType.findUnique({ where: { id } });
  if (before === null) throw new NotFoundError("Channel type not found");

  return withAudit<ChannelType>(
    db,
    actor,
    { entityType: "ChannelType", entityId: id, action: "deactivate", before: { isActive: before.isActive }, after: { isActive: false } },
    (tx) => tx.channelType.update({ where: { id }, data: { isActive: false, updatedById: actor.userId } }),
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/channel-types-crud.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add channel type schema, crud and dep-6 seed data"
```

---

### Task 15: Channel type versioning

FR-CT-2: publishing a change creates a new `ChannelTypeVersion` and existing campaigns retain their bound version.

**Files:**
- Create: `src/lib/channel-types/versions.ts`
- Test: `tests/channel-type-versions.test.ts`

**Interfaces:**
- Consumes: Task 14's models and CRUD.
- Produces:
  - `type ChannelTypeDefinition` — the frozen shape written into `definitionJson`.
  - `buildDefinition(db, channelTypeId): Promise<ChannelTypeDefinition>`
  - `publishChannelTypeVersion(db, actor, channelTypeId): Promise<ChannelTypeVersion>` — requires `channelType:publish`.
  - `getPublishedVersion(db, channelTypeId, version): Promise<ChannelTypeVersion>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/channel-type-versions.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createChannelType, updateChannelType } from "@/lib/channel-types/crud";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import { ForbiddenError } from "@/lib/errors";

async function superAdmin() {
  const db = testDb();
  const org = await createOrganization(db, { isInternal: true, isClient: false });
  const user = await createUser(db, org.id, "SUPER_ADMIN");
  return loadActor(db, user.id);
}

async function newChannelType(actor: Awaited<ReturnType<typeof superAdmin>>) {
  const db = testDb();
  const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
  return createChannelType(db, actor, {
    code: `CT_${Math.random().toString(36).slice(2, 8)}`,
    name: "Test channel type",
    funnelStageId: stage.id,
    producesLeads: true,
    requiresAsset: true,
    metricMode: "event",
    pricingUnit: "CPL",
    requiresTeleVerification: false,
    allowedMetricFields: [],
  });
}

describe("channel type versioning (FR-CT-2)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("publishes version 1 with a full frozen definition", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);

    const version = await publishChannelTypeVersion(db, actor, channelType.id);

    expect(version.version).toBe(1);
    const definition = version.definitionJson as Record<string, unknown>;
    expect(definition.code).toBe(channelType.code);
    expect(definition.pricingUnit).toBe("CPL");
    expect(definition.requiresAsset).toBe(true);
    expect(definition.questions).toEqual([]);
  });

  it("increments the version and leaves earlier versions untouched", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    const v1 = await publishChannelTypeVersion(db, actor, channelType.id);

    await updateChannelType(db, actor, channelType.id, { requiresTeleVerification: true });
    const v2 = await publishChannelTypeVersion(db, actor, channelType.id);

    expect(v2.version).toBe(2);
    const frozenV1 = await db.channelTypeVersion.findUniqueOrThrow({ where: { id: v1.id } });
    expect((frozenV1.definitionJson as Record<string, unknown>).requiresTeleVerification).toBe(false);
    expect((v2.definitionJson as Record<string, unknown>).requiresTeleVerification).toBe(true);
  });

  it("updates currentVersion on the channel type", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    await publishChannelTypeVersion(db, actor, channelType.id);
    await publishChannelTypeVersion(db, actor, channelType.id);

    const reloaded = await db.channelType.findUniqueOrThrow({ where: { id: channelType.id } });
    expect(reloaded.currentVersion).toBe(2);
  });

  it("freezes the qualification questions into the definition", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    const form = await db.qualificationForm.create({ data: { name: "Three questions" } });
    await db.qualificationQuestion.create({
      data: {
        formId: form.id, sortOrder: 1, text: "What is your budget?", type: "single",
        optionsJson: ["<10k", "10-50k", ">50k"], isQualifying: true,
        acceptableAnswersJson: ["10-50k", ">50k"],
      },
    });
    await updateChannelType(db, actor, channelType.id, { defaultQualificationFormId: form.id });

    const version = await publishChannelTypeVersion(db, actor, channelType.id);

    const questions = (version.definitionJson as { questions: Array<Record<string, unknown>> }).questions;
    expect(questions).toHaveLength(1);
    expect(questions[0]?.text).toBe("What is your budget?");
    expect(questions[0]?.acceptableAnswers).toEqual(["10-50k", ">50k"]);
  });

  it("requires channelType:publish", async () => {
    const db = testDb();
    const admin = await superAdmin();
    const channelType = await newChannelType(admin);
    const org = await createOrganization(db, { isInternal: true, isClient: false });
    const user = await createUser(db, org.id, "CAMPAIGN_MANAGER");
    const manager = await loadActor(db, user.id);

    await expect(publishChannelTypeVersion(db, manager, channelType.id))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("audits the publish", async () => {
    const db = testDb();
    const actor = await superAdmin();
    const channelType = await newChannelType(actor);
    await publishChannelTypeVersion(db, actor, channelType.id);

    const entry = await db.auditLog.findFirstOrThrow({
      where: { entityType: "ChannelTypeVersion", action: "publish" },
    });
    expect(entry.actorUserId).toBe(actor.userId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/channel-type-versions.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/channel-types/versions"`.

- [ ] **Step 3: Write the versioning module**

```typescript
// src/lib/channel-types/versions.ts
import type { ChannelTypeVersion, PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type FrozenQuestion = {
  id: string;
  sortOrder: number;
  text: string;
  type: string;
  options: unknown;
  isRequired: boolean;
  isQualifying: boolean;
  acceptableAnswers: unknown;
};

export type ChannelTypeDefinition = {
  channelTypeId: string;
  code: string;
  name: string;
  funnelStageCode: string;
  producesLeads: boolean;
  requiresAsset: boolean;
  metricMode: string;
  allowedMetricFields: unknown;
  pricingUnit: string;
  requiresTeleVerification: boolean;
  verificationSlaBusinessDays: number | null;
  qualificationFormId: string | null;
  questions: FrozenQuestion[];
};

export async function buildDefinition(
  db: PrismaClient,
  channelTypeId: string,
): Promise<ChannelTypeDefinition> {
  const channelType = await db.channelType.findUnique({
    where: { id: channelTypeId },
    include: {
      funnelStage: true,
      defaultQualificationForm: { include: { questions: { orderBy: { sortOrder: "asc" } } } },
    },
  });
  if (channelType === null) throw new NotFoundError("Channel type not found");

  return {
    channelTypeId: channelType.id,
    code: channelType.code,
    name: channelType.name,
    funnelStageCode: channelType.funnelStage.code,
    producesLeads: channelType.producesLeads,
    requiresAsset: channelType.requiresAsset,
    metricMode: channelType.metricMode,
    allowedMetricFields: channelType.allowedMetricFieldsJson,
    pricingUnit: channelType.pricingUnit,
    requiresTeleVerification: channelType.requiresTeleVerification,
    verificationSlaBusinessDays: channelType.verificationSlaBusinessDays,
    qualificationFormId: channelType.defaultQualificationFormId,
    questions: (channelType.defaultQualificationForm?.questions ?? []).map((q) => ({
      id: q.id,
      sortOrder: q.sortOrder,
      text: q.text,
      type: q.type,
      options: q.optionsJson,
      isRequired: q.isRequired,
      isQualifying: q.isQualifying,
      acceptableAnswers: q.acceptableAnswersJson,
    })),
  };
}

/**
 * FR-CT-2: publishing snapshots the whole definition. Campaigns bind to a
 * version row, so a later edit to the channel type cannot reach them.
 */
export async function publishChannelTypeVersion(
  db: PrismaClient,
  actor: Actor,
  channelTypeId: string,
): Promise<ChannelTypeVersion> {
  assertPermission(actor, "channelType:publish");

  const definition = await buildDefinition(db, channelTypeId);
  const channelType = await db.channelType.findUniqueOrThrow({ where: { id: channelTypeId } });
  const nextVersion = channelType.currentVersion + 1;

  return withAudit<ChannelTypeVersion>(
    db,
    actor,
    (created) => ({
      entityType: "ChannelTypeVersion",
      entityId: created.id,
      action: "publish",
      after: { channelTypeId, version: nextVersion },
    }),
    async (tx) => {
      const version = await tx.channelTypeVersion.create({
        data: {
          channelTypeId,
          version: nextVersion,
          definitionJson: definition,
          publishedById: actor.userId,
        },
      });
      await tx.channelType.update({
        where: { id: channelTypeId },
        data: { currentVersion: nextVersion, updatedById: actor.userId },
      });
      return version;
    },
  );
}

export async function getPublishedVersion(
  db: PrismaClient,
  channelTypeId: string,
  version: number,
): Promise<ChannelTypeVersion> {
  const row = await db.channelTypeVersion.findUnique({
    where: { channelTypeId_version: { channelTypeId, version } },
  });
  if (row === null) throw new NotFoundError(`Channel type version ${version} not found`);
  return row;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/channel-type-versions.test.ts`
Expected: PASS — all six tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add channel type version publishing with frozen definitions"
```

---

### Task 16: Campaign, ICP criteria, lead field spec and campaign channels

**Files:**
- Create: `src/lib/campaigns/crud.ts`
- Modify: `prisma/schema.prisma`
- Test: `tests/campaigns-crud.test.ts`

**Interfaces:**
- Consumes: `Actor` (Task 7), `withAudit` (Task 8), `toMinorUnits` (Task 5), `publishChannelTypeVersion` (Task 15).
- Produces:
  - Models `Campaign`, `IcpCriterion`, `LeadFieldSpec`, `CampaignChannel`, `CampaignApproval`.
  - `createCampaign(db, actor, input): Promise<Campaign>`
  - `setIcpCriteria(db, actor, campaignId, criteria): Promise<void>`
  - `setLeadFieldSpec(db, actor, campaignId, fields): Promise<void>`
  - `addCampaignChannel(db, actor, campaignId, input): Promise<CampaignChannel>`
  - `getCampaignForActor(db, actor, campaignId): Promise<CampaignWithConfig>` — enforces AUTH-9.

- [ ] **Step 1: Add the campaign models**

`clientUnitPriceMinor` and `costBudgetMinor` are `BigInt` with an explicit `currency` — CUR-1 and CUR-6 apply now even though commercials are Phase 5.

```prisma
// prisma/schema.prisma — append
enum CampaignStatus {
  draft
  pendingInternalApproval
  pendingClientApproval
  scheduled
  live
  paused
  completed
  cancelled
}

enum IcpDimension {
  industry
  employeeRange
  revenueRange
  country
  region
  jobFunction
  seniority
  jobTitle
  custom
}

enum IcpOperator {
  in
  notIn
  between
  contains
}

enum LeadFieldDataType {
  string
  number
  boolean
  date
  email
  phone
  url
}

enum ApprovalType {
  internal
  client
}

enum ApprovalDecision {
  approved
  rejected
}

enum CampaignChannelStatus {
  draft
  active
  paused
  completed
}

model Campaign {
  id                         String         @id @default(cuid())
  clientOrganizationId       String
  name                       String
  code                       String         @unique
  status                     CampaignStatus @default(draft)
  startDate                  DateTime       @db.Date
  endDate                    DateTime       @db.Date
  currency                   String         @db.Char(3)
  defaultMaxLeadsPerAccount  Int?
  clonedFromCampaignId       String?
  approvedSnapshotId         String?
  advisoryTalMatch           Boolean        @default(false)
  advisoryIcpMatch           Boolean        @default(false)
  deletedAt                  DateTime?
  createdAt                  DateTime       @default(now())
  updatedAt                  DateTime       @updatedAt
  createdById                String?
  updatedById                String?

  clientOrganization Organization        @relation(fields: [clientOrganizationId], references: [id])
  clonedFrom         Campaign?           @relation("CampaignClone", fields: [clonedFromCampaignId], references: [id])
  clones             Campaign[]          @relation("CampaignClone")
  icpCriteria        IcpCriterion[]
  leadFieldSpecs     LeadFieldSpec[]
  channels           CampaignChannel[]
  approvals          CampaignApproval[]
  statusHistory      CampaignStatusHistory[]

  @@index([clientOrganizationId, status])
  @@index([status, startDate])
}

model IcpCriterion {
  id          String       @id @default(cuid())
  campaignId  String
  dimension   IcpDimension
  operator    IcpOperator
  valuesJson  Json
  isMandatory Boolean      @default(true)
  createdAt   DateTime     @default(now())
  updatedAt   DateTime     @updatedAt

  campaign Campaign @relation(fields: [campaignId], references: [id])

  @@index([campaignId])
}

model LeadFieldSpec {
  id                String            @id @default(cuid())
  campaignId        String
  fieldKey          String
  label             String
  isRequired        Boolean           @default(true)
  dataType          LeadFieldDataType
  allowedValuesJson Json?
  validationPattern String?
  rejectIfMissing   Boolean           @default(true)
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  campaign Campaign @relation(fields: [campaignId], references: [id])

  @@unique([campaignId, fieldKey])
}

model CampaignChannel {
  id                   String                @id @default(cuid())
  campaignId           String
  channelTypeVersionId String
  contractedQuantity   Int
  clientUnitPriceMinor BigInt
  costBudgetMinor      BigInt?
  currency             String                @db.Char(3)
  startDate            DateTime              @db.Date
  endDate              DateTime              @db.Date
  status               CampaignChannelStatus @default(draft)
  qualificationFormId  String?
  createdAt            DateTime              @default(now())
  updatedAt            DateTime              @updatedAt
  createdById          String?
  updatedById          String?

  campaign           Campaign           @relation(fields: [campaignId], references: [id])
  channelTypeVersion ChannelTypeVersion @relation(fields: [channelTypeVersionId], references: [id])
  qualificationForm  QualificationForm? @relation(fields: [qualificationFormId], references: [id])

  @@index([campaignId])
}

model CampaignApproval {
  id                 String           @id @default(cuid())
  campaignId         String
  type               ApprovalType
  decision           ApprovalDecision
  decidedByUserId    String
  decidedAt          DateTime         @default(now())
  comments           String?
  configSnapshotJson Json?
  snapshotVersion    Int?
  createdAt          DateTime         @default(now())
  updatedAt          DateTime         @updatedAt

  campaign Campaign @relation(fields: [campaignId], references: [id])

  @@index([campaignId, type])
}

model CampaignStatusHistory {
  id              String         @id @default(cuid())
  campaignId      String
  fromStatus      CampaignStatus?
  toStatus        CampaignStatus
  changedByUserId String?
  changedAt       DateTime       @default(now())
  reason          String?

  campaign Campaign @relation(fields: [campaignId], references: [id])

  @@index([campaignId, changedAt])
}
```

Every relation field needs its other side, so add these three back-relations to models created in earlier tasks — Prisma refuses to validate the schema without them:

```prisma
// in model Organization, alongside `users` and `invitations`
  campaigns Campaign[]

// in model ChannelTypeVersion, alongside `channelType`
  campaignChannels CampaignChannel[]

// in model QualificationForm, alongside `questions` and `channelTypes`
  campaignChannels CampaignChannel[]
```

Run: `pnpm prisma migrate dev --name add_campaigns`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/campaigns-crud.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import {
  addCampaignChannel,
  createCampaign,
  getCampaignForActor,
  setIcpCriteria,
  setLeadFieldSpec,
} from "@/lib/campaigns/crud";
import { ForbiddenError, ValidationError } from "@/lib/errors";

async function setupCampaign() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const admin = await loadActor(db, (await createUser(db, internal.id, "SUPER_ADMIN")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true, defaultBillingCurrency: "USD" });
  const channelType = await db.channelType.findUniqueOrThrow({ where: { code: "CONTENT_SYNDICATION" } });
  const version = await publishChannelTypeVersion(db, admin, channelType.id);
  return { db, admin, manager, client, version };
}

describe("campaign configuration", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("creates a campaign in draft with a unique code", async () => {
    const { db, manager, client } = await setupCampaign();

    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id,
      name: "Q4 Security Whitepaper",
      code: "ACME-Q4-SEC",
      startDate: new Date("2026-10-01"),
      endDate: new Date("2026-12-31"),
      currency: "USD",
      defaultMaxLeadsPerAccount: 5,
    });

    expect(campaign.status).toBe("draft");
    expect(campaign.code).toBe("ACME-Q4-SEC");
    expect(campaign.defaultMaxLeadsPerAccount).toBe(5);
  });

  it("records the initial status history entry", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "C-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    const history = await db.campaignStatusHistory.findMany({ where: { campaignId: campaign.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe("draft");
    expect(history[0]?.fromStatus).toBeNull();
  });

  it("rejects a duplicate campaign code (NFR-D-2)", async () => {
    const { db, manager, client } = await setupCampaign();
    const input = {
      clientOrganizationId: client.id, name: "C", code: "DUP-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    };
    await createCampaign(db, manager, input);

    await expect(createCampaign(db, manager, { ...input, name: "C2" }))
      .rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an end date before the start date", async () => {
    const { db, manager, client } = await setupCampaign();

    await expect(
      createCampaign(db, manager, {
        clientOrganizationId: client.id, name: "C", code: "BAD-DATES",
        startDate: new Date("2026-12-31"), endDate: new Date("2026-10-01"), currency: "USD",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a campaign against an organisation that is not a client", async () => {
    const { db, manager } = await setupCampaign();
    const partnerOnly = await createOrganization(db, { isClient: false, isPartner: true });

    await expect(
      createCampaign(db, manager, {
        clientOrganizationId: partnerOnly.id, name: "C", code: "NOT-CLIENT",
        startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("replaces ICP criteria wholesale", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "ICP-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    await setIcpCriteria(db, manager, campaign.id, [
      { dimension: "industry", operator: "in", values: ["Software", "Fintech"], isMandatory: true },
      { dimension: "country", operator: "in", values: ["US", "GB"], isMandatory: true },
    ]);
    await setIcpCriteria(db, manager, campaign.id, [
      { dimension: "seniority", operator: "in", values: ["Director", "VP", "C-Level"], isMandatory: true },
    ]);

    const criteria = await db.icpCriterion.findMany({ where: { campaignId: campaign.id } });
    expect(criteria).toHaveLength(1);
    expect(criteria[0]?.dimension).toBe("seniority");
  });

  it("stores the lead field spec keyed per campaign", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "SPEC-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    await setLeadFieldSpec(db, manager, campaign.id, [
      { fieldKey: "email", label: "Work email", dataType: "email", isRequired: true, rejectIfMissing: true },
      { fieldKey: "jobTitle", label: "Job title", dataType: "string", isRequired: true, rejectIfMissing: true },
      { fieldKey: "employeeCount", label: "Employees", dataType: "number", isRequired: false, rejectIfMissing: false },
    ]);

    const spec = await db.leadFieldSpec.findMany({ where: { campaignId: campaign.id } });
    expect(spec).toHaveLength(3);
    expect(spec.find((f) => f.fieldKey === "email")?.dataType).toBe("email");
  });

  it("stores channel price in minor units with an explicit currency (CUR-1, CUR-6)", async () => {
    const { db, manager, client, version } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CH-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    const channel = await addCampaignChannel(db, manager, campaign.id, {
      channelTypeVersionId: version.id,
      contractedQuantity: 500,
      clientUnitPrice: "42.50",
      costBudget: "10000.00",
      currency: "USD",
      startDate: new Date("2026-10-01"),
      endDate: new Date("2026-12-31"),
    });

    expect(channel.clientUnitPriceMinor).toBe(4250n);
    expect(channel.costBudgetMinor).toBe(1_000_000n);
    expect(channel.currency).toBe("USD");
  });

  it("rejects a channel whose window falls outside the campaign flight", async () => {
    const { db, manager, client, version } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CH-2",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    await expect(
      addCampaignChannel(db, manager, campaign.id, {
        channelTypeVersionId: version.id, contractedQuantity: 100,
        clientUnitPrice: "10.00", currency: "USD",
        startDate: new Date("2026-09-01"), endDate: new Date("2026-12-31"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("blocks a client from reading another client's campaign (AUTH-9)", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "SCOPE-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const otherClient = await createOrganization(db, { isClient: true });
    const outsider = await loadActor(db, (await createUser(db, otherClient.id, "CLIENT_ADMIN")).id);

    await expect(getCampaignForActor(db, outsider, campaign.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lets the owning client read its own campaign", async () => {
    const { db, manager, client } = await setupCampaign();
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "SCOPE-2",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });
    const owner = await loadActor(db, (await createUser(db, client.id, "CLIENT_VIEWER")).id);

    const loaded = await getCampaignForActor(db, owner, campaign.id);
    expect(loaded.id).toBe(campaign.id);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/campaigns-crud.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/campaigns/crud"`.

- [ ] **Step 4: Write the campaign CRUD module**

```typescript
// src/lib/campaigns/crud.ts
import type {
  Campaign,
  CampaignChannel,
  IcpDimension,
  IcpOperator,
  LeadFieldDataType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { toMinorUnits } from "@/lib/money/currency";

export type CreateCampaignInput = {
  clientOrganizationId: string;
  name: string;
  code: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  defaultMaxLeadsPerAccount?: number;
  advisoryTalMatch?: boolean;
  advisoryIcpMatch?: boolean;
};

export async function createCampaign(
  db: PrismaClient,
  actor: Actor,
  input: CreateCampaignInput,
): Promise<Campaign> {
  assertPermission(actor, "campaign:write");
  assertOrganizationAccess(actor, input.clientOrganizationId);

  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new ValidationError("Campaign end date precedes its start date");
  }

  const client = await db.organization.findUnique({ where: { id: input.clientOrganizationId } });
  if (client === null || client.deletedAt !== null) throw new NotFoundError("Client organisation not found");
  if (!client.isClient) throw new ValidationError(`${client.name} is not a client organisation`);

  const duplicate = await db.campaign.findUnique({ where: { code: input.code } });
  if (duplicate !== null) throw new ValidationError(`Campaign code already exists: ${input.code}`);

  return withAudit<Campaign>(
    db,
    actor,
    (created) => ({
      entityType: "Campaign", entityId: created.id, action: "create",
      after: { code: created.code, clientOrganizationId: created.clientOrganizationId },
    }),
    async (tx) => {
      const campaign = await tx.campaign.create({
        data: {
          clientOrganizationId: input.clientOrganizationId,
          name: input.name,
          code: input.code,
          startDate: input.startDate,
          endDate: input.endDate,
          currency: input.currency,
          defaultMaxLeadsPerAccount: input.defaultMaxLeadsPerAccount,
          advisoryTalMatch: input.advisoryTalMatch ?? false,
          advisoryIcpMatch: input.advisoryIcpMatch ?? false,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });
      await tx.campaignStatusHistory.create({
        data: { campaignId: campaign.id, fromStatus: null, toStatus: "draft", changedByUserId: actor.userId },
      });
      return campaign;
    },
  );
}

async function assertDraftAndAccessible(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<Campaign> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);
  if (campaign.status !== "draft") {
    // FR-CS-2: snapshot fields on a non-draft campaign change only through a
    // re-approval cycle, which Task 19 owns.
    throw new ValidationError(`Campaign is ${campaign.status}; configuration edits require a draft`);
  }
  return campaign;
}

export type IcpCriterionInput = {
  dimension: IcpDimension;
  operator: IcpOperator;
  values: unknown[];
  isMandatory: boolean;
};

export async function setIcpCriteria(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  criteria: IcpCriterionInput[],
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertDraftAndAccessible(db, actor, campaignId);

  await withAudit(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "setIcpCriteria", after: criteria },
    async (tx) => {
      await tx.icpCriterion.deleteMany({ where: { campaignId } });
      for (const criterion of criteria) {
        await tx.icpCriterion.create({
          data: {
            campaignId,
            dimension: criterion.dimension,
            operator: criterion.operator,
            valuesJson: criterion.values as Prisma.InputJsonValue,
            isMandatory: criterion.isMandatory,
          },
        });
      }
    },
  );
}

export type LeadFieldSpecInput = {
  fieldKey: string;
  label: string;
  dataType: LeadFieldDataType;
  isRequired: boolean;
  rejectIfMissing: boolean;
  allowedValues?: unknown[];
  validationPattern?: string;
};

export async function setLeadFieldSpec(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  fields: LeadFieldSpecInput[],
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertDraftAndAccessible(db, actor, campaignId);

  const keys = new Set(fields.map((f) => f.fieldKey));
  if (keys.size !== fields.length) throw new ValidationError("Duplicate fieldKey in lead field spec");

  await withAudit(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "setLeadFieldSpec", after: fields },
    async (tx) => {
      await tx.leadFieldSpec.deleteMany({ where: { campaignId } });
      for (const field of fields) {
        await tx.leadFieldSpec.create({
          data: {
            campaignId,
            fieldKey: field.fieldKey,
            label: field.label,
            dataType: field.dataType,
            isRequired: field.isRequired,
            rejectIfMissing: field.rejectIfMissing,
            allowedValuesJson: field.allowedValues as Prisma.InputJsonValue | undefined,
            validationPattern: field.validationPattern,
          },
        });
      }
    },
  );
}

export type CampaignChannelInput = {
  channelTypeVersionId: string;
  contractedQuantity: number;
  clientUnitPrice: string;
  costBudget?: string;
  currency: string;
  startDate: Date;
  endDate: Date;
  qualificationFormId?: string;
};

export async function addCampaignChannel(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  input: CampaignChannelInput,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:write");
  const campaign = await assertDraftAndAccessible(db, actor, campaignId);

  if (input.contractedQuantity <= 0) throw new ValidationError("Contracted quantity must be positive");
  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new ValidationError("Channel end date precedes its start date");
  }
  if (
    input.startDate.getTime() < campaign.startDate.getTime() ||
    input.endDate.getTime() > campaign.endDate.getTime()
  ) {
    throw new ValidationError("Channel window must sit inside the campaign flight window");
  }

  const version = await db.channelTypeVersion.findUnique({ where: { id: input.channelTypeVersionId } });
  if (version === null) throw new NotFoundError("Channel type version not found");

  const clientUnitPriceMinor = toMinorUnits(input.clientUnitPrice, input.currency);
  const costBudgetMinor =
    input.costBudget === undefined ? null : toMinorUnits(input.costBudget, input.currency);

  return withAudit<CampaignChannel>(
    db,
    actor,
    (created) => ({
      entityType: "CampaignChannel", entityId: created.id, action: "create",
      after: { campaignId, contractedQuantity: input.contractedQuantity, currency: input.currency },
    }),
    (tx) =>
      tx.campaignChannel.create({
        data: {
          campaignId,
          channelTypeVersionId: input.channelTypeVersionId,
          contractedQuantity: input.contractedQuantity,
          clientUnitPriceMinor,
          costBudgetMinor,
          currency: input.currency,
          startDate: input.startDate,
          endDate: input.endDate,
          qualificationFormId: input.qualificationFormId,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      }),
  );
}

export async function getCampaignForActor(db: PrismaClient, actor: Actor, campaignId: string) {
  assertPermission(actor, "campaign:read");

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      icpCriteria: true,
      leadFieldSpecs: true,
      channels: { include: { channelTypeVersion: true } },
      approvals: { orderBy: { decidedAt: "desc" } },
    },
  });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");

  // AUTH-9: filtered at the query result, before anything is returned.
  assertOrganizationAccess(actor, campaign.clientOrganizationId);
  return campaign;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/campaigns-crud.test.ts`
Expected: PASS — all eleven tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add campaign, icp, lead field spec and campaign channel configuration"
```

---

### Task 17: CSV parsing and column mapping

Target account and suppression list uploads share this pipeline, and Phase 3's lead intake reuses it (FR-IN-2, FR-IN-3).

**Files:**
- Create: `src/lib/lists/csv.ts`
- Modify: `prisma/schema.prisma` (`ImportBatch`, `ImportError`)
- Test: `tests/csv-import.test.ts`

**Interfaces:**
- Consumes: nothing beyond Task 4's errors.
- Produces:
  - `parseDelimited(content: string): { headers: string[]; rows: Record<string, string>[] }`
  - `applyMapping(row, mapping: Record<string, string>): Record<string, string>` — maps source column → canonical key.
  - `type RowError = { rowNumber: number; field: string | null; rawValue: string | null; message: string }`
  - Models `ImportBatch`, `ImportError`.

- [ ] **Step 1: Add the import models**

```prisma
// prisma/schema.prisma — append
enum ImportType {
  targetAccounts
  suppression
  leads
  metrics
}

enum ImportStatus {
  pending
  processing
  completed
  failed
}

model ImportBatch {
  id             String       @id @default(cuid())
  type           ImportType
  uploadedById   String
  organizationId String
  fileKey        String?
  mappingJson    Json
  rowsTotal      Int          @default(0)
  rowsAccepted   Int          @default(0)
  rowsFailed     Int          @default(0)
  status         ImportStatus @default(pending)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  errors ImportError[]

  @@index([organizationId, type, createdAt])
}

model ImportError {
  id        String   @id @default(cuid())
  batchId   String
  rowNumber Int
  field     String?
  rawValue  String?
  message   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  batch ImportBatch @relation(fields: [batchId], references: [id])

  @@index([batchId, rowNumber])
}
```

Run: `pnpm prisma migrate dev --name add_import_batches`

- [ ] **Step 2: Install the CSV parser**

```bash
pnpm add papaparse
pnpm add -D @types/papaparse
```

- [ ] **Step 3: Write the failing test**

```typescript
// tests/csv-import.test.ts
import { describe, expect, it } from "vitest";
import { applyMapping, parseDelimited } from "@/lib/lists/csv";
import { ValidationError } from "@/lib/errors";

describe("parseDelimited", () => {
  it("returns headers and rows keyed by header", () => {
    const result = parseDelimited("Company,Domain\nAcme,acme.com\nGlobex,globex.com\n");

    expect(result.headers).toEqual(["Company", "Domain"]);
    expect(result.rows).toEqual([
      { Company: "Acme", Domain: "acme.com" },
      { Company: "Globex", Domain: "globex.com" },
    ]);
  });

  it("trims header whitespace and preserves cell whitespace for later normalisation", () => {
    const result = parseDelimited(" Company , Domain \nAcme  , acme.com\n");
    expect(result.headers).toEqual(["Company", "Domain"]);
    expect(result.rows[0]).toEqual({ Company: "Acme  ", Domain: " acme.com" });
  });

  it("handles quoted fields containing commas", () => {
    const result = parseDelimited('Company,Notes\n"Acme, Inc.",Renewal due\n');
    expect(result.rows[0]?.Company).toBe("Acme, Inc.");
  });

  it("skips fully blank lines", () => {
    const result = parseDelimited("Company\nAcme\n\nGlobex\n");
    expect(result.rows).toHaveLength(2);
  });

  it("rejects an empty file", () => {
    expect(() => parseDelimited("")).toThrow(ValidationError);
  });

  it("rejects duplicate headers", () => {
    expect(() => parseDelimited("Company,Company\nA,B\n")).toThrow(ValidationError);
  });
});

describe("applyMapping", () => {
  it("renames source columns to canonical keys", () => {
    const mapped = applyMapping(
      { "Company Name": "Acme", "Web Site": "acme.com", Ignored: "x" },
      { "Company Name": "rawName", "Web Site": "rawDomain" },
    );
    expect(mapped).toEqual({ rawName: "Acme", rawDomain: "acme.com" });
  });

  it("omits a mapped column absent from the row", () => {
    const mapped = applyMapping({ "Company Name": "Acme" }, { "Company Name": "rawName", "Web Site": "rawDomain" });
    expect(mapped).toEqual({ rawName: "Acme" });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm test tests/csv-import.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/lists/csv"`.

- [ ] **Step 5: Write the CSV module**

```typescript
// src/lib/lists/csv.ts
import Papa from "papaparse";
import { ValidationError } from "@/lib/errors";

export type ParsedFile = {
  headers: string[];
  rows: Record<string, string>[];
};

export type RowError = {
  rowNumber: number;
  field: string | null;
  rawValue: string | null;
  message: string;
};

export function parseDelimited(content: string): ParsedFile {
  if (content.trim() === "") throw new ValidationError("File is empty");

  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const headers = parsed.meta.fields ?? [];
  if (headers.length === 0) throw new ValidationError("File has no header row");

  const seen = new Set<string>();
  for (const header of headers) {
    if (seen.has(header)) throw new ValidationError(`Duplicate column header: ${header}`);
    seen.add(header);
  }

  return { headers, rows: parsed.data };
}

/** Maps source column headers to the canonical keys the importer expects. */
export function applyMapping(
  row: Record<string, string>,
  mapping: Record<string, string>,
): Record<string, string> {
  const mapped: Record<string, string> = {};
  for (const [sourceColumn, canonicalKey] of Object.entries(mapping)) {
    const value = row[sourceColumn];
    if (value !== undefined) mapped[canonicalKey] = value;
  }
  return mapped;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/csv-import.test.ts`
Expected: PASS — all eight tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add delimited file parsing and column mapping"
```

---

### Task 18: Target account lists with per-account cap overrides

Decisions 3 and 4 in the PRD: a campaign-level default cap, overridable per target account entry.

**Files:**
- Create: `src/lib/lists/target-accounts.ts`
- Modify: `prisma/schema.prisma`
- Test: `tests/target-accounts.test.ts`

**Interfaces:**
- Consumes: `resolveAccount` (Task 12), `parseDelimited`/`applyMapping` (Task 17), `withAudit` (Task 8).
- Produces:
  - Models `TargetAccountList`, `TargetAccountEntry`, `CampaignTargetAccountList`.
  - `importTargetAccountList(db, actor, input): Promise<{ batchId: string; listId: string; rowsAccepted: number; rowsFailed: number; errors: RowError[] }>`
  - `attachTargetAccountList(db, actor, campaignId, listId): Promise<void>`
  - `resolveAccountCap(db, campaignId, accountId): Promise<number | null>` — null means uncapped.

- [ ] **Step 1: Add the models**

```prisma
// prisma/schema.prisma — append
enum MatchStatus {
  matched
  unmatched
  ambiguous
}

model TargetAccountList {
  id                  String   @id @default(cuid())
  ownerOrganizationId String
  name                String
  isReusable          Boolean  @default(true)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
  createdById         String?
  updatedById         String?

  entries   TargetAccountEntry[]
  campaigns CampaignTargetAccountList[]

  @@index([ownerOrganizationId])
}

model TargetAccountEntry {
  id                         String      @id @default(cuid())
  listId                     String
  rawName                    String?
  rawDomain                  String?
  normalizedDomain           String?
  accountId                  String?
  matchStatus                MatchStatus @default(unmatched)
  candidateAccountIdsJson    Json?
  maxLeadsPerAccountOverride Int?
  createdAt                  DateTime    @default(now())
  updatedAt                  DateTime    @updatedAt

  list TargetAccountList @relation(fields: [listId], references: [id])

  @@index([listId, matchStatus])
  @@index([accountId])
}

model CampaignTargetAccountList {
  id         String   @id @default(cuid())
  campaignId String
  listId     String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  list TargetAccountList @relation(fields: [listId], references: [id])

  @@unique([campaignId, listId])
}
```

Run: `pnpm prisma migrate dev --name add_target_account_lists`

- [ ] **Step 2: Write the failing test**

```typescript
// tests/target-accounts.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount } from "@/lib/identity/account-resolution";
import { createCampaign } from "@/lib/campaigns/crud";
import {
  attachTargetAccountList,
  importTargetAccountList,
  resolveAccountCap,
} from "@/lib/lists/target-accounts";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  return { db, ops, manager, client };
}

const CSV = [
  "Company,Website,Max Leads",
  "Acme Inc,https://www.acme.com,3",
  "Globex,globex.com,",
  "Unknown Co,not-a-domain,",
].join("\n");

const MAPPING = { Company: "rawName", Website: "rawDomain", "Max Leads": "maxLeadsPerAccountOverride" };

describe("target account list import", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("matches entries to existing accounts by normalised domain", async () => {
    const { db, ops, client } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Q4 TAL", content: CSV, mapping: MAPPING,
    });

    const entries = await db.targetAccountEntry.findMany({ where: { listId: result.listId } });
    const acmeEntry = entries.find((e) => e.rawName === "Acme Inc");
    expect(acmeEntry?.matchStatus).toBe("matched");
    expect(acmeEntry?.accountId).toBe(acme.id);
    expect(acmeEntry?.normalizedDomain).toBe("acme.com");
  });

  it("leaves unmatched entries unmatched rather than creating accounts", async () => {
    const { db, ops, client } = await setup();

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Q4 TAL", content: CSV, mapping: MAPPING,
    });

    const entries = await db.targetAccountEntry.findMany({ where: { listId: result.listId } });
    expect(entries.filter((e) => e.matchStatus === "unmatched")).toHaveLength(3);
    expect(await db.account.count()).toBe(0);
  });

  it("stores the per-entry cap override", async () => {
    const { db, ops, client } = await setup();

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Q4 TAL", content: CSV, mapping: MAPPING,
    });

    const entries = await db.targetAccountEntry.findMany({ where: { listId: result.listId } });
    expect(entries.find((e) => e.rawName === "Acme Inc")?.maxLeadsPerAccountOverride).toBe(3);
    expect(entries.find((e) => e.rawName === "Globex")?.maxLeadsPerAccountOverride).toBeNull();
  });

  it("reports a per-row error for a row with neither name nor domain", async () => {
    const { db, ops, client } = await setup();
    const content = "Company,Website\nAcme,acme.com\n,\n";

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content,
      mapping: { Company: "rawName", Website: "rawDomain" },
    });

    expect(result.rowsAccepted).toBe(1);
    expect(result.rowsFailed).toBe(1);
    expect(result.errors[0]?.rowNumber).toBe(2);
    expect(result.errors[0]?.message).toMatch(/name or domain/i);

    const persisted = await db.importError.findMany({ where: { batchId: result.batchId } });
    expect(persisted).toHaveLength(1);
  });

  it("records an ambiguous match without picking a candidate", async () => {
    const { db, ops, client } = await setup();
    await createAccount(db, ops, { name: "Acme", domain: "acme-one.com", country: "US" });
    await createAccount(db, ops, { name: "Acme", domain: "acme-two.com", country: "US" });
    const content = "Company,Country\nAcme,US\n";

    const result = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content,
      mapping: { Company: "rawName", Country: "country" },
    });

    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { listId: result.listId } });
    expect(entry.matchStatus).toBe("ambiguous");
    expect(entry.accountId).toBeNull();
    expect(entry.candidateAccountIdsJson).toHaveLength(2);
  });
});

describe("resolveAccountCap (PRD decisions 3 and 4)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("prefers the entry override over the campaign default", async () => {
    const { db, ops, manager, client } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CAP-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
      currency: "USD", defaultMaxLeadsPerAccount: 5,
    });
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
    });
    await attachTargetAccountList(db, manager, campaign.id, listId);

    expect(await resolveAccountCap(db, campaign.id, acme.id)).toBe(3);
  });

  it("falls back to the campaign default when there is no override", async () => {
    const { db, ops, manager, client } = await setup();
    const globex = await createAccount(db, ops, { name: "Globex", domain: "globex.com", country: "US" });
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CAP-2",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
      currency: "USD", defaultMaxLeadsPerAccount: 5,
    });
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
    });
    await attachTargetAccountList(db, manager, campaign.id, listId);

    expect(await resolveAccountCap(db, campaign.id, globex.id)).toBe(5);
  });

  it("returns null when neither an override nor a campaign default is set", async () => {
    const { db, ops, manager, client } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const campaign = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "C", code: "CAP-3",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    expect(await resolveAccountCap(db, campaign.id, acme.id)).toBeNull();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/target-accounts.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/lists/target-accounts"`.

- [ ] **Step 4: Write the target account module**

```typescript
// src/lib/lists/target-accounts.ts
import type { Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { applyMapping, parseDelimited, type RowError } from "@/lib/lists/csv";
import { normalizeDomain } from "@/lib/normalise/domain";
import { resolveAccount } from "@/lib/identity/account-resolution";

export type ImportTargetAccountsInput = {
  ownerOrganizationId: string;
  name: string;
  content: string;
  mapping: Record<string, string>;
  isReusable?: boolean;
};

export type ImportResult = {
  batchId: string;
  listId: string;
  rowsTotal: number;
  rowsAccepted: number;
  rowsFailed: number;
  errors: RowError[];
};

export async function importTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  input: ImportTargetAccountsInput,
): Promise<ImportResult> {
  assertPermission(actor, "list:write");
  assertOrganizationAccess(actor, input.ownerOrganizationId);

  const parsed = parseDelimited(input.content);
  const errors: RowError[] = [];

  const list = await db.targetAccountList.create({
    data: {
      ownerOrganizationId: input.ownerOrganizationId,
      name: input.name,
      isReusable: input.isReusable ?? true,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });

  const batch = await db.importBatch.create({
    data: {
      type: "targetAccounts",
      uploadedById: actor.userId,
      organizationId: input.ownerOrganizationId,
      mappingJson: input.mapping,
      rowsTotal: parsed.rows.length,
      status: "processing",
    },
  });

  let accepted = 0;

  for (const [index, sourceRow] of parsed.rows.entries()) {
    const rowNumber = index + 1;
    const row = applyMapping(sourceRow, input.mapping);
    const rawName = row.rawName?.trim();
    const rawDomain = row.rawDomain?.trim();

    if ((rawName === undefined || rawName === "") && (rawDomain === undefined || rawDomain === "")) {
      errors.push({ rowNumber, field: null, rawValue: null, message: "Row needs a name or domain" });
      continue;
    }

    const normalizedDomain = rawDomain === undefined || rawDomain === "" ? null : normalizeDomain(rawDomain);

    const capRaw = row.maxLeadsPerAccountOverride?.trim();
    let cap: number | null = null;
    if (capRaw !== undefined && capRaw !== "") {
      const parsedCap = Number.parseInt(capRaw, 10);
      if (Number.isNaN(parsedCap) || parsedCap <= 0) {
        errors.push({
          rowNumber, field: "maxLeadsPerAccountOverride", rawValue: capRaw,
          message: "Cap override must be a positive integer",
        });
        continue;
      }
      cap = parsedCap;
    }

    // FR-ID-2: an ambiguous entry is recorded as ambiguous with its candidates
    // and lands in the admin resolution queue. It is never guessed.
    const match = await resolveAccount(db, {
      name: rawName,
      domain: rawDomain,
      country: row.country?.trim(),
    });

    await db.targetAccountEntry.create({
      data: {
        listId: list.id,
        rawName: rawName ?? null,
        rawDomain: rawDomain ?? null,
        normalizedDomain,
        accountId: match.status === "matched" ? match.accountId : null,
        matchStatus: match.status,
        candidateAccountIdsJson:
          match.status === "ambiguous" ? (match.candidateIds as Prisma.InputJsonValue) : undefined,
        maxLeadsPerAccountOverride: cap,
      },
    });
    accepted += 1;
  }

  if (errors.length > 0) {
    await db.importError.createMany({
      data: errors.map((error) => ({ batchId: batch.id, ...error })),
    });
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { rowsAccepted: accepted, rowsFailed: errors.length, status: "completed" },
  });

  return {
    batchId: batch.id,
    listId: list.id,
    rowsTotal: parsed.rows.length,
    rowsAccepted: accepted,
    rowsFailed: errors.length,
    errors,
  };
}

export async function attachTargetAccountList(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  listId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");

  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);

  await withAudit(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "attachTargetAccountList", after: { listId } },
    async (tx) => {
      await tx.campaignTargetAccountList.create({ data: { campaignId, listId } });
    },
  );
}

/**
 * Cap resolution (SRS §4.3): the entry override wins if set, otherwise the
 * campaign default applies, otherwise the account is uncapped.
 */
export async function resolveAccountCap(
  db: PrismaClient,
  campaignId: string,
  accountId: string,
): Promise<number | null> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null) throw new NotFoundError("Campaign not found");

  const links = await db.campaignTargetAccountList.findMany({
    where: { campaignId },
    select: { listId: true },
  });

  if (links.length > 0) {
    const entry = await db.targetAccountEntry.findFirst({
      where: {
        listId: { in: links.map((l) => l.listId) },
        accountId,
        maxLeadsPerAccountOverride: { not: null },
      },
      orderBy: { maxLeadsPerAccountOverride: "asc" },
    });
    if (entry?.maxLeadsPerAccountOverride != null) return entry.maxLeadsPerAccountOverride;
  }

  return campaign.defaultMaxLeadsPerAccount;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/target-accounts.test.ts`
Expected: PASS — all eight tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add target account list import with cap override resolution"
```

---

### Task 19: Suppression lists

**Files:**
- Create: `src/lib/lists/suppression.ts`
- Modify: `prisma/schema.prisma`
- Test: `tests/suppression.test.ts`

**Interfaces:**
- Consumes: Task 17's CSV helpers, Task 4's normalisation, Task 12's `resolveAccount`.
- Produces:
  - Models `SuppressionList`, `SuppressionEntry`, `CampaignSuppressionList`.
  - `importSuppressionList(db, actor, input): Promise<ImportResult>`
  - `attachSuppressionList(db, actor, campaignId, listId): Promise<void>`
  - `isSuppressed(db, campaignId, candidate: { email?: string; domain?: string; accountId?: string }): Promise<boolean>` — used by Phase 3's intake pipeline.

- [ ] **Step 1: Add the models**

FR-CP-6 requires suppression values to survive contact anonymisation, so each entry also stores a salted hash.

```prisma
// prisma/schema.prisma — append
enum SuppressionListType {
  client
  competitor
  existingCustomer
  prior
  custom
}

enum SuppressionEntryType {
  account
  domain
  email
  contact
}

model SuppressionList {
  id                  String              @id @default(cuid())
  ownerOrganizationId String
  name                String
  isReusable          Boolean             @default(true)
  type                SuppressionListType @default(custom)
  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt
  createdById         String?
  updatedById         String?

  entries   SuppressionEntry[]
  campaigns CampaignSuppressionList[]

  @@index([ownerOrganizationId])
}

model SuppressionEntry {
  id        String               @id @default(cuid())
  listId    String
  type      SuppressionEntryType
  value     String
  valueHash String
  accountId String?
  contactId String?
  createdAt DateTime             @default(now())
  updatedAt DateTime             @updatedAt

  list SuppressionList @relation(fields: [listId], references: [id])

  @@unique([listId, type, value])
  @@index([listId, type, valueHash])
}

model CampaignSuppressionList {
  id         String   @id @default(cuid())
  campaignId String
  listId     String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  list SuppressionList @relation(fields: [listId], references: [id])

  @@unique([campaignId, listId])
}
```

Run: `pnpm prisma migrate dev --name add_suppression_lists`

Add `SUPPRESSION_HASH_SALT` to `.env.example`.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/suppression.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createCampaign } from "@/lib/campaigns/crud";
import {
  attachSuppressionList,
  importSuppressionList,
  isSuppressed,
} from "@/lib/lists/suppression";

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const campaign = await createCampaign(db, manager, {
    clientOrganizationId: client.id, name: "C", code: `SUP-${Math.random().toString(36).slice(2, 8)}`,
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
  });
  return { db, ops, manager, client, campaign };
}

const CSV = ["Type,Value", "domain,https://www.Competitor.com", "email,Jane@Blocked.com", "domain,bad domain"].join("\n");
const MAPPING = { Type: "type", Value: "value" };

describe("suppression list import", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("normalises domains and emails on import", async () => {
    const { db, ops, client } = await setup();

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    const entries = await db.suppressionEntry.findMany({ where: { listId: result.listId } });
    expect(entries.map((e) => e.value).sort()).toEqual(["competitor.com", "jane@blocked.com"]);
  });

  it("stores a salted hash alongside the value (FR-CP-6)", async () => {
    const { db, ops, client } = await setup();

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    const entry = await db.suppressionEntry.findFirstOrThrow({ where: { listId: result.listId } });
    expect(entry.valueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(entry.valueHash).not.toBe(entry.value);
  });

  it("reports a per-row error for an unparseable value", async () => {
    const { db, ops, client } = await setup();

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    expect(result.rowsAccepted).toBe(2);
    expect(result.rowsFailed).toBe(1);
    expect(result.errors[0]?.rowNumber).toBe(3);
  });

  it("rejects an unknown entry type", async () => {
    const { db, ops, client } = await setup();
    const content = "Type,Value\nfax,12345\n";

    const result = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "L", type: "custom", content, mapping: MAPPING,
    });

    expect(result.rowsFailed).toBe(1);
    expect(result.errors[0]?.message).toMatch(/type/i);
  });
});

describe("isSuppressed", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("matches a suppressed domain for an attached list", async () => {
    const { db, ops, manager, client, campaign } = await setup();
    const { listId } = await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });
    await attachSuppressionList(db, manager, campaign.id, listId);

    expect(await isSuppressed(db, campaign.id, { domain: "www.competitor.com" })).toBe(true);
    expect(await isSuppressed(db, campaign.id, { email: "someone@competitor.com" })).toBe(true);
    expect(await isSuppressed(db, campaign.id, { email: "JANE@blocked.com" })).toBe(true);
    expect(await isSuppressed(db, campaign.id, { domain: "allowed.com" })).toBe(false);
  });

  it("ignores lists not attached to the campaign", async () => {
    const { db, ops, campaign, client } = await setup();
    await importSuppressionList(db, ops, {
      ownerOrganizationId: client.id, name: "Competitors", type: "competitor",
      content: CSV, mapping: MAPPING,
    });

    expect(await isSuppressed(db, campaign.id, { domain: "competitor.com" })).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/suppression.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/lists/suppression"`.

- [ ] **Step 4: Write the suppression module**

```typescript
// src/lib/lists/suppression.ts
import { createHmac } from "node:crypto";
import type { PrismaClient, SuppressionEntryType, SuppressionListType } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { applyMapping, parseDelimited, type RowError } from "@/lib/lists/csv";
import { normalizeDomain } from "@/lib/normalise/domain";
import { emailDomain, normalizeEmail } from "@/lib/normalise/email";
import type { ImportResult } from "@/lib/lists/target-accounts";

const ENTRY_TYPES: readonly string[] = ["account", "domain", "email", "contact"];

/**
 * FR-CP-6: suppression entries are exempt from retention expiry, so the value
 * is also kept as a salted hash that survives anonymisation of the contact.
 */
export function hashSuppressionValue(value: string): string {
  const salt = process.env.SUPPRESSION_HASH_SALT ?? "development-salt";
  return createHmac("sha256", salt).update(value).digest("hex");
}

export type ImportSuppressionInput = {
  ownerOrganizationId: string;
  name: string;
  type: SuppressionListType;
  content: string;
  mapping: Record<string, string>;
  isReusable?: boolean;
};

export async function importSuppressionList(
  db: PrismaClient,
  actor: Actor,
  input: ImportSuppressionInput,
): Promise<ImportResult> {
  assertPermission(actor, "list:write");
  assertOrganizationAccess(actor, input.ownerOrganizationId);

  const parsed = parseDelimited(input.content);
  const errors: RowError[] = [];

  const list = await db.suppressionList.create({
    data: {
      ownerOrganizationId: input.ownerOrganizationId,
      name: input.name,
      type: input.type,
      isReusable: input.isReusable ?? true,
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });

  const batch = await db.importBatch.create({
    data: {
      type: "suppression",
      uploadedById: actor.userId,
      organizationId: input.ownerOrganizationId,
      mappingJson: input.mapping,
      rowsTotal: parsed.rows.length,
      status: "processing",
    },
  });

  let accepted = 0;

  for (const [index, sourceRow] of parsed.rows.entries()) {
    const rowNumber = index + 1;
    const row = applyMapping(sourceRow, input.mapping);
    const rawType = row.type?.trim().toLowerCase() ?? "";
    const rawValue = row.value?.trim() ?? "";

    if (!ENTRY_TYPES.includes(rawType)) {
      errors.push({ rowNumber, field: "type", rawValue: rawType, message: `Unknown suppression type: ${rawType}` });
      continue;
    }

    let value: string | null = null;
    try {
      value = rawType === "email" || rawType === "contact" ? normalizeEmail(rawValue) : normalizeDomain(rawValue);
    } catch {
      value = null;
    }

    if (value === null) {
      errors.push({ rowNumber, field: "value", rawValue, message: `Could not normalise value: ${rawValue}` });
      continue;
    }

    await db.suppressionEntry.upsert({
      where: { listId_type_value: { listId: list.id, type: rawType as SuppressionEntryType, value } },
      update: {},
      create: {
        listId: list.id,
        type: rawType as SuppressionEntryType,
        value,
        valueHash: hashSuppressionValue(value),
      },
    });
    accepted += 1;
  }

  if (errors.length > 0) {
    await db.importError.createMany({ data: errors.map((error) => ({ batchId: batch.id, ...error })) });
  }

  await db.importBatch.update({
    where: { id: batch.id },
    data: { rowsAccepted: accepted, rowsFailed: errors.length, status: "completed" },
  });

  return {
    batchId: batch.id,
    listId: list.id,
    rowsTotal: parsed.rows.length,
    rowsAccepted: accepted,
    rowsFailed: errors.length,
    errors,
  };
}

export async function attachSuppressionList(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  listId: string,
): Promise<void> {
  assertPermission(actor, "campaign:write");

  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);

  await withAudit(
    db,
    actor,
    { entityType: "Campaign", entityId: campaignId, action: "attachSuppressionList", after: { listId } },
    async (tx) => {
      await tx.campaignSuppressionList.create({ data: { campaignId, listId } });
    },
  );
}

export async function isSuppressed(
  db: PrismaClient,
  campaignId: string,
  candidate: { email?: string; domain?: string; accountId?: string },
): Promise<boolean> {
  const links = await db.campaignSuppressionList.findMany({
    where: { campaignId },
    select: { listId: true },
  });
  if (links.length === 0) return false;
  const listIds = links.map((l) => l.listId);

  const conditions: { type: SuppressionEntryType; value: string }[] = [];

  if (candidate.email !== undefined) {
    const email = normalizeEmail(candidate.email);
    conditions.push({ type: "email", value: email }, { type: "contact", value: email });
    const domain = emailDomain(candidate.email);
    if (domain !== null) conditions.push({ type: "domain", value: domain });
  }
  if (candidate.domain !== undefined) {
    const domain = normalizeDomain(candidate.domain);
    if (domain !== null) conditions.push({ type: "domain", value: domain });
  }
  if (conditions.length === 0 && candidate.accountId === undefined) return false;

  const hit = await db.suppressionEntry.findFirst({
    where: {
      listId: { in: listIds },
      OR: [
        ...conditions.map((c) => ({ type: c.type, value: c.value })),
        ...(candidate.accountId === undefined
          ? []
          : [{ type: "account" as const, accountId: candidate.accountId }]),
      ],
    },
    select: { id: true },
  });

  return hit !== null;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/suppression.test.ts`
Expected: PASS — all six tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add suppression list import, attachment and matching"
```

---

### Task 20: Campaign state machine, configuration snapshot and approvals

SRS §5.1 and E6. Transition to Scheduled writes an immutable configuration snapshot and freezes the channel type versions in use (FR-CS-1).

**Files:**
- Create: `src/lib/campaigns/snapshot.ts`, `src/lib/campaigns/state-machine.ts`
- Test: `tests/campaign-approval.test.ts`

**Interfaces:**
- Consumes: Task 16's models and CRUD, Task 15's versions, Task 8's audit.
- Produces:
  - `type CampaignConfigSnapshot` — the frozen configuration shape.
  - `buildConfigSnapshot(db, campaignId): Promise<CampaignConfigSnapshot>`
  - `SNAPSHOT_VERSION = 1`
  - `ALLOWED_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>>`
  - `transitionCampaign(db, actor, campaignId, toStatus, reason?): Promise<Campaign>`
  - `submitForInternalApproval(db, actor, campaignId): Promise<Campaign>`
  - `decideInternalApproval(db, actor, campaignId, decision, comments?): Promise<Campaign>`
  - `decideClientApproval(db, actor, campaignId, decision, comments?): Promise<Campaign>`
  - `activateDueCampaigns(db, now): Promise<number>` — Scheduled → Live at flight start.
  - `completeFinishedCampaigns(db, now): Promise<number>` — FR-CS-3.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/campaign-approval.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import { addCampaignChannel, createCampaign, setIcpCriteria } from "@/lib/campaigns/crud";
import {
  activateDueCampaigns,
  completeFinishedCampaigns,
  decideClientApproval,
  decideInternalApproval,
  submitForInternalApproval,
  transitionCampaign,
} from "@/lib/campaigns/state-machine";
import { ForbiddenError, InvalidStateTransitionError, ValidationError } from "@/lib/errors";

async function scenario(code: string) {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const admin = await loadActor(db, (await createUser(db, internal.id, "SUPER_ADMIN")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const clientAdmin = await loadActor(db, (await createUser(db, client.id, "CLIENT_ADMIN")).id);
  const clientViewer = await loadActor(db, (await createUser(db, client.id, "CLIENT_VIEWER")).id);

  const channelType = await db.channelType.findUniqueOrThrow({ where: { code: "CONTENT_SYNDICATION" } });
  const version = await publishChannelTypeVersion(db, admin, channelType.id);

  const campaign = await createCampaign(db, manager, {
    clientOrganizationId: client.id, name: "Campaign", code,
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
    currency: "USD", defaultMaxLeadsPerAccount: 5,
  });
  await setIcpCriteria(db, manager, campaign.id, [
    { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
  ]);
  await addCampaignChannel(db, manager, campaign.id, {
    channelTypeVersionId: version.id, contractedQuantity: 500,
    clientUnitPrice: "42.50", currency: "USD",
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
  });

  return { db, admin, manager, client, clientAdmin, clientViewer, campaign, version };
}

describe("approval workflow (E6, FR-CS-1)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("walks draft → internal → client → scheduled", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-1");

    const submitted = await submitForInternalApproval(db, manager, campaign.id);
    expect(submitted.status).toBe("pendingInternalApproval");

    const internallyApproved = await decideInternalApproval(db, manager, campaign.id, "approved");
    expect(internallyApproved.status).toBe("pendingClientApproval");

    const scheduled = await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    expect(scheduled.status).toBe("scheduled");
  });

  it("writes an immutable snapshot on client approval", async () => {
    const { db, manager, clientAdmin, campaign, version } = await scenario("FLOW-2");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    const scheduled = await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    const approval = await db.campaignApproval.findFirstOrThrow({
      where: { campaignId: campaign.id, type: "client" },
    });
    expect(approval.decidedByUserId).toBe(clientAdmin.userId);
    expect(approval.snapshotVersion).toBe(1);
    expect(scheduled.approvedSnapshotId).toBe(approval.id);

    const snapshot = approval.configSnapshotJson as {
      icpCriteria: unknown[];
      channels: Array<{ channelTypeVersionId: string; contractedQuantity: number; clientUnitPriceMinor: string }>;
      defaultMaxLeadsPerAccount: number | null;
    };
    expect(snapshot.icpCriteria).toHaveLength(1);
    expect(snapshot.channels[0]?.channelTypeVersionId).toBe(version.id);
    expect(snapshot.channels[0]?.contractedQuantity).toBe(500);
    expect(snapshot.channels[0]?.clientUnitPriceMinor).toBe("4250");
    expect(snapshot.defaultMaxLeadsPerAccount).toBe(5);
  });

  it("returns the campaign to draft on rejection, keeping the comments", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-3");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    const rejected = await decideClientApproval(db, clientAdmin, campaign.id, "rejected", "Price is wrong");

    expect(rejected.status).toBe("draft");
    const approval = await db.campaignApproval.findFirstOrThrow({
      where: { campaignId: campaign.id, type: "client", decision: "rejected" },
    });
    expect(approval.comments).toBe("Price is wrong");
    expect(approval.configSnapshotJson).toBeNull();
  });

  it("refuses a Client Viewer's approval", async () => {
    const { db, manager, clientViewer, campaign } = await scenario("FLOW-4");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    await expect(decideClientApproval(db, clientViewer, campaign.id, "approved"))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses another client's admin", async () => {
    const { db, manager, campaign } = await scenario("FLOW-5");
    const otherOrg = await createOrganization(testDb(), { isClient: true });
    const outsider = await loadActor(testDb(), (await createUser(testDb(), otherOrg.id, "CLIENT_ADMIN")).id);
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");

    await expect(decideClientApproval(db, outsider, campaign.id, "approved"))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses to submit a campaign with no channels", async () => {
    const { db, manager, client } = await scenario("FLOW-6");
    const empty = await createCampaign(db, manager, {
      clientOrganizationId: client.id, name: "Empty", code: "EMPTY-1",
      startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"), currency: "USD",
    });

    await expect(submitForInternalApproval(db, manager, empty.id)).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects an illegal transition", async () => {
    const { db, manager, campaign } = await scenario("FLOW-7");

    await expect(transitionCampaign(db, manager, campaign.id, "live"))
      .rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("records every transition in the status history", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-8");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    const history = await db.campaignStatusHistory.findMany({
      where: { campaignId: campaign.id }, orderBy: { changedAt: "asc" },
    });
    expect(history.map((h) => h.toStatus)).toEqual([
      "draft", "pendingInternalApproval", "pendingClientApproval", "scheduled",
    ]);
  });

  it("allows cancellation from any pre-live state", async () => {
    const { db, manager, campaign } = await scenario("FLOW-9");
    await submitForInternalApproval(db, manager, campaign.id);

    const cancelled = await transitionCampaign(db, manager, campaign.id, "cancelled", "Client withdrew");
    expect(cancelled.status).toBe("cancelled");
  });

  it("refuses cancellation once live", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-10");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    await transitionCampaign(db, manager, campaign.id, "live");

    await expect(transitionCampaign(db, manager, campaign.id, "cancelled"))
      .rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("pauses and resumes a live campaign", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("FLOW-11");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    await transitionCampaign(db, manager, campaign.id, "live");

    expect((await transitionCampaign(db, manager, campaign.id, "paused")).status).toBe("paused");
    expect((await transitionCampaign(db, manager, campaign.id, "live")).status).toBe("live");
  });
});

describe("scheduled transitions", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("activates a scheduled campaign once its start date arrives", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("SCHED-1");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    expect(await activateDueCampaigns(db, new Date("2026-09-30"))).toBe(0);
    expect(await activateDueCampaigns(db, new Date("2026-10-01"))).toBe(1);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("live");
  });

  it("completes a live campaign once the flight end date passes (FR-CS-3)", async () => {
    const { db, manager, clientAdmin, campaign } = await scenario("SCHED-2");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");
    await activateDueCampaigns(db, new Date("2026-10-01"));

    expect(await completeFinishedCampaigns(db, new Date("2026-12-31"))).toBe(0);
    expect(await completeFinishedCampaigns(db, new Date("2027-01-01"))).toBe(1);
    expect((await db.campaign.findUniqueOrThrow({ where: { id: campaign.id } })).status).toBe("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/campaign-approval.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/campaigns/state-machine"`.

- [ ] **Step 3: Write the snapshot builder**

`BigInt` does not survive `JSON.stringify`, so prices are frozen as decimal strings of the minor-unit value.

```typescript
// src/lib/campaigns/snapshot.ts
import type { PrismaClient } from "@prisma/client";
import { NotFoundError } from "@/lib/errors";

export const SNAPSHOT_VERSION = 1;

export type CampaignConfigSnapshot = {
  snapshotVersion: number;
  campaignId: string;
  code: string;
  name: string;
  clientOrganizationId: string;
  startDate: string;
  endDate: string;
  currency: string;
  defaultMaxLeadsPerAccount: number | null;
  advisoryTalMatch: boolean;
  advisoryIcpMatch: boolean;
  icpCriteria: Array<{
    dimension: string;
    operator: string;
    values: unknown;
    isMandatory: boolean;
  }>;
  leadFieldSpecs: Array<{
    fieldKey: string;
    label: string;
    dataType: string;
    isRequired: boolean;
    rejectIfMissing: boolean;
    allowedValues: unknown;
    validationPattern: string | null;
  }>;
  channels: Array<{
    campaignChannelId: string;
    channelTypeVersionId: string;
    channelTypeCode: string;
    channelTypeVersion: number;
    contractedQuantity: number;
    clientUnitPriceMinor: string;
    costBudgetMinor: string | null;
    currency: string;
    startDate: string;
    endDate: string;
    definition: unknown;
  }>;
  targetAccountListIds: string[];
  suppressionListIds: string[];
};

const isoDate = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * FR-CS-1: the snapshot is the whole approved configuration, including the
 * frozen channel type definitions, so nothing edited later can change what a
 * client agreed to.
 */
export async function buildConfigSnapshot(
  db: PrismaClient,
  campaignId: string,
): Promise<CampaignConfigSnapshot> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      icpCriteria: true,
      leadFieldSpecs: true,
      channels: { include: { channelTypeVersion: { include: { channelType: true } } } },
    },
  });
  if (campaign === null) throw new NotFoundError("Campaign not found");

  const [talLinks, suppressionLinks] = await Promise.all([
    db.campaignTargetAccountList.findMany({ where: { campaignId }, select: { listId: true } }),
    db.campaignSuppressionList.findMany({ where: { campaignId }, select: { listId: true } }),
  ]);

  return {
    snapshotVersion: SNAPSHOT_VERSION,
    campaignId: campaign.id,
    code: campaign.code,
    name: campaign.name,
    clientOrganizationId: campaign.clientOrganizationId,
    startDate: isoDate(campaign.startDate),
    endDate: isoDate(campaign.endDate),
    currency: campaign.currency,
    defaultMaxLeadsPerAccount: campaign.defaultMaxLeadsPerAccount,
    advisoryTalMatch: campaign.advisoryTalMatch,
    advisoryIcpMatch: campaign.advisoryIcpMatch,
    icpCriteria: campaign.icpCriteria.map((c) => ({
      dimension: c.dimension,
      operator: c.operator,
      values: c.valuesJson,
      isMandatory: c.isMandatory,
    })),
    leadFieldSpecs: campaign.leadFieldSpecs.map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      dataType: f.dataType,
      isRequired: f.isRequired,
      rejectIfMissing: f.rejectIfMissing,
      allowedValues: f.allowedValuesJson,
      validationPattern: f.validationPattern,
    })),
    channels: campaign.channels.map((ch) => ({
      campaignChannelId: ch.id,
      channelTypeVersionId: ch.channelTypeVersionId,
      channelTypeCode: ch.channelTypeVersion.channelType.code,
      channelTypeVersion: ch.channelTypeVersion.version,
      contractedQuantity: ch.contractedQuantity,
      // BigInt does not serialise to JSON; the minor-unit value is frozen as a string.
      clientUnitPriceMinor: ch.clientUnitPriceMinor.toString(),
      costBudgetMinor: ch.costBudgetMinor === null ? null : ch.costBudgetMinor.toString(),
      currency: ch.currency,
      startDate: isoDate(ch.startDate),
      endDate: isoDate(ch.endDate),
      definition: ch.channelTypeVersion.definitionJson,
    })),
    targetAccountListIds: talLinks.map((l) => l.listId),
    suppressionListIds: suppressionLinks.map((l) => l.listId),
  };
}
```

- [ ] **Step 4: Write the state machine**

```typescript
// src/lib/campaigns/state-machine.ts
import type { ApprovalDecision, Campaign, CampaignStatus, Prisma, PrismaClient } from "@prisma/client";
import { InvalidStateTransitionError, NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { buildConfigSnapshot, SNAPSHOT_VERSION } from "@/lib/campaigns/snapshot";

/** SRS §5.1, transcribed exactly. */
export const ALLOWED_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft: ["pendingInternalApproval", "cancelled"],
  pendingInternalApproval: ["draft", "pendingClientApproval", "cancelled"],
  pendingClientApproval: ["draft", "scheduled", "cancelled"],
  scheduled: ["live", "cancelled"],
  live: ["paused", "completed"],
  paused: ["live", "completed"],
  completed: [],
  cancelled: [],
};

async function applyTransition(
  tx: Prisma.TransactionClient,
  actor: Actor | null,
  campaign: Campaign,
  toStatus: CampaignStatus,
  reason: string | undefined,
  extraData: Prisma.CampaignUpdateInput = {},
): Promise<Campaign> {
  if (!ALLOWED_TRANSITIONS[campaign.status].includes(toStatus)) {
    throw new InvalidStateTransitionError(
      `Campaign cannot move from ${campaign.status} to ${toStatus}`,
    );
  }

  const updated = await tx.campaign.update({
    where: { id: campaign.id },
    data: { status: toStatus, updatedById: actor?.userId, ...extraData },
  });

  await tx.campaignStatusHistory.create({
    data: {
      campaignId: campaign.id,
      fromStatus: campaign.status,
      toStatus,
      changedByUserId: actor?.userId ?? null,
      reason,
    },
  });

  if (actor !== null) {
    await writeAudit(tx, actor, {
      entityType: "Campaign",
      entityId: campaign.id,
      action: `transition:${toStatus}`,
      before: { status: campaign.status },
      after: { status: toStatus, reason },
    });
  }

  return updated;
}

async function loadAccessibleCampaign(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<Campaign> {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);
  return campaign;
}

export async function transitionCampaign(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  toStatus: CampaignStatus,
  reason?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:write");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  return db.$transaction((tx) => applyTransition(tx, actor, campaign, toStatus, reason));
}

/** A campaign is only submittable once it can actually be delivered against. */
async function assertReadyForApproval(db: PrismaClient, campaignId: string): Promise<void> {
  const channels = await db.campaignChannel.findMany({
    where: { campaignId },
    include: { channelTypeVersion: true },
  });
  if (channels.length === 0) {
    throw new ValidationError("A campaign needs at least one channel before approval");
  }

  const criteria = await db.icpCriterion.count({ where: { campaignId } });
  if (criteria === 0) {
    throw new ValidationError("A campaign needs at least one ICP criterion before approval");
  }
}

export async function submitForInternalApproval(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:submitInternal");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  await assertReadyForApproval(db, campaignId);
  return db.$transaction((tx) => applyTransition(tx, actor, campaign, "pendingInternalApproval", undefined));
}

export async function decideInternalApproval(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  decision: ApprovalDecision,
  comments?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:approveInternal");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  if (campaign.status !== "pendingInternalApproval") {
    throw new InvalidStateTransitionError(`Campaign is ${campaign.status}, not awaiting internal approval`);
  }

  return db.$transaction(async (tx) => {
    await tx.campaignApproval.create({
      data: {
        campaignId, type: "internal", decision,
        decidedByUserId: actor.userId, comments,
      },
    });
    const toStatus: CampaignStatus = decision === "approved" ? "pendingClientApproval" : "draft";
    return applyTransition(tx, actor, campaign, toStatus, comments);
  });
}

/**
 * The client approval gate. On approval the configuration snapshot is written
 * and the campaign moves to Scheduled (FR-CS-1).
 */
export async function decideClientApproval(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  decision: ApprovalDecision,
  comments?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:approveClient");
  const campaign = await loadAccessibleCampaign(db, actor, campaignId);
  if (campaign.status !== "pendingClientApproval") {
    throw new InvalidStateTransitionError(`Campaign is ${campaign.status}, not awaiting client approval`);
  }

  const snapshot = decision === "approved" ? await buildConfigSnapshot(db, campaignId) : null;

  return db.$transaction(async (tx) => {
    const approval = await tx.campaignApproval.create({
      data: {
        campaignId,
        type: "client",
        decision,
        decidedByUserId: actor.userId,
        comments,
        configSnapshotJson: snapshot === null ? undefined : (snapshot as unknown as Prisma.InputJsonValue),
        snapshotVersion: snapshot === null ? null : SNAPSHOT_VERSION,
      },
    });

    if (decision === "rejected") {
      return applyTransition(tx, actor, campaign, "draft", comments);
    }

    await tx.campaignChannel.updateMany({ where: { campaignId }, data: { status: "active" } });
    return applyTransition(tx, actor, campaign, "scheduled", comments, {
      approvedSnapshotId: approval.id,
    });
  });
}

/** Scheduled → Live at flight start. Run by the job runner, so there is no actor. */
export async function activateDueCampaigns(db: PrismaClient, now: Date): Promise<number> {
  const due = await db.campaign.findMany({
    where: { status: "scheduled", startDate: { lte: now }, deletedAt: null },
  });

  for (const campaign of due) {
    await db.$transaction((tx) => applyTransition(tx, null, campaign, "live", "flight start reached"));
  }
  return due.length;
}

/** FR-CS-3: auto-complete at the flight end date. Quota fulfilment is Phase 3. */
export async function completeFinishedCampaigns(db: PrismaClient, now: Date): Promise<number> {
  const finished = await db.campaign.findMany({
    where: { status: { in: ["live", "paused"] }, endDate: { lt: now }, deletedAt: null },
  });

  for (const campaign of finished) {
    await db.$transaction((tx) => applyTransition(tx, null, campaign, "completed", "flight end passed"));
  }
  return finished.length;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/campaign-approval.test.ts`
Expected: PASS — all thirteen tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add campaign state machine, config snapshot and approval workflow"
```

---

### Task 21: Campaign cloning

E3: campaign cloning with adjustments. A clone is a draft copy of configuration, never of delivery history.

**Files:**
- Create: `src/lib/campaigns/clone.ts`
- Test: `tests/campaign-clone.test.ts`

**Interfaces:**
- Consumes: Task 16's models, Task 20's status history.
- Produces: `cloneCampaign(db, actor, sourceCampaignId, overrides: { code: string; name?: string; startDate?: Date; endDate?: Date; clientOrganizationId?: string }): Promise<Campaign>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/campaign-clone.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";
import {
  addCampaignChannel,
  createCampaign,
  setIcpCriteria,
  setLeadFieldSpec,
} from "@/lib/campaigns/crud";
import { decideClientApproval, decideInternalApproval, submitForInternalApproval } from "@/lib/campaigns/state-machine";
import { cloneCampaign } from "@/lib/campaigns/clone";
import { ValidationError } from "@/lib/errors";

async function configuredCampaign(code: string) {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const admin = await loadActor(db, (await createUser(db, internal.id, "SUPER_ADMIN")).id);
  const manager = await loadActor(db, (await createUser(db, internal.id, "CAMPAIGN_MANAGER")).id);
  const client = await createOrganization(db, { isClient: true });
  const clientAdmin = await loadActor(db, (await createUser(db, client.id, "CLIENT_ADMIN")).id);
  const channelType = await db.channelType.findUniqueOrThrow({ where: { code: "CONTENT_SYNDICATION" } });
  const version = await publishChannelTypeVersion(db, admin, channelType.id);

  const campaign = await createCampaign(db, manager, {
    clientOrganizationId: client.id, name: "Original", code,
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
    currency: "USD", defaultMaxLeadsPerAccount: 5,
  });
  await setIcpCriteria(db, manager, campaign.id, [
    { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
    { dimension: "seniority", operator: "in", values: ["VP"], isMandatory: false },
  ]);
  await setLeadFieldSpec(db, manager, campaign.id, [
    { fieldKey: "email", label: "Work email", dataType: "email", isRequired: true, rejectIfMissing: true },
  ]);
  await addCampaignChannel(db, manager, campaign.id, {
    channelTypeVersionId: version.id, contractedQuantity: 500,
    clientUnitPrice: "42.50", costBudget: "10000.00", currency: "USD",
    startDate: new Date("2026-10-01"), endDate: new Date("2026-12-31"),
  });

  return { db, manager, clientAdmin, client, campaign, version };
}

describe("cloneCampaign (E3)", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
  });

  it("copies ICP, lead field spec and channels into a new draft", async () => {
    const { db, manager, campaign, version } = await configuredCampaign("CLONE-SRC-1");

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-1", name: "Q1 rerun",
      startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    expect(clone.status).toBe("draft");
    expect(clone.name).toBe("Q1 rerun");
    expect(clone.clonedFromCampaignId).toBe(campaign.id);
    expect(clone.defaultMaxLeadsPerAccount).toBe(5);

    const criteria = await db.icpCriterion.findMany({ where: { campaignId: clone.id } });
    expect(criteria).toHaveLength(2);

    const spec = await db.leadFieldSpec.findMany({ where: { campaignId: clone.id } });
    expect(spec.map((f) => f.fieldKey)).toEqual(["email"]);

    const channels = await db.campaignChannel.findMany({ where: { campaignId: clone.id } });
    expect(channels).toHaveLength(1);
    expect(channels[0]?.channelTypeVersionId).toBe(version.id);
    expect(channels[0]?.clientUnitPriceMinor).toBe(4250n);
    expect(channels[0]?.status).toBe("draft");
  });

  it("shifts channel windows into the clone's flight window", async () => {
    const { db, manager, campaign } = await configuredCampaign("CLONE-SRC-2");

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-2", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    const channel = await db.campaignChannel.findFirstOrThrow({ where: { campaignId: clone.id } });
    expect(channel.startDate.toISOString().slice(0, 10)).toBe("2027-01-01");
    expect(channel.endDate.toISOString().slice(0, 10)).toBe("2027-03-31");
  });

  it("copies attached target account and suppression list links", async () => {
    const { db, manager, campaign, client } = await configuredCampaign("CLONE-SRC-3");
    const list = await db.targetAccountList.create({
      data: { ownerOrganizationId: client.id, name: "TAL" },
    });
    await db.campaignTargetAccountList.create({ data: { campaignId: campaign.id, listId: list.id } });

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-3", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    const links = await db.campaignTargetAccountList.findMany({ where: { campaignId: clone.id } });
    expect(links.map((l) => l.listId)).toEqual([list.id]);
  });

  it("copies no approvals, snapshot or status history from the source", async () => {
    const { db, manager, clientAdmin, campaign } = await configuredCampaign("CLONE-SRC-4");
    await submitForInternalApproval(db, manager, campaign.id);
    await decideInternalApproval(db, manager, campaign.id, "approved");
    await decideClientApproval(db, clientAdmin, campaign.id, "approved");

    const clone = await cloneCampaign(db, manager, campaign.id, {
      code: "CLONE-4", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
    });

    expect(clone.approvedSnapshotId).toBeNull();
    expect(await db.campaignApproval.count({ where: { campaignId: clone.id } })).toBe(0);
    const history = await db.campaignStatusHistory.findMany({ where: { campaignId: clone.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.toStatus).toBe("draft");
  });

  it("rejects a clone code that already exists", async () => {
    const { db, manager, campaign } = await configuredCampaign("CLONE-SRC-5");

    await expect(
      cloneCampaign(db, manager, campaign.id, {
        code: "CLONE-SRC-5", startDate: new Date("2027-01-01"), endDate: new Date("2027-03-31"),
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/campaign-clone.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/campaigns/clone"`.

- [ ] **Step 3: Write the clone module**

```typescript
// src/lib/campaigns/clone.ts
import type { Campaign, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";

export type CloneOverrides = {
  code: string;
  name?: string;
  startDate?: Date;
  endDate?: Date;
  clientOrganizationId?: string;
};

/**
 * Copies configuration only. Approvals, snapshots, status history, allocations
 * and delivery belong to the source campaign and are never carried across.
 */
export async function cloneCampaign(
  db: PrismaClient,
  actor: Actor,
  sourceCampaignId: string,
  overrides: CloneOverrides,
): Promise<Campaign> {
  assertPermission(actor, "campaign:clone");

  const source = await db.campaign.findUnique({
    where: { id: sourceCampaignId },
    include: { icpCriteria: true, leadFieldSpecs: true, channels: true },
  });
  if (source === null || source.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, source.clientOrganizationId);

  const targetClientId = overrides.clientOrganizationId ?? source.clientOrganizationId;
  assertOrganizationAccess(actor, targetClientId);

  const duplicate = await db.campaign.findUnique({ where: { code: overrides.code } });
  if (duplicate !== null) throw new ValidationError(`Campaign code already exists: ${overrides.code}`);

  const startDate = overrides.startDate ?? source.startDate;
  const endDate = overrides.endDate ?? source.endDate;
  if (endDate.getTime() < startDate.getTime()) {
    throw new ValidationError("Clone end date precedes its start date");
  }

  const [talLinks, suppressionLinks] = await Promise.all([
    db.campaignTargetAccountList.findMany({ where: { campaignId: sourceCampaignId }, select: { listId: true } }),
    db.campaignSuppressionList.findMany({ where: { campaignId: sourceCampaignId }, select: { listId: true } }),
  ]);

  return withAudit<Campaign>(
    db,
    actor,
    (clone) => ({
      entityType: "Campaign", entityId: clone.id, action: "clone",
      after: { clonedFromCampaignId: sourceCampaignId, code: clone.code },
    }),
    async (tx) => {
      const clone = await tx.campaign.create({
        data: {
          clientOrganizationId: targetClientId,
          name: overrides.name ?? `${source.name} (copy)`,
          code: overrides.code,
          startDate,
          endDate,
          currency: source.currency,
          defaultMaxLeadsPerAccount: source.defaultMaxLeadsPerAccount,
          advisoryTalMatch: source.advisoryTalMatch,
          advisoryIcpMatch: source.advisoryIcpMatch,
          clonedFromCampaignId: source.id,
          createdById: actor.userId,
          updatedById: actor.userId,
        },
      });

      for (const criterion of source.icpCriteria) {
        await tx.icpCriterion.create({
          data: {
            campaignId: clone.id,
            dimension: criterion.dimension,
            operator: criterion.operator,
            valuesJson: criterion.valuesJson ?? {},
            isMandatory: criterion.isMandatory,
          },
        });
      }

      for (const field of source.leadFieldSpecs) {
        await tx.leadFieldSpec.create({
          data: {
            campaignId: clone.id,
            fieldKey: field.fieldKey,
            label: field.label,
            dataType: field.dataType,
            isRequired: field.isRequired,
            rejectIfMissing: field.rejectIfMissing,
            allowedValuesJson: field.allowedValuesJson ?? undefined,
            validationPattern: field.validationPattern,
          },
        });
      }

      for (const channel of source.channels) {
        // Channel windows are clamped into the clone's flight window; a copied
        // window from last quarter would fail addCampaignChannel's own check.
        const channelStart = channel.startDate < startDate ? startDate : channel.startDate;
        const channelEnd = channel.endDate > endDate ? endDate : channel.endDate;

        await tx.campaignChannel.create({
          data: {
            campaignId: clone.id,
            channelTypeVersionId: channel.channelTypeVersionId,
            contractedQuantity: channel.contractedQuantity,
            clientUnitPriceMinor: channel.clientUnitPriceMinor,
            costBudgetMinor: channel.costBudgetMinor,
            currency: channel.currency,
            startDate: channelStart > channelEnd ? startDate : channelStart,
            endDate: channelStart > channelEnd ? endDate : channelEnd,
            qualificationFormId: channel.qualificationFormId,
            status: "draft",
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      for (const link of talLinks) {
        await tx.campaignTargetAccountList.create({ data: { campaignId: clone.id, listId: link.listId } });
      }
      for (const link of suppressionLinks) {
        await tx.campaignSuppressionList.create({ data: { campaignId: clone.id, listId: link.listId } });
      }

      await tx.campaignStatusHistory.create({
        data: { campaignId: clone.id, fromStatus: null, toStatus: "draft", changedByUserId: actor.userId },
      });

      return clone;
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/campaign-clone.test.ts`
Expected: PASS — all five tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add campaign cloning with window clamping"
```

---

### Task 22: The account resolution queue

FR-ID-2 requires ambiguous matches to appear in an admin resolution queue rather than being guessed. Task 18 records them; this task makes them workable.

**Files:**
- Create: `src/lib/identity/resolution-queue.ts`
- Test: `tests/resolution-queue.test.ts`

**Interfaces:**
- Consumes: `TargetAccountEntry` (Task 18), `resolveAccount`/`createAccount` (Task 12).
- Produces:
  - `listUnresolvedEntries(db, actor, filter: { organizationId?: string; listId?: string; limit?: number; cursor?: string }): Promise<{ entries: UnresolvedEntry[]; nextCursor: string | null }>`
  - `resolveEntryToAccount(db, actor, entryId, accountId): Promise<void>`
  - `resolveEntryByCreatingAccount(db, actor, entryId): Promise<{ accountId: string }>`
  - `rematchEntry(db, actor, entryId): Promise<MatchStatus>`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/resolution-queue.test.ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { createOrganization, createUser } from "./helpers/factories";
import { loadActor } from "@/lib/auth/permissions";
import { createAccount } from "@/lib/identity/account-resolution";
import { importTargetAccountList } from "@/lib/lists/target-accounts";
import {
  listUnresolvedEntries,
  rematchEntry,
  resolveEntryByCreatingAccount,
  resolveEntryToAccount,
} from "@/lib/identity/resolution-queue";
import { ForbiddenError } from "@/lib/errors";

const CSV = ["Company,Website", "Acme Inc,https://www.acme.com", "Mystery Co,mystery.test"].join("\n");
const MAPPING = { Company: "rawName", Website: "rawDomain" };

async function setup() {
  const db = testDb();
  const internal = await createOrganization(db, { isInternal: true, isClient: false });
  const ops = await loadActor(db, (await createUser(db, internal.id, "OPERATIONS")).id);
  const client = await createOrganization(db, { isClient: true });
  const { listId } = await importTargetAccountList(db, ops, {
    ownerOrganizationId: client.id, name: "TAL", content: CSV, mapping: MAPPING,
  });
  return { db, ops, client, listId };
}

describe("account resolution queue (FR-ID-2)", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
  });

  it("lists unmatched and ambiguous entries, and no matched ones", async () => {
    const { db, ops, listId } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const acmeEntry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });
    await resolveEntryToAccount(db, ops, acmeEntry.id, acme.id);

    const { entries } = await listUnresolvedEntries(db, ops, { listId });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.rawName).toBe("Mystery Co");
  });

  it("assigns an entry to an existing account", async () => {
    const { db, ops } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });

    await resolveEntryToAccount(db, ops, entry.id, acme.id);

    const updated = await db.targetAccountEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(updated.matchStatus).toBe("matched");
    expect(updated.accountId).toBe(acme.id);
  });

  it("creates an account from the entry when none exists", async () => {
    const { db, ops } = await setup();
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Mystery Co" } });

    const { accountId } = await resolveEntryByCreatingAccount(db, ops, entry.id);

    const account = await db.account.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.name).toBe("Mystery Co");
    expect(account.primaryDomain).toBe("mystery.test");
    const updated = await db.targetAccountEntry.findUniqueOrThrow({ where: { id: entry.id } });
    expect(updated.accountId).toBe(accountId);
    expect(updated.matchStatus).toBe("matched");
  });

  it("rematches an entry after the account it should match is created", async () => {
    const { db, ops } = await setup();
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });
    expect(entry.matchStatus).toBe("unmatched");
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });

    const status = await rematchEntry(db, ops, entry.id);

    expect(status).toBe("matched");
    expect((await db.targetAccountEntry.findUniqueOrThrow({ where: { id: entry.id } })).accountId).toBe(acme.id);
  });

  it("audits a manual resolution", async () => {
    const { db, ops } = await setup();
    const acme = await createAccount(db, ops, { name: "Acme", domain: "acme.com", country: "US" });
    const entry = await db.targetAccountEntry.findFirstOrThrow({ where: { rawName: "Acme Inc" } });

    await resolveEntryToAccount(db, ops, entry.id, acme.id);

    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityType: "TargetAccountEntry", action: "resolve" },
    });
    expect(audit.actorUserId).toBe(ops.userId);
  });

  it("refuses a client actor", async () => {
    const { db, client, listId } = await setup();
    const clientAdmin = await loadActor(db, (await createUser(db, client.id, "CLIENT_ADMIN")).id);

    await expect(listUnresolvedEntries(db, clientAdmin, { listId }))
      .rejects.toBeInstanceOf(ForbiddenError);
  });

  it("pages with a cursor", async () => {
    const { db, ops, client } = await setup();
    const many = ["Company,Website", ...Array.from({ length: 5 }, (_, i) => `Co ${i},co${i}.test`)].join("\n");
    const { listId } = await importTargetAccountList(db, ops, {
      ownerOrganizationId: client.id, name: "Big TAL", content: many, mapping: MAPPING,
    });

    const first = await listUnresolvedEntries(db, ops, { listId, limit: 2 });
    expect(first.entries).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await listUnresolvedEntries(db, ops, { listId, limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.entries).toHaveLength(2);
    expect(second.entries[0]?.id).not.toBe(first.entries[0]?.id);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/resolution-queue.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/identity/resolution-queue"`.

- [ ] **Step 3: Write the queue module**

```typescript
// src/lib/identity/resolution-queue.ts
import type { MatchStatus, Prisma, PrismaClient } from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertPermission, type Actor } from "@/lib/auth/permissions";
import { withAudit } from "@/lib/audit/audit";
import { createAccount, resolveAccount } from "@/lib/identity/account-resolution";

export type UnresolvedEntry = {
  id: string;
  listId: string;
  listName: string;
  rawName: string | null;
  rawDomain: string | null;
  matchStatus: MatchStatus;
  candidateAccountIds: string[];
};

export async function listUnresolvedEntries(
  db: PrismaClient,
  actor: Actor,
  filter: { organizationId?: string; listId?: string; limit?: number; cursor?: string } = {},
): Promise<{ entries: UnresolvedEntry[]; nextCursor: string | null }> {
  // The queue is an internal tool: it exposes accounts across every client.
  assertPermission(actor, "account:write");

  const limit = filter.limit ?? 50;
  const where: Prisma.TargetAccountEntryWhereInput = {
    matchStatus: { in: ["unmatched", "ambiguous"] },
    ...(filter.listId === undefined ? {} : { listId: filter.listId }),
    ...(filter.organizationId === undefined
      ? {}
      : { list: { ownerOrganizationId: filter.organizationId } }),
  };

  // NFR-P-1: cursor-based paging, never offset.
  const rows = await db.targetAccountEntry.findMany({
    where,
    include: { list: { select: { name: true } } },
    orderBy: { id: "asc" },
    take: limit + 1,
    ...(filter.cursor === undefined ? {} : { cursor: { id: filter.cursor }, skip: 1 }),
  });

  const page = rows.slice(0, limit);
  const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;

  return {
    entries: page.map((row) => ({
      id: row.id,
      listId: row.listId,
      listName: row.list.name,
      rawName: row.rawName,
      rawDomain: row.rawDomain,
      matchStatus: row.matchStatus,
      candidateAccountIds: (row.candidateAccountIdsJson as string[] | null) ?? [],
    })),
    nextCursor,
  };
}

export async function resolveEntryToAccount(
  db: PrismaClient,
  actor: Actor,
  entryId: string,
  accountId: string,
): Promise<void> {
  assertPermission(actor, "account:write");

  const entry = await db.targetAccountEntry.findUnique({ where: { id: entryId } });
  if (entry === null) throw new NotFoundError("Target account entry not found");

  const account = await db.account.findUnique({ where: { id: accountId } });
  if (account === null || account.deletedAt !== null) throw new NotFoundError("Account not found");
  if (account.mergedIntoId !== null) throw new ValidationError("Account has been merged away");

  await withAudit(
    db,
    actor,
    {
      entityType: "TargetAccountEntry",
      entityId: entryId,
      action: "resolve",
      before: { matchStatus: entry.matchStatus, accountId: entry.accountId },
      after: { matchStatus: "matched", accountId },
    },
    async (tx) => {
      await tx.targetAccountEntry.update({
        where: { id: entryId },
        data: { accountId, matchStatus: "matched", candidateAccountIdsJson: Prisma.DbNull },
      });
    },
  );
}

export async function resolveEntryByCreatingAccount(
  db: PrismaClient,
  actor: Actor,
  entryId: string,
): Promise<{ accountId: string }> {
  assertPermission(actor, "account:write");

  const entry = await db.targetAccountEntry.findUnique({ where: { id: entryId } });
  if (entry === null) throw new NotFoundError("Target account entry not found");
  if (entry.rawName === null && entry.rawDomain === null) {
    throw new ValidationError("Entry has neither a name nor a domain to create an account from");
  }

  const account = await createAccount(db, actor, {
    name: entry.rawName ?? entry.rawDomain ?? "Unnamed account",
    domain: entry.rawDomain ?? undefined,
  });

  await resolveEntryToAccount(db, actor, entryId, account.id);
  return { accountId: account.id };
}

/** Re-runs matching, for use after new accounts have been created. */
export async function rematchEntry(
  db: PrismaClient,
  actor: Actor,
  entryId: string,
): Promise<MatchStatus> {
  assertPermission(actor, "account:write");

  const entry = await db.targetAccountEntry.findUnique({ where: { id: entryId } });
  if (entry === null) throw new NotFoundError("Target account entry not found");

  const match = await resolveAccount(db, {
    name: entry.rawName ?? undefined,
    domain: entry.rawDomain ?? undefined,
  });

  await db.targetAccountEntry.update({
    where: { id: entryId },
    data: {
      matchStatus: match.status,
      accountId: match.status === "matched" ? match.accountId : null,
      candidateAccountIdsJson:
        match.status === "ambiguous" ? (match.candidateIds as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });

  return match.status;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test tests/resolution-queue.test.ts`
Expected: PASS — all seven tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add admin account resolution queue"
```

---

### Task 23: Admin console UI — shadcn screens, server actions and invitation acceptance

The services are complete; this task gives them a usable surface. Server components read, server actions mutate, and neither re-implements authorisation — they call the same service functions the tests exercise.

**UI rules for this task, without exception:**

1. **Invoke the `shadcn/ui` skill (installed in Task 1) before writing a single line of UI code.** It carries the current component APIs; do not write shadcn markup from memory.
2. **Reach for a shadcn block first.** Use the shadcn MCP server to search the registry for a block that already matches the screen (a dashboard shell, a sidebar layout, a data table, a login form) and add it, then adapt it. Only when no block fits do you compose the screen from individual shadcn components.
3. **Composition over creation.** A screen-level component is an arrangement of shadcn primitives — `Table`, `Card`, `Badge`, `Button`, `Dialog`, `Form`, `Select`, `Sonner`. **Writing a component from scratch requires the user's approval before you write it.** If nothing in the registry covers the need, stop and ask.
4. **Client state is Zustand, never React Context.** Stores live in `src/lib/stores/`. Server data stays in server components; the stores hold only browser-owned state — open dialogs, table filters, row selection, unsent form drafts.

**Files:**
- Create: `components.json` (shadcn CLI config), `src/components/ui/*` (added by the shadcn CLI, not hand-written)
- Create: `src/lib/auth/require.ts`, `src/lib/utils.ts` (shadcn's `cn`), `src/lib/stores/campaign-filters.ts`, `src/lib/stores/resolution-queue.ts`
- Create: `src/app/(admin)/layout.tsx`, `src/app/(admin)/campaigns/page.tsx`, `src/app/(admin)/campaigns/campaign-table.tsx`, `src/app/(admin)/campaigns/[id]/page.tsx`, `src/app/(admin)/campaigns/[id]/approval-actions.tsx`, `src/app/(admin)/campaigns/actions.ts`, `src/app/(admin)/channel-types/page.tsx`, `src/app/(admin)/channel-types/actions.ts`, `src/app/(admin)/organizations/page.tsx`, `src/app/(admin)/organizations/actions.ts`, `src/app/(admin)/resolution-queue/page.tsx`, `src/app/(admin)/resolution-queue/actions.ts`, `src/app/invite/[token]/page.tsx`, `src/app/invite/[token]/accept-form.tsx`, `src/app/invite/[token]/actions.ts`
- Modify: `src/app/layout.tsx` (Tailwind globals, `Toaster`)
- Test: `tests/server-actions.test.ts`, `tests/stores.test.ts`

**Interfaces:**
- Consumes: every service module built so far, plus `getCurrentActor` (Task 10), and the `shadcn/ui` skill and shadcn MCP server from Task 1.
- Produces:
  - `requireActor(): Promise<Actor>` — re-exported thin wrapper over `getCurrentActor` for route code.
  - `type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string; code: string }`
  - `toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>>` — converts an `ApplicationError` into a serialisable result; unknown errors rethrow.
  - Server actions: `submitCampaignAction`, `approveInternalAction`, `approveClientAction`, `cloneCampaignAction`, `publishChannelTypeAction`, `deactivateChannelTypeAction`, `inviteUserAction`, `resendInvitationAction`, `revokeInvitationAction`, `acceptInvitationAction`, `resolveEntryAction`, `createAccountForEntryAction`, `rematchEntryAction`.
  - Zustand stores: `useCampaignFilters` (`{ status, query, setStatus, setQuery, reset }`), `useResolutionQueue` (`{ selectedEntryId, select, clear }`).

- [ ] **Step 1: Invoke the shadcn/ui skill, then scaffold shadcn**

Invoke the `shadcn/ui` skill first — it is the source of truth for the component APIs used below.

```bash
pnpm dlx shadcn@latest init
```

Answer the prompts for the App Router with TypeScript and Tailwind; this writes `components.json`, `src/lib/utils.ts`, the Tailwind config and the CSS variables, and installs Tailwind at its latest version.

Search the registry through the shadcn MCP server for a dashboard/sidebar block to use as the admin shell, then add it along with the primitives the screens below need:

```bash
pnpm dlx shadcn@latest add sidebar table card badge button dialog form input select label dropdown-menu tabs sonner alert skeleton
```

Add the shell block the MCP search returned (a `dashboard-*` or `sidebar-*` block) rather than hand-building the navigation. Then install Zustand:

```bash
pnpm add zustand
```

Everything resolves to its latest version; record what landed in `docs/tooling.md`.

- [ ] **Step 2: Write the failing test**

Server actions are plain exported functions; the test calls them directly with a mocked session, which is where the real risk lives.

```typescript
// tests/server-actions.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedSettings } from "../prisma/seed/settings";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { seedChannelTypes } from "../prisma/seed/channel-types";
import { createOrganization, createUser } from "./helpers/factories";
import { toActionResult } from "@/lib/auth/require";
import { ForbiddenError, ValidationError } from "@/lib/errors";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

describe("toActionResult", () => {
  it("wraps a success", async () => {
    expect(await toActionResult(async () => 42)).toEqual({ ok: true, data: 42 });
  });

  it("converts an ApplicationError into a serialisable failure", async () => {
    const result = await toActionResult(async () => {
      throw new ValidationError("Campaign code already exists: X");
    });
    expect(result).toEqual({
      ok: false, error: "Campaign code already exists: X", code: "VALIDATION_ERROR",
    });
  });

  it("converts a ForbiddenError without leaking internals", async () => {
    const result = await toActionResult(async () => {
      throw new ForbiddenError("Missing permission: campaign:write");
    });
    expect(result).toEqual({
      ok: false, error: "Missing permission: campaign:write", code: "FORBIDDEN",
    });
  });

  it("rethrows an unexpected error rather than swallowing it", async () => {
    await expect(
      toActionResult(async () => {
        throw new TypeError("undefined is not a function");
      }),
    ).rejects.toBeInstanceOf(TypeError);
  });
});

describe("client stores (Zustand, not React Context)", () => {
  beforeEach(async () => {
    const { useCampaignFilters } = await import("@/lib/stores/campaign-filters");
    useCampaignFilters.getState().reset();
  });

  it("holds and resets the campaign filter state", async () => {
    const { useCampaignFilters } = await import("@/lib/stores/campaign-filters");

    useCampaignFilters.getState().setStatus("live");
    useCampaignFilters.getState().setQuery("acme");
    expect(useCampaignFilters.getState().status).toBe("live");
    expect(useCampaignFilters.getState().query).toBe("acme");

    useCampaignFilters.getState().reset();
    expect(useCampaignFilters.getState().status).toBe("all");
    expect(useCampaignFilters.getState().query).toBe("");
  });

  it("tracks the selected resolution queue entry", async () => {
    const { useResolutionQueue } = await import("@/lib/stores/resolution-queue");

    expect(useResolutionQueue.getState().selectedEntryId).toBeNull();
    useResolutionQueue.getState().select("entry-1");
    expect(useResolutionQueue.getState().selectedEntryId).toBe("entry-1");
    useResolutionQueue.getState().clear();
    expect(useResolutionQueue.getState().selectedEntryId).toBeNull();
  });
});

describe("invitation acceptance action", () => {
  beforeEach(async () => {
    await resetDb();
    const db = testDb();
    await seedRoles(db);
    await seedSettings(db);
    await seedFunnelStages(db);
    await seedChannelTypes(db);
    vi.resetModules();
  });

  it("returns a failure result rather than throwing on a bad token", async () => {
    vi.doMock("@/lib/auth/better-auth", () => ({
      auth: { api: { signUpEmail: vi.fn(async () => ({ user: { id: "auth-x" } })) } },
    }));
    vi.doMock("@/lib/db", () => ({ db: testDb() }));

    const { acceptInvitationAction } = await import("@/app/invite/[token]/actions");
    const result = await acceptInvitationAction({
      token: "not-a-real-token", name: "Jane", password: "correct horse battery staple",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("VALIDATION_ERROR");
  });

  it("creates the user on a valid token", async () => {
    const db = testDb();
    vi.doMock("@/lib/auth/better-auth", () => ({
      auth: { api: { signUpEmail: vi.fn(async () => ({ user: { id: "auth-ok" } })) } },
    }));
    vi.doMock("@/lib/db", () => ({ db }));

    const internal = await createOrganization(db, { isInternal: true, isClient: false });
    const inviter = await createUser(db, internal.id, "SUPER_ADMIN");
    const { loadActor } = await import("@/lib/auth/permissions");
    const { createInvitation } = await import("@/lib/invitations/invitations");
    const client = await createOrganization(db, { isClient: true });
    const { token } = await createInvitation(db, await loadActor(db, inviter.id), {
      email: "new@client.com", organizationId: client.id, roleCode: "CLIENT_ADMIN",
    });

    const { acceptInvitationAction } = await import("@/app/invite/[token]/actions");
    const result = await acceptInvitationAction({
      token, name: "New User", password: "correct horse battery staple",
    });

    expect(result.ok).toBe(true);
    expect(await db.user.count({ where: { email: "new@client.com" } })).toBe(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/server-actions.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/auth/require"`.

- [ ] **Step 4: Write the action result helper**

```typescript
// src/lib/auth/require.ts
import { ApplicationError } from "@/lib/errors";
import { getCurrentActor } from "@/lib/auth/session";
import type { Actor } from "@/lib/auth/permissions";

export async function requireActor(): Promise<Actor> {
  return getCurrentActor();
}

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string };

/**
 * Server actions must return serialisable values, so expected failures become
 * results. An unexpected error is rethrown: swallowing it would hide a bug
 * behind a friendly message.
 */
export async function toActionResult<T>(fn: () => Promise<T>): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApplicationError) {
      return { ok: false, error: error.message, code: error.code };
    }
    throw error;
  }
}
```

- [ ] **Step 5: Write the Zustand stores**

These replace what would otherwise be React Context providers. They are plain modules — no provider wraps the tree, and a server component never imports them.

```typescript
// src/lib/stores/campaign-filters.ts
import { create } from "zustand";

export type CampaignStatusFilter =
  | "all"
  | "draft"
  | "pendingInternalApproval"
  | "pendingClientApproval"
  | "scheduled"
  | "live"
  | "paused"
  | "completed"
  | "cancelled";

type CampaignFiltersState = {
  status: CampaignStatusFilter;
  query: string;
  setStatus: (status: CampaignStatusFilter) => void;
  setQuery: (query: string) => void;
  reset: () => void;
};

export const useCampaignFilters = create<CampaignFiltersState>((set) => ({
  status: "all",
  query: "",
  setStatus: (status) => set({ status }),
  setQuery: (query) => set({ query }),
  reset: () => set({ status: "all", query: "" }),
}));
```

```typescript
// src/lib/stores/resolution-queue.ts
import { create } from "zustand";

type ResolutionQueueState = {
  selectedEntryId: string | null;
  select: (entryId: string) => void;
  clear: () => void;
};

export const useResolutionQueue = create<ResolutionQueueState>((set) => ({
  selectedEntryId: null,
  select: (entryId) => set({ selectedEntryId: entryId }),
  clear: () => set({ selectedEntryId: null }),
}));
```

- [ ] **Step 6: Write the campaign actions and pages**

```typescript
// src/app/(admin)/campaigns/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import {
  decideClientApproval,
  decideInternalApproval,
  submitForInternalApproval,
} from "@/lib/campaigns/state-machine";
import { cloneCampaign } from "@/lib/campaigns/clone";

export async function submitCampaignAction(campaignId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await submitForInternalApproval(db, actor, campaignId);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function approveInternalAction(
  campaignId: string,
  decision: "approved" | "rejected",
  comments?: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await decideInternalApproval(db, actor, campaignId, decision, comments);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function approveClientAction(
  campaignId: string,
  decision: "approved" | "rejected",
  comments?: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await decideClientApproval(db, actor, campaignId, decision, comments);
    revalidatePath(`/campaigns/${campaignId}`);
    return null;
  });
}

export async function cloneCampaignAction(
  campaignId: string,
  overrides: { code: string; name?: string; startDate: string; endDate: string },
): Promise<ActionResult<{ id: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const clone = await cloneCampaign(db, actor, campaignId, {
      code: overrides.code,
      name: overrides.name,
      startDate: new Date(overrides.startDate),
      endDate: new Date(overrides.endDate),
    });
    revalidatePath("/campaigns");
    return { id: clone.id };
  });
}
```

```tsx
// src/app/(admin)/campaigns/page.tsx
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CampaignTable } from "./campaign-table";

export default async function CampaignsPage() {
  const actor = await requireActor();
  assertPermission(actor, "campaign:read");

  // AUTH-9: a non-internal actor's list is filtered at the query, not the view.
  const campaigns = await db.campaign.findMany({
    where: {
      deletedAt: null,
      ...(actor.isInternal ? {} : { clientOrganizationId: actor.organizationId }),
    },
    include: { clientOrganization: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  // Serialise for the client component: Date and BigInt do not cross the boundary.
  const rows = campaigns.map((campaign) => ({
    id: campaign.id,
    code: campaign.code,
    name: campaign.name,
    clientName: campaign.clientOrganization.name,
    status: campaign.status,
    startDate: campaign.startDate.toISOString().slice(0, 10),
    endDate: campaign.endDate.toISOString().slice(0, 10),
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Campaigns</CardTitle>
      </CardHeader>
      <CardContent>
        <CampaignTable rows={rows} />
      </CardContent>
    </Card>
  );
}
```

The table is a client component because the status filter and search box read the Zustand store. It composes shadcn `Table`, `Input`, `Select` and `Badge` — nothing bespoke.

```tsx
// src/app/(admin)/campaigns/campaign-table.tsx
"use client";

import Link from "next/link";
import { useCampaignFilters, type CampaignStatusFilter } from "@/lib/stores/campaign-filters";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CampaignRow = {
  id: string;
  code: string;
  name: string;
  clientName: string;
  status: string;
  startDate: string;
  endDate: string;
};

const STATUSES: CampaignStatusFilter[] = [
  "all", "draft", "pendingInternalApproval", "pendingClientApproval",
  "scheduled", "live", "paused", "completed", "cancelled",
];

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "live") return "default";
  if (status === "cancelled") return "destructive";
  if (status === "completed") return "secondary";
  return "outline";
}

export function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  const { status, query, setStatus, setQuery } = useCampaignFilters();

  const visible = rows.filter((row) => {
    if (status !== "all" && row.status !== status) return false;
    if (query === "") return true;
    const needle = query.toLowerCase();
    return (
      row.code.toLowerCase().includes(needle) ||
      row.name.toLowerCase().includes(needle) ||
      row.clientName.toLowerCase().includes(needle)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="Search code, name or client"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="max-w-sm"
        />
        <Select value={status} onValueChange={(value) => setStatus(value as CampaignStatusFilter)}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((value) => (
              <SelectItem key={value} value={value}>{value}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Flight</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link href={`/campaigns/${row.id}`} className="underline">{row.code}</Link>
              </TableCell>
              <TableCell>{row.name}</TableCell>
              <TableCell>{row.clientName}</TableCell>
              <TableCell><Badge variant={statusVariant(row.status)}>{row.status}</Badge></TableCell>
              <TableCell>{row.startDate} – {row.endDate}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

```tsx
// src/app/(admin)/campaigns/[id]/page.tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { getCampaignForActor } from "@/lib/campaigns/crud";
import { hasPermission } from "@/lib/auth/permissions";
import { fromMinorUnits } from "@/lib/money/currency";
import { NotFoundError } from "@/lib/errors";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApprovalActions } from "./approval-actions";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireActor();

  let campaign;
  try {
    campaign = await getCampaignForActor(db, actor, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <Badge variant="outline">{campaign.code}</Badge>
        <Badge>{campaign.status}</Badge>
      </div>

      <ApprovalActions
        campaignId={campaign.id}
        status={campaign.status}
        canSubmit={hasPermission(actor, "campaign:submitInternal")}
        canApproveInternal={hasPermission(actor, "campaign:approveInternal")}
        canApproveClient={hasPermission(actor, "campaign:approveClient")}
      />

      <Card>
        <CardHeader><CardTitle>ICP criteria</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Dimension</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Values</TableHead>
                <TableHead>Mandatory</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.icpCriteria.map((criterion) => (
                <TableRow key={criterion.id}>
                  <TableCell>{criterion.dimension}</TableCell>
                  <TableCell>{criterion.operator}</TableCell>
                  <TableCell>{JSON.stringify(criterion.valuesJson)}</TableCell>
                  <TableCell>{criterion.isMandatory ? "yes" : "advisory"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Channels</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel type</TableHead>
                <TableHead>Quantity</TableHead>
                <TableHead>Unit price</TableHead>
                <TableHead>Window</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaign.channels.map((channel) => (
                <TableRow key={channel.id}>
                  <TableCell>
                    {(channel.channelTypeVersion.definitionJson as { code?: string }).code} v
                    {channel.channelTypeVersion.version}
                  </TableCell>
                  <TableCell>{channel.contractedQuantity}</TableCell>
                  <TableCell>
                    {channel.currency}{" "}
                    {fromMinorUnits(channel.clientUnitPriceMinor, channel.currency)}
                  </TableCell>
                  <TableCell>
                    {channel.startDate.toISOString().slice(0, 10)} –{" "}
                    {channel.endDate.toISOString().slice(0, 10)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
```

The approval controls are a client component so a failed action can surface through shadcn's `Sonner` toast rather than an unhandled rejection. Permission flags arrive from the server; they drive what renders, while the server action re-checks authorisation (NFR-S-1 — client-side role checks are presentational only).

```tsx
// src/app/(admin)/campaigns/[id]/approval-actions.tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  approveClientAction,
  approveInternalAction,
  submitCampaignAction,
} from "../actions";
import type { ActionResult } from "@/lib/auth/require";

type Props = {
  campaignId: string;
  status: string;
  canSubmit: boolean;
  canApproveInternal: boolean;
  canApproveClient: boolean;
};

export function ApprovalActions(props: Props) {
  const [pending, startTransition] = useTransition();
  const [comments, setComments] = useState("");
  const [open, setOpen] = useState(false);

  function run(work: () => Promise<ActionResult<unknown>>, success: string) {
    startTransition(async () => {
      const result = await work();
      if (result.ok) {
        toast.success(success);
        setOpen(false);
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <div className="flex gap-2">
      {props.canSubmit && props.status === "draft" && (
        <Button
          disabled={pending}
          onClick={() => run(() => submitCampaignAction(props.campaignId), "Sent for internal approval")}
        >
          Submit for internal approval
        </Button>
      )}

      {props.canApproveInternal && props.status === "pendingInternalApproval" && (
        <Button
          disabled={pending}
          onClick={() =>
            run(() => approveInternalAction(props.campaignId, "approved"), "Internally approved")
          }
        >
          Approve internally
        </Button>
      )}

      {props.canApproveClient && props.status === "pendingClientApproval" && (
        <>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => approveClientAction(props.campaignId, "approved"), "Campaign scheduled")
            }
          >
            Approve
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="destructive" disabled={pending}>Reject</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Reject this campaign</DialogTitle></DialogHeader>
              <Label htmlFor="comments">Why?</Label>
              <Input
                id="comments"
                value={comments}
                onChange={(event) => setComments(event.target.value)}
              />
              <DialogFooter>
                <Button
                  variant="destructive"
                  disabled={pending || comments.trim() === ""}
                  onClick={() =>
                    run(
                      () => approveClientAction(props.campaignId, "rejected", comments),
                      "Returned to draft",
                    )
                  }
                >
                  Reject and return to draft
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 7: Write the remaining actions and pages**

```typescript
// src/app/(admin)/channel-types/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { deactivateChannelType } from "@/lib/channel-types/crud";
import { publishChannelTypeVersion } from "@/lib/channel-types/versions";

export async function publishChannelTypeAction(
  channelTypeId: string,
): Promise<ActionResult<{ version: number }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const version = await publishChannelTypeVersion(db, actor, channelTypeId);
    revalidatePath("/channel-types");
    return { version: version.version };
  });
}

export async function deactivateChannelTypeAction(
  channelTypeId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await deactivateChannelType(db, actor, channelTypeId);
    revalidatePath("/channel-types");
    return null;
  });
}
```

```typescript
// src/app/(admin)/organizations/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import { createInvitation, resendInvitation, revokeInvitation } from "@/lib/invitations/invitations";
import type { RoleCode } from "@/lib/auth/permissions";

export async function inviteUserAction(input: {
  email: string;
  organizationId: string;
  roleCode: RoleCode;
}): Promise<ActionResult<{ invitationId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const { invitation } = await createInvitation(db, actor, input);
    revalidatePath(`/organizations/${input.organizationId}`);
    // The raw token is emailed, never returned to the caller.
    return { invitationId: invitation.id };
  });
}

export async function resendInvitationAction(invitationId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await resendInvitation(db, actor, invitationId);
    revalidatePath("/organizations");
    return null;
  });
}

export async function revokeInvitationAction(invitationId: string): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await revokeInvitation(db, actor, invitationId);
    revalidatePath("/organizations");
    return null;
  });
}
```

```typescript
// src/app/(admin)/resolution-queue/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireActor, toActionResult, type ActionResult } from "@/lib/auth/require";
import {
  rematchEntry,
  resolveEntryByCreatingAccount,
  resolveEntryToAccount,
} from "@/lib/identity/resolution-queue";

export async function resolveEntryAction(
  entryId: string,
  accountId: string,
): Promise<ActionResult<null>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    await resolveEntryToAccount(db, actor, entryId, accountId);
    revalidatePath("/resolution-queue");
    return null;
  });
}

export async function createAccountForEntryAction(
  entryId: string,
): Promise<ActionResult<{ accountId: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const result = await resolveEntryByCreatingAccount(db, actor, entryId);
    revalidatePath("/resolution-queue");
    return result;
  });
}

export async function rematchEntryAction(entryId: string): Promise<ActionResult<{ status: string }>> {
  return toActionResult(async () => {
    const actor = await requireActor();
    const status = await rematchEntry(db, actor, entryId);
    revalidatePath("/resolution-queue");
    return { status };
  });
}
```

```tsx
// src/app/(admin)/resolution-queue/page.tsx
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { listUnresolvedEntries } from "@/lib/identity/resolution-queue";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertTitle } from "@/components/ui/alert";

export default async function ResolutionQueuePage() {
  const actor = await requireActor();
  const { entries } = await listUnresolvedEntries(db, actor, { limit: 50 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Account resolution queue</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {entries.length === 0 ? (
          <Alert>
            <AlertTitle>Nothing awaiting a decision.</AlertTitle>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>List</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Domain</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Candidates</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{entry.listName}</TableCell>
                  <TableCell>{entry.rawName ?? "—"}</TableCell>
                  <TableCell>{entry.rawDomain ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={entry.matchStatus === "ambiguous" ? "destructive" : "outline"}>
                      {entry.matchStatus}
                    </Badge>
                  </TableCell>
                  <TableCell>{entry.candidateAccountIds.length}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
```

The row-level resolve, create-account and rematch controls are a client component using shadcn `DropdownMenu` plus the `useResolutionQueue` store for the selected row; it calls `resolveEntryAction`, `createAccountForEntryAction` and `rematchEntryAction` the same way `ApprovalActions` does.

```tsx
// src/app/(admin)/channel-types/page.tsx
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function ChannelTypesPage() {
  const actor = await requireActor();
  assertPermission(actor, "channelType:read");

  const channelTypes = await db.channelType.findMany({
    include: { funnelStage: true },
    orderBy: [{ funnelStage: { sortOrder: "asc" } }, { name: "asc" }],
  });

  return (
    <Card>
      <CardHeader><CardTitle>Channel types</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Stage</TableHead>
              <TableHead>Code</TableHead>
              <TableHead>Pricing</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Active</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {channelTypes.map((channelType) => (
              <TableRow key={channelType.id}>
                <TableCell>{channelType.funnelStage.name}</TableCell>
                <TableCell>{channelType.code}</TableCell>
                <TableCell>{channelType.pricingUnit}</TableCell>
                <TableCell>v{channelType.currentVersion}</TableCell>
                <TableCell>
                  <Badge variant={channelType.isActive ? "default" : "secondary"}>
                    {channelType.isActive ? "active" : "inactive"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

Publish and deactivate are a client component calling `publishChannelTypeAction` and `deactivateChannelTypeAction`, rendered only for an actor holding `channelType:publish` / `channelType:write`.

```tsx
// src/app/(admin)/organizations/page.tsx
import { db } from "@/lib/db";
import { requireActor } from "@/lib/auth/require";
import { assertPermission } from "@/lib/auth/permissions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default async function OrganizationsPage() {
  const actor = await requireActor();
  assertPermission(actor, "organization:read");

  const organizations = await db.organization.findMany({
    where: {
      deletedAt: null,
      ...(actor.isInternal ? {} : { id: actor.organizationId }),
    },
    include: { _count: { select: { users: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <Card>
      <CardHeader><CardTitle>Organisations</CardTitle></CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {organizations.map((organization) => (
              <TableRow key={organization.id}>
                <TableCell>{organization.name}</TableCell>
                <TableCell className="space-x-1">
                  {organization.isClient && <Badge variant="outline">client</Badge>}
                  {organization.isPartner && <Badge variant="outline">partner</Badge>}
                  {organization.isInternal && <Badge variant="outline">internal</Badge>}
                </TableCell>
                <TableCell>{organization._count.users}</TableCell>
                <TableCell><Badge>{organization.status}</Badge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
```

The invite control is a shadcn `Dialog` wrapping a shadcn `Form` (email, role `Select`) that calls `inviteUserAction`; resend and revoke sit in a `DropdownMenu` on each pending invitation row.

The admin shell comes from the shadcn sidebar block added in Step 1 — adapt its nav items rather than writing a layout from scratch.

```tsx
// src/app/(admin)/layout.tsx
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

const NAV = [
  { href: "/campaigns", label: "Campaigns" },
  { href: "/channel-types", label: "Channel types" },
  { href: "/organizations", label: "Organisations" },
  { href: "/resolution-queue", label: "Resolution queue" },
] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider>
      <Sidebar>
        <SidebarContent>
          <SidebarMenu>
            {NAV.map((item) => (
              <SidebarMenuItem key={item.href}>
                <SidebarMenuButton asChild>
                  <Link href={item.href}>{item.label}</Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
      </Sidebar>
      <SidebarInset>
        <header className="flex h-12 items-center gap-2 border-b px-4">
          <SidebarTrigger />
        </header>
        <main className="p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
```

`SidebarProvider` is shadcn's own component and is the one permitted exception to the no-React-Context rule: it is part of the library, not application state. Application state stays in Zustand.

Mount shadcn's toaster once in the root layout so every action's `toast` call has somewhere to land:

```tsx
// src/app/layout.tsx — add to the body
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";
// ...
      <body>
        {children}
        <Toaster />
      </body>
```

- [ ] **Step 8: Write the invitation acceptance page and action**

```typescript
// src/app/invite/[token]/actions.ts
"use server";

import { db } from "@/lib/db";
import { toActionResult, type ActionResult } from "@/lib/auth/require";
import { acceptInvitation } from "@/lib/invitations/invitations";

/** Unauthenticated by design: the token in the URL is the credential (AUTH-3). */
export async function acceptInvitationAction(input: {
  token: string;
  name: string;
  password: string;
}): Promise<ActionResult<{ userId: string }>> {
  return toActionResult(() => acceptInvitation(db, input));
}
```

```tsx
// src/app/invite/[token]/page.tsx
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { hashToken } from "@/lib/invitations/invitations";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AcceptForm } from "./accept-form";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { organization: { select: { name: true } }, role: { select: { name: true } } },
  });

  if (invitation === null || invitation.status !== "pending") notFound();

  const expired = invitation.expiresAt.getTime() <= Date.now();

  return (
    <div className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>Accept your invitation</CardTitle>
        </CardHeader>
        <CardContent>
          {expired ? (
            <Alert variant="destructive">
              <AlertTitle>This invitation has expired.</AlertTitle>
              <AlertDescription>Ask your administrator to resend it.</AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                You have been invited to {invitation.organization.name} as {invitation.role.name}.
              </p>
              <AcceptForm token={token} email={invitation.email} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

```tsx
// src/app/invite/[token]/accept-form.tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { acceptInvitationAction } from "./actions";

export function AcceptForm({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitationAction({
        token,
        name: String(formData.get("name") ?? ""),
        password: String(formData.get("password") ?? ""),
      });
      if (result.ok) {
        toast.success("Account created");
        router.push("/campaigns");
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <form action={onSubmit} className="space-y-4">
      {/* AUTH-4: the invited address is fixed and cannot be changed at acceptance. */}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" value={email} disabled readOnly />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" name="name" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" required minLength={12} />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Creating your account…" : "Accept invitation"}
      </Button>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">{error}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 9: Run the tests, the type check and the build**

Run: `pnpm test tests/server-actions.test.ts && pnpm typecheck && pnpm lint && pnpm build`
Expected: PASS, clean typecheck and lint, successful build.

Then confirm the UI rules held:

```bash
git status --short src/components/ui   # every file here came from the shadcn CLI
grep -rn "createContext" src/ | grep -v components/ui   # must return nothing
```

Expected: no application file calls `createContext` — client state is in `src/lib/stores/`, and the only Context in the tree is shadcn's own `SidebarProvider`. If any screen needed a component that is not a shadcn primitive or block, it should have been raised with the user before it was written.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat: add shadcn admin console, zustand stores and invitation acceptance"
```

---

### Task 24: Docker, health endpoints, worker entrypoint and the deploy path

DEP-1 through DEP-6, NFR-O-2 and NFR-O-3. This is what makes Phase 1 deployable rather than merely tested.

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `src/app/api/health/route.ts`, `src/app/api/health/ready/route.ts`, `src/lib/logging/logger.ts`, `src/worker/index.ts`, `docs/deployment.md`
- Modify: `package.json` (worker script), `docker-compose.yml`
- Test: `tests/health.test.ts`

**Interfaces:**
- Consumes: `db` (Task 3), `activateDueCampaigns`/`completeFinishedCampaigns` (Task 20).
- Produces:
  - `GET /api/health` — liveness, always 200 when the process is up.
  - `GET /api/health/ready` — readiness, 200 only when the database answers.
  - `logger` — structured JSON logger carrying a correlation id.
  - `pnpm worker` — the scheduled-transition runner.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/health.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetDb, testDb } from "./helpers/db";

describe("health endpoints (NFR-O-3)", () => {
  beforeEach(async () => {
    await resetDb();
    vi.resetModules();
  });

  it("liveness returns 200 without touching the database", async () => {
    const { GET } = await import("@/app/api/health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
  });

  it("readiness returns 200 when the database answers", async () => {
    vi.doMock("@/lib/db", () => ({ db: testDb() }));
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready" });
  });

  it("readiness returns 503 when the database is unreachable", async () => {
    vi.doMock("@/lib/db", () => ({
      db: { $queryRaw: async () => { throw new Error("connection refused"); } },
    }));
    const { GET } = await import("@/app/api/health/ready/route");
    const response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).status).toBe("unavailable");
  });
});

describe("structured logging (NFR-O-2)", () => {
  it("emits JSON carrying the correlation id", async () => {
    const { logger } = await import("@/lib/logging/logger");
    const written: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      written.push(String(line));
    });

    logger.info("campaign.transition", { campaignId: "c1", correlationId: "req-1" });

    spy.mockRestore();
    const parsed = JSON.parse(written[0] ?? "{}");
    expect(parsed.level).toBe("info");
    expect(parsed.message).toBe("campaign.transition");
    expect(parsed.correlationId).toBe("req-1");
    expect(parsed.campaignId).toBe("c1");
    expect(typeof parsed.timestamp).toBe("string");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/health.test.ts`
Expected: FAIL — `Failed to resolve import "@/app/api/health/route"`.

- [ ] **Step 3: Write the health routes and the logger**

```typescript
// src/app/api/health/route.ts
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({ status: "ok" });
}
```

```typescript
// src/app/api/health/ready/route.ts
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ready" });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
```

```typescript
// src/lib/logging/logger.ts
type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(level: Level, message: string, fields: Fields): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), level, message, ...fields }));
}

export const logger = {
  debug: (message: string, fields: Fields = {}) => emit("debug", message, fields),
  info: (message: string, fields: Fields = {}) => emit("info", message, fields),
  warn: (message: string, fields: Fields = {}) => emit("warn", message, fields),
  error: (message: string, fields: Fields = {}) => emit("error", message, fields),
};
```

- [ ] **Step 4: Write the worker entrypoint**

DEP-2: the same image, a different entrypoint. Phase 3 adds intake and delivery jobs to this loop.

```typescript
// src/worker/index.ts
import { db } from "@/lib/db";
import { logger } from "@/lib/logging/logger";
import { activateDueCampaigns, completeFinishedCampaigns } from "@/lib/campaigns/state-machine";

const INTERVAL_MS = Number.parseInt(process.env.WORKER_INTERVAL_MS ?? "60000", 10);

async function tick(): Promise<void> {
  const now = new Date();
  const correlationId = crypto.randomUUID();
  try {
    const activated = await activateDueCampaigns(db, now);
    const completed = await completeFinishedCampaigns(db, now);
    logger.info("worker.tick", { correlationId, activated, completed });
  } catch (error) {
    logger.error("worker.tick.failed", {
      correlationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function main(): Promise<void> {
  logger.info("worker.start", { intervalMs: INTERVAL_MS });
  await tick();
  setInterval(() => void tick(), INTERVAL_MS);
}

void main();
```

Add to `package.json`: `"worker": "tsx src/worker/index.ts"`.

- [ ] **Step 5: Write the Dockerfile**

```dockerfile
# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm prisma generate && pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
USER app
EXPOSE 3000
CMD ["node", "server.js"]
```

```
# .dockerignore
node_modules
.next
.git
coverage
*.md
.env
.env.local
```

- [ ] **Step 6: Document the deploy path**

```markdown
<!-- docs/deployment.md -->
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
```

- [ ] **Step 7: Verify the whole suite, the build and the seed**

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
docker compose up -d postgres
pnpm prisma migrate deploy && pnpm db:seed && pnpm db:seed   # idempotence check
docker build -t intellifunnel-console:phase1 .
```

Expected: every test passes, typecheck and lint are clean, the build emits standalone output, the seed runs twice without error or duplicate rows, and the image builds.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add docker build, health endpoints, worker entrypoint and deploy docs"
```

---

## Phase 1 completion checklist

Run before declaring the phase done. Each line is a spec requirement, not a preference.

- [ ] `pnpm test` — every suite green against a real Postgres.
- [ ] `pnpm typecheck` — clean under `strict` and `noUncheckedIndexedAccess`.
- [ ] `pnpm build` — standalone output produced.
- [ ] `pnpm db:seed` run twice produces the same row counts (DEP-6, idempotent).
- [ ] Seeded: 10 roles, 7 platform settings, 4 funnel stages, 5 channel types, ≥20 reject reasons.
- [ ] `UPDATE`/`DELETE` on `AuditLog` are rejected by the database (NFR-A-2).
- [ ] Every monetary column stores minor units with an adjacent currency column (CUR-1, CUR-6).
- [ ] No service function reads data without an `Actor` argument (AUTH-8).
- [ ] `docker build` succeeds and the container answers `/api/health/ready`.
- [ ] Node is 24.x everywhere: `.nvmrc`, `engines`, and all three Dockerfile stages.
- [ ] No dependency is pinned to an older version without a recorded reason and the user's approval; `docs/tooling.md` lists what actually resolved.
- [ ] Every file in `src/components/ui/` was produced by the shadcn CLI, and no from-scratch component was added without approval.
- [ ] `grep -rn "createContext" src/ | grep -v components/ui` returns nothing — client state is Zustand.

## Deferred to later phases, deliberately

These Phase 1 tables exist but carry no behaviour yet. That is per SRS §10, not an oversight.

| Table | Created in | Enforced in |
|---|---|---|
| `DoNotContact` | Task 12 | Phase 5 (FR-IN-4 check 3, FR-CP-5) |
| `Holiday` | Task 9 | Phase 3 (FR-VF-2b, the business-day SLA clock) |
| `RejectReason` | Task 14 | Phase 3 (FR-IN-5, FR-VF-4) |
| `ExchangeRate` | Task 5 | Phase 5 commercials (CUR-3 conversions at transaction time) |
| `ImportBatch` / `ImportError` | Task 17 | Reused by Phase 3 lead intake (FR-IN-2, FR-IN-3) |
| `isSuppressed` | Task 19 | Called by Phase 3's intake pipeline (FR-IN-4 check 4) |
| `resolveAccountCap` | Task 18 | Called by Phase 3's intake and acceptance (FR-IN-8) |

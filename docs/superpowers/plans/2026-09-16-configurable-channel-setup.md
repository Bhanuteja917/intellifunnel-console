# Configurable Channel Setup Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded channel setup checklist with per-channel `ChannelSetupStep` rows driven by a code catalog, so operators can add/remove/soften steps while a channel is a draft, and add a withdraw path from `pending` back to `draft`.

**Architecture:** A fixed catalog of step definitions lives in code (`src/lib/channels/step-catalog.ts`) as pure functions over a `ChannelFacts` bag. Each channel holds one `ChannelSetupStep` row per step it actually has; an absent row means the step is off. Readiness and the submit gate both read those rows joined against the catalog, so the badge, the checklist and what the server allows can never disagree.

**Tech Stack:** Next.js (App Router, server actions), Prisma + PostgreSQL, TypeScript, Vitest against a real database, shadcn/ui + Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-16-configurable-channel-setup-design.md`

## Global Constraints

- Read `node_modules/next/dist/docs/` before writing Next.js code. This Next.js version has breaking changes versus training data. See `AGENTS.md`.
- Tests run against a real PostgreSQL database. Never mock Prisma. `resetDb()` truncates every table; call it in `beforeEach`.
- Run tests with `npx vitest run <path>`. Typecheck with `npx tsc --noEmit`. Lint with `npx eslint .`.
- Migrations are handwritten SQL in `prisma/migrations/<timestamp>_<name>/migration.sql`, applied with `npx prisma migrate deploy` followed by `npx prisma generate`. Do not use `prisma migrate dev` — it will try to author its own SQL and lose the backfill.
- Money is `BigInt` minor units. Never `JSON.stringify` a BigInt.
- Every mutating library function asserts a permission via `assertPermission(actor, ...)`, asserts org access, and writes an audit row via `writeAudit`/`withAudit`.
- Default to no code comments. Add one only where the *why* is non-obvious.
- Commit after every task.

---

### Task 1: Step catalog module

**Files:**
- Create: `src/lib/channels/step-catalog.ts`
- Test: `tests/channel-step-catalog.test.ts`

**Interfaces:**
- Consumes: `ChannelTypeDefinition` from `@/lib/channel-types/versions`.
- Produces: `ChannelFacts`, `CatalogEntry`, `STEP_CATALOG`, `catalogEntry(key)`, `seedPlan(def)`. Later tasks import all five.

This task writes the catalog against string-literal types, **not** the Prisma enums — the enums do not exist until Task 2. Task 2 swaps the local types for the generated ones.

- [ ] **Step 1: Write the failing test**

Create `tests/channel-step-catalog.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { STEP_CATALOG, catalogEntry, seedPlan } from "@/lib/channels/step-catalog";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

const definition = (overrides: Partial<ChannelTypeDefinition> = {}): ChannelTypeDefinition => ({
  channelTypeId: "ct1",
  code: "CT",
  name: "Test Channel",
  funnelStageCode: "MOFU",
  producesLeads: true,
  requiresAsset: true,
  metricMode: "none",
  allowedMetricFields: [],
  pricingUnit: "CPL",
  requiresTeleVerification: false,
  verificationSlaBusinessDays: null,
  qualificationFormId: null,
  questions: [],
  ...overrides,
});

const facts = {
  hasTerms: false,
  icpCount: 0,
  hasEmailSpec: false,
  activePlacementCount: 0,
  allocationCount: 0,
};

describe("STEP_CATALOG", () => {
  it("locks channelTerms and nothing else", () => {
    expect(STEP_CATALOG.filter((e) => e.locked).map((e) => e.key)).toEqual(["channelTerms"]);
  });

  it("marks the two deferred list steps unavailable", () => {
    expect(STEP_CATALOG.filter((e) => !e.available).map((e) => e.key)).toEqual([
      "targetAccountList",
      "suppressionList",
    ]);
  });

  it("gives every entry a unique key", () => {
    expect(new Set(STEP_CATALOG.map((e) => e.key)).size).toBe(STEP_CATALOG.length);
  });
});

describe("seedPlan", () => {
  it("seeds terms, icp, lead spec, placement and allocations for a lead channel with an asset", () => {
    expect(seedPlan(definition())).toEqual([
      { stepKey: "channelTerms", requirement: "required", sortOrder: 0 },
      { stepKey: "icp", requirement: "required", sortOrder: 1 },
      { stepKey: "leadSpec", requirement: "required", sortOrder: 2 },
      { stepKey: "placement", requirement: "required", sortOrder: 3 },
      { stepKey: "allocations", requirement: "optional", sortOrder: 4 },
    ]);
  });

  it("seeds no icp or lead spec for an impression-only channel", () => {
    const plan = seedPlan(definition({ producesLeads: false, requiresAsset: false }));
    expect(plan.map((s) => s.stepKey)).toEqual(["channelTerms", "allocations"]);
  });

  it("seeds no placement when the channel type needs no asset", () => {
    const plan = seedPlan(definition({ requiresAsset: false }));
    expect(plan.map((s) => s.stepKey)).not.toContain("placement");
  });

  it("never seeds a deferred step", () => {
    const plan = seedPlan(definition());
    expect(plan.map((s) => s.stepKey)).not.toContain("targetAccountList");
    expect(plan.map((s) => s.stepKey)).not.toContain("suppressionList");
  });
});

describe("applies", () => {
  it("offers icp on an impression-only channel but not leadSpec", () => {
    const def = definition({ producesLeads: false });
    expect(catalogEntry("icp")?.applies(def)).toBe(true);
    expect(catalogEntry("leadSpec")?.applies(def)).toBe(false);
  });

  it("offers placement only when the channel type needs an asset", () => {
    expect(catalogEntry("placement")?.applies(definition({ requiresAsset: false }))).toBe(false);
    expect(catalogEntry("placement")?.applies(definition())).toBe(true);
  });
});

describe("isDone", () => {
  it("completes channelTerms once the channel has quantity and a price", () => {
    expect(catalogEntry("channelTerms")?.isDone({ ...facts, hasTerms: true })).toBe(true);
    expect(catalogEntry("channelTerms")?.isDone(facts)).toBe(false);
  });

  it("completes icp on the first criterion", () => {
    expect(catalogEntry("icp")?.isDone({ ...facts, icpCount: 1 })).toBe(true);
  });

  it("completes leadSpec only when an email field exists", () => {
    expect(catalogEntry("leadSpec")?.isDone({ ...facts, hasEmailSpec: true })).toBe(true);
    expect(catalogEntry("leadSpec")?.isDone(facts)).toBe(false);
  });

  it("completes placement on the first active placement", () => {
    expect(catalogEntry("placement")?.isDone({ ...facts, activePlacementCount: 1 })).toBe(true);
  });

  it("completes allocations on the first allocation", () => {
    expect(catalogEntry("allocations")?.isDone({ ...facts, allocationCount: 1 })).toBe(true);
  });

  it("never completes a deferred step", () => {
    expect(catalogEntry("suppressionList")?.isDone({ ...facts, icpCount: 9 })).toBe(false);
  });
});

describe("href", () => {
  it("points placement at the placements tab, not the singular step key", () => {
    expect(catalogEntry("placement")?.href("cam1", "ch1")).toBe(
      "/campaigns/cam1/channels/ch1?tab=placements",
    );
  });

  it("points icp and lead spec at the terms tab where their editors live", () => {
    expect(catalogEntry("icp")?.href("cam1", "ch1")).toBe("/campaigns/cam1/channels/ch1?tab=terms");
    expect(catalogEntry("leadSpec")?.href("cam1", "ch1")).toBe(
      "/campaigns/cam1/channels/ch1?tab=terms",
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/channel-step-catalog.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/channels/step-catalog"`.

- [ ] **Step 3: Write the catalog**

Create `src/lib/channels/step-catalog.ts`:

```ts
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

export type ChannelSetupStepKey =
  | "channelTerms"
  | "icp"
  | "leadSpec"
  | "placement"
  | "allocations"
  | "targetAccountList"
  | "suppressionList";

export type ChannelSetupRequirement = "required" | "optional";

export type ChannelFacts = {
  hasTerms: boolean;
  icpCount: number;
  hasEmailSpec: boolean;
  activePlacementCount: number;
  allocationCount: number;
};

export type CatalogEntry = {
  key: ChannelSetupStepKey;
  title: string;
  hint: string;
  cta: string;
  href: (campaignId: string, channelId: string) => string;
  locked: boolean;
  available: boolean;
  applies: (def: ChannelTypeDefinition) => boolean;
  seedDefault: (def: ChannelTypeDefinition) => ChannelSetupRequirement | null;
  isDone: (facts: ChannelFacts) => boolean;
};

const tab = (name: string) => (campaignId: string, channelId: string) =>
  `/campaigns/${campaignId}/channels/${channelId}?tab=${name}`;

export const STEP_CATALOG: readonly CatalogEntry[] = [
  {
    key: "channelTerms",
    title: "Set channel terms",
    hint: "Contracted quantity, unit price, flight window",
    cta: "Edit terms",
    href: tab("terms"),
    locked: true,
    available: true,
    applies: () => true,
    seedDefault: () => "required",
    isDone: (f) => f.hasTerms,
  },
  {
    key: "icp",
    title: "Define the ICP",
    hint: "Criteria a lead's account must match",
    cta: "Edit ICP",
    href: tab("terms"),
    locked: false,
    available: true,
    applies: () => true,
    seedDefault: (def) => (def.producesLeads ? "required" : null),
    isDone: (f) => f.icpCount > 0,
  },
  {
    key: "leadSpec",
    title: "Define the lead spec",
    hint: "Fields every delivered lead must carry, including email",
    cta: "Edit lead spec",
    href: tab("terms"),
    locked: false,
    available: true,
    applies: (def) => def.producesLeads,
    seedDefault: (def) => (def.producesLeads ? "required" : null),
    isDone: (f) => f.hasEmailSpec,
  },
  {
    key: "placement",
    title: "Add a placement",
    hint: "Asset version, landing page, form slug, consent text",
    cta: "Add placement",
    href: tab("placements"),
    locked: false,
    available: true,
    applies: (def) => def.requiresAsset,
    seedDefault: (def) => (def.requiresAsset ? "required" : null),
    isDone: (f) => f.activePlacementCount > 0,
  },
  {
    key: "allocations",
    title: "Allocate partner quota",
    hint: "Leave unallocated to run this channel in-house",
    cta: "Allocate",
    href: tab("allocations"),
    locked: false,
    available: true,
    applies: () => true,
    seedDefault: () => "optional",
    isDone: (f) => f.allocationCount > 0,
  },
  {
    key: "targetAccountList",
    title: "Attach a target account list",
    hint: "Accounts this channel may deliver against",
    cta: "Attach list",
    href: tab("terms"),
    locked: false,
    available: false,
    applies: () => true,
    seedDefault: () => null,
    isDone: () => false,
  },
  {
    key: "suppressionList",
    title: "Attach a suppression list",
    hint: "Accounts, domains and contacts this channel must never deliver",
    cta: "Attach list",
    href: tab("terms"),
    locked: false,
    available: false,
    applies: () => true,
    seedDefault: () => null,
    isDone: () => false,
  },
];

export function catalogEntry(key: ChannelSetupStepKey): CatalogEntry | undefined {
  return STEP_CATALOG.find((e) => e.key === key);
}

export type SeededStep = {
  stepKey: ChannelSetupStepKey;
  requirement: ChannelSetupRequirement;
  sortOrder: number;
};

export function seedPlan(def: ChannelTypeDefinition): SeededStep[] {
  return STEP_CATALOG.flatMap((entry, index) => {
    if (!entry.available || !entry.applies(def)) return [];
    const requirement = entry.seedDefault(def);
    if (requirement === null) return [];
    return [{ stepKey: entry.key, requirement, sortOrder: index }];
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/channel-step-catalog.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/channels/step-catalog.ts tests/channel-step-catalog.test.ts
git commit -m "feat: add channel setup step catalog"
```

---

### Task 2: Schema, migration and backfill

**Files:**
- Modify: `prisma/schema.prisma` (add two enums and `ChannelSetupStep`; add the relation field to `CampaignChannel`)
- Create: `prisma/migrations/20260916000000_add_channel_setup_step/migration.sql`
- Modify: `src/lib/channels/step-catalog.ts` (swap local string unions for generated Prisma enums)
- Test: `tests/channel-setup-step-backfill.test.ts`

**Interfaces:**
- Consumes: `seedPlan` semantics from Task 1 — the SQL must produce the same rows the catalog would.
- Produces: Prisma types `ChannelSetupStep`, `ChannelSetupStepKey`, `ChannelSetupRequirement`, importable from `@prisma/client` by every later task.

`stepConfigJson` is **not** dropped here. It is still read by `readiness.ts` and `state-machine.ts`; Task 4 removes both readers and drops the column.

- [ ] **Step 1: Add the schema**

In `prisma/schema.prisma`, add near the other channel models:

```prisma
enum ChannelSetupStepKey {
  channelTerms
  icp
  leadSpec
  placement
  allocations
  targetAccountList
  suppressionList
}

enum ChannelSetupRequirement {
  required
  optional
}

model ChannelSetupStep {
  id                String                  @id @default(cuid())
  campaignChannelId String
  stepKey           ChannelSetupStepKey
  requirement       ChannelSetupRequirement @default(required)
  sortOrder         Int
  createdAt         DateTime                @default(now())
  updatedAt         DateTime                @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])

  @@unique([campaignChannelId, stepKey])
  @@index([campaignChannelId])
}
```

Add to `model CampaignChannel`, beside `pacingBuckets`:

```prisma
  setupSteps         ChannelSetupStep[]
```

- [ ] **Step 2: Write the migration**

Create `prisma/migrations/20260916000000_add_channel_setup_step/migration.sql`:

```sql
-- Step 1: enums
CREATE TYPE "ChannelSetupStepKey" AS ENUM ('channelTerms', 'icp', 'leadSpec', 'placement', 'allocations', 'targetAccountList', 'suppressionList');
CREATE TYPE "ChannelSetupRequirement" AS ENUM ('required', 'optional');

-- Step 2: table
CREATE TABLE "ChannelSetupStep" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "stepKey" "ChannelSetupStepKey" NOT NULL,
    "requirement" "ChannelSetupRequirement" NOT NULL DEFAULT 'required',
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,
    CONSTRAINT "ChannelSetupStep_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ChannelSetupStep_campaignChannelId_stepKey_key" ON "ChannelSetupStep"("campaignChannelId", "stepKey");
CREATE INDEX "ChannelSetupStep_campaignChannelId_idx" ON "ChannelSetupStep"("campaignChannelId");

ALTER TABLE "ChannelSetupStep" ADD CONSTRAINT "ChannelSetupStep_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 3: backfill every existing channel from stepConfigJson and its frozen
-- channel type definition. Idempotent: the NOT EXISTS guard means re-running
-- this statement is a no-op, which is what lets the test exercise it.
INSERT INTO "ChannelSetupStep" ("id", "campaignChannelId", "stepKey", "requirement", "sortOrder", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  cc."id",
  s.step_key::"ChannelSetupStepKey",
  s.requirement::"ChannelSetupRequirement",
  s.sort_order,
  now(),
  now()
FROM "CampaignChannel" cc
JOIN "ChannelTypeVersion" ctv ON ctv."id" = cc."channelTypeVersionId"
CROSS JOIN LATERAL (
  VALUES
    ('channelTerms'::text, 'required'::text, 0),
    ('icp'::text,
     CASE WHEN (ctv."definitionJson"->>'producesLeads')::boolean IS TRUE THEN 'required' END,
     1),
    ('leadSpec'::text,
     CASE WHEN (ctv."definitionJson"->>'producesLeads')::boolean IS TRUE THEN 'required' END,
     2),
    ('placement'::text,
     CASE
       WHEN (ctv."definitionJson"->>'requiresAsset')::boolean IS NOT TRUE THEN NULL
       WHEN cc."stepConfigJson"->>'placement' = 'skipped' THEN NULL
       WHEN cc."stepConfigJson"->>'placement' = 'optional' THEN 'optional'
       ELSE 'required'
     END,
     3),
    ('allocations'::text,
     CASE
       WHEN cc."stepConfigJson"->>'allocations' = 'skipped' THEN NULL
       WHEN cc."stepConfigJson"->>'allocations' = 'enabled' THEN 'required'
       ELSE 'optional'
     END,
     4)
) AS s(step_key, requirement, sort_order)
WHERE s.requirement IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "ChannelSetupStep" existing
    WHERE existing."campaignChannelId" = cc."id"
      AND existing."stepKey" = s.step_key::"ChannelSetupStepKey"
  );
```

- [ ] **Step 3: Apply the migration and regenerate**

```bash
npx prisma migrate deploy && npx prisma generate
```

Expected: `1 migration applied`, then `Generated Prisma Client`.

- [ ] **Step 4: Point the catalog at the generated enums**

In `src/lib/channels/step-catalog.ts`, delete the two local type aliases and re-export the generated ones so every consumer has one source:

```ts
import type { ChannelSetupStepKey, ChannelSetupRequirement } from "@prisma/client";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";

export type { ChannelSetupStepKey, ChannelSetupRequirement };
```

Everything else in the file is unchanged.

- [ ] **Step 5: Write the failing backfill test**

Create `tests/channel-setup-step-backfill.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";

const MIGRATION = "prisma/migrations/20260916000000_add_channel_setup_step/migration.sql";

/** The backfill is the one INSERT in the migration; the rest is DDL already applied. */
function backfillStatement(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const statement = sql
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("INSERT INTO \"ChannelSetupStep\""));
  if (statement === undefined) throw new Error("backfill INSERT not found in migration");
  return statement;
}

async function runBackfill(): Promise<void> {
  await testDb().$executeRawUnsafe(backfillStatement());
}

async function keysFor(channelId: string) {
  const rows = await testDb().channelSetupStep.findMany({
    where: { campaignChannelId: channelId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => [r.stepKey, r.requirement]);
}

describe("channel setup step backfill", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("seeds terms, icp, lead spec, placement and allocations for a lead channel with no overrides", async () => {
    const fx = await createChannelFixture(testDb());
    await runBackfill();

    expect(await keysFor(fx.channelId)).toEqual([
      ["channelTerms", "required"],
      ["icp", "required"],
      ["leadSpec", "required"],
      ["placement", "required"],
      ["allocations", "optional"],
    ]);
  });

  it("softens placement to optional when the override said optional", async () => {
    const fx = await createChannelFixture(testDb());
    await testDb().campaignChannel.update({
      where: { id: fx.channelId },
      data: { stepConfigJson: { placement: "optional" } },
    });
    await runBackfill();

    expect(await keysFor(fx.channelId)).toContainEqual(["placement", "optional"]);
  });

  it("drops placement entirely when the override said skipped", async () => {
    const fx = await createChannelFixture(testDb());
    await testDb().campaignChannel.update({
      where: { id: fx.channelId },
      data: { stepConfigJson: { placement: "skipped" } },
    });
    await runBackfill();

    expect((await keysFor(fx.channelId)).map(([key]) => key)).not.toContain("placement");
  });

  it("hardens allocations to required when the override said enabled", async () => {
    const fx = await createChannelFixture(testDb());
    await testDb().campaignChannel.update({
      where: { id: fx.channelId },
      data: { stepConfigJson: { allocations: "enabled" } },
    });
    await runBackfill();

    expect(await keysFor(fx.channelId)).toContainEqual(["allocations", "required"]);
  });

  it("drops placement for a channel type that needs no asset", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await runBackfill();

    expect((await keysFor(fx.channelId)).map(([key]) => key)).toEqual([
      "channelTerms",
      "icp",
      "leadSpec",
      "allocations",
    ]);
  });

  it("seeds no icp or lead spec for an impression-only channel", async () => {
    const fx = await createChannelFixture(testDb());
    const channel = await testDb().campaignChannel.findUniqueOrThrow({
      where: { id: fx.channelId },
      include: { channelTypeVersion: true },
    });
    const definition = channel.channelTypeVersion.definitionJson as Record<string, unknown>;
    await testDb().channelTypeVersion.update({
      where: { id: channel.channelTypeVersionId },
      data: { definitionJson: { ...definition, producesLeads: false, requiresAsset: false } },
    });
    await runBackfill();

    expect((await keysFor(fx.channelId)).map(([key]) => key)).toEqual([
      "channelTerms",
      "allocations",
    ]);
  });

  it("is idempotent", async () => {
    const fx = await createChannelFixture(testDb());
    await runBackfill();
    await runBackfill();

    expect(await keysFor(fx.channelId)).toHaveLength(5);
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npx vitest run tests/channel-setup-step-backfill.test.ts`
Expected: PASS, 7 tests. `resetDb()` truncates `ChannelSetupStep` too, so each test starts with no rows and exercises the real INSERT.

If a test fails with `column reference "definitionJson" is ambiguous` or a VALUES type error, the `::text` casts on the first VALUES row are what fix it — Postgres infers each column's type from that row.

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npx vitest run && npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations/20260916000000_add_channel_setup_step src/lib/channels/step-catalog.ts tests/channel-setup-step-backfill.test.ts
git commit -m "feat: add ChannelSetupStep table with backfill from stepConfigJson"
```

The full suite must still be green here: nothing reads the new table yet, so this task is purely additive.

---

### Task 3: Setup-step service

**Files:**
- Create: `src/lib/channels/setup-steps.ts`
- Test: `tests/channel-setup-steps.test.ts`

**Interfaces:**
- Consumes: `STEP_CATALOG`, `catalogEntry`, `seedPlan`, `SeededStep` (Task 1); `ChannelSetupStep` Prisma model (Task 2); `assertPermission`, `assertOrganizationAccess`, `Actor` from `@/lib/auth/permissions`; `writeAudit` from `@/lib/audit/audit`; `ValidationError`, `NotFoundError` from `@/lib/errors`.
- Produces:
  - `seedChannelSetupSteps(tx, campaignChannelId, def, overrides?): Promise<void>` — Task 4 calls this inside the channel-creation transaction.
  - `copyChannelSetupSteps(tx, fromChannelId, toChannelId, actorUserId): Promise<void>` — Task 4 calls this from campaign clone.
  - `addChannelSetupStep(db, actor, channelId, stepKey): Promise<void>`
  - `removeChannelSetupStep(db, actor, channelId, stepKey): Promise<void>`
  - `setChannelStepRequirement(db, actor, channelId, stepKey, requirement): Promise<void>`
  - Task 6 wraps the last three in server actions.

Nothing calls this module yet. It ships green and wired up in Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/channel-setup-steps.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import {
  addChannelSetupStep,
  removeChannelSetupStep,
  seedChannelSetupSteps,
  setChannelStepRequirement,
} from "@/lib/channels/setup-steps";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { ValidationError } from "@/lib/errors";

async function definitionFor(channelId: string): Promise<ChannelTypeDefinition> {
  const channel = await testDb().campaignChannel.findUniqueOrThrow({
    where: { id: channelId },
    include: { channelTypeVersion: true },
  });
  return channel.channelTypeVersion.definitionJson as unknown as ChannelTypeDefinition;
}

async function keysFor(channelId: string) {
  const rows = await testDb().channelSetupStep.findMany({
    where: { campaignChannelId: channelId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => r.stepKey);
}

describe("seedChannelSetupSteps", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("writes the catalog default plan", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    expect(await keysFor(fx.channelId)).toEqual([
      "channelTerms",
      "icp",
      "leadSpec",
      "placement",
      "allocations",
    ]);
  });

  it("applies caller overrides over the defaults", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "placement", requirement: "optional" },
      { stepKey: "allocations", requirement: "required" },
    ]);

    const rows = await testDb().channelSetupStep.findMany({
      where: { campaignChannelId: fx.channelId },
    });
    expect(rows.find((r) => r.stepKey === "placement")?.requirement).toBe("optional");
    expect(rows.find((r) => r.stepKey === "allocations")?.requirement).toBe("required");
  });

  it("drops a default step the caller omitted from an explicit override list", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    expect(await keysFor(fx.channelId)).toEqual(["channelTerms"]);
  });

  it("always seeds a locked step even when the caller omits it", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "icp", requirement: "required" },
    ]);

    expect(await keysFor(fx.channelId)).toContain("channelTerms");
  });

  it("refuses an override for a step that does not apply to the channel type", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });

    await expect(
      seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
        { stepKey: "placement", requirement: "required" },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses an override for a deferred step", async () => {
    const fx = await createChannelFixture(testDb());

    await expect(
      seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
        { stepKey: "suppressionList", requirement: "required" },
      ]),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("addChannelSetupStep", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("adds an applicable step that has no row yet", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp");

    expect(await keysFor(fx.channelId)).toEqual(["channelTerms", "icp"]);
  });

  it("defaults a newly added step to required", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "allocations");

    const row = await testDb().channelSetupStep.findFirstOrThrow({
      where: { campaignChannelId: fx.channelId, stepKey: "allocations" },
    });
    expect(row.requirement).toBe("required");
  });

  it("refuses a duplicate", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a deferred step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "targetAccountList"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a step that does not apply to the channel type", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "placement"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses once the channel is past draft", async () => {
    const fx = await createChannelFixture(testDb(), { channelStatus: "pending" });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await expect(
      addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a client actor", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await expect(
      addChannelSetupStep(testDb(), fx.clientAdminActor, fx.channelId, "icp"),
    ).rejects.toThrow();
  });

  it("writes an audit row", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await addChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp");

    const audit = await testDb().auditLog.findFirst({
      where: { entityType: "ChannelSetupStep", action: "create" },
    });
    expect(audit).not.toBeNull();
  });
});

describe("removeChannelSetupStep", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("removes an unlocked step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "allocations");

    expect(await keysFor(fx.channelId)).not.toContain("allocations");
  });

  it("refuses to remove the locked terms step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "channelTerms"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses when the step has no row", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId), [
      { stepKey: "channelTerms", requirement: "required" },
    ]);

    await expect(
      removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses once the channel is past draft", async () => {
    const fx = await createChannelFixture(testDb(), { channelStatus: "live" });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "allocations"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("setChannelStepRequirement", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("softens a required step to optional", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "placement", "optional");

    const row = await testDb().channelSetupStep.findFirstOrThrow({
      where: { campaignChannelId: fx.channelId, stepKey: "placement" },
    });
    expect(row.requirement).toBe("optional");
  });

  it("hardens an optional step to required", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "allocations", "required");

    const row = await testDb().channelSetupStep.findFirstOrThrow({
      where: { campaignChannelId: fx.channelId, stepKey: "allocations" },
    });
    expect(row.requirement).toBe("required");
  });

  it("refuses to soften the locked terms step", async () => {
    const fx = await createChannelFixture(testDb());
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "channelTerms", "optional"),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses once the channel is past draft", async () => {
    const fx = await createChannelFixture(testDb(), { channelStatus: "scheduled" });
    await seedChannelSetupSteps(testDb(), fx.channelId, await definitionFor(fx.channelId));

    await expect(
      setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "placement", "optional"),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/channel-setup-steps.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/channels/setup-steps"`.

- [ ] **Step 3: Write the service**

Create `src/lib/channels/setup-steps.ts`:

```ts
import type {
  ChannelSetupRequirement,
  ChannelSetupStepKey,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import { STEP_CATALOG, catalogEntry, seedPlan } from "@/lib/channels/step-catalog";

type Db = PrismaClient | Prisma.TransactionClient;

export type StepOverride = {
  stepKey: ChannelSetupStepKey;
  requirement: ChannelSetupRequirement;
};

function sortOrderOf(stepKey: ChannelSetupStepKey): number {
  return STEP_CATALOG.findIndex((e) => e.key === stepKey);
}

function assertSelectable(stepKey: ChannelSetupStepKey, def: ChannelTypeDefinition): void {
  const entry = catalogEntry(stepKey);
  if (entry === undefined) throw new ValidationError(`Unknown setup step "${stepKey}"`);
  if (!entry.available) {
    throw new ValidationError(`Setup step "${entry.title}" is not available yet`);
  }
  if (!entry.applies(def)) {
    throw new ValidationError(`Setup step "${entry.title}" does not apply to this channel type`);
  }
}

/**
 * An explicit override list replaces the default plan rather than merging into
 * it, so the creation form can drop a step by omitting it. Locked steps survive
 * either way.
 */
export async function seedChannelSetupSteps(
  tx: Db,
  campaignChannelId: string,
  def: ChannelTypeDefinition,
  overrides?: StepOverride[],
): Promise<void> {
  let plan = seedPlan(def);

  if (overrides !== undefined) {
    for (const override of overrides) assertSelectable(override.stepKey, def);

    const locked = STEP_CATALOG.filter((e) => e.locked).map((e) => ({
      stepKey: e.key,
      requirement: "required" as const,
      sortOrder: sortOrderOf(e.key),
    }));
    const chosen = overrides.map((o) => ({
      stepKey: o.stepKey,
      requirement: o.requirement,
      sortOrder: sortOrderOf(o.stepKey),
    }));
    const byKey = new Map([...locked, ...chosen].map((s) => [s.stepKey, s]));
    plan = [...byKey.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }

  await tx.channelSetupStep.createMany({
    data: plan.map((s) => ({ campaignChannelId, ...s })),
  });
}

export async function copyChannelSetupSteps(
  tx: Db,
  fromChannelId: string,
  toChannelId: string,
  actorUserId: string,
): Promise<void> {
  const source = await tx.channelSetupStep.findMany({
    where: { campaignChannelId: fromChannelId },
  });
  await tx.channelSetupStep.createMany({
    data: source.map((s) => ({
      campaignChannelId: toChannelId,
      stepKey: s.stepKey,
      requirement: s.requirement,
      sortOrder: s.sortOrder,
      createdById: actorUserId,
      updatedById: actorUserId,
    })),
  });
}

async function loadDraftChannel(db: PrismaClient, actor: Actor, channelId: string) {
  assertPermission(actor, "campaign:write");

  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: { campaign: true, channelTypeVersion: true },
  });
  if (channel === null || channel.campaign.deletedAt !== null) {
    throw new NotFoundError("Channel not found");
  }
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  if (channel.status !== "draft") {
    throw new ValidationError(
      `Channel is ${channel.status}; the setup checklist can only be edited while it is a draft`,
    );
  }
  return {
    channel,
    definition: channel.channelTypeVersion.definitionJson as unknown as ChannelTypeDefinition,
  };
}

export async function addChannelSetupStep(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
  stepKey: ChannelSetupStepKey,
): Promise<void> {
  const { definition } = await loadDraftChannel(db, actor, channelId);
  assertSelectable(stepKey, definition);

  const existing = await db.channelSetupStep.findFirst({
    where: { campaignChannelId: channelId, stepKey },
  });
  if (existing !== null) {
    throw new ValidationError(`Setup step "${catalogEntry(stepKey)?.title}" is already on this channel`);
  }

  await db.$transaction(async (tx) => {
    const created = await tx.channelSetupStep.create({
      data: {
        campaignChannelId: channelId,
        stepKey,
        requirement: "required",
        sortOrder: sortOrderOf(stepKey),
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      entityType: "ChannelSetupStep",
      entityId: created.id,
      action: "create",
      after: { campaignChannelId: channelId, stepKey, requirement: "required" },
    });
  });
}

export async function removeChannelSetupStep(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
  stepKey: ChannelSetupStepKey,
): Promise<void> {
  await loadDraftChannel(db, actor, channelId);

  const entry = catalogEntry(stepKey);
  if (entry === undefined) throw new ValidationError(`Unknown setup step "${stepKey}"`);
  if (entry.locked) throw new ValidationError(`Setup step "${entry.title}" cannot be removed`);

  const existing = await db.channelSetupStep.findFirst({
    where: { campaignChannelId: channelId, stepKey },
  });
  if (existing === null) {
    throw new ValidationError(`Setup step "${entry.title}" is not on this channel`);
  }

  await db.$transaction(async (tx) => {
    await tx.channelSetupStep.delete({ where: { id: existing.id } });
    await writeAudit(tx, actor, {
      entityType: "ChannelSetupStep",
      entityId: existing.id,
      action: "delete",
      before: { campaignChannelId: channelId, stepKey, requirement: existing.requirement },
    });
  });
}

export async function setChannelStepRequirement(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
  stepKey: ChannelSetupStepKey,
  requirement: ChannelSetupRequirement,
): Promise<void> {
  await loadDraftChannel(db, actor, channelId);

  const entry = catalogEntry(stepKey);
  if (entry === undefined) throw new ValidationError(`Unknown setup step "${stepKey}"`);
  if (entry.locked && requirement !== "required") {
    throw new ValidationError(`Setup step "${entry.title}" is always required`);
  }

  const existing = await db.channelSetupStep.findFirst({
    where: { campaignChannelId: channelId, stepKey },
  });
  if (existing === null) {
    throw new ValidationError(`Setup step "${entry.title}" is not on this channel`);
  }

  await db.$transaction(async (tx) => {
    await tx.channelSetupStep.update({
      where: { id: existing.id },
      data: { requirement, updatedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      entityType: "ChannelSetupStep",
      entityId: existing.id,
      action: "update",
      before: { requirement: existing.requirement },
      after: { requirement },
    });
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/channel-setup-steps.test.ts`
Expected: PASS, 22 tests.

If the audit assertion fails, check the model name for audit rows in `src/lib/audit/audit.ts` and match it — the test asserts against `auditLog`.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/channels/setup-steps.ts tests/channel-setup-steps.test.ts
git commit -m "feat: add channel setup step service"
```

---

### Task 4: Cut readiness and the submit gate over to rows

**Files:**
- Rewrite: `src/lib/channels/readiness.ts`
- Modify: `src/lib/campaigns/state-machine.ts:102-136` (`assertChannelReadyForApproval`)
- Modify: `src/lib/campaigns/crud.ts:295-380` (`CampaignChannelInput.stepConfig` → `setupSteps`, seed rows in the creation transaction)
- Modify: `src/lib/campaigns/channels.ts:14-22,97-99` (drop `stepConfig` from `UpdateCampaignChannelInput`)
- Modify: `src/lib/campaigns/clone.ts:94-112` (copy setup steps to the cloned channel)
- Modify: `src/app/(admin)/campaigns/[id]/actions.ts:52,82` and `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts:20,31`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/edit-channel-dialog.tsx:88` (drop `stepConfig`)
- Modify: `src/app/(admin)/campaigns/[id]/channels/new/new-channel-form.tsx:76,88,107` (send `setupSteps`)
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx:113,120-121,287-352` (new readiness shape)
- Modify: `tests/helpers/channel-factory.ts` (seed rows, expose `producesLeads`)
- Rewrite: `tests/channel-readiness.test.ts`
- Modify: `tests/campaign-channel-edit.test.ts:93-120` (the `stepConfig` test)
- Create: `prisma/migrations/20260916010000_drop_channel_step_config/migration.sql`
- Test: `tests/channel-submit-gate.test.ts`

**Interfaces:**
- Consumes: `catalogEntry`, `ChannelFacts` (Task 1); `seedChannelSetupSteps`, `copyChannelSetupSteps` (Task 3).
- Produces:
  - `computeChannelReadiness(rows, facts, ids): ChannelReadiness` — pure.
  - `loadChannelReadiness(db, campaignChannelId): Promise<ChannelReadiness>`
  - `ChannelStep = { key, title, hint, cta, href, requirement, locked, done }`
  - `ChannelReadiness = { steps, requiredDoneCount, requiredTotalCount }`
  - `CampaignChannelInput.setupSteps?: StepOverride[]`
  - Task 6 renders `ChannelStep`; Task 5 relies on the rewritten gate.

This is the cutover. It must land as one commit: splitting it leaves creation writing rows that readiness does not read, or a gate reading a column the creation path stopped writing.

- [ ] **Step 1: Write the failing readiness test**

Replace the whole of `tests/channel-readiness.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeChannelReadiness } from "@/lib/channels/readiness";
import type { ChannelFacts } from "@/lib/channels/step-catalog";

const ids = { campaignId: "cam1", channelId: "ch1" };

const facts = (overrides: Partial<ChannelFacts> = {}): ChannelFacts => ({
  hasTerms: true,
  icpCount: 0,
  hasEmailSpec: false,
  activePlacementCount: 0,
  allocationCount: 0,
  ...overrides,
});

const row = (stepKey: string, requirement: "required" | "optional", sortOrder: number) =>
  ({ stepKey, requirement, sortOrder }) as never;

describe("computeChannelReadiness", () => {
  it("returns an empty checklist when the channel has no rows", () => {
    const result = computeChannelReadiness([], facts(), ids);
    expect(result.steps).toEqual([]);
    expect(result.requiredTotalCount).toBe(0);
    expect(result.requiredDoneCount).toBe(0);
  });

  it("orders steps by sortOrder, not insertion order", () => {
    const result = computeChannelReadiness(
      [row("allocations", "optional", 4), row("channelTerms", "required", 0)],
      facts(),
      ids,
    );
    expect(result.steps.map((s) => s.key)).toEqual(["channelTerms", "allocations"]);
  });

  it("resolves done from the facts bag", () => {
    const result = computeChannelReadiness(
      [row("icp", "required", 1)],
      facts({ icpCount: 2 }),
      ids,
    );
    expect(result.steps[0]?.done).toBe(true);
  });

  it("counts only required steps in the progress counters", () => {
    const result = computeChannelReadiness(
      [row("channelTerms", "required", 0), row("allocations", "optional", 4)],
      facts({ hasTerms: true }),
      ids,
    );
    expect(result.requiredTotalCount).toBe(1);
    expect(result.requiredDoneCount).toBe(1);
  });

  it("carries locked through from the catalog", () => {
    const result = computeChannelReadiness([row("channelTerms", "required", 0)], facts(), ids);
    expect(result.steps[0]?.locked).toBe(true);
  });

  it("builds a working href for each step", () => {
    const result = computeChannelReadiness([row("placement", "required", 3)], facts(), ids);
    expect(result.steps[0]?.href).toBe("/campaigns/cam1/channels/ch1?tab=placements");
  });

  it("ignores a row whose key has no catalog entry", () => {
    const result = computeChannelReadiness(
      [row("channelTerms", "required", 0), row("retiredStep", "required", 9)],
      facts(),
      ids,
    );
    expect(result.steps.map((s) => s.key)).toEqual(["channelTerms"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/channel-readiness.test.ts`
Expected: FAIL — `computeChannelReadiness` still takes the old single-object argument.

- [ ] **Step 3: Rewrite readiness.ts**

Replace the whole of `src/lib/channels/readiness.ts`:

```ts
import type {
  ChannelSetupRequirement,
  ChannelSetupStepKey,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { catalogEntry, type ChannelFacts } from "@/lib/channels/step-catalog";

type Db = PrismaClient | Prisma.TransactionClient;

export type ChannelStep = {
  key: ChannelSetupStepKey;
  title: string;
  hint: string;
  cta: string;
  href: string;
  requirement: ChannelSetupRequirement;
  locked: boolean;
  done: boolean;
};

export type ChannelReadiness = {
  steps: ChannelStep[];
  requiredDoneCount: number;
  requiredTotalCount: number;
};

type StepRow = {
  stepKey: ChannelSetupStepKey;
  requirement: ChannelSetupRequirement;
  sortOrder: number;
};

export function computeChannelReadiness(
  rows: StepRow[],
  facts: ChannelFacts,
  ids: { campaignId: string; channelId: string },
): ChannelReadiness {
  const steps = rows
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((row): ChannelStep[] => {
      const entry = catalogEntry(row.stepKey);
      // A row whose catalog entry was retired must not break the page render.
      if (entry === undefined) return [];
      return [{
        key: entry.key,
        title: entry.title,
        hint: entry.hint,
        cta: entry.cta,
        href: entry.href(ids.campaignId, ids.channelId),
        requirement: row.requirement,
        locked: entry.locked,
        done: entry.isDone(facts),
      }];
    });

  const required = steps.filter((s) => s.requirement === "required");
  return {
    steps,
    requiredDoneCount: required.filter((s) => s.done).length,
    requiredTotalCount: required.length,
  };
}

export async function loadChannelFacts(db: Db, campaignChannelId: string): Promise<ChannelFacts> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: campaignChannelId },
    select: { contractedQuantity: true, clientUnitPriceMinor: true },
  });

  const [icpCount, emailSpec, activePlacementCount, allocationCount] = await Promise.all([
    db.icpCriterion.count({ where: { campaignChannelId } }),
    db.leadFieldSpec.findFirst({ where: { campaignChannelId, fieldKey: "email" }, select: { id: true } }),
    db.assetPlacement.count({ where: { campaignChannelId, status: "active" } }),
    db.partnerAllocation.count({ where: { campaignChannelId } }),
  ]);

  return {
    hasTerms: channel.contractedQuantity > 0 && channel.clientUnitPriceMinor > 0n,
    icpCount,
    hasEmailSpec: emailSpec !== null,
    activePlacementCount,
    allocationCount,
  };
}

export async function loadChannelReadiness(
  db: Db,
  campaignChannelId: string,
): Promise<ChannelReadiness> {
  const [channel, rows, facts] = await Promise.all([
    db.campaignChannel.findUniqueOrThrow({
      where: { id: campaignChannelId },
      select: { campaignId: true },
    }),
    db.channelSetupStep.findMany({
      where: { campaignChannelId },
      select: { stepKey: true, requirement: true, sortOrder: true },
    }),
    loadChannelFacts(db, campaignChannelId),
  ]);

  return computeChannelReadiness(rows, facts, {
    campaignId: channel.campaignId,
    channelId: campaignChannelId,
  });
}
```

- [ ] **Step 4: Run the readiness test**

Run: `npx vitest run tests/channel-readiness.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing submit-gate test**

Create `tests/channel-submit-gate.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import { submitChannelForApproval } from "@/lib/campaigns/state-machine";
import { setChannelStepRequirement, removeChannelSetupStep } from "@/lib/channels/setup-steps";
import { ValidationError } from "@/lib/errors";

async function satisfyLeadSteps(channelId: string) {
  await testDb().icpCriterion.create({
    data: {
      campaignChannelId: channelId,
      dimension: "country",
      operator: "in",
      valuesJson: ["US"],
      isMandatory: true,
    },
  });
  await testDb().leadFieldSpec.create({
    data: {
      campaignChannelId: channelId,
      fieldKey: "email",
      label: "Email",
      dataType: "email",
      isRequired: true,
      rejectIfMissing: true,
    },
  });
}

describe("submitChannelForApproval — step-driven gate", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("submits an impression-only channel with no ICP and no lead spec", async () => {
    const fx = await createChannelFixture(testDb(), { producesLeads: false, requiresAsset: false });

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("refuses a lead channel missing its ICP, naming the step", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });

    await expect(
      submitChannelForApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toThrow(/Define the ICP/);
  });

  it("submits once every required step is done", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await satisfyLeadSteps(fx.channelId);

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("ignores an incomplete optional step", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await satisfyLeadSteps(fx.channelId);
    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "icp", "optional");
    await testDb().icpCriterion.deleteMany({ where: { campaignChannelId: fx.channelId } });

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("blocks on an incomplete step the operator hardened to required", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await satisfyLeadSteps(fx.channelId);
    await setChannelStepRequirement(testDb(), fx.adminActor, fx.channelId, "allocations", "required");

    await expect(
      submitChannelForApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toThrow(/Allocate partner quota/);
  });

  it("submits a lead channel whose ICP step the operator removed", async () => {
    const fx = await createChannelFixture(testDb(), { requiresAsset: false });
    await testDb().leadFieldSpec.create({
      data: {
        campaignChannelId: fx.channelId,
        fieldKey: "email",
        label: "Email",
        dataType: "email",
        isRequired: true,
        rejectIfMissing: true,
      },
    });
    await removeChannelSetupStep(testDb(), fx.adminActor, fx.channelId, "icp");

    const updated = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("pending");
  });

  it("blocks a channel that needs an asset until a placement is active", async () => {
    const fx = await createChannelFixture(testDb());
    await satisfyLeadSteps(fx.channelId);

    await expect(
      submitChannelForApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
```

- [ ] **Step 6: Extend the test fixture**

In `tests/helpers/channel-factory.ts`, add `producesLeads?: boolean` to `createChannelFixture`'s options, use it in `definitionJson` (`producesLeads: options.producesLeads ?? true`), and seed the steps after creating the channel:

```ts
import { seedChannelSetupSteps } from "@/lib/channels/setup-steps";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
```

then, immediately after `const channel = await db.campaignChannel.create({...})`:

```ts
  await seedChannelSetupSteps(
    db,
    channel.id,
    channelTypeVersion.definitionJson as unknown as ChannelTypeDefinition,
  );
```

Do the same in `createCampaignWithChannel`. Its `definitionJson` is `{}`, which `seedPlan` reads as neither producing leads nor requiring an asset, so it seeds `channelTerms` and `allocations` only — correct for a fixture whose channels start `live` and never pass through the gate.

- [ ] **Step 7: Rewrite the gate**

In `src/lib/campaigns/state-machine.ts`, replace `assertChannelReadyForApproval` (lines 101-136) with:

```ts
/** Every required setup step must be complete before a channel can be submitted. */
async function assertChannelReadyForApproval(db: Db, channelId: string): Promise<void> {
  const readiness = await loadChannelReadiness(db, channelId);
  const blocking = readiness.steps.find((s) => s.requirement === "required" && !s.done);
  if (blocking !== undefined) {
    throw new ValidationError(`Setup step "${blocking.title}" is not complete`);
  }
}
```

Update the imports at the top of the file: drop `import type { StepConfig } from "@/lib/channels/readiness";` and `import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";` if nothing else uses them, and add `import { loadChannelReadiness } from "@/lib/channels/readiness";`.

- [ ] **Step 8: Seed rows at creation**

In `src/lib/campaigns/crud.ts`, change `CampaignChannelInput`:

```ts
  setupSteps?: StepOverride[];
```

replacing `stepConfig?: StepConfig`. Update the import to `import type { StepOverride } from "@/lib/channels/setup-steps";` and add `import { seedChannelSetupSteps } from "@/lib/channels/setup-steps";` plus `import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";`.

In `addCampaignChannel`'s transaction callback, drop the `stepConfigJson` line and seed instead:

```ts
      const created = await tx.campaignChannel.create({
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
      });

      await seedChannelSetupSteps(
        tx,
        created.id,
        version.definitionJson as unknown as ChannelTypeDefinition,
        input.setupSteps,
      );

      return created;
```

- [ ] **Step 9: Drop stepConfig from the update path and the callers**

- `src/lib/campaigns/channels.ts`: remove `stepConfig` from `UpdateCampaignChannelInput`, remove the `stepConfigJson` line from the update payload, and remove the now-unused `StepConfig` and `Prisma` imports.
- `src/app/(admin)/campaigns/[id]/actions.ts:52,82`: rename the field to `setupSteps` typed as `import("@/lib/channels/setup-steps").StepOverride[]`.
- `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts:20,31`: same rename.
- `edit-channel-dialog.tsx:88`: delete the `stepConfig:` line and the `placementOverride` state that fed it.
- `new-channel-form.tsx`: delete the `stepConfig` state (line 76), the override helper (line 88), the placement toggle markup, and the field on submit (line 107). Creation seeds catalog defaults for now. Task 6 adds the real picker — an interim half-picker would only be thrown away.

- [ ] **Step 10: Copy steps on clone**

In `src/lib/campaigns/clone.ts`, after `const clonedChannel = await tx.campaignChannel.create({...})`:

```ts
        await copyChannelSetupSteps(tx, channel.id, clonedChannel.id, actor.userId);
```

Import `copyChannelSetupSteps` from `@/lib/channels/setup-steps`. A cloned channel previously lost its step configuration silently, because `stepConfigJson` was never copied.

- [ ] **Step 11: Update the channel page**

In `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx`:

- line 113: delete the `placementOverride` derivation and the `StepOverride` import.
- line 120: `const hasPlacementStep = readiness.steps.some((s) => s.key === "placement");`
- line 121: delete `requiredSteps` if unused, or rewrite as `readiness.steps.filter((s) => s.requirement === "required")`.
- In `OverviewTab`, replace the three derivations with:

```ts
  const required = readiness.steps.filter((s) => s.requirement === "required");
  const optional = readiness.steps.filter((s) => s.requirement === "optional");
  const requiredDone = readiness.requiredDoneCount;
  const requiredTotal = readiness.requiredTotalCount;
```

- In `stepRow`, key on `step.key`, gate the Optional badge on `step.requirement === "optional"`, and use the catalog href:

```ts
      <Button asChild size="sm" variant="outline">
        <Link href={step.href as Route}>{step.cta}</Link>
      </Button>
```

This also fixes the dead CTA: the old code built `?tab=${step.id}`, producing `?tab=placement`, which is not in `TABS` and silently fell back to Overview.

- Hide the "Optional" divider when `optional.length === 0`.

- [ ] **Step 12: Update the stepConfig test in campaign-channel-edit**

In `tests/campaign-channel-edit.test.ts`, replace the test at lines 93-120 ("persists a placement stepConfig override...") with one that softens the step through the service instead:

```ts
  it("unblocks submission when the placement step is softened to optional", async () => {
    const db = testDb();
    const fx = await createChannelFixture(db);
    await db.icpCriterion.create({
      data: {
        campaignChannelId: fx.channelId,
        dimension: "country",
        operator: "in",
        valuesJson: ["US"],
        isMandatory: true,
      },
    });
    await db.leadFieldSpec.create({
      data: {
        campaignChannelId: fx.channelId,
        fieldKey: "email",
        label: "Email",
        dataType: "email",
        isRequired: true,
        rejectIfMissing: true,
      },
    });

    await setChannelStepRequirement(db, fx.adminActor, fx.channelId, "placement", "optional");

    const submitted = await submitChannelForApproval(db, fx.adminActor, fx.channelId);
    expect(submitted.status).toBe("pending");
  });
```

Import `setChannelStepRequirement` from `@/lib/channels/setup-steps`.

- [ ] **Step 13: Drop the column**

Remove `stepConfigJson Json?` from `model CampaignChannel` in `prisma/schema.prisma`, then create `prisma/migrations/20260916010000_drop_channel_step_config/migration.sql`:

```sql
ALTER TABLE "CampaignChannel" DROP COLUMN "stepConfigJson";
```

Apply it:

```bash
npx prisma migrate deploy && npx prisma generate
```

- [ ] **Step 14: Run everything**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
```

Expected: PASS. If anything still references `stepConfig` or `StepConfig`, the typecheck names the file — there should be no remaining hits for `grep -rn "stepConfig" src tests`.

- [ ] **Step 15: Commit**

```bash
git add -A src prisma tests
git commit -m "feat: drive channel readiness and the submit gate from setup step rows

Impression-only channels could never be submitted: the gate demanded an ICP
criterion and an email lead field spec from every channel regardless of
whether it produced leads. The gate now reads each channel's configured
required steps instead."
```

---

### Task 5: Withdraw a pending channel back to draft

**Files:**
- Modify: `src/lib/campaigns/state-machine.ts` (add `withdrawChannelFromApproval` after `submitChannelForApproval`, ~line 182)
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`
- Test: `tests/channel-withdraw.test.ts`

**Interfaces:**
- Consumes: `loadAccessibleChannel`, `updateCampaignStatus`, `writeAudit`, `assertPermission` — all already in `state-machine.ts`.
- Produces: `withdrawChannelFromApproval(db, actor, campaignChannelId): Promise<CampaignChannel>` and `withdrawChannelFromApprovalAction(campaignId, channelId)`. Task 6 renders the button.

- [ ] **Step 1: Write the failing test**

Create `tests/channel-withdraw.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb, testDb } from "./helpers/db";
import { seedRoles } from "../prisma/seed/roles";
import { seedFunnelStages } from "../prisma/seed/funnel-stages";
import { createChannelFixture } from "./helpers/channel-factory";
import {
  submitChannelForApproval,
  withdrawChannelFromApproval,
} from "@/lib/campaigns/state-machine";
import { InvalidStateTransitionError } from "@/lib/errors";

async function submittedFixture(options: Parameters<typeof createChannelFixture>[1] = {}) {
  const fx = await createChannelFixture(testDb(), {
    producesLeads: false,
    requiresAsset: false,
    ...options,
  });
  await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);
  return fx;
}

describe("withdrawChannelFromApproval", () => {
  beforeEach(async () => {
    await resetDb();
    await seedRoles(testDb());
    await seedFunnelStages(testDb());
  });

  it("returns a pending channel to draft", async () => {
    const fx = await submittedFixture();

    const updated = await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    expect(updated.status).toBe("draft");
  });

  it("writes no approval row", async () => {
    const fx = await submittedFixture();

    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const approvals = await testDb().channelApproval.count({
      where: { campaignChannelId: fx.channelId },
    });
    expect(approvals).toBe(0);
  });

  it("audits the transition with a withdrawn reason", async () => {
    const fx = await submittedFixture();

    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const audit = await testDb().auditLog.findFirst({
      where: { entityType: "CampaignChannel", entityId: fx.channelId, action: "transition:draft" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.afterJson)).toContain("withdrawn");
  });

  it("re-derives the campaign back to draft", async () => {
    const fx = await submittedFixture();
    const before = await testDb().campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(before.status).toBe("pending");

    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const after = await testDb().campaign.findUniqueOrThrow({ where: { id: fx.campaignId } });
    expect(after.status).toBe("draft");
  });

  it("lets the channel be submitted again afterwards", async () => {
    const fx = await submittedFixture();
    await withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId);

    const resubmitted = await submitChannelForApproval(testDb(), fx.adminActor, fx.channelId);

    expect(resubmitted.status).toBe("pending");
  });

  it("refuses a channel that is still a draft", async () => {
    const fx = await createChannelFixture(testDb(), { producesLeads: false, requiresAsset: false });

    await expect(
      withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("refuses a live channel", async () => {
    const fx = await createChannelFixture(testDb(), {
      producesLeads: false,
      requiresAsset: false,
      channelStatus: "live",
    });

    await expect(
      withdrawChannelFromApproval(testDb(), fx.adminActor, fx.channelId),
    ).rejects.toBeInstanceOf(InvalidStateTransitionError);
  });

  it("refuses an actor without campaign:submitInternal", async () => {
    const fx = await submittedFixture();

    await expect(
      withdrawChannelFromApproval(testDb(), fx.clientAdminActor, fx.channelId),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/channel-withdraw.test.ts`
Expected: FAIL — `withdrawChannelFromApproval is not a function`.

- [ ] **Step 3: Implement the transition**

In `src/lib/campaigns/state-machine.ts`, directly after `submitChannelForApproval`:

```ts
/**
 * IIF pulls a submitted channel back: pending → draft. No ChannelApproval row
 * is written because the client never decided.
 */
export async function withdrawChannelFromApproval(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:submitInternal");
  const channel = await loadAccessibleChannel(db, actor, campaignChannelId);
  if (channel.status !== "pending") {
    throw new InvalidStateTransitionError(
      `Channel is ${channel.status}; only a pending channel can be withdrawn`,
    );
  }

  return db.$transaction(async (tx) => {
    const updated = await tx.campaignChannel.update({
      where: { id: campaignChannelId },
      data: { status: "draft", updatedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "transition:draft",
      before: { status: "pending" },
      after: { status: "draft", reason: "withdrawn" },
    });
    await updateCampaignStatus(tx, channel.campaignId, actor);
    return updated;
  });
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/channel-withdraw.test.ts`
Expected: PASS, 8 tests.

If the audit assertion fails on the column name, check what `writeAudit` calls the after-payload column in `prisma/schema.prisma` and match it in the test.

- [ ] **Step 5: Add the server action**

In `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`, mirroring the existing `submitChannelForApprovalAction`:

```ts
export async function withdrawChannelFromApprovalAction(campaignId: string, channelId: string) {
  return toActionResult(async () => {
    const actor = await requireActor();
    await withdrawChannelFromApproval(db, actor, channelId);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
  });
}
```

Match the file's existing helpers exactly — read `submitChannelForApprovalAction` in the same file and copy its shape rather than the sketch above if it differs.

- [ ] **Step 6: Typecheck and commit**

```bash
npx vitest run && npx tsc --noEmit
git add src/lib/campaigns/state-machine.ts "src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts" tests/channel-withdraw.test.ts
git commit -m "feat: let IIF withdraw a pending channel back to draft"
```

---

### Task 6: Checklist editor, withdraw button and creation picker

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/setup-checklist-card.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx` (`OverviewTab` renders the new card)
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts` (three step actions)
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-status-control.tsx` (withdraw button)
- Modify: `src/app/(admin)/campaigns/[id]/channels/new/new-channel-form.tsx` (full picker)

**Interfaces:**
- Consumes: `ChannelStep`, `ChannelReadiness` (Task 4); `addChannelSetupStep`, `removeChannelSetupStep`, `setChannelStepRequirement` (Task 3); `withdrawChannelFromApprovalAction` (Task 5); `STEP_CATALOG` (Task 1).
- Produces: user-facing surfaces only. Nothing imports from this task.

Read `node_modules/next/dist/docs/` on server actions and client components before writing this task.

- [ ] **Step 1: Add the three server actions**

In `channels/[channelId]/actions.ts`, following the shape of the actions already in the file:

```ts
export async function addChannelSetupStepAction(
  campaignId: string,
  channelId: string,
  stepKey: ChannelSetupStepKey,
) {
  return toActionResult(async () => {
    const actor = await requireActor();
    await addChannelSetupStep(db, actor, channelId, stepKey);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
  });
}

export async function removeChannelSetupStepAction(
  campaignId: string,
  channelId: string,
  stepKey: ChannelSetupStepKey,
) {
  return toActionResult(async () => {
    const actor = await requireActor();
    await removeChannelSetupStep(db, actor, channelId, stepKey);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
  });
}

export async function setChannelStepRequirementAction(
  campaignId: string,
  channelId: string,
  stepKey: ChannelSetupStepKey,
  requirement: ChannelSetupRequirement,
) {
  return toActionResult(async () => {
    const actor = await requireActor();
    await setChannelStepRequirement(db, actor, channelId, stepKey, requirement);
    revalidatePath(`/campaigns/${campaignId}/channels/${channelId}`);
  });
}
```

The service layer re-checks draft status, so these do not repeat that check.

- [ ] **Step 2: Build the checklist card**

Create `setup-checklist-card.tsx` as a client component. It receives `campaignId`, `channelId`, `readiness`, `editable` (true only when the channel is `draft` and the viewer has `campaign:write`), and `addableSteps: { key, title }[]` computed on the server from `STEP_CATALOG` filtered by `available`, `applies(definition)` and "has no row yet".

Move the existing `stepRow` markup from `page.tsx:303-323` into this file unchanged, then add, inside each row and only when `editable && !step.locked`:

- a requirement toggle rendered as a small `Select` with `required` / `optional`, calling `setChannelStepRequirementAction` inside `useTransition`, `toast.success` / `toast.error` on the result, then `router.refresh()`
- a remove button (`variant="ghost"`, `size="icon"`) calling `removeChannelSetupStepAction` the same way

Above the rows, when `editable && addableSteps.length > 0`, render an "Add step" `Select` whose `onValueChange` calls `addChannelSetupStepAction`.

Follow `channel-status-control.tsx` for the `useTransition` + `toast` + `router.refresh()` pattern — it is the closest existing example.

- [ ] **Step 3: Render the card from the page**

In `page.tsx`, compute `addableSteps` beside the existing `readiness` load:

```ts
  const definition = channel.channelTypeVersion.definitionJson as unknown as ChannelTypeDefinition;
  const presentKeys = new Set(readiness.steps.map((s) => s.key));
  const addableSteps = STEP_CATALOG
    .filter((e) => e.available && e.applies(definition) && !presentKeys.has(e.key))
    .map((e) => ({ key: e.key, title: e.title }));
```

Pass `readiness`, `addableSteps`, and `editable={channel.status === "draft" && canWriteCampaign}` into `<SetupChecklistCard />` from `OverviewTab`, replacing the inline `<Card>`.

- [ ] **Step 4: Add the withdraw button**

In `channel-status-control.tsx`, replace the `pending` branch:

```tsx
  if (status === "pending") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline">pending</Badge>
        <Button onClick={onWithdraw} disabled={pending} size="sm" variant="outline">
          Withdraw to draft
        </Button>
      </div>
    );
  }

  if (status === "scheduled" || status === "completed" || status === "cancelled") {
    return <Badge variant="outline">{status}</Badge>;
  }
```

with `onWithdraw` following the existing `onSubmitForApproval` shape, calling `withdrawChannelFromApprovalAction`, and wrapped in an `AlertDialog` whose body reads "This channel leaves the client's approval queue and returns to draft. Anything already approved on the campaign is unaffected."

- [ ] **Step 5: Build the creation picker**

In `new-channel-form.tsx`, replace the placement-only toggle with a list over `STEP_CATALOG.filter((e) => e.available && e.applies(definition))`. Each row: the step title, a checkbox for "include", and a required/optional select that is disabled when the entry is `locked` (locked steps render as always-on, always-required). Submitting sends `setupSteps` as the checked rows.

The form needs the selected channel type's `ChannelTypeDefinition` to call `applies`. It already loads channel type versions to populate its select; pass `definitionJson` through with them.

- [ ] **Step 6: Verify in the browser**

Start the dev server and walk the flows. Automated tests do not cover any of this task.

```bash
npm run dev
```

Check, on a draft channel:
1. The checklist shows every seeded step, with Optional badges on optional ones.
2. Removing "Allocate partner quota" drops the row; the required counter is unchanged.
3. Removing a required step drops the row and the required counter falls.
4. "Set channel terms" offers neither a toggle nor a remove button.
5. "Add step" re-adds a removed step as required.
6. Each step's CTA button lands on the right tab — in particular "Add placement" must reach the Placements tab, not Overview.
7. Submit for approval, then confirm the controls are read-only.
8. "Withdraw to draft" returns the channel to draft, the campaign badge returns to draft, and the editor controls come back.
9. Create a channel whose type has `producesLeads: false` and confirm the picker offers no lead spec step and the channel submits with no ICP.

- [ ] **Step 7: Full suite, lint, commit**

```bash
npx vitest run && npx tsc --noEmit && npx eslint .
git add -A src
git commit -m "feat: edit the channel setup checklist in draft and withdraw from approval"
```

---

## Notes for the executor

- Tasks 1-3 are additive; the full suite must stay green after each.
- Task 4 is the only task that can leave the tree red mid-way. Do not commit it partially.
- Two migrations ship here and must be applied in order: `20260916000000_add_channel_setup_step`, then `20260916010000_drop_channel_step_config`.
- `grep -rn "stepConfig" src tests` must return nothing after Task 4.

---

## Appendix A: `setup-checklist-card.tsx`

Full source for Task 6, Step 2. The row markup is lifted from `page.tsx:303-323`
so the card looks identical when `editable` is false.

```tsx
"use client";

import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import type { ChannelSetupRequirement, ChannelSetupStepKey } from "@prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ChannelStep } from "@/lib/channels/readiness";
import {
  addChannelSetupStepAction,
  removeChannelSetupStepAction,
  setChannelStepRequirementAction,
} from "./actions";

type Props = {
  campaignId: string;
  channelId: string;
  steps: ChannelStep[];
  requiredDoneCount: number;
  requiredTotalCount: number;
  addableSteps: { key: ChannelSetupStepKey; title: string }[];
  editable: boolean;
};

export function SetupChecklistCard({
  campaignId,
  channelId,
  steps,
  requiredDoneCount,
  requiredTotalCount,
  addableSteps,
  editable,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const required = steps.filter((s) => s.requirement === "required");
  const optional = steps.filter((s) => s.requirement === "optional");

  function run(action: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    startTransition(async () => {
      const result = await action();
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  const stepRow = (step: ChannelStep) => (
    <div key={step.key} className="flex items-center gap-3 border-b py-3 last:border-b-0">
      <div
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border text-xs",
          step.done
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/40 text-muted-foreground",
        )}
      >
        {step.done ? "✓" : ""}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{step.title}</span>
          {step.requirement === "optional" && (
            <Badge variant="outline" className="text-xs">Optional</Badge>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{step.hint}</div>
      </div>

      {editable && !step.locked && (
        <>
          <Select
            value={step.requirement}
            disabled={pending}
            onValueChange={(next) =>
              run(
                () =>
                  setChannelStepRequirementAction(
                    campaignId,
                    channelId,
                    step.key,
                    next as ChannelSetupRequirement,
                  ),
                `${step.title} is now ${next}`,
              )
            }
          >
            <SelectTrigger className="w-28" aria-label={`${step.title} requirement`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="required">Required</SelectItem>
              <SelectItem value="optional">Optional</SelectItem>
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={`Remove ${step.title}`}
            onClick={() =>
              run(
                () => removeChannelSetupStepAction(campaignId, channelId, step.key),
                `${step.title} removed`,
              )
            }
          >
            Remove
          </Button>
        </>
      )}

      <Button asChild size="sm" variant="outline">
        <Link href={step.href as Route}>{step.cta}</Link>
      </Button>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>Setup checklist</CardTitle>
            <p className="text-sm text-muted-foreground">
              {requiredTotalCount === 0
                ? "This channel has no required steps."
                : `A channel is ready once its ${requiredTotalCount} required ${
                    requiredTotalCount === 1 ? "step is" : "steps are"
                  } in place. Optional steps can be completed at any time, including after launch.`}
            </p>
          </div>
          {editable && addableSteps.length > 0 && (
            <Select
              value=""
              disabled={pending}
              onValueChange={(key) =>
                run(
                  () =>
                    addChannelSetupStepAction(campaignId, channelId, key as ChannelSetupStepKey),
                  "Step added",
                )
              }
            >
              <SelectTrigger className="w-44" aria-label="Add setup step">
                <SelectValue placeholder="Add step" />
              </SelectTrigger>
              <SelectContent>
                {addableSteps.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {requiredDoneCount} / {requiredTotalCount} required steps complete
        </div>
      </CardHeader>
      <CardContent className="flex flex-col">
        {required.map(stepRow)}
        {optional.length > 0 && (
          <>
            <div className="mt-4 border-t pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Optional
            </div>
            {optional.map(stepRow)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
```

Check the shape `toActionResult` actually returns before wiring `run` — the
`result.ok` / `result.error` pair above matches how `channel-status-control.tsx`
consumes its actions today. If it differs, follow that file, not this appendix.

## Appendix B: withdraw confirmation

For Task 6, Step 4. **There is no `alert-dialog` component in this repo** — use
`@/components/ui/dialog`. Inside `channel-status-control.tsx`:

```tsx
const [confirmOpen, setConfirmOpen] = useState(false);

function onWithdraw() {
  startTransition(async () => {
    const result = await withdrawChannelFromApprovalAction(campaignId, channelId);
    setConfirmOpen(false);
    if (result.ok) {
      toast.success("Channel returned to draft");
      router.refresh();
    } else {
      toast.error(result.error);
    }
  });
}

if (status === "pending") {
  return (
    <div className="flex items-center gap-2">
      <Badge variant="outline">pending</Badge>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogTrigger asChild>
          <Button size="sm" variant="outline" disabled={pending}>Withdraw to draft</Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Withdraw this channel?</DialogTitle>
            <DialogDescription>
              It leaves the client&apos;s approval queue and returns to draft, and the campaign
              returns to draft with it. Channels already approved are unaffected.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={onWithdraw} disabled={pending}>Withdraw</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

if (status === "scheduled" || status === "completed" || status === "cancelled") {
  return <Badge variant="outline">{status}</Badge>;
}
```

Note the `pending` case is split out of the old combined branch at
`channel-status-control.tsx:68`, which lumped it with the three read-only
statuses.

## Appendix C: creation picker

For Task 6, Step 5. In `new-channel-form.tsx`, with `definition` being the
selected channel type version's `ChannelTypeDefinition`:

```tsx
const applicable = STEP_CATALOG.filter((e) => e.available && e.applies(definition));
const [chosen, setChosen] = useState<Record<string, ChannelSetupRequirement | "off">>({});

function requirementFor(entry: CatalogEntry): ChannelSetupRequirement | "off" {
  if (entry.locked) return "required";
  return chosen[entry.key] ?? entry.seedDefault(definition) ?? "off";
}

const setupSteps = applicable.flatMap((entry) => {
  const requirement = requirementFor(entry);
  return requirement === "off"
    ? []
    : [{ stepKey: entry.key, requirement }];
});
```

Render one row per `applicable` entry: the title, and a three-value `Select`
(`Required` / `Optional` / `Not needed`) that is disabled when `entry.locked`.
Send `setupSteps` with the create payload.

Reset `chosen` to `{}` whenever the selected channel type changes — a step
chosen for one channel type may not apply to the next.

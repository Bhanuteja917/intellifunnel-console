# E12 Pacing and Quota Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce allocation/channel volume caps at lead intake, track authoritative delivery counters per campaign channel and per partner allocation, and surface behind/ahead-of-pace and per-partner rejection-rate signals to admin and partner users.

**Architecture:** Two denormalized counter fields (`reservedCount`, `deliveredCount`) added to `PartnerAllocation` and `CampaignChannel`, claimed atomically via raw conditional `UPDATE`s inside the existing per-row intake transaction and converted/released inside the existing verification-decide transaction — no new tables, no new transaction boundaries. A deterministic lead→allocation binding is established first by making "one active `PartnerAllocation` per partner+channel" an enforced invariant (app check + partial unique index), closing a gap `submitLeadFile`'s current `findFirst` lookup left open. Pacing is a pure function over the channel's flight window and the operating-timezone setting; per-partner rejection rate is computed on read, not stored.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Prisma 7 + Postgres, vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-06-e12-pacing-quota-design.md` (full design), `prd.md` §E12 (P0), §E9 bullet at line 227 ("Replacement tracking against the same allocation quota").

## Global Constraints

- Every new/changed service function that isn't a pure helper takes `db`/`tx` (a `PrismaClient` or `Prisma.TransactionClient`) and `actor: Actor` as its first parameters where the existing function it's extending already follows that convention (`createAllocation`, `submitLeadFile`, `decideLeadVerification` all do; the new `src/lib/allocations/counters.ts` and `src/lib/allocations/pacing.ts` helpers are pure/transaction-scoped utilities called *by* those functions and take no `actor`, matching `src/lib/leads/sla.ts`'s precedent).
- New Prisma migrations via `npm run db:migrate -- --name <name>` (never hand-written migration.sql unless the tool can't express it — Task 1's partial unique index is exactly that exception, so it uses `--create-only` to generate the column-add SQL, then hand-appends the index/backfill before applying).
- New tests follow the DB-fixture style (`resetDb()` + `testDb()` + `tests/helpers/factories.ts`) for anything touching Prisma; plain `describe`/`it.each` for pure functions (`pacing.ts`).
- Money/quantity fields already on `PartnerAllocation`/`CampaignChannel` are untouched by this plan — only two new `Int @default(0)` columns are added to each.
- `RejectReason.code` lookups always go through `db.rejectReason.findUniqueOrThrow({ where: { code } })`, matching every existing call site in `intake.ts`/`verification.ts` — never a hardcoded id.

---

### Task 1: Data model — counters, reject reason, migration

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed/reject-reasons.ts`
- Create: `prisma/migrations/<timestamp>_add_pacing_quota_counters/migration.sql` (generated, then hand-edited)

**Interfaces:**
- Produces: `PartnerAllocation.reservedCount: number`, `PartnerAllocation.deliveredCount: number`, `CampaignChannel.reservedCount: number`, `CampaignChannel.deliveredCount: number` — read/written by every later task.
- Produces: a `RejectReason` row with `code: "CHANNEL_CAP_REACHED"`, consumed by Task 5 (intake).
- Consumes: `ALLOCATION_CAP_EXCEEDED` — already exists in `prisma/seed/reject-reasons.ts` (seeded, unused until Task 5 wires it in). No change needed to that row.

- [ ] **Step 1: Add the four counter columns**

  In `prisma/schema.prisma`, add to `PartnerAllocation` (currently `prisma/schema.prisma:696-717`), directly after `revealClientIdentity`:
  ```prisma
  reservedCount         Int               @default(0)
  deliveredCount        Int               @default(0)
  ```
  Add to `CampaignChannel` (currently `prisma/schema.prisma:668-694`), directly after `qualificationFormId`:
  ```prisma
  reservedCount        Int                   @default(0)
  deliveredCount       Int                   @default(0)
  ```

- [ ] **Step 2: Add the new reject reason**

  In `prisma/seed/reject-reasons.ts`, add one row to the `REJECT_REASONS` array, next to the existing `ALLOCATION_CAP_EXCEEDED` row for grouping:
  ```ts
  { code: "CHANNEL_CAP_REACHED", label: "Campaign channel volume cap reached", category: "duplicate", isPartnerReplaceable: false },
  ```
  Same `category`/`isPartnerReplaceable` convention as its siblings `ACCOUNT_CAP_REACHED` and `ALLOCATION_CAP_EXCEEDED` — a cap-full condition isn't a data problem the partner can fix and resubmit for.

- [ ] **Step 3: Generate the migration without applying it**

  Run: `npm run db:migrate -- --name add_pacing_quota_counters --create-only`

  This writes `prisma/migrations/<timestamp>_add_pacing_quota_counters/migration.sql` containing four `ALTER TABLE ... ADD COLUMN ... DEFAULT 0` statements, without touching the dev DB yet.

- [ ] **Step 4: Hand-append the uniqueness pre-check, partial index, and backfill**

  Open the generated `migration.sql` and append (this DB can't express a partial unique index or a pre-check-and-fail through the Prisma schema DSL, so it's hand-written per the Global Constraints exception):

  ```sql
  -- Fail loudly if seed/demo data already violates the invariant this index
  -- is about to enforce (two non-ended allocations for the same partner on
  -- the same channel) — a silent CREATE INDEX failure here would be a much
  -- more opaque error to debug later.
  DO $$
  DECLARE
    violation_count INTEGER;
  BEGIN
    SELECT COUNT(*) INTO violation_count FROM (
      SELECT "campaignChannelId", "partnerOrganizationId"
      FROM "PartnerAllocation"
      WHERE "status" != 'ended'
      GROUP BY "campaignChannelId", "partnerOrganizationId"
      HAVING COUNT(*) > 1
    ) AS dupes;
    IF violation_count > 0 THEN
      RAISE EXCEPTION 'PartnerAllocation has % partner+channel pair(s) with more than one non-ended allocation — resolve manually (end the stale row) before this migration can apply its uniqueness index', violation_count;
    END IF;
  END $$;

  CREATE UNIQUE INDEX "PartnerAllocation_channel_partner_active_key"
    ON "PartnerAllocation" ("campaignChannelId", "partnerOrganizationId")
    WHERE "status" != 'ended';

  -- Backfill: existing leads predate these counters. Compute delivered/
  -- reserved counts from Lead history so the caps this migration is about
  -- to start enforcing don't see every existing allocation/channel as if
  -- it had never been used.
  UPDATE "CampaignChannel" cc SET
    "deliveredCount" = COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."campaignChannelId" = cc.id AND l."lifecycleStatus" = 'accepted'), 0),
    "reservedCount" = COALESCE((SELECT COUNT(*) FROM "Lead" l WHERE l."campaignChannelId" = cc.id AND l."verificationStatus" = 'needsReview'), 0);

  UPDATE "PartnerAllocation" pa SET
    "deliveredCount" = COALESCE((
      SELECT COUNT(*) FROM "Lead" l
      JOIN "LeadSubmission" ls ON ls.id = l."submissionId"
      WHERE l."campaignChannelId" = pa."campaignChannelId"
        AND ls."partnerOrganizationId" = pa."partnerOrganizationId"
        AND l."lifecycleStatus" = 'accepted'
    ), 0),
    "reservedCount" = COALESCE((
      SELECT COUNT(*) FROM "Lead" l
      JOIN "LeadSubmission" ls ON ls.id = l."submissionId"
      WHERE l."campaignChannelId" = pa."campaignChannelId"
        AND ls."partnerOrganizationId" = pa."partnerOrganizationId"
        AND l."verificationStatus" = 'needsReview'
    ), 0)
  WHERE pa."status" != 'ended';
  ```

- [ ] **Step 5: Apply the migration**

  Run: `npm run db:migrate` (applies the pending, now hand-edited migration; prompts for nothing new since the file already exists). If Step 4's `DO $$` block raises, the migration aborts — resolve any flagged duplicate-allocation rows in the dev DB manually (set the stale one's `status` to `ended`) and re-run.

- [ ] **Step 6: Verify**

  `npx prisma validate`. `npx tsc --noEmit` (no consumers yet — this only confirms the schema/client compiles). Spot-check the backfill against the dev DB:
  ```bash
  npx tsx -e "
  import { db } from './src/lib/db';
  (async () => {
    const channels = await db.campaignChannel.findMany({ select: { id: true, deliveredCount: true, reservedCount: true, contractedQuantity: true } });
    console.log(channels);
    await db.\$disconnect();
  })();
  "
  ```
  Confirm no row's `deliveredCount + reservedCount` exceeds its cap (a pre-existing over-cap condition, however unlikely, would be worth knowing about before enforcement goes live) — this is a read-only sanity check, not a blocking assertion.

- [ ] **Step 7: Commit**

  ```bash
  git add prisma/schema.prisma prisma/seed/reject-reasons.ts prisma/migrations
  git commit -m "feat(db): add delivery counters and CHANNEL_CAP_REACHED reject reason (E12)"
  ```

---

### Task 2: Enforce one active allocation per partner per channel

**Files:**
- Modify: `src/lib/allocations/crud.ts:33-95` (`createAllocation`)
- Test: `tests/allocations.test.ts` (new)

**Interfaces:**
- Consumes: `ValidationError` from `src/lib/errors.ts` (already imported in `crud.ts`).
- Produces: no signature change to `createAllocation(db, actor, input): Promise<PartnerAllocation>` — only a new failure mode (`ValidationError` when a non-`ended` allocation already exists for the same `campaignChannelId`+`partnerOrganizationId`), backed by Task 1's partial unique index for the concurrent case.

- [ ] **Step 1: Write the failing tests**

  Create `tests/allocations.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { resetDb, testDb } from "./helpers/db";
  import { seedRoles } from "../prisma/seed/roles";
  import { seedFunnelStages } from "../prisma/seed/funnel-stages";
  import { createOrganization, createUser } from "./helpers/factories";
  import { loadActor } from "@/lib/auth/permissions";
  import { ValidationError } from "@/lib/errors";
  import { createAllocation } from "@/lib/allocations/crud";

  async function setupChannel() {
    const db = testDb();
    const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
    const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
    const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
    const opsUser = await createUser(db, internalOrg.id, "OPERATIONS");
    const actor = await loadActor(db, opsUser.id);

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
        producesLeads: true, requiresAsset: false, metricMode: "event",
        allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
      },
    });
    const channelTypeVersion = await db.channelTypeVersion.create({
      data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
    });
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
        status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
        currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
      },
    });
    const campaignChannel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
        contractedQuantity: 100, clientUnitPriceMinor: 1000n, currency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      },
    });
    return { db, actor, campaignChannel, partnerOrg };
  }

  function allocationInput(campaignChannelId: string, partnerOrganizationId: string) {
    return {
      campaignChannelId, partnerOrganizationId, allocatedQuantity: 10,
      payoutRate: "5.00", payoutCurrency: "USD",
      startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
    };
  }

  describe("createAllocation — one active per partner+channel", () => {
    beforeEach(async () => {
      await resetDb();
      await seedRoles(testDb());
      await seedFunnelStages(testDb());
    });

    it("allows the first allocation for a partner on a channel", async () => {
      const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
      const created = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
      expect(created.id).toBeDefined();
    });

    it("rejects a second non-ended allocation for the same partner+channel", async () => {
      const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
      await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
      await expect(
        createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id)),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("allows a new allocation once the prior one is ended", async () => {
      const { db, actor, campaignChannel, partnerOrg } = await setupChannel();
      const first = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
      await db.partnerAllocation.update({ where: { id: first.id }, data: { status: "ended" } });
      const second = await createAllocation(db, actor, allocationInput(campaignChannel.id, partnerOrg.id));
      expect(second.id).not.toBe(first.id);
    });
  });
  ```

- [ ] **Step 2: Run tests to verify the second one fails**

  Run: `npm test -- tests/allocations.test.ts`
  Expected: FAIL on "rejects a second non-ended allocation" — `createAllocation` currently has no such guard, so the second call succeeds instead of rejecting (the DB-level partial unique index from Task 1 would also catch this, but only as an unhandled Postgres unique-violation error, not a `ValidationError`).

- [ ] **Step 3: Add the app-level guard**

  Edit `src/lib/allocations/crud.ts`, in `createAllocation` (currently lines 33-95), inserting after the `partnerOrganization` checks (after the `isPartner` check, before `assertQuantityAndWindow`):
  ```ts
  const existingActive = await db.partnerAllocation.findFirst({
    where: { campaignChannelId: input.campaignChannelId, partnerOrganizationId: input.partnerOrganizationId, status: { not: "ended" } },
  });
  if (existingActive !== null) {
    throw new ValidationError(
      "This partner already has an active allocation on this channel — end it before creating a new one.",
    );
  }
  ```
  This is a check-then-create, not a guarantee under true concurrency — Task 1's partial unique index is the actual guarantee; this is the layer that turns the common case into a clean `ValidationError` instead of a raw constraint-violation error.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npm test -- tests/allocations.test.ts`
  Expected: PASS (all 3 tests).

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/allocations/crud.ts tests/allocations.test.ts
  git commit -m "feat(allocations): enforce one active allocation per partner per channel"
  ```

---

### Task 3: Counter claim/release/convert helpers

**Files:**
- Create: `src/lib/allocations/counters.ts`
- Test: `tests/allocation-counters.test.ts`

**Interfaces:**
- Consumes: `Prisma` (for `Prisma.TransactionClient`) from `@prisma/client`.
- Produces (all take a `Prisma.TransactionClient` as their first argument — every caller in Tasks 5/6 already has one open):
  - `claimChannelSlot(tx, campaignChannelId: string, wantsDelivered: boolean): Promise<boolean>`
  - `releaseChannelSlot(tx, campaignChannelId: string, wasDelivered: boolean): Promise<void>`
  - `convertChannelReservedToDelivered(tx, campaignChannelId: string): Promise<void>`
  - `claimAllocationSlot(tx, allocationId: string, wantsDelivered: boolean): Promise<boolean>`
  - `releaseAllocationSlot(tx, allocationId: string, wasDelivered: boolean): Promise<void>`
  - `convertAllocationReservedToDelivered(tx, allocationId: string): Promise<void>`

- [ ] **Step 1: Write the failing tests**

  Create `tests/allocation-counters.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { resetDb, testDb } from "./helpers/db";
  import { seedRoles } from "../prisma/seed/roles";
  import { seedFunnelStages } from "../prisma/seed/funnel-stages";
  import { createOrganization } from "./helpers/factories";
  import {
    claimChannelSlot, releaseChannelSlot, convertChannelReservedToDelivered,
    claimAllocationSlot, releaseAllocationSlot, convertAllocationReservedToDelivered,
  } from "@/lib/allocations/counters";

  async function setupChannelAndAllocation(contractedQuantity: number, allocatedQuantity: number) {
    const db = testDb();
    const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
    const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
        producesLeads: true, requiresAsset: false, metricMode: "event",
        allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
      },
    });
    const channelTypeVersion = await db.channelTypeVersion.create({
      data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
    });
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
        status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
        currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
      },
    });
    const channel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
        contractedQuantity, clientUnitPriceMinor: 1000n, currency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      },
    });
    const allocation = await db.partnerAllocation.create({
      data: {
        campaignChannelId: channel.id, partnerOrganizationId: partnerOrg.id,
        allocatedQuantity, payoutRateMinor: 500n, payoutCurrency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), status: "active",
      },
    });
    return { db, channel, allocation };
  }

  describe("allocation counters", () => {
    beforeEach(async () => {
      await resetDb();
      await seedRoles(testDb());
      await seedFunnelStages(testDb());
    });

    it("claims a reserved slot on the channel when under cap", async () => {
      const { db, channel } = await setupChannelAndAllocation(5, 5);
      const claimed = await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
      expect(claimed).toBe(true);
      const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(updated.reservedCount).toBe(1);
      expect(updated.deliveredCount).toBe(0);
    });

    it("refuses to claim once reserved+delivered reaches the cap", async () => {
      const { db, channel } = await setupChannelAndAllocation(1, 1);
      const first = await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
      const second = await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
      expect(first).toBe(true);
      expect(second).toBe(false);
      const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(updated.reservedCount).toBe(1);
    });

    it("claims straight into deliveredCount when wantsDelivered is true", async () => {
      const { db, allocation } = await setupChannelAndAllocation(5, 5);
      const claimed = await db.$transaction((tx) => claimAllocationSlot(tx, allocation.id, true));
      expect(claimed).toBe(true);
      const updated = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
      expect(updated.deliveredCount).toBe(1);
      expect(updated.reservedCount).toBe(0);
    });

    it("releaseAllocationSlot frees a reserved slot", async () => {
      const { db, allocation } = await setupChannelAndAllocation(5, 5);
      await db.$transaction((tx) => claimAllocationSlot(tx, allocation.id, false));
      await db.$transaction((tx) => releaseAllocationSlot(tx, allocation.id, false));
      const updated = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
      expect(updated.reservedCount).toBe(0);
    });

    it("convertChannelReservedToDelivered moves one unit without changing the total", async () => {
      const { db, channel } = await setupChannelAndAllocation(5, 5);
      await db.$transaction((tx) => claimChannelSlot(tx, channel.id, false));
      await db.$transaction((tx) => convertChannelReservedToDelivered(tx, channel.id));
      const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: channel.id } });
      expect(updated.reservedCount).toBe(0);
      expect(updated.deliveredCount).toBe(1);
    });

    it("convertAllocationReservedToDelivered moves one unit without changing the total", async () => {
      const { db, allocation } = await setupChannelAndAllocation(5, 5);
      await db.$transaction((tx) => claimAllocationSlot(tx, allocation.id, false));
      await db.$transaction((tx) => convertAllocationReservedToDelivered(tx, allocation.id));
      const updated = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation.id } });
      expect(updated.reservedCount).toBe(0);
      expect(updated.deliveredCount).toBe(1);
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npm test -- tests/allocation-counters.test.ts`
  Expected: FAIL — `src/lib/allocations/counters.ts` does not exist yet.

- [ ] **Step 3: Implement the helpers**

  Create `src/lib/allocations/counters.ts`:
  ```ts
  import type { Prisma } from "@prisma/client";

  type Tx = Prisma.TransactionClient;

  /**
   * Atomically claims one unit of capacity. Raw SQL, not a Prisma `updateMany`
   * `where`, because the guard compares two summed columns against a third —
   * Prisma's filter API can only compare a column to a literal/variable, not
   * to another column. Returns whether the claim succeeded (affected-row
   * count > 0), so the caller can fall back to a cap-reached outcome instead.
   */
  export async function claimChannelSlot(tx: Tx, campaignChannelId: string, wantsDelivered: boolean): Promise<boolean> {
    const claimed = wantsDelivered
      ? await tx.$executeRaw`UPDATE "CampaignChannel" SET "deliveredCount" = "deliveredCount" + 1 WHERE id = ${campaignChannelId} AND "reservedCount" + "deliveredCount" < "contractedQuantity"`
      : await tx.$executeRaw`UPDATE "CampaignChannel" SET "reservedCount" = "reservedCount" + 1 WHERE id = ${campaignChannelId} AND "reservedCount" + "deliveredCount" < "contractedQuantity"`;
    return claimed > 0;
  }

  export async function releaseChannelSlot(tx: Tx, campaignChannelId: string, wasDelivered: boolean): Promise<void> {
    if (wasDelivered) {
      await tx.$executeRaw`UPDATE "CampaignChannel" SET "deliveredCount" = "deliveredCount" - 1 WHERE id = ${campaignChannelId}`;
    } else {
      await tx.$executeRaw`UPDATE "CampaignChannel" SET "reservedCount" = "reservedCount" - 1 WHERE id = ${campaignChannelId}`;
    }
  }

  export async function convertChannelReservedToDelivered(tx: Tx, campaignChannelId: string): Promise<void> {
    await tx.$executeRaw`UPDATE "CampaignChannel" SET "reservedCount" = "reservedCount" - 1, "deliveredCount" = "deliveredCount" + 1 WHERE id = ${campaignChannelId}`;
  }

  export async function claimAllocationSlot(tx: Tx, allocationId: string, wantsDelivered: boolean): Promise<boolean> {
    const claimed = wantsDelivered
      ? await tx.$executeRaw`UPDATE "PartnerAllocation" SET "deliveredCount" = "deliveredCount" + 1 WHERE id = ${allocationId} AND "reservedCount" + "deliveredCount" < "allocatedQuantity"`
      : await tx.$executeRaw`UPDATE "PartnerAllocation" SET "reservedCount" = "reservedCount" + 1 WHERE id = ${allocationId} AND "reservedCount" + "deliveredCount" < "allocatedQuantity"`;
    return claimed > 0;
  }

  export async function releaseAllocationSlot(tx: Tx, allocationId: string, wasDelivered: boolean): Promise<void> {
    if (wasDelivered) {
      await tx.$executeRaw`UPDATE "PartnerAllocation" SET "deliveredCount" = "deliveredCount" - 1 WHERE id = ${allocationId}`;
    } else {
      await tx.$executeRaw`UPDATE "PartnerAllocation" SET "reservedCount" = "reservedCount" - 1 WHERE id = ${allocationId}`;
    }
  }

  export async function convertAllocationReservedToDelivered(tx: Tx, allocationId: string): Promise<void> {
    await tx.$executeRaw`UPDATE "PartnerAllocation" SET "reservedCount" = "reservedCount" - 1, "deliveredCount" = "deliveredCount" + 1 WHERE id = ${allocationId}`;
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npm test -- tests/allocation-counters.test.ts`
  Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/allocations/counters.ts tests/allocation-counters.test.ts
  git commit -m "feat(allocations): add transactional capacity-counter claim/release/convert helpers"
  ```

---

### Task 4: Pacing pure functions

**Files:**
- Create: `src/lib/allocations/pacing.ts`
- Test: `tests/pacing.test.ts`

**Interfaces:**
- Consumes: `operatingDayStart(instant: Date, timeZone: string): Date` from `src/lib/time/operating-day.ts` (existing, unchanged).
- Produces: `expectedToDate(cap: number, startDate: Date, endDate: Date, asOf: Date, timeZone: string): number`, `type PaceSignal = "behind" | "onPace" | "ahead"`, `paceSignal(delivered: number, expected: number): PaceSignal` — consumed by Task 7's admin page and Task 6's partner view.

- [ ] **Step 1: Write the failing tests**

  Create `tests/pacing.test.ts`:
  ```ts
  import { describe, expect, it } from "vitest";
  import { expectedToDate, paceSignal } from "@/lib/allocations/pacing";

  const TZ = "Asia/Kolkata";

  describe("expectedToDate", () => {
    it("expects the full cap on a single-day window, on that day", () => {
      const day = new Date("2026-03-05T10:00:00.000Z"); // well inside the IST calendar day
      expect(expectedToDate(100, day, day, day, TZ)).toBe(100);
    });

    it("expects 0 before the window starts", () => {
      const start = new Date("2026-03-05T00:00:00.000Z");
      const end = new Date("2026-03-14T00:00:00.000Z");
      const before = new Date("2026-03-01T00:00:00.000Z");
      expect(expectedToDate(100, start, end, before, TZ)).toBe(0);
    });

    it("expects the full cap once the window has ended", () => {
      const start = new Date("2026-03-05T00:00:00.000Z");
      const end = new Date("2026-03-14T00:00:00.000Z");
      const after = new Date("2026-04-01T00:00:00.000Z");
      expect(expectedToDate(100, start, end, after, TZ)).toBe(100);
    });

    it("pro-rates linearly across a 10-day window", () => {
      const start = new Date("2026-03-05T00:00:00.000Z");
      const end = new Date("2026-03-14T00:00:00.000Z"); // 10 calendar days inclusive
      const asOf = new Date("2026-03-09T12:00:00.000Z"); // day 5 of 10
      expect(expectedToDate(100, start, end, asOf, TZ)).toBe(50);
    });
  });

  describe("paceSignal", () => {
    it("is behind when delivered is under expected", () => {
      expect(paceSignal(10, 20)).toBe("behind");
    });
    it("is ahead when delivered is over expected", () => {
      expect(paceSignal(30, 20)).toBe("ahead");
    });
    it("is onPace when delivered equals expected", () => {
      expect(paceSignal(20, 20)).toBe("onPace");
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npm test -- tests/pacing.test.ts`
  Expected: FAIL — `src/lib/allocations/pacing.ts` does not exist yet.

- [ ] **Step 3: Implement**

  Create `src/lib/allocations/pacing.ts`:
  ```ts
  import { operatingDayStart } from "@/lib/time/operating-day";

  const DAY_MS = 24 * 60 * 60 * 1000;

  /**
   * Linear pro-ration of `cap` across the flight window, both endpoints
   * inclusive: a 1-day window (startDate === endDate) has totalDays === 1,
   * and on that day elapsedDays === 1 (100% expected). Clamped to
   * [0, totalDays] so a date outside the window still returns a sane 0% or
   * 100% instead of a negative or >100% figure.
   *
   * Day boundaries use `operatingDayStart` (the same helper the codebase
   * already uses to compare `@db.Date` flight-window columns against "now"
   * in the operating timezone) — not `sla.ts`'s business-day/holiday
   * skipping, which doesn't apply here: a flight window's pacing expectation
   * doesn't pause for a weekend the way a verification SLA clock does.
   */
  export function expectedToDate(cap: number, startDate: Date, endDate: Date, asOf: Date, timeZone: string): number {
    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / DAY_MS) + 1;
    const today = operatingDayStart(asOf, timeZone);
    const rawElapsedDays = Math.round((today.getTime() - startDate.getTime()) / DAY_MS) + 1;
    const elapsedDays = Math.min(Math.max(rawElapsedDays, 0), totalDays);
    return cap * (elapsedDays / totalDays);
  }

  export type PaceSignal = "behind" | "onPace" | "ahead";

  export function paceSignal(delivered: number, expected: number): PaceSignal {
    if (delivered < expected) return "behind";
    if (delivered > expected) return "ahead";
    return "onPace";
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npm test -- tests/pacing.test.ts`
  Expected: PASS (all 7 tests).

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/allocations/pacing.ts tests/pacing.test.ts
  git commit -m "feat(allocations): add pacing pure functions (expectedToDate, paceSignal)"
  ```

---

### Task 5: Intake cap enforcement

**Files:**
- Modify: `src/lib/leads/intake.ts:72-465` (`submitLeadFile`)
- Test: `tests/lead-intake-caps.test.ts` (new)

**Interfaces:**
- Consumes: `claimChannelSlot`, `claimAllocationSlot`, `releaseAllocationSlot` from `src/lib/allocations/counters.ts` (Task 3).
- Consumes: `ALLOCATION_CAP_EXCEEDED` / `CHANNEL_CAP_REACHED` `RejectReason` codes (Task 1).
- Produces: no signature change to `submitLeadFile` — a row that would otherwise be `"passed"`/`"needsReview"` can now come back as `"failed"` with one of the two new reject reasons when capacity is exhausted, exactly like any other business-rule rejection (`SUPPRESSED_ACCOUNT`, `DUPLICATE_IN_CAMPAIGN`, etc. already do).

- [ ] **Step 1: Write the failing tests**

  Create `tests/lead-intake-caps.test.ts`. This reuses `setupChannel` from `tests/lead-intake-partner.test.ts` verbatim (copy it in rather than importing across test files, matching this codebase's existing convention of a private per-file setup helper):
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { resetDb, testDb } from "./helpers/db";
  import { seedRoles } from "../prisma/seed/roles";
  import { seedFunnelStages } from "../prisma/seed/funnel-stages";
  import { seedRejectReasons } from "../prisma/seed/reject-reasons";
  import { createOrganization, createUser } from "./helpers/factories";
  import { loadActor } from "@/lib/auth/permissions";
  import { createAllocation } from "@/lib/allocations/crud";
  import { submitLeadFile } from "@/lib/leads/intake";
  import { normalizeEmail } from "@/lib/normalise/email";
  import { hashSuppressionValue } from "@/lib/lists/suppression";

  async function setupChannel(contractedQuantity = 100) {
    const db = testDb();
    const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
    const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
    const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
    const opsUser = await createUser(db, internalOrg.id, "CAMPAIGN_MANAGER");
    const actor = await loadActor(db, opsUser.id);
    const allocActor = await loadActor(db, (await createUser(db, internalOrg.id, "OPERATIONS")).id);

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
        producesLeads: true, requiresAsset: false, metricMode: "event",
        allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
      },
    });
    const channelTypeVersion = await db.channelTypeVersion.create({
      data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
    });
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
        status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
        currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
      },
    });
    const campaignChannel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
        contractedQuantity, clientUnitPriceMinor: 1000n, currency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
      },
    });
    await db.leadFieldSpec.create({
      data: { campaignId: campaign.id, fieldKey: "email", label: "Email", dataType: "email", isRequired: true, rejectIfMissing: true },
    });
    return { db, actor, allocActor, campaignChannel, partnerOrg, campaign, clientOrg };
  }

  function csvRow(email: string) {
    return `email,companyDomain\n${email},example-${email}.com\n`;
  }

  describe("submitLeadFile — cap enforcement", () => {
    beforeEach(async () => {
      await resetDb();
      await seedRoles(testDb());
      await seedFunnelStages(testDb());
      await seedRejectReasons(testDb());
    });

    it("rejects a row with ALLOCATION_CAP_EXCEEDED once the allocation is full", async () => {
      const { db, actor, allocActor, campaignChannel, partnerOrg } = await setupChannel();
      await createAllocation(db, allocActor, {
        campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
        allocatedQuantity: 1, payoutRate: "5.00", payoutCurrency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
      });

      const first = await submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
        content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      });
      expect(first.rowsAccepted).toBe(1); // structurally accepted — the Lead was created, whatever its outcome

      const second = await submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
        content: csvRow("b@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      });
      const lead = await db.lead.findFirstOrThrow({ where: { submissionId: second.submissionId } });
      expect(lead.verificationStatus).toBe("failed");
      const reason = await db.rejectReason.findUniqueOrThrow({ where: { id: lead.rejectReasonId! } });
      expect(reason.code).toBe("ALLOCATION_CAP_EXCEEDED");
    });

    it("under true concurrency, exactly one of two simultaneous submissions claims the last slot", async () => {
      const { db, actor, allocActor, campaignChannel, partnerOrg } = await setupChannel();
      await createAllocation(db, allocActor, {
        campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
        allocatedQuantity: 1, payoutRate: "5.00", payoutCurrency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), revealClientIdentity: false,
      });

      // Two genuinely concurrent submissions (Promise.all, not sequential
      // awaits) racing for the same single slot. Postgres's row lock on the
      // conditional UPDATE inside claimAllocationSlot (Task 3) serializes
      // them — the second transaction blocks until the first commits, then
      // re-evaluates its WHERE predicate against the now-updated row — so
      // exactly one must win regardless of scheduling.
      const [resultA, resultB] = await Promise.all([
        submitLeadFile(db, actor, {
          campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
          content: csvRow("race-a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
        }),
        submitLeadFile(db, actor, {
          campaignChannelId: campaignChannel.id, sourceType: "partner", partnerOrganizationId: partnerOrg.id,
          content: csvRow("race-b@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
        }),
      ]);

      const leadA = await db.lead.findFirstOrThrow({ where: { submissionId: resultA.submissionId } });
      const leadB = await db.lead.findFirstOrThrow({ where: { submissionId: resultB.submissionId } });
      const outcomes = [leadA.verificationStatus, leadB.verificationStatus];
      expect(outcomes.filter((s) => s !== "failed")).toHaveLength(1);
      expect(outcomes.filter((s) => s === "failed")).toHaveLength(1);

      const finalAllocation = await db.partnerAllocation.findFirstOrThrow({
        where: { campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id },
      });
      expect(finalAllocation.reservedCount + finalAllocation.deliveredCount).toBe(1); // never over-claimed
    });

    it("rejects a row with CHANNEL_CAP_REACHED once the channel cap is full, even for an internal submission", async () => {
      const { db, actor, campaignChannel } = await setupChannel(1);
      const first = await submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "internal",
        content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      });
      expect(first.rowsAccepted).toBe(1);

      const second = await submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "internal",
        content: csvRow("b@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      });
      const lead = await db.lead.findFirstOrThrow({ where: { submissionId: second.submissionId } });
      expect(lead.verificationStatus).toBe("failed");
      const reason = await db.rejectReason.findUniqueOrThrow({ where: { id: lead.rejectReasonId! } });
      expect(reason.code).toBe("CHANNEL_CAP_REACHED");
    });

    it("claims deliveredCount (not reservedCount) for an auto-passed row", async () => {
      const { db, actor, campaignChannel } = await setupChannel(10);
      await submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "internal",
        content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      });
      const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
      expect(updated.deliveredCount).toBe(1);
      expect(updated.reservedCount).toBe(0);
    });

    it("does not consume any capacity for a row that fails for an unrelated reason (e.g. suppression)", async () => {
      const { db, actor, campaignChannel, campaign, clientOrg } = await setupChannel(10);
      const normalizedEmail = normalizeEmail("a@example.com");
      const list = await db.suppressionList.create({
        data: { ownerOrganizationId: clientOrg.id, name: "Suppress", isReusable: false, type: "custom" },
      });
      await db.suppressionEntry.create({
        data: { listId: list.id, type: "email", value: normalizedEmail, valueHash: hashSuppressionValue(normalizedEmail) },
      });
      await db.campaignSuppressionList.create({ data: { campaignId: campaign.id, listId: list.id } });

      await submitLeadFile(db, actor, {
        campaignChannelId: campaignChannel.id, sourceType: "internal",
        content: csvRow("a@example.com"), mapping: { email: "email", companyDomain: "companyDomain" },
      });
      const updated = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
      expect(updated.deliveredCount).toBe(0);
      expect(updated.reservedCount).toBe(0);
    });
  });
  ```
  This requires two more imports at the top of the file: `import { normalizeEmail } from "@/lib/normalise/email";` and `import { hashSuppressionValue } from "@/lib/lists/suppression";`. It also requires `setupChannel` to return `clientOrg` alongside its existing return values — add `clientOrg` to the object `setupChannel` returns (it already creates `clientOrg` locally, just wasn't returning it).

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npm test -- tests/lead-intake-caps.test.ts`
  Expected: FAIL — no cap enforcement exists yet, so both cap tests see `rowsAccepted`/`verificationStatus` reflecting no rejection, and the counter tests see `deliveredCount`/`reservedCount` still at 0 (columns exist from Task 1 but nothing writes to them yet).

- [ ] **Step 3: Fetch the two cap reject-reason ids once per submission**

  Edit `src/lib/leads/intake.ts`. After the existing partner-allocation lookup (currently lines 91-103, which already does `db.partnerAllocation.findFirst(...)` and stores it in `allocation`), add, still before the row loop starts (before line 134's `const parsed = ...` or anywhere after line 103 and before the loop):
  ```ts
  const allocationCapReason = await db.rejectReason.findUniqueOrThrow({ where: { code: "ALLOCATION_CAP_EXCEEDED" } });
  const channelCapReason = await db.rejectReason.findUniqueOrThrow({ where: { code: "CHANNEL_CAP_REACHED" } });
  ```
  Note the existing lookup at line 95-100 must keep its own local variable name (`allocation`) — reuse `allocation.id` inside the loop below rather than re-querying per row (the partner+channel pair is fixed for the whole submission, and Task 2's uniqueness guarantee makes this single lookup valid for every row in the file).

- [ ] **Step 4: Move cap enforcement into the per-row transaction**

  Edit the transaction block (currently lines 387-435). Add the import at the top of the file:
  ```ts
  import { claimChannelSlot, claimAllocationSlot, releaseAllocationSlot } from "@/lib/allocations/counters";
  ```
  Replace the transaction block with:
  ```ts
      await db.$transaction(async (tx) => {
        // --- Cap enforcement: only for a row that isn't already failed for an
        // unrelated reason (a row that was going to be rejected anyway must
        // not also be charged against capacity it was never going to use). ---
        let finalVerificationStatus = verificationStatus;
        let finalRejectReasonId = rejectReasonId;
        let finalAcceptedAt: Date | null = autoAccepted ? now : null;
        let finalClientVisible = autoAccepted;
        let finalLifecycleStatus: "new" | "accepted" = autoAccepted ? "accepted" : "new";

        if (verificationStatus !== "failed") {
          const wantsDelivered = verificationStatus === "passed";

          if (input.partnerOrganizationId !== undefined) {
            const allocationClaimed = await claimAllocationSlot(tx, allocation!.id, wantsDelivered);
            if (!allocationClaimed) {
              finalVerificationStatus = "failed";
              finalRejectReasonId = allocationCapReason.id;
              finalAcceptedAt = null;
              finalClientVisible = false;
              finalLifecycleStatus = "new";
            }
          }

          if (finalVerificationStatus !== "failed") {
            const channelClaimed = await claimChannelSlot(tx, input.campaignChannelId, wantsDelivered);
            if (!channelClaimed) {
              if (input.partnerOrganizationId !== undefined) {
                // The allocation claim above succeeded but the channel is
                // full — undo it so this row consumes neither.
                await releaseAllocationSlot(tx, allocation!.id, wantsDelivered);
              }
              finalVerificationStatus = "failed";
              finalRejectReasonId = channelCapReason.id;
              finalAcceptedAt = null;
              finalClientVisible = false;
              finalLifecycleStatus = "new";
            }
          }
        }

        const lead = await tx.lead.create({
          data: {
            campaignChannelId: input.campaignChannelId,
            submissionId: submission.id,
            contactId: contact.id,
            accountId: account.id,
            sourceType: input.sourceType,
            verificationStatus: finalVerificationStatus,
            lifecycleStatus: finalLifecycleStatus,
            clientVisible: finalClientVisible,
            ...(finalLifecycleStatus === "accepted"
              ? {
                  acceptedAt: finalAcceptedAt,
                  verificationElapsedMinutes: 0,
                  verificationElapsedBusinessMinutes: 0,
                  slaBreached: false,
                }
              : {}),
            rejectReasonId: finalRejectReasonId,
            fieldValuesJson: values as Prisma.InputJsonValue,
          },
        });
        await tx.leadStatusHistory.create({
          data: {
            leadId: lead.id,
            dimension: "verification",
            fromValue: null,
            toValue: finalVerificationStatus,
          },
        });
        if (finalLifecycleStatus === "accepted") {
          await tx.leadStatusHistory.create({
            data: {
              leadId: lead.id,
              dimension: "lifecycle",
              fromValue: "new",
              toValue: "accepted",
              changedByUserId: null,
            },
          });
        }
      });
  ```
  Note `allocation!` — the existing top-of-function lookup (line 95-100) already guarantees `allocation` is non-null whenever `input.partnerOrganizationId !== undefined` (the function throws `ValidationError` earlier if a partner submission has no matching allocation), so the non-null assertion here is safe, matching the existing code's own reasoning at that point.

- [ ] **Step 5: Run tests to verify they pass**

  Run: `npm test -- tests/lead-intake-caps.test.ts`
  Expected: PASS (all 5 tests). Then run the full existing intake/verification suites to check for regressions:
  Run: `npm test -- tests/lead-intake-partner.test.ts tests/lead-verification.test.ts`
  Expected: PASS (no behavior change for rows that never hit a cap).

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/leads/intake.ts tests/lead-intake-caps.test.ts
  git commit -m "feat(intake): enforce allocation and channel volume caps at intake"
  ```

---

### Task 6: Verification-decide counter wiring

**Files:**
- Modify: `src/lib/leads/verification.ts:82-245` (`decideLeadVerification`)
- Test: `tests/lead-verification-counters.test.ts` (new)

**Interfaces:**
- Consumes: `convertChannelReservedToDelivered`, `convertAllocationReservedToDelivered`, `releaseChannelSlot`, `releaseAllocationSlot` from `src/lib/allocations/counters.ts` (Task 3).
- Produces: no signature change to `decideLeadVerification` — accept converts `reservedCount → deliveredCount` on the channel and (if the lead is partner-sourced) the allocation; reject releases `reservedCount` only, on both.

- [ ] **Step 1: Write the failing tests**

  Create `tests/lead-verification-counters.test.ts`, adapting `setupNeedsReviewLead` from `tests/lead-verification.test.ts:12-86` (same campaign/channel/account/contact/lead shape), extended to optionally attribute the submission to a partner and create a matching `PartnerAllocation`, with both counters pre-claimed to mirror the state Task 5's intake wiring leaves behind for a `needsReview` row:
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { resetDb, testDb } from "./helpers/db";
  import { seedRoles } from "../prisma/seed/roles";
  import { seedFunnelStages } from "../prisma/seed/funnel-stages";
  import { seedSettings } from "../prisma/seed/settings";
  import { seedRejectReasons } from "../prisma/seed/reject-reasons";
  import { createOrganization, createUser } from "./helpers/factories";
  import { normalizeCompanyName } from "@/lib/normalise/name";
  import { normalizeEmail } from "@/lib/normalise/email";
  import { loadActor } from "@/lib/auth/permissions";
  import { decideLeadVerification } from "@/lib/leads/verification";

  async function setupNeedsReviewLead(options: { withPartnerAllocation: boolean }) {
    const db = testDb();
    const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
    const internalOrg = await createOrganization(db, { isInternal: true, isClient: false });
    const reviewer = await createUser(db, internalOrg.id, "QUALITY");

    const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
    const channelType = await db.channelType.create({
      data: {
        code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
        producesLeads: true, requiresAsset: false, metricMode: "event",
        allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
      },
    });
    const channelTypeVersion = await db.channelTypeVersion.create({
      data: { channelTypeId: channelType.id, version: 1, definitionJson: {}, publishedById: "system" },
    });
    const campaign = await db.campaign.create({
      data: {
        clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
        status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
        currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
      },
    });
    const campaignChannel = await db.campaignChannel.create({
      data: {
        campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
        contractedQuantity: 10, clientUnitPriceMinor: 1000n, currency: "USD",
        startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
        reservedCount: 1,
      },
    });

    let partnerOrg: Awaited<ReturnType<typeof createOrganization>> | null = null;
    let allocation: Awaited<ReturnType<typeof db.partnerAllocation.create>> | null = null;
    if (options.withPartnerAllocation) {
      partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
      allocation = await db.partnerAllocation.create({
        data: {
          campaignChannelId: campaignChannel.id, partnerOrganizationId: partnerOrg.id,
          allocatedQuantity: 5, reservedCount: 1, payoutRateMinor: 500n, payoutCurrency: "USD",
          startDate: new Date("2026-01-01"), endDate: new Date("2026-06-30"), status: "active",
        },
      });
    }

    const account = await db.account.create({ data: { name: "Acme", normalizedName: normalizeCompanyName("Acme") } });
    const email = normalizeEmail(`lead-${Date.now()}@example.com`);
    const contact = await db.contact.create({ data: { accountId: account.id, email, emailNormalized: email } });
    const submission = await db.leadSubmission.create({
      data: {
        campaignChannelId: campaignChannel.id,
        sourceType: options.withPartnerAllocation ? "partner" : "internal",
        submittedById: reviewer.id,
        partnerOrganizationId: partnerOrg?.id,
        mappingJson: {},
      },
    });
    const lead = await db.lead.create({
      data: {
        campaignChannelId: campaignChannel.id, submissionId: submission.id, contactId: contact.id,
        accountId: account.id, sourceType: options.withPartnerAllocation ? "partner" : "internal",
        verificationStatus: "needsReview", fieldValuesJson: {},
      },
    });

    return { db, lead, campaignChannel, allocation, reviewerActor: await loadActor(db, reviewer.id) };
  }

  describe("decideLeadVerification — counters", () => {
    beforeEach(async () => {
      await resetDb();
      await seedRoles(testDb());
      await seedFunnelStages(testDb());
      await seedSettings(testDb());
      await seedRejectReasons(testDb());
    });

    it("accept converts reservedCount to deliveredCount on both channel and allocation", async () => {
      const { db, lead, campaignChannel, allocation, reviewerActor } = await setupNeedsReviewLead({ withPartnerAllocation: true });
      await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });

      const updatedChannel = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
      expect(updatedChannel.reservedCount).toBe(0);
      expect(updatedChannel.deliveredCount).toBe(1);

      const updatedAllocation = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
      expect(updatedAllocation.reservedCount).toBe(0);
      expect(updatedAllocation.deliveredCount).toBe(1);
    });

    it("reject releases reservedCount on both channel and allocation, deliveredCount unchanged", async () => {
      const { db, lead, campaignChannel, allocation, reviewerActor } = await setupNeedsReviewLead({ withPartnerAllocation: true });
      await decideLeadVerification(db, reviewerActor, {
        leadId: lead.id, decision: "reject", rejectReasonCode: "DUPLICATE_IN_CAMPAIGN",
      });

      const updatedChannel = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
      expect(updatedChannel.reservedCount).toBe(0);
      expect(updatedChannel.deliveredCount).toBe(0);

      const updatedAllocation = await db.partnerAllocation.findUniqueOrThrow({ where: { id: allocation!.id } });
      expect(updatedAllocation.reservedCount).toBe(0);
      expect(updatedAllocation.deliveredCount).toBe(0);
    });

    it("an internal-sourced lead's decide only touches the channel counters, no allocation lookup", async () => {
      const { db, lead, campaignChannel, reviewerActor } = await setupNeedsReviewLead({ withPartnerAllocation: false });
      await decideLeadVerification(db, reviewerActor, { leadId: lead.id, decision: "accept" });

      const updatedChannel = await db.campaignChannel.findUniqueOrThrow({ where: { id: campaignChannel.id } });
      expect(updatedChannel.reservedCount).toBe(0);
      expect(updatedChannel.deliveredCount).toBe(1);
      // No PartnerAllocation row exists in this branch at all — the function
      // completing without error proves it never dereferences a null allocation.
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npm test -- tests/lead-verification-counters.test.ts`
  Expected: FAIL — no counter wiring exists yet in `decideLeadVerification`, so accept/reject leave `reservedCount`/`deliveredCount` unchanged from whatever the test's arrange step set them to.

- [ ] **Step 3: Resolve the lead's allocation and wire counters into the transaction**

  Edit `src/lib/leads/verification.ts`. Add the import:
  ```ts
  import {
    convertChannelReservedToDelivered, convertAllocationReservedToDelivered,
    releaseChannelSlot, releaseAllocationSlot,
  } from "@/lib/allocations/counters";
  ```
  Change the initial `db.lead.findUniqueOrThrow` (currently lines 89-96) to also select the submission's partner:
  ```ts
    const lead = await db.lead.findUniqueOrThrow({
      where: { id: input.leadId },
      include: {
        campaignChannel: {
          include: { campaign: true, channelTypeVersion: { include: { channelType: true } } },
        },
        submission: { select: { partnerOrganizationId: true } },
      },
    });
  ```
  After that fetch (anywhere before the `db.$transaction` call, e.g. directly above it), resolve the allocation once:
  ```ts
    const allocation = lead.submission.partnerOrganizationId === null
      ? null
      : await db.partnerAllocation.findFirst({
          where: {
            campaignChannelId: lead.campaignChannelId,
            partnerOrganizationId: lead.submission.partnerOrganizationId,
            status: { not: "ended" },
          },
        });
  ```
  The `status: { not: "ended" }` filter is required, not optional — an `ended` allocation from before a reallocation can still be sitting in the table alongside the live one (Task 2 guarantees at most one non-`ended` row, but says nothing about `ended` rows from history), and only the live one's counters matter here.

  Inside the existing `db.$transaction(async (tx) => { ... })` block (currently lines 187-242), after the `updateMany` guard succeeds (after the `if (count === 0) throw ...` check, before `tx.verificationRecord.create`), add:
  ```ts
      if (effectiveDecision === "accept") {
        await convertChannelReservedToDelivered(tx, lead.campaignChannelId);
        if (allocation !== null) await convertAllocationReservedToDelivered(tx, allocation.id);
      } else {
        await releaseChannelSlot(tx, lead.campaignChannelId, false);
        if (allocation !== null) await releaseAllocationSlot(tx, allocation.id, false);
      }
  ```
  `false` (not delivered) is correct for the reject branch unconditionally: `decideLeadVerification` only ever acts on a lead whose `verificationStatus` is `needsReview` (enforced by the guard earlier in the function), and Task 5's intake wiring only ever claims `reservedCount` — never `deliveredCount` — for a row that reaches `needsReview`. There is no code path where a lead reaching this function was ever claimed as delivered.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npm test -- tests/lead-verification-counters.test.ts`
  Expected: PASS (all 3 tests). Then check for regressions:
  Run: `npm test -- tests/lead-verification.test.ts`
  Expected: PASS (unchanged behavior for every existing assertion — this task only adds counter side effects, no change to `DecideLeadVerificationResult` or any existing field).

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/leads/verification.ts tests/lead-verification-counters.test.ts
  git commit -m "feat(verification): convert/release delivery counters on accept/reject decisions"
  ```

---

### Task 7: Partner-facing pacing view

**Files:**
- Modify: `src/lib/allocations/partner-view.ts` (`PartnerAllocationView`, `getAllocationsForPartner`)
- Modify: `src/app/partner/allocations/page.tsx`
- Test: `tests/partner-view-pacing.test.ts` (new)

**Interfaces:**
- Consumes: `expectedToDate`, `paceSignal`, `type PaceSignal` from `src/lib/allocations/pacing.ts` (Task 4).
- Consumes: `getSetting` from `src/lib/settings/settings.ts` (existing).
- Produces: `PartnerAllocationView` gains `deliveredCount: number`, `allocatedQuantity` unchanged (still the cap), `pace: PaceSignal`.

- [ ] **Step 1: Write the failing test**

  Create `tests/partner-view-pacing.test.ts`:
  ```ts
  import { beforeEach, describe, expect, it } from "vitest";
  import { resetDb, testDb } from "./helpers/db";
  import { seedRoles } from "../prisma/seed/roles";
  import { seedFunnelStages } from "../prisma/seed/funnel-stages";
  import { seedSettings } from "../prisma/seed/settings";
  import { createOrganization, createUser } from "./helpers/factories";
  import { loadActor } from "@/lib/auth/permissions";
  import { getAllocationsForPartner } from "@/lib/allocations/partner-view";

  describe("getAllocationsForPartner — pacing", () => {
    beforeEach(async () => {
      await resetDb();
      await seedRoles(testDb());
      await seedFunnelStages(testDb());
      await seedSettings(testDb());
    });

    it("includes deliveredCount and a pace signal for the partner's own active allocation", async () => {
      const db = testDb();
      const clientOrg = await createOrganization(db, { isClient: true, isInternal: false });
      const partnerOrg = await createOrganization(db, { isPartner: true, isInternal: false, isClient: false });
      const partnerUser = await createUser(db, partnerOrg.id, "PARTNER_ADMIN");
      const actor = await loadActor(db, partnerUser.id);

      const stage = await db.funnelStage.findUniqueOrThrow({ where: { code: "MOFU" } });
      const channelType = await db.channelType.create({
        data: {
          code: `CT-${Date.now()}`, name: "Test Channel", funnelStageId: stage.id,
          producesLeads: true, requiresAsset: false, metricMode: "event",
          allowedMetricFieldsJson: [], pricingUnit: "CPL", requiresTeleVerification: false, currentVersion: 1,
        },
      });
      const channelTypeVersion = await db.channelTypeVersion.create({
        data: { channelTypeId: channelType.id, version: 1, definitionJson: { name: "Test Channel", funnelStageCode: "MOFU" }, publishedById: "system" },
      });
      const campaign = await db.campaign.create({
        data: {
          clientOrganizationId: clientOrg.id, name: "Test Campaign", code: `CAM-${Date.now()}`,
          status: "live", startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"),
          currency: "USD", advisoryIcpMatch: false, advisoryTalMatch: false,
        },
      });
      const channel = await db.campaignChannel.create({
        data: {
          campaignId: campaign.id, channelTypeVersionId: channelTypeVersion.id,
          contractedQuantity: 100, clientUnitPriceMinor: 1000n, currency: "USD",
          startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
        },
      });
      await db.partnerAllocation.create({
        data: {
          campaignChannelId: channel.id, partnerOrganizationId: partnerOrg.id,
          allocatedQuantity: 10, deliveredCount: 3, reservedCount: 1,
          payoutRateMinor: 500n, payoutCurrency: "USD",
          startDate: new Date("2026-01-01"), endDate: new Date("2026-12-31"), status: "active",
        },
      });

      const [view] = await getAllocationsForPartner(db, actor);
      expect(view.deliveredCount).toBe(3);
      expect(["behind", "onPace", "ahead"]).toContain(view.pace);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npm test -- tests/partner-view-pacing.test.ts`
  Expected: FAIL — `deliveredCount`/`pace` are not on `PartnerAllocationView` yet.

- [ ] **Step 3: Extend the read model**

  Edit `src/lib/allocations/partner-view.ts`:
  ```ts
  import type { PrismaClient } from "@prisma/client";
  import { assertPermission, type Actor } from "@/lib/auth/permissions";
  import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
  import { getSetting } from "@/lib/settings/settings";
  import { expectedToDate, paceSignal, type PaceSignal } from "@/lib/allocations/pacing";

  export type PartnerAllocationView = {
    id: string;
    channelTypeName: string;
    funnelStageCode: string;
    allocatedQuantity: number;
    deliveredCount: number;
    pace: PaceSignal;
    payoutRateMinor: bigint;
    payoutCurrency: string;
    startDate: Date;
    endDate: Date;
  };

  export async function getAllocationsForPartner(
    db: PrismaClient,
    actor: Actor,
  ): Promise<PartnerAllocationView[]> {
    assertPermission(actor, "allocation:read");
    const timeZone = await getSetting(db, "operatingTimezone");
    const rows = await db.partnerAllocation.findMany({
      where: { partnerOrganizationId: actor.organizationId, status: "active" },
      select: {
        id: true, allocatedQuantity: true, deliveredCount: true, payoutRateMinor: true, payoutCurrency: true,
        startDate: true, endDate: true,
        campaignChannel: { select: { channelTypeVersion: { select: { definitionJson: true } } } },
      },
    });
    const now = new Date();
    return rows.map((r) => {
      const def = r.campaignChannel.channelTypeVersion.definitionJson as ChannelTypeDefinition;
      const expected = expectedToDate(r.allocatedQuantity, r.startDate, r.endDate, now, timeZone);
      return {
        id: r.id, channelTypeName: def.name, funnelStageCode: def.funnelStageCode,
        allocatedQuantity: r.allocatedQuantity, deliveredCount: r.deliveredCount,
        pace: paceSignal(r.deliveredCount, expected),
        payoutRateMinor: r.payoutRateMinor,
        payoutCurrency: r.payoutCurrency, startDate: r.startDate, endDate: r.endDate,
      };
    });
  }
  ```
  The `select` still never reaches `campaignChannel.campaign` — the AUTH-10 boundary this read model exists to enforce is unaffected; only two new scalar columns and a computed field are added.

- [ ] **Step 4: Update the partner UI**

  Edit `src/app/partner/allocations/page.tsx`, adding two columns:
  ```tsx
  import { db } from "@/lib/db";
  import { requireActor } from "@/lib/auth/require";
  import { assertPortal } from "@/lib/auth/permissions";
  import { getAllocationsForPartner } from "@/lib/allocations/partner-view";
  import { fromMinorUnits } from "@/lib/money/currency";
  import { Badge } from "@/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  } from "@/components/ui/table";

  export default async function PartnerAllocationsPage() {
    const actor = await requireActor();
    assertPortal(actor, "partner");
    const allocations = await getAllocationsForPartner(db, actor);

    return (
      <Card>
        <CardHeader><CardTitle>Your allocations</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Channel type</TableHead>
                <TableHead>Funnel stage</TableHead>
                <TableHead>Delivered / cap</TableHead>
                <TableHead>Pace</TableHead>
                <TableHead>Payout rate</TableHead>
                <TableHead>Window</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {allocations.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No active allocations.
                  </TableCell>
                </TableRow>
              )}
              {allocations.map((a) => (
                <TableRow key={a.id}>
                  <TableCell>{a.channelTypeName}</TableCell>
                  <TableCell>{a.funnelStageCode}</TableCell>
                  <TableCell>{a.deliveredCount} / {a.allocatedQuantity}</TableCell>
                  <TableCell>
                    <Badge variant={a.pace === "behind" ? "destructive" : a.pace === "ahead" ? "default" : "secondary"}>
                      {a.pace}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {a.payoutCurrency} {fromMinorUnits(a.payoutRateMinor, a.payoutCurrency)}
                  </TableCell>
                  <TableCell>
                    {a.startDate.toISOString().slice(0, 10)} – {a.endDate.toISOString().slice(0, 10)}
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
  Check `src/components/ui/badge.tsx`'s exported `variant` options before this step — the three values used above (`destructive`/`default`/`secondary`) are this codebase's common shadcn `Badge` variants elsewhere (e.g. `AssetStatusControl`), but confirm the exact set in that file rather than assuming.

- [ ] **Step 5: Run tests to verify they pass**

  Run: `npm test -- tests/partner-view-pacing.test.ts`
  Expected: PASS. Then spot-check the page live: sign in as a seeded `PARTNER_ADMIN` demo account (per `reference_demo_accounts` memory) and confirm `/partner/allocations` renders the new columns without error.

- [ ] **Step 6: Commit**

  ```bash
  git add src/lib/allocations/partner-view.ts src/app/partner/allocations/page.tsx tests/partner-view-pacing.test.ts
  git commit -m "feat(partner): show delivered/cap and pace signal on the partner allocations view"
  ```

---

### Task 8: Admin pacing page

**Files:**
- Create: `src/app/(admin)/campaigns/[id]/channels/[channelId]/pacing/page.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx` (Channels table, currently lines 116-163)

**Interfaces:**
- Consumes: `getCampaignForActor` from `src/lib/campaigns/crud.ts` (existing, used by the sibling `allocations/page.tsx` for the same not-found/org-access handling).
- Consumes: `expectedToDate`, `paceSignal` from `src/lib/allocations/pacing.ts` (Task 4).
- Consumes: `getSetting` from `src/lib/settings/settings.ts`.

- [ ] **Step 1: Create the pacing page**

  Model this directly on `src/app/(admin)/campaigns/[id]/channels/[channelId]/allocations/page.tsx` (read that file in full first — it already has the not-found/org-access/channel-lookup boilerplate this page needs verbatim). Create `src/app/(admin)/campaigns/[id]/channels/[channelId]/pacing/page.tsx`:
  ```tsx
  import Link from "next/link";
  import type { Route } from "next";
  import { notFound } from "next/navigation";
  import { ArrowLeft } from "lucide-react";
  import { db } from "@/lib/db";
  import { requireActor } from "@/lib/auth/require";
  import { getCampaignForActor } from "@/lib/campaigns/crud";
  import { getSetting } from "@/lib/settings/settings";
  import { expectedToDate, paceSignal } from "@/lib/allocations/pacing";
  import { NotFoundError } from "@/lib/errors";
  import { Badge } from "@/components/ui/badge";
  import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
  import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  } from "@/components/ui/table";

  export default async function ChannelPacingPage({
    params,
  }: {
    params: Promise<{ id: string; channelId: string }>;
  }) {
    const { id, channelId } = await params;
    const actor = await requireActor();

    let campaign;
    try {
      campaign = await getCampaignForActor(db, actor, id);
    } catch (error) {
      if (error instanceof NotFoundError) notFound();
      throw error;
    }

    const channel = campaign.channels.find((c) => c.id === channelId);
    if (channel === undefined) notFound();

    const timeZone = await getSetting(db, "operatingTimezone");
    const now = new Date();
    const channelExpected = expectedToDate(channel.contractedQuantity, channel.startDate, channel.endDate, now, timeZone);
    const channelPace = paceSignal(channel.deliveredCount, channelExpected);

    const allocations = await db.partnerAllocation.findMany({
      where: { campaignChannelId: channelId },
      include: { partnerOrganization: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Per-partner rejection rate: computed on read, not a stored counter —
    // a monitoring display value with no cap/enforcement dependency.
    const rejectionRows = await db.$queryRaw<{ partnerOrganizationId: string | null; rejected: bigint; total: bigint }[]>`
      SELECT ls."partnerOrganizationId",
             COUNT(*) FILTER (WHERE l."lifecycleStatus" = 'rejected') AS rejected,
             COUNT(*) AS total
      FROM "Lead" l
      JOIN "LeadSubmission" ls ON ls.id = l."submissionId"
      WHERE l."campaignChannelId" = ${channelId}
      GROUP BY ls."partnerOrganizationId"
    `;
    const rejectionByPartner = new Map(
      rejectionRows
        .filter((r) => r.partnerOrganizationId !== null)
        .map((r) => [r.partnerOrganizationId as string, { rejected: Number(r.rejected), total: Number(r.total) }]),
    );

    const badgeVariant = (pace: "behind" | "onPace" | "ahead") =>
      pace === "behind" ? "destructive" : pace === "ahead" ? "default" : "secondary";

    return (
      <div className="flex flex-col gap-6">
        <Link
          href={`/campaigns/${campaign.id}` as Route}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Back to campaign
        </Link>

        <Card>
          <CardHeader><CardTitle>Channel pacing</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-2">
            <div>Delivered: {channel.deliveredCount} / {channel.contractedQuantity} (reserved: {channel.reservedCount})</div>
            <div>Expected to date: {channelExpected.toFixed(1)}</div>
            <Badge variant={badgeVariant(channelPace)}>{channelPace}</Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Per-partner rejection rate</CardTitle></CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Partner</TableHead>
                  <TableHead>Delivered / cap</TableHead>
                  <TableHead>Pace</TableHead>
                  <TableHead>Rejection rate</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {allocations.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No allocations on this channel.
                    </TableCell>
                  </TableRow>
                )}
                {allocations.map((a) => {
                  const expected = expectedToDate(a.allocatedQuantity, a.startDate, a.endDate, now, timeZone);
                  const pace = paceSignal(a.deliveredCount, expected);
                  const rejection = rejectionByPartner.get(a.partnerOrganizationId);
                  const rate = rejection === undefined || rejection.total === 0
                    ? "—"
                    : `${((rejection.rejected / rejection.total) * 100).toFixed(0)}%`;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>{a.partnerOrganization.name}</TableCell>
                      <TableCell>{a.deliveredCount} / {a.allocatedQuantity}</TableCell>
                      <TableCell><Badge variant={badgeVariant(pace)}>{pace}</Badge></TableCell>
                      <TableCell>{rate}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    );
  }
  ```
  Confirm `src/components/ui/badge.tsx`'s `variant` prop accepts `"destructive" | "default" | "secondary"` before this step (same check as Task 7 Step 4). Confirm the exact `Lead`/`LeadSubmission` column names used in the raw query (`campaignChannelId`, `submissionId`, `partnerOrganizationId`, `lifecycleStatus`) against `prisma/schema.prisma` — they're taken directly from the models read earlier in this plan's research, but re-verify before running.

- [ ] **Step 2: Link to it from the campaign page**

  Edit `src/app/(admin)/campaigns/[id]/page.tsx`. Add a `TableHead` after `Allocations` (currently line 125):
  ```tsx
                <TableHead>Pacing</TableHead>
  ```
  Add a `TableCell` after the Allocations cell (currently lines 151-157):
  ```tsx
                  <TableCell>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/campaigns/${campaign.id}/channels/${channel.id}/pacing` as Route}>
                        Pacing
                      </Link>
                    </Button>
                  </TableCell>
  ```

- [ ] **Step 3: Verify**

  `npx tsc --noEmit`. `npx eslint src/app/(admin)/campaigns/\[id\]/channels/\[channelId\]/pacing/page.tsx src/app/(admin)/campaigns/\[id\]/page.tsx`. Then run the full test suite for a final regression check:
  Run: `npm test`
  Expected: PASS (every test from Tasks 1-8 plus every pre-existing test).

  Spot-check live: sign in as an internal actor with `campaign:read` (per `reference_demo_accounts` memory), open a seeded campaign with a channel that has allocations and leads, click through to `/campaigns/<id>/channels/<channelId>/pacing`, confirm the pacing panel and rejection-rate table render real numbers.

- [ ] **Step 4: Commit**

  ```bash
  git add "src/app/(admin)/campaigns/[id]/channels/[channelId]/pacing" "src/app/(admin)/campaigns/[id]/page.tsx"
  git commit -m "feat(admin): add channel pacing page with per-partner rejection rate"
  ```

## Open questions / follow-ups for later epics

Carried over from the spec, unchanged by this plan:
- Tolerance-banded pace signals (vs. this plan's plain comparison) — revisit once real campaign data shows whether a flat comparison is too noisy.
- Per-partner rejection-rate *alerting* is not built here — this plan's table is read-only monitoring.
- E11 (delivery) and E15 (reporting) both consume `deliveredCount`/pace signals once built.
- A future `(client)` portal's pacing view reads the same counters this plan introduces.

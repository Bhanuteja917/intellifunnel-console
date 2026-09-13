# Channel-Level ICP & Lead Spec Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `IcpCriterion` and `LeadFieldSpec` ownership from `Campaign` to `CampaignChannel`, with per-channel client approval (terms + ICP + lead spec bundled) and campaign status derived from channel statuses.

**Architecture:** All schema changes land in a single Prisma migration. Application code is then updated module-by-module (CRUD → approval flow → state machine → lead pipeline → clone → UI), each with its own test cycle. The approval model collapses from two-stage (internal + client on campaign) to single-stage (client only, per channel). Campaign status is no longer set directly — it is derived from channel statuses whenever a channel transitions.

**Tech Stack:** Next.js, Prisma ORM (PostgreSQL), Vitest, TypeScript

**Spec:** `docs/superpowers/specs/2026-09-13-channel-level-icp-lead-spec-design.md`

## Global Constraints

- Pre-production only — migration may delete rows (CampaignApproval) and duplicate + re-key rows (IcpCriterion, LeadFieldSpec)
- One Prisma migration file for all schema changes
- `CampaignStatus` and `CampaignChannelStatus` both adopt the 7-value unified enum (`draft | pending | scheduled | live | paused | completed | cancelled`) but remain **separate Prisma enum types**
- `ChannelTermsApproval` table renames to `ChannelApproval`; all existing rows keep `type = 'client'`, `icpSnapshotJson = null`, `leadSpecSnapshotJson = null`
- Campaign `status` stays as a persisted DB column (required for indexes); it is updated by application logic, not a DB trigger
- `approvedSnapshotId` column removed from `Campaign` (referenced `CampaignApproval` which is dropped)
- Test runner: `vitest run` (single command); type check: `npx tsc --noEmit`

---

## File Map

| File | Change |
|------|--------|
| `prisma/schema.prisma` | All model/enum changes |
| `prisma/migrations/<timestamp>_channel_level_icp/migration.sql` | Created |
| `src/lib/campaigns/crud.ts` | `setIcpCriteria` / `setLeadFieldSpec` → channel scope; new `assertChannelDraftAndAccessible`; `getCampaignForActor` include update |
| `src/lib/campaigns/state-machine.ts` | Remove `submitForInternalApproval`, `decideInternalApproval`, `decideClientApproval`; add `submitChannelForApproval`, `decideChannelApproval`, `updateCampaignStatus`, `deriveCampaignStatus`, `activateDueChannels`, `completeFinishedChannels` |
| `src/lib/campaigns/channels.ts` | `setChannelStatus`: `active` → `live`; draft check → channel-level |
| `src/lib/campaigns/clone.ts` | Clone ICP/spec per channel, not campaign |
| `src/lib/campaigns/snapshot.ts` | Remove `buildConfigSnapshot`; add `buildIcpSnapshot`, `buildLeadSpecSnapshot` |
| `src/lib/approvals/status.ts` | Rename `getChannelTermsApprovalStatus` → `getChannelApprovalStatus`; extend to check ICP + lead spec staleness; add `buildIcpSnapshot`, `buildLeadSpecSnapshot` |
| `src/lib/approvals/decisions.ts` | Rename `decideChannelTerms` → `decideChannelApproval`; write all three snapshots |
| `src/lib/approvals/client-view.ts` | Update table name `channelApprovals`, status function name |
| `src/lib/leads/intake.ts` | Read `LeadFieldSpec` and advisory flags from `campaignChannelId` |
| `src/lib/leads/matching.ts` | `matchesIcp` takes `campaignChannelId` instead of `campaignId` |
| `src/lib/lists/target-accounts.ts` | `resolveLeadCap` reads `defaultMaxLeadsPerAccount` from channel |
| `src/lib/stores/campaign-filters.ts` | Remove `pendingInternalApproval`, rename `pendingClientApproval` → `pending` |
| `src/app/(admin)/campaigns/campaign-table.tsx` | Same enum value updates |
| `src/app/(admin)/campaigns/[id]/actions.ts` | `setIcpCriteria` / `setLeadFieldSpec` take `channelId` |
| `src/app/(admin)/campaigns/[id]/approval-actions.tsx` | Remove internal-approval buttons |
| `src/app/(admin)/campaigns/[id]/page.tsx` | Read ICP/spec from channels, not campaign |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts` | `CampaignChannelStatus` enum update |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-status-control.tsx` | Same |
| `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx` | ICP/spec editors, approval status via `getChannelApprovalStatus` |
| All test files (listed below) | Updates matching new API |

---

## Task 1: Prisma Schema + Migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_channel_level_icp/migration.sql`

**Interfaces:**
- Produces: Updated Prisma client with new model shapes — all downstream tasks depend on this

- [ ] **Step 1: Update `prisma/schema.prisma`**

Apply all changes below in order. The full schema after changes:

```prisma
// CampaignStatus — remove pendingInternalApproval, rename pendingClientApproval→pending
enum CampaignStatus {
  draft
  pending
  scheduled
  live
  paused
  completed
  cancelled
}

// CampaignChannelStatus — replace 4-value with 7-value enum
enum CampaignChannelStatus {
  draft
  pending
  scheduled
  live
  paused
  completed
  cancelled
}

model Campaign {
  id                   String         @id @default(cuid())
  clientOrganizationId String
  name                 String
  code                 String         @unique
  status               CampaignStatus @default(draft)
  startDate            DateTime       @db.Date
  endDate              DateTime       @db.Date
  currency             String         @db.Char(3)
  clonedFromCampaignId String?
  deletedAt            DateTime?
  createdAt            DateTime       @default(now())
  updatedAt            DateTime       @updatedAt
  createdById          String?
  updatedById          String?

  clientOrganization Organization          @relation(fields: [clientOrganizationId], references: [id])
  clonedFrom         Campaign?             @relation("CampaignClone", fields: [clonedFromCampaignId], references: [id])
  clones             Campaign[]            @relation("CampaignClone")
  channels           CampaignChannel[]
  statusHistory      CampaignStatusHistory[]
  targetAccountLists CampaignTargetAccountList[]
  suppressionLists   CampaignSuppressionList[]

  @@index([clientOrganizationId, status])
  @@index([status, startDate])
}

model IcpCriterion {
  id                String              @id @default(cuid())
  campaignChannelId String
  dimension         IcpDimension
  operator          IcpOperator
  valuesJson        Json
  isMandatory       Boolean             @default(true)
  createdAt         DateTime            @default(now())
  updatedAt         DateTime            @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])

  @@index([campaignChannelId])
}

model LeadFieldSpec {
  id                String            @id @default(cuid())
  campaignChannelId String
  fieldKey          String
  label             String
  isRequired        Boolean           @default(true)
  dataType          LeadFieldDataType
  allowedValuesJson Json?
  validationPattern String?
  rejectIfMissing   Boolean           @default(true)
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt
  createdById       String?
  updatedById       String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])

  @@unique([campaignChannelId, fieldKey])
}

model CampaignChannel {
  id                        String                @id @default(cuid())
  campaignId                String
  channelTypeVersionId      String
  contractedQuantity        Int
  clientUnitPriceMinor      BigInt
  costBudgetMinor           BigInt?
  currency                  String                @db.Char(3)
  startDate                 DateTime              @db.Date
  endDate                   DateTime              @db.Date
  status                    CampaignChannelStatus @default(draft)
  advisoryIcpMatch          Boolean               @default(false)
  advisoryTalMatch          Boolean               @default(false)
  defaultMaxLeadsPerAccount Int?
  qualificationFormId       String?
  reservedCount             Int                   @default(0)
  deliveredCount            Int                   @default(0)
  stepConfigJson            Json?
  createdAt                 DateTime              @default(now())
  updatedAt                 DateTime              @updatedAt
  createdById               String?
  updatedById               String?

  campaign           Campaign           @relation(fields: [campaignId], references: [id])
  channelTypeVersion ChannelTypeVersion @relation(fields: [channelTypeVersionId], references: [id])
  qualificationForm  QualificationForm? @relation(fields: [qualificationFormId], references: [id])
  icpCriteria        IcpCriterion[]
  leadFieldSpecs     LeadFieldSpec[]
  channelApprovals   ChannelApproval[]
  leadSubmissions    LeadSubmission[]
  leads              Lead[]
  assets             AssetPlacement[]
  allocations        PartnerAllocation[]
  deliveryConfig     DeliveryConfig?
  deliveryRuns       DeliveryRun[]
  pacingBuckets      ChannelPacingBucket[]

  @@index([campaignId])
}

// CampaignApproval model — DELETED ENTIRELY

// ChannelTermsApproval → ChannelApproval (renamed + extended)
/**
 * Append-only. Latest row by decidedAt is current decision; a change-of-mind
 * writes a new row. Snapshot fields freeze what was approved — if ICP, lead
 * spec, or terms are edited after approval, snapshot comparison marks it stale.
 */
model ChannelApproval {
  id                   String           @id @default(cuid())
  campaignChannelId    String
  type                 ApprovalType     @default(client)
  decision             ApprovalDecision
  decidedByUserId      String
  decidedAt            DateTime         @default(now())
  comments             String?
  termsSnapshotJson    Json
  icpSnapshotJson      Json?
  leadSpecSnapshotJson Json?
  createdAt            DateTime         @default(now())
  updatedAt            DateTime         @updatedAt
  createdById          String?
  updatedById          String?

  campaignChannel CampaignChannel @relation(fields: [campaignChannelId], references: [id])

  @@index([campaignChannelId, type, decidedAt])
}
```

- [ ] **Step 2: Create migration SQL file**

Create `prisma/migrations/<timestamp>_channel_level_icp/migration.sql` where `<timestamp>` is `$(date +%Y%m%d%H%M%S)`:

```sql
-- Step 1: Add campaignChannelId (nullable) to IcpCriterion
ALTER TABLE "IcpCriterion" ADD COLUMN "campaignChannelId" TEXT;

-- Step 1b: Add campaignChannelId (nullable) to LeadFieldSpec
ALTER TABLE "LeadFieldSpec" ADD COLUMN "campaignChannelId" TEXT;

-- Step 2: Backfill IcpCriterion — duplicate each row once per channel of that campaign
INSERT INTO "IcpCriterion"
  (id, "campaignChannelId", dimension, operator, "valuesJson", "isMandatory",
   "createdAt", "updatedAt", "createdById", "updatedById")
SELECT
  gen_random_uuid()::text,
  cc.id,
  ic.dimension,
  ic.operator,
  ic."valuesJson",
  ic."isMandatory",
  now(),
  now(),
  ic."createdById",
  ic."updatedById"
FROM "IcpCriterion" ic
JOIN "CampaignChannel" cc ON cc."campaignId" = ic."campaignId"
WHERE ic."campaignChannelId" IS NULL;

-- Delete the original campaign-scoped rows
DELETE FROM "IcpCriterion" WHERE "campaignChannelId" IS NULL;

-- Step 2b: Backfill LeadFieldSpec
INSERT INTO "LeadFieldSpec"
  (id, "campaignChannelId", "fieldKey", label, "isRequired", "dataType",
   "allowedValuesJson", "validationPattern", "rejectIfMissing",
   "createdAt", "updatedAt", "createdById", "updatedById")
SELECT
  gen_random_uuid()::text,
  cc.id,
  lfs."fieldKey",
  lfs.label,
  lfs."isRequired",
  lfs."dataType",
  lfs."allowedValuesJson",
  lfs."validationPattern",
  lfs."rejectIfMissing",
  now(),
  now(),
  lfs."createdById",
  lfs."updatedById"
FROM "LeadFieldSpec" lfs
JOIN "CampaignChannel" cc ON cc."campaignId" = lfs."campaignId"
WHERE lfs."campaignChannelId" IS NULL;

DELETE FROM "LeadFieldSpec" WHERE "campaignChannelId" IS NULL;

-- Step 3: Make campaignChannelId non-nullable and add FK constraints
ALTER TABLE "IcpCriterion" ALTER COLUMN "campaignChannelId" SET NOT NULL;
ALTER TABLE "LeadFieldSpec" ALTER COLUMN "campaignChannelId" SET NOT NULL;

ALTER TABLE "IcpCriterion"
  ADD CONSTRAINT "IcpCriterion_campaignChannelId_fkey"
  FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeadFieldSpec"
  ADD CONSTRAINT "LeadFieldSpec_campaignChannelId_fkey"
  FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"(id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 3b: Drop old campaignId FK and column from IcpCriterion
ALTER TABLE "IcpCriterion"
  DROP CONSTRAINT IF EXISTS "IcpCriterion_campaignId_fkey";
ALTER TABLE "IcpCriterion" DROP COLUMN "campaignId";
DROP INDEX IF EXISTS "IcpCriterion_campaignId_idx";
CREATE INDEX "IcpCriterion_campaignChannelId_idx" ON "IcpCriterion"("campaignChannelId");

-- Step 3c: Drop old campaignId FK, unique, and column from LeadFieldSpec
ALTER TABLE "LeadFieldSpec"
  DROP CONSTRAINT IF EXISTS "LeadFieldSpec_campaignId_fkey";
DROP INDEX IF EXISTS "LeadFieldSpec_campaignId_fieldKey_key";
ALTER TABLE "LeadFieldSpec" DROP COLUMN "campaignId";
CREATE UNIQUE INDEX "LeadFieldSpec_campaignChannelId_fieldKey_key"
  ON "LeadFieldSpec"("campaignChannelId", "fieldKey");

-- Step 4: Add advisory flags + defaultMaxLeadsPerAccount to CampaignChannel
ALTER TABLE "CampaignChannel"
  ADD COLUMN "advisoryIcpMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "advisoryTalMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultMaxLeadsPerAccount" INTEGER;

-- Step 4b: Backfill from Campaign
UPDATE "CampaignChannel" cc
SET
  "advisoryIcpMatch"          = c."advisoryIcpMatch",
  "advisoryTalMatch"          = c."advisoryTalMatch",
  "defaultMaxLeadsPerAccount" = c."defaultMaxLeadsPerAccount"
FROM "Campaign" c
WHERE cc."campaignId" = c.id;

-- Step 5: Drop CampaignApproval table
DROP TABLE IF EXISTS "CampaignApproval";

-- Step 6: Rename ChannelTermsApproval → ChannelApproval and add new columns
ALTER TABLE "ChannelTermsApproval" RENAME TO "ChannelApproval";

ALTER TABLE "ChannelApproval"
  ADD COLUMN "type"                 "ApprovalType" NOT NULL DEFAULT 'client',
  ADD COLUMN "icpSnapshotJson"      JSONB,
  ADD COLUMN "leadSpecSnapshotJson" JSONB;

DROP INDEX IF EXISTS "ChannelTermsApproval_campaignChannelId_decidedAt_idx";
CREATE INDEX "ChannelApproval_campaignChannelId_type_decidedAt_idx"
  ON "ChannelApproval"("campaignChannelId", "type", "decidedAt");

-- Step 7a: Unify CampaignChannelStatus enum (draft, active, paused, completed → 7-value)
-- Postgres requires creating a new type, migrating, then renaming
CREATE TYPE "CampaignChannelStatus_new" AS ENUM (
  'draft', 'pending', 'scheduled', 'live', 'paused', 'completed', 'cancelled'
);
ALTER TABLE "CampaignChannel"
  ALTER COLUMN "status" TYPE "CampaignChannelStatus_new"
  USING (
    CASE "status"::text
      WHEN 'active'    THEN 'live'
      WHEN 'draft'     THEN 'draft'
      WHEN 'paused'    THEN 'paused'
      WHEN 'completed' THEN 'completed'
      ELSE 'draft'
    END
  )::"CampaignChannelStatus_new";
DROP TYPE "CampaignChannelStatus";
ALTER TYPE "CampaignChannelStatus_new" RENAME TO "CampaignChannelStatus";

-- Step 7b: Update CampaignStatus enum
-- Migrate rows before altering type
UPDATE "Campaign"
  SET "status" = 'pending'
  WHERE "status"::text = 'pendingClientApproval';
UPDATE "Campaign"
  SET "status" = 'draft'
  WHERE "status"::text = 'pendingInternalApproval';

CREATE TYPE "CampaignStatus_new" AS ENUM (
  'draft', 'pending', 'scheduled', 'live', 'paused', 'completed', 'cancelled'
);
ALTER TABLE "Campaign"
  ALTER COLUMN "status" TYPE "CampaignStatus_new"
  USING "status"::text::"CampaignStatus_new";

-- Step 7c: Migrate CampaignStatusHistory (also uses CampaignStatus)
ALTER TABLE "CampaignStatusHistory"
  ALTER COLUMN "fromStatus" TYPE "CampaignStatus_new"
  USING (
    CASE "fromStatus"::text
      WHEN 'pendingClientApproval'   THEN 'pending'
      WHEN 'pendingInternalApproval' THEN 'draft'
      ELSE "fromStatus"::text
    END
  )::"CampaignStatus_new",
  ALTER COLUMN "toStatus" TYPE "CampaignStatus_new"
  USING (
    CASE "toStatus"::text
      WHEN 'pendingClientApproval'   THEN 'pending'
      WHEN 'pendingInternalApproval' THEN 'draft'
      ELSE "toStatus"::text
    END
  )::"CampaignStatus_new";

DROP TYPE "CampaignStatus";
ALTER TYPE "CampaignStatus_new" RENAME TO "CampaignStatus";

-- Step 8: Remove advisory columns + approvedSnapshotId from Campaign
ALTER TABLE "Campaign"
  DROP COLUMN IF EXISTS "advisoryIcpMatch",
  DROP COLUMN IF EXISTS "advisoryTalMatch",
  DROP COLUMN IF EXISTS "defaultMaxLeadsPerAccount",
  DROP COLUMN IF EXISTS "approvedSnapshotId";
```

- [ ] **Step 3: Regenerate Prisma client**

```bash
cd /Users/bhanuteja-intellifunel/intellifunnellabs/websites/intellifunnel-console
npx prisma generate
```

Expected: Client regenerates with updated types. Many TypeScript files will now fail `tsc` — expected until Tasks 2-9 are done.

- [ ] **Step 4: Commit schema**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: schema migration — channel-level ICP, lead spec, and unified status enums"
```

---

## Task 2: Status Enum Updates in Application Code

Update every TypeScript file that references the old enum values (`active`, `pendingInternalApproval`, `pendingClientApproval`) or the removed `CampaignApproval` type.

**Files:**
- Modify: `src/lib/campaigns/state-machine.ts` (partial — just enum value references; state machine logic is Task 5)
- Modify: `src/lib/campaigns/channels.ts`
- Modify: `src/lib/stores/campaign-filters.ts`
- Modify: `src/app/(admin)/campaigns/campaign-table.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/approval-actions.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-status-control.tsx`
- Modify: `tests/helpers/channel-factory.ts`

**Interfaces:**
- Consumes: Regenerated Prisma client from Task 1
- Produces: All enum-value references updated

- [ ] **Step 1: Update `src/lib/campaigns/channels.ts`**

The `setChannelStatus` function currently allows `active` and `paused`. Update to allow `live` and `paused`:

```typescript
// Old:
if (input.status !== "active" && input.status !== "paused") {
  throw new ValidationError(
    `Channel status ${input.status} is set by the campaign lifecycle, not this control`,
  );
}
// ...
if (input.status === "paused" && channel.status !== "active") {
  throw new ValidationError(`Channel is ${channel.status}; only an active channel can be paused`);
}
if (input.status === "active" && channel.status === "draft") {
  if (channel.campaign.status !== "scheduled" && channel.campaign.status !== "live") {
    throw new ValidationError(
      `Campaign is ${channel.campaign.status}; channels activate once the campaign is scheduled or live`,
    );
  }
  // ...
}
```

Becomes:

```typescript
if (input.status !== "live" && input.status !== "paused") {
  throw new ValidationError(
    `Channel status ${input.status} is set by the campaign lifecycle, not this control`,
  );
}
// ...
if (input.status === "paused" && channel.status !== "live") {
  throw new ValidationError(`Channel is ${channel.status}; only a live channel can be paused`);
}
if (input.status === "live" && channel.status === "draft") {
  if (channel.campaign.status !== "scheduled" && channel.campaign.status !== "live") {
    throw new ValidationError(
      `Campaign is ${channel.campaign.status}; channels activate once the campaign is scheduled or live`,
    );
  }
  // ...
}
```

Also update the `tx.campaignChannel.update` call inside `decideClientApproval` (Task 5 removes this; for now it references `active` → update to `live`).

- [ ] **Step 2: Update `src/lib/stores/campaign-filters.ts`**

Replace `pendingInternalApproval` and `pendingClientApproval` with `pending`:

```typescript
// Old (lines 6-7):
pendingInternalApproval: "Pending Internal Approval",
pendingClientApproval: "Pending Client Approval",

// New:
pending: "Pending Approval",
```

- [ ] **Step 3: Update `src/app/(admin)/campaigns/campaign-table.tsx` line 40**

Replace the two old statuses with `pending`.

- [ ] **Step 4: Update `src/app/(admin)/campaigns/[id]/approval-actions.tsx`**

Remove all references to `pendingInternalApproval` and `pendingClientApproval`. Internal approval UI is gone. The approval actions for campaigns are now at channel level (Task 9 covers the channel page).

- [ ] **Step 5: Update `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`**

Update any `CampaignChannelStatus` references from `active` to `live`.

- [ ] **Step 6: Update `src/app/(admin)/campaigns/[id]/channels/[channelId]/channel-status-control.tsx`**

Update `CampaignChannelStatus` references from `active` to `live` (lines 13, 27).

- [ ] **Step 7: Update `tests/helpers/channel-factory.ts`**

Remove `advisoryIcpMatch` and `advisoryTalMatch` from the `db.campaign.create` call (lines 80-81). These fields no longer exist on `Campaign`. Add them to the `db.campaignChannel.create` call if needed (defaults to `false` anyway).

```typescript
// In db.campaign.create data — remove:
advisoryIcpMatch: false,
advisoryTalMatch: false,

// In db.campaignChannel.create data — these default to false, no change needed
```

Also update the `channelStatus` option type — old `active` is now `live`.

- [ ] **Step 8: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -60
```

Expected: Many errors remain (Tasks 3-9 not done). The errors from this task's files should be gone. Verify no new errors introduced in the files edited in this task.

- [ ] **Step 9: Commit**

```bash
git add src/lib/campaigns/channels.ts src/lib/stores/campaign-filters.ts \
  src/app/ tests/helpers/channel-factory.ts
git commit -m "feat: update enum value references — active→live, remove internal approval statuses"
```

---

## Task 3: Channel-Level ICP and LeadSpec CRUD

Move `setIcpCriteria` and `setLeadFieldSpec` from campaign scope to channel scope. Add `assertChannelDraftAndAccessible`. Update `getCampaignForActor`.

**Files:**
- Modify: `src/lib/campaigns/crud.ts`
- Test: `tests/campaigns-crud.test.ts`

**Interfaces:**
- Consumes: Updated Prisma client (Task 1)
- Produces:
  - `assertChannelDraftAndAccessible(db: Db, actor: Actor, campaignChannelId: string): Promise<CampaignChannel & { campaign: Campaign }>`
  - `setIcpCriteria(db: PrismaClient, actor: Actor, campaignChannelId: string, criteria: IcpCriterionInput[]): Promise<void>`
  - `setLeadFieldSpec(db: PrismaClient, actor: Actor, campaignChannelId: string, fields: LeadFieldSpecInput[]): Promise<void>`

- [ ] **Step 1: Write failing tests**

In `tests/campaigns-crud.test.ts`, add a test block for the new channel-level signatures. The existing tests for `setIcpCriteria`/`setLeadFieldSpec` will fail after this task because they pass `campaignId`. Update them:

```typescript
describe("setIcpCriteria (channel-level)", () => {
  it("persists criteria on the channel, not the campaign", async () => {
    const db = testDb();
    // ... setup campaign + channel
    await setIcpCriteria(db, manager, channel.id, [
      { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
    ]);
    const rows = await db.icpCriterion.findMany({ where: { campaignChannelId: channel.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].dimension).toBe("country");
  });

  it("rejects if channel is not draft", async () => {
    const db = testDb();
    // ... setup with channel.status = "pending"
    await expect(
      setIcpCriteria(db, manager, channel.id, [
        { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
      ])
    ).rejects.toThrow("pending");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/campaigns-crud.test.ts
```

Expected: Test errors / compile failures because `setIcpCriteria` still takes `campaignId`.

- [ ] **Step 3: Update `src/lib/campaigns/crud.ts`**

**Add `assertChannelDraftAndAccessible`** (after `assertDraftAndAccessible`):

```typescript
export async function assertChannelDraftAndAccessible(
  db: Db,
  actor: Actor,
  campaignChannelId: string,
): Promise<CampaignChannel & { campaign: Campaign }> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: campaignChannelId },
    include: { campaign: true },
  });
  if (channel === null) throw new NotFoundError("Channel not found");
  if (channel.campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  if (channel.status !== "draft") {
    throw new ValidationError(`Channel is ${channel.status}; configuration edits require a draft`);
  }
  return channel;
}
```

Add `CampaignChannel` to the import from `@prisma/client`.

**Update `setIcpCriteria`** — parameter `campaignId` → `campaignChannelId`, all DB queries updated:

```typescript
export async function setIcpCriteria(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  criteria: IcpCriterionInput[],
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  await withAudit<IcpCriterionInput[]>(
    db,
    actor,
    (before) => ({
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "setIcpCriteria",
      before,
      after: criteria,
    }),
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      const existing = await tx.icpCriterion.findMany({
        where: { campaignChannelId },
        orderBy: { id: "asc" },
      });

      await tx.icpCriterion.deleteMany({ where: { campaignChannelId } });
      for (const criterion of criteria) {
        await tx.icpCriterion.create({
          data: {
            campaignChannelId,
            dimension: criterion.dimension,
            operator: criterion.operator,
            valuesJson: criterion.values as Prisma.InputJsonValue,
            isMandatory: criterion.isMandatory,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      return existing.map((row) => ({
        dimension: row.dimension,
        operator: row.operator,
        values: row.valuesJson as unknown[],
        isMandatory: row.isMandatory,
      }));
    },
  );
}
```

**Update `setLeadFieldSpec`** — same pattern, `campaignId` → `campaignChannelId`:

```typescript
export async function setLeadFieldSpec(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  fields: LeadFieldSpecInput[],
): Promise<void> {
  assertPermission(actor, "campaign:write");
  await assertChannelDraftAndAccessible(db, actor, campaignChannelId);

  const keys = new Set(fields.map((f) => f.fieldKey));
  if (keys.size !== fields.length) throw new ValidationError("Duplicate fieldKey in lead field spec");

  await withAudit<LeadFieldSpecInput[]>(
    db,
    actor,
    (before) => ({
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "setLeadFieldSpec",
      before,
      after: fields,
    }),
    async (tx) => {
      await assertChannelDraftAndAccessible(tx, actor, campaignChannelId);

      const existing = await tx.leadFieldSpec.findMany({
        where: { campaignChannelId },
        orderBy: { fieldKey: "asc" },
      });

      await tx.leadFieldSpec.deleteMany({ where: { campaignChannelId } });
      for (const field of fields) {
        await tx.leadFieldSpec.create({
          data: {
            campaignChannelId,
            fieldKey: field.fieldKey,
            label: field.label,
            dataType: field.dataType,
            isRequired: field.isRequired,
            rejectIfMissing: field.rejectIfMissing,
            allowedValuesJson: field.allowedValues as Prisma.InputJsonValue | undefined,
            validationPattern: field.validationPattern,
            createdById: actor.userId,
            updatedById: actor.userId,
          },
        });
      }

      return existing.map((row) => ({
        fieldKey: row.fieldKey,
        label: row.label,
        dataType: row.dataType,
        isRequired: row.isRequired,
        rejectIfMissing: row.rejectIfMissing,
        allowedValues: (row.allowedValuesJson as unknown[] | null) ?? undefined,
        validationPattern: row.validationPattern ?? undefined,
      }));
    },
  );
}
```

**Update `getCampaignForActor`** — remove campaign-level `icpCriteria`/`leadFieldSpecs`/`approvals`; include them per channel:

```typescript
export async function getCampaignForActor(db: PrismaClient, actor: Actor, campaignId: string) {
  assertPermission(actor, "campaign:read");

  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    include: {
      channels: {
        include: {
          channelTypeVersion: true,
          icpCriteria: true,
          leadFieldSpecs: true,
          channelApprovals: { orderBy: { decidedAt: "desc" } },
        },
      },
    },
  });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");

  assertOrganizationAccess(actor, campaign.clientOrganizationId);
  return campaign;
}
```

**Update `createCampaign`** — remove `advisoryTalMatch`, `advisoryIcpMatch`, `defaultMaxLeadsPerAccount` from `CreateCampaignInput` and from the `tx.campaign.create` data:

```typescript
export type CreateCampaignInput = {
  clientOrganizationId: string;
  name: string;
  code: string;
  startDate: Date;
  endDate: Date;
  currency: string;
  // advisoryTalMatch, advisoryIcpMatch, defaultMaxLeadsPerAccount removed
};
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/campaigns-crud.test.ts
```

Expected: New channel-level tests pass. Existing tests that called `setIcpCriteria(db, actor, campaign.id, ...)` will need update — pass `channel.id` instead.

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/crud.ts tests/campaigns-crud.test.ts
git commit -m "feat: ICP and lead spec CRUD moves to channel scope"
```

---

## Task 4: Channel Approval Flow — Rename and Extend

Rename `getChannelTermsApprovalStatus` → `getChannelApprovalStatus`, extend it to check ICP + lead spec staleness. Rename `decideChannelTerms` → `decideChannelApproval`, write all three snapshots. Add `buildIcpSnapshot` / `buildLeadSpecSnapshot`.

**Files:**
- Modify: `src/lib/approvals/status.ts`
- Modify: `src/lib/approvals/decisions.ts`
- Modify: `src/lib/approvals/client-view.ts`
- Test: `tests/approval-status.test.ts`
- Test: `tests/approval-decisions.test.ts`
- Test: `tests/client-view.test.ts`

**Interfaces:**
- Consumes: Prisma `ChannelApproval` model (Task 1); `IcpCriterion[]` and `LeadFieldSpec[]` on `CampaignChannel` (Task 1)
- Produces:
  - `buildIcpSnapshot(criteria: IcpCriterion[]): IcpSnapshot`
  - `buildLeadSpecSnapshot(specs: LeadFieldSpec[]): LeadSpecSnapshot`
  - `getChannelApprovalStatus(db: Db, channel: ChannelTermsSubject, campaignChannelId: string): Promise<ApprovalStatus>`
  - `decideChannelApproval(db: PrismaClient, actor: Actor, input: { campaignChannelId: string; decision: ApprovalDecision; comments?: string }): Promise<ChannelApproval>`

- [ ] **Step 1: Write failing tests in `tests/approval-status.test.ts`**

Update all `db.channelTermsApproval.create` → `db.channelApproval.create`. Update `getChannelTermsApprovalStatus` import → `getChannelApprovalStatus`. Add tests for ICP/lead spec staleness:

```typescript
import {
  buildChannelTermsSnapshot,
  buildIcpSnapshot,
  buildLeadSpecSnapshot,
  getChannelApprovalStatus,
  getPlacementApprovalStatus,
} from "@/lib/approvals/status";

it("is reapprovalNeeded when ICP criteria changed after approval", async () => {
  const db = testDb();
  const fx = await createChannelFixture(db);
  const channel = await db.campaignChannel.findUniqueOrThrow({ where: { id: fx.channelId } });

  // Create approval with empty ICP snapshot
  await db.channelApproval.create({
    data: {
      campaignChannelId: channel.id,
      type: "client",
      decision: "approved",
      decidedByUserId: fx.clientAdminActor.userId,
      termsSnapshotJson: buildChannelTermsSnapshot(channel) as unknown as Prisma.InputJsonValue,
      icpSnapshotJson: [] as unknown as Prisma.InputJsonValue, // snapshot of empty ICP
      leadSpecSnapshotJson: null,
    },
  });

  // Now add an ICP criterion (changed after approval)
  await db.icpCriterion.create({
    data: {
      campaignChannelId: channel.id,
      dimension: "country",
      operator: "in",
      valuesJson: ["US"],
      isMandatory: true,
    },
  });

  expect(await getChannelApprovalStatus(db, channel)).toBe("reapprovalNeeded");
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/approval-status.test.ts
```

- [ ] **Step 3: Update `src/lib/approvals/status.ts`**

Add snapshot types and builders:

```typescript
import type {
  AssetPlacement,
  CampaignChannel,
  IcpCriterion,
  LeadFieldSpec,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type IcpSnapshot = Array<{
  dimension: string;
  operator: string;
  values: unknown;
  isMandatory: boolean;
}>;

export type LeadSpecSnapshot = Array<{
  fieldKey: string;
  label: string;
  dataType: string;
  isRequired: boolean;
  rejectIfMissing: boolean;
  allowedValues: unknown;
  validationPattern: string | null;
}>;

export function buildIcpSnapshot(criteria: IcpCriterion[]): IcpSnapshot {
  return criteria
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((c) => ({
      dimension: c.dimension,
      operator: c.operator,
      values: c.valuesJson,
      isMandatory: c.isMandatory,
    }));
}

export function buildLeadSpecSnapshot(specs: LeadFieldSpec[]): LeadSpecSnapshot {
  return specs
    .slice()
    .sort((a, b) => a.fieldKey.localeCompare(b.fieldKey))
    .map((f) => ({
      fieldKey: f.fieldKey,
      label: f.label,
      dataType: f.dataType,
      isRequired: f.isRequired,
      rejectIfMissing: f.rejectIfMissing,
      allowedValues: f.allowedValuesJson,
      validationPattern: f.validationPattern,
    }));
}
```

Add snapshot match helpers:

```typescript
function icpSnapshotsMatch(stored: unknown, current: IcpSnapshot): boolean {
  if (!Array.isArray(stored)) return false;
  if (stored.length !== current.length) return false;
  // Compare sorted by id — buildIcpSnapshot sorts, so positions match
  return stored.every((s, i) => {
    const c = current[i];
    return (
      (s as Partial<IcpSnapshot[number]>).dimension === c.dimension &&
      (s as Partial<IcpSnapshot[number]>).operator === c.operator &&
      JSON.stringify((s as Partial<IcpSnapshot[number]>).values) === JSON.stringify(c.values) &&
      (s as Partial<IcpSnapshot[number]>).isMandatory === c.isMandatory
    );
  });
}

function leadSpecSnapshotsMatch(stored: unknown, current: LeadSpecSnapshot): boolean {
  if (!Array.isArray(stored)) return false;
  if (stored.length !== current.length) return false;
  return stored.every((s, i) => {
    const c = current[i];
    return (
      (s as Partial<LeadSpecSnapshot[number]>).fieldKey === c.fieldKey &&
      (s as Partial<LeadSpecSnapshot[number]>).label === c.label &&
      (s as Partial<LeadSpecSnapshot[number]>).dataType === c.dataType &&
      (s as Partial<LeadSpecSnapshot[number]>).isRequired === c.isRequired &&
      (s as Partial<LeadSpecSnapshot[number]>).rejectIfMissing === c.rejectIfMissing
    );
  });
}
```

**Rename and extend `getChannelTermsApprovalStatus` → `getChannelApprovalStatus`**:

```typescript
export async function getChannelApprovalStatus(
  db: Db,
  channel: ChannelTermsSubject,
): Promise<ApprovalStatus> {
  const latest = await db.channelApproval.findFirst({
    where: { campaignChannelId: channel.id },
    orderBy: { decidedAt: "desc" },
    select: {
      decision: true,
      termsSnapshotJson: true,
      icpSnapshotJson: true,
      leadSpecSnapshotJson: true,
    },
  });
  if (latest === null) return derive(null, false);

  const termsMatch = termsSnapshotsMatch(latest.termsSnapshotJson, buildChannelTermsSnapshot(channel));
  if (!termsMatch) return derive(latest, false);

  // ICP staleness — null snapshot means approved before ICP was tracked; check current state
  const currentIcp = await db.icpCriterion.findMany({ where: { campaignChannelId: channel.id } });
  const currentIcpSnapshot = buildIcpSnapshot(currentIcp);
  if (latest.icpSnapshotJson !== null && !icpSnapshotsMatch(latest.icpSnapshotJson, currentIcpSnapshot)) {
    return derive(latest, false);
  }

  // Lead spec staleness
  const currentSpecs = await db.leadFieldSpec.findMany({ where: { campaignChannelId: channel.id } });
  const currentLeadSpecSnapshot = buildLeadSpecSnapshot(currentSpecs);
  if (latest.leadSpecSnapshotJson !== null && !leadSpecSnapshotsMatch(latest.leadSpecSnapshotJson, currentLeadSpecSnapshot)) {
    return derive(latest, false);
  }

  return derive(latest, true);
}

// Keep old name as alias for callers that haven't been updated yet (removed after Task 9)
export const getChannelTermsApprovalStatus = getChannelApprovalStatus;
```

- [ ] **Step 4: Update `src/lib/approvals/decisions.ts`**

Rename `decideChannelTerms` → `decideChannelApproval`, update table name, add ICP + lead spec snapshots:

```typescript
import type {
  ApprovalDecision,
  ChannelApproval,
  PlacementApproval,
  IcpCriterion,
  LeadFieldSpec,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { assertOrganizationAccess, assertPermission, type Actor } from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  buildChannelTermsSnapshot,
  buildIcpSnapshot,
  buildLeadSpecSnapshot,
} from "@/lib/approvals/status";

export async function decideChannelApproval(
  db: PrismaClient,
  actor: Actor,
  input: { campaignChannelId: string; decision: ApprovalDecision; comments?: string },
): Promise<ChannelApproval> {
  assertPermission(actor, "campaign:approveClient");

  const channel = await db.campaignChannel.findUnique({
    where: { id: input.campaignChannelId },
    include: { campaign: { select: { clientOrganizationId: true, deletedAt: true } } },
  });
  if (channel === null || channel.campaign.deletedAt !== null) {
    throw new NotFoundError("Channel not found");
  }
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);

  const comments = normaliseComments(input.decision, input.comments);

  return db.$transaction(async (tx) => {
    const fresh = await tx.campaignChannel.findUniqueOrThrow({
      where: { id: input.campaignChannelId },
    });

    const icpCriteria = await tx.icpCriterion.findMany({
      where: { campaignChannelId: fresh.id },
    });
    const leadFieldSpecs = await tx.leadFieldSpec.findMany({
      where: { campaignChannelId: fresh.id },
    });

    const approval = await tx.channelApproval.create({
      data: {
        campaignChannelId: fresh.id,
        type: "client",
        decision: input.decision,
        decidedByUserId: actor.userId,
        comments,
        termsSnapshotJson: buildChannelTermsSnapshot(fresh) as unknown as Prisma.InputJsonValue,
        icpSnapshotJson: buildIcpSnapshot(icpCriteria) as unknown as Prisma.InputJsonValue,
        leadSpecSnapshotJson: buildLeadSpecSnapshot(leadFieldSpecs) as unknown as Prisma.InputJsonValue,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });

    await writeAudit(tx, actor, {
      entityType: "ChannelApproval",
      entityId: approval.id,
      action: input.decision,
      after: { campaignChannelId: fresh.id, decision: input.decision, comments },
    });

    return approval;
  });
}

// Keep old name as alias during transition
export const decideChannelTerms = decideChannelApproval;
```

- [ ] **Step 5: Update `src/lib/approvals/client-view.ts`**

Change `db.channelTermsApproval` → `db.channelApproval` and `getChannelTermsApprovalStatus` → `getChannelApprovalStatus`:

```typescript
import {
  getChannelApprovalStatus,
  getPlacementApprovalStatus,
  type ApprovalStatus,
} from "@/lib/approvals/status";

// In listClientApprovals:
const termsStatus = await getChannelApprovalStatus(db, channel);
const lastTerms = await db.channelApproval.findFirst({
  where: { campaignChannelId: channel.id },
  orderBy: { decidedAt: "desc" },
  select: { comments: true, decidedAt: true },
});
// In getClientCampaignDetail:
const termsStatus = await getChannelApprovalStatus(db, channel);
```

- [ ] **Step 6: Run approval tests**

```bash
npx vitest run tests/approval-status.test.ts tests/approval-decisions.test.ts tests/client-view.test.ts
```

Expected: All pass. Update test files to use new names / table name where needed.

- [ ] **Step 7: Commit**

```bash
git add src/lib/approvals/ tests/approval-status.test.ts tests/approval-decisions.test.ts tests/client-view.test.ts
git commit -m "feat: ChannelApproval with ICP + lead spec snapshots; unified approval status check"
```

---

## Task 5: Campaign Status Derivation + Channel State Machine

Remove internal approval flow from state machine. Add channel-level submit/approve. Add `deriveCampaignStatus`, `updateCampaignStatus`. Replace `activateDueCampaigns` / `completeFinishedCampaigns` with channel-level equivalents.

**Files:**
- Modify: `src/lib/campaigns/state-machine.ts`
- Test: `tests/campaign-approval.test.ts`
- Test: `tests/campaign-approval-channel-activation.test.ts`

**Interfaces:**
- Consumes: `assertChannelDraftAndAccessible` (Task 3); `decideChannelApproval` (Task 4); updated enums (Tasks 1-2)
- Produces:
  - `deriveCampaignStatus(statuses: CampaignChannelStatus[]): CampaignStatus`
  - `updateCampaignStatus(db: Db, campaignId: string, actor: Actor | null): Promise<void>`
  - `submitChannelForApproval(db: PrismaClient, actor: Actor, campaignChannelId: string): Promise<CampaignChannel>`
  - `decideChannelApproval(db: PrismaClient, actor: Actor, campaignChannelId: string, decision: ApprovalDecision, comments?: string): Promise<CampaignChannel>` — wraps decisions.ts and updates campaign status
  - `activateDueChannels(db: PrismaClient, now: Date): Promise<number>`
  - `completeFinishedChannels(db: PrismaClient, now: Date): Promise<number>`

- [ ] **Step 1: Write failing test for `deriveCampaignStatus`**

```typescript
// In tests/campaign-approval.test.ts, add:
import { deriveCampaignStatus } from "@/lib/campaigns/state-machine";

describe("deriveCampaignStatus", () => {
  it("returns draft when any channel is draft", () => {
    expect(deriveCampaignStatus(["pending", "draft"])).toBe("draft");
  });

  it("returns live when any channel is live", () => {
    expect(deriveCampaignStatus(["live", "pending"])).toBe("live");
  });

  it("returns pending when all submitted and any pending", () => {
    expect(deriveCampaignStatus(["pending", "scheduled"])).toBe("pending");
  });

  it("returns scheduled when all channels are scheduled", () => {
    expect(deriveCampaignStatus(["scheduled", "scheduled"])).toBe("scheduled");
  });

  it("returns paused when all channels are paused", () => {
    expect(deriveCampaignStatus(["paused", "paused"])).toBe("paused");
  });

  it("returns completed when all channels are completed or cancelled", () => {
    expect(deriveCampaignStatus(["completed", "cancelled"])).toBe("completed");
  });

  it("returns draft for empty channel list", () => {
    expect(deriveCampaignStatus([])).toBe("draft");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/campaign-approval.test.ts -t "deriveCampaignStatus"
```

- [ ] **Step 3: Rewrite `src/lib/campaigns/state-machine.ts`**

Full replacement of state machine. Key changes:

```typescript
import type {
  ApprovalDecision,
  Campaign,
  CampaignChannel,
  CampaignChannelStatus,
  CampaignStatus,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import {
  ForbiddenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  assertOrganizationAccess,
  assertPermission,
  type Actor,
} from "@/lib/auth/permissions";
import { writeAudit } from "@/lib/audit/audit";
import { getSetting } from "@/lib/settings/settings";
import { logger } from "@/lib/logging/logger";
import { operatingDayStart } from "@/lib/time/operating-day";
import type { ChannelTypeDefinition } from "@/lib/channel-types/versions";
import type { StepConfig } from "@/lib/channels/readiness";
import { decideChannelApproval as recordChannelApproval } from "@/lib/approvals/decisions";

/** SRS §5.1 — campaign-level allowed transitions (manual overrides only; most status changes are derived). */
export const ALLOWED_TRANSITIONS: Readonly<Record<CampaignStatus, readonly CampaignStatus[]>> = {
  draft:     ["cancelled"],
  pending:   ["cancelled"],
  scheduled: ["cancelled"],
  live:      ["paused", "completed"],
  paused:    ["live", "completed"],
  completed: [],
  cancelled: [],
};

/**
 * Priority-ordered derivation of campaign status from its channels.
 * Written as a pure function for testability.
 */
export function deriveCampaignStatus(statuses: CampaignChannelStatus[]): CampaignStatus {
  if (statuses.length === 0) return "draft";
  if (statuses.some((s) => s === "live")) return "live";
  if (statuses.some((s) => s === "draft")) return "draft";
  if (statuses.some((s) => s === "pending")) return "pending";
  if (statuses.every((s) => s === "completed" || s === "cancelled")) return "completed";
  if (statuses.every((s) => s === "paused" || s === "completed" || s === "cancelled")) return "paused";
  if (statuses.every((s) => s === "scheduled" || s === "completed" || s === "cancelled")) return "scheduled";
  // Mixed (e.g. some scheduled + some paused) — treat as paused
  return "paused";
}

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Recomputes campaign status from its channels and persists it.
 * Called after every channel status transition.
 */
export async function updateCampaignStatus(
  db: Db,
  campaignId: string,
  actor: Actor | null,
): Promise<void> {
  const channels = await db.campaignChannel.findMany({
    where: { campaignId },
    select: { status: true },
  });
  const derived = deriveCampaignStatus(channels.map((c) => c.status));

  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  if (campaign.status === derived) return;

  await db.campaign.update({
    where: { id: campaignId },
    data: { status: derived, updatedById: actor?.userId },
  });
  await db.campaignStatusHistory.create({
    data: {
      campaignId,
      fromStatus: campaign.status,
      toStatus: derived,
      changedByUserId: actor?.userId ?? null,
      reason: "derived from channel status change",
    },
  });
}

/** Channel is ready to submit: has ICP, has email lead spec, meets asset requirements. */
async function assertChannelReadyForApproval(db: Db, channelId: string): Promise<void> {
  const channel = await db.campaignChannel.findUniqueOrThrow({
    where: { id: channelId },
    include: { channelTypeVersion: true },
  });

  const icpCount = await db.icpCriterion.count({ where: { campaignChannelId: channelId } });
  if (icpCount === 0) {
    throw new ValidationError("Channel needs at least one ICP criterion before approval");
  }

  const emailSpec = await db.leadFieldSpec.findFirst({
    where: { campaignChannelId: channelId, fieldKey: "email" },
  });
  if (emailSpec === null) {
    throw new ValidationError("Channel needs an 'email' lead field spec before approval");
  }

  const definition = channel.channelTypeVersion.definitionJson as ChannelTypeDefinition;
  const stepConfig = (channel.stepConfigJson ?? {}) as StepConfig;
  if (
    definition.requiresAsset &&
    stepConfig.placement !== "skipped" &&
    stepConfig.placement !== "optional"
  ) {
    const activeCount = await db.assetPlacement.count({
      where: { campaignChannelId: channelId, status: "active" },
    });
    if (activeCount === 0) {
      throw new ValidationError(
        `Channel "${definition.name}" requires at least one active asset placement before approval`,
      );
    }
  }
}

async function loadAccessibleChannel(
  db: PrismaClient,
  actor: Actor,
  channelId: string,
): Promise<CampaignChannel & { campaign: Campaign }> {
  const channel = await db.campaignChannel.findUnique({
    where: { id: channelId },
    include: { campaign: true },
  });
  if (channel === null || channel.campaign.deletedAt !== null) {
    throw new NotFoundError("Channel not found");
  }
  assertOrganizationAccess(actor, channel.campaign.clientOrganizationId);
  return channel;
}

/** IIF submits a channel for client approval: draft → pending. */
export async function submitChannelForApproval(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:submitInternal"); // reuse existing permission
  const channel = await loadAccessibleChannel(db, actor, campaignChannelId);
  if (channel.status !== "draft") {
    throw new InvalidStateTransitionError(`Channel is ${channel.status}; only a draft channel can be submitted`);
  }
  await assertChannelReadyForApproval(db, campaignChannelId);

  return db.$transaction(async (tx) => {
    const updated = await tx.campaignChannel.update({
      where: { id: campaignChannelId },
      data: { status: "pending", updatedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: "transition:pending",
      before: { status: "draft" },
      after: { status: "pending" },
    });
    await updateCampaignStatus(tx, channel.campaignId, actor);
    return updated;
  });
}

/** Client approves or rejects a channel. Writes ChannelApproval snapshot + transitions channel status. */
export async function decideChannelApproval(
  db: PrismaClient,
  actor: Actor,
  campaignChannelId: string,
  decision: ApprovalDecision,
  comments?: string,
): Promise<CampaignChannel> {
  assertPermission(actor, "campaign:approveClient");
  const channel = await loadAccessibleChannel(db, actor, campaignChannelId);
  if (channel.status !== "pending") {
    throw new InvalidStateTransitionError(`Channel is ${channel.status}, not awaiting approval`);
  }

  return db.$transaction(async (tx) => {
    // Write the approval record with all three snapshots (inside tx so snapshot and status are atomic)
    await recordChannelApproval(db, actor, { campaignChannelId, decision, comments });

    const toStatus: CampaignChannelStatus =
      decision === "rejected"
        ? "draft"
        : channel.startDate <= new Date()
        ? "live"
        : "scheduled";

    const updated = await tx.campaignChannel.update({
      where: { id: campaignChannelId },
      data: { status: toStatus, updatedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      entityType: "CampaignChannel",
      entityId: campaignChannelId,
      action: `transition:${toStatus}`,
      before: { status: "pending" },
      after: { status: toStatus, decision, comments },
    });
    await updateCampaignStatus(tx, channel.campaignId, actor);
    return updated;
  });
}

/** Manual campaign-level transition (pause, complete, cancel). Campaign status is otherwise derived. */
export async function transitionCampaign(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  toStatus: CampaignStatus,
  reason?: string,
): Promise<Campaign> {
  assertPermission(actor, "campaign:write");
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  assertOrganizationAccess(actor, campaign.clientOrganizationId);

  if (!ALLOWED_TRANSITIONS[campaign.status].includes(toStatus)) {
    throw new InvalidStateTransitionError(`Campaign cannot move from ${campaign.status} to ${toStatus}`);
  }

  return db.$transaction(async (tx) => {
    const result = await tx.campaign.updateMany({
      where: { id: campaign.id, status: campaign.status },
      data: { status: toStatus, updatedById: actor.userId },
    });
    if (result.count === 0) {
      throw new InvalidStateTransitionError(`Campaign status changed concurrently`);
    }
    const updated = await tx.campaign.findUniqueOrThrow({ where: { id: campaign.id } });
    await tx.campaignStatusHistory.create({
      data: { campaignId: campaign.id, fromStatus: campaign.status, toStatus, changedByUserId: actor.userId, reason },
    });
    await writeAudit(tx, actor, {
      entityType: "Campaign",
      entityId: campaign.id,
      action: `transition:${toStatus}`,
      before: { status: campaign.status },
      after: { status: toStatus, reason },
    });
    return updated;
  });
}

/** SUPER_ADMIN: revert a scheduled campaign to draft (resets all channels to draft too). */
export async function superAdminRevertToDraft(
  db: PrismaClient,
  actor: Actor,
  campaignId: string,
  reason?: string,
): Promise<Campaign> {
  if (!actor.roles.includes("SUPER_ADMIN")) {
    throw new ForbiddenError("Only SUPER_ADMIN can revert a scheduled campaign to draft");
  }
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (campaign === null || campaign.deletedAt !== null) throw new NotFoundError("Campaign not found");
  if (campaign.status !== "scheduled") {
    throw new InvalidStateTransitionError(
      `Campaign is ${campaign.status}; only scheduled campaigns can be reverted to draft`,
    );
  }
  const revertReason = reason ?? "Reverted to draft by SUPER_ADMIN";
  return db.$transaction(async (tx) => {
    // Reset all non-terminal channels to draft
    await tx.campaignChannel.updateMany({
      where: { campaignId, status: { notIn: ["completed", "cancelled"] } },
      data: { status: "draft", updatedById: actor.userId },
    });
    const updated = await tx.campaign.update({
      where: { id: campaignId },
      data: { status: "draft", updatedById: actor.userId },
    });
    await tx.campaignStatusHistory.create({
      data: { campaignId, fromStatus: "scheduled", toStatus: "draft", changedByUserId: actor.userId, reason: revertReason },
    });
    await writeAudit(tx, actor, {
      entityType: "Campaign",
      entityId: campaignId,
      action: "transition:draft",
      before: { status: "scheduled" },
      after: { status: "draft", reason: revertReason },
    });
    return updated;
  });
}

async function transitionChannels(
  db: PrismaClient,
  channels: { id: string; campaignId: string }[],
  toStatus: CampaignChannelStatus,
  reason: string,
): Promise<number> {
  let transitioned = 0;
  const campaignIds = new Set<string>();
  for (const channel of channels) {
    try {
      await db.$transaction(async (tx) => {
        await tx.campaignChannel.update({
          where: { id: channel.id },
          data: { status: toStatus },
        });
        campaignIds.add(channel.campaignId);
      });
      transitioned += 1;
    } catch (error) {
      logger.error("channel.scheduledTransition.failed", {
        channelId: channel.id,
        toStatus,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Update campaign status for each affected campaign
  for (const campaignId of campaignIds) {
    try {
      await db.$transaction((tx) => updateCampaignStatus(tx, campaignId, null));
    } catch (error) {
      logger.error("campaign.statusDerivation.failed", { campaignId, error: String(error) });
    }
  }
  return transitioned;
}

/** Scheduled → Live at flight start (channel-level, replaces activateDueCampaigns). */
export async function activateDueChannels(db: PrismaClient, now: Date): Promise<number> {
  const timeZone = await getSetting(db, "operatingTimezone");
  const today = operatingDayStart(now, timeZone);

  const due = await db.campaignChannel.findMany({
    where: { status: "scheduled", startDate: { lte: today } },
    select: { id: true, campaignId: true },
  });
  return transitionChannels(db, due, "live", "flight start reached");
}

/** Live/Paused → Completed once end date passes (channel-level). */
export async function completeFinishedChannels(db: PrismaClient, now: Date): Promise<number> {
  const timeZone = await getSetting(db, "operatingTimezone");
  const today = operatingDayStart(now, timeZone);

  const finished = await db.campaignChannel.findMany({
    where: { status: { in: ["live", "paused"] }, endDate: { lt: today } },
    select: { id: true, campaignId: true },
  });
  return transitionChannels(db, finished, "completed", "flight end passed");
}
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/campaign-approval.test.ts tests/campaign-approval-channel-activation.test.ts
```

Update these test files to:
- Replace `submitForInternalApproval` / `decideInternalApproval` / `decideClientApproval` calls with `submitChannelForApproval` / `decideChannelApproval`
- Replace `setIcpCriteria(db, manager, campaign.id, ...)` with `setIcpCriteria(db, manager, channel.id, ...)`
- Replace `activateDueCampaigns` / `completeFinishedCampaigns` with `activateDueChannels` / `completeFinishedChannels`
- The `scenario` helper needs an ICP criterion on the channel, not the campaign

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/state-machine.ts tests/campaign-approval.test.ts tests/campaign-approval-channel-activation.test.ts
git commit -m "feat: channel state machine — submit/decide per channel; campaign status derived"
```

---

## Task 6: Lead Pipeline — Read ICP and Lead Spec from Channel

**Files:**
- Modify: `src/lib/leads/intake.ts`
- Modify: `src/lib/leads/matching.ts`
- Modify: `src/lib/lists/target-accounts.ts`
- Test: `tests/lead-intake-caps.test.ts`
- Test: `tests/icp-matching.test.ts`
- Test: `tests/field-validation.test.ts`

**Interfaces:**
- Consumes: `IcpCriterion.campaignChannelId`, `LeadFieldSpec.campaignChannelId`, `CampaignChannel.advisoryIcpMatch/advisoryTalMatch/defaultMaxLeadsPerAccount` (Task 1)
- Produces:
  - `matchesIcp(db, campaignChannelId, account, contact)` — reads from `campaignChannelId`
  - `resolveLeadCap(db, campaignChannelId, accountId)` — reads `defaultMaxLeadsPerAccount` from channel
  - `submitLeadFile` reads `LeadFieldSpec` from `campaignChannelId` and advisory flags from channel

- [ ] **Step 1: Write failing test for `matchesIcp` with channel scope**

In `tests/icp-matching.test.ts`, update the `matchesIcp` call to pass `campaignChannelId`:

```typescript
// Old:
const result = await matchesIcp(db, campaign.id, accountData, contactData);
// New:
const result = await matchesIcp(db, channel.id, accountData, contactData);
```

Also update fixture setup to create `IcpCriterion` with `campaignChannelId` not `campaignId`.

- [ ] **Step 2: Run test to confirm failure**

```bash
npx vitest run tests/icp-matching.test.ts
```

- [ ] **Step 3: Update `src/lib/leads/matching.ts`**

Change `matchesIcp` parameter from `campaignId` to `campaignChannelId`:

```typescript
export async function matchesIcp(
  db: Db,
  campaignChannelId: string,
  account: { industry: string | null; employeeRange: string | null; revenueRange: string | null; country: string | null },
  contact: { jobFunction: string | null; seniority: string | null; jobTitle: string | null },
): Promise<IcpMatchResult> {
  const criteria = await db.icpCriterion.findMany({ where: { campaignChannelId } });
  // rest unchanged
```

- [ ] **Step 4: Update `src/lib/leads/intake.ts`**

```typescript
// Old line 150:
const specRows = await db.leadFieldSpec.findMany({ where: { campaignId: campaignChannel.campaignId } });
// New:
const specRows = await db.leadFieldSpec.findMany({ where: { campaignChannelId: input.campaignChannelId } });

// Old advisory flags from campaign:
if (campaign.advisoryTalMatch) { ... }
if (campaign.advisoryIcpMatch) { ... }
// New — read from campaignChannel:
if (campaignChannel.advisoryTalMatch) { ... }
if (campaignChannel.advisoryIcpMatch) { ... }

// Old matchesIcp call (line ~419):
const icp = await matchesIcp(db, campaign.id, { ... }, { ... });
// New:
const icp = await matchesIcp(db, campaignChannel.id, { ... }, { ... });
```

The `campaign` local variable is still needed for `campaign.clientOrganizationId`, `campaign.id` (for cross-campaign dupe check), and `campaign.id` for TAL matching. Keep `const campaign = campaignChannel.campaign;`.

- [ ] **Step 5: Update `src/lib/lists/target-accounts.ts`**

The `resolveLeadCap` function currently returns `campaign.defaultMaxLeadsPerAccount`. Change to read from the `CampaignChannel`:

```typescript
// The function signature and callers need updating.
// Currently: resolveLeadCap(db, campaignId, accountId)
// After: resolveLeadCap(db, campaignChannelId, accountId)

// In the function, replace the campaign lookup with channel lookup:
const channel = await db.campaignChannel.findUnique({
  where: { id: campaignChannelId },
  select: { defaultMaxLeadsPerAccount: true },
});
// ...
return channel?.defaultMaxLeadsPerAccount ?? null;
```

Update all callers in `intake.ts` to pass `campaignChannelId`.

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/lead-intake-caps.test.ts tests/icp-matching.test.ts tests/field-validation.test.ts
```

Update fixture setups in these tests to create ICP/spec on channel, not campaign.

- [ ] **Step 7: Commit**

```bash
git add src/lib/leads/ src/lib/lists/target-accounts.ts tests/lead-intake-caps.test.ts tests/icp-matching.test.ts tests/field-validation.test.ts
git commit -m "feat: lead pipeline reads ICP, lead spec, and advisory flags from channel"
```

---

## Task 7: Campaign Clone — Clone ICP/Spec Per Channel

**Files:**
- Modify: `src/lib/campaigns/clone.ts`
- Test: `tests/campaign-clone.test.ts`

**Interfaces:**
- Consumes: `IcpCriterion.campaignChannelId`, `LeadFieldSpec.campaignChannelId` (Task 1)
- Produces: `cloneCampaign` clones ICP/spec for each channel independently

- [ ] **Step 1: Write failing test**

In `tests/campaign-clone.test.ts`, verify that ICP criteria appear on the cloned channels (not at campaign level):

```typescript
it("clones ICP criteria onto each channel", async () => {
  const db = testDb();
  // ... setup source campaign with channel
  await setIcpCriteria(db, manager, sourceChannel.id, [
    { dimension: "country", operator: "in", values: ["US"], isMandatory: true },
  ]);
  const clone = await cloneCampaign(db, manager, source.id, { code: "CLONE-01" });
  const cloneChannels = await db.campaignChannel.findMany({ where: { campaignId: clone.id } });
  expect(cloneChannels).toHaveLength(1);
  const cloneIcp = await db.icpCriterion.findMany({
    where: { campaignChannelId: cloneChannels[0].id },
  });
  expect(cloneIcp).toHaveLength(1);
  expect(cloneIcp[0].dimension).toBe("country");
});
```

- [ ] **Step 2: Run test to confirm failure**

```bash
npx vitest run tests/campaign-clone.test.ts
```

- [ ] **Step 3: Update `src/lib/campaigns/clone.ts`**

Remove `icpCriteria` and `leadFieldSpecs` from the campaign-level include. Move cloning into the channel loop:

```typescript
const source = await db.campaign.findUnique({
  where: { id: sourceCampaignId },
  include: {
    // removed: icpCriteria, leadFieldSpecs
    channels: {
      include: { icpCriteria: true, leadFieldSpecs: true },
    },
  },
});
```

Remove from `tx.campaign.create`: `advisoryTalMatch`, `advisoryIcpMatch`, `defaultMaxLeadsPerAccount`.

In the channel loop, after creating the cloned channel, clone its ICP and lead specs:

```typescript
for (const channel of source.channels) {
  const channelStart = channel.startDate < startDate ? startDate : channel.startDate;
  const channelEnd = channel.endDate > endDate ? endDate : channel.endDate;

  const clonedChannel = await tx.campaignChannel.create({
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
      advisoryIcpMatch: channel.advisoryIcpMatch,
      advisoryTalMatch: channel.advisoryTalMatch,
      defaultMaxLeadsPerAccount: channel.defaultMaxLeadsPerAccount,
      status: "draft",
      createdById: actor.userId,
      updatedById: actor.userId,
    },
  });

  for (const criterion of channel.icpCriteria) {
    await tx.icpCriterion.create({
      data: {
        campaignChannelId: clonedChannel.id,
        dimension: criterion.dimension,
        operator: criterion.operator,
        valuesJson: criterion.valuesJson ?? {},
        isMandatory: criterion.isMandatory,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
  }

  for (const field of channel.leadFieldSpecs) {
    await tx.leadFieldSpec.create({
      data: {
        campaignChannelId: clonedChannel.id,
        fieldKey: field.fieldKey,
        label: field.label,
        dataType: field.dataType,
        isRequired: field.isRequired,
        rejectIfMissing: field.rejectIfMissing,
        allowedValuesJson: field.allowedValuesJson ?? undefined,
        validationPattern: field.validationPattern,
        createdById: actor.userId,
        updatedById: actor.userId,
      },
    });
  }
}
```

Remove the now-redundant top-level `icpCriteria` and `leadFieldSpecs` loops from `cloneCampaign`.

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/campaign-clone.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/lib/campaigns/clone.ts tests/campaign-clone.test.ts
git commit -m "feat: clone copies ICP and lead spec per channel"
```

---

## Task 8: Snapshot — Remove Campaign-Level, Keep Channel-Level

The old `buildConfigSnapshot` is no longer valid (campaign no longer owns ICP/spec). Remove it. The per-channel approval snapshots are built by `buildIcpSnapshot`/`buildLeadSpecSnapshot` in `approvals/status.ts` (Task 4). Update any remaining references.

**Files:**
- Modify: `src/lib/campaigns/snapshot.ts`

**Interfaces:**
- Consumes: Nothing new; removes the export
- Produces: `snapshot.ts` is emptied or replaced with a comment; no `buildConfigSnapshot` export

- [ ] **Step 1: Check all import sites**

```bash
grep -rn "buildConfigSnapshot\|CampaignConfigSnapshot\|snapshot" \
  /Users/bhanuteja-intellifunel/intellifunnellabs/websites/intellifunnel-console/src/ \
  --include="*.ts" --include="*.tsx" | grep -v "node_modules"
```

- [ ] **Step 2: Remove `src/lib/campaigns/snapshot.ts`** or replace with a redirect comment

If nothing imports `buildConfigSnapshot` after state-machine.ts is updated in Task 5 (it referenced it for `decideClientApproval`), delete the file:

```bash
rm src/lib/campaigns/snapshot.ts
```

If any file still imports it, update that file to use the per-channel snapshot builders from `approvals/status.ts` instead.

- [ ] **Step 3: Run type check**

```bash
npx tsc --noEmit 2>&1 | grep snapshot
```

Expected: No errors referencing snapshot.

- [ ] **Step 4: Commit**

```bash
git add src/lib/campaigns/snapshot.ts
git commit -m "refactor: remove campaign-level config snapshot (replaced by per-channel ChannelApproval snapshots)"
```

---

## Task 9: UI and Server Actions

Update admin pages and server actions to use channel-scoped ICP/spec editors and the new approval flow.

**Files:**
- Modify: `src/app/(admin)/campaigns/[id]/actions.ts`
- Modify: `src/app/(admin)/campaigns/[id]/page.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/lead-field-spec-editor.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx`
- Modify: `src/app/(admin)/campaigns/[id]/channels/[channelId]/actions.ts`
- Modify: `src/app/(admin)/campaigns/[id]/leads/upload/page.tsx`

- [ ] **Step 1: Update `src/app/(admin)/campaigns/[id]/actions.ts`**

`setIcpCriteria` and `setLeadFieldSpec` server actions now take `channelId` as the first content arg:

```typescript
// Old:
export async function setIcpCriteriaAction(campaignId: string, criteria: IcpCriterionInput[]) {
  await setIcpCriteria(db, actor, campaignId, criteria);
}

// New:
export async function setIcpCriteriaAction(channelId: string, criteria: IcpCriterionInput[]) {
  await setIcpCriteria(db, actor, channelId, criteria);
}

// Same pattern for setLeadFieldSpecAction
```

Remove any actions that called `submitForInternalApproval`, `decideInternalApproval`, or `decideClientApproval`. Add actions for `submitChannelForApproval` and `decideChannelApproval` if they don't already live in the channel `[channelId]/actions.ts`.

- [ ] **Step 2: Update `src/app/(admin)/campaigns/[id]/page.tsx`**

The campaign page previously read `campaign.icpCriteria` and `campaign.leadFieldSpecs`. These are now on each channel. Move the ICP/spec editors to the channel detail page (or display them per-channel inside an accordion on the campaign page). Remove the campaign-level `<LeadFieldSpecEditor>` and ICP section. Add a link/summary for each channel showing whether ICP and lead spec are configured.

Specifically:
- Remove `campaign.icpCriteria` usage (lines 243+)
- Remove `campaign.leadFieldSpecs` usage (lines 253+)
- Remove `<LeadFieldSpecEditor>` import and usage

- [ ] **Step 3: Update `src/app/(admin)/campaigns/[id]/channels/[channelId]/page.tsx`**

Add ICP criteria editor and lead field spec editor sections. Move the existing `<LeadFieldSpecEditor>` here. Update `getChannelTermsApprovalStatus` call → `getChannelApprovalStatus`. Update approval action buttons: remove internal approval; add "Submit for Client Approval" button calling `submitChannelForApproval`.

```typescript
// Old approval status fetch:
const termsStatus = await getChannelTermsApprovalStatus(db, channel);
// New:
const termsStatus = await getChannelApprovalStatus(db, channel);
```

- [ ] **Step 4: Update lead upload page**

`src/app/(admin)/campaigns/[id]/leads/upload/page.tsx` currently reads `campaign.leadFieldSpecs` (lines 43-54). Update to read `channel.leadFieldSpecs` via the channel record:

```typescript
const channel = await db.campaignChannel.findUniqueOrThrow({
  where: { id: channelId },
  include: { leadFieldSpecs: true },
});
const specs = channel.leadFieldSpecs;
```

- [ ] **Step 5: Run type check**

```bash
npx tsc --noEmit 2>&1 | head -80
```

Expected: 0 errors. Fix any remaining type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/
git commit -m "feat: move ICP/lead spec editors to channel level; update approval actions"
```

---

## Task 10: Test Suite — Clean Up All Remaining Failures

Update all remaining test files that still use old patterns. Run the full suite and fix each file.

**Files:**
- `tests/campaign-approval.test.ts` (partially updated in Task 5 — finish)
- `tests/campaign-channel-edit.test.ts`
- `tests/organizations-archive.test.ts`
- `tests/asset-placements.test.ts`
- `tests/delivery-runs.test.ts`
- `tests/delivery-schema.test.ts`
- `tests/asset-placement-requirement.test.ts`
- `tests/target-accounts.test.ts`
- `tests/compliance-anonymize.test.ts`
- `tests/lead-intake-caps.test.ts` (partially in Task 6)

- [ ] **Step 1: Run full test suite and collect failures**

```bash
npx vitest run 2>&1 | grep "FAIL\|Error" | head -60
```

- [ ] **Step 2: Fix `tests/campaign-channel-edit.test.ts`**

Update:
- `pendingInternalApproval` → `pending` or `draft`
- `getChannelTermsApprovalStatus` → `getChannelApprovalStatus`

- [ ] **Step 3: Fix `tests/organizations-archive.test.ts`**

Remove `advisoryIcpMatch` / `advisoryTalMatch` from `Campaign` creation. Move to `CampaignChannel` creation. Update `pendingInternalApproval` → `draft`, `pendingClientApproval` → `pending`.

- [ ] **Step 4: Fix all remaining test files**

Pattern for every test file that creates a `Campaign` with advisory flags:
```typescript
// Remove from db.campaign.create:
advisoryIcpMatch: false,
advisoryTalMatch: false,
defaultMaxLeadsPerAccount: 5,

// Add to db.campaignChannel.create:
advisoryIcpMatch: false,
advisoryTalMatch: false,
defaultMaxLeadsPerAccount: 5,
```

Pattern for every test file that creates `IcpCriterion`:
```typescript
// Old:
await db.icpCriterion.create({ data: { campaignId: campaign.id, ... } });
// New:
await db.icpCriterion.create({ data: { campaignChannelId: channel.id, ... } });
```

Pattern for `channelTermsApproval` → `channelApproval`:
```typescript
// Old:
await db.channelTermsApproval.create({ ... });
// New:
await db.channelApproval.create({ data: { ..., type: "client" } });
```

- [ ] **Step 5: Run full test suite — confirm all pass**

```bash
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 6: Final type check**

```bash
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add tests/
git commit -m "test: update all test fixtures and assertions for channel-level ICP/lead spec"
```

---

## Self-Review

**Spec coverage:**
- ✅ `IcpCriterion.campaignChannelId` replaces `campaignId` — Task 1 + 3
- ✅ `LeadFieldSpec.campaignChannelId` replaces `campaignId` — Task 1 + 3
- ✅ `CampaignApproval` dropped — Task 1 migration
- ✅ `ChannelTermsApproval` → `ChannelApproval` with `type`, `icpSnapshotJson`, `leadSpecSnapshotJson` — Tasks 1 + 4
- ✅ `CampaignChannel` gains `advisoryIcpMatch`, `advisoryTalMatch`, `defaultMaxLeadsPerAccount` — Task 1
- ✅ `Campaign` loses advisory flags + `defaultMaxLeadsPerAccount` + `approvedSnapshotId` — Task 1
- ✅ `CampaignChannelStatus` unified to 7 values (`active` → `live`) — Tasks 1 + 2
- ✅ `CampaignStatus` loses `pendingInternalApproval`, renames `pendingClientApproval` → `pending` — Tasks 1 + 2
- ✅ Campaign status derived from channels — Task 5 (`deriveCampaignStatus`, `updateCampaignStatus`)
- ✅ Per-channel submit + approve flow — Task 5 (`submitChannelForApproval`, `decideChannelApproval`)
- ✅ Approval staleness detection across all three snapshots — Task 4
- ✅ Lead intake reads from channel — Task 6
- ✅ Clone copies per-channel — Task 7
- ✅ `buildConfigSnapshot` removed — Task 8

**Placeholder scan:** None found.

**Type consistency:**
- `getChannelApprovalStatus` used consistently after Task 4 removes the old alias
- `decideChannelApproval` in state-machine.ts wraps `decideChannelApproval` from decisions.ts — names are identical; the state-machine version is the public entry point (handles status transition), decisions.ts is the persistence layer
- `campaignChannelId` used consistently in all queries after Tasks 3, 6, 7

---

Plan complete and saved to `docs/superpowers/plans/2026-09-13-channel-level-icp-lead-spec.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks

**2. Inline Execution** — Execute tasks in this session using executing-plans skill

Which approach?

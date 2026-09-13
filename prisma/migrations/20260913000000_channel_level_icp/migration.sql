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

-- Step 4: Add advisory flags + defaultMaxLeadsPerAccount + counters + stepConfig to CampaignChannel
ALTER TABLE "CampaignChannel"
  ADD COLUMN "advisoryIcpMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "advisoryTalMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "defaultMaxLeadsPerAccount" INTEGER,
  ADD COLUMN "reservedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deliveredCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "stepConfigJson" JSONB;

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

-- Step 6: Create ChannelApproval table (ChannelTermsApproval did not exist in this codebase;
--         this is a net-new table combining the rename + extension described in the SDD)
-- ApprovalType and ApprovalDecision enums already exist from the 20260903 migration;
-- they are reused here (CampaignApproval was dropped above but the types persist).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalType') THEN
    CREATE TYPE "ApprovalType" AS ENUM ('internal', 'client');
  END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ApprovalDecision') THEN
    CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');
  END IF;
END $$;

CREATE TABLE "ChannelApproval" (
  "id"                   TEXT NOT NULL,
  "campaignChannelId"    TEXT NOT NULL,
  "type"                 "ApprovalType" NOT NULL DEFAULT 'client',
  "decision"             "ApprovalDecision" NOT NULL,
  "decidedByUserId"      TEXT NOT NULL,
  "decidedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "comments"             TEXT,
  "termsSnapshotJson"    JSONB NOT NULL,
  "icpSnapshotJson"      JSONB,
  "leadSpecSnapshotJson" JSONB,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,
  "createdById"          TEXT,
  "updatedById"          TEXT,

  CONSTRAINT "ChannelApproval_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChannelApproval_campaignChannelId_fkey"
    FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "ChannelApproval_campaignChannelId_type_decidedAt_idx"
  ON "ChannelApproval"("campaignChannelId", "type", "decidedAt");

-- Step 7a: Unify CampaignChannelStatus enum (draft, active, paused, completed → 7-value)
-- Postgres requires creating a new type, migrating, then renaming.
-- Drop default first so Postgres can cast; restore afterwards.
CREATE TYPE "CampaignChannelStatus_new" AS ENUM (
  'draft', 'pending', 'scheduled', 'live', 'paused', 'completed', 'cancelled'
);
ALTER TABLE "CampaignChannel" ALTER COLUMN "status" DROP DEFAULT;
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
ALTER TABLE "CampaignChannel" ALTER COLUMN "status" SET DEFAULT 'draft'::"CampaignChannelStatus";

-- Step 7b: Update CampaignStatus enum
-- Map 'pendingClientApproval' → 'pending', 'pendingInternalApproval' → 'draft'
-- via USING clause (cannot UPDATE rows before type change since new values don't
-- exist in the old enum).
CREATE TYPE "CampaignStatus_new" AS ENUM (
  'draft', 'pending', 'scheduled', 'live', 'paused', 'completed', 'cancelled'
);
ALTER TABLE "Campaign" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Campaign"
  ALTER COLUMN "status" TYPE "CampaignStatus_new"
  USING (
    CASE "status"::text
      WHEN 'pendingClientApproval'   THEN 'pending'
      WHEN 'pendingInternalApproval' THEN 'draft'
      ELSE "status"::text
    END
  )::"CampaignStatus_new";

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
ALTER TABLE "Campaign" ALTER COLUMN "status" SET DEFAULT 'draft'::"CampaignStatus";

-- Step 8: Remove advisory columns + approvedSnapshotId + defaultMaxLeadsPerAccount from Campaign
ALTER TABLE "Campaign"
  DROP COLUMN IF EXISTS "advisoryIcpMatch",
  DROP COLUMN IF EXISTS "advisoryTalMatch",
  DROP COLUMN IF EXISTS "defaultMaxLeadsPerAccount",
  DROP COLUMN IF EXISTS "approvedSnapshotId";

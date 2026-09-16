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
-- channel type definition. Idempotent via the NOT EXISTS guard. TDD-validated
-- against real stepConfigJson fixtures in commit 538eabb (test file removed in
-- 17b54ae once stepConfigJson itself was dropped and the source column no
-- longer existed to test against).
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

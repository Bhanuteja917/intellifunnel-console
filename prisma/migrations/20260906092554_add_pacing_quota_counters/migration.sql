-- AlterTable
ALTER TABLE "CampaignChannel" ADD COLUMN     "deliveredCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reservedCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PartnerAllocation" ADD COLUMN     "deliveredCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reservedCount" INTEGER NOT NULL DEFAULT 0;

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

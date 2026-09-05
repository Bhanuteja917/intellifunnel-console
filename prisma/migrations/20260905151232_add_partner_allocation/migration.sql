-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('draft', 'active', 'paused', 'ended');

-- CreateTable
CREATE TABLE "PartnerAllocation" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "partnerOrganizationId" TEXT NOT NULL,
    "allocatedQuantity" INTEGER NOT NULL,
    "payoutRateMinor" BIGINT NOT NULL,
    "payoutCurrency" CHAR(3) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "AllocationStatus" NOT NULL DEFAULT 'draft',
    "revealClientIdentity" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "PartnerAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PartnerAllocation_campaignChannelId_idx" ON "PartnerAllocation"("campaignChannelId");

-- CreateIndex
CREATE INDEX "PartnerAllocation_partnerOrganizationId_idx" ON "PartnerAllocation"("partnerOrganizationId");

-- AddForeignKey
ALTER TABLE "PartnerAllocation" ADD CONSTRAINT "PartnerAllocation_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerAllocation" ADD CONSTRAINT "PartnerAllocation_partnerOrganizationId_fkey" FOREIGN KEY ("partnerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

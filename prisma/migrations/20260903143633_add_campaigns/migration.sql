-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('draft', 'pendingInternalApproval', 'pendingClientApproval', 'scheduled', 'live', 'paused', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "IcpDimension" AS ENUM ('industry', 'employeeRange', 'revenueRange', 'country', 'region', 'jobFunction', 'seniority', 'jobTitle', 'custom');

-- CreateEnum
CREATE TYPE "IcpOperator" AS ENUM ('in', 'notIn', 'between', 'contains');

-- CreateEnum
CREATE TYPE "LeadFieldDataType" AS ENUM ('string', 'number', 'boolean', 'date', 'email', 'phone', 'url');

-- CreateEnum
CREATE TYPE "ApprovalType" AS ENUM ('internal', 'client');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('approved', 'rejected');

-- CreateEnum
CREATE TYPE "CampaignChannelStatus" AS ENUM ('draft', 'active', 'paused', 'completed');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "clientOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'draft',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "defaultMaxLeadsPerAccount" INTEGER,
    "clonedFromCampaignId" TEXT,
    "approvedSnapshotId" TEXT,
    "advisoryTalMatch" BOOLEAN NOT NULL DEFAULT false,
    "advisoryIcpMatch" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IcpCriterion" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "dimension" "IcpDimension" NOT NULL,
    "operator" "IcpOperator" NOT NULL,
    "valuesJson" JSONB NOT NULL,
    "isMandatory" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IcpCriterion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadFieldSpec" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "dataType" "LeadFieldDataType" NOT NULL,
    "allowedValuesJson" JSONB,
    "validationPattern" TEXT,
    "rejectIfMissing" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadFieldSpec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignChannel" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "channelTypeVersionId" TEXT NOT NULL,
    "contractedQuantity" INTEGER NOT NULL,
    "clientUnitPriceMinor" BIGINT NOT NULL,
    "costBudgetMinor" BIGINT,
    "currency" CHAR(3) NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "CampaignChannelStatus" NOT NULL DEFAULT 'draft',
    "qualificationFormId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "CampaignChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignApproval" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "type" "ApprovalType" NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "configSnapshotJson" JSONB,
    "snapshotVersion" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignStatusHistory" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "fromStatus" "CampaignStatus",
    "toStatus" "CampaignStatus" NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "CampaignStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_code_key" ON "Campaign"("code");

-- CreateIndex
CREATE INDEX "Campaign_clientOrganizationId_status_idx" ON "Campaign"("clientOrganizationId", "status");

-- CreateIndex
CREATE INDEX "Campaign_status_startDate_idx" ON "Campaign"("status", "startDate");

-- CreateIndex
CREATE INDEX "IcpCriterion_campaignId_idx" ON "IcpCriterion"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "LeadFieldSpec_campaignId_fieldKey_key" ON "LeadFieldSpec"("campaignId", "fieldKey");

-- CreateIndex
CREATE INDEX "CampaignChannel_campaignId_idx" ON "CampaignChannel"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignApproval_campaignId_type_idx" ON "CampaignApproval"("campaignId", "type");

-- CreateIndex
CREATE INDEX "CampaignStatusHistory_campaignId_changedAt_idx" ON "CampaignStatusHistory"("campaignId", "changedAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clientOrganizationId_fkey" FOREIGN KEY ("clientOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_clonedFromCampaignId_fkey" FOREIGN KEY ("clonedFromCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IcpCriterion" ADD CONSTRAINT "IcpCriterion_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadFieldSpec" ADD CONSTRAINT "LeadFieldSpec_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChannel" ADD CONSTRAINT "CampaignChannel_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChannel" ADD CONSTRAINT "CampaignChannel_channelTypeVersionId_fkey" FOREIGN KEY ("channelTypeVersionId") REFERENCES "ChannelTypeVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignChannel" ADD CONSTRAINT "CampaignChannel_qualificationFormId_fkey" FOREIGN KEY ("qualificationFormId") REFERENCES "QualificationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignApproval" ADD CONSTRAINT "CampaignApproval_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignStatusHistory" ADD CONSTRAINT "CampaignStatusHistory_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

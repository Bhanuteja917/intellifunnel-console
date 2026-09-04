-- CreateEnum
CREATE TYPE "LeadSourceType" AS ENUM ('internal', 'partner', 'form');

-- CreateEnum
CREATE TYPE "LeadVerificationStatus" AS ENUM ('pending', 'autoValidating', 'failed', 'needsReview', 'passed');

-- CreateEnum
CREATE TYPE "LeadLifecycleStatus" AS ENUM ('new', 'accepted', 'rejected', 'delivered');

-- CreateEnum
CREATE TYPE "LeadEnrichmentStatus" AS ENUM ('notRequired', 'pending', 'inProgress', 'complete');

-- CreateEnum
CREATE TYPE "LeadStatusDimension" AS ENUM ('verification', 'lifecycle', 'enrichment');

-- CreateTable
CREATE TABLE "LeadSubmission" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "sourceType" "LeadSourceType" NOT NULL,
    "submittedById" TEXT NOT NULL,
    "fileKey" TEXT,
    "mappingJson" JSONB NOT NULL,
    "rowsTotal" INTEGER NOT NULL DEFAULT 0,
    "rowsAccepted" INTEGER NOT NULL DEFAULT 0,
    "rowsFailed" INTEGER NOT NULL DEFAULT 0,
    "status" "ImportStatus" NOT NULL DEFAULT 'pending',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadSubmissionError" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "field" TEXT,
    "rawValue" TEXT,
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSubmissionError_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceType" "LeadSourceType" NOT NULL,
    "verificationStatus" "LeadVerificationStatus" NOT NULL DEFAULT 'pending',
    "lifecycleStatus" "LeadLifecycleStatus" NOT NULL DEFAULT 'new',
    "enrichmentStatus" "LeadEnrichmentStatus" NOT NULL DEFAULT 'notRequired',
    "clientVisible" BOOLEAN NOT NULL DEFAULT false,
    "rejectReasonId" TEXT,
    "fieldValuesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadStatusHistory" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "dimension" "LeadStatusDimension" NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT NOT NULL,
    "changedByUserId" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,

    CONSTRAINT "LeadStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadSubmission_campaignChannelId_status_idx" ON "LeadSubmission"("campaignChannelId", "status");

-- CreateIndex
CREATE INDEX "LeadSubmissionError_submissionId_rowNumber_idx" ON "LeadSubmissionError"("submissionId", "rowNumber");

-- CreateIndex
CREATE INDEX "Lead_campaignChannelId_verificationStatus_idx" ON "Lead"("campaignChannelId", "verificationStatus");

-- CreateIndex
CREATE INDEX "Lead_accountId_idx" ON "Lead"("accountId");

-- CreateIndex
CREATE INDEX "Lead_contactId_idx" ON "Lead"("contactId");

-- CreateIndex
CREATE INDEX "LeadStatusHistory_leadId_dimension_idx" ON "LeadStatusHistory"("leadId", "dimension");

-- AddForeignKey
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadSubmissionError" ADD CONSTRAINT "LeadSubmissionError_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "LeadSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "LeadSubmission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_rejectReasonId_fkey" FOREIGN KEY ("rejectReasonId") REFERENCES "RejectReason"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadStatusHistory" ADD CONSTRAINT "LeadStatusHistory_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

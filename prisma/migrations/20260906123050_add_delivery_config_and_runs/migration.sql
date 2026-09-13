-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('webhook', 'csv');

-- CreateEnum
CREATE TYPE "DeliveryConfigStatus" AS ENUM ('active', 'paused');

-- CreateEnum
CREATE TYPE "DeliveryRunStatus" AS ENUM ('pending', 'success', 'failed', 'exhausted');

-- CreateTable
CREATE TABLE "DeliveryConfig" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "method" "DeliveryMethod" NOT NULL,
    "status" "DeliveryConfigStatus" NOT NULL DEFAULT 'active',
    "webhookUrl" TEXT,
    "webhookSecret" TEXT,
    "csvScheduleCron" TEXT,
    "fieldMappingJson" JSONB NOT NULL,
    "lastCsvCursorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "DeliveryConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRun" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "method" "DeliveryMethod" NOT NULL,
    "status" "DeliveryRunStatus" NOT NULL DEFAULT 'pending',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextRetryAt" TIMESTAMP(3),
    "lastError" TEXT,
    "fileUrl" TEXT,
    "requestPayloadJson" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRunLead" (
    "deliveryRunId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,

    CONSTRAINT "DeliveryRunLead_pkey" PRIMARY KEY ("deliveryRunId","leadId")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryConfig_campaignChannelId_key" ON "DeliveryConfig"("campaignChannelId");

-- CreateIndex
CREATE INDEX "DeliveryRun_campaignChannelId_idx" ON "DeliveryRun"("campaignChannelId");

-- CreateIndex
CREATE INDEX "DeliveryRun_status_nextRetryAt_idx" ON "DeliveryRun"("status", "nextRetryAt");

-- AddForeignKey
ALTER TABLE "DeliveryConfig" ADD CONSTRAINT "DeliveryConfig_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRun" ADD CONSTRAINT "DeliveryRun_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRunLead" ADD CONSTRAINT "DeliveryRunLead_deliveryRunId_fkey" FOREIGN KEY ("deliveryRunId") REFERENCES "DeliveryRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRunLead" ADD CONSTRAINT "DeliveryRunLead_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

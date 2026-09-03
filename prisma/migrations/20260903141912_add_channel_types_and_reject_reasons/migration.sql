-- CreateEnum
CREATE TYPE "MetricMode" AS ENUM ('event', 'aggregate');

-- CreateEnum
CREATE TYPE "PricingUnit" AS ENUM ('CPL', 'CPM', 'CPA', 'flat');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('single', 'multi', 'text', 'boolean', 'date');

-- CreateEnum
CREATE TYPE "RejectReasonCategory" AS ENUM ('dataQuality', 'icpMismatch', 'suppression', 'duplicate', 'consent', 'qualification', 'contactability');

-- CreateTable
CREATE TABLE "FunnelStage" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "funnelStageId" TEXT NOT NULL,
    "producesLeads" BOOLEAN NOT NULL DEFAULT true,
    "requiresAsset" BOOLEAN NOT NULL DEFAULT false,
    "metricMode" "MetricMode" NOT NULL DEFAULT 'event',
    "allowedMetricFieldsJson" JSONB NOT NULL DEFAULT '[]',
    "pricingUnit" "PricingUnit" NOT NULL,
    "defaultQualificationFormId" TEXT,
    "verificationRuleSetId" TEXT,
    "requiresTeleVerification" BOOLEAN NOT NULL DEFAULT false,
    "verificationSlaBusinessDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelTypeVersion" (
    "id" TEXT NOT NULL,
    "channelTypeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelTypeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationForm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationForm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QualificationQuestion" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "type" "QuestionType" NOT NULL,
    "optionsJson" JSONB,
    "isRequired" BOOLEAN NOT NULL DEFAULT true,
    "isQualifying" BOOLEAN NOT NULL DEFAULT false,
    "acceptableAnswersJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QualificationQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectReason" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" "RejectReasonCategory" NOT NULL,
    "isPartnerReplaceable" BOOLEAN NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RejectReason_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FunnelStage_code_key" ON "FunnelStage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelType_code_key" ON "ChannelType"("code");

-- CreateIndex
CREATE INDEX "ChannelType_funnelStageId_idx" ON "ChannelType"("funnelStageId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelTypeVersion_channelTypeId_version_key" ON "ChannelTypeVersion"("channelTypeId", "version");

-- CreateIndex
CREATE INDEX "QualificationQuestion_formId_idx" ON "QualificationQuestion"("formId");

-- CreateIndex
CREATE UNIQUE INDEX "QualificationQuestion_formId_sortOrder_key" ON "QualificationQuestion"("formId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RejectReason_code_key" ON "RejectReason"("code");

-- AddForeignKey
ALTER TABLE "ChannelType" ADD CONSTRAINT "ChannelType_funnelStageId_fkey" FOREIGN KEY ("funnelStageId") REFERENCES "FunnelStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelType" ADD CONSTRAINT "ChannelType_defaultQualificationFormId_fkey" FOREIGN KEY ("defaultQualificationFormId") REFERENCES "QualificationForm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelTypeVersion" ADD CONSTRAINT "ChannelTypeVersion_channelTypeId_fkey" FOREIGN KEY ("channelTypeId") REFERENCES "ChannelType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QualificationQuestion" ADD CONSTRAINT "QualificationQuestion_formId_fkey" FOREIGN KEY ("formId") REFERENCES "QualificationForm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

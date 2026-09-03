-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('matched', 'unmatched', 'ambiguous');

-- CreateTable
CREATE TABLE "TargetAccountList" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isReusable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "TargetAccountList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetAccountEntry" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "rawName" TEXT,
    "rawDomain" TEXT,
    "normalizedDomain" TEXT,
    "accountId" TEXT,
    "matchStatus" "MatchStatus" NOT NULL DEFAULT 'unmatched',
    "candidateAccountIdsJson" JSONB,
    "maxLeadsPerAccountOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetAccountEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTargetAccountList" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignTargetAccountList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetAccountList_ownerOrganizationId_idx" ON "TargetAccountList"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "TargetAccountEntry_listId_matchStatus_idx" ON "TargetAccountEntry"("listId", "matchStatus");

-- CreateIndex
CREATE INDEX "TargetAccountEntry_accountId_idx" ON "TargetAccountEntry"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignTargetAccountList_campaignId_listId_key" ON "CampaignTargetAccountList"("campaignId", "listId");

-- AddForeignKey
ALTER TABLE "TargetAccountEntry" ADD CONSTRAINT "TargetAccountEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TargetAccountList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTargetAccountList" ADD CONSTRAINT "CampaignTargetAccountList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TargetAccountList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

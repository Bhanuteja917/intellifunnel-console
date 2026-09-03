-- CreateEnum
CREATE TYPE "SuppressionListType" AS ENUM ('client', 'competitor', 'existingCustomer', 'prior', 'custom');

-- CreateEnum
CREATE TYPE "SuppressionEntryType" AS ENUM ('account', 'domain', 'email', 'contact');

-- CreateTable
CREATE TABLE "SuppressionList" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isReusable" BOOLEAN NOT NULL DEFAULT true,
    "type" "SuppressionListType" NOT NULL DEFAULT 'custom',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "SuppressionList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuppressionEntry" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "type" "SuppressionEntryType" NOT NULL,
    "value" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "accountId" TEXT,
    "contactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignSuppressionList" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignSuppressionList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SuppressionList_ownerOrganizationId_idx" ON "SuppressionList"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "SuppressionEntry_listId_type_valueHash_idx" ON "SuppressionEntry"("listId", "type", "valueHash");

-- CreateIndex
CREATE UNIQUE INDEX "SuppressionEntry_listId_type_value_key" ON "SuppressionEntry"("listId", "type", "value");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignSuppressionList_campaignId_listId_key" ON "CampaignSuppressionList"("campaignId", "listId");

-- AddForeignKey
ALTER TABLE "SuppressionEntry" ADD CONSTRAINT "SuppressionEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SuppressionList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignSuppressionList" ADD CONSTRAINT "CampaignSuppressionList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SuppressionList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

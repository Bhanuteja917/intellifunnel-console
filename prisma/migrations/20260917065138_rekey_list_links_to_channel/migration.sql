/*
  Warnings:

  - You are about to drop the `CampaignSuppressionList` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CampaignTargetAccountList` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "CampaignSuppressionList" DROP CONSTRAINT "CampaignSuppressionList_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignSuppressionList" DROP CONSTRAINT "CampaignSuppressionList_listId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTargetAccountList" DROP CONSTRAINT "CampaignTargetAccountList_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "CampaignTargetAccountList" DROP CONSTRAINT "CampaignTargetAccountList_listId_fkey";

-- DropTable
DROP TABLE "CampaignSuppressionList";

-- DropTable
DROP TABLE "CampaignTargetAccountList";

-- CreateTable
CREATE TABLE "ChannelTargetAccountList" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelTargetAccountList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelSuppressionList" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelSuppressionList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelTargetAccountList_campaignChannelId_idx" ON "ChannelTargetAccountList"("campaignChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelTargetAccountList_campaignChannelId_listId_key" ON "ChannelTargetAccountList"("campaignChannelId", "listId");

-- CreateIndex
CREATE INDEX "ChannelSuppressionList_campaignChannelId_idx" ON "ChannelSuppressionList"("campaignChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelSuppressionList_campaignChannelId_listId_key" ON "ChannelSuppressionList"("campaignChannelId", "listId");

-- AddForeignKey
ALTER TABLE "ChannelTargetAccountList" ADD CONSTRAINT "ChannelTargetAccountList_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelTargetAccountList" ADD CONSTRAINT "ChannelTargetAccountList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "TargetAccountList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSuppressionList" ADD CONSTRAINT "ChannelSuppressionList_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelSuppressionList" ADD CONSTRAINT "ChannelSuppressionList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "SuppressionList"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

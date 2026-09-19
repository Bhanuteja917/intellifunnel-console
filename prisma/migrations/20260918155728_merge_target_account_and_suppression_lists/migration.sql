-- CreateEnum
CREATE TYPE "ListType" AS ENUM ('targetAccounts', 'suppression');

-- DropForeignKey
ALTER TABLE "ChannelSuppressionList" DROP CONSTRAINT "ChannelSuppressionList_campaignChannelId_fkey";

-- DropForeignKey
ALTER TABLE "ChannelSuppressionList" DROP CONSTRAINT "ChannelSuppressionList_listId_fkey";

-- DropForeignKey
ALTER TABLE "ChannelTargetAccountList" DROP CONSTRAINT "ChannelTargetAccountList_campaignChannelId_fkey";

-- DropForeignKey
ALTER TABLE "ChannelTargetAccountList" DROP CONSTRAINT "ChannelTargetAccountList_listId_fkey";

-- DropForeignKey
ALTER TABLE "SuppressionEntry" DROP CONSTRAINT "SuppressionEntry_listId_fkey";

-- DropForeignKey
ALTER TABLE "TargetAccountEntry" DROP CONSTRAINT "TargetAccountEntry_listId_fkey";

-- DropTable
DROP TABLE "ChannelSuppressionList";

-- DropTable
DROP TABLE "ChannelTargetAccountList";

-- DropTable
DROP TABLE "SuppressionEntry";

-- DropTable
DROP TABLE "SuppressionList";

-- DropTable
DROP TABLE "TargetAccountEntry";

-- DropTable
DROP TABLE "TargetAccountList";

-- DropEnum
DROP TYPE "MatchStatus";

-- DropEnum
DROP TYPE "SuppressionEntryType";

-- DropEnum
DROP TYPE "SuppressionListType";

-- CreateTable
CREATE TABLE "List" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isReusable" BOOLEAN NOT NULL DEFAULT true,
    "type" "ListType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "List_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ListEntry" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "accountName" TEXT,
    "accountRawDomain" TEXT,
    "accountNormalizedDomain" TEXT,
    "maxLeadsPerAccountOverride" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ListEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelList" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelList_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "List_ownerOrganizationId_idx" ON "List"("ownerOrganizationId");

-- CreateIndex
CREATE INDEX "ListEntry_listId_idx" ON "ListEntry"("listId");

-- CreateIndex
CREATE INDEX "ListEntry_accountNormalizedDomain_idx" ON "ListEntry"("accountNormalizedDomain");

-- CreateIndex
CREATE INDEX "ChannelList_campaignChannelId_idx" ON "ChannelList"("campaignChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelList_campaignChannelId_listId_key" ON "ChannelList"("campaignChannelId", "listId");

-- AddForeignKey
ALTER TABLE "ListEntry" ADD CONSTRAINT "ListEntry_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelList" ADD CONSTRAINT "ChannelList_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelList" ADD CONSTRAINT "ChannelList_listId_fkey" FOREIGN KEY ("listId") REFERENCES "List"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


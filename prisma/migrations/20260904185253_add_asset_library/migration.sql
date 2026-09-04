-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('whitepaper', 'ebook', 'researchPaper', 'creative', 'webinar', 'other');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "AssetPlacementStatus" AS ENUM ('draft', 'active', 'paused', 'archived');

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "ownerOrganizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "AssetType" NOT NULL,
    "language" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetVersion" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentTextVersion" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "language" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT,

    CONSTRAINT "ConsentTextVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetPlacement" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "assetVersionId" TEXT NOT NULL,
    "landingPageUrl" TEXT NOT NULL,
    "formSlug" TEXT NOT NULL,
    "consentTextVersionId" TEXT,
    "status" "AssetPlacementStatus" NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "AssetPlacement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Asset_ownerOrganizationId_idx" ON "Asset"("ownerOrganizationId");

-- CreateIndex
CREATE UNIQUE INDEX "AssetVersion_assetId_version_key" ON "AssetVersion"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssetPlacement_formSlug_key" ON "AssetPlacement"("formSlug");

-- CreateIndex
CREATE INDEX "AssetPlacement_campaignChannelId_idx" ON "AssetPlacement"("campaignChannelId");

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerOrganizationId_fkey" FOREIGN KEY ("ownerOrganizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetVersion" ADD CONSTRAINT "AssetVersion_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_assetVersionId_fkey" FOREIGN KEY ("assetVersionId") REFERENCES "AssetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetPlacement" ADD CONSTRAINT "AssetPlacement_consentTextVersionId_fkey" FOREIGN KEY ("consentTextVersionId") REFERENCES "ConsentTextVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

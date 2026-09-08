-- CreateTable
CREATE TABLE "ChannelTermsApproval" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "termsSnapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelTermsApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlacementApproval" (
    "id" TEXT NOT NULL,
    "assetPlacementId" TEXT NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "decidedByUserId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "comments" TEXT,
    "placementSnapshotJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "PlacementApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelTermsApproval_campaignChannelId_decidedAt_idx" ON "ChannelTermsApproval"("campaignChannelId", "decidedAt");

-- CreateIndex
CREATE INDEX "PlacementApproval_assetPlacementId_decidedAt_idx" ON "PlacementApproval"("assetPlacementId", "decidedAt");

-- AddForeignKey
ALTER TABLE "ChannelTermsApproval" ADD CONSTRAINT "ChannelTermsApproval_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlacementApproval" ADD CONSTRAINT "PlacementApproval_assetPlacementId_fkey" FOREIGN KEY ("assetPlacementId") REFERENCES "AssetPlacement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

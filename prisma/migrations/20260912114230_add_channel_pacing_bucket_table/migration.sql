-- CreateTable
CREATE TABLE "ChannelPacingBucket" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "targetQuantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "ChannelPacingBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelPacingBucket_campaignChannelId_idx" ON "ChannelPacingBucket"("campaignChannelId");

-- AddForeignKey
ALTER TABLE "ChannelPacingBucket" ADD CONSTRAINT "ChannelPacingBucket_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

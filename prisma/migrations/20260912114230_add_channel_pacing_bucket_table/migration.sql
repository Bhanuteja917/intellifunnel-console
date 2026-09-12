-- CreateTable
CREATE TABLE "ChannelPacingBucket" (
    "id" TEXT NOT NULL,
    "campaignChannelId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "bucket" INTEGER NOT NULL,
    "targetQuantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelPacingBucket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelPacingBucket_campaignChannelId_date_idx" ON "ChannelPacingBucket"("campaignChannelId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelPacingBucket_campaignChannelId_date_bucket_key" ON "ChannelPacingBucket"("campaignChannelId", "date", "bucket");

-- AddForeignKey
ALTER TABLE "ChannelPacingBucket" ADD CONSTRAINT "ChannelPacingBucket_campaignChannelId_fkey" FOREIGN KEY ("campaignChannelId") REFERENCES "CampaignChannel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

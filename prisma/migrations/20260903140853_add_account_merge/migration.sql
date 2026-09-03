-- CreateTable
CREATE TABLE "AccountMerge" (
    "id" TEXT NOT NULL,
    "sourceAccountId" TEXT NOT NULL,
    "targetAccountId" TEXT NOT NULL,
    "movedJson" JSONB NOT NULL,
    "mergedById" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountMerge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountMerge_sourceAccountId_idx" ON "AccountMerge"("sourceAccountId");

-- CreateIndex
CREATE INDEX "AccountMerge_targetAccountId_idx" ON "AccountMerge"("targetAccountId");

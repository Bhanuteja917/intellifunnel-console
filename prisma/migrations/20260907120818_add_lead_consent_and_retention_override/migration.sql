-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "personalDataRetentionMonths" INTEGER;

-- CreateTable
CREATE TABLE "LeadConsent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "consentTextVersionId" TEXT,
    "acceptedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "sourceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadConsent_leadId_key" ON "LeadConsent"("leadId");

-- AddForeignKey
ALTER TABLE "LeadConsent" ADD CONSTRAINT "LeadConsent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadConsent" ADD CONSTRAINT "LeadConsent_consentTextVersionId_fkey" FOREIGN KEY ("consentTextVersionId") REFERENCES "ConsentTextVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

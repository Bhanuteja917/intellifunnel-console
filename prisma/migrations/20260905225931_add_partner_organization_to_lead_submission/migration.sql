-- AlterTable
ALTER TABLE "LeadSubmission" ADD COLUMN     "partnerOrganizationId" TEXT;

-- CreateIndex
CREATE INDEX "LeadSubmission_partnerOrganizationId_idx" ON "LeadSubmission"("partnerOrganizationId");

-- AddForeignKey
ALTER TABLE "LeadSubmission" ADD CONSTRAINT "LeadSubmission_partnerOrganizationId_fkey" FOREIGN KEY ("partnerOrganizationId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

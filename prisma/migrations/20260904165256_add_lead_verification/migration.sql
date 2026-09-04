-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('auto', 'manual', 'tele');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('pass', 'fail', 'needsReview');

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "acceptedAt" TIMESTAMP(3),
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedToUserId" TEXT,
ADD COLUMN     "rejectedAt" TIMESTAMP(3),
ADD COLUMN     "slaBreached" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "verificationElapsedBusinessMinutes" INTEGER,
ADD COLUMN     "verificationElapsedMinutes" INTEGER;

-- CreateTable
CREATE TABLE "VerificationRecord" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "ruleResultsJson" JSONB,
    "outcome" "VerificationOutcome" NOT NULL,
    "verifiedByUserId" TEXT,
    "callSystem" TEXT,
    "callReferenceId" TEXT,
    "callOccurredAt" TIMESTAMP(3),
    "callDurationSeconds" INTEGER,
    "callRecordingKey" TEXT,
    "notes" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationRecord_leadId_idx" ON "VerificationRecord"("leadId");

-- AddForeignKey
ALTER TABLE "VerificationRecord" ADD CONSTRAINT "VerificationRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

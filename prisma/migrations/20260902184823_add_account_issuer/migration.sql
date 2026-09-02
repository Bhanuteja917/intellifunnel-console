/*
  Warnings:

  - Added the required column `issuer` to the `authAccount` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "authAccount" ADD COLUMN     "issuer" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "authAccount_issuer_accountId_idx" ON "authAccount"("issuer", "accountId");

-- DropForeignKey
ALTER TABLE "Account" DROP CONSTRAINT "Account_mergedIntoId_fkey";

-- DropForeignKey
ALTER TABLE "AccountAlias" DROP CONSTRAINT "AccountAlias_accountId_fkey";

-- DropForeignKey
ALTER TABLE "OrganizationDomain" DROP CONSTRAINT "OrganizationDomain_organizationId_fkey";

-- DropIndex
DROP INDEX "Account_mergedIntoId_idx";

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "mergedIntoId";

-- DropTable
DROP TABLE "AccountAlias";

-- DropTable
DROP TABLE "AccountMerge";

-- DropTable
DROP TABLE "DoNotContact";

-- DropTable
DROP TABLE "ExchangeRate";

-- DropTable
DROP TABLE "Holiday";

-- DropTable
DROP TABLE "OrganizationDomain";

-- DropTable
DROP TABLE "PlatformSetting";

-- DropEnum
DROP TYPE "AliasType";

-- DropEnum
DROP TYPE "DoNotContactType";

-- DropEnum
DROP TYPE "RateSource";


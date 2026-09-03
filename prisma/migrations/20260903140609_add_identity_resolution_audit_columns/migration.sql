-- AlterTable
ALTER TABLE "AccountAlias" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "updatedById" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "updatedById" TEXT;

-- AlterTable
ALTER TABLE "DoNotContact" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "updatedById" TEXT;

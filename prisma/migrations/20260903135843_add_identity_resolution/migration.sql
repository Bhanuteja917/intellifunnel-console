-- CreateEnum
CREATE TYPE "AliasType" AS ENUM ('name', 'domain');

-- CreateEnum
CREATE TYPE "DoNotContactType" AS ENUM ('email', 'domain', 'phone');

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "primaryDomain" TEXT,
    "parentAccountId" TEXT,
    "country" TEXT,
    "industry" TEXT,
    "employeeRange" TEXT,
    "revenueRange" TEXT,
    "enrichmentSource" TEXT,
    "enrichedAt" TIMESTAMP(3),
    "mergedIntoId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,
    "updatedById" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountAlias" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "type" "AliasType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "seniority" TEXT,
    "jobFunction" TEXT,
    "phone" TEXT,
    "country" TEXT,
    "linkedinUrl" TEXT,
    "anonymisedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoNotContact" (
    "id" TEXT NOT NULL,
    "type" "DoNotContactType" NOT NULL,
    "value" TEXT NOT NULL,
    "valueHash" TEXT NOT NULL,
    "clientOrganizationId" TEXT NOT NULL,
    "reason" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoNotContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Account_primaryDomain_key" ON "Account"("primaryDomain");

-- CreateIndex
CREATE INDEX "Account_normalizedName_country_idx" ON "Account"("normalizedName", "country");

-- CreateIndex
CREATE INDEX "Account_mergedIntoId_idx" ON "Account"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "AccountAlias_value_key" ON "AccountAlias"("value");

-- CreateIndex
CREATE INDEX "AccountAlias_accountId_idx" ON "AccountAlias"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_emailNormalized_key" ON "Contact"("emailNormalized");

-- CreateIndex
CREATE INDEX "Contact_accountId_idx" ON "Contact"("accountId");

-- CreateIndex
CREATE INDEX "DoNotContact_clientOrganizationId_type_valueHash_idx" ON "DoNotContact"("clientOrganizationId", "type", "valueHash");

-- CreateIndex
CREATE UNIQUE INDEX "DoNotContact_clientOrganizationId_type_value_key" ON "DoNotContact"("clientOrganizationId", "type", "value");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentAccountId_fkey" FOREIGN KEY ("parentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountAlias" ADD CONSTRAINT "AccountAlias_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

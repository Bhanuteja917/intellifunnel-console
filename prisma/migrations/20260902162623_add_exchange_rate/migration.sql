-- CreateEnum
CREATE TYPE "RateSource" AS ENUM ('manual', 'feed');

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" TEXT NOT NULL,
    "fromCurrency" CHAR(3) NOT NULL,
    "toCurrency" CHAR(3) NOT NULL,
    "rate" DECIMAL(20,10) NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "source" "RateSource" NOT NULL DEFAULT 'manual',
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExchangeRate_fromCurrency_toCurrency_effectiveDate_idx" ON "ExchangeRate"("fromCurrency", "toCurrency", "effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_fromCurrency_toCurrency_effectiveDate_key" ON "ExchangeRate"("fromCurrency", "toCurrency", "effectiveDate");

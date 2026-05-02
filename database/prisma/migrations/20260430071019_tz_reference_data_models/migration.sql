-- CreateEnum
CREATE TYPE "HolidayRegion" AS ENUM ('MAINLAND', 'ZANZIBAR', 'BOTH');

-- CreateEnum
CREATE TYPE "MinimumWageStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "tax_rate_brackets" (
    "id" TEXT NOT NULL,
    "taxRateId" TEXT NOT NULL,
    "tierOrder" INTEGER NOT NULL,
    "fromAmount" DECIMAL(18,2) NOT NULL,
    "toAmount" DECIMAL(18,2),
    "marginalRate" DECIMAL(10,6) NOT NULL,
    "fixedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rate_brackets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_holidays" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "region" "HolidayRegion" NOT NULL DEFAULT 'MAINLAND',
    "name" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "observedDate" DATE,
    "isReligious" BOOLEAN NOT NULL DEFAULT false,
    "religiousDateApprox" BOOLEAN NOT NULL DEFAULT false,
    "recurring" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "public_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "minimum_wage_rules" (
    "id" TEXT NOT NULL,
    "sectorCode" TEXT NOT NULL,
    "sectorName" TEXT NOT NULL,
    "region" "HolidayRegion" NOT NULL DEFAULT 'MAINLAND',
    "monthlyMinimum" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "gazetteRef" TEXT,
    "notes" TEXT,
    "status" "MinimumWageStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "minimum_wage_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tax_rate_brackets_taxRateId_idx" ON "tax_rate_brackets"("taxRateId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rate_brackets_taxRateId_tierOrder_key" ON "tax_rate_brackets"("taxRateId", "tierOrder");

-- CreateIndex
CREATE INDEX "public_holidays_region_date_idx" ON "public_holidays"("region", "date");

-- CreateIndex
CREATE UNIQUE INDEX "public_holidays_region_date_name_key" ON "public_holidays"("region", "date", "name");

-- CreateIndex
CREATE INDEX "minimum_wage_rules_region_status_idx" ON "minimum_wage_rules"("region", "status");

-- CreateIndex
CREATE UNIQUE INDEX "minimum_wage_rules_sectorCode_region_effectiveFrom_key" ON "minimum_wage_rules"("sectorCode", "region", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "tax_rate_brackets" ADD CONSTRAINT "tax_rate_brackets_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

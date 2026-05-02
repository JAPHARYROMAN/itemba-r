-- CreateEnum
CREATE TYPE "EmployeeTaxResidency" AS ENUM ('RESIDENT', 'NON_RESIDENT');

-- CreateEnum
CREATE TYPE "DisabilityStatus" AS ENUM ('NONE', 'REGISTERED', 'REGISTERED_PWD_CERTIFIED');

-- CreateEnum
CREATE TYPE "MobileMoneyProvider" AS ENUM ('M_PESA', 'TIGO_PESA', 'AIRTEL_MONEY', 'HALOPESA', 'EZYPESA', 'T_PESA', 'OTHER');

-- CreateEnum
CREATE TYPE "MobileMoneyAccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PayrollStatutoryBasis" AS ENUM ('GROSS', 'BASIC', 'PENSIONABLE', 'TAXABLE_INCOME', 'CUSTOM');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "dependents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "disabilityCertificateNo" TEXT,
ADD COLUMN     "disabilityStatus" "DisabilityStatus" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "heslbBorrower" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "heslbNumber" TEXT,
ADD COLUMN     "nidaNumber" TEXT,
ADD COLUMN     "passportCountry" TEXT,
ADD COLUMN     "passportNumber" TEXT,
ADD COLUMN     "payrollRegion" "HolidayRegion" NOT NULL DEFAULT 'MAINLAND',
ADD COLUMN     "pssfNumber" TEXT,
ADD COLUMN     "taxResidencyStatus" "EmployeeTaxResidency" NOT NULL DEFAULT 'RESIDENT',
ADD COLUMN     "votersIdNumber" TEXT,
ADD COLUMN     "wcfRegistrationNumber" TEXT;

-- CreateTable
CREATE TABLE "mobile_money_accounts" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "provider" "MobileMoneyProvider" NOT NULL,
    "msisdn" TEXT NOT NULL,
    "accountName" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "MobileMoneyAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "mobile_money_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_statutory_lines" (
    "id" TEXT NOT NULL,
    "payrollEntryId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "statutoryDeductionRuleId" TEXT,
    "taxRateId" TEXT,
    "basis" "PayrollStatutoryBasis" NOT NULL DEFAULT 'GROSS',
    "basisAmount" DECIMAL(18,2) NOT NULL,
    "employeeContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "employerContribution" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "appliedRate" DECIMAL(10,6),
    "calculationDetail" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_statutory_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mobile_money_accounts_employeeId_isPrimary_idx" ON "mobile_money_accounts"("employeeId", "isPrimary");

-- CreateIndex
CREATE INDEX "mobile_money_accounts_provider_idx" ON "mobile_money_accounts"("provider");

-- CreateIndex
CREATE UNIQUE INDEX "mobile_money_accounts_employeeId_provider_msisdn_key" ON "mobile_money_accounts"("employeeId", "provider", "msisdn");

-- CreateIndex
CREATE INDEX "payroll_statutory_lines_payrollEntryId_idx" ON "payroll_statutory_lines"("payrollEntryId");

-- CreateIndex
CREATE INDEX "payroll_statutory_lines_taxTypeId_idx" ON "payroll_statutory_lines"("taxTypeId");

-- CreateIndex
CREATE INDEX "employees_nidaNumber_idx" ON "employees"("nidaNumber");

-- AddForeignKey
ALTER TABLE "mobile_money_accounts" ADD CONSTRAINT "mobile_money_accounts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_statutory_lines" ADD CONSTRAINT "payroll_statutory_lines_payrollEntryId_fkey" FOREIGN KEY ("payrollEntryId") REFERENCES "payroll_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_statutory_lines" ADD CONSTRAINT "payroll_statutory_lines_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_statutory_lines" ADD CONSTRAINT "payroll_statutory_lines_statutoryDeductionRuleId_fkey" FOREIGN KEY ("statutoryDeductionRuleId") REFERENCES "statutory_deduction_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_statutory_lines" ADD CONSTRAINT "payroll_statutory_lines_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

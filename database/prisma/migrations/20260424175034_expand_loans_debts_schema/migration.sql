/*
  Warnings:

  - You are about to drop the column `currentBalance` on the `loans` table. All the data in the column will be lost.
  - Added the required column `outstandingBalance` to the `loans` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ObligationType" AS ENUM ('BANK_LOAN', 'OVERDRAFT', 'SUPPLIER_CREDIT', 'ASSET_FINANCE', 'MORTGAGE', 'DIRECTOR_LOAN', 'INTER_COMPANY_LOAN', 'INSTITUTIONAL_DEBT', 'OTHER');

-- CreateEnum
CREATE TYPE "BorrowerLevel" AS ENUM ('GROUP', 'COMPANY');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterEnum
ALTER TYPE "DebtStatus" ADD VALUE 'PARTIALLY_PAID';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LoanStatus" ADD VALUE 'SETTLED';
ALTER TYPE "LoanStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "RepaymentFrequency" ADD VALUE 'OTHER';

-- AlterTable
ALTER TABLE "debts" ADD COLUMN     "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW';

-- AlterTable
ALTER TABLE "loans" DROP COLUMN "currentBalance",
ADD COLUMN     "borrowerLevel" "BorrowerLevel" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "guaranteeDetails" TEXT,
ADD COLUMN     "linkedAssetIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "obligationType" "ObligationType" NOT NULL DEFAULT 'BANK_LOAN',
ADD COLUMN     "outstandingBalance" DECIMAL(18,2) NOT NULL,
ADD COLUMN     "repaymentAmount" DECIMAL(18,2),
ADD COLUMN     "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "loan_repayments" (
    "id" TEXT NOT NULL,
    "loanId" TEXT NOT NULL,
    "repaymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "principal" DECIMAL(18,2),
    "interest" DECIMAL(18,2),
    "penalties" DECIMAL(18,2),
    "remainingBalance" DECIMAL(18,2),
    "paymentMethod" TEXT,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loan_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_repayments_loanId_idx" ON "loan_repayments"("loanId");

-- CreateIndex
CREATE INDEX "loan_repayments_repaymentDate_idx" ON "loan_repayments"("repaymentDate");

-- CreateIndex
CREATE INDEX "debts_riskLevel_idx" ON "debts"("riskLevel");

-- CreateIndex
CREATE INDEX "loans_groupId_idx" ON "loans"("groupId");

-- CreateIndex
CREATE INDEX "loans_obligationType_idx" ON "loans"("obligationType");

-- CreateIndex
CREATE INDEX "loans_riskLevel_idx" ON "loans"("riskLevel");

-- CreateIndex
CREATE INDEX "loans_maturityDate_idx" ON "loans"("maturityDate");

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

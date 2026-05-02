/*
  Warnings:

  - The values [LEASE,LOAN] on the enum `ContractType` will be removed. If these variants are still used in the database, this will fail.

*/
-- CreateEnum
CREATE TYPE "ContractOwnershipLevel" AS ENUM ('GROUP', 'COMPANY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ContractStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "ContractStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
BEGIN;
CREATE TYPE "ContractType_new" AS ENUM ('SUPPLIER', 'CUSTOMER', 'TRANSPORT', 'CONSTRUCTION', 'FARM_LEASE', 'LAND_AGREEMENT', 'RENTAL', 'EMPLOYMENT', 'LOAN_AGREEMENT', 'INSURANCE', 'SERVICE', 'MAINTENANCE', 'PARTNERSHIP', 'DISTRIBUTION', 'GOVERNMENT_INSTITUTIONAL', 'LEGAL_SETTLEMENT', 'OTHER');
ALTER TABLE "contracts" ALTER COLUMN "contractType" TYPE "ContractType_new" USING ("contractType"::text::"ContractType_new");
ALTER TYPE "ContractType" RENAME TO "ContractType_old";
ALTER TYPE "ContractType_new" RENAME TO "ContractType";
DROP TYPE "ContractType_old";
COMMIT;

-- AlterTable
ALTER TABLE "contracts" ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "divisionId" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "isSensitive" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "obligations" TEXT,
ADD COLUMN     "owningLevel" "ContractOwnershipLevel" NOT NULL DEFAULT 'COMPANY',
ADD COLUMN     "paymentTerms" TEXT,
ADD COLUMN     "renewalDate" TIMESTAMP(3),
ADD COLUMN     "responsiblePersonId" TEXT,
ADD COLUMN     "riskLevel" "RiskLevel" NOT NULL DEFAULT 'LOW',
ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "contracts_groupId_idx" ON "contracts"("groupId");

-- CreateIndex
CREATE INDEX "contracts_riskLevel_idx" ON "contracts"("riskLevel");

-- CreateIndex
CREATE INDEX "contracts_owningLevel_idx" ON "contracts"("owningLevel");

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

/*
  Warnings:

  - A unique constraint covering the columns `[assetCode]` on the table `fixed_assets` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "AssetOwnershipLevel" AS ENUM ('GROUP', 'COMPANY');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'BEYOND_REPAIR');

-- CreateEnum
CREATE TYPE "AssetFinancingStatus" AS ENUM ('OWNED_OUTRIGHT', 'FINANCED', 'LEASED', 'HIRE_PURCHASE');

-- CreateEnum
CREATE TYPE "AssetCollateralStatus" AS ENUM ('NOT_COLLATERAL', 'USED_AS_COLLATERAL', 'PARTIALLY_COLLATERAL');

-- CreateEnum
CREATE TYPE "AssetInsuranceStatus" AS ENUM ('INSURED', 'NOT_INSURED', 'EXPIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FixedAssetCategory" ADD VALUE 'TRUCK';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'MACHINERY';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'EQUIPMENT';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'IT_ASSET';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'TOOLS';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'FUEL_TANK';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'FUEL_PUMP';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'AGRICULTURE_EQUIPMENT';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'CONSTRUCTION_EQUIPMENT';
ALTER TYPE "FixedAssetCategory" ADD VALUE 'INTANGIBLE';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "FixedAssetStatus" ADD VALUE 'SOLD';
ALTER TYPE "FixedAssetStatus" ADD VALUE 'LOST';

-- DropIndex
DROP INDEX "fixed_assets_companyId_assetCode_key";

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "collateralStatus" "AssetCollateralStatus" NOT NULL DEFAULT 'NOT_COLLATERAL',
ADD COLUMN     "condition" "AssetCondition",
ADD COLUMN     "divisionId" TEXT,
ADD COLUMN     "financingStatus" "AssetFinancingStatus" NOT NULL DEFAULT 'OWNED_OUTRIGHT',
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "insuranceStatus" "AssetInsuranceStatus" NOT NULL DEFAULT 'NOT_INSURED',
ADD COLUMN     "ownershipLevel" "AssetOwnershipLevel" NOT NULL DEFAULT 'COMPANY',
ALTER COLUMN "companyId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_assetCode_key" ON "fixed_assets"("assetCode");

-- CreateIndex
CREATE INDEX "fixed_assets_groupId_idx" ON "fixed_assets"("groupId");

-- CreateIndex
CREATE INDEX "fixed_assets_divisionId_idx" ON "fixed_assets"("divisionId");

-- CreateIndex
CREATE INDEX "fixed_assets_collateralStatus_idx" ON "fixed_assets"("collateralStatus");

-- CreateIndex
CREATE INDEX "fixed_assets_insuranceStatus_idx" ON "fixed_assets"("insuranceStatus");

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

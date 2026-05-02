/*
  Warnings:

  - The values [STATION] on the enum `BranchType` will be removed. If these variants are still used in the database, this will fail.
  - The values [FUEL_RETAIL,BEVERAGES_ALCOHOLIC,BEVERAGES_NON_ALCOHOLIC] on the enum `DivisionType` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `entity` on the `audit_logs` table. All the data in the column will be lost.
  - You are about to drop the column `address` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `registrationNumber` on the `companies` table. All the data in the column will be lost.
  - You are about to drop the column `tin` on the `companies` table. All the data in the column will be lost.
  - The primary key for the `user_roles` table will be changed. If it partially fails, the table could be left without primary key constraint.
  - You are about to drop the column `isActive` on the `users` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[storageKey]` on the table `documents` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,roleId]` on the table `user_roles` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `entityType` to the `audit_logs` table without a default value. This is not possible if the table is not empty.
  - Added the required column `fileName` to the `documents` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `ownerType` on the `documents` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.
  - Made the column `mimeType` on table `documents` required. This step will fail if there are existing NULL values in that column.
  - Made the column `code` on table `groups` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `action` to the `permissions` table without a default value. This is not possible if the table is not empty.
  - Made the column `module` on table `permissions` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `displayName` to the `roles` table without a default value. This is not possible if the table is not empty.
  - The required column `id` was added to the `user_roles` table with a prisma-level default value. This is not possible if the table is not empty. Please add this column as optional, then populate it before making it required.
  - Made the column `fullName` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'DORMANT', 'SUSPENDED', 'DISSOLVED');

-- CreateEnum
CREATE TYPE "AccessLevel" AS ENUM ('READ', 'WRITE', 'MANAGE');

-- CreateEnum
CREATE TYPE "CurrencyCode" AS ENUM ('TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX');

-- CreateEnum
CREATE TYPE "BankAccountType" AS ENUM ('CURRENT', 'SAVINGS', 'FIXED_DEPOSIT', 'OVERDRAFT');

-- CreateEnum
CREATE TYPE "LoanStatus" AS ENUM ('ACTIVE', 'FULLY_PAID', 'DEFAULTED', 'WRITTEN_OFF', 'RESTRUCTURED');

-- CreateEnum
CREATE TYPE "RepaymentFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUALLY', 'ANNUALLY', 'BULLET');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('OUTSTANDING', 'PAID', 'DISPUTED', 'WRITTEN_OFF', 'RESTRUCTURED');

-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('SUPPLIER', 'CUSTOMER', 'EMPLOYMENT', 'LEASE', 'PARTNERSHIP', 'LOAN', 'SERVICE', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'SUSPENDED', 'PENDING_RENEWAL');

-- CreateEnum
CREATE TYPE "FixedAssetCategory" AS ENUM ('LAND', 'BUILDING', 'VEHICLE', 'PLANT_MACHINERY', 'FURNITURE_FITTINGS', 'COMPUTER_EQUIPMENT', 'OFFICE_EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "FixedAssetStatus" AS ENUM ('ACTIVE', 'DISPOSED', 'WRITTEN_OFF', 'TRANSFERRED', 'UNDER_MAINTENANCE');

-- CreateEnum
CREATE TYPE "DocumentOwnerType" AS ENUM ('GROUP', 'COMPANY', 'DIVISION', 'BRANCH', 'BANK_ACCOUNT', 'LOAN', 'DEBT', 'CONTRACT', 'FIXED_ASSET', 'EMPLOYEE', 'SUPPLIER', 'CUSTOMER', 'TRANSACTION');

-- AlterEnum
BEGIN;
CREATE TYPE "BranchType_new" AS ENUM ('BRANCH', 'SITE', 'PROJECT', 'FARM', 'WAREHOUSE', 'FUEL_STATION', 'OFFICE', 'OTHER');
ALTER TABLE "branches" ALTER COLUMN "type" TYPE "BranchType_new" USING ("type"::text::"BranchType_new");
ALTER TYPE "BranchType" RENAME TO "BranchType_old";
ALTER TYPE "BranchType_new" RENAME TO "BranchType";
DROP TYPE "BranchType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "DivisionType_new" AS ENUM ('PETROLEUM', 'LOGISTICS', 'AGRICULTURE', 'CONSTRUCTION', 'BEVERAGES', 'HARDWARE_BUILDING', 'OTHER');
ALTER TABLE "divisions" ALTER COLUMN "type" TYPE "DivisionType_new" USING ("type"::text::"DivisionType_new");
ALTER TYPE "DivisionType" RENAME TO "DivisionType_old";
ALTER TYPE "DivisionType_new" RENAME TO "DivisionType";
DROP TYPE "DivisionType_old";
COMMIT;

-- DropIndex
DROP INDEX "audit_logs_entity_entityId_idx";

-- DropIndex
DROP INDEX "companies_registrationNumber_key";

-- DropIndex
DROP INDEX "companies_tin_key";

-- AlterTable
ALTER TABLE "audit_logs" DROP COLUMN "entity",
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "entityType" TEXT NOT NULL,
ADD COLUMN     "newValue" JSONB,
ADD COLUMN     "oldValue" JSONB,
ADD COLUMN     "userAgent" TEXT;

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "address" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "phone" TEXT;

-- AlterTable
ALTER TABLE "companies" DROP COLUMN "address",
DROP COLUMN "registrationNumber",
DROP COLUMN "tin",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "email" TEXT,
ADD COLUMN     "logoUrl" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "website" TEXT;

-- AlterTable
ALTER TABLE "divisions" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "bankAccountId" TEXT,
ADD COLUMN     "branchId" TEXT,
ADD COLUMN     "contractId" TEXT,
ADD COLUMN     "debtId" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "divisionId" TEXT,
ADD COLUMN     "fileName" TEXT NOT NULL,
ADD COLUMN     "fileSizeBytes" INTEGER,
ADD COLUMN     "fixedAssetId" TEXT,
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "isConfidential" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loanId" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
DROP COLUMN "ownerType",
ADD COLUMN     "ownerType" "DocumentOwnerType" NOT NULL,
ALTER COLUMN "mimeType" SET NOT NULL;

-- AlterTable
ALTER TABLE "groups" ADD COLUMN     "address" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "website" TEXT,
ALTER COLUMN "code" SET NOT NULL;

-- AlterTable
ALTER TABLE "permissions" ADD COLUMN     "action" TEXT NOT NULL,
ADD COLUMN     "isGroupControl" BOOLEAN NOT NULL DEFAULT false,
ALTER COLUMN "module" SET NOT NULL;

-- AlterTable
ALTER TABLE "roles" ADD COLUMN     "displayName" TEXT NOT NULL,
ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_roles" DROP CONSTRAINT "user_roles_pkey",
ADD COLUMN     "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "assignedById" TEXT,
ADD COLUMN     "id" TEXT NOT NULL,
ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "users" DROP COLUMN "isActive",
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "phoneNumber" TEXT,
ADD COLUMN     "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN     "title" TEXT,
ALTER COLUMN "fullName" SET NOT NULL;

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "registeredName" TEXT NOT NULL,
    "tradingName" TEXT,
    "brelaRegNumber" TEXT NOT NULL,
    "tin" TEXT NOT NULL,
    "vrn" TEXT,
    "businessLicenseNumber" TEXT,
    "incorporationDate" TIMESTAMP(3),
    "registeredAddress" TEXT NOT NULL,
    "postalAddress" TEXT,
    "taxOffice" TEXT,
    "natureOfBusiness" TEXT,
    "authorizedCapital" DECIMAL(18,2),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_company_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'READ',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,

    CONSTRAINT "user_company_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_division_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'READ',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,

    CONSTRAINT "user_division_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "accessLevel" "AccessLevel" NOT NULL DEFAULT 'READ',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "grantedById" TEXT,

    CONSTRAINT "user_branch_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT,
    "groupId" TEXT,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT,
    "accountName" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "accountType" "BankAccountType" NOT NULL DEFAULT 'CURRENT',
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "openedDate" TIMESTAMP(3),
    "swiftCode" TEXT,
    "bankAddress" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loans" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "loanReference" TEXT,
    "lenderName" TEXT NOT NULL,
    "lenderType" TEXT,
    "lenderContact" TEXT,
    "principalAmount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "interestRate" DECIMAL(6,4) NOT NULL,
    "disbursementDate" TIMESTAMP(3) NOT NULL,
    "maturityDate" TIMESTAMP(3) NOT NULL,
    "repaymentFrequency" "RepaymentFrequency" NOT NULL DEFAULT 'MONTHLY',
    "currentBalance" DECIMAL(18,2) NOT NULL,
    "status" "LoanStatus" NOT NULL DEFAULT 'ACTIVE',
    "purpose" TEXT,
    "collateralDescription" TEXT,
    "guarantorName" TEXT,
    "guarantorContact" TEXT,
    "bankAccountId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "creditorName" TEXT NOT NULL,
    "creditorContact" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "dueDate" TIMESTAMP(3),
    "description" TEXT NOT NULL,
    "invoiceNumber" TEXT,
    "status" "DebtStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "notes" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contractType" "ContractType" NOT NULL,
    "contractNumber" TEXT,
    "counterpartyName" TEXT NOT NULL,
    "counterpartyContact" TEXT,
    "counterpartyAddress" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "value" DECIMAL(18,2),
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "renewalNoticeDate" TIMESTAMP(3),
    "autoRenews" BOOLEAN NOT NULL DEFAULT false,
    "signatoryUserId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fixed_assets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "FixedAssetCategory" NOT NULL,
    "description" TEXT,
    "acquisitionDate" TIMESTAMP(3) NOT NULL,
    "acquisitionCost" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "currentBookValue" DECIMAL(18,2) NOT NULL,
    "depreciationRate" DECIMAL(6,4),
    "usefulLifeYears" INTEGER,
    "residualValue" DECIMAL(18,2),
    "serialNumber" TEXT,
    "make" TEXT,
    "model" TEXT,
    "registrationNo" TEXT,
    "location" TEXT,
    "status" "FixedAssetStatus" NOT NULL DEFAULT 'ACTIVE',
    "disposalDate" TIMESTAMP(3),
    "disposalValue" DECIMAL(18,2),
    "notes" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_companyId_key" ON "company_profiles"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_brelaRegNumber_key" ON "company_profiles"("brelaRegNumber");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_tin_key" ON "company_profiles"("tin");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_vrn_key" ON "company_profiles"("vrn");

-- CreateIndex
CREATE INDEX "user_company_access_companyId_idx" ON "user_company_access"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "user_company_access_userId_companyId_key" ON "user_company_access"("userId", "companyId");

-- CreateIndex
CREATE INDEX "user_division_access_divisionId_idx" ON "user_division_access"("divisionId");

-- CreateIndex
CREATE UNIQUE INDEX "user_division_access_userId_divisionId_key" ON "user_division_access"("userId", "divisionId");

-- CreateIndex
CREATE INDEX "user_branch_access_branchId_idx" ON "user_branch_access"("branchId");

-- CreateIndex
CREATE UNIQUE INDEX "user_branch_access_userId_branchId_key" ON "user_branch_access"("userId", "branchId");

-- CreateIndex
CREATE INDEX "bank_accounts_companyId_idx" ON "bank_accounts"("companyId");

-- CreateIndex
CREATE INDEX "bank_accounts_groupId_idx" ON "bank_accounts"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_bankName_accountNumber_key" ON "bank_accounts"("bankName", "accountNumber");

-- CreateIndex
CREATE INDEX "loans_companyId_idx" ON "loans"("companyId");

-- CreateIndex
CREATE INDEX "loans_status_idx" ON "loans"("status");

-- CreateIndex
CREATE INDEX "debts_companyId_idx" ON "debts"("companyId");

-- CreateIndex
CREATE INDEX "debts_status_idx" ON "debts"("status");

-- CreateIndex
CREATE INDEX "debts_dueDate_idx" ON "debts"("dueDate");

-- CreateIndex
CREATE INDEX "contracts_companyId_idx" ON "contracts"("companyId");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "contracts_contractType_idx" ON "contracts"("contractType");

-- CreateIndex
CREATE INDEX "contracts_endDate_idx" ON "contracts"("endDate");

-- CreateIndex
CREATE INDEX "fixed_assets_companyId_idx" ON "fixed_assets"("companyId");

-- CreateIndex
CREATE INDEX "fixed_assets_branchId_idx" ON "fixed_assets"("branchId");

-- CreateIndex
CREATE INDEX "fixed_assets_category_idx" ON "fixed_assets"("category");

-- CreateIndex
CREATE INDEX "fixed_assets_status_idx" ON "fixed_assets"("status");

-- CreateIndex
CREATE UNIQUE INDEX "fixed_assets_companyId_assetCode_key" ON "fixed_assets"("companyId", "assetCode");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_idx" ON "audit_logs"("companyId");

-- CreateIndex
CREATE INDEX "companies_status_idx" ON "companies"("status");

-- CreateIndex
CREATE INDEX "divisions_type_idx" ON "divisions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storageKey_key" ON "documents"("storageKey");

-- CreateIndex
CREATE INDEX "documents_ownerType_ownerId_idx" ON "documents"("ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "documents_isConfidential_idx" ON "documents"("isConfidential");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "permissions"("module");

-- CreateIndex
CREATE INDEX "permissions_isGroupControl_idx" ON "permissions"("isGroupControl");

-- CreateIndex
CREATE INDEX "roles_scope_idx" ON "roles"("scope");

-- CreateIndex
CREATE INDEX "user_roles_userId_idx" ON "user_roles"("userId");

-- CreateIndex
CREATE INDEX "user_roles_roleId_idx" ON "user_roles"("roleId");

-- CreateIndex
CREATE UNIQUE INDEX "user_roles_userId_roleId_key" ON "user_roles"("userId", "roleId");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- AddForeignKey
ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_company_access" ADD CONSTRAINT "user_company_access_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_division_access" ADD CONSTRAINT "user_division_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_division_access" ADD CONSTRAINT "user_division_access_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch_access" ADD CONSTRAINT "user_branch_access_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_debtId_fkey" FOREIGN KEY ("debtId") REFERENCES "debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

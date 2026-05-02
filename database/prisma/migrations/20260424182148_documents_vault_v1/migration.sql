/*
  Warnings:

  - A unique constraint covering the columns `[documentCode]` on the table `documents` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('COMPANY_REGISTRATION', 'BRELA_DOCUMENT', 'TIN_CERTIFICATE', 'VRN_CERTIFICATE', 'BUSINESS_LICENSE', 'TAX_CLEARANCE', 'BANK_DOCUMENT', 'LOAN_DOCUMENT', 'DEBT_DOCUMENT', 'CONTRACT', 'INSURANCE_POLICY', 'VEHICLE_LOGBOOK', 'LAND_TITLE_DEED', 'LEASE_AGREEMENT', 'BOARD_RESOLUTION', 'PERMIT', 'INVOICE', 'RECEIPT', 'SUPPLIER_STATEMENT', 'CUSTOMER_AGREEMENT', 'PAYROLL_DOCUMENT', 'EMPLOYMENT_CONTRACT', 'AUDIT_FILE', 'LEGAL_CORRESPONDENCE', 'COURT_DOCUMENT', 'CONSTRUCTION_PERMIT', 'AGRICULTURE_PERMIT', 'IMPORT_EXPORT_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'PENDING_RENEWAL', 'ARCHIVED', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "category" "DocumentCategory" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "documentCode" TEXT,
ADD COLUMN     "expiryDate" TIMESTAMP(3),
ADD COLUMN     "renewalDate" TIMESTAMP(3),
ADD COLUMN     "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE UNIQUE INDEX "documents_documentCode_key" ON "documents"("documentCode");

-- CreateIndex
CREATE INDEX "documents_category_idx" ON "documents"("category");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_expiryDate_idx" ON "documents"("expiryDate");

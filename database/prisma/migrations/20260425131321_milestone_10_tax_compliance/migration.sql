-- CreateEnum
CREATE TYPE "TaxAuthorityType" AS ENUM ('TAX', 'COMPANY_REGISTRY', 'LOCAL_GOVERNMENT', 'LICENSING_AUTHORITY', 'SOCIAL_SECURITY', 'HEALTH_INSURANCE', 'SECTOR_REGULATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxAuthorityStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TaxRegistrationType" AS ENUM ('TIN', 'VRN', 'PAYE', 'SDL', 'WHT', 'VAT', 'INCOME_TAX', 'LOCAL_LEVY', 'BUSINESS_LICENSE_TAX', 'SOCIAL_SECURITY', 'HEALTH_INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxRegistrationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaxCategory" AS ENUM ('VAT', 'SALES_TAX', 'WITHHOLDING_TAX', 'PAYROLL_TAX', 'INCOME_TAX', 'SERVICE_LEVY', 'EXCISE', 'LOCAL_LEVY', 'IMPORT_DUTY', 'CUSTOMS', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxRateCalculationMethod" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT', 'TIERED', 'EXEMPT', 'ZERO_RATED');

-- CreateEnum
CREATE TYPE "TaxRateStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TaxCodeAppliesTo" AS ENUM ('SALES', 'PURCHASES', 'EXPENSES', 'PAYROLL', 'GENERAL');

-- CreateEnum
CREATE TYPE "TaxCodeStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TaxTransactionSourceType" AS ENUM ('SALES_ORDER', 'POS_TRANSACTION', 'PURCHASE_ORDER', 'EXPENSE', 'PAYROLL_RUN', 'PAYROLL_ENTRY', 'RENT_INVOICE', 'PARKING_SESSION', 'ROOM_BOOKING', 'RESTAURANT_ORDER', 'PROJECT_BILLING', 'JOURNAL_ENTRY', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxTransactionDirection" AS ENUM ('OUTPUT', 'INPUT', 'WITHHELD', 'PAYABLE', 'RECOVERABLE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "TaxTransactionStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaxFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaxFilingPeriodStatus" AS ENUM ('OPEN', 'PREPARED', 'SUBMITTED', 'PAID', 'CLOSED', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaxReturnStatus" AS ENUM ('DRAFT', 'PREPARED', 'REVIEWED', 'APPROVED', 'SUBMITTED', 'PAID', 'CLOSED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComplianceObligationType" AS ENUM ('TAX_FILING', 'TAX_PAYMENT', 'BRELA_ANNUAL_RETURN', 'BUSINESS_LICENSE_RENEWAL', 'SECTOR_LICENSE_RENEWAL', 'PAYROLL_STATUTORY_SUBMISSION', 'INSURANCE_RENEWAL', 'VEHICLE_LICENSE_RENEWAL', 'HEALTH_PERMIT_RENEWAL', 'FIRE_CERTIFICATE_RENEWAL', 'CONTRACT_RENEWAL', 'DOCUMENT_RENEWAL', 'AUDIT_REQUIREMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplianceObligationRecurrence" AS ENUM ('NONE', 'MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CompliancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ComplianceObligationStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'WAIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ComplianceEventType" AS ENUM ('REMINDER', 'SUBMISSION', 'PAYMENT', 'RENEWAL', 'APPROVAL', 'REJECTION', 'COMMENT', 'ESCALATION', 'OTHER');

-- CreateEnum
CREATE TYPE "StatutoryDeductionCalcMethod" AS ENUM ('FIXED_AMOUNT', 'PERCENTAGE_OF_GROSS', 'PERCENTAGE_OF_BASIC', 'TIERED', 'MANUAL');

-- CreateEnum
CREATE TYPE "StatutoryDeductionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ComplianceDocReqType" AS ENUM ('COMPANY', 'LICENSE', 'TAX', 'HR', 'PAYROLL', 'ASSET', 'VEHICLE', 'PROPERTY', 'CONTRACT', 'PROJECT', 'HOSPITALITY', 'PETROLEUM', 'PARKING', 'OTHER');

-- CreateEnum
CREATE TYPE "ComplianceDocStatusEnum" AS ENUM ('MISSING', 'AVAILABLE', 'EXPIRED', 'EXPIRING_SOON', 'WAIVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "AuditEvidencePackType" AS ENUM ('TAX_AUDIT', 'FINANCIAL_AUDIT', 'PAYROLL_AUDIT', 'LICENSE_RENEWAL', 'BRELA_COMPLIANCE', 'INTERNAL_AUDIT', 'BANK_REVIEW', 'LOAN_REVIEW', 'LEGAL_REVIEW', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditEvidencePackStatus" AS ENUM ('DRAFT', 'PREPARING', 'READY', 'REVIEWED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditEvidencePackItemType" AS ENUM ('DOCUMENT', 'REPORT', 'TRANSACTION', 'CONTRACT', 'LICENSE', 'TAX_RETURN', 'PAYROLL_RUN', 'FINANCIAL_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DataExportType" AS ENUM ('TAX_REPORT', 'FINANCIAL_REPORT', 'PAYROLL_REPORT', 'HR_REPORT', 'SALES_REPORT', 'PURCHASE_REPORT', 'INVENTORY_REPORT', 'COMPLIANCE_REPORT', 'AUDIT_EVIDENCE_PACK', 'DOCUMENT_EXPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DataExportStatus" AS ENUM ('REQUESTED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "tax_authorities" (
    "id" TEXT NOT NULL,
    "authorityCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "region" TEXT,
    "authorityType" "TaxAuthorityType" NOT NULL DEFAULT 'TAX',
    "website" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "address" TEXT,
    "status" "TaxAuthorityStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_authorities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_tax_registrations" (
    "id" TEXT NOT NULL,
    "registrationCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "authorityId" TEXT,
    "registrationType" "TaxRegistrationType" NOT NULL DEFAULT 'TIN',
    "registrationNumber" TEXT NOT NULL,
    "registeredName" TEXT,
    "registrationDate" TIMESTAMP(3),
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "status" "TaxRegistrationStatus" NOT NULL DEFAULT 'ACTIVE',
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "company_tax_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_types" (
    "id" TEXT NOT NULL,
    "taxTypeCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taxCategory" "TaxCategory" NOT NULL DEFAULT 'OTHER',
    "description" TEXT,
    "isRecoverable" BOOLEAN NOT NULL DEFAULT false,
    "isWithholding" BOOLEAN NOT NULL DEFAULT false,
    "appliesToSales" BOOLEAN NOT NULL DEFAULT false,
    "appliesToPurchases" BOOLEAN NOT NULL DEFAULT false,
    "appliesToPayroll" BOOLEAN NOT NULL DEFAULT false,
    "appliesToExpenses" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "companyId" TEXT,
    "rateName" TEXT NOT NULL,
    "rate" DECIMAL(10,4) NOT NULL,
    "calculationMethod" "TaxRateCalculationMethod" NOT NULL DEFAULT 'PERCENTAGE',
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "TaxRateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "taxCode" TEXT NOT NULL,
    "companyId" TEXT,
    "taxTypeId" TEXT NOT NULL,
    "taxRateId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "appliesTo" "TaxCodeAppliesTo" NOT NULL DEFAULT 'GENERAL',
    "accountId" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_transactions" (
    "id" TEXT NOT NULL,
    "taxTransactionNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "taxCodeId" TEXT,
    "taxRateId" TEXT,
    "sourceType" "TaxTransactionSourceType" NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "taxableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "direction" "TaxTransactionDirection" NOT NULL DEFAULT 'OUTPUT',
    "status" "TaxTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "journalEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_filing_periods" (
    "id" TEXT NOT NULL,
    "filingPeriodCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "filingFrequency" "TaxFilingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "status" "TaxFilingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "preparedById" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_filing_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_returns" (
    "id" TEXT NOT NULL,
    "taxReturnNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "taxFilingPeriodId" TEXT NOT NULL,
    "taxTypeId" TEXT NOT NULL,
    "grossAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxPayable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxRecoverable" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "netTaxDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "penalties" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "interest" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "TaxReturnStatus" NOT NULL DEFAULT 'DRAFT',
    "submissionReference" TEXT,
    "submissionDate" TIMESTAMP(3),
    "paymentReference" TEXT,
    "paymentDate" TIMESTAMP(3),
    "documentId" TEXT,
    "preparedById" TEXT,
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "submittedById" TEXT,
    "paidById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tax_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_obligations" (
    "id" TEXT NOT NULL,
    "obligationCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "authorityId" TEXT,
    "obligationType" "ComplianceObligationType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "recurrence" "ComplianceObligationRecurrence" NOT NULL DEFAULT 'NONE',
    "priority" "CompliancePriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ComplianceObligationStatus" NOT NULL DEFAULT 'UPCOMING',
    "responsibleUserId" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "documentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "compliance_obligations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_events" (
    "id" TEXT NOT NULL,
    "eventNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "complianceObligationId" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "eventType" "ComplianceEventType" NOT NULL DEFAULT 'COMMENT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdById" TEXT NOT NULL,
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "compliance_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "statutory_deduction_rules" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "companyId" TEXT,
    "deductionTypeId" TEXT,
    "taxTypeId" TEXT,
    "name" TEXT NOT NULL,
    "calculationMethod" "StatutoryDeductionCalcMethod" NOT NULL DEFAULT 'PERCENTAGE_OF_GROSS',
    "rate" DECIMAL(10,4),
    "amount" DECIMAL(18,2),
    "employerContributionRate" DECIMAL(10,4),
    "employeeContributionRate" DECIMAL(10,4),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "status" "StatutoryDeductionStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "statutory_deduction_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_document_requirements" (
    "id" TEXT NOT NULL,
    "requirementCode" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "requirementType" "ComplianceDocReqType" NOT NULL DEFAULT 'COMPANY',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "documentCategory" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "expiryRequired" BOOLEAN NOT NULL DEFAULT false,
    "renewalRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "TaxCodeStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "compliance_document_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compliance_document_statuses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requirementId" TEXT NOT NULL,
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "documentId" TEXT,
    "status" "ComplianceDocStatusEnum" NOT NULL DEFAULT 'MISSING',
    "expiryDate" TIMESTAMP(3),
    "renewalDate" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "compliance_document_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_evidence_packs" (
    "id" TEXT NOT NULL,
    "evidencePackNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "packType" "AuditEvidencePackType" NOT NULL DEFAULT 'OTHER',
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "status" "AuditEvidencePackStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "audit_evidence_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_evidence_pack_items" (
    "id" TEXT NOT NULL,
    "evidencePackId" TEXT NOT NULL,
    "itemType" "AuditEvidencePackItemType" NOT NULL DEFAULT 'DOCUMENT',
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "documentId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_evidence_pack_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_export_logs" (
    "id" TEXT NOT NULL,
    "exportNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "exportedById" TEXT NOT NULL,
    "exportType" "DataExportType" NOT NULL DEFAULT 'OTHER',
    "filters" JSONB,
    "fileName" TEXT,
    "filePath" TEXT,
    "status" "DataExportStatus" NOT NULL DEFAULT 'REQUESTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "data_export_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_authorities_authorityCode_key" ON "tax_authorities"("authorityCode");

-- CreateIndex
CREATE INDEX "company_tax_registrations_registrationNumber_idx" ON "company_tax_registrations"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "company_tax_registrations_companyId_registrationCode_key" ON "company_tax_registrations"("companyId", "registrationCode");

-- CreateIndex
CREATE UNIQUE INDEX "tax_types_taxTypeCode_key" ON "tax_types"("taxTypeCode");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_taxCode_companyId_key" ON "tax_codes"("taxCode", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_transactions_companyId_taxTransactionNumber_key" ON "tax_transactions"("companyId", "taxTransactionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tax_filing_periods_companyId_filingPeriodCode_key" ON "tax_filing_periods"("companyId", "filingPeriodCode");

-- CreateIndex
CREATE UNIQUE INDEX "tax_returns_companyId_taxReturnNumber_key" ON "tax_returns"("companyId", "taxReturnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_obligations_companyId_obligationCode_key" ON "compliance_obligations"("companyId", "obligationCode");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_events_companyId_eventNumber_key" ON "compliance_events"("companyId", "eventNumber");

-- CreateIndex
CREATE UNIQUE INDEX "statutory_deduction_rules_ruleCode_key" ON "statutory_deduction_rules"("ruleCode");

-- CreateIndex
CREATE UNIQUE INDEX "compliance_document_requirements_requirementCode_companyId_key" ON "compliance_document_requirements"("requirementCode", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_evidence_packs_companyId_evidencePackNumber_key" ON "audit_evidence_packs"("companyId", "evidencePackNumber");

-- AddForeignKey
ALTER TABLE "company_tax_registrations" ADD CONSTRAINT "company_tax_registrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_tax_registrations" ADD CONSTRAINT "company_tax_registrations_authorityId_fkey" FOREIGN KEY ("authorityId") REFERENCES "tax_authorities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_taxCodeId_fkey" FOREIGN KEY ("taxCodeId") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_taxRateId_fkey" FOREIGN KEY ("taxRateId") REFERENCES "tax_rates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_periods" ADD CONSTRAINT "tax_filing_periods_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_periods" ADD CONSTRAINT "tax_filing_periods_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_periods" ADD CONSTRAINT "tax_filing_periods_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_periods" ADD CONSTRAINT "tax_filing_periods_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_periods" ADD CONSTRAINT "tax_filing_periods_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_filing_periods" ADD CONSTRAINT "tax_filing_periods_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_taxFilingPeriodId_fkey" FOREIGN KEY ("taxFilingPeriodId") REFERENCES "tax_filing_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_returns" ADD CONSTRAINT "tax_returns_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_obligations_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_complianceObligationId_fkey" FOREIGN KEY ("complianceObligationId") REFERENCES "compliance_obligations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_events" ADD CONSTRAINT "compliance_events_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "statutory_deduction_rules" ADD CONSTRAINT "statutory_deduction_rules_taxTypeId_fkey" FOREIGN KEY ("taxTypeId") REFERENCES "tax_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_document_requirements" ADD CONSTRAINT "compliance_document_requirements_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_document_statuses" ADD CONSTRAINT "compliance_document_statuses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "compliance_document_statuses" ADD CONSTRAINT "compliance_document_statuses_requirementId_fkey" FOREIGN KEY ("requirementId") REFERENCES "compliance_document_requirements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_packs" ADD CONSTRAINT "audit_evidence_packs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_packs" ADD CONSTRAINT "audit_evidence_packs_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_packs" ADD CONSTRAINT "audit_evidence_packs_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_evidence_pack_items" ADD CONSTRAINT "audit_evidence_pack_items_evidencePackId_fkey" FOREIGN KEY ("evidencePackId") REFERENCES "audit_evidence_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_logs" ADD CONSTRAINT "data_export_logs_exportedById_fkey" FOREIGN KEY ("exportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_export_logs" ADD CONSTRAINT "data_export_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "PostingSourceType" AS ENUM ('SALES_ORDER', 'POS_TRANSACTION', 'PURCHASE_ORDER', 'EXPENSE', 'RECEIVABLE', 'PAYABLE', 'PAYROLL_RUN', 'SALARY_PAYMENT', 'RENT_INVOICE', 'RENT_PAYMENT', 'PARKING_SESSION', 'PARKING_PAYMENT', 'ROOM_BOOKING', 'RESTAURANT_ORDER', 'FUEL_DELIVERY', 'FUEL_SHIFT', 'STOCK_ADJUSTMENT', 'INVENTORY_MOVEMENT', 'FIXED_ASSET', 'DEPRECIATION', 'LOAN_REPAYMENT', 'TAX_RETURN', 'PROJECT_BILLING', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "PostingTriggerAction" AS ENUM ('CREATE', 'ISSUE', 'POST', 'APPROVE', 'PAY', 'COMPLETE', 'CLOSE', 'REVERSE', 'OTHER');

-- CreateEnum
CREATE TYPE "DebitCredit" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "PostingAmountSource" AS ENUM ('TOTAL_AMOUNT', 'TAX_AMOUNT', 'NET_AMOUNT', 'COST_AMOUNT', 'DISCOUNT_AMOUNT', 'PAID_AMOUNT', 'OUTSTANDING_AMOUNT', 'CUSTOM_FORMULA');

-- CreateEnum
CREATE TYPE "PostingRunStatus" AS ENUM ('DRAFT', 'POSTED', 'FAILED', 'REVERSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PeriodCloseStatus" AS ENUM ('DRAFT', 'REVIEWING', 'CLOSED', 'REOPENED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountingLockType" AS ENUM ('PERIOD_LOCK', 'FISCAL_YEAR_LOCK', 'MODULE_LOCK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AccountingLockStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "BankReconciliationStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'RECONCILED', 'APPROVED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepreciationMethod" AS ENUM ('STRAIGHT_LINE', 'REDUCING_BALANCE', 'MANUAL', 'OTHER');

-- CreateEnum
CREATE TYPE "DepreciationScheduleStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DepreciationEntryStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LoanRepaymentStatus" AS ENUM ('UPCOMING', 'DUE', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinancialStatementType" AS ENUM ('TRIAL_BALANCE', 'PROFIT_AND_LOSS', 'BALANCE_SHEET', 'CASH_FLOW', 'EQUITY_STATEMENT', 'GENERAL_LEDGER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StatementRunStatus" AS ENUM ('REQUESTED', 'GENERATED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AuditAdjustmentStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequisitionPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RequisitionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CONVERTED_TO_RFQ', 'CONVERTED_TO_PO', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RFQStatus" AS ENUM ('DRAFT', 'SENT', 'RESPONSES_RECEIVED', 'EVALUATED', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RFQSupplierResponseStatus" AS ENUM ('PENDING', 'RESPONDED', 'DECLINED', 'NO_RESPONSE');

-- CreateEnum
CREATE TYPE "SupplierQuotationStatus" AS ENUM ('DRAFT', 'RECEIVED', 'EVALUATED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidComparisonStatus" AS ENUM ('DRAFT', 'REVIEWED', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GRNStatus" AS ENUM ('DRAFT', 'RECEIVED', 'INSPECTED', 'APPROVED', 'POSTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('DRAFT', 'RECEIVED', 'MATCHED', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'DISPUTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ThreeWayMatchStatus" AS ENUM ('MATCHED', 'PARTIAL_MATCH', 'VARIANCE', 'FAILED', 'MANUAL_OVERRIDE');

-- CreateEnum
CREATE TYPE "ProcurementPlanStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'ACTIVE', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ContactEntityType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'TENANT', 'GUEST', 'PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationType" AS ENUM ('PHONE_CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'MEETING', 'VISIT', 'NOTE', 'OTHER');

-- CreateEnum
CREATE TYPE "CommunicationDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('OPEN', 'FOLLOWED_UP', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreditRiskRating" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLOCKED', 'REVIEW_REQUIRED');

-- CreateEnum
CREATE TYPE "SupplierRating" AS ENUM ('EXCELLENT', 'GOOD', 'AVERAGE', 'POOR', 'BLOCKED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "CustomerStatementStatus" AS ENUM ('GENERATED', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DocumentTemplateType" AS ENUM ('SALES_INVOICE', 'RECEIPT', 'DELIVERY_NOTE', 'PURCHASE_ORDER', 'QUOTATION', 'PROFORMA_INVOICE', 'PAYSLIP', 'RENT_INVOICE', 'PARKING_RECEIPT', 'FUEL_SHIFT_REPORT', 'HOTEL_BOOKING_INVOICE', 'RESTAURANT_RECEIPT', 'BAR_RECEIPT', 'CONTRACT', 'TAX_RETURN', 'CUSTOMER_STATEMENT', 'SUPPLIER_STATEMENT', 'MANAGEMENT_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentTemplateFormat" AS ENUM ('HTML', 'PDF_READY_HTML', 'TEXT', 'JSON');

-- CreateEnum
CREATE TYPE "DocumentTemplateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "GeneratedDocumentStatus" AS ENUM ('GENERATED', 'STORED', 'SENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "GeneratedDocumentFormat" AS ENUM ('HTML', 'PDF', 'TEXT', 'JSON');

-- CreateEnum
CREATE TYPE "SequenceResetFrequency" AS ENUM ('NEVER', 'DAILY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "AutomationType" AS ENUM ('RECURRING_INVOICE', 'RECURRING_EXPENSE', 'RENT_INVOICE_GENERATION', 'LOAN_REPAYMENT_REMINDER', 'DEPRECIATION_POSTING', 'STOCK_REORDER_SUGGESTION', 'COMPLIANCE_REMINDER', 'REPORT_DELIVERY', 'PAYROLL_REMINDER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('SCHEDULE', 'EVENT', 'THRESHOLD', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationRuleStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "AutomationRunStatus" AS ENUM ('REQUESTED', 'RUNNING', 'COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AutomationRunType" AS ENUM ('SCHEDULED', 'MANUAL', 'EVENT_TRIGGERED');

-- CreateEnum
CREATE TYPE "AutomationRunItemStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED', 'WARNING');

-- CreateEnum
CREATE TYPE "LoanPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CHEQUE', 'OTHER');

-- CreateTable
CREATE TABLE "accounting_posting_rules" (
    "id" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "PostingSourceType" NOT NULL,
    "triggerAction" "PostingTriggerAction" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "accounting_posting_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_posting_rule_lines" (
    "id" TEXT NOT NULL,
    "postingRuleId" TEXT NOT NULL,
    "lineOrder" INTEGER NOT NULL,
    "debitCredit" "DebitCredit" NOT NULL,
    "accountId" TEXT NOT NULL,
    "amountSource" "PostingAmountSource" NOT NULL,
    "formula" JSONB,
    "descriptionTemplate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_posting_rule_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posting_runs" (
    "id" TEXT NOT NULL,
    "postingRunNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceType" "PostingSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "postingRuleId" TEXT,
    "journalEntryId" TEXT,
    "status" "PostingRunStatus" NOT NULL DEFAULT 'DRAFT',
    "totalDebit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCredit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "errorMessage" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "posting_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_period_closes" (
    "id" TEXT NOT NULL,
    "closeNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "accountingPeriodId" TEXT NOT NULL,
    "status" "PeriodCloseStatus" NOT NULL DEFAULT 'DRAFT',
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "reopenedById" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "accounting_period_closes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_locks" (
    "id" TEXT NOT NULL,
    "lockCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lockType" "AccountingLockType" NOT NULL,
    "moduleName" TEXT,
    "fiscalYearId" TEXT,
    "accountingPeriodId" TEXT,
    "lockedFrom" TIMESTAMP(3),
    "lockedTo" TIMESTAMP(3),
    "reason" TEXT,
    "status" "AccountingLockStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "accounting_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliations" (
    "id" TEXT NOT NULL,
    "reconciliationNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "cashAccountId" TEXT NOT NULL,
    "bankAccountId" TEXT,
    "statementStartDate" TIMESTAMP(3) NOT NULL,
    "statementEndDate" TIMESTAMP(3) NOT NULL,
    "statementOpeningBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "statementClosingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bookOpeningBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "bookClosingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "reconciledBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "differenceAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "BankReconciliationStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bank_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_statement_lines" (
    "id" TEXT NOT NULL,
    "bankReconciliationId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "reference" TEXT,
    "debitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "balance" DECIMAL(18,4),
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "matchedTransactionType" TEXT,
    "matchedTransactionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_statement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_reconciliation_matches" (
    "id" TEXT NOT NULL,
    "bankReconciliationId" TEXT NOT NULL,
    "bankStatementLineId" TEXT NOT NULL,
    "matchedEntityType" TEXT NOT NULL,
    "matchedEntityId" TEXT NOT NULL,
    "matchType" TEXT NOT NULL DEFAULT 'MANUAL',
    "amount" DECIMAL(18,4) NOT NULL,
    "matchedById" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_schedules" (
    "id" TEXT NOT NULL,
    "scheduleNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL,
    "depreciationMethod" "DepreciationMethod" NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "usefulLifeMonths" INTEGER,
    "salvageValue" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "depreciationRate" DECIMAL(10,6),
    "totalDepreciableAmount" DECIMAL(18,4) NOT NULL,
    "accumulatedDepreciation" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "status" "DepreciationScheduleStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "depreciation_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "depreciation_entries" (
    "id" TEXT NOT NULL,
    "depreciationScheduleId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fixedAssetId" TEXT NOT NULL,
    "depreciationDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "accumulatedDepreciationAfter" DECIMAL(18,4) NOT NULL,
    "journalEntryId" TEXT,
    "status" "DepreciationEntryStatus" NOT NULL DEFAULT 'DRAFT',
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "depreciation_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayment_schedules" (
    "id" TEXT NOT NULL,
    "repaymentScheduleNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "loanDebtId" TEXT NOT NULL,
    "installmentNumber" INTEGER NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "principalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "interestAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "feeAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL,
    "status" "LoanRepaymentStatus" NOT NULL DEFAULT 'UPCOMING',
    "payableId" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "loan_repayment_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_repayment_payments" (
    "id" TEXT NOT NULL,
    "repaymentPaymentNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "loanRepaymentScheduleId" TEXT NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentMethod" "LoanPaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "cashAccountId" TEXT,
    "reference" TEXT,
    "journalEntryId" TEXT,
    "paidById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "loan_repayment_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_statement_runs" (
    "id" TEXT NOT NULL,
    "statementRunNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "statementType" "FinancialStatementType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" TEXT,
    "filters" JSONB,
    "status" "StatementRunStatus" NOT NULL DEFAULT 'REQUESTED',
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_statement_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_adjustments" (
    "id" TEXT NOT NULL,
    "adjustmentNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "accountingPeriodId" TEXT,
    "description" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "journalEntryId" TEXT,
    "status" "AuditAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "audit_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisitions" (
    "id" TEXT NOT NULL,
    "requisitionNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "neededByDate" TIMESTAMP(3),
    "purpose" TEXT,
    "priority" "RequisitionPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "RequisitionStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "totalEstimatedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "purchase_requisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_requisition_lines" (
    "id" TEXT NOT NULL,
    "purchaseRequisitionId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitId" TEXT,
    "estimatedUnitCost" DECIMAL(18,4),
    "estimatedTotalCost" DECIMAL(18,4),
    "preferredSupplierId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_requisition_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_for_quotations" (
    "id" TEXT NOT NULL,
    "rfqNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseRequisitionId" TEXT,
    "rfqDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closingDate" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "RFQStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "awardedSupplierId" TEXT,
    "awardedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "request_for_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rfq_suppliers" (
    "id" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "responseStatus" "RFQSupplierResponseStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rfq_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotations" (
    "id" TEXT NOT NULL,
    "supplierQuotationNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfqId" TEXT,
    "supplierId" TEXT NOT NULL,
    "quotationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "SupplierQuotationStatus" NOT NULL DEFAULT 'DRAFT',
    "documentId" TEXT,
    "createdById" TEXT NOT NULL,
    "acceptedById" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_quotations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_quotation_lines" (
    "id" TEXT NOT NULL,
    "supplierQuotationId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitId" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL,
    "deliveryDays" INTEGER,
    "warranty" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_quotation_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_comparisons" (
    "id" TEXT NOT NULL,
    "comparisonNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "rfqId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "comparisonDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendedSupplierId" TEXT,
    "recommendationReason" TEXT,
    "status" "BidComparisonStatus" NOT NULL DEFAULT 'DRAFT',
    "preparedById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "bid_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_comparison_lines" (
    "id" TEXT NOT NULL,
    "bidComparisonId" TEXT NOT NULL,
    "supplierQuotationId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "deliveryScore" DECIMAL(5,2),
    "priceScore" DECIMAL(5,2),
    "qualityScore" DECIMAL(5,2),
    "overallScore" DECIMAL(5,2),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bid_comparison_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_received_notes" (
    "id" TEXT NOT NULL,
    "grnNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "branchId" TEXT,
    "purchaseOrderId" TEXT,
    "supplierId" TEXT NOT NULL,
    "receivedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT NOT NULL,
    "status" "GRNStatus" NOT NULL DEFAULT 'DRAFT',
    "inspectedById" TEXT,
    "approvedById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "goods_received_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "goods_received_note_lines" (
    "id" TEXT NOT NULL,
    "goodsReceivedNoteId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "orderedQuantity" DECIMAL(18,4),
    "receivedQuantity" DECIMAL(18,4) NOT NULL,
    "acceptedQuantity" DECIMAL(18,4) NOT NULL,
    "rejectedQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "unitId" TEXT NOT NULL,
    "inventoryLocationId" TEXT,
    "condition" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "goods_received_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "supplierInvoiceNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "purchaseOrderId" TEXT,
    "goodsReceivedNoteId" TEXT,
    "invoiceDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "invoiceReference" TEXT,
    "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,4) NOT NULL,
    "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "payableId" TEXT,
    "documentId" TEXT,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_invoice_lines" (
    "id" TEXT NOT NULL,
    "supplierInvoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitId" TEXT,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "taxAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "three_way_matches" (
    "id" TEXT NOT NULL,
    "matchNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "goodsReceivedNoteId" TEXT,
    "supplierInvoiceId" TEXT,
    "matchDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchStatus" "ThreeWayMatchStatus" NOT NULL DEFAULT 'MATCHED',
    "quantityVariance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "amountVariance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "matchedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "three_way_matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_plans" (
    "id" TEXT NOT NULL,
    "planNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fiscalYearId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "totalBudget" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "status" "ProcurementPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "procurement_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_plan_lines" (
    "id" TEXT NOT NULL,
    "procurementPlanId" TEXT NOT NULL,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "plannedQuantity" DECIMAL(18,4),
    "unitId" TEXT,
    "estimatedUnitCost" DECIMAL(18,4),
    "estimatedTotalCost" DECIMAL(18,4),
    "plannedPurchaseDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_plan_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_persons" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" "ContactEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "position" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "contact_persons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_logs" (
    "id" TEXT NOT NULL,
    "communicationNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entityType" "ContactEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "communicationType" "CommunicationType" NOT NULL,
    "direction" "CommunicationDirection" NOT NULL DEFAULT 'OUTBOUND',
    "subject" TEXT,
    "summary" TEXT NOT NULL,
    "communicationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpDate" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "communication_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credit_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "paymentTermsDays" INTEGER,
    "riskRating" "CreditRiskRating" NOT NULL DEFAULT 'UNKNOWN',
    "creditStatus" "CreditStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentOutstanding" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "overdueAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_credit_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_performance_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "rating" "SupplierRating" NOT NULL DEFAULT 'UNKNOWN',
    "onTimeDeliveryRate" DECIMAL(5,2),
    "qualityScore" DECIMAL(5,2),
    "priceCompetitivenessScore" DECIMAL(5,2),
    "totalPurchases" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalReturns" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "disputeCount" INTEGER NOT NULL DEFAULT 0,
    "lastReviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "supplier_performance_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_segments" (
    "id" TEXT NOT NULL,
    "segmentCode" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_segment_memberships" (
    "id" TEXT NOT NULL,
    "customerSegmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "customer_segment_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_statement_runs" (
    "id" TEXT NOT NULL,
    "statementRunNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalDebits" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCredits" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CustomerStatementStatus" NOT NULL DEFAULT 'GENERATED',
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_statement_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_statement_runs" (
    "id" TEXT NOT NULL,
    "statementRunNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalDebits" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalCredits" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "closingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TZS',
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "CustomerStatementStatus" NOT NULL DEFAULT 'GENERATED',
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_statement_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "templateCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "templateType" "DocumentTemplateType" NOT NULL,
    "format" "DocumentTemplateFormat" NOT NULL DEFAULT 'HTML',
    "content" TEXT NOT NULL,
    "variables" JSONB,
    "headerConfig" JSONB,
    "footerConfig" JSONB,
    "pageConfig" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "status" "DocumentTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" TEXT NOT NULL,
    "generatedDocumentNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "templateId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "renderedContent" TEXT NOT NULL,
    "outputFormat" "GeneratedDocumentFormat" NOT NULL DEFAULT 'HTML',
    "documentId" TEXT,
    "generatedById" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "GeneratedDocumentStatus" NOT NULL DEFAULT 'GENERATED',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_number_sequences" (
    "id" TEXT NOT NULL,
    "sequenceCode" TEXT NOT NULL,
    "companyId" TEXT,
    "entityType" TEXT NOT NULL,
    "prefix" TEXT,
    "suffix" TEXT,
    "currentNumber" INTEGER NOT NULL DEFAULT 0,
    "padding" INTEGER NOT NULL DEFAULT 5,
    "resetFrequency" "SequenceResetFrequency" NOT NULL DEFAULT 'NEVER',
    "lastResetAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "document_number_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" TEXT NOT NULL,
    "automationRuleCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "automationType" "AutomationType" NOT NULL,
    "triggerType" "AutomationTriggerType" NOT NULL,
    "triggerConfig" JSONB NOT NULL,
    "actionConfig" JSONB NOT NULL,
    "status" "AutomationRuleStatus" NOT NULL DEFAULT 'INACTIVE',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" TEXT NOT NULL,
    "automationRunNumber" TEXT NOT NULL,
    "automationRuleId" TEXT,
    "companyId" TEXT,
    "runType" "AutomationRunType" NOT NULL DEFAULT 'MANUAL',
    "status" "AutomationRunStatus" NOT NULL DEFAULT 'REQUESTED',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_run_items" (
    "id" TEXT NOT NULL,
    "automationRunId" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "action" TEXT NOT NULL,
    "status" "AutomationRunItemStatus" NOT NULL DEFAULT 'SUCCESS',
    "message" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_posting_rules_ruleCode_key" ON "accounting_posting_rules"("ruleCode");

-- CreateIndex
CREATE INDEX "accounting_posting_rules_companyId_sourceType_triggerAction_idx" ON "accounting_posting_rules"("companyId", "sourceType", "triggerAction", "isActive");

-- CreateIndex
CREATE INDEX "accounting_posting_rule_lines_postingRuleId_lineOrder_idx" ON "accounting_posting_rule_lines"("postingRuleId", "lineOrder");

-- CreateIndex
CREATE UNIQUE INDEX "posting_runs_postingRunNumber_key" ON "posting_runs"("postingRunNumber");

-- CreateIndex
CREATE INDEX "posting_runs_companyId_sourceType_sourceId_status_idx" ON "posting_runs"("companyId", "sourceType", "sourceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_period_closes_closeNumber_key" ON "accounting_period_closes"("closeNumber");

-- CreateIndex
CREATE INDEX "accounting_period_closes_companyId_fiscalYearId_accountingP_idx" ON "accounting_period_closes"("companyId", "fiscalYearId", "accountingPeriodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_locks_lockCode_key" ON "accounting_locks"("lockCode");

-- CreateIndex
CREATE INDEX "accounting_locks_companyId_lockType_status_idx" ON "accounting_locks"("companyId", "lockType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_reconciliations_reconciliationNumber_key" ON "bank_reconciliations"("reconciliationNumber");

-- CreateIndex
CREATE INDEX "bank_reconciliations_companyId_cashAccountId_status_idx" ON "bank_reconciliations"("companyId", "cashAccountId", "status");

-- CreateIndex
CREATE INDEX "bank_statement_lines_bankReconciliationId_transactionDate_m_idx" ON "bank_statement_lines"("bankReconciliationId", "transactionDate", "matched");

-- CreateIndex
CREATE INDEX "bank_reconciliation_matches_bankReconciliationId_bankStatem_idx" ON "bank_reconciliation_matches"("bankReconciliationId", "bankStatementLineId");

-- CreateIndex
CREATE UNIQUE INDEX "depreciation_schedules_scheduleNumber_key" ON "depreciation_schedules"("scheduleNumber");

-- CreateIndex
CREATE INDEX "depreciation_schedules_companyId_fixedAssetId_status_idx" ON "depreciation_schedules"("companyId", "fixedAssetId", "status");

-- CreateIndex
CREATE INDEX "depreciation_entries_depreciationScheduleId_depreciationDat_idx" ON "depreciation_entries"("depreciationScheduleId", "depreciationDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayment_schedules_repaymentScheduleNumber_key" ON "loan_repayment_schedules"("repaymentScheduleNumber");

-- CreateIndex
CREATE INDEX "loan_repayment_schedules_companyId_loanDebtId_status_dueDat_idx" ON "loan_repayment_schedules"("companyId", "loanDebtId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "loan_repayment_payments_repaymentPaymentNumber_key" ON "loan_repayment_payments"("repaymentPaymentNumber");

-- CreateIndex
CREATE INDEX "loan_repayment_payments_companyId_loanRepaymentScheduleId_p_idx" ON "loan_repayment_payments"("companyId", "loanRepaymentScheduleId", "paymentDate");

-- CreateIndex
CREATE UNIQUE INDEX "financial_statement_runs_statementRunNumber_key" ON "financial_statement_runs"("statementRunNumber");

-- CreateIndex
CREATE INDEX "financial_statement_runs_companyId_statementType_status_idx" ON "financial_statement_runs"("companyId", "statementType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "audit_adjustments_adjustmentNumber_key" ON "audit_adjustments"("adjustmentNumber");

-- CreateIndex
CREATE INDEX "audit_adjustments_companyId_status_idx" ON "audit_adjustments"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_requisitions_requisitionNumber_key" ON "purchase_requisitions"("requisitionNumber");

-- CreateIndex
CREATE INDEX "purchase_requisitions_companyId_status_requestDate_idx" ON "purchase_requisitions"("companyId", "status", "requestDate");

-- CreateIndex
CREATE INDEX "purchase_requisition_lines_purchaseRequisitionId_idx" ON "purchase_requisition_lines"("purchaseRequisitionId");

-- CreateIndex
CREATE UNIQUE INDEX "request_for_quotations_rfqNumber_key" ON "request_for_quotations"("rfqNumber");

-- CreateIndex
CREATE INDEX "request_for_quotations_companyId_status_rfqDate_idx" ON "request_for_quotations"("companyId", "status", "rfqDate");

-- CreateIndex
CREATE INDEX "rfq_suppliers_rfqId_supplierId_idx" ON "rfq_suppliers"("rfqId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_quotations_supplierQuotationNumber_key" ON "supplier_quotations"("supplierQuotationNumber");

-- CreateIndex
CREATE INDEX "supplier_quotations_companyId_supplierId_status_idx" ON "supplier_quotations"("companyId", "supplierId", "status");

-- CreateIndex
CREATE INDEX "supplier_quotation_lines_supplierQuotationId_idx" ON "supplier_quotation_lines"("supplierQuotationId");

-- CreateIndex
CREATE UNIQUE INDEX "bid_comparisons_comparisonNumber_key" ON "bid_comparisons"("comparisonNumber");

-- CreateIndex
CREATE INDEX "bid_comparisons_companyId_rfqId_status_idx" ON "bid_comparisons"("companyId", "rfqId", "status");

-- CreateIndex
CREATE INDEX "bid_comparison_lines_bidComparisonId_supplierId_idx" ON "bid_comparison_lines"("bidComparisonId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "goods_received_notes_grnNumber_key" ON "goods_received_notes"("grnNumber");

-- CreateIndex
CREATE INDEX "goods_received_notes_companyId_supplierId_status_receivedDa_idx" ON "goods_received_notes"("companyId", "supplierId", "status", "receivedDate");

-- CreateIndex
CREATE INDEX "goods_received_note_lines_goodsReceivedNoteId_productId_idx" ON "goods_received_note_lines"("goodsReceivedNoteId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_invoices_supplierInvoiceNumber_key" ON "supplier_invoices"("supplierInvoiceNumber");

-- CreateIndex
CREATE INDEX "supplier_invoices_companyId_supplierId_status_invoiceDate_idx" ON "supplier_invoices"("companyId", "supplierId", "status", "invoiceDate");

-- CreateIndex
CREATE INDEX "supplier_invoice_lines_supplierInvoiceId_idx" ON "supplier_invoice_lines"("supplierInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "three_way_matches_matchNumber_key" ON "three_way_matches"("matchNumber");

-- CreateIndex
CREATE INDEX "three_way_matches_companyId_purchaseOrderId_matchStatus_idx" ON "three_way_matches"("companyId", "purchaseOrderId", "matchStatus");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_plans_planNumber_key" ON "procurement_plans"("planNumber");

-- CreateIndex
CREATE INDEX "procurement_plans_companyId_status_idx" ON "procurement_plans"("companyId", "status");

-- CreateIndex
CREATE INDEX "procurement_plan_lines_procurementPlanId_idx" ON "procurement_plan_lines"("procurementPlanId");

-- CreateIndex
CREATE INDEX "contact_persons_companyId_entityType_entityId_idx" ON "contact_persons"("companyId", "entityType", "entityId");

-- CreateIndex
CREATE UNIQUE INDEX "communication_logs_communicationNumber_key" ON "communication_logs"("communicationNumber");

-- CreateIndex
CREATE INDEX "communication_logs_companyId_entityType_entityId_status_idx" ON "communication_logs"("companyId", "entityType", "entityId", "status");

-- CreateIndex
CREATE INDEX "customer_credit_profiles_companyId_customerId_creditStatus_idx" ON "customer_credit_profiles"("companyId", "customerId", "creditStatus");

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_profiles_companyId_customerId_key" ON "customer_credit_profiles"("companyId", "customerId");

-- CreateIndex
CREATE INDEX "supplier_performance_profiles_companyId_supplierId_rating_idx" ON "supplier_performance_profiles"("companyId", "supplierId", "rating");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_performance_profiles_companyId_supplierId_key" ON "supplier_performance_profiles"("companyId", "supplierId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_segments_segmentCode_key" ON "customer_segments"("segmentCode");

-- CreateIndex
CREATE INDEX "customer_segments_companyId_isActive_idx" ON "customer_segments"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "customer_segment_memberships_customerSegmentId_customerId_idx" ON "customer_segment_memberships"("customerSegmentId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_segment_memberships_customerSegmentId_customerId_key" ON "customer_segment_memberships"("customerSegmentId", "customerId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_statement_runs_statementRunNumber_key" ON "customer_statement_runs"("statementRunNumber");

-- CreateIndex
CREATE INDEX "customer_statement_runs_companyId_customerId_status_idx" ON "customer_statement_runs"("companyId", "customerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_statement_runs_statementRunNumber_key" ON "supplier_statement_runs"("statementRunNumber");

-- CreateIndex
CREATE INDEX "supplier_statement_runs_companyId_supplierId_status_idx" ON "supplier_statement_runs"("companyId", "supplierId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_templateCode_key" ON "document_templates"("templateCode");

-- CreateIndex
CREATE INDEX "document_templates_companyId_templateType_status_isDefault_idx" ON "document_templates"("companyId", "templateType", "status", "isDefault");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_generatedDocumentNumber_key" ON "generated_documents"("generatedDocumentNumber");

-- CreateIndex
CREATE INDEX "generated_documents_companyId_entityType_entityId_status_idx" ON "generated_documents"("companyId", "entityType", "entityId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "document_number_sequences_sequenceCode_key" ON "document_number_sequences"("sequenceCode");

-- CreateIndex
CREATE INDEX "document_number_sequences_companyId_entityType_isActive_idx" ON "document_number_sequences"("companyId", "entityType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_automationRuleCode_key" ON "automation_rules"("automationRuleCode");

-- CreateIndex
CREATE INDEX "automation_rules_companyId_automationType_status_idx" ON "automation_rules"("companyId", "automationType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "automation_runs_automationRunNumber_key" ON "automation_runs"("automationRunNumber");

-- CreateIndex
CREATE INDEX "automation_runs_automationRuleId_status_idx" ON "automation_runs"("automationRuleId", "status");

-- CreateIndex
CREATE INDEX "automation_run_items_automationRunId_status_idx" ON "automation_run_items"("automationRunId", "status");

-- AddForeignKey
ALTER TABLE "accounting_posting_rules" ADD CONSTRAINT "accounting_posting_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_posting_rules" ADD CONSTRAINT "accounting_posting_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_posting_rules" ADD CONSTRAINT "accounting_posting_rules_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_posting_rule_lines" ADD CONSTRAINT "accounting_posting_rule_lines_postingRuleId_fkey" FOREIGN KEY ("postingRuleId") REFERENCES "accounting_posting_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_posting_rule_lines" ADD CONSTRAINT "accounting_posting_rule_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_runs" ADD CONSTRAINT "posting_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_runs" ADD CONSTRAINT "posting_runs_postingRuleId_fkey" FOREIGN KEY ("postingRuleId") REFERENCES "accounting_posting_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_runs" ADD CONSTRAINT "posting_runs_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posting_runs" ADD CONSTRAINT "posting_runs_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_closes" ADD CONSTRAINT "accounting_period_closes_reopenedById_fkey" FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_locks" ADD CONSTRAINT "accounting_locks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_locks" ADD CONSTRAINT "accounting_locks_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_locks" ADD CONSTRAINT "accounting_locks_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_locks" ADD CONSTRAINT "accounting_locks_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_locks" ADD CONSTRAINT "accounting_locks_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliations" ADD CONSTRAINT "bank_reconciliations_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_statement_lines" ADD CONSTRAINT "bank_statement_lines_bankReconciliationId_fkey" FOREIGN KEY ("bankReconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_bankReconciliationId_fkey" FOREIGN KEY ("bankReconciliationId") REFERENCES "bank_reconciliations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_bankStatementLineId_fkey" FOREIGN KEY ("bankStatementLineId") REFERENCES "bank_statement_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_reconciliation_matches" ADD CONSTRAINT "bank_reconciliation_matches_matchedById_fkey" FOREIGN KEY ("matchedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_schedules" ADD CONSTRAINT "depreciation_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_schedules" ADD CONSTRAINT "depreciation_schedules_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_schedules" ADD CONSTRAINT "depreciation_schedules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_depreciationScheduleId_fkey" FOREIGN KEY ("depreciationScheduleId") REFERENCES "depreciation_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciation_entries" ADD CONSTRAINT "depreciation_entries_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_schedules" ADD CONSTRAINT "loan_repayment_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_payments" ADD CONSTRAINT "loan_repayment_payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_payments" ADD CONSTRAINT "loan_repayment_payments_loanRepaymentScheduleId_fkey" FOREIGN KEY ("loanRepaymentScheduleId") REFERENCES "loan_repayment_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayment_payments" ADD CONSTRAINT "loan_repayment_payments_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_runs" ADD CONSTRAINT "financial_statement_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_statement_runs" ADD CONSTRAINT "financial_statement_runs_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_adjustments" ADD CONSTRAINT "audit_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_adjustments" ADD CONSTRAINT "audit_adjustments_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_adjustments" ADD CONSTRAINT "audit_adjustments_accountingPeriodId_fkey" FOREIGN KEY ("accountingPeriodId") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_adjustments" ADD CONSTRAINT "audit_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_adjustments" ADD CONSTRAINT "audit_adjustments_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_adjustments" ADD CONSTRAINT "audit_adjustments_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisitions" ADD CONSTRAINT "purchase_requisitions_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_purchaseRequisitionId_fkey" FOREIGN KEY ("purchaseRequisitionId") REFERENCES "purchase_requisitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "request_for_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "request_for_quotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_quotation_lines" ADD CONSTRAINT "supplier_quotation_lines_supplierQuotationId_fkey" FOREIGN KEY ("supplierQuotationId") REFERENCES "supplier_quotations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_comparisons" ADD CONSTRAINT "bid_comparisons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_comparisons" ADD CONSTRAINT "bid_comparisons_rfqId_fkey" FOREIGN KEY ("rfqId") REFERENCES "request_for_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_comparisons" ADD CONSTRAINT "bid_comparisons_preparedById_fkey" FOREIGN KEY ("preparedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_comparisons" ADD CONSTRAINT "bid_comparisons_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_comparison_lines" ADD CONSTRAINT "bid_comparison_lines_bidComparisonId_fkey" FOREIGN KEY ("bidComparisonId") REFERENCES "bid_comparisons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_comparison_lines" ADD CONSTRAINT "bid_comparison_lines_supplierQuotationId_fkey" FOREIGN KEY ("supplierQuotationId") REFERENCES "supplier_quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "goods_received_note_lines" ADD CONSTRAINT "goods_received_note_lines_goodsReceivedNoteId_fkey" FOREIGN KEY ("goodsReceivedNoteId") REFERENCES "goods_received_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_goodsReceivedNoteId_fkey" FOREIGN KEY ("goodsReceivedNoteId") REFERENCES "goods_received_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_invoice_lines" ADD CONSTRAINT "supplier_invoice_lines_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_way_matches" ADD CONSTRAINT "three_way_matches_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_way_matches" ADD CONSTRAINT "three_way_matches_goodsReceivedNoteId_fkey" FOREIGN KEY ("goodsReceivedNoteId") REFERENCES "goods_received_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_way_matches" ADD CONSTRAINT "three_way_matches_supplierInvoiceId_fkey" FOREIGN KEY ("supplierInvoiceId") REFERENCES "supplier_invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_way_matches" ADD CONSTRAINT "three_way_matches_matchedById_fkey" FOREIGN KEY ("matchedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "three_way_matches" ADD CONSTRAINT "three_way_matches_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plan_lines" ADD CONSTRAINT "procurement_plan_lines_procurementPlanId_fkey" FOREIGN KEY ("procurementPlanId") REFERENCES "procurement_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_persons" ADD CONSTRAINT "contact_persons_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_logs" ADD CONSTRAINT "communication_logs_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_profiles" ADD CONSTRAINT "customer_credit_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_profiles" ADD CONSTRAINT "customer_credit_profiles_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_performance_profiles" ADD CONSTRAINT "supplier_performance_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_performance_profiles" ADD CONSTRAINT "supplier_performance_profiles_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_segments" ADD CONSTRAINT "customer_segments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_segment_memberships" ADD CONSTRAINT "customer_segment_memberships_customerSegmentId_fkey" FOREIGN KEY ("customerSegmentId") REFERENCES "customer_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_statement_runs" ADD CONSTRAINT "customer_statement_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_statement_runs" ADD CONSTRAINT "customer_statement_runs_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_statement_runs" ADD CONSTRAINT "supplier_statement_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_statement_runs" ADD CONSTRAINT "supplier_statement_runs_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_number_sequences" ADD CONSTRAINT "document_number_sequences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automationRuleId_fkey" FOREIGN KEY ("automationRuleId") REFERENCES "automation_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_run_items" ADD CONSTRAINT "automation_run_items_automationRunId_fkey" FOREIGN KEY ("automationRunId") REFERENCES "automation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

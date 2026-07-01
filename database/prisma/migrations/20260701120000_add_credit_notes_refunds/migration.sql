-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('DRAFT', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "creditNoteNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT NOT NULL,
    "salesOrderId" TEXT,
    "receivableId" TEXT,
    "reason" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL,
    "appliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "journalEntryId" TEXT,
    "createdById" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "productId" TEXT,
    "unitId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "netAmount" DECIMAL(18,2) NOT NULL,
    "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refunds" (
    "id" TEXT NOT NULL,
    "refundNumber" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "customerId" TEXT,
    "customerName" TEXT,
    "creditNoteId" TEXT,
    "receivableId" TEXT,
    "cashAccountId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "refundDate" TIMESTAMP(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "notes" TEXT,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "createdById" TEXT,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "credit_notes_companyId_idx" ON "credit_notes"("companyId");

-- CreateIndex
CREATE INDEX "credit_notes_divisionId_idx" ON "credit_notes"("divisionId");

-- CreateIndex
CREATE INDEX "credit_notes_branchId_idx" ON "credit_notes"("branchId");

-- CreateIndex
CREATE INDEX "credit_notes_customerId_idx" ON "credit_notes"("customerId");

-- CreateIndex
CREATE INDEX "credit_notes_salesOrderId_idx" ON "credit_notes"("salesOrderId");

-- CreateIndex
CREATE INDEX "credit_notes_receivableId_idx" ON "credit_notes"("receivableId");

-- CreateIndex
CREATE INDEX "credit_notes_status_idx" ON "credit_notes"("status");

-- CreateIndex
CREATE INDEX "credit_notes_issueDate_idx" ON "credit_notes"("issueDate");

-- CreateIndex
CREATE INDEX "credit_notes_companyId_status_issueDate_idx" ON "credit_notes"("companyId", "status", "issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_companyId_creditNoteNumber_key" ON "credit_notes"("companyId", "creditNoteNumber");

-- CreateIndex
CREATE INDEX "credit_note_lines_creditNoteId_idx" ON "credit_note_lines"("creditNoteId");

-- CreateIndex
CREATE INDEX "credit_note_lines_creditNoteId_createdAt_idx" ON "credit_note_lines"("creditNoteId", "createdAt");

-- CreateIndex
CREATE INDEX "credit_note_lines_companyId_idx" ON "credit_note_lines"("companyId");

-- CreateIndex
CREATE INDEX "credit_note_lines_productId_idx" ON "credit_note_lines"("productId");

-- CreateIndex
CREATE INDEX "refunds_companyId_idx" ON "refunds"("companyId");

-- CreateIndex
CREATE INDEX "refunds_divisionId_idx" ON "refunds"("divisionId");

-- CreateIndex
CREATE INDEX "refunds_branchId_idx" ON "refunds"("branchId");

-- CreateIndex
CREATE INDEX "refunds_customerId_idx" ON "refunds"("customerId");

-- CreateIndex
CREATE INDEX "refunds_creditNoteId_idx" ON "refunds"("creditNoteId");

-- CreateIndex
CREATE INDEX "refunds_receivableId_idx" ON "refunds"("receivableId");

-- CreateIndex
CREATE INDEX "refunds_cashAccountId_idx" ON "refunds"("cashAccountId");

-- CreateIndex
CREATE INDEX "refunds_status_idx" ON "refunds"("status");

-- CreateIndex
CREATE INDEX "refunds_refundDate_idx" ON "refunds"("refundDate");

-- CreateIndex
CREATE INDEX "refunds_companyId_status_refundDate_idx" ON "refunds"("companyId", "status", "refundDate");

-- CreateIndex
CREATE UNIQUE INDEX "refunds_companyId_refundNumber_key" ON "refunds"("companyId", "refundNumber");

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_salesOrderId_fkey" FOREIGN KEY ("salesOrderId") REFERENCES "sales_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units_of_measure"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "credit_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_cashAccountId_fkey" FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


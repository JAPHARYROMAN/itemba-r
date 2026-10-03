-- Party linkage, Phase 1 (W2): a supplier payment entity, mirroring customer_payments.
-- Paying a payable, paying an expense, paying an Invoice Desk invoice and recording a Cash
-- Desk SUPPLIER_PAYMENT all create exactly one supplier_payments row, so suppliers finally
-- have a dated payment history and statements can show payments on the day they happened.
-- Additive only.

CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "paymentNumber" TEXT NOT NULL,
    "requestId" TEXT,
    "companyId" TEXT NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "method" "PaymentMethodGeneral" NOT NULL DEFAULT 'CASH',
    "reference" TEXT,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "appliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unappliedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" "CurrencyCode" NOT NULL DEFAULT 'TZS',
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'COMPLETED',
    "sourceType" VARCHAR(40),
    "sourceId" TEXT,
    "cashAccountId" TEXT,
    "cashDeskMovementId" TEXT,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_payments_requestId_key" ON "supplier_payments"("requestId");
CREATE UNIQUE INDEX "supplier_payments_cashDeskMovementId_key" ON "supplier_payments"("cashDeskMovementId");
CREATE UNIQUE INDEX "supplier_payments_companyId_paymentNumber_key" ON "supplier_payments"("companyId", "paymentNumber");
CREATE INDEX "supplier_payments_companyId_idx" ON "supplier_payments"("companyId");
CREATE INDEX "supplier_payments_divisionId_idx" ON "supplier_payments"("divisionId");
CREATE INDEX "supplier_payments_branchId_idx" ON "supplier_payments"("branchId");
CREATE INDEX "supplier_payments_supplierId_idx" ON "supplier_payments"("supplierId");
CREATE INDEX "supplier_payments_cashAccountId_idx" ON "supplier_payments"("cashAccountId");
CREATE INDEX "supplier_payments_status_idx" ON "supplier_payments"("status");
CREATE INDEX "supplier_payments_paymentDate_idx" ON "supplier_payments"("paymentDate");
CREATE INDEX "supplier_payments_companyId_supplierId_paymentDate_idx" ON "supplier_payments"("companyId", "supplierId", "paymentDate");
CREATE INDEX "supplier_payments_companyId_status_paymentDate_idx" ON "supplier_payments"("companyId", "status", "paymentDate");
CREATE INDEX "supplier_payments_sourceType_sourceId_idx" ON "supplier_payments"("sourceType", "sourceId");

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_cashAccountId_fkey"
  FOREIGN KEY ("cashAccountId") REFERENCES "cash_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_cashDeskMovementId_fkey"
  FOREIGN KEY ("cashDeskMovementId") REFERENCES "cash_desk_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reversalJournalEntryId_fkey"
  FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_amounts" CHECK (
  "amount" > 0 AND "appliedAmount" >= 0 AND "unappliedAmount" >= 0 AND
  "appliedAmount" + "unappliedAmount" = "amount");

CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "supplierPaymentId" TEXT NOT NULL,
    "payableId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supplier_payment_allocations_supplierPaymentId_payableId_key" ON "supplier_payment_allocations"("supplierPaymentId", "payableId");
CREATE INDEX "supplier_payment_allocations_supplierPaymentId_idx" ON "supplier_payment_allocations"("supplierPaymentId");
CREATE INDEX "supplier_payment_allocations_payableId_idx" ON "supplier_payment_allocations"("payableId");
CREATE INDEX "supplier_payment_allocations_companyId_idx" ON "supplier_payment_allocations"("companyId");
CREATE INDEX "supplier_payment_allocations_companyId_payableId_idx" ON "supplier_payment_allocations"("companyId", "payableId");

ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_supplierPaymentId_fkey"
  FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_positive" CHECK ("amount" > 0);

-- A desk payment and its supplier payment are one event.
ALTER TABLE "invoice_desk_payments" ADD COLUMN "supplierPaymentId" TEXT;
CREATE UNIQUE INDEX "invoice_desk_payments_supplierPaymentId_key" ON "invoice_desk_payments"("supplierPaymentId");
ALTER TABLE "invoice_desk_payments" ADD CONSTRAINT "invoice_desk_payments_supplierPaymentId_fkey"
  FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A Cash Desk movement knows which supplier payment it carried.
ALTER TABLE "cash_desk_movements" ADD COLUMN "supplierPaymentId" TEXT;
CREATE UNIQUE INDEX "cash_desk_movements_supplierPaymentId_key" ON "cash_desk_movements"("supplierPaymentId");
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_supplierPaymentId_fkey"
  FOREIGN KEY ("supplierPaymentId") REFERENCES "supplier_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Noncash AR/AP corrections are distinct events, never fabricated payments.
ALTER TABLE "customer_payments" ADD COLUMN "requestId" TEXT;
CREATE UNIQUE INDEX "customer_payments_companyId_requestId_key" ON "customer_payments"("companyId", "requestId");

CREATE TYPE "AccountAdjustmentDirection" AS ENUM ('INCREASE', 'DECREASE');
CREATE TYPE "AccountAdjustmentStatus" AS ENUM ('POSTED', 'REVERSED');

CREATE TABLE "account_adjustments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "requestId" UUID NOT NULL,
    "divisionId" TEXT,
    "branchId" TEXT,
    "customerId" TEXT,
    "supplierId" TEXT,
    "targetReceivableId" TEXT,
    "targetPayableId" TEXT,
    "generatedReceivableId" TEXT,
    "generatedPayableId" TEXT,
    "direction" "AccountAdjustmentDirection" NOT NULL,
    "status" "AccountAdjustmentStatus" NOT NULL DEFAULT 'POSTED',
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" "CurrencyCode" NOT NULL,
    "offsetAccountId" TEXT NOT NULL,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "journalEntryId" TEXT,
    "reversalJournalEntryId" TEXT,
    "createdById" TEXT NOT NULL,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversedTransactionDate" TIMESTAMP(3),
    "reversalReason" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "account_adjustments_positive_amount" CHECK ("amount" > 0),
    CONSTRAINT "account_adjustments_one_target" CHECK (
      ("targetReceivableId" IS NOT NULL AND "targetPayableId" IS NULL)
      OR ("targetPayableId" IS NOT NULL AND "targetReceivableId" IS NULL)
    ),
    CONSTRAINT "account_adjustments_generated_side" CHECK (
      ("generatedReceivableId" IS NULL AND "generatedPayableId" IS NULL)
      OR ("direction" = 'INCREASE' AND "targetReceivableId" IS NOT NULL
          AND "generatedReceivableId" IS NOT NULL AND "generatedPayableId" IS NULL
          AND "generatedReceivableId" <> "targetReceivableId")
      OR ("direction" = 'INCREASE' AND "targetPayableId" IS NOT NULL
          AND "generatedPayableId" IS NOT NULL AND "generatedReceivableId" IS NULL
          AND "generatedPayableId" <> "targetPayableId")
    ),
    CONSTRAINT "account_adjustments_party_side" CHECK (
      ("targetReceivableId" IS NOT NULL AND "supplierId" IS NULL)
      OR ("targetPayableId" IS NOT NULL AND "customerId" IS NULL)
    ),
    CONSTRAINT "account_adjustments_reason_required" CHECK (char_length(btrim("reason")) >= 3)
);

CREATE UNIQUE INDEX "account_adjustments_companyId_requestId_key" ON "account_adjustments"("companyId", "requestId");
CREATE UNIQUE INDEX "account_adjustments_generatedReceivableId_key" ON "account_adjustments"("generatedReceivableId");
CREATE UNIQUE INDEX "account_adjustments_generatedPayableId_key" ON "account_adjustments"("generatedPayableId");
CREATE UNIQUE INDEX "account_adjustments_journalEntryId_key" ON "account_adjustments"("journalEntryId");
CREATE UNIQUE INDEX "account_adjustments_reversalJournalEntryId_key" ON "account_adjustments"("reversalJournalEntryId");
CREATE INDEX "account_adjustments_companyId_targetReceivableId_createdAt_idx" ON "account_adjustments"("companyId", "targetReceivableId", "createdAt");
CREATE INDEX "account_adjustments_companyId_targetPayableId_createdAt_idx" ON "account_adjustments"("companyId", "targetPayableId", "createdAt");
CREATE INDEX "account_adjustments_companyId_status_transactionDate_idx" ON "account_adjustments"("companyId", "status", "transactionDate");
CREATE INDEX "account_adjustments_customerId_idx" ON "account_adjustments"("customerId");
CREATE INDEX "account_adjustments_supplierId_idx" ON "account_adjustments"("supplierId");
CREATE INDEX "account_adjustments_offsetAccountId_idx" ON "account_adjustments"("offsetAccountId");

ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_targetReceivableId_fkey" FOREIGN KEY ("targetReceivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_targetPayableId_fkey" FOREIGN KEY ("targetPayableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_generatedReceivableId_fkey" FOREIGN KEY ("generatedReceivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_generatedPayableId_fkey" FOREIGN KEY ("generatedPayableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_offsetAccountId_fkey" FOREIGN KEY ("offsetAccountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_reversalJournalEntryId_fkey" FOREIGN KEY ("reversalJournalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "account_adjustments" ADD CONSTRAINT "account_adjustments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

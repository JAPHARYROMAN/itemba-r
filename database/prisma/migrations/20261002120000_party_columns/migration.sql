-- Party linkage, Phase 1 (W1): nullable supplier / customer references and settled-document
-- references on every row that moves or owes money. Additive only. Free-text names stay as
-- display snapshots. The backfill below resolves existing Cash Desk chains by id; it never
-- matches by name. Rows it cannot resolve stay partyType = 'NONE' and go to the
-- Unmatched parties queue (W7). See PARTY_LINKAGE_PHASE_1_PLAN_2026-10-02.md.

-- ── cash_desk_movements ────────────────────────────────────────────────────────
ALTER TABLE "cash_desk_movements"
  ADD COLUMN "partyType" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "payableId" TEXT,
  ADD COLUMN "receivableId" TEXT,
  ADD COLUMN "expenseId" TEXT,
  ADD COLUMN "refundId" TEXT,
  ADD COLUMN "customerPaymentId" TEXT,
  ADD COLUMN "journalEntryId" TEXT,
  ADD COLUMN "journalReferenceType" VARCHAR(40);

CREATE UNIQUE INDEX "cash_desk_movements_customerPaymentId_key" ON "cash_desk_movements"("customerPaymentId");
CREATE INDEX "cash_desk_movements_supplierId_businessDate_idx" ON "cash_desk_movements"("supplierId", "businessDate");
CREATE INDEX "cash_desk_movements_customerId_businessDate_idx" ON "cash_desk_movements"("customerId", "businessDate");
CREATE INDEX "cash_desk_movements_payableId_idx" ON "cash_desk_movements"("payableId");
CREATE INDEX "cash_desk_movements_receivableId_idx" ON "cash_desk_movements"("receivableId");
CREATE INDEX "cash_desk_movements_expenseId_idx" ON "cash_desk_movements"("expenseId");
CREATE INDEX "cash_desk_movements_refundId_idx" ON "cash_desk_movements"("refundId");
CREATE INDEX "cash_desk_movements_journalEntryId_idx" ON "cash_desk_movements"("journalEntryId");

ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_receivableId_fkey"
  FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_expenseId_fkey"
  FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_refundId_fkey"
  FOREIGN KEY ("refundId") REFERENCES "refunds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_customerPaymentId_fkey"
  FOREIGN KEY ("customerPaymentId") REFERENCES "customer_payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_journalEntryId_fkey"
  FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- partyType and the party ids must agree: SUPPLIER needs supplierId, CUSTOMER needs customerId,
-- and an id may only be set under its own partyType.
ALTER TABLE "cash_desk_movements" ADD CONSTRAINT "cash_desk_movements_party" CHECK (
  "partyType" IN ('NONE', 'SUPPLIER', 'CUSTOMER', 'EMPLOYEE', 'COMPANY') AND
  ("partyType" <> 'SUPPLIER' OR "supplierId" IS NOT NULL) AND
  ("partyType" <> 'CUSTOMER' OR "customerId" IS NOT NULL) AND
  ("supplierId" IS NULL OR "partyType" = 'SUPPLIER') AND
  ("customerId" IS NULL OR "partyType" = 'CUSTOMER'));

-- ── expenses ──────────────────────────────────────────────────────────────────
ALTER TABLE "expenses" ADD COLUMN "supplierId" TEXT;
CREATE INDEX "expenses_supplierId_idx" ON "expenses"("supplierId");
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── record_entries (NoteBook): identity only, money stays independent ─────────
ALTER TABLE "record_entries" ADD COLUMN "supplierId" TEXT, ADD COLUMN "customerId" TEXT;
CREATE INDEX "record_entries_supplierId_idx" ON "record_entries"("supplierId");
CREATE INDEX "record_entries_customerId_idx" ON "record_entries"("customerId");
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_party" CHECK (
  NOT ("supplierId" IS NOT NULL AND "customerId" IS NOT NULL) AND
  ("kind" <> 'DEBTOR' OR "supplierId" IS NULL) AND
  ("kind" <> 'CREDITOR' OR "customerId" IS NULL) AND
  ("kind" <> 'NOTE' OR ("supplierId" IS NULL AND "customerId" IS NULL)));

-- ── record_book_expenses ──────────────────────────────────────────────────────
ALTER TABLE "record_book_expenses" ADD COLUMN "supplierId" TEXT;
CREATE INDEX "record_book_expenses_supplierId_idx" ON "record_book_expenses"("supplierId");
ALTER TABLE "record_book_expenses" ADD CONSTRAINT "record_book_expenses_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── debts ─────────────────────────────────────────────────────────────────────
ALTER TABLE "debts" ADD COLUMN "supplierId" TEXT;
CREATE INDEX "debts_supplierId_idx" ON "debts"("supplierId");
ALTER TABLE "debts" ADD CONSTRAINT "debts_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── contracts ─────────────────────────────────────────────────────────────────
ALTER TABLE "contracts" ADD COLUMN "supplierId" TEXT, ADD COLUMN "customerId" TEXT;
CREATE INDEX "contracts_supplierId_idx" ON "contracts"("supplierId");
CREATE INDEX "contracts_customerId_idx" ON "contracts"("customerId");
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_party" CHECK (
  NOT ("supplierId" IS NOT NULL AND "customerId" IS NOT NULL));

-- ── loans (a lender that is a supplier: SUPPLIER_CREDIT) ──────────────────────
ALTER TABLE "loans" ADD COLUMN "supplierId" TEXT;
CREATE INDEX "loans_supplierId_idx" ON "loans"("supplierId");
ALTER TABLE "loans" ADD CONSTRAINT "loans_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Backfill: resolve existing Cash Desk chains by id only ────────────────────
-- Supplier payments made in Cash Desk: movement → desk payment → desk invoice → desk supplier → master.
UPDATE "cash_desk_movements" m
SET "supplierId" = s."canonicalSupplierId", "partyType" = 'SUPPLIER'
FROM "invoice_desk_payments" p
JOIN "invoice_desk_invoices" i ON i."id" = p."invoiceId"
JOIN "invoice_desk_suppliers" s ON s."id" = i."supplierId"
WHERE m."invoicePaymentId" = p."id"
  AND s."canonicalSupplierId" IS NOT NULL
  AND m."partyType" = 'NONE';

-- Sales Desk receipts: movement → desk payment → desk sale → desk customer → master.
UPDATE "cash_desk_movements" m
SET "customerId" = c."canonicalCustomerId", "partyType" = 'CUSTOMER'
FROM "sales_desk_payments" p
JOIN "sales_desk_sales" sl ON sl."id" = p."saleId"
JOIN "sales_desk_customers" c ON c."id" = sl."customerId"
WHERE m."salesPaymentId" = p."id"
  AND c."canonicalCustomerId" IS NOT NULL
  AND m."partyType" = 'NONE';

-- Payroll movements are run-level; the counterparty class is employees.
UPDATE "cash_desk_movements"
SET "partyType" = 'EMPLOYEE'
WHERE "payrollRunId" IS NOT NULL AND "partyType" = 'NONE';

-- Intercompany loans and repayments: the counterparty is another group company.
UPDATE "cash_desk_movements"
SET "partyType" = 'COMPANY'
WHERE "loanId" IS NOT NULL AND "partyType" = 'NONE';

-- Reversal rows inherit the party of the movement they reverse.
UPDATE "cash_desk_movements" m
SET "partyType" = o."partyType", "supplierId" = o."supplierId", "customerId" = o."customerId"
FROM "cash_desk_movements" o
WHERE m."reversalOfId" = o."id"
  AND m."partyType" = 'NONE'
  AND o."partyType" <> 'NONE';

-- Journals that already explain a movement: payroll and external-loan lifecycle events.
UPDATE "cash_desk_movements"
SET "journalEntryId" = "payrollJournalEntryId", "journalReferenceType" = 'PayrollRunPayment'
WHERE "payrollJournalEntryId" IS NOT NULL AND "journalEntryId" IS NULL;

UPDATE "cash_desk_movements" m
SET "journalEntryId" = e."journalEntryId", "journalReferenceType" = 'LoanLifecycle'
FROM "loan_financial_events" e
WHERE e."cashMovementId" = m."id"
  AND e."journalEntryId" IS NOT NULL
  AND m."journalEntryId" IS NULL;

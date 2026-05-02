-- Per-company unique numbering (audit finding F-009).
-- Converts globally unique financial document numbers to per-company composite uniques.
-- This is required so each company can issue its own number sequence (e.g. JE-001) without
-- colliding across the three BRELA companies.

-- 1. Drop the existing global unique indexes.
DROP INDEX IF EXISTS "journal_entries_journalNumber_key";
DROP INDEX IF EXISTS "expenses_expenseNumber_key";
DROP INDEX IF EXISTS "receivables_receivableNumber_key";
DROP INDEX IF EXISTS "payables_payableNumber_key";
DROP INDEX IF EXISTS "intercompany_transactions_transactionNumber_key";
DROP INDEX IF EXISTS "inventory_movements_movementNumber_key";
DROP INDEX IF EXISTS "stock_adjustments_adjustmentNumber_key";
DROP INDEX IF EXISTS "sales_orders_salesOrderNumber_key";
DROP INDEX IF EXISTS "package_movements_movementNumber_key";
DROP INDEX IF EXISTS "documents_documentCode_key";

-- 2. Add new per-company composite unique indexes.
CREATE UNIQUE INDEX "journal_entries_companyId_journalNumber_key"
  ON "journal_entries"("companyId", "journalNumber");

CREATE UNIQUE INDEX "expenses_companyId_expenseNumber_key"
  ON "expenses"("companyId", "expenseNumber");

CREATE UNIQUE INDEX "receivables_companyId_receivableNumber_key"
  ON "receivables"("companyId", "receivableNumber");

CREATE UNIQUE INDEX "payables_companyId_payableNumber_key"
  ON "payables"("companyId", "payableNumber");

-- InterCompanyTransaction has fromCompanyId / toCompanyId; we scope number uniqueness
-- to the originating (from) company so each company can run its own sequence.
CREATE UNIQUE INDEX "intercompany_transactions_fromCompanyId_transactionNumber_key"
  ON "intercompany_transactions"("fromCompanyId", "transactionNumber");

CREATE UNIQUE INDEX "inventory_movements_companyId_movementNumber_key"
  ON "inventory_movements"("companyId", "movementNumber");

CREATE UNIQUE INDEX "stock_adjustments_companyId_adjustmentNumber_key"
  ON "stock_adjustments"("companyId", "adjustmentNumber");

CREATE UNIQUE INDEX "sales_orders_companyId_salesOrderNumber_key"
  ON "sales_orders"("companyId", "salesOrderNumber");

CREATE UNIQUE INDEX "package_movements_companyId_movementNumber_key"
  ON "package_movements"("companyId", "movementNumber");

-- documentCode is nullable (String?). PostgreSQL treats NULLs as distinct in unique
-- indexes by default, so multiple documents without a code remain allowed.
CREATE UNIQUE INDEX "documents_companyId_documentCode_key"
  ON "documents"("companyId", "documentCode");

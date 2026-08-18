-- Preserve reopen evidence without modifying or deleting existing records.
ALTER TABLE "record_book_daily_sales"
  ADD COLUMN "reopenedById" TEXT,
  ADD COLUMN "reopenedAt" TIMESTAMP(3),
  ADD COLUMN "reopenReason" TEXT;

ALTER TABLE "record_book_expenses"
  ADD COLUMN "reopenedById" TEXT,
  ADD COLUMN "reopenedAt" TIMESTAMP(3),
  ADD COLUMN "reopenReason" TEXT;

ALTER TABLE "record_book_daily_sales"
  ADD CONSTRAINT "record_book_daily_sales_reopenedById_fkey"
  FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "record_book_expenses"
  ADD CONSTRAINT "record_book_expenses_reopenedById_fkey"
  FOREIGN KEY ("reopenedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "record_book_daily_sales_reopenedAt_idx"
  ON "record_book_daily_sales"("reopenedAt");

CREATE INDEX "record_book_expenses_reopenedAt_idx"
  ON "record_book_expenses"("reopenedAt");

-- Supports the transaction-scoped duplicate guard without touching legacy duplicates.
CREATE INDEX "record_book_daily_sales_active_scope_idx"
  ON "record_book_daily_sales"("companyId", "divisionId", "branchId", "recordDate", "currency")
  WHERE "deletedAt" IS NULL AND "status" <> 'VOIDED';

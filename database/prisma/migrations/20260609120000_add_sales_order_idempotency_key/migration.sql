-- Atomic quick-sale idempotency (Mobile POS): a retried checkout carrying the
-- same key returns the original order instead of creating a duplicate.
-- Nullable + company-scoped unique. Postgres treats NULLs as distinct, so
-- existing rows and any non-quick-sale orders (which leave the key NULL) are
-- unaffected and may coexist freely.
ALTER TABLE "sales_orders"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "sales_orders_companyId_idempotencyKey_key"
  ON "sales_orders"("companyId", "idempotencyKey");

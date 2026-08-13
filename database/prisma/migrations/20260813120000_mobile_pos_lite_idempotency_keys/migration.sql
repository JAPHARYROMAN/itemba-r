-- Mobile POS Lite replay protection moves from a best-effort read to a
-- database guarantee, mirroring the sales_orders quick-sale key exactly.
--
-- Why: the purchase and stock-count chains anchor their idempotency on a marker
-- written into the document's notes, and the "did somebody else create a twin
-- under this key?" check was a findMany ordered by createdAt. Postgres stamps
-- createdAt at transaction START, so a transaction that started earlier can
-- commit later: two concurrent requests carrying one key can each read a set in
-- which they are the winner, and both drive their own row — one lorry received
-- twice, or one shelf variance applied twice.
--
-- Nullable + company-scoped unique, exactly like sales_orders.idempotencyKey.
-- Postgres treats NULLs as distinct, so every existing row and every
-- desktop-created purchase order or adjustment (which leave the key NULL) is
-- unaffected and they may coexist freely. Additive only: no backfill, no data
-- rewrite, no column or table dropped.
ALTER TABLE "purchase_orders"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "purchase_orders_companyId_idempotencyKey_key"
  ON "purchase_orders"("companyId", "idempotencyKey");

ALTER TABLE "stock_adjustments"
  ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "stock_adjustments_companyId_idempotencyKey_key"
  ON "stock_adjustments"("companyId", "idempotencyKey");

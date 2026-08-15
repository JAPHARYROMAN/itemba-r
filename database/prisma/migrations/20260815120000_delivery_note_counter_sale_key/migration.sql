-- The counter-sale delivery note's replay guarantee, and the discriminator that
-- keeps it out of the office's delivery worklists.
--
-- Nullable + company-scoped unique, exactly like sales_orders.idempotencyKey and
-- purchase_orders.idempotencyKey (20260813120000). Postgres treats NULLs as
-- distinct, so every existing note and every note the desktop creates from now
-- on leaves this NULL and they may coexist freely -- including several partial
-- delivery notes against one sales order, which is a real business case this
-- index must not break.
--
-- The value is the SalesOrder id of the counter sale the note was auto-issued
-- for. Deliberately a plain TEXT marker with NO foreign key: salesOrderId is
-- already the FK (ON DELETE SET NULL), and a second constrained reference would
-- couple this marker to that cascade for no gain.
--
-- Additive only: one nullable column, one unique index. No backfill inside the
-- migration, no data rewrite, nothing dropped. ADD COLUMN ... TEXT with no
-- default is a catalog-only change in PG 11+, so it does not rewrite the table
-- and cannot stall a shop mid-trade.
ALTER TABLE "delivery_notes"
  ADD COLUMN "counterSaleOrderId" TEXT;

CREATE UNIQUE INDEX "delivery_notes_companyId_counterSaleOrderId_key"
  ON "delivery_notes"("companyId", "counterSaleOrderId");

-- Phase 1: Hierarchy scope on financial and procurement tables.
--
-- Adds optional divisionId/branchId columns + foreign keys + indexes,
-- introduces the CostCenter dimension, and backfills from source rows where
-- possible. Backfill is best-effort; rows without a source remain NULL and
-- can be populated by operators after the migration completes.
--
-- This migration is additive and reversible. No columns are dropped.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Receivable: divisionId, branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;
ALTER TABLE "receivables" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "receivables"
  ADD CONSTRAINT "receivables_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "receivables"
  ADD CONSTRAINT "receivables_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "receivables_companyId_divisionId_status_idx"
  ON "receivables"("companyId", "divisionId", "status");

CREATE INDEX IF NOT EXISTS "receivables_companyId_branchId_status_idx"
  ON "receivables"("companyId", "branchId", "status");

-- Backfill from the earliest SalesOrder pointing at the Receivable
UPDATE "receivables" r
SET "divisionId" = src."divisionId",
    "branchId"   = src."branchId"
FROM (
  SELECT DISTINCT ON ("receivableId")
    "receivableId", "divisionId", "branchId"
  FROM "sales_orders"
  WHERE "receivableId" IS NOT NULL
  ORDER BY "receivableId", "createdAt" ASC
) src
WHERE r."id" = src."receivableId"
  AND (r."divisionId" IS NULL OR r."branchId" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Payable: divisionId, branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "payables" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;
ALTER TABLE "payables" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "payables"
  ADD CONSTRAINT "payables_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payables"
  ADD CONSTRAINT "payables_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "payables_companyId_divisionId_status_idx"
  ON "payables"("companyId", "divisionId", "status");

CREATE INDEX IF NOT EXISTS "payables_companyId_branchId_status_idx"
  ON "payables"("companyId", "branchId", "status");

-- Backfill from the earliest PurchaseOrder pointing at the Payable
UPDATE "payables" p
SET "divisionId" = src."divisionId",
    "branchId"   = src."branchId"
FROM (
  SELECT DISTINCT ON ("payableId")
    "payableId", "divisionId", "branchId"
  FROM "purchase_orders"
  WHERE "payableId" IS NOT NULL
  ORDER BY "payableId", "createdAt" ASC
) src
WHERE p."id" = src."payableId"
  AND (p."divisionId" IS NULL OR p."branchId" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. GoodsReceivedNote: divisionId (branchId already present)
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "goods_received_notes" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

ALTER TABLE "goods_received_notes"
  ADD CONSTRAINT "goods_received_notes_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Add the branch FK if it's missing (the column already exists from earlier).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'goods_received_notes_branchId_fkey'
  ) THEN
    ALTER TABLE "goods_received_notes"
      ADD CONSTRAINT "goods_received_notes_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS "goods_received_notes_companyId_divisionId_status_idx"
  ON "goods_received_notes"("companyId", "divisionId", "status");

CREATE INDEX IF NOT EXISTS "goods_received_notes_companyId_branchId_status_idx"
  ON "goods_received_notes"("companyId", "branchId", "status");

-- Backfill divisionId from the linked PurchaseOrder
UPDATE "goods_received_notes" grn
SET "divisionId" = po."divisionId"
FROM "purchase_orders" po
WHERE grn."purchaseOrderId" = po."id"
  AND grn."divisionId" IS NULL
  AND po."divisionId" IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. SupplierInvoice: divisionId, branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "supplier_invoices" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;
ALTER TABLE "supplier_invoices" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "supplier_invoices"
  ADD CONSTRAINT "supplier_invoices_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_invoices"
  ADD CONSTRAINT "supplier_invoices_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "supplier_invoices_companyId_divisionId_status_idx"
  ON "supplier_invoices"("companyId", "divisionId", "status");

CREATE INDEX IF NOT EXISTS "supplier_invoices_companyId_branchId_status_idx"
  ON "supplier_invoices"("companyId", "branchId", "status");

-- Backfill from GRN (branchId + divisionId via GRN → PurchaseOrder)
UPDATE "supplier_invoices" si
SET "divisionId" = COALESCE(grn."divisionId", po."divisionId"),
    "branchId"   = grn."branchId"
FROM "goods_received_notes" grn
LEFT JOIN "purchase_orders" po ON grn."purchaseOrderId" = po."id"
WHERE si."goodsReceivedNoteId" = grn."id"
  AND (si."divisionId" IS NULL OR si."branchId" IS NULL);

-- Fallback: backfill from PurchaseOrder directly when no GRN linked
UPDATE "supplier_invoices" si
SET "divisionId" = po."divisionId",
    "branchId"   = po."branchId"
FROM "purchase_orders" po
WHERE si."purchaseOrderId" = po."id"
  AND si."goodsReceivedNoteId" IS NULL
  AND (si."divisionId" IS NULL OR si."branchId" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. CashAccount: branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "cash_accounts" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "cash_accounts"
  ADD CONSTRAINT "cash_accounts_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cash_accounts_companyId_branchId_idx"
  ON "cash_accounts"("companyId", "branchId");

-- No automated backfill (manual ops mapping).

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. BankAccount: branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "bank_accounts"
  ADD CONSTRAINT "bank_accounts_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "bank_accounts_companyId_branchId_idx"
  ON "bank_accounts"("companyId", "branchId");

-- No automated backfill (manual ops mapping).

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. InventoryBalance: divisionId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "inventory_balances" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

ALTER TABLE "inventory_balances"
  ADD CONSTRAINT "inventory_balances_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "inventory_balances_companyId_divisionId_idx"
  ON "inventory_balances"("companyId", "divisionId");

-- Backfill from the linked Branch
UPDATE "inventory_balances" ib
SET "divisionId" = b."divisionId"
FROM "branches" b
WHERE ib."branchId" = b."id"
  AND ib."divisionId" IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. RequestForQuotation: divisionId, branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "request_for_quotations" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;
ALTER TABLE "request_for_quotations" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "request_for_quotations"
  ADD CONSTRAINT "request_for_quotations_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "request_for_quotations"
  ADD CONSTRAINT "request_for_quotations_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "request_for_quotations_companyId_divisionId_status_idx"
  ON "request_for_quotations"("companyId", "divisionId", "status");

CREATE INDEX IF NOT EXISTS "request_for_quotations_companyId_branchId_status_idx"
  ON "request_for_quotations"("companyId", "branchId", "status");

-- Backfill from PurchaseRequisition
UPDATE "request_for_quotations" rfq
SET "divisionId" = pr."divisionId",
    "branchId"   = pr."branchId"
FROM "purchase_requisitions" pr
WHERE rfq."purchaseRequisitionId" = pr."id"
  AND (rfq."divisionId" IS NULL OR rfq."branchId" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. SupplierQuotation: divisionId, branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "supplier_quotations" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;
ALTER TABLE "supplier_quotations" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "supplier_quotations"
  ADD CONSTRAINT "supplier_quotations_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "supplier_quotations"
  ADD CONSTRAINT "supplier_quotations_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "supplier_quotations_companyId_divisionId_status_idx"
  ON "supplier_quotations"("companyId", "divisionId", "status");

CREATE INDEX IF NOT EXISTS "supplier_quotations_companyId_branchId_status_idx"
  ON "supplier_quotations"("companyId", "branchId", "status");

-- Backfill from RFQ
UPDATE "supplier_quotations" sq
SET "divisionId" = rfq."divisionId",
    "branchId"   = rfq."branchId"
FROM "request_for_quotations" rfq
WHERE sq."rfqId" = rfq."id"
  AND (sq."divisionId" IS NULL OR sq."branchId" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. BidComparison: divisionId, branchId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "bid_comparisons" ADD COLUMN IF NOT EXISTS "divisionId" TEXT;
ALTER TABLE "bid_comparisons" ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "bid_comparisons"
  ADD CONSTRAINT "bid_comparisons_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bid_comparisons"
  ADD CONSTRAINT "bid_comparisons_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "bid_comparisons_companyId_divisionId_status_idx"
  ON "bid_comparisons"("companyId", "divisionId", "status");

CREATE INDEX IF NOT EXISTS "bid_comparisons_companyId_branchId_status_idx"
  ON "bid_comparisons"("companyId", "branchId", "status");

-- Backfill from RFQ
UPDATE "bid_comparisons" bc
SET "divisionId" = rfq."divisionId",
    "branchId"   = rfq."branchId"
FROM "request_for_quotations" rfq
WHERE bc."rfqId" = rfq."id"
  AND (bc."divisionId" IS NULL OR bc."branchId" IS NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 11. CostCenter dimension table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "cost_centers" (
  "id"          TEXT PRIMARY KEY,
  "companyId"   TEXT NOT NULL,
  "divisionId"  TEXT,
  "branchId"    TEXT,
  "code"        TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "isActive"    BOOLEAN NOT NULL DEFAULT TRUE,
  "deletedAt"   TIMESTAMP(3),
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cost_centers_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "cost_centers_divisionId_fkey"
    FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT "cost_centers_branchId_fkey"
    FOREIGN KEY ("branchId") REFERENCES "branches"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "cost_centers_companyId_code_key"
  ON "cost_centers"("companyId", "code");

CREATE INDEX IF NOT EXISTS "cost_centers_companyId_idx"
  ON "cost_centers"("companyId");

CREATE INDEX IF NOT EXISTS "cost_centers_companyId_divisionId_idx"
  ON "cost_centers"("companyId", "divisionId");

CREATE INDEX IF NOT EXISTS "cost_centers_companyId_branchId_idx"
  ON "cost_centers"("companyId", "branchId");

-- Seed: one cost center per existing Branch. Code = "CC-{branchCode}",
-- bound to the Branch and its Division. Idempotent via unique key.
INSERT INTO "cost_centers" ("id", "companyId", "divisionId", "branchId", "code", "name", "description", "isActive", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  d."companyId",
  b."divisionId",
  b."id",
  'CC-' || b."code",
  'Cost Centre — ' || b."name",
  'Default cost centre for branch ' || b."name",
  TRUE,
  NOW(),
  NOW()
FROM "branches" b
JOIN "divisions" d ON b."divisionId" = d."id"
ON CONFLICT ("companyId", "code") DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 12. JournalEntryLine: costCenterId
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "journal_entry_lines" ADD COLUMN IF NOT EXISTS "costCenterId" TEXT;

ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_costCenterId_fkey"
  FOREIGN KEY ("costCenterId") REFERENCES "cost_centers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "journal_entry_lines_costCenterId_idx"
  ON "journal_entry_lines"("costCenterId");

-- Optional retroactive tag: where a JE line already has a branchId, set its
-- costCenterId to the default cost-centre for that branch. Idempotent.
UPDATE "journal_entry_lines" jel
SET "costCenterId" = cc."id"
FROM "cost_centers" cc
WHERE jel."branchId" = cc."branchId"
  AND jel."costCenterId" IS NULL
  AND cc."companyId" = jel."companyId";

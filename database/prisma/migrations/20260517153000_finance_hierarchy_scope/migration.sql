-- Phase 1 finance hierarchy foundation.
-- Financial subledgers and sensitive finance records now keep the operating
-- division/branch that produced or owns the record so reporting can roll up
-- branch -> division -> company -> group.

ALTER TABLE "receivables"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "payables"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "supplier_invoices"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "bank_accounts"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "loans"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "chart_of_accounts"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "goods_received_notes"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

ALTER TABLE "inventory_balances"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT;

-- Backfill goods receipt scope from branch first, then from the PO when needed.
UPDATE "goods_received_notes" grn
SET "divisionId" = b."divisionId"
FROM "branches" b
WHERE grn."branchId" = b."id"
  AND grn."divisionId" IS NULL;

UPDATE "goods_received_notes" grn
SET
  "divisionId" = COALESCE(grn."divisionId", po."divisionId"),
  "branchId" = COALESCE(grn."branchId", po."branchId")
FROM "purchase_orders" po
WHERE grn."purchaseOrderId" = po."id"
  AND (grn."divisionId" IS NULL OR grn."branchId" IS NULL);

UPDATE "goods_received_notes" grn
SET "divisionId" = b."divisionId"
FROM "branches" b
WHERE grn."branchId" = b."id"
  AND grn."divisionId" IS NULL;

-- Backfill inventory balance division from its branch.
UPDATE "inventory_balances" bal
SET "divisionId" = b."divisionId"
FROM "branches" b
WHERE bal."branchId" = b."id"
  AND bal."divisionId" IS NULL;

-- Backfill supplier invoices from PO/GRN/supplier operating scope.
UPDATE "supplier_invoices" inv
SET
  "divisionId" = COALESCE(inv."divisionId", po."divisionId"),
  "branchId" = COALESCE(inv."branchId", po."branchId")
FROM "purchase_orders" po
WHERE inv."purchaseOrderId" = po."id"
  AND (inv."divisionId" IS NULL OR inv."branchId" IS NULL);

UPDATE "supplier_invoices" inv
SET
  "divisionId" = COALESCE(inv."divisionId", grn."divisionId"),
  "branchId" = COALESCE(inv."branchId", grn."branchId")
FROM "goods_received_notes" grn
WHERE inv."goodsReceivedNoteId" = grn."id"
  AND (inv."divisionId" IS NULL OR inv."branchId" IS NULL);

UPDATE "supplier_invoices" inv
SET
  "divisionId" = COALESCE(inv."divisionId", s."divisionId"),
  "branchId" = COALESCE(inv."branchId", s."branchId")
FROM "suppliers" s
WHERE inv."supplierId" = s."id"
  AND (inv."divisionId" IS NULL OR inv."branchId" IS NULL);

-- Backfill receivables from sales and customer-facing operating documents.
UPDATE "receivables" ar
SET
  "divisionId" = COALESCE(ar."divisionId", so."divisionId"),
  "branchId" = COALESCE(ar."branchId", so."branchId")
FROM "sales_orders" so
WHERE (ar."sourceId" = so."id" OR so."receivableId" = ar."id")
  AND (ar."divisionId" IS NULL OR ar."branchId" IS NULL);

UPDATE "receivables" ar
SET
  "divisionId" = COALESCE(ar."divisionId", b."divisionId"),
  "branchId" = COALESCE(ar."branchId", fcs."branchId")
FROM "fuel_credit_sales" fcs
JOIN "branches" b ON b."id" = fcs."branchId"
WHERE (ar."sourceId" = fcs."id" OR fcs."receivableId" = ar."id")
  AND (ar."divisionId" IS NULL OR ar."branchId" IS NULL);

UPDATE "receivables" ar
SET
  "divisionId" = COALESCE(ar."divisionId", t."divisionId"),
  "branchId" = COALESCE(ar."branchId", t."branchId")
FROM "trips" t
WHERE (ar."sourceId" = t."id" OR t."receivableId" = ar."id")
  AND (ar."divisionId" IS NULL OR ar."branchId" IS NULL);

UPDATE "receivables" ar
SET "divisionId" = COALESCE(ar."divisionId", pb."divisionId")
FROM "project_billings" pb
WHERE (ar."sourceId" = pb."id" OR pb."receivableId" = ar."id")
  AND ar."divisionId" IS NULL;

UPDATE "receivables" ar
SET
  "divisionId" = COALESCE(ar."divisionId", c."divisionId"),
  "branchId" = COALESCE(ar."branchId", c."branchId")
FROM "customers" c
WHERE ar."customerId" = c."id"
  AND (ar."divisionId" IS NULL OR ar."branchId" IS NULL);

-- Backfill payables from AP source documents and supplier operating scope.
UPDATE "payables" ap
SET
  "divisionId" = COALESCE(ap."divisionId", inv."divisionId"),
  "branchId" = COALESCE(ap."branchId", inv."branchId")
FROM "supplier_invoices" inv
WHERE (ap."sourceId" = inv."id" OR inv."payableId" = ap."id")
  AND (ap."divisionId" IS NULL OR ap."branchId" IS NULL);

UPDATE "payables" ap
SET
  "divisionId" = COALESCE(ap."divisionId", po."divisionId"),
  "branchId" = COALESCE(ap."branchId", po."branchId")
FROM "purchase_orders" po
WHERE (ap."sourceId" = po."id" OR po."payableId" = ap."id")
  AND (ap."divisionId" IS NULL OR ap."branchId" IS NULL);

UPDATE "payables" ap
SET
  "divisionId" = COALESCE(ap."divisionId", b."divisionId"),
  "branchId" = COALESCE(ap."branchId", fd."branchId")
FROM "fuel_deliveries" fd
JOIN "branches" b ON b."id" = fd."branchId"
WHERE (ap."sourceId" = fd."id" OR fd."payableId" = ap."id")
  AND (ap."divisionId" IS NULL OR ap."branchId" IS NULL);

UPDATE "payables" ap
SET "divisionId" = COALESCE(ap."divisionId", sr."divisionId")
FROM "subcontractor_records" sr
WHERE ap."sourceId" = sr."id"
  AND ap."divisionId" IS NULL;

UPDATE "payables" ap
SET
  "divisionId" = COALESCE(ap."divisionId", s."divisionId"),
  "branchId" = COALESCE(ap."branchId", s."branchId")
FROM "suppliers" s
WHERE ap."supplierId" = s."id"
  AND (ap."divisionId" IS NULL OR ap."branchId" IS NULL);

-- Backfill bank-account scope from the linked cash account when available.
UPDATE "bank_accounts" ba
SET
  "divisionId" = COALESCE(ba."divisionId", ca."divisionId"),
  "branchId" = COALESCE(ba."branchId", ca."branchId")
FROM "cash_accounts" ca
WHERE ca."linkedBankAccountId" = ba."id"
  AND (ba."divisionId" IS NULL OR ba."branchId" IS NULL);

-- Backfill loan scope from the linked bank account when available.
UPDATE "loans" l
SET
  "divisionId" = COALESCE(l."divisionId", ba."divisionId"),
  "branchId" = COALESCE(l."branchId", ba."branchId")
FROM "bank_accounts" ba
WHERE l."bankAccountId" = ba."id"
  AND (l."divisionId" IS NULL OR l."branchId" IS NULL);

-- Avoid FK failures from legacy branch ids that were not constrained before.
UPDATE "goods_received_notes" grn
SET "branchId" = NULL
WHERE grn."branchId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "branches" b WHERE b."id" = grn."branchId");

CREATE INDEX IF NOT EXISTS "receivables_divisionId_idx" ON "receivables"("divisionId");
CREATE INDEX IF NOT EXISTS "receivables_branchId_idx" ON "receivables"("branchId");
CREATE INDEX IF NOT EXISTS "payables_divisionId_idx" ON "payables"("divisionId");
CREATE INDEX IF NOT EXISTS "payables_branchId_idx" ON "payables"("branchId");
CREATE INDEX IF NOT EXISTS "supplier_invoices_divisionId_idx" ON "supplier_invoices"("divisionId");
CREATE INDEX IF NOT EXISTS "supplier_invoices_branchId_idx" ON "supplier_invoices"("branchId");
CREATE INDEX IF NOT EXISTS "bank_accounts_divisionId_idx" ON "bank_accounts"("divisionId");
CREATE INDEX IF NOT EXISTS "bank_accounts_branchId_idx" ON "bank_accounts"("branchId");
CREATE INDEX IF NOT EXISTS "loans_divisionId_idx" ON "loans"("divisionId");
CREATE INDEX IF NOT EXISTS "loans_branchId_idx" ON "loans"("branchId");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_divisionId_idx" ON "chart_of_accounts"("divisionId");
CREATE INDEX IF NOT EXISTS "chart_of_accounts_branchId_idx" ON "chart_of_accounts"("branchId");
CREATE INDEX IF NOT EXISTS "goods_received_notes_divisionId_idx" ON "goods_received_notes"("divisionId");
CREATE INDEX IF NOT EXISTS "goods_received_notes_branchId_idx" ON "goods_received_notes"("branchId");
CREATE INDEX IF NOT EXISTS "inventory_balances_divisionId_idx" ON "inventory_balances"("divisionId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receivables_divisionId_fkey') THEN
    ALTER TABLE "receivables" ADD CONSTRAINT "receivables_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'receivables_branchId_fkey') THEN
    ALTER TABLE "receivables" ADD CONSTRAINT "receivables_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payables_divisionId_fkey') THEN
    ALTER TABLE "payables" ADD CONSTRAINT "payables_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payables_branchId_fkey') THEN
    ALTER TABLE "payables" ADD CONSTRAINT "payables_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoices_divisionId_fkey') THEN
    ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'supplier_invoices_branchId_fkey') THEN
    ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_divisionId_fkey') THEN
    ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bank_accounts_branchId_fkey') THEN
    ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loans_divisionId_fkey') THEN
    ALTER TABLE "loans" ADD CONSTRAINT "loans_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'loans_branchId_fkey') THEN
    ALTER TABLE "loans" ADD CONSTRAINT "loans_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chart_of_accounts_divisionId_fkey') THEN
    ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chart_of_accounts_branchId_fkey') THEN
    ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_received_notes_divisionId_fkey') THEN
    ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'goods_received_notes_branchId_fkey') THEN
    ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_branchId_fkey"
      FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventory_balances_divisionId_fkey') THEN
    ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_divisionId_fkey"
      FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

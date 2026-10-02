-- Party linkage, Phase 1 (W6): turn every soft supplierId / customerId into a real foreign key.
--
-- PRE-FLIGHT (required): run `node backend/scripts/party-orphans.cjs` against the target
-- database first. Required columns (goods_received_notes.supplierId, supplier_invoices.supplierId,
-- rfq_suppliers.supplierId, supplier_quotations.supplierId, bid_comparison_lines.supplierId) must
-- report zero orphans; VALIDATE CONSTRAINT below fails otherwise and the migration stops, which is
-- the intended gate. Nullable references with a missing master are set to NULL, and profile /
-- membership rows pointing at a missing master are deleted; every such row is copied to
-- archive_party_orphans first. Statement runs lose the 'ALL' sentinel: NULL now means a
-- whole-company run.
--
-- Additive except for the archived orphan rows described above (no DROP TABLE / DROP COLUMN).

-- ── archive for orphan rows ───────────────────────────────────────────────────
CREATE TABLE "archive_party_orphans" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "tableName" TEXT NOT NULL,
    "columnName" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "orphanValue" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "row" JSONB NOT NULL,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "archive_party_orphans_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "archive_party_orphans_tableName_columnName_idx" ON "archive_party_orphans"("tableName", "columnName");

-- ── nullable references: archive, then NULL the orphans ───────────────────────
INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'supplier_invoices', 'payableId', r."id", r."payableId", 'NULLED', to_jsonb(r)
FROM "supplier_invoices" r
WHERE r."payableId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "payables" m WHERE m."id" = r."payableId");
UPDATE "supplier_invoices" r SET "payableId" = NULL
WHERE r."payableId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "payables" m WHERE m."id" = r."payableId");

INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'bid_comparisons', 'recommendedSupplierId', r."id", r."recommendedSupplierId", 'NULLED', to_jsonb(r)
FROM "bid_comparisons" r
WHERE r."recommendedSupplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."recommendedSupplierId");
UPDATE "bid_comparisons" r SET "recommendedSupplierId" = NULL
WHERE r."recommendedSupplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."recommendedSupplierId");

INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'request_for_quotations', 'awardedSupplierId', r."id", r."awardedSupplierId", 'NULLED', to_jsonb(r)
FROM "request_for_quotations" r
WHERE r."awardedSupplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."awardedSupplierId");
UPDATE "request_for_quotations" r SET "awardedSupplierId" = NULL
WHERE r."awardedSupplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."awardedSupplierId");

INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'purchase_requisition_lines', 'preferredSupplierId', r."id", r."preferredSupplierId", 'NULLED', to_jsonb(r)
FROM "purchase_requisition_lines" r
WHERE r."preferredSupplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."preferredSupplierId");
UPDATE "purchase_requisition_lines" r SET "preferredSupplierId" = NULL
WHERE r."preferredSupplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."preferredSupplierId");

-- ── statement runs: nullable party, 'ALL' sentinel becomes NULL, orphans NULLED ───────
ALTER TABLE "supplier_statement_runs" ALTER COLUMN "supplierId" DROP NOT NULL;
UPDATE "supplier_statement_runs" SET "supplierId" = NULL WHERE "supplierId" = 'ALL';
INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'supplier_statement_runs', 'supplierId', r."id", r."supplierId", 'NULLED', to_jsonb(r)
FROM "supplier_statement_runs" r
WHERE r."supplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."supplierId");
UPDATE "supplier_statement_runs" r SET "supplierId" = NULL
WHERE r."supplierId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."supplierId");

ALTER TABLE "customer_statement_runs" ALTER COLUMN "customerId" DROP NOT NULL;
UPDATE "customer_statement_runs" SET "customerId" = NULL WHERE "customerId" = 'ALL';
INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'customer_statement_runs', 'customerId', r."id", r."customerId", 'NULLED', to_jsonb(r)
FROM "customer_statement_runs" r
WHERE r."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customers" m WHERE m."id" = r."customerId");
UPDATE "customer_statement_runs" r SET "customerId" = NULL
WHERE r."customerId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "customers" m WHERE m."id" = r."customerId");

-- ── profile / membership rows for a missing master: archive, then delete ──────
INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'supplier_performance_profiles', 'supplierId', r."id", r."supplierId", 'DELETED', to_jsonb(r)
FROM "supplier_performance_profiles" r
WHERE NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."supplierId");
DELETE FROM "supplier_performance_profiles" r
WHERE NOT EXISTS (SELECT 1 FROM "suppliers" m WHERE m."id" = r."supplierId");

INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'customer_credit_profiles', 'customerId', r."id", r."customerId", 'DELETED', to_jsonb(r)
FROM "customer_credit_profiles" r
WHERE NOT EXISTS (SELECT 1 FROM "customers" m WHERE m."id" = r."customerId");
DELETE FROM "customer_credit_profiles" r
WHERE NOT EXISTS (SELECT 1 FROM "customers" m WHERE m."id" = r."customerId");

INSERT INTO "archive_party_orphans" ("tableName", "columnName", "rowId", "orphanValue", "action", "row")
SELECT 'customer_segment_memberships', 'customerId', r."id", r."customerId", 'DELETED', to_jsonb(r)
FROM "customer_segment_memberships" r
WHERE NOT EXISTS (SELECT 1 FROM "customers" m WHERE m."id" = r."customerId");
DELETE FROM "customer_segment_memberships" r
WHERE NOT EXISTS (SELECT 1 FROM "customers" m WHERE m."id" = r."customerId");

-- ── indexes on the newly related columns ──────────────────────────────────────
CREATE INDEX "supplier_invoices_payableId_idx" ON "supplier_invoices"("payableId");
CREATE INDEX "bid_comparisons_recommendedSupplierId_idx" ON "bid_comparisons"("recommendedSupplierId");
CREATE INDEX "request_for_quotations_awardedSupplierId_idx" ON "request_for_quotations"("awardedSupplierId");
CREATE INDEX "purchase_requisition_lines_preferredSupplierId_idx" ON "purchase_requisition_lines"("preferredSupplierId");
CREATE INDEX "customer_segment_memberships_customerId_idx" ON "customer_segment_memberships"("customerId");

-- ── foreign keys: NOT VALID first (short lock), then VALIDATE (fails on required orphans) ─
ALTER TABLE "goods_received_notes" ADD CONSTRAINT "goods_received_notes_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "goods_received_notes" VALIDATE CONSTRAINT "goods_received_notes_supplierId_fkey";

ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "supplier_invoices" VALIDATE CONSTRAINT "supplier_invoices_supplierId_fkey";
ALTER TABLE "supplier_invoices" ADD CONSTRAINT "supplier_invoices_payableId_fkey"
  FOREIGN KEY ("payableId") REFERENCES "payables"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "supplier_invoices" VALIDATE CONSTRAINT "supplier_invoices_payableId_fkey";

ALTER TABLE "rfq_suppliers" ADD CONSTRAINT "rfq_suppliers_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "rfq_suppliers" VALIDATE CONSTRAINT "rfq_suppliers_supplierId_fkey";

ALTER TABLE "supplier_quotations" ADD CONSTRAINT "supplier_quotations_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "supplier_quotations" VALIDATE CONSTRAINT "supplier_quotations_supplierId_fkey";

ALTER TABLE "bid_comparison_lines" ADD CONSTRAINT "bid_comparison_lines_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bid_comparison_lines" VALIDATE CONSTRAINT "bid_comparison_lines_supplierId_fkey";

ALTER TABLE "bid_comparisons" ADD CONSTRAINT "bid_comparisons_recommendedSupplierId_fkey"
  FOREIGN KEY ("recommendedSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "bid_comparisons" VALIDATE CONSTRAINT "bid_comparisons_recommendedSupplierId_fkey";

ALTER TABLE "request_for_quotations" ADD CONSTRAINT "request_for_quotations_awardedSupplierId_fkey"
  FOREIGN KEY ("awardedSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "request_for_quotations" VALIDATE CONSTRAINT "request_for_quotations_awardedSupplierId_fkey";

ALTER TABLE "purchase_requisition_lines" ADD CONSTRAINT "purchase_requisition_lines_preferredSupplierId_fkey"
  FOREIGN KEY ("preferredSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
ALTER TABLE "purchase_requisition_lines" VALIDATE CONSTRAINT "purchase_requisition_lines_preferredSupplierId_fkey";

ALTER TABLE "supplier_performance_profiles" ADD CONSTRAINT "supplier_performance_profiles_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "supplier_performance_profiles" VALIDATE CONSTRAINT "supplier_performance_profiles_supplierId_fkey";

ALTER TABLE "supplier_statement_runs" ADD CONSTRAINT "supplier_statement_runs_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "supplier_statement_runs" VALIDATE CONSTRAINT "supplier_statement_runs_supplierId_fkey";

ALTER TABLE "customer_credit_profiles" ADD CONSTRAINT "customer_credit_profiles_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "customer_credit_profiles" VALIDATE CONSTRAINT "customer_credit_profiles_customerId_fkey";

ALTER TABLE "customer_segment_memberships" ADD CONSTRAINT "customer_segment_memberships_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
ALTER TABLE "customer_segment_memberships" VALIDATE CONSTRAINT "customer_segment_memberships_customerId_fkey";

ALTER TABLE "customer_statement_runs" ADD CONSTRAINT "customer_statement_runs_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;
ALTER TABLE "customer_statement_runs" VALIDATE CONSTRAINT "customer_statement_runs_customerId_fkey";

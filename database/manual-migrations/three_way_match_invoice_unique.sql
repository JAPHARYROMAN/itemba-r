-- One live three-way match per (companyId, supplierInvoiceId). Belt-and-suspenders
-- for the duplicate-active-match guard in ThreeWayMatchingService.create() and the
-- supplier-invoice match-creation path. Dedup first (see README) — this will FAIL
-- if live duplicates exist, which is intentional.
CREATE UNIQUE INDEX IF NOT EXISTS "three_way_matches_company_invoice_unique"
  ON "three_way_matches" ("companyId", "supplierInvoiceId")
  WHERE "deletedAt" IS NULL AND "supplierInvoiceId" IS NOT NULL;

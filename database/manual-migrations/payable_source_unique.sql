-- One live payable per (companyId, sourceType, sourceId). Belt-and-suspenders for
-- the app-level atomic claim in SupplierInvoicesService.approve(). Dedup first
-- (see README) — this will FAIL if live duplicates exist, which is intentional.
CREATE UNIQUE INDEX IF NOT EXISTS "payables_company_source_unique"
  ON "payables" ("companyId", "sourceType", "sourceId")
  WHERE "deletedAt" IS NULL AND "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL;

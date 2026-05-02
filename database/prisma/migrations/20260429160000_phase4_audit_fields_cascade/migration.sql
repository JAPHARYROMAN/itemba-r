-- Phase 4 quality fixes: audit fields on master data + cascade hardening on
-- accounting periods.

-- ─── F-029: createdBy / updatedBy on Customer & Supplier ──────────────────────
ALTER TABLE "customers" ADD COLUMN "createdById" TEXT;
ALTER TABLE "customers" ADD COLUMN "updatedById" TEXT;
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "suppliers" ADD COLUMN "createdById" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "updatedById" TEXT;
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_updatedById_fkey"
  FOREIGN KEY ("updatedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── F-030: AccountingPeriod → FiscalYear cascade hardened to RESTRICT ────────
-- Previously, deleting a fiscal year cascaded into accounting periods (and
-- their journal-entry graph). Now the database refuses to delete a fiscal
-- year that still has accounting periods.
ALTER TABLE "accounting_periods"
  DROP CONSTRAINT IF EXISTS "accounting_periods_fiscalYearId_fkey";
ALTER TABLE "accounting_periods"
  ADD CONSTRAINT "accounting_periods_fiscalYearId_fkey"
  FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Party linkage, Phase 3 (PR-1): the general ledger knows the party. Additive only: three
-- nullable-or-defaulted columns on journal_entry_lines, two indexes, two foreign keys and a
-- CHECK that the id agrees with the type. Existing lines keep partyType 'NONE' until the
-- reviewed backfill script (backend/scripts/backfill-journal-party.cjs) tags them from their
-- referenced documents.
ALTER TABLE "journal_entry_lines"
  ADD COLUMN "partyType" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "customerId" TEXT;

CREATE INDEX "journal_entry_lines_supplierId_idx" ON "journal_entry_lines"("supplierId");
CREATE INDEX "journal_entry_lines_customerId_idx" ON "journal_entry_lines"("customerId");

ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_entry_lines" ADD CONSTRAINT "journal_entry_lines_party" CHECK (
  "partyType" IN ('NONE', 'SUPPLIER', 'CUSTOMER') AND
  ("partyType" <> 'SUPPLIER' OR "supplierId" IS NOT NULL) AND
  ("partyType" <> 'CUSTOMER' OR "customerId" IS NOT NULL) AND
  ("supplierId" IS NULL OR "partyType" = 'SUPPLIER') AND
  ("customerId" IS NULL OR "partyType" = 'CUSTOMER'));

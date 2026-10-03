-- Party linkage, Phase 3 (PR-7): tax rows say who. Additive only: the party behind a tax
-- transaction (type, id, and the TIN / VRN as they stood when the row was booked), two
-- indexes, two foreign keys and a CHECK that the id agrees with the type. Existing rows keep
-- partyType 'NONE'.
ALTER TABLE "tax_transactions"
  ADD COLUMN "partyType" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "customerId" TEXT,
  ADD COLUMN "partyTin" TEXT,
  ADD COLUMN "partyVrn" TEXT;

CREATE INDEX "tax_transactions_supplierId_idx" ON "tax_transactions"("supplierId");
CREATE INDEX "tax_transactions_customerId_idx" ON "tax_transactions"("customerId");

ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tax_transactions" ADD CONSTRAINT "tax_transactions_party" CHECK (
  "partyType" IN ('NONE', 'SUPPLIER', 'CUSTOMER') AND
  ("partyType" <> 'SUPPLIER' OR "supplierId" IS NOT NULL) AND
  ("partyType" <> 'CUSTOMER' OR "customerId" IS NOT NULL) AND
  ("supplierId" IS NULL OR "partyType" = 'SUPPLIER') AND
  ("customerId" IS NULL OR "partyType" = 'CUSTOMER'));

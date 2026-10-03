-- Party linkage, Phase 3 (PR-5): approval requests remember the supplier or customer behind
-- their document. Additive only: three nullable-or-defaulted columns, two indexes, two
-- foreign keys and a CHECK that the id agrees with the type. Existing rows keep 'NONE'.
ALTER TABLE "approval_requests"
  ADD COLUMN "partyType" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  ADD COLUMN "supplierId" TEXT,
  ADD COLUMN "customerId" TEXT;

CREATE INDEX "approval_requests_supplierId_idx" ON "approval_requests"("supplierId");
CREATE INDEX "approval_requests_customerId_idx" ON "approval_requests"("customerId");

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_party" CHECK (
  "partyType" IN ('NONE', 'SUPPLIER', 'CUSTOMER') AND
  ("partyType" <> 'SUPPLIER' OR "supplierId" IS NOT NULL) AND
  ("partyType" <> 'CUSTOMER' OR "customerId" IS NOT NULL) AND
  ("supplierId" IS NULL OR "partyType" = 'SUPPLIER') AND
  ("customerId" IS NULL OR "partyType" = 'CUSTOMER'));

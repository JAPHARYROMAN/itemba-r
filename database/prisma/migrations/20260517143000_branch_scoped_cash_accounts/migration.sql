ALTER TABLE "cash_accounts"
  ADD COLUMN "divisionId" TEXT,
  ADD COLUMN "branchId" TEXT;

CREATE INDEX "cash_accounts_divisionId_idx" ON "cash_accounts"("divisionId");
CREATE INDEX "cash_accounts_branchId_idx" ON "cash_accounts"("branchId");

ALTER TABLE "cash_accounts"
  ADD CONSTRAINT "cash_accounts_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cash_accounts"
  ADD CONSTRAINT "cash_accounts_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

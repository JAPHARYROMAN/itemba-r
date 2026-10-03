-- Party linkage, Phase 3 (PR-3): what the ledger and the sub-ledger said at period close, one
-- row per party and control role in the company base currency, plus one 'NONE' row per role
-- for the control balance that carries no party. Additive only: a new table, three foreign
-- keys, two indexes and a CHECK. Written only by a period close; never read back as a balance.
CREATE TABLE "party_balance_snapshots" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "accountingPeriodId" TEXT NOT NULL,
  "periodCloseId" TEXT,
  "role" VARCHAR(2) NOT NULL,
  "partyType" VARCHAR(10) NOT NULL DEFAULT 'NONE',
  "partyId" TEXT,
  "partyName" TEXT,
  "currency" TEXT NOT NULL,
  "subLedger" DECIMAL(18,2) NOT NULL,
  "control" DECIMAL(18,2) NOT NULL,
  "difference" DECIMAL(18,2) NOT NULL,
  "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdById" TEXT,
  CONSTRAINT "party_balance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "party_balance_snapshots_companyId_accountingPeriodId_idx"
  ON "party_balance_snapshots"("companyId", "accountingPeriodId");
CREATE INDEX "party_balance_snapshots_partyType_partyId_idx"
  ON "party_balance_snapshots"("partyType", "partyId");

ALTER TABLE "party_balance_snapshots" ADD CONSTRAINT "party_balance_snapshots_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_balance_snapshots" ADD CONSTRAINT "party_balance_snapshots_accountingPeriodId_fkey"
  FOREIGN KEY ("accountingPeriodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "party_balance_snapshots" ADD CONSTRAINT "party_balance_snapshots_periodCloseId_fkey"
  FOREIGN KEY ("periodCloseId") REFERENCES "accounting_period_closes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "party_balance_snapshots" ADD CONSTRAINT "party_balance_snapshots_party" CHECK (
  "role" IN ('AP', 'AR') AND
  "partyType" IN ('NONE', 'SUPPLIER', 'CUSTOMER') AND
  (("partyType" = 'NONE') = ("partyId" IS NULL)));

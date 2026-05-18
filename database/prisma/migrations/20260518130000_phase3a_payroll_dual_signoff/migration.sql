-- Phase 3A: Payroll dual sign-off (Group HR Director + Company CFO).
--
-- The existing `approvedById` / `approvedAt` are kept as the FINAL sign-off
-- (set automatically once both HR and Finance approvals are recorded).
-- Two new fields capture each side independently so maker-checker can be
-- enforced (the same user cannot hold both signatures).

ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "hrApprovedById" TEXT;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "hrApprovedAt" TIMESTAMP(3);
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "financeApprovedById" TEXT;
ALTER TABLE "payroll_runs" ADD COLUMN IF NOT EXISTS "financeApprovedAt" TIMESTAMP(3);

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_hrApprovedById_fkey"
  FOREIGN KEY ("hrApprovedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_financeApprovedById_fkey"
  FOREIGN KEY ("financeApprovedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "payroll_runs_companyId_hrApprovedById_idx"
  ON "payroll_runs"("companyId", "hrApprovedById");

CREATE INDEX IF NOT EXISTS "payroll_runs_companyId_financeApprovedById_idx"
  ON "payroll_runs"("companyId", "financeApprovedById");

-- Backfill: for runs that are already APPROVED, both signatures are presumed
-- to be the single existing approver. This keeps historical data consistent
-- without requiring a re-approval cycle. The maker-checker rule only applies
-- to NEW runs going forward.
UPDATE "payroll_runs"
SET "hrApprovedById"      = "approvedById",
    "hrApprovedAt"        = "approvedAt",
    "financeApprovedById" = "approvedById",
    "financeApprovedAt"   = "approvedAt"
WHERE "approvedById" IS NOT NULL
  AND ("hrApprovedById" IS NULL OR "financeApprovedById" IS NULL);

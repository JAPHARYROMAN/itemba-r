ALTER TYPE "GeneratedDocumentFormat" ADD VALUE IF NOT EXISTS 'EXCEL';
ALTER TYPE "BackgroundJobType" ADD VALUE IF NOT EXISTS 'RENT_INVOICE_GENERATION';

ALTER TABLE "payroll_runs"
  ADD COLUMN IF NOT EXISTS "hrApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "hrApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "financeApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "financeApprovedAt" TIMESTAMP(3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_hrApprovedById_fkey'
  ) THEN
    ALTER TABLE "payroll_runs"
      ADD CONSTRAINT "payroll_runs_hrApprovedById_fkey"
      FOREIGN KEY ("hrApprovedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'payroll_runs_financeApprovedById_fkey'
  ) THEN
    ALTER TABLE "payroll_runs"
      ADD CONSTRAINT "payroll_runs_financeApprovedById_fkey"
      FOREIGN KEY ("financeApprovedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

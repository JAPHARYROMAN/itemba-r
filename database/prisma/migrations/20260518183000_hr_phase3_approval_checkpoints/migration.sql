ALTER TYPE "DisciplinaryActionStatus" ADD VALUE IF NOT EXISTS 'PENDING_HR_APPROVAL';
ALTER TYPE "DisciplinaryActionStatus" ADD VALUE IF NOT EXISTS 'PENDING_GM_APPROVAL';

ALTER TABLE "employees"
  ADD COLUMN IF NOT EXISTS "pendingTerminationDate" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terminationRequestedById" TEXT,
  ADD COLUMN IF NOT EXISTS "terminationRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terminationReason" TEXT,
  ADD COLUMN IF NOT EXISTS "terminationHrApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "terminationHrApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "terminationGmApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "terminationGmApprovedAt" TIMESTAMP(3);

ALTER TABLE "employee_assignments"
  ADD COLUMN IF NOT EXISTS "approvalStatus" TEXT NOT NULL DEFAULT 'APPROVED',
  ADD COLUMN IF NOT EXISTS "transferRequestedById" TEXT,
  ADD COLUMN IF NOT EXISTS "transferRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sourceDivisionApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceDivisionApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "targetDivisionApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "targetDivisionApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "companyGmApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "companyGmApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "groupHrApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "groupHrApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "groupCfoApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "groupCfoApprovedAt" TIMESTAMP(3);

ALTER TABLE "leave_requests"
  ADD COLUMN IF NOT EXISTS "lineApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "lineApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "groupHrApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "groupHrApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "approvalNotes" TEXT;

ALTER TABLE "disciplinary_actions"
  ADD COLUMN IF NOT EXISTS "hrApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "hrApprovedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "gmApprovedById" TEXT,
  ADD COLUMN IF NOT EXISTS "gmApprovedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "employee_assignments_company_approval_status_idx"
  ON "employee_assignments"("companyId", "approvalStatus");

CREATE INDEX IF NOT EXISTS "leave_requests_company_status_start_date_idx"
  ON "leave_requests"("companyId", "status", "startDate");

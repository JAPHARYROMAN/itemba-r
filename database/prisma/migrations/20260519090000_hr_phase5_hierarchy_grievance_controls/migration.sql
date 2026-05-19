-- HR audit Phase 5: branch/division scope on HR records, HR document soft-delete,
-- and direct Group HR grievance tracking.

ALTER TABLE "attendance_records"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "leave_requests"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "performance_records"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT;

ALTER TABLE "hr_documents"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT,
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

ALTER TABLE "employment_disputes"
  ADD COLUMN IF NOT EXISTS "divisionId" TEXT,
  ADD COLUMN IF NOT EXISTS "branchId" TEXT,
  ADD COLUMN IF NOT EXISTS "directToGroupHr" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "groupHrNotifiedAt" TIMESTAMP(3);

-- Backfill employee-scoped HR records from the employee's current hierarchy.
UPDATE "attendance_records" ar
SET
  "divisionId" = COALESCE(ar."divisionId", e."divisionId"),
  "branchId" = COALESCE(ar."branchId", e."branchId")
FROM "employees" e
WHERE ar."employeeId" = e.id
  AND (ar."divisionId" IS NULL OR ar."branchId" IS NULL);

UPDATE "leave_requests" lr
SET
  "divisionId" = COALESCE(lr."divisionId", e."divisionId"),
  "branchId" = COALESCE(lr."branchId", e."branchId")
FROM "employees" e
WHERE lr."employeeId" = e.id
  AND (lr."divisionId" IS NULL OR lr."branchId" IS NULL);

UPDATE "performance_records" pr
SET
  "divisionId" = COALESCE(pr."divisionId", e."divisionId"),
  "branchId" = COALESCE(pr."branchId", e."branchId")
FROM "employees" e
WHERE pr."employeeId" = e.id
  AND (pr."divisionId" IS NULL OR pr."branchId" IS NULL);

UPDATE "hr_documents" hd
SET
  "divisionId" = COALESCE(hd."divisionId", e."divisionId"),
  "branchId" = COALESCE(hd."branchId", e."branchId")
FROM "employees" e
WHERE hd."employeeId" = e.id
  AND (hd."divisionId" IS NULL OR hd."branchId" IS NULL);

UPDATE "employment_disputes" ed
SET
  "divisionId" = COALESCE(ed."divisionId", e."divisionId"),
  "branchId" = COALESCE(ed."branchId", e."branchId")
FROM "employees" e
WHERE ed."employeeId" = e.id
  AND (ed."divisionId" IS NULL OR ed."branchId" IS NULL);

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "attendance_records"
  ADD CONSTRAINT "attendance_records_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "performance_records"
  ADD CONSTRAINT "performance_records_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "performance_records"
  ADD CONSTRAINT "performance_records_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hr_documents"
  ADD CONSTRAINT "hr_documents_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "hr_documents"
  ADD CONSTRAINT "hr_documents_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employment_disputes"
  ADD CONSTRAINT "employment_disputes_divisionId_fkey"
  FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employment_disputes"
  ADD CONSTRAINT "employment_disputes_branchId_fkey"
  FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "attendance_records_divisionId_attendanceDate_idx"
  ON "attendance_records"("divisionId", "attendanceDate");

CREATE INDEX IF NOT EXISTS "attendance_records_branchId_attendanceDate_idx"
  ON "attendance_records"("branchId", "attendanceDate");

CREATE INDEX IF NOT EXISTS "leave_requests_divisionId_status_startDate_idx"
  ON "leave_requests"("divisionId", "status", "startDate");

CREATE INDEX IF NOT EXISTS "leave_requests_branchId_status_startDate_idx"
  ON "leave_requests"("branchId", "status", "startDate");

CREATE INDEX IF NOT EXISTS "performance_records_divisionId_reviewDate_idx"
  ON "performance_records"("divisionId", "reviewDate");

CREATE INDEX IF NOT EXISTS "performance_records_branchId_reviewDate_idx"
  ON "performance_records"("branchId", "reviewDate");

CREATE INDEX IF NOT EXISTS "hr_documents_companyId_documentCategory_createdAt_idx"
  ON "hr_documents"("companyId", "documentCategory", "createdAt");

CREATE INDEX IF NOT EXISTS "hr_documents_divisionId_documentCategory_createdAt_idx"
  ON "hr_documents"("divisionId", "documentCategory", "createdAt");

CREATE INDEX IF NOT EXISTS "hr_documents_branchId_documentCategory_createdAt_idx"
  ON "hr_documents"("branchId", "documentCategory", "createdAt");

CREATE INDEX IF NOT EXISTS "hr_documents_employeeId_documentCategory_createdAt_idx"
  ON "hr_documents"("employeeId", "documentCategory", "createdAt");

CREATE INDEX IF NOT EXISTS "employment_disputes_divisionId_status_idx"
  ON "employment_disputes"("divisionId", "status");

CREATE INDEX IF NOT EXISTS "employment_disputes_branchId_status_idx"
  ON "employment_disputes"("branchId", "status");

CREATE INDEX IF NOT EXISTS "employment_disputes_directToGroupHr_status_idx"
  ON "employment_disputes"("directToGroupHr", "status");

-- HR audit Phase 4: leave entitlement balances and payroll tax-filing linkage.

CREATE TABLE IF NOT EXISTS "leave_balances" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "leaveTypeId" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "allocatedDays" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "carriedForwardDays" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "usedDays" DECIMAL(8,2) NOT NULL DEFAULT 0,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "leave_balances_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "leave_balances"
  ADD CONSTRAINT "leave_balances_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_balances"
  ADD CONSTRAINT "leave_balances_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_balances"
  ADD CONSTRAINT "leave_balances_leaveTypeId_fkey"
  FOREIGN KEY ("leaveTypeId") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS "leave_balances_companyId_employeeId_leaveTypeId_year_key"
  ON "leave_balances"("companyId", "employeeId", "leaveTypeId", "year");

CREATE INDEX IF NOT EXISTS "leave_balances_companyId_year_idx"
  ON "leave_balances"("companyId", "year");

CREATE INDEX IF NOT EXISTS "leave_balances_employeeId_year_idx"
  ON "leave_balances"("employeeId", "year");

-- Seed balances from historical approved leave so the table starts consistent.
INSERT INTO "leave_balances" (
  "id",
  "companyId",
  "employeeId",
  "leaveTypeId",
  "year",
  "allocatedDays",
  "carriedForwardDays",
  "usedDays",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(
    'leave_balance:' ||
    lr."companyId" || ':' ||
    lr."employeeId" || ':' ||
    lr."leaveTypeId" || ':' ||
    EXTRACT(YEAR FROM lr."startDate")::int
  ),
  lr."companyId",
  lr."employeeId",
  lr."leaveTypeId",
  EXTRACT(YEAR FROM lr."startDate")::int,
  COALESCE(MAX(lt."annualAllowanceDays"), 0),
  0,
  COALESCE(SUM(lr."totalDays"), 0),
  'Backfilled from approved leave requests during HR Phase 4 migration.',
  NOW(),
  NOW()
FROM "leave_requests" lr
JOIN "leave_types" lt ON lt.id = lr."leaveTypeId"
WHERE lr."deletedAt" IS NULL
  AND lr.status = 'APPROVED'
GROUP BY
  lr."companyId",
  lr."employeeId",
  lr."leaveTypeId",
  EXTRACT(YEAR FROM lr."startDate")::int
ON CONFLICT ("companyId", "employeeId", "leaveTypeId", "year") DO UPDATE
SET
  "allocatedDays" = EXCLUDED."allocatedDays",
  "usedDays" = EXCLUDED."usedDays",
  "updatedAt" = NOW();

ALTER TABLE "payroll_statutory_lines"
  ADD COLUMN IF NOT EXISTS "taxFilingPeriodId" TEXT;

CREATE INDEX IF NOT EXISTS "payroll_statutory_lines_taxFilingPeriodId_idx"
  ON "payroll_statutory_lines"("taxFilingPeriodId");

ALTER TABLE "payroll_statutory_lines"
  ADD CONSTRAINT "payroll_statutory_lines_taxFilingPeriodId_fkey"
  FOREIGN KEY ("taxFilingPeriodId") REFERENCES "tax_filing_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link historical payroll statutory lines to filing periods where payroll
-- period dates are available.
WITH source_periods AS (
  SELECT DISTINCT
    pr."companyId",
    psl."taxTypeId",
    pp."startDate" AS "periodStart",
    pp."endDate" AS "periodEnd",
    tt."taxTypeCode",
    tt.name AS "taxTypeName"
  FROM "payroll_statutory_lines" psl
  JOIN "payroll_entries" pe ON pe.id = psl."payrollEntryId"
  JOIN "payroll_runs" pr ON pr.id = pe."payrollRunId"
  JOIN "payroll_periods" pp ON pp.id = pr."payrollPeriodId"
  JOIN "tax_types" tt ON tt.id = psl."taxTypeId"
  WHERE psl."taxFilingPeriodId" IS NULL
    AND pe."deletedAt" IS NULL
    AND pr."deletedAt" IS NULL
    AND pp."startDate" IS NOT NULL
    AND pp."endDate" IS NOT NULL
),
upserted_periods AS (
  INSERT INTO "tax_filing_periods" (
    id,
    "filingPeriodCode",
    "companyId",
    "taxTypeId",
    name,
    "periodStart",
    "periodEnd",
    "filingFrequency",
    status,
    notes,
    "createdAt",
    "updatedAt"
  )
  SELECT
    md5(
      'payroll_tax_period:' ||
      sp."companyId" || ':' ||
      sp."taxTypeId" || ':' ||
      to_char(sp."periodStart", 'YYYY-MM-DD') || ':' ||
      to_char(sp."periodEnd", 'YYYY-MM-DD')
    ),
    CONCAT(
      'PAYROLL-',
      UPPER(REGEXP_REPLACE(sp."taxTypeCode", '[^A-Za-z0-9]+', '_', 'g')),
      '-',
      to_char(sp."periodStart", 'YYYY-MM-DD'),
      '-',
      to_char(sp."periodEnd", 'YYYY-MM-DD')
    ),
    sp."companyId",
    sp."taxTypeId",
    CONCAT(
      sp."taxTypeName",
      ' payroll ',
      to_char(sp."periodStart", 'YYYY-MM-DD'),
      ' to ',
      to_char(sp."periodEnd", 'YYYY-MM-DD')
    ),
    sp."periodStart",
    sp."periodEnd",
    'MONTHLY',
    'OPEN',
    'Auto-created from historical payroll statutory lines during HR Phase 4 migration.',
    NOW(),
    NOW()
  FROM source_periods sp
  ON CONFLICT ("companyId", "filingPeriodCode") DO UPDATE
  SET
    "taxTypeId" = EXCLUDED."taxTypeId",
    "periodStart" = EXCLUDED."periodStart",
    "periodEnd" = EXCLUDED."periodEnd",
    "updatedAt" = NOW()
  RETURNING id, "companyId", "filingPeriodCode"
)
UPDATE "payroll_statutory_lines" psl
SET "taxFilingPeriodId" = tfp.id
FROM "payroll_entries" pe
JOIN "payroll_runs" pr ON pr.id = pe."payrollRunId"
JOIN "payroll_periods" pp ON pp.id = pr."payrollPeriodId"
JOIN "tax_types" tt ON TRUE
JOIN "tax_filing_periods" tfp ON tfp."companyId" = pr."companyId"
  AND tfp."filingPeriodCode" = CONCAT(
    'PAYROLL-',
    UPPER(REGEXP_REPLACE(tt."taxTypeCode", '[^A-Za-z0-9]+', '_', 'g')),
    '-',
    to_char(pp."startDate", 'YYYY-MM-DD'),
    '-',
    to_char(pp."endDate", 'YYYY-MM-DD')
  )
WHERE pe.id = psl."payrollEntryId"
  AND tt.id = psl."taxTypeId"
  AND psl."taxFilingPeriodId" IS NULL
  AND pe."deletedAt" IS NULL
  AND pr."deletedAt" IS NULL;

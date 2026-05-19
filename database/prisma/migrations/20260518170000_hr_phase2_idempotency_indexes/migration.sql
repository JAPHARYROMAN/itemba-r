-- HR audit Phase 2: enforce natural keys and single active payroll disbursement targets.

-- Preserve the earliest active attendance row for each employee/day and
-- soft-archive later duplicates before enforcing the daily natural key.
WITH ranked_attendance AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "companyId", "employeeId", ("attendanceDate"::date)
      ORDER BY "createdAt" ASC, id ASC
    ) AS rn
  FROM "attendance_records"
  WHERE "deletedAt" IS NULL
)
UPDATE "attendance_records" ar
SET
  "deletedAt" = NOW(),
  notes = CONCAT(
    COALESCE(ar.notes || E'\n', ''),
    'Auto-archived duplicate attendance record during HR Phase 2 migration.'
  )
FROM ranked_attendance ranked
WHERE ar.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "attendance_records_company_employee_day_active_key"
  ON "attendance_records"(
    "companyId",
    "employeeId",
    ("attendanceDate"::date)
  )
  WHERE "deletedAt" IS NULL;

-- Keep one active primary mobile-money account per employee. When historical
-- data has multiple primaries, keep the newest and demote the rest.
WITH ranked_mobile_money AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "employeeId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM "mobile_money_accounts"
  WHERE "deletedAt" IS NULL
    AND "isPrimary" = true
)
UPDATE "mobile_money_accounts" mma
SET
  "isPrimary" = false,
  notes = CONCAT(
    COALESCE(mma.notes || E'\n', ''),
    'Auto-demoted duplicate primary mobile-money account during HR Phase 2 migration.'
  )
FROM ranked_mobile_money ranked
WHERE mma.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "mobile_money_accounts_employee_active_primary_key"
  ON "mobile_money_accounts"("employeeId")
  WHERE "deletedAt" IS NULL
    AND "isPrimary" = true;

-- Keep one active primary assignment per employee. Secondary project/context
-- assignments can still overlap, but payroll now has a single primary row.
WITH ranked_assignments AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY "employeeId"
      ORDER BY "updatedAt" DESC, "createdAt" DESC, id DESC
    ) AS rn
  FROM "employee_assignments"
  WHERE "deletedAt" IS NULL
    AND status = 'ACTIVE'
    AND "isPrimary" = true
)
UPDATE "employee_assignments" ea
SET
  "isPrimary" = false,
  notes = CONCAT(
    COALESCE(ea.notes || E'\n', ''),
    'Auto-demoted duplicate active primary assignment during HR Phase 2 migration.'
  )
FROM ranked_assignments ranked
WHERE ea.id = ranked.id
  AND ranked.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "employee_assignments_employee_active_primary_key"
  ON "employee_assignments"("employeeId")
  WHERE "deletedAt" IS NULL
    AND status = 'ACTIVE'
    AND "isPrimary" = true;

-- Backfill open fiscal years and monthly accounting periods required by
-- operations-to-finance postings. This is idempotent and only inserts missing
-- rows for live companies.

WITH bounds AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS current_year
),
target_years AS (
  SELECT generate_series(
    GREATEST(2024, (SELECT current_year FROM bounds) - 2),
    (SELECT current_year FROM bounds) + 1
  ) AS year
)
INSERT INTO "fiscal_years" (
  "id",
  "companyId",
  "name",
  "startDate",
  "endDate",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(c."id" || ':fy:' || target_years.year::text),
  c."id",
  'FY ' || target_years.year::text,
  make_date(target_years.year, 1, 1)::timestamp,
  make_date(target_years.year, 12, 31)::timestamp,
  'OPEN'::"FiscalPeriodStatus",
  now(),
  now()
FROM "companies" c
CROSS JOIN target_years
WHERE
  c."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "fiscal_years" fy
    WHERE
      fy."companyId" = c."id"
      AND fy."name" = 'FY ' || target_years.year::text
  );

WITH bounds AS (
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::int AS current_year
),
target_years AS (
  SELECT generate_series(
    GREATEST(2024, (SELECT current_year FROM bounds) - 2),
    (SELECT current_year FROM bounds) + 1
  ) AS year
),
target_months AS (
  SELECT generate_series(1, 12) AS month
),
targets AS (
  SELECT
    c."id" AS "companyId",
    fy."id" AS "fiscalYearId",
    target_years.year,
    target_months.month,
    make_date(target_years.year, target_months.month, 1) AS "startDate",
    (make_date(target_years.year, target_months.month, 1) + INTERVAL '1 month - 1 day')::date AS "endDate"
  FROM "companies" c
  CROSS JOIN target_years
  CROSS JOIN target_months
  JOIN "fiscal_years" fy
    ON fy."companyId" = c."id"
   AND fy."name" = 'FY ' || target_years.year::text
  WHERE c."deletedAt" IS NULL
)
INSERT INTO "accounting_periods" (
  "id",
  "companyId",
  "fiscalYearId",
  "name",
  "startDate",
  "endDate",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(targets."companyId" || ':period:' || targets.year::text || ':' || lpad(targets.month::text, 2, '0')),
  targets."companyId",
  targets."fiscalYearId",
  to_char(targets."startDate", 'FMMonth YYYY'),
  targets."startDate"::timestamp,
  targets."endDate"::timestamp,
  'OPEN'::"FiscalPeriodStatus",
  now(),
  now()
FROM targets
WHERE NOT EXISTS (
  SELECT 1
  FROM "accounting_periods" ap
  WHERE
    ap."fiscalYearId" = targets."fiscalYearId"
    AND ap."name" = to_char(targets."startDate", 'FMMonth YYYY')
);

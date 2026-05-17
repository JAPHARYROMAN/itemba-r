-- Add system ledger accounts required by the finance posting engine.
-- IDs are deterministic text hashes so this migration does not depend on a
-- database UUID extension.

INSERT INTO "chart_of_accounts" (
  "id",
  "companyId",
  "accountCode",
  "accountName",
  "accountType",
  "accountSubType",
  "isSystemAccount",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(c."id" || ':coa:1599'),
  c."id",
  '1599',
  'Accumulated Depreciation',
  'ASSET'::"AccountType",
  'accumulated_depreciation',
  true,
  true,
  now(),
  now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1
  FROM "chart_of_accounts" coa
  WHERE coa."companyId" = c."id"
    AND (coa."accountCode" = '1599' OR coa."accountName" = 'Accumulated Depreciation')
);

INSERT INTO "chart_of_accounts" (
  "id",
  "companyId",
  "accountCode",
  "accountName",
  "accountType",
  "accountSubType",
  "isSystemAccount",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(c."id" || ':coa:3900'),
  c."id",
  '3900',
  'Income Summary',
  'EQUITY'::"AccountType",
  'income_summary',
  true,
  true,
  now(),
  now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1
  FROM "chart_of_accounts" coa
  WHERE coa."companyId" = c."id"
    AND (coa."accountCode" = '3900' OR coa."accountName" = 'Income Summary')
);

INSERT INTO "chart_of_accounts" (
  "id",
  "companyId",
  "accountCode",
  "accountName",
  "accountType",
  "accountSubType",
  "isSystemAccount",
  "isActive",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(c."id" || ':coa:5500'),
  c."id",
  '5500',
  'Depreciation Expense',
  'EXPENSE'::"AccountType",
  'depreciation_expense',
  true,
  true,
  now(),
  now()
FROM "companies" c
WHERE NOT EXISTS (
  SELECT 1
  FROM "chart_of_accounts" coa
  WHERE coa."companyId" = c."id"
    AND (coa."accountCode" = '5500' OR coa."accountName" = 'Depreciation Expense')
);

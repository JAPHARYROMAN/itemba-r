-- Ensure every live company has the semantic chart-of-accounts entries used
-- by operations postings. The resolver prefers accountSubType, so this also
-- tags existing standard-code accounts before inserting missing ones.

WITH required_accounts("accountCode", "accountName", "accountType", "accountSubType") AS (
  VALUES
    ('1000', 'Cash on Hand', 'ASSET', 'cash_on_hand'),
    ('1010', 'Bank', 'ASSET', 'bank'),
    ('1100', 'Accounts Receivable', 'ASSET', 'ar_control'),
    ('1200', 'Inventory', 'ASSET', 'inventory_asset'),
    ('1500', 'Fixed Assets', 'ASSET', 'fixed_asset'),
    ('2000', 'Accounts Payable', 'LIABILITY', 'ap_control'),
    ('2200', 'Taxes Payable', 'LIABILITY', 'tax_vat_payable'),
    ('4000', 'Sales Revenue', 'INCOME', 'sales_revenue'),
    ('5000', 'Cost of Goods Sold', 'COST_OF_GOODS_SOLD', 'cost_of_goods_sold'),
    ('6900', 'General Expense', 'EXPENSE', 'general_expense')
)
UPDATE "chart_of_accounts" coa
SET
  "accountType" = required_accounts."accountType"::"AccountType",
  "accountSubType" = required_accounts."accountSubType",
  "isSystemAccount" = true,
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = now()
FROM required_accounts, "companies" c
WHERE
  coa."companyId" = c."id"
  AND c."deletedAt" IS NULL
  AND coa."accountCode" = required_accounts."accountCode";

WITH required_accounts("accountCode", "accountName", "accountType", "accountSubType") AS (
  VALUES
    ('1000', 'Cash on Hand', 'ASSET', 'cash_on_hand'),
    ('1010', 'Bank', 'ASSET', 'bank'),
    ('1100', 'Accounts Receivable', 'ASSET', 'ar_control'),
    ('1200', 'Inventory', 'ASSET', 'inventory_asset'),
    ('1500', 'Fixed Assets', 'ASSET', 'fixed_asset'),
    ('2000', 'Accounts Payable', 'LIABILITY', 'ap_control'),
    ('2200', 'Taxes Payable', 'LIABILITY', 'tax_vat_payable'),
    ('4000', 'Sales Revenue', 'INCOME', 'sales_revenue'),
    ('5000', 'Cost of Goods Sold', 'COST_OF_GOODS_SOLD', 'cost_of_goods_sold'),
    ('6900', 'General Expense', 'EXPENSE', 'general_expense')
)
UPDATE "chart_of_accounts" coa
SET
  "accountType" = required_accounts."accountType"::"AccountType",
  "accountSubType" = required_accounts."accountSubType",
  "isSystemAccount" = true,
  "isActive" = true,
  "deletedAt" = NULL,
  "updatedAt" = now()
FROM required_accounts, "companies" c
WHERE
  coa."companyId" = c."id"
  AND c."deletedAt" IS NULL
  AND coa."accountName" = required_accounts."accountName"
  AND NOT EXISTS (
    SELECT 1
    FROM required_accounts by_code
    WHERE by_code."accountCode" = coa."accountCode"
  );

WITH required_accounts("accountCode", "accountName", "accountType", "accountSubType") AS (
  VALUES
    ('1000', 'Cash on Hand', 'ASSET', 'cash_on_hand'),
    ('1010', 'Bank', 'ASSET', 'bank'),
    ('1100', 'Accounts Receivable', 'ASSET', 'ar_control'),
    ('1200', 'Inventory', 'ASSET', 'inventory_asset'),
    ('1500', 'Fixed Assets', 'ASSET', 'fixed_asset'),
    ('2000', 'Accounts Payable', 'LIABILITY', 'ap_control'),
    ('2200', 'Taxes Payable', 'LIABILITY', 'tax_vat_payable'),
    ('4000', 'Sales Revenue', 'INCOME', 'sales_revenue'),
    ('5000', 'Cost of Goods Sold', 'COST_OF_GOODS_SOLD', 'cost_of_goods_sold'),
    ('6900', 'General Expense', 'EXPENSE', 'general_expense')
)
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
  md5(c."id" || ':coa:' || required_accounts."accountCode"),
  c."id",
  required_accounts."accountCode",
  required_accounts."accountName",
  required_accounts."accountType"::"AccountType",
  required_accounts."accountSubType",
  true,
  true,
  now(),
  now()
FROM "companies" c
CROSS JOIN required_accounts
WHERE
  c."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "chart_of_accounts" coa
    WHERE
      coa."companyId" = c."id"
      AND coa."accountCode" = required_accounts."accountCode"
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "chart_of_accounts" coa
    WHERE
      coa."companyId" = c."id"
      AND coa."accountName" = required_accounts."accountName"
  );

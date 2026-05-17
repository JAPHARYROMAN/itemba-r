-- Sales receipts post against cash_accounts. Existing company bank_accounts
-- are mirrored as BANK-type cash accounts so they can be selected in sales,
-- fuel, hospitality, and other receipt/payment forms.

UPDATE "cash_accounts" c
SET
  "companyId" = b."companyId",
  "accountName" = b."bankName" || ' - ' || b."accountName" ||
    CASE
      WHEN b."accountNumber" IS NULL OR b."accountNumber" = '' THEN ''
      ELSE ' (' || RIGHT(b."accountNumber", 4) || ')'
    END,
  "accountType" = 'BANK'::"CashAccountType",
  "currency" = b."currency",
  "isActive" = b."isActive",
  "updatedAt" = CURRENT_TIMESTAMP
FROM "bank_accounts" b
WHERE c."linkedBankAccountId" = b."id"
  AND c."deletedAt" IS NULL
  AND b."companyId" IS NOT NULL
  AND b."deletedAt" IS NULL;

INSERT INTO "cash_accounts" (
  "id",
  "companyId",
  "linkedBankAccountId",
  "accountName",
  "accountType",
  "currency",
  "openingBalance",
  "currentBalance",
  "isActive",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  'bank-cash-' || b."id",
  b."companyId",
  b."id",
  b."bankName" || ' - ' || b."accountName" ||
    CASE
      WHEN b."accountNumber" IS NULL OR b."accountNumber" = '' THEN ''
      ELSE ' (' || RIGHT(b."accountNumber", 4) || ')'
    END,
  'BANK'::"CashAccountType",
  b."currency",
  0,
  0,
  b."isActive",
  'Auto-created from bank account for sales receipts and payments.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "bank_accounts" b
WHERE b."companyId" IS NOT NULL
  AND b."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "cash_accounts" c
    WHERE c."linkedBankAccountId" = b."id"
      AND c."deletedAt" IS NULL
  );

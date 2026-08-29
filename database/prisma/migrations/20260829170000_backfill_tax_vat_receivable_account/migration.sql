-- Guarantee the input-VAT receivable account (resolver role TAX_VAT_RECEIVABLE)
-- for every live company, mirroring the tax_vat_payable backfill
-- (20260530120000). The expense approval path now REQUIRES the resolved
-- account to carry accountSubType 'tax_vat_receivable' before it debits
-- recoverable input VAT into it.
--
-- Deliberately NARROWER than the 20260530 pattern: an existing 1400/1410 is
-- NOT blindly retagged — a chart may use 1400 for something unrelated (e.g.
-- Prepaid Rent), and retagging would permanently route input VAT into it, the
-- exact silent mis-posting the approval-time subtype guard exists to prevent.
-- Only accounts whose NAME unmistakably identifies them as a VAT/input-tax
-- receivable are tagged; every other chart with a bare 1400/1410 keeps it
-- untouched and fails loudly at taxable approval until the operator tags the
-- right account.

-- 1) Tag existing active accounts that are unmistakably the VAT receivable.
UPDATE "chart_of_accounts" coa
SET
  "accountSubType" = 'tax_vat_receivable',
  "updatedAt" = now()
FROM "companies" c
WHERE
  coa."companyId" = c."id"
  AND c."deletedAt" IS NULL
  AND coa."deletedAt" IS NULL
  AND coa."isActive" = true
  AND (coa."accountSubType" IS NULL OR coa."accountSubType" = '')
  AND coa."accountType" = 'ASSET'
  AND (
    coa."accountName" ILIKE '%vat receivable%'
    OR coa."accountName" ILIKE '%vat recoverable%'
    OR coa."accountName" ILIKE '%input vat%'
    OR coa."accountName" ILIKE '%vat input%'
  );

-- 2) Insert the account only where the company has no candidate at all: no
--    tax_vat_receivable subtype, no 1400/1410 code (never collide with an
--    existing code), and no account already holding the name (companyId +
--    accountName is unique).
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
  md5(c."id" || ':coa:1400'),
  c."id",
  '1400',
  'VAT Receivable (Input VAT)',
  'ASSET'::"AccountType",
  'tax_vat_receivable',
  true,
  true,
  now(),
  now()
FROM "companies" c
WHERE
  c."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "chart_of_accounts" coa
    WHERE
      coa."companyId" = c."id"
      AND lower(coa."accountSubType") = 'tax_vat_receivable'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "chart_of_accounts" coa
    WHERE
      coa."companyId" = c."id"
      AND coa."accountCode" IN ('1400', '1410')
  )
  AND NOT EXISTS (
    SELECT 1
    FROM "chart_of_accounts" coa
    WHERE
      coa."companyId" = c."id"
      AND coa."accountName" = 'VAT Receivable (Input VAT)'
  );

-- Production upgrade rehearsal: exactly which EXISTING rows the pending
-- migrations will change. Read-only; run BEFORE migrating. Safe to run on
-- production itself (it only selects), but the rehearsal runs it on the copy.
--
-- Of the 57 migrations pending since the last production deploy (91d5862b),
-- only these four touch rows that already exist. Everything else creates new
-- tables or adds empty columns.

\echo
\echo '== 1. 20260827020000_supplier_invoice_active_match_uniqueness'
\echo '   A supplier invoice keeps only its newest active three-way match;'
\echo '   the older ones below get deletedAt set (soft delete, recoverable).'
SELECT m."supplierInvoiceId", m."id" AS "match_to_soft_delete", m."matchNumber", m."createdAt"
FROM (
  SELECT *, row_number() OVER (
    PARTITION BY "supplierInvoiceId" ORDER BY "createdAt" DESC, "id" DESC) AS rank
  FROM "three_way_matches"
  WHERE "supplierInvoiceId" IS NOT NULL AND "deletedAt" IS NULL
) m
WHERE m.rank > 1
ORDER BY m."supplierInvoiceId", m."createdAt";

\echo
\echo '== 2a. 20260829170000_backfill_tax_vat_receivable_account'
\echo '   Existing accounts that will be tagged as VAT receivable:'
SELECT c."code" AS company, a."accountCode", a."accountName"
FROM "chart_of_accounts" a
JOIN "companies" c ON c."id" = a."companyId" AND c."deletedAt" IS NULL
WHERE a."deletedAt" IS NULL AND a."isActive" = true
  AND (a."accountSubType" IS NULL OR a."accountSubType" = '')
  AND a."accountType" = 'ASSET'
  AND (a."accountName" ILIKE '%vat receivable%' OR a."accountName" ILIKE '%vat recoverable%'
       OR a."accountName" ILIKE '%input vat%' OR a."accountName" ILIKE '%vat input%')
ORDER BY 1, 2;

\echo
\echo '== 2b. Companies that will get a NEW account 1400 "VAT Receivable (Input VAT)":'
\echo '   (no VAT-receivable account yet and codes 1400/1410 unused; runs after 2a)'
SELECT c."code" AS company, c."name"
FROM "companies" c
WHERE c."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "chart_of_accounts" a
    WHERE a."companyId" = c."id"
      AND (lower(a."accountSubType") = 'tax_vat_receivable'
        OR (a."deletedAt" IS NULL AND a."isActive" = true
            AND (a."accountSubType" IS NULL OR a."accountSubType" = '')
            AND a."accountType" = 'ASSET'
            AND (a."accountName" ILIKE '%vat receivable%' OR a."accountName" ILIKE '%vat recoverable%'
                 OR a."accountName" ILIKE '%input vat%' OR a."accountName" ILIKE '%vat input%'))))
  AND NOT EXISTS (
    SELECT 1 FROM "chart_of_accounts" a
    WHERE a."companyId" = c."id" AND a."accountCode" IN ('1400', '1410'))
ORDER BY 1;

\echo
\echo '== 3. 20260825350000_audit_scope_provenance'
\echo '   Every audit log row gets two new fields filled in; size decides how long'
\echo '   the table is locked during the upgrade:'
SELECT count(*) AS audit_rows,
       pg_size_pretty(pg_total_relation_size('"audit_logs"')) AS audit_table_size
FROM "audit_logs";

\echo
\echo '== 4. 20260827010000_user_dashboard_default_uniqueness'
\echo '   Users with more than one default dashboard keep only the latest as default:'
SELECT p."userId", count(*) AS defaults
FROM "user_dashboard_preferences" p
WHERE p."isDefault" = true
GROUP BY p."userId"
HAVING count(*) > 1
ORDER BY 2 DESC;

\echo
\echo '== Pending migrations recorded as applied (sanity: production is where we think it is):'
SELECT count(*) AS applied_migrations, max("migration_name") AS latest_applied
FROM "_prisma_migrations"
WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL;

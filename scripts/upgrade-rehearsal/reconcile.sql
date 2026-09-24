-- Production upgrade rehearsal: the numbers that must not change.
--
-- Run before and after `prisma migrate deploy` on a RESTORED COPY of
-- production (never on production itself). Read-only. Every line is
-- `check|scope|value`, so rehearse.sh can diff the two runs. Only the checks
-- listed in rehearse.sh as EXPECTED_TO_CHANGE may differ; any other
-- difference fails the rehearsal.

-- Row counts of the business tables (soft-deleted rows included).
SELECT 'rows', t.name, t.n::text FROM (
            SELECT 'companies' AS name, count(*) AS n FROM "companies"
  UNION ALL SELECT 'users', count(*) FROM "users"
  UNION ALL SELECT 'customers', count(*) FROM "customers"
  UNION ALL SELECT 'suppliers', count(*) FROM "suppliers"
  UNION ALL SELECT 'products', count(*) FROM "products"
  UNION ALL SELECT 'inventory_balances', count(*) FROM "inventory_balances"
  UNION ALL SELECT 'journal_entries', count(*) FROM "journal_entries"
  UNION ALL SELECT 'journal_entry_lines', count(*) FROM "journal_entry_lines"
  UNION ALL SELECT 'chart_of_accounts', count(*) FROM "chart_of_accounts"
  UNION ALL SELECT 'sales_orders', count(*) FROM "sales_orders"
  UNION ALL SELECT 'supplier_invoices', count(*) FROM "supplier_invoices"
  UNION ALL SELECT 'cash_accounts', count(*) FROM "cash_accounts"
  UNION ALL SELECT 'expenses', count(*) FROM "expenses"
  UNION ALL SELECT 'credit_notes', count(*) FROM "credit_notes"
  UNION ALL SELECT 'three_way_matches', count(*) FROM "three_way_matches"
  UNION ALL SELECT 'audit_logs', count(*) FROM "audit_logs"
) t
ORDER BY 2;

-- Trial balance per company: posted journal lines, debit and credit.
SELECT 'trial_balance', c."code", concat(
  'debit=', coalesce(sum(l."debit"), 0), ' credit=', coalesce(sum(l."credit"), 0))
FROM "companies" c
LEFT JOIN "journal_entries" e
  ON e."companyId" = c."id" AND e."status" = 'POSTED' AND e."deletedAt" IS NULL
LEFT JOIN "journal_entry_lines" l ON l."journalEntryId" = e."id"
GROUP BY c."code"
ORDER BY 2;

-- Every account's posted balance per company, folded into one fingerprint:
-- any change to any account balance changes it.
SELECT 'account_balances', c."code", md5(coalesce(string_agg(
  b."accountId" || ':' || b."balance"::text, ',' ORDER BY b."accountId"), ''))
FROM "companies" c
LEFT JOIN (
  SELECT l."companyId", l."accountId", sum(l."debit") - sum(l."credit") AS "balance"
  FROM "journal_entry_lines" l
  JOIN "journal_entries" e ON e."id" = l."journalEntryId"
  WHERE e."status" = 'POSTED' AND e."deletedAt" IS NULL
  GROUP BY l."companyId", l."accountId"
) b ON b."companyId" = c."id"
GROUP BY c."code"
ORDER BY 2;

-- Stock per company: quantity on hand and value.
SELECT 'stock', c."code", concat(
  'on_hand=', coalesce(sum(b."quantityOnHand"), 0), ' value=', coalesce(sum(b."totalValue"), 0))
FROM "companies" c
LEFT JOIN "inventory_balances" b ON b."companyId" = c."id"
GROUP BY c."code"
ORDER BY 2;

-- Customer and supplier balances per company.
SELECT 'customer_balances', c."code", coalesce(sum(x."currentBalance"), 0)::text
FROM "companies" c
LEFT JOIN "customers" x ON x."companyId" = c."id" AND x."deletedAt" IS NULL
GROUP BY c."code"
ORDER BY 2;

SELECT 'supplier_balances', c."code", coalesce(sum(x."currentBalance"), 0)::text
FROM "companies" c
LEFT JOIN "suppliers" x ON x."companyId" = c."id" AND x."deletedAt" IS NULL
GROUP BY c."code"
ORDER BY 2;

-- Cash per company.
SELECT 'cash_balances', c."code", coalesce(sum(x."currentBalance"), 0)::text
FROM "companies" c
LEFT JOIN "cash_accounts" x ON x."companyId" = c."id" AND x."deletedAt" IS NULL
GROUP BY c."code"
ORDER BY 2;

-- Sales and supplier invoices per company: totals and what is still owed.
SELECT 'sales_orders', c."code", concat(
  'total=', coalesce(sum(x."totalAmount"), 0), ' outstanding=', coalesce(sum(x."outstandingAmount"), 0))
FROM "companies" c
LEFT JOIN "sales_orders" x ON x."companyId" = c."id" AND x."deletedAt" IS NULL
GROUP BY c."code"
ORDER BY 2;

SELECT 'supplier_invoices', c."code", concat(
  'total=', coalesce(sum(x."totalAmount"), 0), ' outstanding=', coalesce(sum(x."outstandingAmount"), 0))
FROM "companies" c
LEFT JOIN "supplier_invoices" x ON x."companyId" = c."id" AND x."deletedAt" IS NULL
GROUP BY c."code"
ORDER BY 2;

-- Expected to change (see rehearse.sh): accounts per company (the VAT
-- migration may add account 1400) and active three-way matches (older
-- duplicates per supplier invoice are soft-deleted).
SELECT 'accounts_per_company', c."code", count(a."id")::text
FROM "companies" c
LEFT JOIN "chart_of_accounts" a ON a."companyId" = c."id" AND a."deletedAt" IS NULL
GROUP BY c."code"
ORDER BY 2;

SELECT 'active_three_way_matches', 'all', count(*)::text
FROM "three_way_matches"
WHERE "deletedAt" IS NULL;

# Manual migrations — DBA runbook (NOT auto-applied)

These two partial unique indexes are **belt-and-suspenders**. The application layer
already prevents new duplicates via atomic claims (the supplier-invoice approve
atomic claim and the three-way-match duplicate guard added in the GL audit), so a
correctly-running app cannot create new violations. These indexes make the
invariant impossible to break even under a future app bug.

They are kept out of `prisma/migrations/` because `CREATE UNIQUE INDEX` **fails if
pre-existing duplicate rows exist**, which would block `prisma migrate deploy`. A
DBA applies them once, after confirming/cleaning any historical duplicates.

Each step below is copy-paste runnable against the target database.

## 1. Detect historical duplicates (read-only)

Payables — one live payable per (company, sourceType, sourceId):

```sql
SELECT "companyId", "sourceType", "sourceId", count(*) AS dupes,
       array_agg("id" ORDER BY "createdAt") AS payable_ids
FROM "payables"
WHERE "deletedAt" IS NULL AND "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL
GROUP BY 1, 2, 3
HAVING count(*) > 1;
```

Three-way matches — one live match per (company, supplierInvoice):

```sql
SELECT "companyId", "supplierInvoiceId", count(*) AS dupes,
       array_agg("id" ORDER BY "createdAt") AS match_ids
FROM "three_way_matches"
WHERE "deletedAt" IS NULL AND "supplierInvoiceId" IS NOT NULL
GROUP BY 1, 2
HAVING count(*) > 1;
```

If both return **0 rows**, skip to step 3.

## 2. Resolve duplicates BY HAND (do not blanket-delete)

Financial rows may carry dependencies. For each duplicate group, keep the canonical
row and soft-delete the others — but only after confirming the ones you soft-delete
carry no real activity. Check dependencies first:

```sql
-- For a candidate payable id to retire: it must have no payments and no posted journal.
SELECT p."id",
       (p."paidAmount" > 0)             AS has_payments,
       (p."journalEntryId" IS NOT NULL) AS has_journal,
       p."outstandingAmount", p."status"
FROM "payables" p WHERE p."id" = '<candidate-id>';
```

Keep the row that carries the payment/journal; soft-delete the inert duplicate:

```sql
UPDATE "payables"
SET "deletedAt" = now()
WHERE "id" = '<inert-duplicate-id>' AND "paidAmount" = 0 AND "journalEntryId" IS NULL;
```

For three-way matches, keep the approved/variance-posted row and soft-delete an
inert later duplicate:

```sql
UPDATE "three_way_matches"
SET "deletedAt" = now()
WHERE "id" = '<inert-duplicate-id>' AND "approvedAt" IS NULL;
```

Re-run step 1 until both queries return 0 rows.

## 3. Apply the indexes

```sql
\i payable_source_unique.sql
\i three_way_match_invoice_unique.sql
```

(or run the contents of each file directly). Both use `CREATE UNIQUE INDEX IF NOT
EXISTS`, so re-running is safe.

## Files
- `payable_source_unique.sql` — one live payable per (company, sourceType, sourceId).
- `three_way_match_invoice_unique.sql` — one live three-way match per (company, supplierInvoice).

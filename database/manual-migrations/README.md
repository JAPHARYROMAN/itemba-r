# Manual migrations (DBA review required — NOT auto-applied)

These SQL files are **intentionally not** in `prisma/migrations/` because they can
**fail on existing duplicate data** and would block `prisma migrate deploy`. A DBA
must inspect/dedup first, then apply them in a controlled window.

They enforce single-record invariants that the application layer already guards
(atomic claims + pre-checks); the indexes are belt-and-suspenders that make the
invariant impossible to violate even under a race.

## How to apply safely

For each index below:

1. Find duplicates first, e.g. for the payable index:
   ```sql
   SELECT "companyId", "sourceType", "sourceId", count(*)
   FROM "payables"
   WHERE "deletedAt" IS NULL AND "sourceType" IS NOT NULL AND "sourceId" IS NOT NULL
   GROUP BY 1,2,3 HAVING count(*) > 1;
   ```
2. Resolve each duplicate **by hand** (do NOT blanket-delete — payables may carry
   journal entries / payments; matches may carry posted variances). Soft-delete or
   merge as appropriate.
3. Then run the corresponding `*.sql` file.

## Files
- `payable_source_unique.sql` — one live payable per (company, sourceType, sourceId).
- `three_way_match_invoice_unique.sql` — one live three-way match per (company, supplierInvoice).

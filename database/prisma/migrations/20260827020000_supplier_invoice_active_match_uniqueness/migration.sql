-- A supplier invoice has one current three-way-match result. Preserve the most
-- recently created active row if historical approval races produced duplicates,
-- retire the others, then enforce the invariant below the application layer.
BEGIN;

LOCK TABLE "three_way_matches" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked_active_matches AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "supplierInvoiceId"
      ORDER BY "createdAt" DESC, "id" DESC
    ) AS active_rank
  FROM "three_way_matches"
  WHERE "supplierInvoiceId" IS NOT NULL
    AND "deletedAt" IS NULL
)
UPDATE "three_way_matches" AS match
SET
  "deletedAt" = CURRENT_TIMESTAMP,
  "updatedAt" = CURRENT_TIMESTAMP
FROM ranked_active_matches
WHERE match."id" = ranked_active_matches."id"
  AND ranked_active_matches.active_rank > 1;

CREATE UNIQUE INDEX "three_way_matches_one_active_per_supplier_invoice"
ON "three_way_matches" ("supplierInvoiceId")
WHERE "supplierInvoiceId" IS NOT NULL
  AND "deletedAt" IS NULL;

COMMIT;

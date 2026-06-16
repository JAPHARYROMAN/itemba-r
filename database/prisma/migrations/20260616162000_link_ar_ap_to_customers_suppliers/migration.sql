-- Remove legacy orphan pointers before enforcing master-data integrity.
UPDATE "receivables" r
SET "customerId" = NULL
WHERE r."customerId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "customers" c
    WHERE c."id" = r."customerId"
  );

UPDATE "payables" p
SET "supplierId" = NULL
WHERE p."supplierId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "suppliers" s
    WHERE s."id" = p."supplierId"
  );

ALTER TABLE "receivables"
  ADD CONSTRAINT "receivables_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "customers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payables"
  ADD CONSTRAINT "payables_supplierId_fkey"
  FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "customers" c
SET "currentBalance" = COALESCE(ar."outstandingBalance", 0)
FROM (
  SELECT
    "customerId",
    "companyId",
    SUM("outstandingAmount") AS "outstandingBalance"
  FROM "receivables"
  WHERE "deletedAt" IS NULL
    AND "customerId" IS NOT NULL
    AND "status" IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
  GROUP BY "customerId", "companyId"
) ar
WHERE c."id" = ar."customerId"
  AND c."companyId" = ar."companyId";

UPDATE "customers" c
SET "currentBalance" = 0
WHERE NOT EXISTS (
  SELECT 1
  FROM "receivables" r
  WHERE r."customerId" = c."id"
    AND r."companyId" = c."companyId"
    AND r."deletedAt" IS NULL
    AND r."status" IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
);

UPDATE "suppliers" s
SET "currentBalance" = COALESCE(ap."outstandingBalance", 0)
FROM (
  SELECT
    "supplierId",
    "companyId",
    SUM("outstandingAmount") AS "outstandingBalance"
  FROM "payables"
  WHERE "deletedAt" IS NULL
    AND "supplierId" IS NOT NULL
    AND "status" IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
  GROUP BY "supplierId", "companyId"
) ap
WHERE s."id" = ap."supplierId"
  AND s."companyId" = ap."companyId";

UPDATE "suppliers" s
SET "currentBalance" = 0
WHERE NOT EXISTS (
  SELECT 1
  FROM "payables" p
  WHERE p."supplierId" = s."id"
    AND p."companyId" = s."companyId"
    AND p."deletedAt" IS NULL
    AND p."status" IN ('OPEN', 'PARTIALLY_PAID', 'OVERDUE')
);

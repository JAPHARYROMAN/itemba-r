-- Backfill nullable BI snapshot company ownership before enforcing the relation.
UPDATE "analytics_snapshot_runs" AS run
SET "companyId" = users."companyId"
FROM "users"
WHERE run."companyId" IS NULL
  AND run."startedById" = users."id"
  AND users."companyId" IS NOT NULL;

UPDATE "analytics_snapshot_runs"
SET "companyId" = (
  SELECT "id"
  FROM "companies"
  WHERE "deletedAt" IS NULL
  ORDER BY "createdAt" ASC
  LIMIT 1
)
WHERE "companyId" IS NULL
  AND EXISTS (
    SELECT 1
    FROM "companies"
    WHERE "deletedAt" IS NULL
  );

DELETE FROM "analytics_snapshot_runs"
WHERE "companyId" IS NULL;

ALTER TABLE "analytics_snapshot_runs"
  ALTER COLUMN "companyId" SET NOT NULL;

ALTER TABLE "analytics_snapshot_runs"
  ADD CONSTRAINT "analytics_snapshot_runs_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "analytics_snapshot_runs_companyId_runType_status_createdAt_idx"
  ON "analytics_snapshot_runs"("companyId", "runType", "status", "createdAt");

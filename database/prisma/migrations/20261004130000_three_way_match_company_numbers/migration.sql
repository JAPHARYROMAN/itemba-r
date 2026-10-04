-- ThreeWayMatch numbers are allocated by a per-company sequence. Enforce the
-- same boundary in storage, while preserving existing rows and numbers.
BEGIN;

-- Install the replacement before removing the old global uniqueness boundary.
-- Existing global uniqueness guarantees that this scoped replacement builds.
CREATE UNIQUE INDEX "three_way_matches_companyId_matchNumber_key"
    ON "three_way_matches"("companyId", "matchNumber");

DROP INDEX IF EXISTS "three_way_matches_matchNumber_key";

COMMIT;

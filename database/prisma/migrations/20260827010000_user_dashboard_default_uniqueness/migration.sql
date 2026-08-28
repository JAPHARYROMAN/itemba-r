-- Preserve the most recently updated default if historical races produced
-- more than one row for a user, then make the invariant database-enforced.
BEGIN;

LOCK TABLE "user_dashboard_preferences" IN SHARE ROW EXCLUSIVE MODE;

WITH ranked_defaults AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "userId"
      ORDER BY "updatedAt" DESC, "id" DESC
    ) AS default_rank
  FROM "user_dashboard_preferences"
  WHERE "isDefault" = TRUE
)
UPDATE "user_dashboard_preferences" AS preference
SET "isDefault" = FALSE
FROM ranked_defaults
WHERE preference."id" = ranked_defaults."id"
  AND ranked_defaults.default_rank > 1;

CREATE UNIQUE INDEX "user_dashboard_preferences_one_default_per_user"
ON "user_dashboard_preferences" ("userId")
WHERE "isDefault" = TRUE;

COMMIT;

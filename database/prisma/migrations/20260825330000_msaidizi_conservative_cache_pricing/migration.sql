-- Receipt rows created during a rolling migration window may carry the older
-- direct-input default (30) even though cache creation can cost more. Upgrade
-- only below-floor snapshots and recompute every dependent amount atomically.
-- The application uses the maximum deployment-owned direct/read/create rate
-- for all input units from this migration onward.

ALTER TABLE "msaidizi_proposal_usages"
  DISABLE TRIGGER "msaidizi_proposal_usages_transition_guard";

WITH recalculated AS (
  SELECT
    "id",
    GREATEST("inputUsdPerMillionTokens", 37.500000::DECIMAL) AS input_rate,
    (
      "reservedInputTokens"::DECIMAL
        * GREATEST("inputUsdPerMillionTokens", 37.500000::DECIMAL)
      + "reservedOutputTokens"::DECIMAL * "outputUsdPerMillionTokens"
    ) / 1000000::DECIMAL AS reserved_cost,
    (
      "billedInputTokens"::DECIMAL
        * GREATEST("inputUsdPerMillionTokens", 37.500000::DECIMAL)
      + "outputTokens"::DECIMAL * "outputUsdPerMillionTokens"
    ) / 1000000::DECIMAL AS actual_cost
  FROM "msaidizi_proposal_usages"
  WHERE "inputUsdPerMillionTokens" < 37.500000
)
UPDATE "msaidizi_proposal_usages" receipt
SET
  "inputUsdPerMillionTokens" = recalculated.input_rate,
  "reservedCostUsd" = recalculated.reserved_cost,
  "actualCostUsd" = CASE
    WHEN receipt."actualModelTurns" > 0 THEN recalculated.actual_cost
    ELSE receipt."actualCostUsd"
  END,
  "accountedCostUsd" = CASE
    WHEN receipt."actualModelTurns" > 0 THEN recalculated.actual_cost
    ELSE recalculated.reserved_cost
  END
FROM recalculated
WHERE receipt."id" = recalculated."id";

ALTER TABLE "msaidizi_proposal_usages"
  ENABLE TRIGGER "msaidizi_proposal_usages_transition_guard";

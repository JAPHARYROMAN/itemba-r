-- Pricing is deployment-owned but can change while a provider call is in
-- flight. Snapshot both rates on the reservation so settlement and later audit
-- never recompute one call with a different deployment configuration.

ALTER TABLE "msaidizi_proposal_usages"
  ADD COLUMN "inputUsdPerMillionTokens" DECIMAL(12,6),
  ADD COLUMN "outputUsdPerMillionTokens" DECIMAL(12,6);

-- Existing rows can only predate this unreleased additive migration. Preserve
-- their already-recorded reservation math with the conservative defaults.
UPDATE "msaidizi_proposal_usages"
SET
  "inputUsdPerMillionTokens" = 30.000000,
  "outputUsdPerMillionTokens" = 150.000000
WHERE "inputUsdPerMillionTokens" IS NULL
   OR "outputUsdPerMillionTokens" IS NULL;

ALTER TABLE "msaidizi_proposal_usages"
  ALTER COLUMN "inputUsdPerMillionTokens" SET NOT NULL,
  ALTER COLUMN "outputUsdPerMillionTokens" SET NOT NULL,
  ADD CONSTRAINT "msaidizi_proposal_usages_price_snapshot_check" CHECK (
    "inputUsdPerMillionTokens" > 0 AND
    "outputUsdPerMillionTokens" > 0
  );

-- Replace the transition guard so the pricing snapshot joins the immutable
-- reservation identity. All other state-machine checks remain unchanged.
CREATE OR REPLACE FUNCTION msaidizi_enforce_proposal_usage_transition()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'msaidizi proposal usage receipts are append-preserved';
  END IF;

  IF ROW(
    NEW."userId", NEW."companyId", NEW."mode", NEW."requestDigest", NEW."model",
    NEW."inputUsdPerMillionTokens", NEW."outputUsdPerMillionTokens",
    NEW."reservedModelTurns", NEW."reservedInputTokens", NEW."reservedOutputTokens",
    NEW."reservedCostUsd", NEW."reservationExpiresAt", NEW."expiresAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."userId", OLD."companyId", OLD."mode", OLD."requestDigest", OLD."model",
    OLD."inputUsdPerMillionTokens", OLD."outputUsdPerMillionTokens",
    OLD."reservedModelTurns", OLD."reservedInputTokens", OLD."reservedOutputTokens",
    OLD."reservedCostUsd", OLD."reservationExpiresAt", OLD."expiresAt", OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'msaidizi proposal usage reservation identity is immutable';
  END IF;

  IF OLD."status" = 'RESERVED' AND NEW."status" NOT IN ('SETTLED', 'FAILED') THEN
    RAISE EXCEPTION 'invalid msaidizi proposal usage transition from RESERVED';
  ELSIF OLD."status" = 'SETTLED' AND NEW."status" <> 'CONSUMED' THEN
    RAISE EXCEPTION 'invalid msaidizi proposal usage transition from SETTLED';
  ELSIF OLD."status" IN ('FAILED', 'CONSUMED') THEN
    RAISE EXCEPTION 'terminal msaidizi proposal usage receipt cannot be changed';
  END IF;

  IF OLD."status" = 'SETTLED' AND ROW(
    NEW."proposalDigest", NEW."actualModelTurns", NEW."inputTokens",
    NEW."cacheReadInputTokens", NEW."cacheCreationInputTokens", NEW."billedInputTokens",
    NEW."outputTokens", NEW."actualCostUsd", NEW."accountedModelTurns",
    NEW."accountedCostUsd", NEW."settledAt"
  ) IS DISTINCT FROM ROW(
    OLD."proposalDigest", OLD."actualModelTurns", OLD."inputTokens",
    OLD."cacheReadInputTokens", OLD."cacheCreationInputTokens", OLD."billedInputTokens",
    OLD."outputTokens", OLD."actualCostUsd", OLD."accountedModelTurns",
    OLD."accountedCostUsd", OLD."settledAt"
  ) THEN
    RAISE EXCEPTION 'settled msaidizi proposal usage cannot be rewritten while consuming';
  END IF;

  RETURN NEW;
END;
$function$;

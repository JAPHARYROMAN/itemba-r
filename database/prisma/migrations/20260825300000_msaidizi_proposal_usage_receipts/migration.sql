-- Model calls used to draft a task happen before the task ledger exists. This
-- receipt reserves spend first, settles reported usage once, and can be linked
-- to exactly one reviewed task. Prompt/model content is deliberately absent.

CREATE TYPE "MsaidiziProposalUsageStatus" AS ENUM (
  'RESERVED', 'SETTLED', 'FAILED', 'CONSUMED'
);

CREATE TABLE "msaidizi_proposal_usages" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "companyId" TEXT,
  "mode" "MsaidiziTaskMode" NOT NULL,
  "requestDigest" TEXT NOT NULL,
  "proposalDigest" TEXT,
  "model" TEXT NOT NULL,
  "status" "MsaidiziProposalUsageStatus" NOT NULL DEFAULT 'RESERVED',
  "reservedModelTurns" INTEGER NOT NULL,
  "reservedInputTokens" BIGINT NOT NULL,
  "reservedOutputTokens" BIGINT NOT NULL,
  "reservedCostUsd" DECIMAL(12,6) NOT NULL,
  "actualModelTurns" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" BIGINT NOT NULL DEFAULT 0,
  "cacheReadInputTokens" BIGINT NOT NULL DEFAULT 0,
  "cacheCreationInputTokens" BIGINT NOT NULL DEFAULT 0,
  "billedInputTokens" BIGINT NOT NULL DEFAULT 0,
  "outputTokens" BIGINT NOT NULL DEFAULT 0,
  "actualCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "accountedModelTurns" INTEGER NOT NULL,
  "accountedCostUsd" DECIMAL(12,6) NOT NULL,
  "failureCode" TEXT,
  "reservationExpiresAt" TIMESTAMP(3) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "settledAt" TIMESTAMP(3),
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_proposal_usages_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_proposal_usages_request_digest_check"
    CHECK ("requestDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_proposal_usages_proposal_digest_check"
    CHECK ("proposalDigest" IS NULL OR "proposalDigest" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_proposal_usages_reservation_check" CHECK (
    "reservedModelTurns" > 0 AND
    "reservedInputTokens" >= 0 AND
    "reservedOutputTokens" >= 0 AND
    "reservedCostUsd" >= 0 AND
    "reservationExpiresAt" > "createdAt" AND
    "expiresAt" >= "reservationExpiresAt"
  ),
  CONSTRAINT "msaidizi_proposal_usages_actual_usage_check" CHECK (
    "actualModelTurns" >= 0 AND
    "actualModelTurns" <= "reservedModelTurns" AND
    "inputTokens" >= 0 AND
    "cacheReadInputTokens" >= 0 AND
    "cacheCreationInputTokens" >= 0 AND
    "billedInputTokens" = "inputTokens" + "cacheReadInputTokens" + "cacheCreationInputTokens" AND
    "billedInputTokens" <= "reservedInputTokens" AND
    "outputTokens" >= 0 AND
    "outputTokens" <= "reservedOutputTokens" AND
    "actualCostUsd" >= 0 AND
    "accountedModelTurns" >= 0 AND
    "accountedModelTurns" <= "reservedModelTurns" AND
    "accountedCostUsd" >= 0
  ),
  CONSTRAINT "msaidizi_proposal_usages_state_check" CHECK (
    (
      "status" = 'RESERVED' AND
      "proposalDigest" IS NULL AND "settledAt" IS NULL AND "consumedAt" IS NULL AND
      "actualModelTurns" = 0 AND "billedInputTokens" = 0 AND "outputTokens" = 0 AND
      "actualCostUsd" = 0 AND
      "accountedModelTurns" = "reservedModelTurns" AND
      "accountedCostUsd" = "reservedCostUsd"
    ) OR (
      "status" = 'SETTLED' AND
      "proposalDigest" IS NOT NULL AND "settledAt" IS NOT NULL AND "consumedAt" IS NULL AND
      "actualModelTurns" > 0 AND
      "accountedModelTurns" = "actualModelTurns" AND
      "accountedCostUsd" = "actualCostUsd"
    ) OR (
      "status" = 'FAILED' AND
      "proposalDigest" IS NULL AND "settledAt" IS NOT NULL AND "consumedAt" IS NULL AND
      "failureCode" IS NOT NULL AND
      (
        ("actualModelTurns" = 0 AND
         "accountedModelTurns" = "reservedModelTurns" AND
         "accountedCostUsd" = "reservedCostUsd") OR
        ("actualModelTurns" > 0 AND
         "accountedModelTurns" = "actualModelTurns" AND
         "accountedCostUsd" = "actualCostUsd")
      )
    ) OR (
      "status" = 'CONSUMED' AND
      "proposalDigest" IS NOT NULL AND "settledAt" IS NOT NULL AND "consumedAt" IS NOT NULL AND
      "actualModelTurns" > 0 AND
      "accountedModelTurns" = "actualModelTurns" AND
      "accountedCostUsd" = "actualCostUsd"
    )
  )
);

CREATE INDEX "msaidizi_proposal_usages_userId_companyId_createdAt_idx"
  ON "msaidizi_proposal_usages"("userId", "companyId", "createdAt");
CREATE INDEX "msaidizi_proposal_usages_status_reservationExpiresAt_idx"
  ON "msaidizi_proposal_usages"("status", "reservationExpiresAt");
CREATE INDEX "msaidizi_proposal_usages_proposalDigest_idx"
  ON "msaidizi_proposal_usages"("proposalDigest");

ALTER TABLE "msaidizi_proposal_usages"
  ADD CONSTRAINT "msaidizi_proposal_usages_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_proposal_usages_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "msaidizi_tasks"
  ADD COLUMN "proposalUsageId" TEXT;
CREATE UNIQUE INDEX "msaidizi_tasks_proposalUsageId_key"
  ON "msaidizi_tasks"("proposalUsageId");
ALTER TABLE "msaidizi_tasks"
  ADD CONSTRAINT "msaidizi_tasks_proposalUsageId_fkey"
    FOREIGN KEY ("proposalUsageId") REFERENCES "msaidizi_proposal_usages"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "msaidizi_plan_versions"
  ADD COLUMN "sourceProposalDigest" TEXT;
ALTER TABLE "msaidizi_plan_versions"
  ADD CONSTRAINT "msaidizi_plan_versions_sourceProposalDigest_check"
    CHECK ("sourceProposalDigest" IS NULL OR "sourceProposalDigest" ~ '^[0-9a-f]{64}$');

-- Receipts are audit evidence. Identity/reservation values are immutable and
-- the lifecycle can only progress RESERVED -> SETTLED|FAILED -> CONSUMED.
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
    NEW."reservedModelTurns", NEW."reservedInputTokens", NEW."reservedOutputTokens",
    NEW."reservedCostUsd", NEW."reservationExpiresAt", NEW."expiresAt", NEW."createdAt"
  ) IS DISTINCT FROM ROW(
    OLD."userId", OLD."companyId", OLD."mode", OLD."requestDigest", OLD."model",
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

CREATE TRIGGER "msaidizi_proposal_usages_transition_guard"
BEFORE UPDATE OR DELETE ON "msaidizi_proposal_usages"
FOR EACH ROW EXECUTE FUNCTION msaidizi_enforce_proposal_usage_transition();

CREATE OR REPLACE FUNCTION msaidizi_deny_proposal_usage_truncate()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'msaidizi proposal usage receipts cannot be truncated';
END;
$function$;

CREATE TRIGGER "msaidizi_proposal_usages_truncate_guard"
BEFORE TRUNCATE ON "msaidizi_proposal_usages"
FOR EACH STATEMENT EXECUTE FUNCTION msaidizi_deny_proposal_usage_truncate();

-- At commit, a task-linked receipt must be consumed by the same human/company
-- and its digest must be retained on the immutable first plan version.
CREATE OR REPLACE FUNCTION msaidizi_verify_task_proposal_receipt()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  receipt RECORD;
  plan_digest TEXT;
BEGIN
  IF NEW."proposalUsageId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "status", "userId", "companyId", "mode", "proposalDigest"
    INTO receipt
    FROM "msaidizi_proposal_usages"
    WHERE "id" = NEW."proposalUsageId";
  SELECT "sourceProposalDigest"
    INTO plan_digest
    FROM "msaidizi_plan_versions"
    WHERE "taskId" = NEW."id" AND "version" = 1;
  IF receipt."status" IS DISTINCT FROM 'CONSUMED'::"MsaidiziProposalUsageStatus" OR
     receipt."userId" IS DISTINCT FROM NEW."initiatedByUserId" OR
     receipt."companyId" IS DISTINCT FROM NEW."companyId" OR
     receipt."mode" IS DISTINCT FROM NEW."mode" OR
     receipt."proposalDigest" IS DISTINCT FROM plan_digest THEN
    RAISE EXCEPTION 'task proposal receipt attribution is inconsistent';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE CONSTRAINT TRIGGER "msaidizi_tasks_proposal_receipt_guard"
AFTER INSERT OR UPDATE OF "proposalUsageId" ON "msaidizi_tasks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION msaidizi_verify_task_proposal_receipt();

CREATE TYPE "MsaidiziUpdateEvaluationRunStatus" AS ENUM (
  'QUEUED',
  'LEASED',
  'RUNNING',
  'SUCCEEDED',
  'REJECTED',
  'FAILED',
  'NEEDS_ATTENTION',
  'CANCELLED'
);

ALTER TABLE "msaidizi_update_candidates"
  ADD COLUMN "generatedSourceArtifactId" TEXT,
  ADD COLUMN "generationManifestSha256" CHAR(64);

ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_generated_binding_check" CHECK (
    ("generatedSourceArtifactId" IS NULL AND "generationManifestSha256" IS NULL) OR
    ("generatedSourceArtifactId" IS NOT NULL AND
     "generationManifestSha256" IS NOT NULL AND
     "generationManifestSha256" ~ '^[0-9a-f]{64}$')
  );

CREATE TABLE "msaidizi_update_evaluation_runs" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "generationArtifactId" TEXT NOT NULL,
  "generationArtifactSha256" CHAR(64) NOT NULL,
  "generationManifestSha256" CHAR(64) NOT NULL,
  "requestDigest" CHAR(64) NOT NULL,
  "evaluationRunId" TEXT NOT NULL,
  "generatorPrincipalId" TEXT NOT NULL,
  "generatorModelId" TEXT NOT NULL,
  "policyVersion" TEXT NOT NULL,
  "policyDigest" CHAR(64) NOT NULL,
  "requiredChecks" JSONB NOT NULL,
  "provenance" JSONB NOT NULL,
  "status" "MsaidiziUpdateEvaluationRunStatus" NOT NULL DEFAULT 'QUEUED',
  "maxWallTimeSeconds" INTEGER NOT NULL,
  "maxCpuTimeSeconds" INTEGER NOT NULL,
  "maxBytesRead" BIGINT NOT NULL,
  "maxBytesWritten" BIGINT NOT NULL,
  "maxExternalEgressBytes" BIGINT NOT NULL,
  "maxModelTurns" INTEGER NOT NULL,
  "maxModelInputTokens" BIGINT NOT NULL,
  "maxModelOutputTokens" BIGINT NOT NULL,
  "maxModelCostMicrousd" BIGINT NOT NULL,
  "usedCpuTimeSeconds" INTEGER NOT NULL DEFAULT 0,
  "usedBytesRead" BIGINT NOT NULL DEFAULT 0,
  "usedBytesWritten" BIGINT NOT NULL DEFAULT 0,
  "usedExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  "usedModelTurns" INTEGER NOT NULL DEFAULT 0,
  "usedModelInputTokens" BIGINT NOT NULL DEFAULT 0,
  "usedModelOutputTokens" BIGINT NOT NULL DEFAULT 0,
  "usedModelCostMicrousd" BIGINT NOT NULL DEFAULT 0,
  "leaseId" TEXT,
  "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
  "leaseExpiresAt" TIMESTAMP(3),
  "dispatchCount" INTEGER NOT NULL DEFAULT 0,
  "failureCode" TEXT,
  "deadlineAt" TIMESTAMP(3) NOT NULL,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leasedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_update_evaluation_runs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_update_evaluation_runs_digests_check" CHECK (
    "generationArtifactSha256" ~ '^[0-9a-f]{64}$' AND
    "generationManifestSha256" ~ '^[0-9a-f]{64}$' AND
    "requestDigest" ~ '^[0-9a-f]{64}$' AND
    "policyDigest" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "msaidizi_update_evaluation_runs_budget_check" CHECK (
    "maxWallTimeSeconds" BETWEEN 60 AND 7200 AND
    "maxCpuTimeSeconds" > 0 AND
    "maxBytesRead" > 0 AND
    "maxBytesWritten" > 0 AND
    "maxExternalEgressBytes" >= 0 AND
    "maxModelTurns" BETWEEN 2 AND 20 AND
    "maxModelInputTokens" > 0 AND
    "maxModelOutputTokens" > 0 AND
    "maxModelCostMicrousd" >= 0 AND
    "usedCpuTimeSeconds" BETWEEN 0 AND "maxCpuTimeSeconds" AND
    "usedBytesRead" BETWEEN 0 AND "maxBytesRead" AND
    "usedBytesWritten" BETWEEN 0 AND "maxBytesWritten" AND
    "usedExternalEgressBytes" BETWEEN 0 AND "maxExternalEgressBytes" AND
    "usedModelTurns" BETWEEN 0 AND "maxModelTurns" AND
    "usedModelInputTokens" BETWEEN 0 AND "maxModelInputTokens" AND
    "usedModelOutputTokens" BETWEEN 0 AND "maxModelOutputTokens" AND
    "usedModelCostMicrousd" BETWEEN 0 AND "maxModelCostMicrousd"
  ),
  CONSTRAINT "msaidizi_update_evaluation_runs_json_check" CHECK (
    jsonb_typeof("requiredChecks") = 'object' AND
    jsonb_typeof("provenance") = 'object'
  ),
  CONSTRAINT "msaidizi_update_evaluation_runs_lifecycle_check" CHECK (
    "leaseGeneration" >= 0 AND
    "dispatchCount" >= 0 AND
    "leaseGeneration" = "dispatchCount" AND
    "deadlineAt" > "queuedAt" AND
    ("leaseExpiresAt" IS NULL OR "leaseExpiresAt" <= "deadlineAt") AND
    ("status" <> 'RUNNING' OR
      "leaseExpiresAt" <= "startedAt" + ("maxWallTimeSeconds" * INTERVAL '1 second')) AND
    ("leasedAt" IS NULL OR "leasedAt" >= "queuedAt") AND
    ("startedAt" IS NULL OR ("leasedAt" IS NOT NULL AND "startedAt" >= "leasedAt")) AND
    ("lastHeartbeatAt" IS NULL OR
      ("startedAt" IS NOT NULL AND "lastHeartbeatAt" >= "startedAt")) AND
    ("completedAt" IS NULL OR
      ("completedAt" >= "queuedAt" AND
       ("startedAt" IS NULL OR "completedAt" >= "startedAt"))) AND
    CASE
      WHEN "status" = 'QUEUED' THEN
        "leaseId" IS NULL AND "leaseExpiresAt" IS NULL AND
        "startedAt" IS NULL AND "lastHeartbeatAt" IS NULL AND "completedAt" IS NULL
      WHEN "status" = 'LEASED' THEN
        "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND
        "leasedAt" IS NOT NULL AND "leaseExpiresAt" > "leasedAt" AND
        "startedAt" IS NULL AND "lastHeartbeatAt" IS NULL AND "completedAt" IS NULL
      WHEN "status" = 'RUNNING' THEN
        "leaseId" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND
        "leasedAt" IS NOT NULL AND "startedAt" IS NOT NULL AND
        "leaseExpiresAt" > "startedAt" AND "completedAt" IS NULL
      WHEN "status" IN ('SUCCEEDED', 'REJECTED') THEN
        "leaseId" IS NULL AND "leaseExpiresAt" IS NULL AND
        "startedAt" IS NOT NULL AND "lastHeartbeatAt" IS NOT NULL AND
        "completedAt" IS NOT NULL
      ELSE
        "leaseId" IS NULL AND "leaseExpiresAt" IS NULL AND "completedAt" IS NOT NULL
    END
  )
);

CREATE UNIQUE INDEX "msaidizi_update_evaluation_runs_candidateId_key"
  ON "msaidizi_update_evaluation_runs"("candidateId");
CREATE UNIQUE INDEX "msaidizi_update_evaluation_runs_attemptId_key"
  ON "msaidizi_update_evaluation_runs"("attemptId");
CREATE UNIQUE INDEX "msaidizi_update_evaluation_runs_generationArtifactId_key"
  ON "msaidizi_update_evaluation_runs"("generationArtifactId");
CREATE UNIQUE INDEX "msaidizi_update_evaluation_runs_requestDigest_key"
  ON "msaidizi_update_evaluation_runs"("requestDigest");
CREATE UNIQUE INDEX "msaidizi_update_evaluation_runs_evaluationRunId_key"
  ON "msaidizi_update_evaluation_runs"("evaluationRunId");
CREATE UNIQUE INDEX "msaidizi_update_evaluation_runs_leaseId_key"
  ON "msaidizi_update_evaluation_runs"("leaseId");
CREATE INDEX "msaidizi_update_evaluation_runs_status_queuedAt_idx"
  ON "msaidizi_update_evaluation_runs"("status", "queuedAt");
CREATE INDEX "msaidizi_update_evaluation_runs_taskId_createdAt_idx"
  ON "msaidizi_update_evaluation_runs"("taskId", "createdAt");
CREATE INDEX "msaidizi_update_evaluation_runs_leaseExpiresAt_status_idx"
  ON "msaidizi_update_evaluation_runs"("leaseExpiresAt", "status");
CREATE INDEX "msaidizi_update_evaluation_runs_deadlineAt_status_idx"
  ON "msaidizi_update_evaluation_runs"("deadlineAt", "status");

ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_generatedSourceArtifactId_fkey"
  FOREIGN KEY ("generatedSourceArtifactId") REFERENCES "msaidizi_artifacts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_update_evaluation_runs"
  ADD CONSTRAINT "msaidizi_update_evaluation_runs_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "msaidizi_update_candidates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_update_evaluation_runs"
  ADD CONSTRAINT "msaidizi_update_evaluation_runs_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_update_evaluation_runs"
  ADD CONSTRAINT "msaidizi_update_evaluation_runs_planVersionId_fkey"
  FOREIGN KEY ("planVersionId") REFERENCES "msaidizi_plan_versions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_update_evaluation_runs"
  ADD CONSTRAINT "msaidizi_update_evaluation_runs_stepId_fkey"
  FOREIGN KEY ("stepId") REFERENCES "msaidizi_task_steps"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_update_evaluation_runs"
  ADD CONSTRAINT "msaidizi_update_evaluation_runs_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "msaidizi_tool_attempts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_update_evaluation_runs"
  ADD CONSTRAINT "msaidizi_update_evaluation_runs_generationArtifactId_fkey"
  FOREIGN KEY ("generationArtifactId") REFERENCES "msaidizi_artifacts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION msaidizi_update_evaluation_run_bindings_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(
    NEW."candidateId", NEW."taskId", NEW."planVersionId", NEW."stepId", NEW."attemptId",
    NEW."generationArtifactId", NEW."generationArtifactSha256", NEW."generationManifestSha256",
    NEW."requestDigest", NEW."evaluationRunId", NEW."generatorPrincipalId",
    NEW."generatorModelId", NEW."policyVersion", NEW."policyDigest", NEW."requiredChecks", NEW."provenance",
    NEW."maxWallTimeSeconds", NEW."maxCpuTimeSeconds", NEW."maxBytesRead",
    NEW."maxBytesWritten", NEW."maxExternalEgressBytes", NEW."maxModelTurns",
    NEW."maxModelInputTokens", NEW."maxModelOutputTokens", NEW."maxModelCostMicrousd", NEW."deadlineAt"
  ) IS DISTINCT FROM ROW(
    OLD."candidateId", OLD."taskId", OLD."planVersionId", OLD."stepId", OLD."attemptId",
    OLD."generationArtifactId", OLD."generationArtifactSha256", OLD."generationManifestSha256",
    OLD."requestDigest", OLD."evaluationRunId", OLD."generatorPrincipalId",
    OLD."generatorModelId", OLD."policyVersion", OLD."policyDigest", OLD."requiredChecks", OLD."provenance",
    OLD."maxWallTimeSeconds", OLD."maxCpuTimeSeconds", OLD."maxBytesRead",
    OLD."maxBytesWritten", OLD."maxExternalEgressBytes", OLD."maxModelTurns",
    OLD."maxModelInputTokens", OLD."maxModelOutputTokens", OLD."maxModelCostMicrousd", OLD."deadlineAt"
  ) THEN
    RAISE EXCEPTION 'Msaidizi update evaluation bindings are immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."leaseGeneration" < OLD."leaseGeneration" OR
     NEW."dispatchCount" < OLD."dispatchCount" OR
     NEW."usedCpuTimeSeconds" < OLD."usedCpuTimeSeconds" OR
     NEW."usedBytesRead" < OLD."usedBytesRead" OR
     NEW."usedBytesWritten" < OLD."usedBytesWritten" OR
     NEW."usedExternalEgressBytes" < OLD."usedExternalEgressBytes" OR
     NEW."usedModelTurns" < OLD."usedModelTurns" OR
     NEW."usedModelInputTokens" < OLD."usedModelInputTokens" OR
     NEW."usedModelOutputTokens" < OLD."usedModelOutputTokens" OR
     NEW."usedModelCostMicrousd" < OLD."usedModelCostMicrousd" THEN
    RAISE EXCEPTION 'Msaidizi update evaluation accounting is monotonic' USING ERRCODE = '23514';
  END IF;
  IF OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt" THEN
    RAISE EXCEPTION 'Msaidizi update evaluation start time is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW."leasedAt" IS DISTINCT FROM OLD."leasedAt" AND
     NOT (OLD."status" = 'QUEUED' AND NEW."status" = 'LEASED') THEN
    RAISE EXCEPTION 'Msaidizi update evaluation lease time transition is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" = 'QUEUED' AND NEW."status" = 'LEASED' THEN
    IF NEW."leaseGeneration" <> OLD."leaseGeneration" + 1 OR
       NEW."dispatchCount" <> OLD."dispatchCount" + 1 OR
       NEW."leaseId" IS NULL OR NEW."leaseId" IS NOT DISTINCT FROM OLD."leaseId" OR
       NEW."leasedAt" IS NULL THEN
      RAISE EXCEPTION 'Msaidizi update evaluation lease acquisition is invalid'
        USING ERRCODE = '23514';
    END IF;
  ELSIF NEW."leaseGeneration" <> OLD."leaseGeneration" OR
        NEW."dispatchCount" <> OLD."dispatchCount" THEN
    RAISE EXCEPTION 'Msaidizi update evaluation lease counters changed outside acquisition'
      USING ERRCODE = '23514';
  END IF;
  IF NEW."leaseId" IS DISTINCT FROM OLD."leaseId" AND NOT (
    (OLD."status" = 'QUEUED' AND NEW."status" = 'LEASED') OR
    (OLD."status" = 'LEASED' AND NEW."status" = 'QUEUED' AND NEW."leaseId" IS NULL) OR
    (OLD."status" IN ('QUEUED', 'LEASED', 'RUNNING') AND
     NEW."status" IN ('SUCCEEDED', 'REJECTED', 'FAILED', 'NEEDS_ATTENTION', 'CANCELLED') AND
     NEW."leaseId" IS NULL)
  ) THEN
    RAISE EXCEPTION 'Msaidizi update evaluation lease identity transition is invalid'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."status" IN ('SUCCEEDED', 'REJECTED', 'FAILED', 'NEEDS_ATTENTION', 'CANCELLED') AND
     ROW(
       NEW."status", NEW."usedCpuTimeSeconds", NEW."usedBytesRead", NEW."usedBytesWritten",
       NEW."usedExternalEgressBytes", NEW."usedModelTurns", NEW."usedModelInputTokens",
       NEW."usedModelOutputTokens", NEW."usedModelCostMicrousd", NEW."leaseId",
       NEW."leaseExpiresAt", NEW."completedAt", NEW."failureCode"
     ) IS DISTINCT FROM ROW(
       OLD."status", OLD."usedCpuTimeSeconds", OLD."usedBytesRead", OLD."usedBytesWritten",
       OLD."usedExternalEgressBytes", OLD."usedModelTurns", OLD."usedModelInputTokens",
       OLD."usedModelOutputTokens", OLD."usedModelCostMicrousd", OLD."leaseId",
       OLD."leaseExpiresAt", OLD."completedAt", OLD."failureCode"
     ) THEN
    RAISE EXCEPTION 'Msaidizi update evaluation terminal state is immutable' USING ERRCODE = '23514';
  END IF;
  IF NOT (
    NEW."status" = OLD."status" OR
    (OLD."status" = 'QUEUED' AND NEW."status" IN ('LEASED', 'FAILED', 'NEEDS_ATTENTION', 'CANCELLED')) OR
    (OLD."status" = 'LEASED' AND NEW."status" IN ('QUEUED', 'RUNNING', 'FAILED', 'NEEDS_ATTENTION', 'CANCELLED')) OR
    (OLD."status" = 'RUNNING' AND NEW."status" IN ('SUCCEEDED', 'REJECTED', 'FAILED', 'NEEDS_ATTENTION', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'Msaidizi update evaluation state transition is invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER msaidizi_update_evaluation_run_bindings_immutable_trg
BEFORE UPDATE ON "msaidizi_update_evaluation_runs"
FOR EACH ROW EXECUTE FUNCTION msaidizi_update_evaluation_run_bindings_immutable();

CREATE OR REPLACE FUNCTION msaidizi_generated_update_candidate_bindings_immutable()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."generatedSourceArtifactId", NEW."generationManifestSha256") IS DISTINCT FROM
     ROW(OLD."generatedSourceArtifactId", OLD."generationManifestSha256") THEN
    RAISE EXCEPTION 'Msaidizi generated update candidate bindings are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER msaidizi_generated_update_candidate_bindings_immutable_trg
BEFORE UPDATE ON "msaidizi_update_candidates"
FOR EACH ROW EXECUTE FUNCTION msaidizi_generated_update_candidate_bindings_immutable();

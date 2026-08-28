-- Durable, model-governed task checkpoints. The worker is deployment-gated
-- and every row is bound to one immutable plan version and one completed step.

ALTER TYPE "BackgroundJobType" ADD VALUE IF NOT EXISTS 'MSAIDIZI_REASONING_CHECKPOINT';

CREATE TYPE "MsaidiziReasoningTurnStatus" AS ENUM (
  'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'
);

CREATE TYPE "MsaidiziReasoningDecision" AS ENUM ('CONTINUE', 'STOP', 'REPLAN');

CREATE TABLE "msaidizi_reasoning_turns" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "checkpointStepId" TEXT NOT NULL,
  "status" "MsaidiziReasoningTurnStatus" NOT NULL DEFAULT 'QUEUED',
  "inputDigest" TEXT NOT NULL,
  "inputByteSize" INTEGER NOT NULL,
  "reservedInputTokens" BIGINT NOT NULL DEFAULT 0,
  "reservedOutputTokens" BIGINT NOT NULL DEFAULT 0,
  "reservedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "inputTokens" BIGINT NOT NULL DEFAULT 0,
  "outputTokens" BIGINT NOT NULL DEFAULT 0,
  "actualCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "decision" "MsaidiziReasoningDecision",
  "evaluation" JSONB,
  "errorCode" TEXT,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_reasoning_turns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_reasoning_turns_budget_check" CHECK (
    "inputByteSize" >= 0 AND "reservedInputTokens" >= 0 AND
    "reservedOutputTokens" >= 0 AND "reservedCostUsd" >= 0 AND
    "inputTokens" >= 0 AND "outputTokens" >= 0 AND "actualCostUsd" >= 0
  )
);

CREATE UNIQUE INDEX "msaidizi_reasoning_turns_taskId_planVersionId_checkpointStepId_key"
  ON "msaidizi_reasoning_turns"("taskId", "planVersionId", "checkpointStepId");
CREATE INDEX "msaidizi_reasoning_turns_taskId_status_createdAt_idx"
  ON "msaidizi_reasoning_turns"("taskId", "status", "createdAt");
CREATE INDEX "msaidizi_reasoning_turns_status_createdAt_idx"
  ON "msaidizi_reasoning_turns"("status", "createdAt");

ALTER TABLE "msaidizi_reasoning_turns"
  ADD CONSTRAINT "msaidizi_reasoning_turns_taskId_fkey"
    FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_reasoning_turns_planVersionId_fkey"
    FOREIGN KEY ("planVersionId") REFERENCES "msaidizi_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_reasoning_turns_checkpointStepId_fkey"
    FOREIGN KEY ("checkpointStepId") REFERENCES "msaidizi_task_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

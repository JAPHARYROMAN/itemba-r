-- A self-improvement proposal is a separate execution target. It is never
-- resolved through ERP controller discovery or the privileged host broker.
ALTER TYPE "MsaidiziExecutionTarget" ADD VALUE IF NOT EXISTS 'SELF_IMPROVEMENT';

-- Legacy human-created candidates remain readable. Autonomous candidates fill
-- every nullable provenance field below and are constrained to one per reviewed
-- step by the unique step/idempotency indexes.
ALTER TABLE "msaidizi_update_candidates"
  ADD COLUMN "proposedByPlanVersionId" TEXT,
  ADD COLUMN "proposedByStepId" TEXT,
  ADD COLUMN "proposalIdempotencyKey" TEXT,
  ADD COLUMN "proposalDigest" TEXT,
  ADD COLUMN "proposalRationale" TEXT,
  ADD COLUMN "sourceArtifactSha256" TEXT,
  ADD COLUMN "rollbackArtifactSha256" TEXT;

CREATE UNIQUE INDEX "msaidizi_update_candidates_proposedByStepId_key"
  ON "msaidizi_update_candidates"("proposedByStepId");
CREATE UNIQUE INDEX "msaidizi_update_candidates_proposalIdempotencyKey_key"
  ON "msaidizi_update_candidates"("proposalIdempotencyKey");
CREATE INDEX "msaidizi_update_candidates_proposedByPlanVersionId_idx"
  ON "msaidizi_update_candidates"("proposedByPlanVersionId");

ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_proposedByPlanVersionId_fkey"
  FOREIGN KEY ("proposedByPlanVersionId") REFERENCES "msaidizi_plan_versions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_proposedByStepId_fkey"
  FOREIGN KEY ("proposedByStepId") REFERENCES "msaidizi_task_steps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

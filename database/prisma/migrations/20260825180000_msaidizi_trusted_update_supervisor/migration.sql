CREATE TYPE "MsaidiziUpdateDeploymentStatus" AS ENUM (
  'QUEUED',
  'DISPATCHED',
  'APPLYING',
  'HEALTH_CHECK',
  'SUCCEEDED',
  'ROLLED_BACK',
  'FAILED',
  'NEEDS_ATTENTION'
);

CREATE TYPE "MsaidiziUpdateDeploymentOperation" AS ENUM ('APPLY', 'ROLLBACK');

CREATE TABLE "msaidizi_update_deployments" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "operation" "MsaidiziUpdateDeploymentOperation" NOT NULL DEFAULT 'APPLY',
  "ring" INTEGER NOT NULL,
  "targetId" TEXT NOT NULL,
  "status" "MsaidiziUpdateDeploymentStatus" NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" TEXT NOT NULL,
  "manifestJson" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL,
  "manifestSignature" TEXT NOT NULL,
  "signingKeyId" TEXT NOT NULL,
  "dispatchCount" INTEGER NOT NULL DEFAULT 0,
  "resultDigest" TEXT,
  "resultSummary" JSONB,
  "supervisorJournalHead" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_update_deployments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_update_deployments_ring_check" CHECK ("ring" IN (0, 5, 25, 100))
);

CREATE UNIQUE INDEX "msaidizi_update_deployments_idempotencyKey_key"
  ON "msaidizi_update_deployments"("idempotencyKey");
CREATE UNIQUE INDEX "msaidizi_update_deployments_candidate_device_ring_op_key"
  ON "msaidizi_update_deployments"("candidateId", "deviceId", "ring", "operation");
CREATE INDEX "msaidizi_update_deployments_device_status_queued_idx"
  ON "msaidizi_update_deployments"("deviceId", "status", "queuedAt");
CREATE INDEX "msaidizi_update_deployments_candidate_ring_status_idx"
  ON "msaidizi_update_deployments"("candidateId", "ring", "status");

ALTER TABLE "msaidizi_update_deployments"
  ADD CONSTRAINT "msaidizi_update_deployments_candidateId_fkey"
    FOREIGN KEY ("candidateId") REFERENCES "msaidizi_update_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_update_deployments_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "MsaidiziRecoveryCommandStatus" AS ENUM (
  'QUEUED',
  'DISPATCHED',
  'RECOVERING',
  'SUCCEEDED',
  'FAILED',
  'NEEDS_ATTENTION'
);

CREATE TABLE "msaidizi_recovery_commands" (
  "id" TEXT NOT NULL,
  "hostActionId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "originalActionId" TEXT NOT NULL,
  "recoveryRecordSha256" TEXT NOT NULL,
  "expectedCurrentStateSha256" TEXT NOT NULL,
  "status" "MsaidiziRecoveryCommandStatus" NOT NULL DEFAULT 'QUEUED',
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
  CONSTRAINT "msaidizi_recovery_commands_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_recovery_record_digest_check"
    CHECK ("recoveryRecordSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_recovery_expected_state_digest_check"
    CHECK ("expectedCurrentStateSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "msaidizi_recovery_manifest_digest_check"
    CHECK ("manifestSha256" ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX "msaidizi_recovery_commands_hostActionId_key"
  ON "msaidizi_recovery_commands"("hostActionId");
CREATE UNIQUE INDEX "msaidizi_recovery_commands_originalActionId_key"
  ON "msaidizi_recovery_commands"("originalActionId");
CREATE UNIQUE INDEX "msaidizi_recovery_commands_idempotencyKey_key"
  ON "msaidizi_recovery_commands"("idempotencyKey");
CREATE INDEX "msaidizi_recovery_commands_device_status_queued_idx"
  ON "msaidizi_recovery_commands"("deviceId", "status", "queuedAt");
CREATE INDEX "msaidizi_recovery_commands_requester_created_idx"
  ON "msaidizi_recovery_commands"("requestedByUserId", "createdAt");

ALTER TABLE "msaidizi_recovery_commands"
  ADD CONSTRAINT "msaidizi_recovery_commands_hostActionId_fkey"
    FOREIGN KEY ("hostActionId") REFERENCES "msaidizi_host_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_recovery_commands_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_recovery_commands_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

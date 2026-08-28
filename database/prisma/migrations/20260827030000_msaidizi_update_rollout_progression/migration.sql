-- Manifest v2 adds signed rollback, lease-generation, ACK, and health-soak
-- semantics which cannot be reconstructed or forged in SQL. Fail the upgrade
-- before any DDL when an older deployment ledger exists; operators must first
-- reconcile/export it through the pre-v2 application and obtain an empty
-- deployment ledger. This is intentionally stricter than silently stranding
-- QUEUED/DISPATCHED rows or pretending terminal rows carry v2 provenance.
DO $msaidizi_update_rollout_v2_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM "msaidizi_update_deployments") THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Msaidizi update rollout v2 requires an empty legacy deployment ledger';
  END IF;
END
$msaidizi_update_rollout_v2_guard$;

ALTER TABLE "msaidizi_update_candidates"
  ADD COLUMN "automaticProgressionEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "automaticProgressionArmedAt" TIMESTAMP(3),
  ADD COLUMN "automaticProgressionArmedById" TEXT,
  ADD COLUMN "automaticProgressionMinimumSoakSeconds" INTEGER,
  ADD COLUMN "automaticProgressionHealthTimeoutSeconds" INTEGER,
  ADD COLUMN "automaticProgressionRing0DwellSeconds" INTEGER,
  ADD COLUMN "automaticProgressionRing5DwellSeconds" INTEGER,
  ADD COLUMN "automaticProgressionRing25DwellSeconds" INTEGER,
  ADD COLUMN "automaticProgressionRing100DwellSeconds" INTEGER,
  ADD COLUMN "automaticProgressionRingHealthyAt" TIMESTAMP(3),
  ADD COLUMN "automaticProgressionRingEvidenceSha256" CHAR(64),
  ADD COLUMN "automaticProgressionCohortDeviceIds" JSONB,
  ADD COLUMN "automaticProgressionCohortSha256" CHAR(64),
  ADD COLUMN "automaticProgressionCohortCapturedAt" TIMESTAMP(3),
  ADD COLUMN "rollbackVersion" TEXT,
  ADD COLUMN "recoveryPending" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recoveryRequestedAt" TIMESTAMP(3),
  ADD COLUMN "recoveryLastAttemptAt" TIMESTAMP(3),
  ADD COLUMN "recoveryLastErrorCode" TEXT;

ALTER TABLE "msaidizi_update_deployments"
  ADD COLUMN "automaticProgression" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "manifestHistory" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN "deliveryLeaseId" TEXT,
  ADD COLUMN "deliveryLeaseExpiresAt" TIMESTAMP(3),
  ADD COLUMN "deliveryAcknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "healthCheckStartedAt" TIMESTAMP(3),
  ADD COLUMN "healthySoakEvidenceSha256" CHAR(64);

CREATE UNIQUE INDEX "msaidizi_update_deployments_delivery_lease_key"
  ON "msaidizi_update_deployments"("deliveryLeaseId");

CREATE INDEX "msaidizi_update_deployments_delivery_idx"
  ON "msaidizi_update_deployments"("deviceId", "status", "deliveryAcknowledgedAt", "deliveryLeaseExpiresAt");

CREATE INDEX "msaidizi_update_candidates_auto_progression_idx"
  ON "msaidizi_update_candidates"("automaticProgressionEnabled", "status", "rolloutRing", "updatedAt");

CREATE INDEX "msaidizi_update_candidates_recovery_outbox_idx"
  ON "msaidizi_update_candidates"("recoveryPending", "recoveryLastErrorCode", "recoveryRequestedAt");

ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_auto_progression_arm_check"
  CHECK (
    ("automaticProgressionEnabled" = false AND "automaticProgressionArmedAt" IS NULL AND "automaticProgressionArmedById" IS NULL AND "automaticProgressionMinimumSoakSeconds" IS NULL AND "automaticProgressionHealthTimeoutSeconds" IS NULL AND "automaticProgressionRing0DwellSeconds" IS NULL AND "automaticProgressionRing5DwellSeconds" IS NULL AND "automaticProgressionRing25DwellSeconds" IS NULL AND "automaticProgressionRing100DwellSeconds" IS NULL AND "automaticProgressionRingHealthyAt" IS NULL AND "automaticProgressionRingEvidenceSha256" IS NULL AND "automaticProgressionCohortDeviceIds" IS NULL AND "automaticProgressionCohortSha256" IS NULL AND "automaticProgressionCohortCapturedAt" IS NULL)
    OR
    ("automaticProgressionEnabled" = true AND "automaticProgressionArmedAt" IS NOT NULL AND "automaticProgressionArmedById" IS NOT NULL AND "automaticProgressionMinimumSoakSeconds" > 0 AND "automaticProgressionHealthTimeoutSeconds" > "automaticProgressionMinimumSoakSeconds" AND "automaticProgressionRing0DwellSeconds" >= 86400 AND "automaticProgressionRing5DwellSeconds" >= 86400 AND "automaticProgressionRing25DwellSeconds" >= 172800 AND "automaticProgressionRing100DwellSeconds" >= 259200 AND ("automaticProgressionRingHealthyAt" IS NULL) = ("automaticProgressionRingEvidenceSha256" IS NULL) AND ("automaticProgressionRingEvidenceSha256" IS NULL OR "automaticProgressionRingEvidenceSha256" ~ '^[0-9a-f]{64}$') AND jsonb_typeof("automaticProgressionCohortDeviceIds") = 'array' AND jsonb_array_length("automaticProgressionCohortDeviceIds") > 0 AND "automaticProgressionCohortSha256" ~ '^[0-9a-f]{64}$' AND "automaticProgressionCohortCapturedAt" IS NOT NULL)
  );

ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_recovery_outbox_check"
  CHECK (
    ("recoveryPending" = false AND "recoveryRequestedAt" IS NULL AND "recoveryLastErrorCode" IS NULL)
    OR
    ("recoveryPending" = true AND "recoveryRequestedAt" IS NOT NULL)
  );

ALTER TABLE "msaidizi_update_deployments"
  ADD CONSTRAINT "msaidizi_update_deployments_delivery_lease_check"
  CHECK (
    ("deliveryLeaseId" IS NULL AND "deliveryLeaseExpiresAt" IS NULL AND "deliveryAcknowledgedAt" IS NULL)
    OR
    ("deliveryLeaseId" IS NOT NULL AND "deliveryLeaseExpiresAt" IS NOT NULL AND ("deliveryAcknowledgedAt" IS NULL OR "deliveryAcknowledgedAt" <= "deliveryLeaseExpiresAt"))
  );

ALTER TABLE "msaidizi_update_deployments"
  ADD CONSTRAINT "msaidizi_update_deployments_soak_evidence_check"
  CHECK ("healthySoakEvidenceSha256" IS NULL OR "healthySoakEvidenceSha256" ~ '^[0-9a-f]{64}$');

-- Reserve a host action's exact signed external-egress ceiling before it can
-- cross the device boundary. The task row is the serialization point shared
-- by host dispatch, artifacts, and every other egress-producing flow.
--
-- This protocol cannot safely invent a prepaid ceiling for an action issued by
-- the earlier broker. Fail closed instead of silently grandfathering an
-- unaccounted device mutation. QUEUED rows and terminal rows with no
-- dispatchedAt evidence are known not to have crossed the boundary and can be
-- retained with zero counters.
DO $migration_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "msaidizi_host_actions"
    WHERE "dispatchedAt" IS NOT NULL
       OR "status" IN ('DISPATCHED', 'RUNNING')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '55000',
      MESSAGE = 'Cannot enable host-action egress reservations with previously dispatched actions',
      HINT = 'Reconcile and archive all previously dispatched host actions before retrying this migration.';
  END IF;
END
$migration_guard$;

ALTER TABLE "msaidizi_tasks"
  ADD COLUMN "reservedExternalEgressBytes" BIGINT NOT NULL DEFAULT 0;

ALTER TABLE "msaidizi_host_actions"
  ADD COLUMN "reservedExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "capabilityExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "brokerExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "uncertainExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "brokerMaxDeliverySessions" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "brokerMaxRequestAttemptsPerSession" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "brokerSerializedResultUpperBoundBytes" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "dispatchCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "acknowledgedDispatchCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "acknowledgedAt" TIMESTAMP(3),
  ADD COLUMN "journalExpectedPreviousSequence" INTEGER,
  ADD COLUMN "journalAccepted" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "msaidizi_tasks"
  ADD CONSTRAINT "msaidizi_tasks_external_egress_reservation_check" CHECK (
    "reservedExternalEgressBytes" >= 0 AND
    "externalEgressBytes" + "reservedExternalEgressBytes" <= "maxExternalEgressBytes"
  );

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_external_egress_usage_check" CHECK (
    "reservedExternalEgressBytes" >= 0 AND
    "brokerMaxDeliverySessions" >= 0 AND
    "brokerMaxRequestAttemptsPerSession" >= 0 AND
    "brokerSerializedResultUpperBoundBytes" >= 0 AND
    "dispatchCount" >= 0 AND
    "acknowledgedDispatchCount" >= 0 AND
    "acknowledgedDispatchCount" <= "dispatchCount" AND
    (
      ("acknowledgedDispatchCount" = 0 AND "acknowledgedAt" IS NULL) OR
      ("acknowledgedDispatchCount" > 0 AND
        "acknowledgedDispatchCount" = "dispatchCount" AND
        "acknowledgedAt" IS NOT NULL)
    ) AND
    ("status" <> 'QUEUED' OR (
      "reservedExternalEgressBytes" = 0 AND
      "brokerMaxDeliverySessions" = 0 AND
      "brokerMaxRequestAttemptsPerSession" = 0 AND
      "brokerSerializedResultUpperBoundBytes" = 0 AND
      "dispatchCount" = 0 AND
      "acknowledgedDispatchCount" = 0 AND
      "acknowledgedAt" IS NULL
    )) AND
    ((
      -- Terminal cancellation/rejection before first dispatch never crossed
      -- the device boundary and therefore has no reservation to settle.
      "dispatchedAt" IS NULL AND
      "reservedExternalEgressBytes" = 0 AND
      "brokerMaxDeliverySessions" = 0 AND
      "brokerMaxRequestAttemptsPerSession" = 0 AND
      "brokerSerializedResultUpperBoundBytes" = 0 AND
      "dispatchCount" = 0 AND
      "acknowledgedDispatchCount" = 0 AND
      "acknowledgedAt" IS NULL AND
      "capabilityExternalEgressBytes" = 0 AND
      "brokerExternalEgressBytes" = 0 AND
      "uncertainExternalEgressBytes" = 0
    ) OR (
      "dispatchedAt" IS NOT NULL AND
      "reservedExternalEgressBytes" > 0 AND
      "brokerMaxDeliverySessions" > 0 AND
      "brokerMaxRequestAttemptsPerSession" > 0 AND
      "brokerSerializedResultUpperBoundBytes" > 0 AND
      "dispatchCount" BETWEEN 1 AND "brokerMaxDeliverySessions" AND
      "brokerSerializedResultUpperBoundBytes"::BIGINT *
        "brokerMaxDeliverySessions"::BIGINT *
        "brokerMaxRequestAttemptsPerSession"::BIGINT <=
        LEAST(16777216::BIGINT, "reservedExternalEgressBytes" / 4) AND
      "capabilityExternalEgressBytes" + "brokerExternalEgressBytes" +
        "uncertainExternalEgressBytes" <= "reservedExternalEgressBytes"
    )) AND
    "capabilityExternalEgressBytes" >= 0 AND
    "brokerExternalEgressBytes" >= 0 AND
    "uncertainExternalEgressBytes" >= 0
  );

-- A device may redeliver its one in-flight action, but it may not receive a
-- different action until that action reaches a terminal state.
CREATE UNIQUE INDEX "msaidizi_host_actions_one_active_per_device_idx"
  ON "msaidizi_host_actions"("deviceId")
  WHERE "status" IN ('DISPATCHED', 'RUNNING');

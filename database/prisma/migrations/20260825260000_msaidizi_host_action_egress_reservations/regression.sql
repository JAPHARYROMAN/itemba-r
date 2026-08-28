-- Executable PostgreSQL regression for the host-action egress CHECK. It uses a
-- transaction-scoped temporary table and rolls back, so running it leaves no
-- database objects or rows behind.
BEGIN;

-- The rollout guard permits only rows provably never dispatched. It must abort
-- rather than fabricate a reservation for an older device-side action.
CREATE TEMPORARY TABLE "host_action_egress_rollout_probe" (
  "status" TEXT NOT NULL,
  "dispatchedAt" TIMESTAMPTZ
);

INSERT INTO "host_action_egress_rollout_probe" ("status", "dispatchedAt")
VALUES ('QUEUED', NULL), ('CANCELLED', NULL), ('FAILED', NULL);

DO $rollout_safe$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "host_action_egress_rollout_probe"
    WHERE "dispatchedAt" IS NOT NULL
       OR "status" IN ('DISPATCHED', 'RUNNING')
  ) THEN
    RAISE EXCEPTION 'rollout guard rejected a never-dispatched ledger';
  END IF;
END
$rollout_safe$;

INSERT INTO "host_action_egress_rollout_probe" ("status", "dispatchedAt")
VALUES ('SUCCEEDED', now());

DO $rollout_blocked$
DECLARE
  guard_blocked BOOLEAN := false;
BEGIN
  BEGIN
    IF EXISTS (
      SELECT 1
      FROM "host_action_egress_rollout_probe"
      WHERE "dispatchedAt" IS NOT NULL
         OR "status" IN ('DISPATCHED', 'RUNNING')
    ) THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'expected rollout guard rejection';
    END IF;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    guard_blocked := true;
  END;

  IF NOT guard_blocked THEN
    RAISE EXCEPTION 'rollout guard accepted a previously dispatched action';
  END IF;
END
$rollout_blocked$;

CREATE TEMPORARY TABLE "host_action_egress_constraint_probe" (
  "status" TEXT NOT NULL,
  "dispatchedAt" TIMESTAMPTZ,
  "reservedExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  "capabilityExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  "brokerExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  "uncertainExternalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  "brokerMaxDeliverySessions" INTEGER NOT NULL DEFAULT 0,
  "brokerMaxRequestAttemptsPerSession" INTEGER NOT NULL DEFAULT 0,
  "brokerSerializedResultUpperBoundBytes" INTEGER NOT NULL DEFAULT 0,
  "dispatchCount" INTEGER NOT NULL DEFAULT 0,
  "acknowledgedDispatchCount" INTEGER NOT NULL DEFAULT 0,
  "acknowledgedAt" TIMESTAMPTZ,
  CONSTRAINT "host_action_egress_constraint_probe_check" CHECK (
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
  )
);

-- Allowed state groups: queued, terminal-before-dispatch, active-dispatched,
-- and terminal-after-dispatch.
INSERT INTO "host_action_egress_constraint_probe" ("status")
VALUES ('QUEUED'), ('CANCELLED'), ('FAILED');

INSERT INTO "host_action_egress_constraint_probe" (
  "status", "dispatchedAt", "reservedExternalEgressBytes",
  "brokerMaxDeliverySessions", "brokerMaxRequestAttemptsPerSession",
  "brokerSerializedResultUpperBoundBytes", "dispatchCount",
  "capabilityExternalEgressBytes", "brokerExternalEgressBytes",
  "uncertainExternalEgressBytes"
)
VALUES
  ('DISPATCHED', now(), 8000000, 3, 3, 222222, 1, 0, 0, 0),
  ('RUNNING', now(), 8000000, 3, 3, 222222, 2, 0, 0, 0),
  ('SUCCEEDED', now(), 8000000, 3, 3, 222222, 2, 100, 1999998, 50);

DO $regression$
BEGIN
  -- A queued action cannot reserve or carry delivery credits.
  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" (
      "status", "dispatchedAt", "reservedExternalEgressBytes",
      "brokerMaxDeliverySessions", "brokerMaxRequestAttemptsPerSession",
      "brokerSerializedResultUpperBoundBytes", "dispatchCount"
    ) VALUES ('QUEUED', now(), 8000000, 3, 3, 222222, 1);
    RAISE EXCEPTION 'queued action incorrectly accepted a reservation';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Only zero/no-time or an ACK of the exact current generation is valid.
  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" (
      "status", "dispatchedAt", "reservedExternalEgressBytes",
      "brokerMaxDeliverySessions", "brokerMaxRequestAttemptsPerSession",
      "brokerSerializedResultUpperBoundBytes", "dispatchCount",
      "acknowledgedDispatchCount", "acknowledgedAt"
    ) VALUES ('DISPATCHED', now(), 8000000, 3, 3, 222222, 2, 1, now());
    RAISE EXCEPTION 'stale dispatch generation ACK incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" (
      "status", "dispatchedAt", "reservedExternalEgressBytes",
      "brokerMaxDeliverySessions", "brokerMaxRequestAttemptsPerSession",
      "brokerSerializedResultUpperBoundBytes", "dispatchCount",
      "acknowledgedDispatchCount", "acknowledgedAt"
    ) VALUES ('DISPATCHED', now(), 8000000, 3, 3, 222222, 1, 1, NULL);
    RAISE EXCEPTION 'ACK generation without receipt time incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Any state which crossed the boundary must retain its prepaid contract.
  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" ("status", "dispatchedAt")
    VALUES ('CANCELLED', now());
    RAISE EXCEPTION 'dispatched terminal action incorrectly accepted zero reservation';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- A non-dispatched terminal cannot fabricate a reservation after the fact.
  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" (
      "status", "reservedExternalEgressBytes", "brokerMaxDeliverySessions",
      "brokerMaxRequestAttemptsPerSession", "brokerSerializedResultUpperBoundBytes",
      "dispatchCount"
    ) VALUES ('FAILED', 8000000, 3, 3, 222222, 1);
    RAISE EXCEPTION 'never-dispatched terminal incorrectly accepted a reservation';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Broker prepayment is capped at one quarter of the issued action ceiling.
  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" (
      "status", "dispatchedAt", "reservedExternalEgressBytes",
      "brokerMaxDeliverySessions", "brokerMaxRequestAttemptsPerSession",
      "brokerSerializedResultUpperBoundBytes", "dispatchCount"
    ) VALUES ('DISPATCHED', now(), 8000000, 3, 3, 222223, 1);
    RAISE EXCEPTION 'oversized broker prepayment incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Central redelivery count cannot exceed the immutable session allowance.
  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" (
      "status", "dispatchedAt", "reservedExternalEgressBytes",
      "brokerMaxDeliverySessions", "brokerMaxRequestAttemptsPerSession",
      "brokerSerializedResultUpperBoundBytes", "dispatchCount"
    ) VALUES ('RUNNING', now(), 8000000, 3, 3, 222222, 4);
    RAISE EXCEPTION 'dispatch count above the session cap incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- Settled component usage may never exceed the action reservation.
  BEGIN
    INSERT INTO "host_action_egress_constraint_probe" (
      "status", "dispatchedAt", "reservedExternalEgressBytes",
      "brokerMaxDeliverySessions", "brokerMaxRequestAttemptsPerSession",
      "brokerSerializedResultUpperBoundBytes", "dispatchCount",
      "capabilityExternalEgressBytes", "brokerExternalEgressBytes",
      "uncertainExternalEgressBytes"
    ) VALUES ('FAILED', now(), 8000000, 3, 3, 222222, 1, 7000000, 1999998, 0);
    RAISE EXCEPTION 'usage above the reservation incorrectly accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$regression$;

ROLLBACK;

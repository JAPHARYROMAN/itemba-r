-- Executable PostgreSQL regression for the fail-closed v2 rollout guard.
-- It uses a transaction-scoped temporary ledger and leaves no state behind.
BEGIN;

CREATE TEMPORARY TABLE "msaidizi_update_deployments" (
  "id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL
);

-- An empty pre-v2 ledger is the only state whose signatures, lease ACKs, and
-- rollback version do not need to be fabricated during the schema upgrade.
DO $empty_ledger_allowed$
BEGIN
  IF EXISTS (SELECT 1 FROM "msaidizi_update_deployments") THEN
    RAISE EXCEPTION 'empty legacy ledger was rejected';
  END IF;
END
$empty_ledger_allowed$;

INSERT INTO "msaidizi_update_deployments" ("id", "status")
VALUES ('queued-v1', 'QUEUED');

DO $queued_v1_rejected$
DECLARE
  guard_blocked BOOLEAN := false;
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM "msaidizi_update_deployments") THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'expected v2 rollout guard rejection';
    END IF;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    guard_blocked := true;
  END;
  IF NOT guard_blocked THEN
    RAISE EXCEPTION 'legacy QUEUED deployment bypassed the v2 rollout guard';
  END IF;
END
$queued_v1_rejected$;

TRUNCATE "msaidizi_update_deployments";
INSERT INTO "msaidizi_update_deployments" ("id", "status")
VALUES ('dispatched-v1', 'DISPATCHED');

DO $dispatched_v1_rejected$
DECLARE
  guard_blocked BOOLEAN := false;
BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM "msaidizi_update_deployments") THEN
      RAISE EXCEPTION USING
        ERRCODE = '55000',
        MESSAGE = 'expected v2 rollout guard rejection';
    END IF;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    guard_blocked := true;
  END;
  IF NOT guard_blocked THEN
    RAISE EXCEPTION 'legacy DISPATCHED deployment bypassed the v2 rollout guard';
  END IF;
END
$dispatched_v1_rejected$;

ROLLBACK;

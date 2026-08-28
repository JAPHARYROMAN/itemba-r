-- Executable PostgreSQL regression for durable task wall-time accounting.
-- It uses a transaction-scoped probe table and rolls back every test row.
BEGIN;

-- Production may use an IANA workstation/company timezone. Prisma DateTime is
-- still persisted as a UTC TIMESTAMP WITHOUT TIME ZONE, so these regressions
-- deliberately execute outside UTC and model the UTC values sent by Prisma.
SET LOCAL TIME ZONE 'Africa/Nairobi';

CREATE TEMPORARY TABLE "msaidizi_task_wall_time_probe" (
  "id" TEXT PRIMARY KEY,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT
    (clock_timestamp() AT TIME ZONE 'UTC'),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "lastCheckpointAt" TIMESTAMP(3),
  "consumedWallTimeMs" BIGINT NOT NULL DEFAULT 0,
  "wallTimeCheckpointAt" TIMESTAMP(3),
  CONSTRAINT "wall_time_probe_nonnegative" CHECK ("consumedWallTimeMs" >= 0),
  CONSTRAINT "wall_time_probe_checkpoint_shape" CHECK (
    ("wallTimeCheckpointAt" IS NOT NULL)
    = ("startedAt" IS NOT NULL AND "endedAt" IS NULL)
  )
);

CREATE TRIGGER "wall_time_probe_accounting"
BEFORE INSERT OR UPDATE ON "msaidizi_task_wall_time_probe"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_accrue_task_wall_time();

-- Caller-supplied accounting is never accepted for an unstarted task.
INSERT INTO "msaidizi_task_wall_time_probe" (
  "id", "consumedWallTimeMs", "wallTimeCheckpointAt"
)
VALUES ('unstarted', 999999, clock_timestamp());

DO $unstarted_is_zero$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "msaidizi_task_wall_time_probe"
    WHERE "id" = 'unstarted'
      AND ("consumedWallTimeMs" <> 0 OR "wallTimeCheckpointAt" IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'unstarted task retained forged wall-time accounting';
  END IF;
END
$unstarted_is_zero$;

-- A started task accrues across PAUSED and CANCELLING, independently of its
-- status. Each update is also an idempotent checkpoint of only the open span.
WITH started AS (
  SELECT (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3) AS at
)
INSERT INTO "msaidizi_task_wall_time_probe" (
  "id", "status", "createdAt", "startedAt", "consumedWallTimeMs"
)
SELECT 'active', 'RUNNING', at, at, 999999 FROM started;

DO $utc_direct_running_insert$
DECLARE
  consumed_ms BIGINT;
  started_at TIMESTAMP(3);
  checkpoint_at TIMESTAMP(3);
BEGIN
  SELECT "consumedWallTimeMs", "startedAt", "wallTimeCheckpointAt"
    INTO consumed_ms, started_at, checkpoint_at
  FROM "msaidizi_task_wall_time_probe"
  WHERE "id" = 'active';
  IF consumed_ms < 0
    OR consumed_ms > 1000
    OR checkpoint_at IS NULL
    OR ABS(EXTRACT(EPOCH FROM (checkpoint_at - started_at)) * 1000) > 1000
  THEN
    RAISE EXCEPTION
      'UTC RUNNING insert was charged a session-timezone offset: % ms', consumed_ms;
  END IF;
END
$utc_direct_running_insert$;

SELECT pg_sleep(0.02);
UPDATE "msaidizi_task_wall_time_probe"
SET "status" = 'PAUSED', "lastCheckpointAt" = clock_timestamp()
WHERE "id" = 'active';

CREATE TEMPORARY TABLE "wall_time_observations" (
  "name" TEXT PRIMARY KEY,
  "consumed" BIGINT NOT NULL,
  "checkpoint" TIMESTAMP(3)
);
INSERT INTO "wall_time_observations"
SELECT 'paused', "consumedWallTimeMs", "wallTimeCheckpointAt"
FROM "msaidizi_task_wall_time_probe"
WHERE "id" = 'active';

SELECT pg_sleep(0.02);
UPDATE "msaidizi_task_wall_time_probe"
SET "status" = 'CANCELLING', "lastCheckpointAt" = clock_timestamp()
WHERE "id" = 'active';

DO $pause_and_cancel_accrue$
DECLARE
  paused_ms BIGINT;
  cancelling_ms BIGINT;
  paused_checkpoint TIMESTAMP(3);
  cancelling_checkpoint TIMESTAMP(3);
  exact_delta_ms BIGINT;
BEGIN
  SELECT "consumed", "checkpoint" INTO paused_ms, paused_checkpoint
  FROM "wall_time_observations" WHERE "name" = 'paused';
  SELECT "consumedWallTimeMs", "wallTimeCheckpointAt"
    INTO cancelling_ms, cancelling_checkpoint
  FROM "msaidizi_task_wall_time_probe" WHERE "id" = 'active';
  exact_delta_ms := FLOOR(
    EXTRACT(EPOCH FROM (cancelling_checkpoint - paused_checkpoint)) * 1000
  )::BIGINT;
  IF paused_ms <= 0 OR exact_delta_ms <= 0 OR cancelling_ms <> paused_ms + exact_delta_ms THEN
    RAISE EXCEPTION 'pause/cancel checkpoint stopped or double-counted the hard wall clock';
  END IF;
END
$pause_and_cancel_accrue$;

-- Terminal settlement folds the last open span, then clears the checkpoint.
UPDATE "msaidizi_task_wall_time_probe"
SET "status" = 'COMPLETED', "endedAt" = clock_timestamp()
WHERE "id" = 'active';
INSERT INTO "wall_time_observations"
SELECT 'terminal', "consumedWallTimeMs", "wallTimeCheckpointAt"
FROM "msaidizi_task_wall_time_probe"
WHERE "id" = 'active';

SELECT pg_sleep(0.03);
UPDATE "msaidizi_task_wall_time_probe"
SET "status" = 'QUEUED', "endedAt" = NULL
WHERE "id" = 'active';

DO $terminal_gap_is_frozen$
DECLARE
  terminal_ms BIGINT;
  reopened_ms BIGINT;
  reopened_checkpoint TIMESTAMP(3);
BEGIN
  SELECT "consumed" INTO terminal_ms
  FROM "wall_time_observations" WHERE "name" = 'terminal';
  SELECT "consumedWallTimeMs", "wallTimeCheckpointAt"
    INTO reopened_ms, reopened_checkpoint
  FROM "msaidizi_task_wall_time_probe" WHERE "id" = 'active';
  IF reopened_ms <> terminal_ms OR reopened_checkpoint IS NULL THEN
    RAISE EXCEPTION 'reopen charged the terminal gap or failed to start a fresh checkpoint';
  END IF;
END
$terminal_gap_is_frozen$;

-- The checkpoint invariant is biconditional even if the accounting trigger is
-- deliberately disabled to simulate malformed imported state.
ALTER TABLE "msaidizi_task_wall_time_probe" DISABLE TRIGGER "wall_time_probe_accounting";
DO $missing_checkpoint_rejected$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE "msaidizi_task_wall_time_probe"
    SET "wallTimeCheckpointAt" = NULL
    WHERE "id" = 'active';
  EXCEPTION WHEN check_violation THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'started nonterminal task accepted a missing wall checkpoint';
  END IF;
END
$missing_checkpoint_rejected$;
ALTER TABLE "msaidizi_task_wall_time_probe" ENABLE TRIGGER "wall_time_probe_accounting";

DO $terminal_insert_rejected$
DECLARE
  rejected BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO "msaidizi_task_wall_time_probe" (
      "id", "createdAt", "startedAt", "endedAt"
    )
    VALUES (
      'terminal-import',
      (clock_timestamp() AT TIME ZONE 'UTC'),
      (clock_timestamp() AT TIME ZONE 'UTC'),
      (clock_timestamp() AT TIME ZONE 'UTC')
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    rejected := true;
  END;
  IF NOT rejected THEN
    RAISE EXCEPTION 'terminal task import bypassed accounting initialization';
  END IF;
END
$terminal_insert_rejected$;

DO $forged_start_rejected$
DECLARE
  backdated_rejected BOOLEAN := false;
  future_rejected BOOLEAN := false;
BEGIN
  BEGIN
    INSERT INTO "msaidizi_task_wall_time_probe" ("id", "createdAt", "startedAt")
    VALUES (
      'backdated',
      (clock_timestamp() AT TIME ZONE 'UTC'),
      (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour'
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    backdated_rejected := true;
  END;
  BEGIN
    INSERT INTO "msaidizi_task_wall_time_probe" ("id", "createdAt", "startedAt")
    VALUES (
      'future',
      (clock_timestamp() AT TIME ZONE 'UTC'),
      (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '6 minutes'
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    future_rejected := true;
  END;
  IF NOT backdated_rejected OR NOT future_rejected THEN
    RAISE EXCEPTION 'forged initial start timestamp bypassed its bounded window';
  END IF;
END
$forged_start_rejected$;

-- Task-step first-start enforcement uses the same UTC-naive contract for both
-- direct RUNNING inserts and the normal PENDING -> RUNNING update.
CREATE TEMPORARY TABLE "msaidizi_task_step_start_probe" (
  "id" TEXT PRIMARY KEY,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT
    (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "startedAt" TIMESTAMP(3)
);

CREATE TRIGGER "task_step_start_probe_guard"
BEFORE INSERT OR UPDATE ON "msaidizi_task_step_start_probe"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_guard_step_first_start();

INSERT INTO "msaidizi_task_step_start_probe" ("id") VALUES ('normal-start');
UPDATE "msaidizi_task_step_start_probe"
SET "startedAt" = (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3)
WHERE "id" = 'normal-start';

WITH js_clock AS (
  SELECT (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3) AS at
)
INSERT INTO "msaidizi_task_step_start_probe" ("id", "createdAt", "startedAt")
SELECT 'direct-running', at, at FROM js_clock;

DO $utc_defaults_and_step_starts$
DECLARE
  created_at TIMESTAMP(3);
  started_at TIMESTAMP(3);
  utc_now TIMESTAMP(3) := (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);
BEGIN
  IF current_setting('TimeZone') <> 'Africa/Nairobi' THEN
    RAISE EXCEPTION 'timezone regression did not run under Africa/Nairobi';
  END IF;
  SELECT "createdAt", "startedAt" INTO created_at, started_at
  FROM "msaidizi_task_step_start_probe" WHERE "id" = 'normal-start';
  IF ABS(EXTRACT(EPOCH FROM (utc_now - created_at))) > 1 OR started_at < created_at THEN
    RAISE EXCEPTION 'UTC default and Prisma UTC first start are inconsistent';
  END IF;
END
$utc_defaults_and_step_starts$;

DO $step_start_guards$
DECLARE
  immutable_rejected BOOLEAN := false;
  backdated_rejected BOOLEAN := false;
  future_rejected BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE "msaidizi_task_step_start_probe"
    SET "startedAt" = "startedAt" + INTERVAL '1 millisecond'
    WHERE "id" = 'normal-start';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    immutable_rejected := true;
  END;
  BEGIN
    INSERT INTO "msaidizi_task_step_start_probe" ("id", "createdAt", "startedAt")
    VALUES (
      'step-backdated',
      (clock_timestamp() AT TIME ZONE 'UTC'),
      (clock_timestamp() AT TIME ZONE 'UTC') - INTERVAL '1 hour'
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    backdated_rejected := true;
  END;
  BEGIN
    INSERT INTO "msaidizi_task_step_start_probe" ("id", "createdAt", "startedAt")
    VALUES (
      'step-future',
      (clock_timestamp() AT TIME ZONE 'UTC'),
      (clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '6 minutes'
    );
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    future_rejected := true;
  END;
  IF NOT immutable_rejected OR NOT backdated_rejected OR NOT future_rejected THEN
    RAISE EXCEPTION 'task-step first-start guards accepted an invalid timestamp';
  END IF;
END
$step_start_guards$;

-- Exercise the deployed tables and triggers too, not only shape-compatible
-- probes. These rows are transaction-local and disappear at ROLLBACK.
INSERT INTO "msaidizi_principals" (
  "id", "key", "displayName", "grants", "updatedAt"
)
VALUES (
  'utc-runtime-regression-principal',
  'utc-runtime-regression-principal',
  'UTC runtime regression principal',
  '{}'::JSONB,
  (clock_timestamp() AT TIME ZONE 'UTC')
);

WITH js_clock AS (
  SELECT (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3) AS at
)
INSERT INTO "msaidizi_tasks" (
  "id", "principalId", "mode", "title", "objective", "status",
  "activePlanVersion", "startedAt", "updatedAt"
)
SELECT
  'utc-runtime-regression-task',
  'utc-runtime-regression-principal',
  'COLLABORATIVE',
  'UTC runtime regression',
  'Prove timezone-independent first-start accounting',
  'RUNNING',
  1,
  at,
  at
FROM js_clock;

DO $real_task_utc_accounting$
DECLARE
  consumed_ms BIGINT;
  created_at TIMESTAMP(3);
  started_at TIMESTAMP(3);
  checkpoint_at TIMESTAMP(3);
BEGIN
  SELECT "consumedWallTimeMs", "createdAt", "startedAt", "wallTimeCheckpointAt"
    INTO consumed_ms, created_at, started_at, checkpoint_at
  FROM "msaidizi_tasks"
  WHERE "id" = 'utc-runtime-regression-task';
  IF consumed_ms < 0
    OR consumed_ms > 1000
    OR started_at < created_at
    OR checkpoint_at IS NULL
    OR ABS(EXTRACT(EPOCH FROM (checkpoint_at - started_at)) * 1000) > 1000
  THEN
    RAISE EXCEPTION 'real task UTC accounting is invalid: % ms', consumed_ms;
  END IF;
END
$real_task_utc_accounting$;

INSERT INTO "msaidizi_plan_versions" (
  "id", "taskId", "version", "summary", "objective", "inputs",
  "stopConditions", "budgetSnapshot", "planDigest"
)
VALUES (
  'utc-runtime-regression-plan',
  'utc-runtime-regression-task',
  1,
  'UTC runtime regression',
  'Prove timezone-independent first-start accounting',
  '{}'::JSONB,
  '{}'::JSONB,
  '{}'::JSONB,
  repeat('a', 64)
);

WITH js_clock AS (
  SELECT (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3) AS at
)
INSERT INTO "msaidizi_task_steps" (
  "id", "taskId", "planVersionId", "stepKey", "sequence", "name",
  "target", "capability", "capabilityVersion", "arguments", "dependencies",
  "expectedEffect", "dataClass", "preconditions", "budgets", "stopConditions",
  "idempotent", "mutation", "status", "startedAt", "updatedAt"
)
SELECT
  'utc-runtime-regression-step',
  'utc-runtime-regression-task',
  'utc-runtime-regression-plan',
  'read',
  1,
  'Read',
  'ERP',
  'RegressionController.read',
  '1',
  '{"path":{},"query":{},"body":null}'::JSONB,
  '[]'::JSONB,
  'READ',
  'internal',
  '{}'::JSONB,
  '{}'::JSONB,
  '{}'::JSONB,
  true,
  false,
  'RUNNING',
  at,
  at
FROM js_clock;

DO $real_step_utc_start$
DECLARE
  created_at TIMESTAMP(3);
  started_at TIMESTAMP(3);
  immutable_rejected BOOLEAN := false;
BEGIN
  SELECT "createdAt", "startedAt" INTO created_at, started_at
  FROM "msaidizi_task_steps"
  WHERE "id" = 'utc-runtime-regression-step';
  IF started_at < created_at OR started_at - created_at > INTERVAL '1 second' THEN
    RAISE EXCEPTION 'real task-step UTC first start is invalid';
  END IF;
  BEGIN
    UPDATE "msaidizi_task_steps"
    SET "startedAt" = "startedAt" + INTERVAL '1 millisecond'
    WHERE "id" = 'utc-runtime-regression-step';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    immutable_rejected := true;
  END;
  IF NOT immutable_rejected THEN
    RAISE EXCEPTION 'real task-step first start was mutable';
  END IF;
END
$real_step_utc_start$;

ROLLBACK;

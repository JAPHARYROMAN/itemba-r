-- Task ceilings and first-start timestamps are authorization/accounting facts.
-- Pause, resume, worker retry, and process restart may advance runtime state,
-- but they must never restart a wall clock or raise a reviewed ceiling.
CREATE OR REPLACE FUNCTION msaidizi_guard_task_runtime_ceiling()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  utc_now TIMESTAMP(3) := (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);
BEGIN
  IF NEW."maxWallTimeSeconds" IS DISTINCT FROM OLD."maxWallTimeSeconds"
    OR NEW."maxModelTurns" IS DISTINCT FROM OLD."maxModelTurns"
    OR NEW."maxAttemptedToolCalls" IS DISTINCT FROM OLD."maxAttemptedToolCalls"
    OR NEW."maxMutations" IS DISTINCT FROM OLD."maxMutations"
    OR NEW."maxLocalBytes" IS DISTINCT FROM OLD."maxLocalBytes"
    OR NEW."maxExternalEgressBytes" IS DISTINCT FROM OLD."maxExternalEgressBytes"
    OR NEW."maxModelCostUsd" IS DISTINCT FROM OLD."maxModelCostUsd"
  THEN
    RAISE EXCEPTION 'Msaidizi task runtime ceilings are immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."startedAt" IS NOT NULL
    AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
  THEN
    RAISE EXCEPTION 'Msaidizi task first-start timestamp is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."startedAt" IS NULL
    AND NEW."startedAt" IS NOT NULL
    AND (
      NEW."startedAt" < OLD."createdAt"
      OR NEW."startedAt" > utc_now + INTERVAL '5 minutes'
    )
  THEN
    RAISE EXCEPTION 'Msaidizi task first-start timestamp is outside its valid window'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_tasks_runtime_ceiling_guard"
BEFORE UPDATE ON "msaidizi_tasks"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_guard_task_runtime_ceiling();

CREATE OR REPLACE FUNCTION msaidizi_guard_step_first_start()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  utc_now TIMESTAMP(3) := (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);
BEGIN
  IF OLD."startedAt" IS NOT NULL
    AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt"
  THEN
    RAISE EXCEPTION 'Msaidizi task-step first-start timestamp is immutable'
      USING ERRCODE = '55000';
  END IF;

  IF OLD."startedAt" IS NULL
    AND NEW."startedAt" IS NOT NULL
    AND (
      NEW."startedAt" < OLD."createdAt"
      OR NEW."startedAt" > utc_now + INTERVAL '5 minutes'
    )
  THEN
    RAISE EXCEPTION 'Msaidizi task-step first-start timestamp is outside its valid window'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_task_steps_first_start_guard"
BEFORE UPDATE ON "msaidizi_task_steps"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_guard_step_first_start();

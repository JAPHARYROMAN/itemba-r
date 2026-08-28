-- Prisma maps DateTime to PostgreSQL TIMESTAMP WITHOUT TIME ZONE. Every
-- Msaidizi runtime timestamp therefore stores a UTC wall-clock representation;
-- never let the connection's TimeZone participate in a comparison or elapsed
-- time calculation.
ALTER TABLE "msaidizi_tasks"
  ALTER COLUMN "createdAt"
  SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

ALTER TABLE "msaidizi_task_steps"
  ALTER COLUMN "createdAt"
  SET DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC');

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

CREATE OR REPLACE FUNCTION msaidizi_guard_step_first_start()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  utc_now TIMESTAMP(3) := (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."startedAt" IS NOT NULL
      AND (
        NEW."startedAt" < NEW."createdAt"
        OR NEW."startedAt" > utc_now + INTERVAL '5 minutes'
      )
    THEN
      RAISE EXCEPTION 'Msaidizi task-step initial start timestamp is outside its valid window'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

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

DROP TRIGGER IF EXISTS "msaidizi_task_steps_first_start_guard"
  ON "msaidizi_task_steps";
CREATE TRIGGER "msaidizi_task_steps_first_start_guard"
BEFORE INSERT OR UPDATE ON "msaidizi_task_steps"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_guard_step_first_start();

CREATE OR REPLACE FUNCTION msaidizi_accrue_task_wall_time()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  checkpoint_time TIMESTAMP(3) :=
    (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3);
  elapsed_delta_ms BIGINT := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."endedAt" IS NOT NULL THEN
      RAISE EXCEPTION 'Msaidizi task cannot be inserted in a terminal runtime state'
        USING ERRCODE = '55000';
    END IF;
    IF NEW."startedAt" IS NOT NULL
      AND (
        NEW."startedAt" < NEW."createdAt"
        OR NEW."startedAt" > checkpoint_time + INTERVAL '5 minutes'
      )
    THEN
      RAISE EXCEPTION 'Msaidizi task initial start timestamp is outside its valid window'
        USING ERRCODE = '55000';
    END IF;

    NEW."consumedWallTimeMs" := CASE
      WHEN NEW."startedAt" IS NULL THEN 0
      ELSE GREATEST(
        0,
        FLOOR(EXTRACT(EPOCH FROM (checkpoint_time - NEW."startedAt")) * 1000)::BIGINT
      )
    END;
    NEW."wallTimeCheckpointAt" := CASE
      WHEN NEW."startedAt" IS NOT NULL AND NEW."endedAt" IS NULL THEN checkpoint_time
      ELSE NULL
    END;
    RETURN NEW;
  END IF;

  IF OLD."wallTimeCheckpointAt" IS NOT NULL THEN
    elapsed_delta_ms := GREATEST(
      0,
      FLOOR(
        EXTRACT(EPOCH FROM (checkpoint_time - OLD."wallTimeCheckpointAt")) * 1000
      )::BIGINT
    );
  END IF;

  -- Application-supplied accounting remains untrusted. Row locking serializes
  -- this fold and an already-overcharged pre-release row is never reduced.
  NEW."consumedWallTimeMs" := OLD."consumedWallTimeMs" + elapsed_delta_ms;
  NEW."wallTimeCheckpointAt" := CASE
    WHEN NEW."startedAt" IS NOT NULL AND NEW."endedAt" IS NULL THEN checkpoint_time
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

-- Convert every open checkpoint to the canonical UTC representation now. If a
-- pre-release database used the old local-time trigger, its conservative
-- overcharge is retained rather than silently granting more runtime authority.
UPDATE "msaidizi_tasks"
SET "wallTimeCheckpointAt" =
  (clock_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3)
WHERE "startedAt" IS NOT NULL
  AND "endedAt" IS NULL;

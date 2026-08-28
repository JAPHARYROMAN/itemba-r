-- Wall time is a durable hard-clock budget, not process uptime. Once a task
-- first enters RUNNING, its clock continues through PAUSING, PAUSED, resumed
-- QUEUED work, CANCELLING, and active replanning. It stops while the task is
-- terminal and resumes from the frozen value if explicitly reopened. The
-- database owns the counter and checkpoint so concurrent worker checkpoints
-- and process restarts cannot reset or double-count it.
ALTER TABLE "msaidizi_tasks"
  ADD COLUMN "consumedWallTimeMs" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "wallTimeCheckpointAt" TIMESTAMP(3);

-- Preserve the previous first-start wall-clock semantics for rows that predate
-- this migration. A terminal task is frozen at its terminal/checkpoint time;
-- every other started task is caught up to the migration statement time.
UPDATE "msaidizi_tasks"
SET "consumedWallTimeMs" = CASE
      WHEN "startedAt" IS NULL THEN 0
      ELSE GREATEST(
        0,
        FLOOR(
          EXTRACT(
            EPOCH FROM (
              CASE
                WHEN "endedAt" IS NOT NULL
                  THEN COALESCE("endedAt", "lastCheckpointAt", "updatedAt")
                ELSE (statement_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3)
              END - "startedAt"
            )
          ) * 1000
        )::BIGINT
      )
    END,
    "wallTimeCheckpointAt" = CASE
      WHEN "startedAt" IS NOT NULL AND "endedAt" IS NULL
        THEN (statement_timestamp() AT TIME ZONE 'UTC')::TIMESTAMP(3)
      ELSE NULL
    END;

ALTER TABLE "msaidizi_tasks"
  ADD CONSTRAINT "msaidizi_tasks_consumed_wall_time_nonnegative"
    CHECK ("consumedWallTimeMs" >= 0),
  ADD CONSTRAINT "msaidizi_tasks_wall_time_checkpoint_shape"
    CHECK (
      ("wallTimeCheckpointAt" IS NOT NULL)
      = ("startedAt" IS NOT NULL AND "endedAt" IS NULL)
    );

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

    -- A new durable task has not consumed wall time unless it is deliberately
    -- imported as already started. Caller-supplied counter/anchor values are
    -- never trusted as accounting facts.
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

  -- Ignore attempted application rewrites of both accounting fields. PostgreSQL
  -- row locking serializes this fold, so overlapping/idempotent checkpoints use
  -- the latest OLD boundary and cannot count the same interval twice.
  NEW."consumedWallTimeMs" := OLD."consumedWallTimeMs" + elapsed_delta_ms;
  NEW."wallTimeCheckpointAt" := CASE
    WHEN NEW."startedAt" IS NOT NULL AND NEW."endedAt" IS NULL THEN checkpoint_time
    ELSE NULL
  END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_tasks_wall_time_accounting"
BEFORE INSERT OR UPDATE ON "msaidizi_tasks"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_accrue_task_wall_time();

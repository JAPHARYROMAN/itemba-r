-- Step-local local-I/O accounting is intentionally forward-only. Historical
-- task counters cannot be attributed to individual steps without guessing, so
-- pre-existing steps start invalid and must be replanned before dispatch.
ALTER TABLE "msaidizi_task_steps"
  ADD COLUMN "bytesRead" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "bytesWritten" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "localIoAccountingValid" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "msaidizi_task_steps"
  ADD CONSTRAINT "msaidizi_task_steps_bytesRead_nonnegative"
    CHECK ("bytesRead" >= 0),
  ADD CONSTRAINT "msaidizi_task_steps_bytesWritten_nonnegative"
    CHECK ("bytesWritten" >= 0);

-- New inserts are exact from birth. Existing rows retain the explicit false
-- value written above even after the default changes.
ALTER TABLE "msaidizi_task_steps"
  ALTER COLUMN "localIoAccountingValid" SET DEFAULT true;

-- Plan budgets are an authorization ceiling, not mutable runtime state.
CREATE OR REPLACE FUNCTION msaidizi_reject_step_budget_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."budgets" IS DISTINCT FROM OLD."budgets" THEN
    RAISE EXCEPTION 'Msaidizi task-step budgets are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_task_steps_immutable_budgets"
BEFORE UPDATE ON "msaidizi_task_steps"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_step_budget_rewrite();

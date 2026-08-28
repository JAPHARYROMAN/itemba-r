-- A reviewed plan is an authorization artifact. Replanning inserts a new
-- version; neither application code nor a compromised SQL client may rewrite
-- or erase the version that authorized already-recorded work.
CREATE OR REPLACE FUNCTION msaidizi_reject_plan_version_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Msaidizi plan versions are append-preserved and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  RAISE EXCEPTION 'Msaidizi plan versions are immutable; insert a new version instead'
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "msaidizi_plan_versions_immutable"
BEFORE UPDATE OR DELETE ON "msaidizi_plan_versions"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_plan_version_rewrite();

-- Step execution state is mutable, but the reviewed definition is not. Keep
-- status, attempts, accounting counters and checkpoint timestamps available to
-- the runtime while binding every authority-bearing field to its plan version.
CREATE OR REPLACE FUNCTION msaidizi_reject_step_definition_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Msaidizi task steps are append-preserved and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  IF NEW."taskId" IS DISTINCT FROM OLD."taskId"
    OR NEW."planVersionId" IS DISTINCT FROM OLD."planVersionId"
    OR NEW."stepKey" IS DISTINCT FROM OLD."stepKey"
    OR NEW."sequence" IS DISTINCT FROM OLD."sequence"
    OR NEW."name" IS DISTINCT FROM OLD."name"
    OR NEW."target" IS DISTINCT FROM OLD."target"
    OR NEW."capability" IS DISTINCT FROM OLD."capability"
    OR NEW."capabilityVersion" IS DISTINCT FROM OLD."capabilityVersion"
    OR NEW."arguments" IS DISTINCT FROM OLD."arguments"
    OR NEW."dependencies" IS DISTINCT FROM OLD."dependencies"
    OR NEW."expectedEffect" IS DISTINCT FROM OLD."expectedEffect"
    OR NEW."dataClass" IS DISTINCT FROM OLD."dataClass"
    OR NEW."preconditions" IS DISTINCT FROM OLD."preconditions"
    OR NEW."recovery" IS DISTINCT FROM OLD."recovery"
    OR NEW."budgets" IS DISTINCT FROM OLD."budgets"
    OR NEW."stopConditions" IS DISTINCT FROM OLD."stopConditions"
    OR NEW."idempotent" IS DISTINCT FROM OLD."idempotent"
    OR NEW."mutation" IS DISTINCT FROM OLD."mutation"
    OR NEW."localIoAccountingValid" IS DISTINCT FROM OLD."localIoAccountingValid"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  THEN
    RAISE EXCEPTION 'Msaidizi task-step definitions are immutable; replan into a new version'
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_task_steps_immutable_definition"
BEFORE UPDATE OR DELETE ON "msaidizi_task_steps"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_step_definition_rewrite();

-- Typed, reviewed dataflow is part of the immutable plan definition. Existing
-- plans keep their exact static-arguments behavior through the empty default.
ALTER TABLE "msaidizi_task_steps"
  ADD COLUMN "inputBindings" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "msaidizi_tool_attempts"
  ADD COLUMN "resolvedInputProvenance" JSONB,
  ADD COLUMN "inputProvenanceSha256" CHAR(64);

ALTER TABLE "msaidizi_host_actions"
  ADD COLUMN "attemptId" TEXT,
  ADD COLUMN "resolvedInputProvenance" JSONB,
  ADD COLUMN "inputProvenanceSha256" CHAR(64);

CREATE UNIQUE INDEX "msaidizi_host_actions_attemptId_key"
  ON "msaidizi_host_actions"("attemptId");

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "msaidizi_tool_attempts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "msaidizi_tool_attempts"
  ADD CONSTRAINT "msaidizi_tool_attempt_input_provenance_pair"
  CHECK (
    ("resolvedInputProvenance" IS NULL AND "inputProvenanceSha256" IS NULL)
    OR
    ("resolvedInputProvenance" IS NOT NULL AND
     "inputProvenanceSha256" IS NOT NULL AND
     "inputProvenanceSha256" ~ '^[a-f0-9]{64}$')
  );

ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_action_input_provenance_pair"
  CHECK (
    ("resolvedInputProvenance" IS NULL AND "inputProvenanceSha256" IS NULL)
    OR
    ("resolvedInputProvenance" IS NOT NULL AND
     "inputProvenanceSha256" IS NOT NULL AND
     "inputProvenanceSha256" ~ '^[a-f0-9]{64}$')
  );

CREATE OR REPLACE FUNCTION msaidizi_reject_input_binding_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."inputBindings" IS DISTINCT FROM OLD."inputBindings" THEN
    RAISE EXCEPTION 'Msaidizi task input bindings are immutable; replan into a new version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_task_input_bindings_immutable"
BEFORE UPDATE OF "inputBindings" ON "msaidizi_task_steps"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_input_binding_rewrite();

CREATE OR REPLACE FUNCTION msaidizi_reject_attempt_input_provenance_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."resolvedInputProvenance" IS NOT NULL
    AND (
      NEW."resolvedInputProvenance" IS DISTINCT FROM OLD."resolvedInputProvenance"
      OR NEW."inputProvenanceSha256" IS DISTINCT FROM OLD."inputProvenanceSha256"
      OR NEW."argsDigest" IS DISTINCT FROM OLD."argsDigest"
    )
  THEN
    RAISE EXCEPTION 'Resolved Msaidizi attempt input provenance is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_attempt_input_provenance_immutable"
BEFORE UPDATE OF "resolvedInputProvenance", "inputProvenanceSha256", "argsDigest"
ON "msaidizi_tool_attempts"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_attempt_input_provenance_rewrite();

CREATE OR REPLACE FUNCTION msaidizi_reject_host_input_provenance_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  bound_attempt RECORD;
BEGIN
  IF TG_OP = 'INSERT' AND NEW."attemptId" IS NOT NULL THEN
    SELECT "taskId", "stepId" INTO bound_attempt
    FROM "msaidizi_tool_attempts"
    WHERE "id" = NEW."attemptId";
    IF NOT FOUND
      OR bound_attempt."taskId" IS DISTINCT FROM NEW."taskId"
      OR bound_attempt."stepId" IS DISTINCT FROM NEW."stepId"
    THEN
      RAISE EXCEPTION 'Host action attempt must belong to the exact task and step'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."attemptId" IS DISTINCT FROM OLD."attemptId"
    OR NEW."resolvedInputProvenance" IS DISTINCT FROM OLD."resolvedInputProvenance"
    OR NEW."inputProvenanceSha256" IS DISTINCT FROM OLD."inputProvenanceSha256"
    OR NEW."argsDigest" IS DISTINCT FROM OLD."argsDigest"
  ) THEN
    RAISE EXCEPTION 'Host action resolved input binding is immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_host_input_provenance_immutable"
BEFORE INSERT OR UPDATE
ON "msaidizi_host_actions"
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_host_input_provenance_rewrite();

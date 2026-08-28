-- Executable PostgreSQL regression for the all-or-none provenance pair and
-- immutable plan/attempt/host bindings installed by this migration.
BEGIN;

DO $constraint_shape$
DECLARE
  attempt_definition TEXT;
  host_definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO attempt_definition
  FROM pg_constraint
  WHERE conname = 'msaidizi_tool_attempt_input_provenance_pair';

  SELECT pg_get_constraintdef(oid)
  INTO host_definition
  FROM pg_constraint
  WHERE conname = 'msaidizi_host_action_input_provenance_pair';

  IF attempt_definition IS NULL
    OR attempt_definition NOT LIKE '%"inputProvenanceSha256" IS NOT NULL%'
  THEN
    RAISE EXCEPTION 'tool-attempt provenance pair permits SQL UNKNOWN';
  END IF;

  IF host_definition IS NULL
    OR host_definition NOT LIKE '%"inputProvenanceSha256" IS NOT NULL%'
  THEN
    RAISE EXCEPTION 'host-action provenance pair permits SQL UNKNOWN';
  END IF;
END
$constraint_shape$;

CREATE TEMPORARY TABLE input_binding_probe (
  "inputBindings" JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TRIGGER input_binding_probe_immutable
BEFORE UPDATE OF "inputBindings" ON input_binding_probe
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_input_binding_rewrite();
INSERT INTO input_binding_probe DEFAULT VALUES;

DO $input_binding_immutable$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE input_binding_probe SET "inputBindings" = '[{"target":"body.value"}]'::jsonb;
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'task input bindings were mutable';
  END IF;
END
$input_binding_immutable$;

CREATE TEMPORARY TABLE attempt_provenance_probe (
  "resolvedInputProvenance" JSONB,
  "inputProvenanceSha256" CHAR(64),
  "argsDigest" TEXT NOT NULL
);
CREATE TRIGGER attempt_provenance_probe_immutable
BEFORE UPDATE ON attempt_provenance_probe
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_attempt_input_provenance_rewrite();
INSERT INTO attempt_provenance_probe VALUES ('[]'::jsonb, repeat('a', 64), repeat('b', 64));

DO $attempt_provenance_immutable$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE attempt_provenance_probe SET "argsDigest" = repeat('c', 64);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'resolved attempt provenance was mutable';
  END IF;
END
$attempt_provenance_immutable$;

CREATE TEMPORARY TABLE host_provenance_probe (
  "attemptId" TEXT,
  "resolvedInputProvenance" JSONB,
  "inputProvenanceSha256" CHAR(64),
  "argsDigest" TEXT NOT NULL,
  "taskId" TEXT,
  "stepId" TEXT
);
CREATE TRIGGER host_provenance_probe_immutable
BEFORE INSERT OR UPDATE ON host_provenance_probe
FOR EACH ROW
EXECUTE FUNCTION msaidizi_reject_host_input_provenance_rewrite();
INSERT INTO host_provenance_probe VALUES (
  NULL, '[]'::jsonb, repeat('a', 64), repeat('b', 64), NULL, NULL
);

DO $host_provenance_immutable$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE host_provenance_probe SET "inputProvenanceSha256" = repeat('c', 64);
  EXCEPTION WHEN object_not_in_prerequisite_state THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'resolved host-action provenance was mutable';
  END IF;
END
$host_provenance_immutable$;

ROLLBACK;

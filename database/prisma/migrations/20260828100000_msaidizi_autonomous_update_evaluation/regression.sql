-- Executable PostgreSQL regression for the generated-source binding pair and
-- immutable update-candidate evaluation inputs installed by this migration.
BEGIN;

DO $constraint_shape$
DECLARE
  definition TEXT;
BEGIN
  SELECT pg_get_constraintdef(oid)
  INTO definition
  FROM pg_constraint
  WHERE conname = 'msaidizi_update_candidates_generated_binding_check';

  IF definition IS NULL
    OR definition NOT LIKE '%"generationManifestSha256" IS NOT NULL%'
  THEN
    RAISE EXCEPTION 'generated-source binding permits SQL UNKNOWN';
  END IF;
END
$constraint_shape$;

CREATE TEMPORARY TABLE generated_candidate_probe (
  "generatedSourceArtifactId" TEXT,
  "generationManifestSha256" CHAR(64)
);
CREATE TRIGGER generated_candidate_probe_immutable
BEFORE UPDATE ON generated_candidate_probe
FOR EACH ROW
EXECUTE FUNCTION msaidizi_generated_update_candidate_bindings_immutable();
INSERT INTO generated_candidate_probe VALUES ('artifact-1', repeat('a', 64));

DO $generated_binding_immutable$
DECLARE
  blocked BOOLEAN := false;
BEGIN
  BEGIN
    UPDATE generated_candidate_probe
    SET "generationManifestSha256" = repeat('b', 64);
  EXCEPTION WHEN check_violation THEN
    blocked := true;
  END;
  IF NOT blocked THEN
    RAISE EXCEPTION 'generated update candidate binding was mutable';
  END IF;
END
$generated_binding_immutable$;

ROLLBACK;

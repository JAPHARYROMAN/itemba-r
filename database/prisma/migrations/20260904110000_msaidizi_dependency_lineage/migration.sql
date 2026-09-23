ALTER TABLE "msaidizi_task_steps"
  ADD COLUMN "dependencyLineage" JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE FUNCTION msaidizi_reject_dependency_lineage_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."dependencyLineage" IS DISTINCT FROM OLD."dependencyLineage" THEN
    RAISE EXCEPTION 'Msaidizi dependency lineage is immutable; replan into a new version'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "msaidizi_task_dependency_lineage_immutable"
BEFORE UPDATE OF "dependencyLineage" ON "msaidizi_task_steps"
FOR EACH ROW EXECUTE FUNCTION msaidizi_reject_dependency_lineage_rewrite();

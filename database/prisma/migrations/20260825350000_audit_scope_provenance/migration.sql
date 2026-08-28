-- Immutable audit scope provenance. The nullable audit_logs.companyId column
-- remains a compatibility/display FK, but it is no longer authoritative for
-- authorization because Company deletion can set it to NULL.
CREATE TYPE "AuditScopeKind" AS ENUM (
  'COMPANY',
  'MULTI_COMPANY',
  'GROUP',
  'GLOBAL',
  'UNATTRIBUTED'
);

CREATE TYPE "AuditAttributionStatus" AS ENUM (
  'EXPLICIT',
  'RESOLVED',
  'LEGACY',
  'FAILED'
);

ALTER TABLE "audit_logs"
  ADD COLUMN "scopeKind" "AuditScopeKind" NOT NULL DEFAULT 'UNATTRIBUTED',
  ADD COLUMN "attributionStatus" "AuditAttributionStatus" NOT NULL DEFAULT 'FAILED';

CREATE TABLE "audit_log_company_scopes" (
  "auditLogId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,

  CONSTRAINT "audit_log_company_scopes_pkey" PRIMARY KEY ("auditLogId", "companyId"),
  CONSTRAINT "audit_log_company_scopes_auditLogId_fkey"
    FOREIGN KEY ("auditLogId") REFERENCES "audit_logs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "audit_log_company_scopes_companyId_nonempty" CHECK (length("companyId") > 0)
);

-- Existing non-null company foreign keys become immutable legacy tenant
-- snapshots. Existing NULL rows are deliberately UNATTRIBUTED, never GLOBAL:
-- historical absence is not evidence that an action was intentionally global.
INSERT INTO "audit_log_company_scopes" ("auditLogId", "companyId")
SELECT "id", "companyId"
FROM "audit_logs"
WHERE "companyId" IS NOT NULL;

UPDATE "audit_logs"
SET
  "scopeKind" = CASE
    WHEN "companyId" IS NOT NULL THEN 'COMPANY'::"AuditScopeKind"
    ELSE 'UNATTRIBUTED'::"AuditScopeKind"
  END,
  "attributionStatus" = 'LEGACY'::"AuditAttributionStatus";

CREATE INDEX "audit_log_company_scopes_companyId_auditLogId_idx"
  ON "audit_log_company_scopes"("companyId", "auditLogId");

CREATE INDEX "audit_logs_scopeKind_createdAt_idx"
  ON "audit_logs"("scopeKind", "createdAt");

-- Database-enforced append-only history. The narrow nested-trigger exception
-- preserves the existing User/Company ON DELETE SET NULL compatibility FKs;
-- immutable scope authorization does not use either mutable FK.
CREATE FUNCTION "guard_audit_logs_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND pg_trigger_depth() > 1
     AND (NEW."companyId" IS NOT DISTINCT FROM OLD."companyId"
          OR (OLD."companyId" IS NOT NULL AND NEW."companyId" IS NULL))
     AND (NEW."userId" IS NOT DISTINCT FROM OLD."userId"
          OR (OLD."userId" IS NOT NULL AND NEW."userId" IS NULL))
     AND (to_jsonb(NEW) - ARRAY['companyId', 'userId'])
         = (to_jsonb(OLD) - ARRAY['companyId', 'userId']) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only; % is forbidden', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_logs_append_only_guard"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW
EXECUTE FUNCTION "guard_audit_logs_append_only"();

CREATE FUNCTION "guard_audit_log_company_scopes_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM "audit_logs" parent
    WHERE parent."id" = NEW."auditLogId"
      -- A scope may be attached only in the transaction that created its
      -- parent row. Later INSERTs would rewrite historical authorization even
      -- though they are technically append operations.
      AND parent.xmin::text::bigint = pg_current_xact_id()::text::bigint
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_log_company_scopes is append-only; % is forbidden', TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_log_company_scopes_append_only_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "audit_log_company_scopes"
FOR EACH ROW
EXECUTE FUNCTION "guard_audit_log_company_scopes_append_only"();

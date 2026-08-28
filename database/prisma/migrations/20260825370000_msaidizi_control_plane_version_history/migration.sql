-- Durable, append-only configuration history for unattended mandates and
-- routines. Existing rows become a migration baseline at their current
-- mandate version (or schedule version 1); future application mutations append
-- one complete snapshot in the same transaction as the live-row CAS update.

ALTER TABLE "msaidizi_schedules"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "msaidizi_mandate_versions" (
  "id" TEXT NOT NULL,
  "mandateId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "changeType" TEXT NOT NULL,
  "changedByUserId" TEXT,
  "principalId" TEXT NOT NULL,
  "companyId" TEXT,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "MsaidiziMandateStatus" NOT NULL,
  "capabilities" JSONB NOT NULL,
  "deviceIds" JSONB NOT NULL,
  "budgets" JSONB NOT NULL,
  "startsAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_mandate_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_schedule_versions" (
  "id" TEXT NOT NULL,
  "scheduleId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "changeType" TEXT NOT NULL,
  "changedByUserId" TEXT,
  "principalId" TEXT NOT NULL,
  "mandateId" TEXT NOT NULL,
  "companyId" TEXT,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "status" "MsaidiziScheduleStatus" NOT NULL,
  "cronExpression" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "taskTemplate" JSONB NOT NULL,
  "concurrencyMode" TEXT NOT NULL,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_schedule_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "msaidizi_mandate_versions_mandateId_version_key"
  ON "msaidizi_mandate_versions"("mandateId", "version");
CREATE INDEX "msaidizi_mandate_versions_mandateId_recordedAt_idx"
  ON "msaidizi_mandate_versions"("mandateId", "recordedAt");
CREATE UNIQUE INDEX "msaidizi_schedule_versions_scheduleId_version_key"
  ON "msaidizi_schedule_versions"("scheduleId", "version");
CREATE INDEX "msaidizi_schedule_versions_scheduleId_recordedAt_idx"
  ON "msaidizi_schedule_versions"("scheduleId", "recordedAt");

ALTER TABLE "msaidizi_mandate_versions"
  ADD CONSTRAINT "msaidizi_mandate_versions_mandateId_fkey"
  FOREIGN KEY ("mandateId") REFERENCES "msaidizi_mandates"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "msaidizi_schedule_versions"
  ADD CONSTRAINT "msaidizi_schedule_versions_scheduleId_fkey"
  FOREIGN KEY ("scheduleId") REFERENCES "msaidizi_schedules"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "msaidizi_mandate_versions" (
  "id", "mandateId", "version", "changeType", "changedByUserId",
  "principalId", "companyId", "createdByUserId", "name", "description",
  "status", "capabilities", "deviceIds", "budgets", "startsAt",
  "expiresAt", "activatedAt", "revokedAt", "sourceCreatedAt",
  "sourceUpdatedAt", "recordedAt"
)
SELECT
  gen_random_uuid()::text,
  mandate."id",
  mandate."version",
  'MIGRATION_BASELINE',
  NULL,
  mandate."principalId",
  mandate."companyId",
  mandate."createdByUserId",
  mandate."name",
  mandate."description",
  mandate."status",
  mandate."capabilities",
  mandate."deviceIds",
  mandate."budgets",
  mandate."startsAt",
  mandate."expiresAt",
  mandate."activatedAt",
  mandate."revokedAt",
  mandate."createdAt",
  mandate."updatedAt",
  CURRENT_TIMESTAMP
FROM "msaidizi_mandates" AS mandate;

INSERT INTO "msaidizi_schedule_versions" (
  "id", "scheduleId", "version", "changeType", "changedByUserId",
  "principalId", "mandateId", "companyId", "createdByUserId", "name",
  "status", "cronExpression", "timezone", "taskTemplate",
  "concurrencyMode", "nextRunAt", "lastRunAt", "sourceCreatedAt",
  "sourceUpdatedAt", "recordedAt"
)
SELECT
  gen_random_uuid()::text,
  schedule."id",
  schedule."version",
  'MIGRATION_BASELINE',
  NULL,
  schedule."principalId",
  schedule."mandateId",
  mandate."companyId",
  schedule."createdByUserId",
  schedule."name",
  schedule."status",
  schedule."cronExpression",
  schedule."timezone",
  schedule."taskTemplate",
  schedule."concurrencyMode",
  schedule."nextRunAt",
  schedule."lastRunAt",
  schedule."createdAt",
  schedule."updatedAt",
  CURRENT_TIMESTAMP
FROM "msaidizi_schedules" AS schedule
JOIN "msaidizi_mandates" AS mandate ON mandate."id" = schedule."mandateId";

CREATE FUNCTION "reject_msaidizi_control_plane_version_rewrite"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is forbidden', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE TRIGGER "msaidizi_mandate_versions_append_only_guard"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "msaidizi_mandate_versions"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_msaidizi_control_plane_version_rewrite"();

CREATE TRIGGER "msaidizi_schedule_versions_append_only_guard"
BEFORE UPDATE OR DELETE OR TRUNCATE ON "msaidizi_schedule_versions"
FOR EACH STATEMENT
EXECUTE FUNCTION "reject_msaidizi_control_plane_version_rewrite"();

-- Durable Msaidizi autonomy foundation. Additive and inert until the isolated
-- Nest module is wired and MSAIDIZI_AUTONOMY_ENABLED=true.

ALTER TYPE "BackgroundJobType" ADD VALUE IF NOT EXISTS 'MSAIDIZI_TASK_STEP';

CREATE TYPE "MsaidiziPrincipalStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "MsaidiziTaskMode" AS ENUM ('ASK', 'COLLABORATIVE', 'AUTOPILOT');
CREATE TYPE "MsaidiziTaskStatus" AS ENUM (
  'PLANNING', 'READY', 'QUEUED', 'RUNNING', 'PAUSING', 'PAUSED',
  'CANCELLING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED', 'NEEDS_ATTENTION'
);
CREATE TYPE "MsaidiziTaskStepStatus" AS ENUM (
  'PENDING', 'READY', 'LEASED', 'RUNNING', 'SUCCEEDED', 'FAILED',
  'CANCELLED', 'SKIPPED', 'NEEDS_ATTENTION'
);
CREATE TYPE "MsaidiziToolAttemptStatus" AS ENUM (
  'REQUESTED', 'REJECTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED'
);
CREATE TYPE "MsaidiziExecutionTarget" AS ENUM ('ERP', 'HOST');
CREATE TYPE "MsaidiziEffect" AS ENUM ('READ', 'WRITE', 'EXTERNAL', 'IRREVERSIBLE');
CREATE TYPE "MsaidiziMandateStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED');
CREATE TYPE "MsaidiziScheduleStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');
CREATE TYPE "MsaidiziArtifactKind" AS ENUM ('FILE', 'SCREENSHOT', 'REPORT', 'AUDIO', 'DOCUMENT', 'OTHER');
CREATE TYPE "MsaidiziMemoryKind" AS ENUM ('SEMANTIC', 'EPISODIC', 'PROCEDURAL');
CREATE TYPE "MsaidiziTrustLevel" AS ENUM ('TRUSTED', 'UNTRUSTED');
CREATE TYPE "MsaidiziDeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'OFFLINE', 'REVOKED', 'KILLED');
CREATE TYPE "MsaidiziDeviceLeaseStatus" AS ENUM ('ACTIVE', 'RELEASED', 'EXPIRED', 'REVOKED');
CREATE TYPE "MsaidiziHostActionStatus" AS ENUM (
  'QUEUED', 'DISPATCHED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN', 'CANCELLED'
);
CREATE TYPE "MsaidiziUpdateCandidateStatus" AS ENUM (
  'DRAFT', 'EVALUATING', 'REJECTED', 'APPROVED', 'CANARY', 'ACTIVE', 'ROLLED_BACK', 'FAILED'
);

ALTER TABLE "audit_logs"
  ADD COLUMN "principalType" TEXT,
  ADD COLUMN "principalId" TEXT,
  ADD COLUMN "mandateId" TEXT,
  ADD COLUMN "initiatedByUserId" TEXT,
  ADD COLUMN "taskId" TEXT,
  ADD COLUMN "stepId" TEXT,
  ADD COLUMN "deviceId" TEXT;

CREATE INDEX "audit_logs_principalId_createdAt_idx" ON "audit_logs"("principalId", "createdAt");
CREATE INDEX "audit_logs_taskId_createdAt_idx" ON "audit_logs"("taskId", "createdAt");
CREATE INDEX "audit_logs_deviceId_createdAt_idx" ON "audit_logs"("deviceId", "createdAt");

CREATE TABLE "msaidizi_principals" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" "MsaidiziPrincipalStatus" NOT NULL DEFAULT 'ACTIVE',
  "grants" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_principals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_mandates" (
  "id" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "companyId" TEXT,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" "MsaidiziMandateStatus" NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "capabilities" JSONB NOT NULL,
  "deviceIds" JSONB NOT NULL,
  "budgets" JSONB NOT NULL,
  "startsAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "activatedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_mandates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_schedules" (
  "id" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "mandateId" TEXT NOT NULL,
  "createdByUserId" TEXT,
  "name" TEXT NOT NULL,
  "status" "MsaidiziScheduleStatus" NOT NULL DEFAULT 'DRAFT',
  "cronExpression" TEXT NOT NULL,
  "timezone" TEXT NOT NULL,
  "taskTemplate" JSONB NOT NULL,
  "concurrencyMode" TEXT NOT NULL DEFAULT 'SKIP',
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_schedules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_tasks" (
  "id" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "initiatedByUserId" TEXT,
  "companyId" TEXT,
  "mandateId" TEXT,
  "scheduleId" TEXT,
  "idempotencyKey" TEXT,
  "mode" "MsaidiziTaskMode" NOT NULL,
  "title" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "status" "MsaidiziTaskStatus" NOT NULL DEFAULT 'PLANNING',
  "activePlanVersion" INTEGER NOT NULL DEFAULT 0,
  "stateVersion" INTEGER NOT NULL DEFAULT 0,
  "hostExecutionAllowed" BOOLEAN NOT NULL DEFAULT false,
  "maxWallTimeSeconds" INTEGER NOT NULL DEFAULT 7200,
  "maxModelTurns" INTEGER NOT NULL DEFAULT 200,
  "maxAttemptedToolCalls" INTEGER NOT NULL DEFAULT 500,
  "maxMutations" INTEGER NOT NULL DEFAULT 100,
  "maxLocalBytes" BIGINT NOT NULL DEFAULT 5368709120,
  "maxExternalEgressBytes" BIGINT NOT NULL DEFAULT 262144000,
  "maxModelCostUsd" DECIMAL(12,4) NOT NULL DEFAULT 20.0,
  "modelTurns" INTEGER NOT NULL DEFAULT 0,
  "attemptedToolCalls" INTEGER NOT NULL DEFAULT 0,
  "executedToolCalls" INTEGER NOT NULL DEFAULT 0,
  "mutations" INTEGER NOT NULL DEFAULT 0,
  "inputTokens" BIGINT NOT NULL DEFAULT 0,
  "outputTokens" BIGINT NOT NULL DEFAULT 0,
  "modelCostUsd" DECIMAL(12,4) NOT NULL DEFAULT 0,
  "bytesRead" BIGINT NOT NULL DEFAULT 0,
  "bytesWritten" BIGINT NOT NULL DEFAULT 0,
  "externalEgressBytes" BIGINT NOT NULL DEFAULT 0,
  "statusDetail" TEXT,
  "failureCode" TEXT,
  "queuedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "lastCheckpointAt" TIMESTAMP(3),
  "pauseRequestedAt" TIMESTAMP(3),
  "cancelRequestedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_tasks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_tasks_budget_check" CHECK (
    "maxWallTimeSeconds" > 0 AND "maxModelTurns" > 0 AND
    "maxAttemptedToolCalls" > 0 AND "maxMutations" >= 0 AND
    "maxLocalBytes" > 0 AND "maxExternalEgressBytes" >= 0 AND "maxModelCostUsd" >= 0
  ),
  CONSTRAINT "msaidizi_tasks_counter_check" CHECK (
    "modelTurns" >= 0 AND "attemptedToolCalls" >= 0 AND
    "executedToolCalls" >= 0 AND "mutations" >= 0 AND
    "inputTokens" >= 0 AND "outputTokens" >= 0 AND "modelCostUsd" >= 0 AND
    "bytesRead" >= 0 AND "bytesWritten" >= 0 AND "externalEgressBytes" >= 0
  )
);

CREATE TABLE "msaidizi_plan_versions" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "createdByUserId" TEXT,
  "summary" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "inputs" JSONB NOT NULL,
  "stopConditions" JSONB NOT NULL,
  "budgetSnapshot" JSONB NOT NULL,
  "planDigest" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_plan_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_task_steps" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "planVersionId" TEXT NOT NULL,
  "stepKey" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "target" "MsaidiziExecutionTarget" NOT NULL DEFAULT 'ERP',
  "capability" TEXT NOT NULL,
  "capabilityVersion" TEXT NOT NULL DEFAULT '1',
  "arguments" JSONB NOT NULL,
  "dependencies" JSONB NOT NULL,
  "expectedEffect" "MsaidiziEffect" NOT NULL,
  "dataClass" TEXT NOT NULL,
  "preconditions" JSONB NOT NULL,
  "recovery" JSONB,
  "budgets" JSONB NOT NULL,
  "stopConditions" JSONB NOT NULL,
  "idempotent" BOOLEAN NOT NULL DEFAULT false,
  "mutation" BOOLEAN NOT NULL DEFAULT false,
  "status" "MsaidiziTaskStepStatus" NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "checkpointedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_task_steps_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_task_steps_sequence_check" CHECK ("sequence" > 0 AND "attemptCount" >= 0)
);

CREATE TABLE "msaidizi_tool_attempts" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "toolName" TEXT NOT NULL,
  "argumentsRedacted" JSONB NOT NULL,
  "argsDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "credentialJtiDigest" TEXT,
  "credentialConsumedAt" TIMESTAMP(3),
  "status" "MsaidiziToolAttemptStatus" NOT NULL DEFAULT 'REQUESTED',
  "rejectionReason" TEXT,
  "resultSummary" JSONB,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "uncertainOutcome" BOOLEAN NOT NULL DEFAULT false,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_tool_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_tool_attempts_number_check" CHECK ("attemptNumber" > 0)
);

CREATE TABLE "msaidizi_task_events" (
  "cursor" BIGSERIAL NOT NULL,
  "taskId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "actorType" TEXT NOT NULL,
  "actorId" TEXT,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_task_events_pkey" PRIMARY KEY ("cursor")
);

CREATE TABLE "msaidizi_artifacts" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "stepId" TEXT,
  "kind" "MsaidiziArtifactKind" NOT NULL,
  "name" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "sha256" TEXT NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "encrypted" BOOLEAN NOT NULL DEFAULT true,
  "dataClass" TEXT NOT NULL,
  "trustLevel" "MsaidiziTrustLevel" NOT NULL DEFAULT 'UNTRUSTED',
  "provenance" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "msaidizi_artifacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_artifacts_size_check" CHECK ("byteSize" >= 0)
);

CREATE TABLE "msaidizi_memories" (
  "id" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "companyId" TEXT,
  "sourceTaskId" TEXT,
  "createdByUserId" TEXT,
  "kind" "MsaidiziMemoryKind" NOT NULL,
  "scopeKey" TEXT NOT NULL,
  "contentCiphertext" TEXT NOT NULL,
  "contentDigest" TEXT NOT NULL,
  "metadata" JSONB NOT NULL,
  "trustLevel" "MsaidiziTrustLevel" NOT NULL DEFAULT 'UNTRUSTED',
  "sourceProvenance" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_memories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_devices" (
  "id" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" "MsaidiziDeviceStatus" NOT NULL DEFAULT 'PENDING',
  "platform" TEXT NOT NULL DEFAULT 'windows',
  "osVersion" TEXT,
  "architecture" TEXT,
  "publicKey" TEXT NOT NULL,
  "certificateThumbprint" TEXT,
  "capabilityManifest" JSONB NOT NULL,
  "pairedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "killedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_devices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_device_leases" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "stepId" TEXT,
  "deviceId" TEXT NOT NULL,
  "status" "MsaidiziDeviceLeaseStatus" NOT NULL DEFAULT 'ACTIVE',
  "leaseTokenDigest" TEXT NOT NULL,
  "fencingToken" BIGSERIAL NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "releasedAt" TIMESTAMP(3),
  CONSTRAINT "msaidizi_device_leases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_host_actions" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "stepId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "leaseId" TEXT,
  "actionId" TEXT NOT NULL,
  "capability" TEXT NOT NULL,
  "capabilityVersion" TEXT NOT NULL,
  "argumentsRedacted" JSONB NOT NULL,
  "argsDigest" TEXT NOT NULL,
  "actionTokenDigest" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "expectedPreState" JSONB NOT NULL,
  "budgetSnapshot" JSONB NOT NULL,
  "dataClass" TEXT NOT NULL,
  "effect" "MsaidiziEffect" NOT NULL,
  "consent" TEXT NOT NULL,
  "recovery" TEXT NOT NULL,
  "status" "MsaidiziHostActionStatus" NOT NULL DEFAULT 'QUEUED',
  "uncertainOutcome" BOOLEAN NOT NULL DEFAULT false,
  "journalPrepareSequence" INTEGER,
  "journalPreparePreviousHash" TEXT,
  "journalPrepareHash" TEXT,
  "journalSequence" INTEGER,
  "journalPreviousHash" TEXT,
  "journalHash" TEXT,
  "resultSummary" JSONB,
  "errorCode" TEXT,
  "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dispatchedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "msaidizi_host_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "msaidizi_update_candidates" (
  "id" TEXT NOT NULL,
  "principalId" TEXT NOT NULL,
  "proposedByTaskId" TEXT,
  "sourceArtifactId" TEXT,
  "rollbackArtifactId" TEXT,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "status" "MsaidiziUpdateCandidateStatus" NOT NULL DEFAULT 'DRAFT',
  "evaluationSummary" JSONB NOT NULL,
  "reviewerDecisions" JSONB NOT NULL,
  "rolloutRing" INTEGER NOT NULL DEFAULT 0,
  "healthSummary" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deployedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  CONSTRAINT "msaidizi_update_candidates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "msaidizi_update_candidates_ring_check" CHECK ("rolloutRing" >= 0)
);

CREATE UNIQUE INDEX "msaidizi_principals_key_key" ON "msaidizi_principals"("key");
CREATE INDEX "msaidizi_principals_status_idx" ON "msaidizi_principals"("status");
CREATE INDEX "msaidizi_mandates_principalId_status_idx" ON "msaidizi_mandates"("principalId", "status");
CREATE INDEX "msaidizi_mandates_companyId_status_idx" ON "msaidizi_mandates"("companyId", "status");
CREATE INDEX "msaidizi_schedules_principalId_status_nextRunAt_idx" ON "msaidizi_schedules"("principalId", "status", "nextRunAt");
CREATE INDEX "msaidizi_schedules_mandateId_status_idx" ON "msaidizi_schedules"("mandateId", "status");
CREATE UNIQUE INDEX "msaidizi_tasks_idempotencyKey_key" ON "msaidizi_tasks"("idempotencyKey");
CREATE INDEX "msaidizi_tasks_initiatedByUserId_createdAt_idx" ON "msaidizi_tasks"("initiatedByUserId", "createdAt");
CREATE INDEX "msaidizi_tasks_companyId_status_createdAt_idx" ON "msaidizi_tasks"("companyId", "status", "createdAt");
CREATE INDEX "msaidizi_tasks_principalId_status_createdAt_idx" ON "msaidizi_tasks"("principalId", "status", "createdAt");
CREATE INDEX "msaidizi_tasks_status_queuedAt_idx" ON "msaidizi_tasks"("status", "queuedAt");
CREATE UNIQUE INDEX "msaidizi_plan_versions_taskId_version_key" ON "msaidizi_plan_versions"("taskId", "version");
CREATE INDEX "msaidizi_plan_versions_taskId_createdAt_idx" ON "msaidizi_plan_versions"("taskId", "createdAt");
CREATE UNIQUE INDEX "msaidizi_task_steps_planVersionId_stepKey_key" ON "msaidizi_task_steps"("planVersionId", "stepKey");
CREATE UNIQUE INDEX "msaidizi_task_steps_planVersionId_sequence_key" ON "msaidizi_task_steps"("planVersionId", "sequence");
CREATE INDEX "msaidizi_task_steps_taskId_status_sequence_idx" ON "msaidizi_task_steps"("taskId", "status", "sequence");
CREATE UNIQUE INDEX "msaidizi_tool_attempts_idempotencyKey_key" ON "msaidizi_tool_attempts"("idempotencyKey");
CREATE UNIQUE INDEX "msaidizi_tool_attempts_credentialJtiDigest_key" ON "msaidizi_tool_attempts"("credentialJtiDigest");
CREATE UNIQUE INDEX "msaidizi_tool_attempts_stepId_attemptNumber_key" ON "msaidizi_tool_attempts"("stepId", "attemptNumber");
CREATE INDEX "msaidizi_tool_attempts_taskId_createdAt_idx" ON "msaidizi_tool_attempts"("taskId", "createdAt");
CREATE INDEX "msaidizi_tool_attempts_status_createdAt_idx" ON "msaidizi_tool_attempts"("status", "createdAt");
CREATE INDEX "msaidizi_task_events_taskId_cursor_idx" ON "msaidizi_task_events"("taskId", "cursor");
CREATE UNIQUE INDEX "msaidizi_artifacts_storageKey_key" ON "msaidizi_artifacts"("storageKey");
CREATE INDEX "msaidizi_artifacts_taskId_createdAt_idx" ON "msaidizi_artifacts"("taskId", "createdAt");
CREATE INDEX "msaidizi_artifacts_stepId_createdAt_idx" ON "msaidizi_artifacts"("stepId", "createdAt");
CREATE INDEX "msaidizi_memories_principalId_kind_scopeKey_idx" ON "msaidizi_memories"("principalId", "kind", "scopeKey");
CREATE INDEX "msaidizi_memories_companyId_kind_deletedAt_idx" ON "msaidizi_memories"("companyId", "kind", "deletedAt");
CREATE INDEX "msaidizi_memories_expiresAt_idx" ON "msaidizi_memories"("expiresAt");
CREATE UNIQUE INDEX "msaidizi_devices_certificateThumbprint_key" ON "msaidizi_devices"("certificateThumbprint");
CREATE INDEX "msaidizi_devices_principalId_status_idx" ON "msaidizi_devices"("principalId", "status");
CREATE INDEX "msaidizi_devices_status_lastSeenAt_idx" ON "msaidizi_devices"("status", "lastSeenAt");
CREATE UNIQUE INDEX "msaidizi_device_leases_leaseTokenDigest_key" ON "msaidizi_device_leases"("leaseTokenDigest");
CREATE UNIQUE INDEX "msaidizi_device_leases_fencingToken_key" ON "msaidizi_device_leases"("fencingToken");
CREATE INDEX "msaidizi_device_leases_deviceId_status_expiresAt_idx" ON "msaidizi_device_leases"("deviceId", "status", "expiresAt");
CREATE INDEX "msaidizi_device_leases_taskId_status_idx" ON "msaidizi_device_leases"("taskId", "status");
CREATE UNIQUE INDEX "msaidizi_device_leases_one_active_per_device" ON "msaidizi_device_leases"("deviceId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "msaidizi_host_actions_actionId_key" ON "msaidizi_host_actions"("actionId");
CREATE UNIQUE INDEX "msaidizi_host_actions_idempotencyKey_key" ON "msaidizi_host_actions"("idempotencyKey");
CREATE INDEX "msaidizi_host_actions_taskId_status_createdAt_idx" ON "msaidizi_host_actions"("taskId", "status", "createdAt");
CREATE INDEX "msaidizi_host_actions_deviceId_status_createdAt_idx" ON "msaidizi_host_actions"("deviceId", "status", "createdAt");
CREATE INDEX "msaidizi_host_actions_leaseId_idx" ON "msaidizi_host_actions"("leaseId");
CREATE UNIQUE INDEX "msaidizi_update_candidates_name_version_key" ON "msaidizi_update_candidates"("name", "version");
CREATE INDEX "msaidizi_update_candidates_principalId_status_createdAt_idx" ON "msaidizi_update_candidates"("principalId", "status", "createdAt");
CREATE INDEX "msaidizi_update_candidates_proposedByTaskId_idx" ON "msaidizi_update_candidates"("proposedByTaskId");

ALTER TABLE "msaidizi_principals"
  ADD CONSTRAINT "msaidizi_principals_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_mandates"
  ADD CONSTRAINT "msaidizi_mandates_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "msaidizi_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_mandates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_mandates_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_schedules"
  ADD CONSTRAINT "msaidizi_schedules_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "msaidizi_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_schedules_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "msaidizi_mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_schedules_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_tasks"
  ADD CONSTRAINT "msaidizi_tasks_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "msaidizi_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_tasks_initiatedByUserId_fkey" FOREIGN KEY ("initiatedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_tasks_mandateId_fkey" FOREIGN KEY ("mandateId") REFERENCES "msaidizi_mandates"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_tasks_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "msaidizi_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_plan_versions"
  ADD CONSTRAINT "msaidizi_plan_versions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_plan_versions_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_task_steps"
  ADD CONSTRAINT "msaidizi_task_steps_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_task_steps_planVersionId_fkey" FOREIGN KEY ("planVersionId") REFERENCES "msaidizi_plan_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "msaidizi_tool_attempts"
  ADD CONSTRAINT "msaidizi_tool_attempts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_tool_attempts_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "msaidizi_task_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "msaidizi_task_events"
  ADD CONSTRAINT "msaidizi_task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "msaidizi_artifacts"
  ADD CONSTRAINT "msaidizi_artifacts_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_artifacts_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "msaidizi_task_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_memories"
  ADD CONSTRAINT "msaidizi_memories_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "msaidizi_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_memories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_memories_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "msaidizi_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_memories_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_devices"
  ADD CONSTRAINT "msaidizi_devices_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "msaidizi_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_device_leases"
  ADD CONSTRAINT "msaidizi_device_leases_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_device_leases_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "msaidizi_task_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_device_leases_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "msaidizi_host_actions"
  ADD CONSTRAINT "msaidizi_host_actions_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "msaidizi_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_host_actions_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "msaidizi_task_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_host_actions_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "msaidizi_devices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_host_actions_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "msaidizi_device_leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "msaidizi_update_candidates"
  ADD CONSTRAINT "msaidizi_update_candidates_principalId_fkey" FOREIGN KEY ("principalId") REFERENCES "msaidizi_principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_update_candidates_proposedByTaskId_fkey" FOREIGN KEY ("proposedByTaskId") REFERENCES "msaidizi_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_update_candidates_sourceArtifactId_fkey" FOREIGN KEY ("sourceArtifactId") REFERENCES "msaidizi_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "msaidizi_update_candidates_rollbackArtifactId_fkey" FOREIGN KEY ("rollbackArtifactId") REFERENCES "msaidizi_artifacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

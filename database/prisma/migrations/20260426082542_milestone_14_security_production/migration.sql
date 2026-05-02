-- CreateEnum
CREATE TYPE "SecurityPolicyType" AS ENUM ('PASSWORD', 'SESSION', 'TWO_FACTOR', 'LOGIN_ATTEMPT', 'API_SECURITY', 'DATA_ACCESS', 'EXPORT_SECURITY', 'DEVICE_SECURITY', 'GENERAL');

-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('NONE', 'TOTP', 'SMS', 'EMAIL', 'BACKUP_CODE');

-- CreateEnum
CREATE TYPE "SecurityRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'TWO_FACTOR_ENABLED', 'TWO_FACTOR_DISABLED', 'TWO_FACTOR_CHALLENGE', 'TWO_FACTOR_SUCCESS', 'TWO_FACTOR_FAILED', 'SESSION_REVOKED', 'API_KEY_CREATED', 'API_KEY_REVOKED', 'SENSITIVE_DATA_VIEWED', 'SENSITIVE_EXPORT_REQUESTED', 'PERMISSION_DENIED', 'SUSPICIOUS_ACTIVITY', 'DEVICE_BLOCKED', 'DEVICE_REVOKED', 'SECURITY_POLICY_CHANGED', 'OTHER');

-- CreateEnum
CREATE TYPE "SecurityEventSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SecurityEventStatus" AS ENUM ('OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ActiveSessionType" AS ENUM ('WEB', 'MOBILE', 'API', 'POS', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ActiveSessionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REVOKED', 'LOGGED_OUT');

-- CreateEnum
CREATE TYPE "BackupType" AS ENUM ('DATABASE', 'FILE_STORAGE', 'DOCUMENTS', 'FULL_SYSTEM', 'CONFIGURATION', 'AUDIT_LOGS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BackupSchedule" AS ENUM ('MANUAL', 'HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BackupStorageTarget" AS ENUM ('LOCAL', 'S3_COMPATIBLE', 'CLOUD_STORAGE', 'EXTERNAL_DRIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BackupJobStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "BackupRunStatus" AS ENUM ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RestoreTestType" AS ENUM ('METADATA_CHECK', 'CHECKSUM_VERIFY', 'TEST_RESTORE', 'FULL_RESTORE_DRILL', 'PARTIAL_RESTORE');

-- CreateEnum
CREATE TYPE "RestoreTestStatus" AS ENUM ('PLANNED', 'RUNNING', 'PASSED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DisasterRecoveryPlanStatus" AS ENUM ('DRAFT', 'ACTIVE', 'UNDER_REVIEW', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HealthCheckType" AS ENUM ('DATABASE', 'API', 'STORAGE', 'QUEUE', 'CACHE', 'AUTH', 'EMAIL', 'SMS', 'INTEGRATION', 'BACKUP', 'DISK', 'MEMORY', 'CPU', 'CUSTOM');

-- CreateEnum
CREATE TYPE "HealthCheckStatus" AS ENUM ('HEALTHY', 'WARNING', 'CRITICAL', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "SystemMetricType" AS ENUM ('API_RESPONSE_TIME', 'ERROR_RATE', 'DB_QUERY_TIME', 'ACTIVE_USERS', 'ACTIVE_SESSIONS', 'STORAGE_USAGE', 'BACKUP_SIZE', 'JOB_DURATION', 'INTEGRATION_FAILURE_RATE', 'SYNC_CONFLICT_RATE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ErrorLogType" AS ENUM ('SERVER_ERROR', 'VALIDATION_ERROR', 'DATABASE_ERROR', 'INTEGRATION_ERROR', 'AUTH_ERROR', 'PERMISSION_ERROR', 'CLIENT_ERROR', 'BACKGROUND_JOB_ERROR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ErrorLogSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "ErrorLogStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "RetentionDataCategory" AS ENUM ('AUDIT_LOGS', 'SECURITY_EVENTS', 'API_LOGS', 'INTEGRATION_EVENTS', 'NOTIFICATIONS', 'BACKUPS', 'DOCUMENTS', 'FINANCIAL_RECORDS', 'HR_RECORDS', 'PAYROLL_RECORDS', 'TAX_RECORDS', 'OPERATIONAL_RECORDS', 'ERROR_LOGS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "RetentionPolicyStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DRAFT');

-- CreateEnum
CREATE TYPE "DataArchiveJobStatus" AS ENUM ('DRAFT', 'REQUESTED', 'APPROVED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ProductionReadinessCategory" AS ENUM ('SECURITY', 'BACKUP', 'DATABASE', 'ENVIRONMENT', 'MONITORING', 'PERFORMANCE', 'INTEGRATIONS', 'DOCUMENTATION', 'COMPLIANCE', 'DEPLOYMENT', 'USER_MANAGEMENT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ProductionReadinessStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'WAIVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "ProductionReadinessPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "EnvironmentConfigCategory" AS ENUM ('DATABASE', 'AUTH', 'SECURITY', 'STORAGE', 'EMAIL', 'SMS', 'INTEGRATION', 'BACKUP', 'APP', 'API', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EnvironmentConfigStatus" AS ENUM ('PASS', 'WARNING', 'FAIL', 'UNKNOWN');

-- CreateTable
CREATE TABLE "security_policies" (
    "id" TEXT NOT NULL,
    "policyCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "policyType" "SecurityPolicyType" NOT NULL,
    "settings" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "security_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_security_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3),
    "passwordExpiresAt" TIMESTAMP(3),
    "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lastLoginIp" TEXT,
    "lastLoginUserAgent" TEXT,
    "lastFailedLoginAt" TIMESTAMP(3),
    "lastFailedLoginIp" TEXT,
    "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "twoFactorMethod" "TwoFactorMethod" NOT NULL DEFAULT 'NONE',
    "twoFactorSecretEncrypted" TEXT,
    "backupCodesHash" JSONB,
    "forcePasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "forceTwoFactorSetup" BOOLEAN NOT NULL DEFAULT false,
    "securityRiskLevel" "SecurityRiskLevel" NOT NULL DEFAULT 'LOW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_security_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "eventNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "apiClientId" TEXT,
    "deviceId" TEXT,
    "eventType" "SecurityEventType" NOT NULL DEFAULT 'OTHER',
    "severity" "SecurityEventSeverity" NOT NULL DEFAULT 'LOW',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "locationSummary" TEXT,
    "description" TEXT,
    "metadata" JSONB,
    "status" "SecurityEventStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "active_sessions" (
    "id" TEXT NOT NULL,
    "sessionCode" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "deviceId" TEXT,
    "sessionType" "ActiveSessionType" NOT NULL DEFAULT 'WEB',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "status" "ActiveSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "active_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_jobs" (
    "id" TEXT NOT NULL,
    "backupJobCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "backupType" "BackupType" NOT NULL,
    "schedule" "BackupSchedule" NOT NULL DEFAULT 'MANUAL',
    "scheduleConfig" JSONB,
    "storageTarget" "BackupStorageTarget" NOT NULL DEFAULT 'LOCAL',
    "storageConfigEncrypted" JSONB,
    "retentionDays" INTEGER,
    "status" "BackupJobStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "backup_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_runs" (
    "id" TEXT NOT NULL,
    "backupRunNumber" TEXT NOT NULL,
    "backupJobId" TEXT,
    "backupType" "BackupType" NOT NULL,
    "status" "BackupRunStatus" NOT NULL DEFAULT 'REQUESTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "filePath" TEXT,
    "fileSizeBytes" BIGINT,
    "checksum" TEXT,
    "errorMessage" TEXT,
    "triggeredById" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restore_tests" (
    "id" TEXT NOT NULL,
    "restoreTestNumber" TEXT NOT NULL,
    "backupRunId" TEXT,
    "testDate" TIMESTAMP(3) NOT NULL,
    "testType" "RestoreTestType" NOT NULL,
    "status" "RestoreTestStatus" NOT NULL DEFAULT 'PLANNED',
    "testedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultSummary" TEXT,
    "issuesFound" TEXT,
    "correctiveActions" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "restore_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disaster_recovery_plans" (
    "id" TEXT NOT NULL,
    "drPlanCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "recoveryPointObjectiveMinutes" INTEGER,
    "recoveryTimeObjectiveMinutes" INTEGER,
    "criticalSystems" JSONB,
    "backupStrategy" TEXT,
    "recoverySteps" TEXT,
    "responsibleUsers" JSONB,
    "emergencyContacts" JSONB,
    "status" "DisasterRecoveryPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "disaster_recovery_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_health_checks" (
    "id" TEXT NOT NULL,
    "healthCheckCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "checkType" "HealthCheckType" NOT NULL,
    "endpointOrTarget" TEXT,
    "status" "HealthCheckStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastCheckedAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastMessage" TEXT,
    "responseTimeMs" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "system_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_metrics" (
    "id" TEXT NOT NULL,
    "metricCode" TEXT NOT NULL,
    "metricType" "SystemMetricType" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "unit" TEXT,
    "companyId" TEXT,
    "metadata" JSONB,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "errorNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "module" TEXT,
    "errorType" "ErrorLogType" NOT NULL DEFAULT 'UNKNOWN',
    "message" TEXT NOT NULL,
    "stackTrace" TEXT,
    "requestPath" TEXT,
    "requestMethod" TEXT,
    "statusCode" INTEGER,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "correlationId" TEXT,
    "severity" "ErrorLogSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "ErrorLogStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "retentionPolicyCode" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "dataCategory" "RetentionDataCategory" NOT NULL,
    "retentionDays" INTEGER,
    "archiveAfterDays" INTEGER,
    "deletionAllowed" BOOLEAN NOT NULL DEFAULT false,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "status" "RetentionPolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_archive_jobs" (
    "id" TEXT NOT NULL,
    "archiveJobNumber" TEXT NOT NULL,
    "retentionPolicyId" TEXT,
    "companyId" TEXT,
    "dataCategory" "RetentionDataCategory" NOT NULL,
    "status" "DataArchiveJobStatus" NOT NULL DEFAULT 'DRAFT',
    "recordsEvaluated" INTEGER NOT NULL DEFAULT 0,
    "recordsArchived" INTEGER NOT NULL DEFAULT 0,
    "recordsDeleted" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "data_archive_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_readiness_checks" (
    "id" TEXT NOT NULL,
    "checkCode" TEXT NOT NULL,
    "category" "ProductionReadinessCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductionReadinessStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "priority" "ProductionReadinessPriority" NOT NULL DEFAULT 'MEDIUM',
    "responsibleUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "evidenceDocumentId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "production_readiness_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "environment_config_checks" (
    "id" TEXT NOT NULL,
    "configKey" TEXT NOT NULL,
    "category" "EnvironmentConfigCategory" NOT NULL,
    "description" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "present" BOOLEAN NOT NULL DEFAULT false,
    "valid" BOOLEAN NOT NULL DEFAULT false,
    "valueMasked" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "status" "EnvironmentConfigStatus" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "environment_config_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "security_policies_policyCode_key" ON "security_policies"("policyCode");

-- CreateIndex
CREATE INDEX "security_policies_companyId_policyType_isActive_idx" ON "security_policies"("companyId", "policyType", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "user_security_profiles_userId_key" ON "user_security_profiles"("userId");

-- CreateIndex
CREATE INDEX "user_security_profiles_userId_twoFactorEnabled_securityRisk_idx" ON "user_security_profiles"("userId", "twoFactorEnabled", "securityRiskLevel");

-- CreateIndex
CREATE INDEX "password_history_userId_createdAt_idx" ON "password_history"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "security_events_eventNumber_key" ON "security_events"("eventNumber");

-- CreateIndex
CREATE INDEX "security_events_companyId_userId_eventType_severity_status__idx" ON "security_events"("companyId", "userId", "eventType", "severity", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "active_sessions_sessionCode_key" ON "active_sessions"("sessionCode");

-- CreateIndex
CREATE INDEX "active_sessions_userId_status_sessionType_expiresAt_idx" ON "active_sessions"("userId", "status", "sessionType", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "backup_jobs_backupJobCode_key" ON "backup_jobs"("backupJobCode");

-- CreateIndex
CREATE INDEX "backup_jobs_backupType_status_schedule_idx" ON "backup_jobs"("backupType", "status", "schedule");

-- CreateIndex
CREATE UNIQUE INDEX "backup_runs_backupRunNumber_key" ON "backup_runs"("backupRunNumber");

-- CreateIndex
CREATE INDEX "backup_runs_backupJobId_status_backupType_createdAt_idx" ON "backup_runs"("backupJobId", "status", "backupType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "restore_tests_restoreTestNumber_key" ON "restore_tests"("restoreTestNumber");

-- CreateIndex
CREATE INDEX "restore_tests_backupRunId_status_testDate_idx" ON "restore_tests"("backupRunId", "status", "testDate");

-- CreateIndex
CREATE UNIQUE INDEX "disaster_recovery_plans_drPlanCode_key" ON "disaster_recovery_plans"("drPlanCode");

-- CreateIndex
CREATE INDEX "disaster_recovery_plans_companyId_status_idx" ON "disaster_recovery_plans"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "system_health_checks_healthCheckCode_key" ON "system_health_checks"("healthCheckCode");

-- CreateIndex
CREATE INDEX "system_health_checks_checkType_status_isActive_idx" ON "system_health_checks"("checkType", "status", "isActive");

-- CreateIndex
CREATE INDEX "system_metrics_metricType_companyId_recordedAt_idx" ON "system_metrics"("metricType", "companyId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "error_logs_errorNumber_key" ON "error_logs"("errorNumber");

-- CreateIndex
CREATE INDEX "error_logs_companyId_errorType_severity_status_createdAt_idx" ON "error_logs"("companyId", "errorType", "severity", "status", "createdAt");

-- CreateIndex
CREATE INDEX "error_logs_module_errorType_createdAt_idx" ON "error_logs"("module", "errorType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policies_retentionPolicyCode_key" ON "retention_policies"("retentionPolicyCode");

-- CreateIndex
CREATE INDEX "retention_policies_companyId_dataCategory_status_idx" ON "retention_policies"("companyId", "dataCategory", "status");

-- CreateIndex
CREATE UNIQUE INDEX "data_archive_jobs_archiveJobNumber_key" ON "data_archive_jobs"("archiveJobNumber");

-- CreateIndex
CREATE INDEX "data_archive_jobs_companyId_dataCategory_status_createdAt_idx" ON "data_archive_jobs"("companyId", "dataCategory", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "production_readiness_checks_checkCode_key" ON "production_readiness_checks"("checkCode");

-- CreateIndex
CREATE INDEX "production_readiness_checks_category_status_priority_idx" ON "production_readiness_checks"("category", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "environment_config_checks_configKey_key" ON "environment_config_checks"("configKey");

-- CreateIndex
CREATE INDEX "environment_config_checks_category_status_required_idx" ON "environment_config_checks"("category", "status", "required");

-- AddForeignKey
ALTER TABLE "security_policies" ADD CONSTRAINT "security_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_policies" ADD CONSTRAINT "security_policies_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_policies" ADD CONSTRAINT "security_policies_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_security_profiles" ADD CONSTRAINT "user_security_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_history" ADD CONSTRAINT "password_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_sessions" ADD CONSTRAINT "active_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "active_sessions" ADD CONSTRAINT "active_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_jobs" ADD CONSTRAINT "backup_jobs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_backupJobId_fkey" FOREIGN KEY ("backupJobId") REFERENCES "backup_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "backup_runs" ADD CONSTRAINT "backup_runs_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_tests" ADD CONSTRAINT "restore_tests_backupRunId_fkey" FOREIGN KEY ("backupRunId") REFERENCES "backup_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restore_tests" ADD CONSTRAINT "restore_tests_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disaster_recovery_plans" ADD CONSTRAINT "disaster_recovery_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disaster_recovery_plans" ADD CONSTRAINT "disaster_recovery_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disaster_recovery_plans" ADD CONSTRAINT "disaster_recovery_plans_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "system_metrics" ADD CONSTRAINT "system_metrics_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_archive_jobs" ADD CONSTRAINT "data_archive_jobs_retentionPolicyId_fkey" FOREIGN KEY ("retentionPolicyId") REFERENCES "retention_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_archive_jobs" ADD CONSTRAINT "data_archive_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_archive_jobs" ADD CONSTRAINT "data_archive_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_archive_jobs" ADD CONSTRAINT "data_archive_jobs_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_readiness_checks" ADD CONSTRAINT "production_readiness_checks_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_readiness_checks" ADD CONSTRAINT "production_readiness_checks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "BackgroundJobType" AS ENUM ('REPORT_GENERATION', 'DATA_EXPORT', 'NOTIFICATION_DISPATCH', 'ALERT_EVALUATION', 'AUTOMATION_RUN', 'BI_SNAPSHOT', 'DATA_QUALITY_CHECK', 'INTEGRATION_RETRY', 'WEBHOOK_PROCESSING', 'OFFLINE_SYNC_PROCESSING', 'BACKUP_RUN', 'EMAIL_SEND', 'SMS_SEND', 'CUSTOM');

-- CreateEnum
CREATE TYPE "BackgroundJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "BackgroundJobPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CacheEntryType" AS ENUM ('DASHBOARD', 'REPORT', 'KPI', 'LOOKUP', 'PERMISSION', 'SETTINGS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PerformanceTraceType" AS ENUM ('API_REQUEST', 'DB_QUERY', 'REPORT_RUN', 'BACKGROUND_JOB', 'PAGE_LOAD', 'EXPORT', 'SYNC_OPERATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PerformanceTraceStatus" AS ENUM ('SUCCESS', 'WARNING', 'FAILED');

-- CreateEnum
CREATE TYPE "DataIsolationRunType" AS ENUM ('COMPANY_SCOPE', 'DIVISION_SCOPE', 'BRANCH_SCOPE', 'BUSINESS_UNIT_SCOPE', 'PERMISSION_SCOPE', 'GROUP_CONTROL_SCOPE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "DataIsolationRunStatus" AS ENUM ('PASSED', 'FAILED', 'PARTIAL', 'RUNNING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DataIsolationIssueType" AS ENUM ('CROSS_COMPANY_LEAK', 'MISSING_COMPANY_FILTER', 'PERMISSION_BYPASS', 'GROUP_CONTROL_BYPASS', 'SENSITIVE_DATA_EXPOSURE', 'BRANCH_SCOPE_LEAK', 'BUSINESS_UNIT_SCOPE_LEAK', 'OTHER');

-- CreateEnum
CREATE TYPE "DataIsolationIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DataIsolationIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION', 'TEST');

-- CreateEnum
CREATE TYPE "DeploymentReleaseStatus" AS ENUM ('PLANNED', 'BUILDING', 'DEPLOYED', 'FAILED', 'ROLLED_BACK', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MigrationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "LoadTestEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION', 'TEST');

-- CreateEnum
CREATE TYPE "LoadTestStatus" AS ENUM ('PLANNED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "background_jobs" (
    "id" TEXT NOT NULL,
    "jobNumber" TEXT NOT NULL,
    "jobType" "BackgroundJobType" NOT NULL,
    "queueName" TEXT NOT NULL,
    "companyId" TEXT,
    "requestedById" TEXT,
    "status" "BackgroundJobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" "BackgroundJobPriority" NOT NULL DEFAULT 'NORMAL',
    "payload" JSONB,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "scheduledAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "correlationId" TEXT,
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "background_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_queue_configs" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "description" TEXT,
    "concurrency" INTEGER NOT NULL DEFAULT 1,
    "retryAttempts" INTEGER NOT NULL DEFAULT 3,
    "retryBackoffSeconds" INTEGER NOT NULL DEFAULT 60,
    "timeoutSeconds" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_queue_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cache_entries" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "companyId" TEXT,
    "scopeHash" TEXT,
    "cacheType" "CacheEntryType" NOT NULL DEFAULT 'CUSTOM',
    "value" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cache_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "performance_traces" (
    "id" TEXT NOT NULL,
    "traceNumber" TEXT NOT NULL,
    "traceType" "PerformanceTraceType" NOT NULL,
    "companyId" TEXT,
    "userId" TEXT,
    "path" TEXT,
    "operationName" TEXT,
    "durationMs" INTEGER NOT NULL,
    "status" "PerformanceTraceStatus" NOT NULL DEFAULT 'SUCCESS',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "performance_traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_isolation_test_runs" (
    "id" TEXT NOT NULL,
    "testRunNumber" TEXT NOT NULL,
    "runType" "DataIsolationRunType" NOT NULL,
    "status" "DataIsolationRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "totalChecks" INTEGER NOT NULL DEFAULT 0,
    "passedChecks" INTEGER NOT NULL DEFAULT 0,
    "failedChecks" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_isolation_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_isolation_test_issues" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "issueType" "DataIsolationIssueType" NOT NULL,
    "severity" "DataIsolationIssueSeverity" NOT NULL,
    "entityType" TEXT,
    "endpoint" TEXT,
    "description" TEXT NOT NULL,
    "status" "DataIsolationIssueStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_isolation_test_issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deployment_releases" (
    "id" TEXT NOT NULL,
    "releaseNumber" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "environment" "DeploymentEnvironment" NOT NULL,
    "status" "DeploymentReleaseStatus" NOT NULL DEFAULT 'PLANNED',
    "commitHash" TEXT,
    "imageTag" TEXT,
    "migrationStatus" "MigrationStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "deployedById" TEXT,
    "deployedAt" TIMESTAMP(3),
    "rollbackById" TEXT,
    "rollbackAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "deployment_releases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "load_test_runs" (
    "id" TEXT NOT NULL,
    "loadTestNumber" TEXT NOT NULL,
    "testName" TEXT NOT NULL,
    "environment" "LoadTestEnvironment" NOT NULL DEFAULT 'DEVELOPMENT',
    "targetUrl" TEXT,
    "scenarioConfig" JSONB,
    "status" "LoadTestStatus" NOT NULL DEFAULT 'PLANNED',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "averageResponseTimeMs" INTEGER,
    "p95ResponseTimeMs" INTEGER,
    "errorRate" DECIMAL(5,4),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "load_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_jobNumber_key" ON "background_jobs"("jobNumber");

-- CreateIndex
CREATE UNIQUE INDEX "background_jobs_idempotencyKey_key" ON "background_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "background_jobs_queueName_status_priority_scheduledAt_idx" ON "background_jobs"("queueName", "status", "priority", "scheduledAt");

-- CreateIndex
CREATE INDEX "background_jobs_companyId_jobType_status_createdAt_idx" ON "background_jobs"("companyId", "jobType", "status", "createdAt");

-- CreateIndex
CREATE INDEX "background_jobs_correlationId_idx" ON "background_jobs"("correlationId");

-- CreateIndex
CREATE UNIQUE INDEX "job_queue_configs_queueName_key" ON "job_queue_configs"("queueName");

-- CreateIndex
CREATE INDEX "job_queue_configs_queueName_isActive_idx" ON "job_queue_configs"("queueName", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "cache_entries_cacheKey_key" ON "cache_entries"("cacheKey");

-- CreateIndex
CREATE INDEX "cache_entries_companyId_cacheType_expiresAt_idx" ON "cache_entries"("companyId", "cacheType", "expiresAt");

-- CreateIndex
CREATE INDEX "cache_entries_cacheKey_expiresAt_idx" ON "cache_entries"("cacheKey", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "performance_traces_traceNumber_key" ON "performance_traces"("traceNumber");

-- CreateIndex
CREATE INDEX "performance_traces_traceType_status_durationMs_createdAt_idx" ON "performance_traces"("traceType", "status", "durationMs", "createdAt");

-- CreateIndex
CREATE INDEX "performance_traces_companyId_traceType_createdAt_idx" ON "performance_traces"("companyId", "traceType", "createdAt");

-- CreateIndex
CREATE INDEX "performance_traces_path_createdAt_idx" ON "performance_traces"("path", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "data_isolation_test_runs_testRunNumber_key" ON "data_isolation_test_runs"("testRunNumber");

-- CreateIndex
CREATE INDEX "data_isolation_test_runs_runType_status_startedAt_idx" ON "data_isolation_test_runs"("runType", "status", "startedAt");

-- CreateIndex
CREATE INDEX "data_isolation_test_issues_testRunId_severity_status_idx" ON "data_isolation_test_issues"("testRunId", "severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "deployment_releases_releaseNumber_key" ON "deployment_releases"("releaseNumber");

-- CreateIndex
CREATE INDEX "deployment_releases_environment_status_createdAt_idx" ON "deployment_releases"("environment", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "load_test_runs_loadTestNumber_key" ON "load_test_runs"("loadTestNumber");

-- CreateIndex
CREATE INDEX "load_test_runs_environment_status_createdAt_idx" ON "load_test_runs"("environment", "status", "createdAt");

-- CreateIndex
CREATE INDEX "approval_requests_companyId_entityType_entityId_status_idx" ON "approval_requests"("companyId", "entityType", "entityId", "status");

-- CreateIndex
CREATE INDEX "approval_requests_requestedById_status_createdAt_idx" ON "approval_requests"("requestedById", "status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_companyId_entityType_createdAt_idx" ON "audit_logs"("companyId", "entityType", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_createdAt_idx" ON "audit_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "compliance_obligations_companyId_dueDate_status_priority_idx" ON "compliance_obligations"("companyId", "dueDate", "status", "priority");

-- CreateIndex
CREATE INDEX "employees_companyId_employmentStatus_idx" ON "employees"("companyId", "employmentStatus");

-- CreateIndex
CREATE INDEX "employees_companyId_departmentId_positionId_idx" ON "employees"("companyId", "departmentId", "positionId");

-- CreateIndex
CREATE INDEX "error_logs_module_severity_status_createdAt_idx" ON "error_logs"("module", "severity", "status", "createdAt");

-- CreateIndex
CREATE INDEX "error_logs_severity_status_createdAt_idx" ON "error_logs"("severity", "status", "createdAt");

-- CreateIndex
CREATE INDEX "expenses_companyId_expenseDate_status_idx" ON "expenses"("companyId", "expenseDate", "status");

-- CreateIndex
CREATE INDEX "expenses_expenseCategoryId_companyId_idx" ON "expenses"("expenseCategoryId", "companyId");

-- CreateIndex
CREATE INDEX "inventory_movements_companyId_productId_movementDate_idx" ON "inventory_movements"("companyId", "productId", "movementDate");

-- CreateIndex
CREATE INDEX "inventory_movements_companyId_movementType_movementDate_idx" ON "inventory_movements"("companyId", "movementType", "movementDate");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_transactionDate_status_idx" ON "journal_entries"("companyId", "transactionDate", "status");

-- CreateIndex
CREATE INDEX "journal_entries_accountingPeriodId_status_idx" ON "journal_entries"("accountingPeriodId", "status");

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_status_createdAt_idx" ON "notifications"("recipientUserId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "notifications_notificationType_status_idx" ON "notifications"("notificationType", "status");

-- CreateIndex
CREATE INDEX "payables_companyId_supplierId_dueDate_status_idx" ON "payables"("companyId", "supplierId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "payables_companyId_outstandingAmount_status_idx" ON "payables"("companyId", "outstandingAmount", "status");

-- CreateIndex
CREATE INDEX "payroll_runs_companyId_status_idx" ON "payroll_runs"("companyId", "status");

-- CreateIndex
CREATE INDEX "posting_runs_companyId_createdAt_idx" ON "posting_runs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "purchase_orders_companyId_supplierId_orderDate_status_idx" ON "purchase_orders"("companyId", "supplierId", "orderDate", "status");

-- CreateIndex
CREATE INDEX "receivables_companyId_customerId_dueDate_status_idx" ON "receivables"("companyId", "customerId", "dueDate", "status");

-- CreateIndex
CREATE INDEX "receivables_companyId_outstandingAmount_status_idx" ON "receivables"("companyId", "outstandingAmount", "status");

-- CreateIndex
CREATE INDEX "sales_orders_companyId_customerId_orderDate_status_idx" ON "sales_orders"("companyId", "customerId", "orderDate", "status");

-- CreateIndex
CREATE INDEX "security_events_userId_eventType_createdAt_idx" ON "security_events"("userId", "eventType", "createdAt");

-- CreateIndex
CREATE INDEX "security_events_companyId_severity_status_createdAt_idx" ON "security_events"("companyId", "severity", "status", "createdAt");

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cache_entries" ADD CONSTRAINT "cache_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_traces" ADD CONSTRAINT "performance_traces_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "performance_traces" ADD CONSTRAINT "performance_traces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_isolation_test_runs" ADD CONSTRAINT "data_isolation_test_runs_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_isolation_test_issues" ADD CONSTRAINT "data_isolation_test_issues_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "data_isolation_test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_releases" ADD CONSTRAINT "deployment_releases_deployedById_fkey" FOREIGN KEY ("deployedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deployment_releases" ADD CONSTRAINT "deployment_releases_rollbackById_fkey" FOREIGN KEY ("rollbackById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "load_test_runs" ADD CONSTRAINT "load_test_runs_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

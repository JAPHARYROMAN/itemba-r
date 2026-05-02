-- CreateEnum
CREATE TYPE "KPICategory" AS ENUM ('FINANCE', 'SALES', 'INVENTORY', 'PETROLEUM', 'WESTSIDES', 'LOGISTICS', 'AGRICULTURE', 'CONSTRUCTION', 'RENTAL', 'PARKING', 'HOSPITALITY', 'HR', 'PAYROLL', 'COMPLIANCE', 'APPROVALS', 'ASSETS', 'DEBT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "KPICalculationType" AS ENUM ('SUM', 'COUNT', 'AVERAGE', 'RATIO', 'PERCENTAGE', 'DIFFERENCE', 'CUSTOM_QUERY', 'SNAPSHOT');

-- CreateEnum
CREATE TYPE "SnapshotPeriodType" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('EXECUTIVE', 'FINANCE', 'SALES', 'INVENTORY', 'PETROLEUM', 'WESTSIDES', 'LOGISTICS', 'AGRICULTURE', 'CONSTRUCTION', 'RENTAL', 'PARKING', 'HOSPITALITY', 'HR', 'PAYROLL', 'COMPLIANCE', 'APPROVALS', 'AUDIT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportRunStatus" AS ENUM ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScheduleFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReportExportFormat" AS ENUM ('PDF', 'EXCEL', 'CSV', 'JSON', 'DASHBOARD_ONLY');

-- CreateEnum
CREATE TYPE "DashboardType" AS ENUM ('EXECUTIVE', 'GROUP', 'COMPANY', 'DIVISION', 'BRANCH', 'MODULE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WidgetType" AS ENUM ('KPI_CARD', 'LINE_CHART', 'BAR_CHART', 'PIE_CHART', 'TABLE', 'HEATMAP', 'ALERT_LIST', 'TASK_LIST', 'APPROVAL_LIST', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WidgetDataSourceType" AS ENUM ('KPI', 'REPORT', 'DATASET', 'ALERT', 'APPROVAL', 'TASK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AnalyticsRunType" AS ENUM ('KPI_SNAPSHOT', 'DAILY_SUMMARY', 'MONTHLY_SUMMARY', 'DATA_QUALITY_CHECK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AnalyticsRunStatus" AS ENUM ('REQUESTED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('PERFORMANCE', 'RISK', 'OPPORTUNITY', 'WARNING', 'COMPLIANCE', 'FINANCE', 'OPERATIONS', 'HR', 'CUSTOM');

-- CreateEnum
CREATE TYPE "InsightSeverity" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "InsightGeneratedBy" AS ENUM ('SYSTEM', 'USER', 'AI_ASSISTED');

-- CreateEnum
CREATE TYPE "DataQualityIssueType" AS ENUM ('MISSING_REQUIRED_FIELD', 'MISSING_DOCUMENT', 'DUPLICATE_RECORD', 'NEGATIVE_BALANCE', 'UNPOSTED_TRANSACTION', 'UNRECONCILED_RECORD', 'ORPHAN_RECORD', 'INCONSISTENT_STATUS', 'EXPIRED_DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DataQualityIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DataQualityIssueStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "kpi_indicators" (
    "id" TEXT NOT NULL,
    "kpiCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kpiCategory" "KPICategory" NOT NULL DEFAULT 'CUSTOM',
    "calculationType" "KPICalculationType" NOT NULL DEFAULT 'SUM',
    "sourceEntity" TEXT,
    "sourceField" TEXT,
    "formula" JSONB,
    "unit" TEXT,
    "currency" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "requiredPermission" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "kpi_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kpi_snapshots" (
    "id" TEXT NOT NULL,
    "kpiIndicatorId" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "periodType" "SnapshotPeriodType" NOT NULL DEFAULT 'MONTHLY',
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(65,30) NOT NULL,
    "comparisonValue" DECIMAL(65,30),
    "changeAmount" DECIMAL(65,30),
    "changePercent" DECIMAL(65,30),
    "currency" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kpi_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_definitions" (
    "id" TEXT NOT NULL,
    "reportCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "reportCategory" "ReportCategory" NOT NULL DEFAULT 'CUSTOM',
    "datasetKey" TEXT NOT NULL,
    "defaultFilters" JSONB,
    "defaultColumns" JSONB,
    "supportedFilters" JSONB,
    "isSystemReport" BOOLEAN NOT NULL DEFAULT false,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "requiredPermission" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "report_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_report_views" (
    "id" TEXT NOT NULL,
    "reportDefinitionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "filters" JSONB,
    "columns" JSONB,
    "sortConfig" JSONB,
    "chartConfig" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isShared" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "saved_report_views_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_runs" (
    "id" TEXT NOT NULL,
    "reportRunNumber" TEXT NOT NULL,
    "reportDefinitionId" TEXT NOT NULL,
    "savedReportViewId" TEXT,
    "companyId" TEXT,
    "requestedById" TEXT NOT NULL,
    "filters" JSONB,
    "status" "ReportRunStatus" NOT NULL DEFAULT 'REQUESTED',
    "rowCount" INTEGER,
    "executionTimeMs" INTEGER,
    "resultSummary" JSONB,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" TEXT NOT NULL,
    "scheduleCode" TEXT NOT NULL,
    "reportDefinitionId" TEXT NOT NULL,
    "savedReportViewId" TEXT,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "frequency" "ScheduleFrequency" NOT NULL DEFAULT 'MONTHLY',
    "scheduleConfig" JSONB,
    "recipients" JSONB NOT NULL,
    "exportFormat" "ReportExportFormat" NOT NULL DEFAULT 'EXCEL',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_definitions" (
    "id" TEXT NOT NULL,
    "dashboardCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "dashboardType" "DashboardType" NOT NULL DEFAULT 'CUSTOM',
    "layout" JSONB NOT NULL,
    "isSystemDashboard" BOOLEAN NOT NULL DEFAULT false,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "requiredPermission" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dashboard_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dashboard_widgets" (
    "id" TEXT NOT NULL,
    "dashboardDefinitionId" TEXT NOT NULL,
    "widgetCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "widgetType" "WidgetType" NOT NULL DEFAULT 'KPI_CARD',
    "dataSourceType" "WidgetDataSourceType" NOT NULL DEFAULT 'KPI',
    "dataSourceKey" TEXT,
    "kpiIndicatorId" TEXT,
    "reportDefinitionId" TEXT,
    "config" JSONB,
    "position" JSONB,
    "isSensitive" BOOLEAN NOT NULL DEFAULT false,
    "requiredPermission" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "dashboard_widgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_dashboard_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dashboardDefinitionId" TEXT NOT NULL,
    "layoutOverride" JSONB,
    "filters" JSONB,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_dashboard_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_snapshot_runs" (
    "id" TEXT NOT NULL,
    "runNumber" TEXT NOT NULL,
    "runType" "AnalyticsRunType" NOT NULL DEFAULT 'KPI_SNAPSHOT',
    "companyId" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "status" "AnalyticsRunStatus" NOT NULL DEFAULT 'REQUESTED',
    "startedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_snapshot_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "executive_insights" (
    "id" TEXT NOT NULL,
    "insightNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "insightDate" TIMESTAMP(3) NOT NULL,
    "insightType" "InsightType" NOT NULL DEFAULT 'PERFORMANCE',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "severity" "InsightSeverity" NOT NULL DEFAULT 'NORMAL',
    "sourceMetrics" JSONB,
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "status" "InsightStatus" NOT NULL DEFAULT 'OPEN',
    "generatedBy" "InsightGeneratedBy" NOT NULL DEFAULT 'SYSTEM',
    "createdById" TEXT,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "executive_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_quality_issues" (
    "id" TEXT NOT NULL,
    "issueNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "issueType" "DataQualityIssueType" NOT NULL DEFAULT 'OTHER',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "DataQualityIssueSeverity" NOT NULL DEFAULT 'MEDIUM',
    "status" "DataQualityIssueStatus" NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_quality_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kpi_indicators_kpiCode_key" ON "kpi_indicators"("kpiCode");

-- CreateIndex
CREATE INDEX "kpi_indicators_kpiCategory_isActive_idx" ON "kpi_indicators"("kpiCategory", "isActive");

-- CreateIndex
CREATE INDEX "kpi_snapshots_kpiIndicatorId_companyId_periodType_periodSta_idx" ON "kpi_snapshots"("kpiIndicatorId", "companyId", "periodType", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "report_definitions_reportCode_key" ON "report_definitions"("reportCode");

-- CreateIndex
CREATE INDEX "report_definitions_reportCategory_isActive_idx" ON "report_definitions"("reportCategory", "isActive");

-- CreateIndex
CREATE INDEX "saved_report_views_userId_reportDefinitionId_idx" ON "saved_report_views"("userId", "reportDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "report_runs_reportRunNumber_key" ON "report_runs"("reportRunNumber");

-- CreateIndex
CREATE INDEX "report_runs_reportDefinitionId_status_idx" ON "report_runs"("reportDefinitionId", "status");

-- CreateIndex
CREATE INDEX "report_runs_requestedById_companyId_idx" ON "report_runs"("requestedById", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_reports_scheduleCode_key" ON "scheduled_reports"("scheduleCode");

-- CreateIndex
CREATE INDEX "scheduled_reports_reportDefinitionId_isActive_idx" ON "scheduled_reports"("reportDefinitionId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_definitions_dashboardCode_key" ON "dashboard_definitions"("dashboardCode");

-- CreateIndex
CREATE INDEX "dashboard_definitions_dashboardType_isSystemDashboard_idx" ON "dashboard_definitions"("dashboardType", "isSystemDashboard");

-- CreateIndex
CREATE UNIQUE INDEX "dashboard_widgets_dashboardDefinitionId_widgetCode_key" ON "dashboard_widgets"("dashboardDefinitionId", "widgetCode");

-- CreateIndex
CREATE UNIQUE INDEX "user_dashboard_preferences_userId_dashboardDefinitionId_key" ON "user_dashboard_preferences"("userId", "dashboardDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_snapshot_runs_runNumber_key" ON "analytics_snapshot_runs"("runNumber");

-- CreateIndex
CREATE INDEX "analytics_snapshot_runs_runType_status_createdAt_idx" ON "analytics_snapshot_runs"("runType", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "executive_insights_insightNumber_key" ON "executive_insights"("insightNumber");

-- CreateIndex
CREATE INDEX "executive_insights_companyId_insightType_status_insightDate_idx" ON "executive_insights"("companyId", "insightType", "status", "insightDate");

-- CreateIndex
CREATE UNIQUE INDEX "data_quality_issues_issueNumber_key" ON "data_quality_issues"("issueNumber");

-- CreateIndex
CREATE INDEX "data_quality_issues_companyId_issueType_status_detectedAt_idx" ON "data_quality_issues"("companyId", "issueType", "status", "detectedAt");

-- AddForeignKey
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_kpiIndicatorId_fkey" FOREIGN KEY ("kpiIndicatorId") REFERENCES "kpi_indicators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_definitions" ADD CONSTRAINT "report_definitions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_report_views" ADD CONSTRAINT "saved_report_views_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "report_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_report_views" ADD CONSTRAINT "saved_report_views_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_runs" ADD CONSTRAINT "report_runs_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "report_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_savedReportViewId_fkey" FOREIGN KEY ("savedReportViewId") REFERENCES "saved_report_views"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_definitions" ADD CONSTRAINT "dashboard_definitions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_dashboardDefinitionId_fkey" FOREIGN KEY ("dashboardDefinitionId") REFERENCES "dashboard_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_kpiIndicatorId_fkey" FOREIGN KEY ("kpiIndicatorId") REFERENCES "kpi_indicators"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dashboard_widgets" ADD CONSTRAINT "dashboard_widgets_reportDefinitionId_fkey" FOREIGN KEY ("reportDefinitionId") REFERENCES "report_definitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_preferences" ADD CONSTRAINT "user_dashboard_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_dashboard_preferences" ADD CONSTRAINT "user_dashboard_preferences_dashboardDefinitionId_fkey" FOREIGN KEY ("dashboardDefinitionId") REFERENCES "dashboard_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_snapshot_runs" ADD CONSTRAINT "analytics_snapshot_runs_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executive_insights" ADD CONSTRAINT "executive_insights_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executive_insights" ADD CONSTRAINT "executive_insights_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executive_insights" ADD CONSTRAINT "executive_insights_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "executive_insights" ADD CONSTRAINT "executive_insights_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_quality_issues" ADD CONSTRAINT "data_quality_issues_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateEnum
CREATE TYPE "QATestSuiteType" AS ENUM ('MODULE', 'END_TO_END', 'REGRESSION', 'SECURITY', 'PERFORMANCE', 'DATA_ISOLATION', 'ACCOUNTING', 'UI_UX', 'INTEGRATION', 'LAUNCH_READINESS', 'CUSTOM');

-- CreateEnum
CREATE TYPE "QATestCaseType" AS ENUM ('MANUAL', 'AUTOMATED', 'HYBRID');

-- CreateEnum
CREATE TYPE "QATestRunType" AS ENUM ('MANUAL', 'AUTOMATED', 'HYBRID');

-- CreateEnum
CREATE TYPE "QATestRunEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION', 'TEST', 'TRAINING');

-- CreateEnum
CREATE TYPE "QATestRunStatus" AS ENUM ('PLANNED', 'RUNNING', 'PASSED', 'FAILED', 'PARTIAL', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QATestResultStatus" AS ENUM ('PASSED', 'FAILED', 'BLOCKED', 'SKIPPED', 'NOT_RUN');

-- CreateEnum
CREATE TYPE "QASuiteStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QACaseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QAPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "LaunchBlockerType" AS ENUM ('BUG', 'SECURITY_RISK', 'DATA_ISSUE', 'ACCOUNTING_ISSUE', 'PERFORMANCE_ISSUE', 'UI_UX_ISSUE', 'DOCUMENTATION_GAP', 'TRAINING_GAP', 'CONFIGURATION_GAP', 'INTEGRATION_ISSUE', 'COMPLIANCE_RISK', 'OTHER');

-- CreateEnum
CREATE TYPE "LaunchBlockerStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK', 'DEFERRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LaunchReadinessAssessmentStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'READY', 'NOT_READY', 'READY_WITH_RISKS', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LaunchReadinessEnvironment" AS ENUM ('STAGING', 'PRODUCTION', 'TRAINING', 'TEST');

-- CreateEnum
CREATE TYPE "LaunchReadinessItemCategory" AS ENUM ('SECURITY', 'BACKUP', 'ACCOUNTING', 'DATA_QUALITY', 'PERFORMANCE', 'UI_UX', 'DOCUMENTATION', 'TRAINING', 'INTEGRATIONS', 'COMPLIANCE', 'USER_ACCESS', 'REPORTING', 'DEPLOYMENT', 'SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LaunchReadinessItemStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'PASSED', 'FAILED', 'WAIVED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "UserManualType" AS ENUM ('USER_GUIDE', 'ADMIN_GUIDE', 'QUICK_START', 'SOP', 'TRAINING_GUIDE', 'TROUBLESHOOTING', 'FAQ', 'RELEASE_NOTES', 'OTHER');

-- CreateEnum
CREATE TYPE "UserManualStatus" AS ENUM ('DRAFT', 'REVIEWED', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "HelpArticleCategory" AS ENUM ('GETTING_STARTED', 'GROUP_CONTROL', 'FINANCE', 'PROCUREMENT', 'SALES', 'INVENTORY', 'PETROLEUM', 'WESTSIDES', 'ITEMBA', 'RENTALS', 'PARKING', 'HOSPITALITY', 'HR_PAYROLL', 'COMPLIANCE', 'APPROVALS', 'BI', 'INTEGRATIONS', 'SECURITY', 'TROUBLESHOOTING', 'FAQ', 'OTHER');

-- CreateEnum
CREATE TYPE "HelpArticleStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingCourseDifficulty" AS ENUM ('BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "TrainingCourseStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TrainingLessonType" AS ENUM ('TEXT', 'VIDEO_PLACEHOLDER', 'WALKTHROUGH', 'CHECKLIST', 'QUIZ', 'TASK_PRACTICE');

-- CreateEnum
CREATE TYPE "TrainingLessonStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TrainingEnrollmentStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingLessonProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "GuidedWalkthroughStatus" AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "UserWalkthroughProgressStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TrainingEnvironmentType" AS ENUM ('TRAINING', 'DEMO', 'SANDBOX');

-- CreateEnum
CREATE TYPE "TrainingSeedProfile" AS ENUM ('MINIMAL', 'STANDARD', 'FULL_DEMO', 'ROLE_BASED');

-- CreateEnum
CREATE TYPE "TrainingResetFrequency" AS ENUM ('NEVER', 'DAILY', 'WEEKLY', 'MONTHLY', 'MANUAL');

-- CreateEnum
CREATE TYPE "TrainingEnvironmentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "SupportTicketType" AS ENUM ('BUG', 'QUESTION', 'FEATURE_REQUEST', 'TRAINING_REQUEST', 'ACCESS_REQUEST', 'DATA_CORRECTION', 'CONFIGURATION', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING_USER', 'RESOLVED', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "QATestSuite" (
    "id" TEXT NOT NULL,
    "suiteCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "suiteType" "QATestSuiteType" NOT NULL,
    "moduleName" TEXT,
    "priority" "QAPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "QASuiteStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QATestSuite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QATestCase" (
    "id" TEXT NOT NULL,
    "testCaseCode" TEXT NOT NULL,
    "testSuiteId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "preconditions" TEXT,
    "steps" JSONB NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "moduleName" TEXT,
    "roleContext" TEXT,
    "companyContext" TEXT,
    "priority" "QAPriority" NOT NULL DEFAULT 'MEDIUM',
    "testType" "QATestCaseType" NOT NULL DEFAULT 'MANUAL',
    "automationReference" TEXT,
    "status" "QACaseStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QATestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QATestRun" (
    "id" TEXT NOT NULL,
    "testRunNumber" TEXT NOT NULL,
    "testSuiteId" TEXT,
    "runName" TEXT NOT NULL,
    "runType" "QATestRunType" NOT NULL DEFAULT 'MANUAL',
    "environment" "QATestRunEnvironment" NOT NULL DEFAULT 'TEST',
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "status" "QATestRunStatus" NOT NULL DEFAULT 'PLANNED',
    "totalCases" INTEGER NOT NULL DEFAULT 0,
    "passedCases" INTEGER NOT NULL DEFAULT 0,
    "failedCases" INTEGER NOT NULL DEFAULT 0,
    "blockedCases" INTEGER NOT NULL DEFAULT 0,
    "skippedCases" INTEGER NOT NULL DEFAULT 0,
    "resultSummary" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "QATestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QATestResult" (
    "id" TEXT NOT NULL,
    "testRunId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "status" "QATestResultStatus" NOT NULL DEFAULT 'NOT_RUN',
    "actualResult" TEXT,
    "failureReason" TEXT,
    "evidenceDocumentId" TEXT,
    "screenshotUrl" TEXT,
    "executedById" TEXT,
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QATestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchBlocker" (
    "id" TEXT NOT NULL,
    "blockerNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "blockerType" "LaunchBlockerType" NOT NULL,
    "severity" "AuditSeverity" NOT NULL DEFAULT 'MEDIUM',
    "moduleName" TEXT,
    "companyId" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "status" "LaunchBlockerStatus" NOT NULL DEFAULT 'OPEN',
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "acceptanceReason" TEXT,
    "targetResolutionDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LaunchBlocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchReadinessAssessment" (
    "id" TEXT NOT NULL,
    "assessmentNumber" TEXT NOT NULL,
    "environment" "LaunchReadinessEnvironment" NOT NULL,
    "assessmentDate" TIMESTAMP(3) NOT NULL,
    "status" "LaunchReadinessAssessmentStatus" NOT NULL DEFAULT 'DRAFT',
    "overallScore" DECIMAL(5,2),
    "securityScore" DECIMAL(5,2),
    "accountingScore" DECIMAL(5,2),
    "dataQualityScore" DECIMAL(5,2),
    "performanceScore" DECIMAL(5,2),
    "uiUxScore" DECIMAL(5,2),
    "documentationScore" DECIMAL(5,2),
    "trainingScore" DECIMAL(5,2),
    "qaScore" DECIMAL(5,2),
    "summary" TEXT,
    "risks" JSONB,
    "recommendations" JSONB,
    "assessedById" TEXT NOT NULL,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "LaunchReadinessAssessment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LaunchReadinessItem" (
    "id" TEXT NOT NULL,
    "assessmentId" TEXT NOT NULL,
    "category" "LaunchReadinessItemCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "LaunchReadinessItemStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "evidenceDocumentId" TEXT,
    "responsibleUserId" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LaunchReadinessItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserManual" (
    "id" TEXT NOT NULL,
    "manualCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "moduleName" TEXT,
    "roleName" TEXT,
    "manualType" "UserManualType" NOT NULL,
    "content" TEXT NOT NULL,
    "status" "UserManualStatus" NOT NULL DEFAULT 'DRAFT',
    "version" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "UserManual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HelpArticle" (
    "id" TEXT NOT NULL,
    "articleCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "HelpArticleCategory" NOT NULL,
    "content" TEXT NOT NULL,
    "tags" JSONB,
    "status" "HelpArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "helpfulCount" INTEGER NOT NULL DEFAULT 0,
    "notHelpfulCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "HelpArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingCourse" (
    "id" TEXT NOT NULL,
    "courseCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "roleName" TEXT,
    "moduleName" TEXT,
    "difficulty" "TrainingCourseDifficulty" NOT NULL DEFAULT 'BEGINNER',
    "status" "TrainingCourseStatus" NOT NULL DEFAULT 'DRAFT',
    "estimatedMinutes" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingCourse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingLesson" (
    "id" TEXT NOT NULL,
    "trainingCourseId" TEXT NOT NULL,
    "lessonCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "lessonOrder" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "lessonType" "TrainingLessonType" NOT NULL DEFAULT 'TEXT',
    "walkthroughConfig" JSONB,
    "quizConfig" JSONB,
    "status" "TrainingLessonStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingLesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEnrollment" (
    "id" TEXT NOT NULL,
    "trainingCourseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "status" "TrainingEnrollmentStatus" NOT NULL DEFAULT 'ASSIGNED',
    "progressPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingLessonProgress" (
    "id" TEXT NOT NULL,
    "trainingEnrollmentId" TEXT NOT NULL,
    "trainingLessonId" TEXT NOT NULL,
    "status" "TrainingLessonProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "score" DECIMAL(5,2),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrainingLessonProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidedWalkthrough" (
    "id" TEXT NOT NULL,
    "walkthroughCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "moduleName" TEXT,
    "routePath" TEXT,
    "roleName" TEXT,
    "description" TEXT,
    "steps" JSONB NOT NULL,
    "status" "GuidedWalkthroughStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "GuidedWalkthrough_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWalkthroughProgress" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guidedWalkthroughId" TEXT NOT NULL,
    "status" "UserWalkthroughProgressStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserWalkthroughProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingEnvironmentConfig" (
    "id" TEXT NOT NULL,
    "configCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "environment" "TrainingEnvironmentType" NOT NULL,
    "seedProfile" "TrainingSeedProfile" NOT NULL DEFAULT 'STANDARD',
    "resetFrequency" "TrainingResetFrequency" NOT NULL DEFAULT 'MANUAL',
    "lastResetAt" TIMESTAMP(3),
    "status" "TrainingEnvironmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TrainingEnvironmentConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "ticketNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "reportedById" TEXT NOT NULL,
    "assignedToId" TEXT,
    "moduleName" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ticketType" "SupportTicketType" NOT NULL DEFAULT 'QUESTION',
    "priority" "SupportTicketPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportTicketComment" (
    "id" TEXT NOT NULL,
    "supportTicketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SupportTicketComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QATestSuite_suiteCode_key" ON "QATestSuite"("suiteCode");

-- CreateIndex
CREATE INDEX "QATestSuite_suiteType_idx" ON "QATestSuite"("suiteType");

-- CreateIndex
CREATE INDEX "QATestSuite_moduleName_idx" ON "QATestSuite"("moduleName");

-- CreateIndex
CREATE INDEX "QATestSuite_status_idx" ON "QATestSuite"("status");

-- CreateIndex
CREATE INDEX "QATestSuite_priority_idx" ON "QATestSuite"("priority");

-- CreateIndex
CREATE INDEX "QATestSuite_createdAt_idx" ON "QATestSuite"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "QATestCase_testCaseCode_key" ON "QATestCase"("testCaseCode");

-- CreateIndex
CREATE INDEX "QATestCase_testSuiteId_idx" ON "QATestCase"("testSuiteId");

-- CreateIndex
CREATE INDEX "QATestCase_moduleName_idx" ON "QATestCase"("moduleName");

-- CreateIndex
CREATE INDEX "QATestCase_status_idx" ON "QATestCase"("status");

-- CreateIndex
CREATE INDEX "QATestCase_priority_idx" ON "QATestCase"("priority");

-- CreateIndex
CREATE INDEX "QATestCase_testType_idx" ON "QATestCase"("testType");

-- CreateIndex
CREATE UNIQUE INDEX "QATestRun_testRunNumber_key" ON "QATestRun"("testRunNumber");

-- CreateIndex
CREATE INDEX "QATestRun_testSuiteId_idx" ON "QATestRun"("testSuiteId");

-- CreateIndex
CREATE INDEX "QATestRun_status_idx" ON "QATestRun"("status");

-- CreateIndex
CREATE INDEX "QATestRun_environment_idx" ON "QATestRun"("environment");

-- CreateIndex
CREATE INDEX "QATestRun_startedAt_idx" ON "QATestRun"("startedAt");

-- CreateIndex
CREATE INDEX "QATestRun_startedById_idx" ON "QATestRun"("startedById");

-- CreateIndex
CREATE INDEX "QATestResult_testRunId_idx" ON "QATestResult"("testRunId");

-- CreateIndex
CREATE INDEX "QATestResult_testCaseId_idx" ON "QATestResult"("testCaseId");

-- CreateIndex
CREATE INDEX "QATestResult_status_idx" ON "QATestResult"("status");

-- CreateIndex
CREATE INDEX "QATestResult_executedById_idx" ON "QATestResult"("executedById");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchBlocker_blockerNumber_key" ON "LaunchBlocker"("blockerNumber");

-- CreateIndex
CREATE INDEX "LaunchBlocker_status_idx" ON "LaunchBlocker"("status");

-- CreateIndex
CREATE INDEX "LaunchBlocker_severity_idx" ON "LaunchBlocker"("severity");

-- CreateIndex
CREATE INDEX "LaunchBlocker_blockerType_idx" ON "LaunchBlocker"("blockerType");

-- CreateIndex
CREATE INDEX "LaunchBlocker_moduleName_idx" ON "LaunchBlocker"("moduleName");

-- CreateIndex
CREATE INDEX "LaunchBlocker_companyId_idx" ON "LaunchBlocker"("companyId");

-- CreateIndex
CREATE INDEX "LaunchBlocker_reportedById_idx" ON "LaunchBlocker"("reportedById");

-- CreateIndex
CREATE INDEX "LaunchBlocker_assignedToId_idx" ON "LaunchBlocker"("assignedToId");

-- CreateIndex
CREATE INDEX "LaunchBlocker_createdAt_idx" ON "LaunchBlocker"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LaunchReadinessAssessment_assessmentNumber_key" ON "LaunchReadinessAssessment"("assessmentNumber");

-- CreateIndex
CREATE INDEX "LaunchReadinessAssessment_status_idx" ON "LaunchReadinessAssessment"("status");

-- CreateIndex
CREATE INDEX "LaunchReadinessAssessment_environment_idx" ON "LaunchReadinessAssessment"("environment");

-- CreateIndex
CREATE INDEX "LaunchReadinessAssessment_assessmentDate_idx" ON "LaunchReadinessAssessment"("assessmentDate");

-- CreateIndex
CREATE INDEX "LaunchReadinessAssessment_assessedById_idx" ON "LaunchReadinessAssessment"("assessedById");

-- CreateIndex
CREATE INDEX "LaunchReadinessItem_assessmentId_idx" ON "LaunchReadinessItem"("assessmentId");

-- CreateIndex
CREATE INDEX "LaunchReadinessItem_category_idx" ON "LaunchReadinessItem"("category");

-- CreateIndex
CREATE INDEX "LaunchReadinessItem_status_idx" ON "LaunchReadinessItem"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserManual_manualCode_key" ON "UserManual"("manualCode");

-- CreateIndex
CREATE INDEX "UserManual_status_idx" ON "UserManual"("status");

-- CreateIndex
CREATE INDEX "UserManual_manualType_idx" ON "UserManual"("manualType");

-- CreateIndex
CREATE INDEX "UserManual_moduleName_idx" ON "UserManual"("moduleName");

-- CreateIndex
CREATE INDEX "UserManual_roleName_idx" ON "UserManual"("roleName");

-- CreateIndex
CREATE INDEX "UserManual_createdAt_idx" ON "UserManual"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "HelpArticle_articleCode_key" ON "HelpArticle"("articleCode");

-- CreateIndex
CREATE INDEX "HelpArticle_status_idx" ON "HelpArticle"("status");

-- CreateIndex
CREATE INDEX "HelpArticle_category_idx" ON "HelpArticle"("category");

-- CreateIndex
CREATE INDEX "HelpArticle_createdAt_idx" ON "HelpArticle"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingCourse_courseCode_key" ON "TrainingCourse"("courseCode");

-- CreateIndex
CREATE INDEX "TrainingCourse_status_idx" ON "TrainingCourse"("status");

-- CreateIndex
CREATE INDEX "TrainingCourse_roleName_idx" ON "TrainingCourse"("roleName");

-- CreateIndex
CREATE INDEX "TrainingCourse_moduleName_idx" ON "TrainingCourse"("moduleName");

-- CreateIndex
CREATE INDEX "TrainingCourse_difficulty_idx" ON "TrainingCourse"("difficulty");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingLesson_lessonCode_key" ON "TrainingLesson"("lessonCode");

-- CreateIndex
CREATE INDEX "TrainingLesson_trainingCourseId_idx" ON "TrainingLesson"("trainingCourseId");

-- CreateIndex
CREATE INDEX "TrainingLesson_lessonOrder_idx" ON "TrainingLesson"("lessonOrder");

-- CreateIndex
CREATE INDEX "TrainingLesson_status_idx" ON "TrainingLesson"("status");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_userId_idx" ON "TrainingEnrollment"("userId");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_status_idx" ON "TrainingEnrollment"("status");

-- CreateIndex
CREATE INDEX "TrainingEnrollment_createdAt_idx" ON "TrainingEnrollment"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnrollment_trainingCourseId_userId_key" ON "TrainingEnrollment"("trainingCourseId", "userId");

-- CreateIndex
CREATE INDEX "TrainingLessonProgress_trainingEnrollmentId_idx" ON "TrainingLessonProgress"("trainingEnrollmentId");

-- CreateIndex
CREATE INDEX "TrainingLessonProgress_trainingLessonId_idx" ON "TrainingLessonProgress"("trainingLessonId");

-- CreateIndex
CREATE INDEX "TrainingLessonProgress_status_idx" ON "TrainingLessonProgress"("status");

-- CreateIndex
CREATE UNIQUE INDEX "GuidedWalkthrough_walkthroughCode_key" ON "GuidedWalkthrough"("walkthroughCode");

-- CreateIndex
CREATE INDEX "GuidedWalkthrough_status_idx" ON "GuidedWalkthrough"("status");

-- CreateIndex
CREATE INDEX "GuidedWalkthrough_moduleName_idx" ON "GuidedWalkthrough"("moduleName");

-- CreateIndex
CREATE INDEX "GuidedWalkthrough_roleName_idx" ON "GuidedWalkthrough"("roleName");

-- CreateIndex
CREATE INDEX "GuidedWalkthrough_routePath_idx" ON "GuidedWalkthrough"("routePath");

-- CreateIndex
CREATE INDEX "UserWalkthroughProgress_userId_idx" ON "UserWalkthroughProgress"("userId");

-- CreateIndex
CREATE INDEX "UserWalkthroughProgress_guidedWalkthroughId_idx" ON "UserWalkthroughProgress"("guidedWalkthroughId");

-- CreateIndex
CREATE INDEX "UserWalkthroughProgress_status_idx" ON "UserWalkthroughProgress"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UserWalkthroughProgress_userId_guidedWalkthroughId_key" ON "UserWalkthroughProgress"("userId", "guidedWalkthroughId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingEnvironmentConfig_configCode_key" ON "TrainingEnvironmentConfig"("configCode");

-- CreateIndex
CREATE INDEX "TrainingEnvironmentConfig_status_idx" ON "TrainingEnvironmentConfig"("status");

-- CreateIndex
CREATE INDEX "TrainingEnvironmentConfig_environment_idx" ON "TrainingEnvironmentConfig"("environment");

-- CreateIndex
CREATE UNIQUE INDEX "SupportTicket_ticketNumber_key" ON "SupportTicket"("ticketNumber");

-- CreateIndex
CREATE INDEX "SupportTicket_status_idx" ON "SupportTicket"("status");

-- CreateIndex
CREATE INDEX "SupportTicket_priority_idx" ON "SupportTicket"("priority");

-- CreateIndex
CREATE INDEX "SupportTicket_ticketType_idx" ON "SupportTicket"("ticketType");

-- CreateIndex
CREATE INDEX "SupportTicket_companyId_idx" ON "SupportTicket"("companyId");

-- CreateIndex
CREATE INDEX "SupportTicket_reportedById_idx" ON "SupportTicket"("reportedById");

-- CreateIndex
CREATE INDEX "SupportTicket_assignedToId_idx" ON "SupportTicket"("assignedToId");

-- CreateIndex
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");

-- CreateIndex
CREATE INDEX "SupportTicketComment_supportTicketId_idx" ON "SupportTicketComment"("supportTicketId");

-- CreateIndex
CREATE INDEX "SupportTicketComment_userId_idx" ON "SupportTicketComment"("userId");

-- CreateIndex
CREATE INDEX "SupportTicketComment_internal_idx" ON "SupportTicketComment"("internal");

-- CreateIndex
CREATE INDEX "SupportTicketComment_createdAt_idx" ON "SupportTicketComment"("createdAt");

-- AddForeignKey
ALTER TABLE "QATestSuite" ADD CONSTRAINT "QATestSuite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QATestCase" ADD CONSTRAINT "QATestCase_testSuiteId_fkey" FOREIGN KEY ("testSuiteId") REFERENCES "QATestSuite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QATestRun" ADD CONSTRAINT "QATestRun_testSuiteId_fkey" FOREIGN KEY ("testSuiteId") REFERENCES "QATestSuite"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QATestRun" ADD CONSTRAINT "QATestRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QATestResult" ADD CONSTRAINT "QATestResult_testRunId_fkey" FOREIGN KEY ("testRunId") REFERENCES "QATestRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QATestResult" ADD CONSTRAINT "QATestResult_testCaseId_fkey" FOREIGN KEY ("testCaseId") REFERENCES "QATestCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QATestResult" ADD CONSTRAINT "QATestResult_executedById_fkey" FOREIGN KEY ("executedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchBlocker" ADD CONSTRAINT "LaunchBlocker_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchBlocker" ADD CONSTRAINT "LaunchBlocker_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchBlocker" ADD CONSTRAINT "LaunchBlocker_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchReadinessAssessment" ADD CONSTRAINT "LaunchReadinessAssessment_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchReadinessAssessment" ADD CONSTRAINT "LaunchReadinessAssessment_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchReadinessItem" ADD CONSTRAINT "LaunchReadinessItem_assessmentId_fkey" FOREIGN KEY ("assessmentId") REFERENCES "LaunchReadinessAssessment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchReadinessItem" ADD CONSTRAINT "LaunchReadinessItem_responsibleUserId_fkey" FOREIGN KEY ("responsibleUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LaunchReadinessItem" ADD CONSTRAINT "LaunchReadinessItem_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserManual" ADD CONSTRAINT "UserManual_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserManual" ADD CONSTRAINT "UserManual_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserManual" ADD CONSTRAINT "UserManual_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticle" ADD CONSTRAINT "HelpArticle_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HelpArticle" ADD CONSTRAINT "HelpArticle_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingCourse" ADD CONSTRAINT "TrainingCourse_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLesson" ADD CONSTRAINT "TrainingLesson_trainingCourseId_fkey" FOREIGN KEY ("trainingCourseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_trainingCourseId_fkey" FOREIGN KEY ("trainingCourseId") REFERENCES "TrainingCourse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnrollment" ADD CONSTRAINT "TrainingEnrollment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_trainingEnrollmentId_fkey" FOREIGN KEY ("trainingEnrollmentId") REFERENCES "TrainingEnrollment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingLessonProgress" ADD CONSTRAINT "TrainingLessonProgress_trainingLessonId_fkey" FOREIGN KEY ("trainingLessonId") REFERENCES "TrainingLesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GuidedWalkthrough" ADD CONSTRAINT "GuidedWalkthrough_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWalkthroughProgress" ADD CONSTRAINT "UserWalkthroughProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWalkthroughProgress" ADD CONSTRAINT "UserWalkthroughProgress_guidedWalkthroughId_fkey" FOREIGN KEY ("guidedWalkthroughId") REFERENCES "GuidedWalkthrough"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingEnvironmentConfig" ADD CONSTRAINT "TrainingEnvironmentConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_supportTicketId_fkey" FOREIGN KEY ("supportTicketId") REFERENCES "SupportTicket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportTicketComment" ADD CONSTRAINT "SupportTicketComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

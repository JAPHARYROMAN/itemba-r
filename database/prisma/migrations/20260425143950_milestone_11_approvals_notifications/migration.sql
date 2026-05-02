-- CreateEnum
CREATE TYPE "WorkflowScope" AS ENUM ('GROUP', 'COMPANY', 'DIVISION', 'BRANCH', 'BUSINESS_UNIT', 'GLOBAL');

-- CreateEnum
CREATE TYPE "WorkflowTriggerAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'POST', 'PAY', 'EXPORT', 'APPROVE', 'STATUS_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApproverType" AS ENUM ('USER', 'ROLE', 'PERMISSION', 'DEPARTMENT_MANAGER', 'COMPANY_MANAGER', 'GROUP_CONTROL', 'DIRECT_MANAGER', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ApprovalRequestActionType" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'POST', 'PAY', 'EXPORT', 'STATUS_CHANGE', 'OTHER');

-- CreateEnum
CREATE TYPE "ApprovalRequestStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ApprovalActionEnum" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED', 'COMMENTED', 'DELEGATED', 'RETURNED_FOR_CORRECTION');

-- CreateEnum
CREATE TYPE "DelegationStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_REQUIRED', 'APPROVAL_APPROVED', 'APPROVAL_REJECTED', 'APPROVAL_ESCALATED', 'TASK_REMINDER', 'COMPLIANCE_REMINDER', 'DOCUMENT_EXPIRY', 'LICENSE_EXPIRY', 'CONTRACT_EXPIRY', 'PAYMENT_DUE', 'LOAN_REPAYMENT_DUE', 'PAYROLL_ALERT', 'INVENTORY_ALERT', 'FUEL_ALERT', 'PARKING_ALERT', 'HOSPITALITY_ALERT', 'HR_ALERT', 'TAX_ALERT', 'SECURITY_ALERT', 'SYSTEM_ALERT', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('UNREAD', 'READ', 'ARCHIVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('DOCUMENT_EXPIRY', 'LICENSE_EXPIRY', 'CONTRACT_EXPIRY', 'LOAN_REPAYMENT_DUE', 'COMPLIANCE_DUE', 'TAX_FILING_DUE', 'PAYROLL_PENDING', 'LOW_STOCK', 'FUEL_LOW_STOCK', 'FUEL_VARIANCE', 'CASH_SHORTAGE', 'OVERDUE_RECEIVABLE', 'OVERDUE_PAYABLE', 'RENT_ARREARS', 'ROOM_OCCUPANCY', 'PARKING_OVERSTAY', 'VEHICLE_LICENSE_EXPIRY', 'EMPLOYEE_CONTRACT_EXPIRY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertRecipientType" AS ENUM ('USER', 'ROLE', 'PERMISSION', 'MANAGER', 'GROUP_CONTROL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY', 'MONTHLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "AlertEventStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('APPROVAL_FOLLOWUP', 'COMPLIANCE_TASK', 'DOCUMENT_TASK', 'FINANCE_TASK', 'HR_TASK', 'OPERATIONS_TASK', 'MAINTENANCE_TASK', 'CUSTOM');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'OVERDUE');

-- CreateEnum
CREATE TYPE "ControlType" AS ENUM ('MAKER_CHECKER', 'AMOUNT_LIMIT', 'SEGREGATION_OF_DUTIES', 'REQUIRED_DOCUMENT', 'REQUIRED_APPROVAL', 'BLOCK_NEGATIVE_STOCK', 'BLOCK_OVERPAYMENT', 'BLOCK_DUPLICATE_TRANSACTION', 'CASH_SHORTAGE_REVIEW', 'SENSITIVE_EXPORT_REVIEW', 'CUSTOM');

-- CreateEnum
CREATE TYPE "EnforcementLevel" AS ENUM ('WARNING', 'BLOCKING', 'APPROVAL_REQUIRED');

-- CreateTable
CREATE TABLE "approval_workflows" (
    "id" TEXT NOT NULL,
    "workflowCode" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT NOT NULL,
    "workflowScope" "WorkflowScope" NOT NULL DEFAULT 'GLOBAL',
    "triggerAction" "WorkflowTriggerAction" NOT NULL DEFAULT 'SUBMIT',
    "minAmount" DECIMAL(65,30),
    "maxAmount" DECIMAL(65,30),
    "currency" TEXT,
    "riskLevel" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "approval_workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_steps" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "stepOrder" INTEGER NOT NULL,
    "stepName" TEXT NOT NULL,
    "approverType" "ApproverType" NOT NULL DEFAULT 'ROLE',
    "approverUserId" TEXT,
    "approverRoleId" TEXT,
    "approverPermission" TEXT,
    "minRequiredApprovals" INTEGER NOT NULL DEFAULT 1,
    "allowSelfApproval" BOOLEAN NOT NULL DEFAULT false,
    "escalationHours" INTEGER,
    "escalationUserId" TEXT,
    "escalationRoleId" TEXT,
    "isFinalStep" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "approval_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_requests" (
    "id" TEXT NOT NULL,
    "approvalRequestNumber" TEXT NOT NULL,
    "workflowId" TEXT,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "actionType" "ApprovalRequestActionType" NOT NULL DEFAULT 'SUBMIT',
    "amount" DECIMAL(65,30),
    "currency" TEXT,
    "riskLevel" TEXT,
    "requestedById" TEXT NOT NULL,
    "currentStepOrder" INTEGER NOT NULL DEFAULT 1,
    "status" "ApprovalRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requestTitle" TEXT NOT NULL,
    "requestSummary" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "approval_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_actions" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "stepId" TEXT,
    "stepOrder" INTEGER NOT NULL,
    "actionById" TEXT NOT NULL,
    "action" "ApprovalActionEnum" NOT NULL DEFAULT 'SUBMITTED',
    "comment" TEXT,
    "reason" TEXT,
    "actionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_delegations" (
    "id" TEXT NOT NULL,
    "delegatorUserId" TEXT NOT NULL,
    "delegateUserId" TEXT NOT NULL,
    "companyId" TEXT,
    "entityType" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "status" "DelegationStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "approval_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_attachments" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approval_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "notificationNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "recipientUserId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "notificationType" "NotificationType" NOT NULL DEFAULT 'OTHER',
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "NotificationStatus" NOT NULL DEFAULT 'UNREAD',
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "actionUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_rules" (
    "id" TEXT NOT NULL,
    "alertRuleCode" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "alertType" "AlertType" NOT NULL DEFAULT 'CUSTOM',
    "entityType" TEXT,
    "condition" JSONB NOT NULL,
    "daysBefore" INTEGER,
    "thresholdAmount" DECIMAL(65,30),
    "thresholdQuantity" DECIMAL(65,30),
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "recipientType" "AlertRecipientType" NOT NULL DEFAULT 'ROLE',
    "recipientUserId" TEXT,
    "recipientRoleId" TEXT,
    "recipientPermission" TEXT,
    "frequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "alertEventNumber" TEXT NOT NULL,
    "alertRuleId" TEXT,
    "companyId" TEXT,
    "alertType" "AlertType" NOT NULL DEFAULT 'CUSTOM',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "AlertEventStatus" NOT NULL DEFAULT 'OPEN',
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "dismissedById" TEXT,
    "dismissedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "taskNumber" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assignedToId" TEXT,
    "assignedById" TEXT,
    "taskType" "TaskType" NOT NULL DEFAULT 'CUSTOM',
    "priority" "TaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "dueDate" TIMESTAMP(3),
    "linkedEntityType" TEXT,
    "linkedEntityId" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "internal_control_rules" (
    "id" TEXT NOT NULL,
    "controlCode" TEXT NOT NULL,
    "companyId" TEXT,
    "divisionId" TEXT,
    "branchId" TEXT,
    "licensedBusinessUnitId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "controlType" "ControlType" NOT NULL DEFAULT 'CUSTOM',
    "entityType" TEXT,
    "condition" JSONB,
    "enforcementLevel" "EnforcementLevel" NOT NULL DEFAULT 'WARNING',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "internal_control_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "approval_workflows_entityType_triggerAction_isActive_idx" ON "approval_workflows"("entityType", "triggerAction", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "approval_workflows_workflowCode_companyId_key" ON "approval_workflows"("workflowCode", "companyId");

-- CreateIndex
CREATE INDEX "approval_steps_workflowId_stepOrder_idx" ON "approval_steps"("workflowId", "stepOrder");

-- CreateIndex
CREATE UNIQUE INDEX "approval_requests_approvalRequestNumber_key" ON "approval_requests"("approvalRequestNumber");

-- CreateIndex
CREATE INDEX "approval_requests_entityType_entityId_idx" ON "approval_requests"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "approval_requests_status_companyId_idx" ON "approval_requests"("status", "companyId");

-- CreateIndex
CREATE INDEX "approval_requests_requestedById_idx" ON "approval_requests"("requestedById");

-- CreateIndex
CREATE INDEX "approval_actions_approvalRequestId_idx" ON "approval_actions"("approvalRequestId");

-- CreateIndex
CREATE INDEX "approval_delegations_delegatorUserId_status_idx" ON "approval_delegations"("delegatorUserId", "status");

-- CreateIndex
CREATE INDEX "approval_delegations_delegateUserId_status_idx" ON "approval_delegations"("delegateUserId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_notificationNumber_key" ON "notifications"("notificationNumber");

-- CreateIndex
CREATE INDEX "notifications_recipientUserId_status_idx" ON "notifications"("recipientUserId", "status");

-- CreateIndex
CREATE INDEX "notifications_companyId_idx" ON "notifications"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "alert_rules_alertRuleCode_key" ON "alert_rules"("alertRuleCode");

-- CreateIndex
CREATE UNIQUE INDEX "alert_events_alertEventNumber_key" ON "alert_events"("alertEventNumber");

-- CreateIndex
CREATE INDEX "alert_events_status_alertType_idx" ON "alert_events"("status", "alertType");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_taskNumber_key" ON "tasks"("taskNumber");

-- CreateIndex
CREATE INDEX "tasks_assignedToId_status_idx" ON "tasks"("assignedToId", "status");

-- CreateIndex
CREATE INDEX "tasks_companyId_status_idx" ON "tasks"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "internal_control_rules_controlCode_key" ON "internal_control_rules"("controlCode");

-- CreateIndex
CREATE INDEX "internal_control_rules_entityType_isActive_idx" ON "internal_control_rules"("entityType", "isActive");

-- AddForeignKey
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "divisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_licensedBusinessUnitId_fkey" FOREIGN KEY ("licensedBusinessUnitId") REFERENCES "licensed_business_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_workflows" ADD CONSTRAINT "approval_workflows_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "approval_workflows"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_approverRoleId_fkey" FOREIGN KEY ("approverRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_steps" ADD CONSTRAINT "approval_steps_escalationUserId_fkey" FOREIGN KEY ("escalationUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "approval_workflows"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "approval_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_actions" ADD CONSTRAINT "approval_actions_actionById_fkey" FOREIGN KEY ("actionById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegatorUserId_fkey" FOREIGN KEY ("delegatorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_delegateUserId_fkey" FOREIGN KEY ("delegateUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_delegations" ADD CONSTRAINT "approval_delegations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_attachments" ADD CONSTRAINT "approval_attachments_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_attachments" ADD CONSTRAINT "approval_attachments_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_recipientRoleId_fkey" FOREIGN KEY ("recipientRoleId") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_rules" ADD CONSTRAINT "alert_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alertRuleId_fkey" FOREIGN KEY ("alertRuleId") REFERENCES "alert_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_dismissedById_fkey" FOREIGN KEY ("dismissedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_control_rules" ADD CONSTRAINT "internal_control_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "internal_control_rules" ADD CONSTRAINT "internal_control_rules_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

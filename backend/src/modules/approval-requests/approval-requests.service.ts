import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  ApprovalRequestStatus,
  DataQualityIssueSeverity,
  DataQualityIssueStatus,
  DelegationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { applyCompanyScopeWhere } from '../../common/services';

type ReadinessStatus = 'READY' | 'WARNING' | 'CRITICAL';

export interface ApprovalWorkflowReadinessCheck {
  key: string;
  title: string;
  status: ReadinessStatus;
  score: number;
  message: string;
  details: Record<string, number | string>;
}

@Injectable()
export class ApprovalRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, entityType, status, requestedById } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (entityType) where.entityType = entityType;
    if (status) where.status = status;
    if (requestedById) where.requestedById = requestedById;
    const [data, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          workflow: { select: { id: true, name: true } },
        },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async getReadiness(user: any, query: any = {}) {
    const { companyId } = query;
    const workflowWhere: any = { deletedAt: null };
    const requestWhere: any = { deletedAt: null };
    const dataQualityWhere: any = {};
    const delegationWhere: any = { deletedAt: null };
    applyCompanyScopeWhere(workflowWhere, user, companyId);
    applyCompanyScopeWhere(requestWhere, user, companyId);
    applyCompanyScopeWhere(dataQualityWhere, user, companyId);
    applyCompanyScopeWhere(delegationWhere, user, companyId);

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      activeWorkflows,
      inactiveWorkflows,
      workflowsWithoutSteps,
      activeSteps,
      totalRequests,
      pendingRequests,
      overduePendingRequests,
      approvedLast30Days,
      rejectedLast30Days,
      escalatedRequests,
      actionTrailEntries,
      attachmentCount,
      activeDelegations,
      openDataQualityIssues,
      highDataQualityIssues,
      criticalDataQualityIssues,
      staleOpenDataQualityIssues,
      resolvedDataQualityIssues,
      requestStatusRows,
      dataQualityStatusRows,
    ] = await Promise.all([
      this.prisma.approvalWorkflow.count({ where: { ...workflowWhere, isActive: true } }),
      this.prisma.approvalWorkflow.count({ where: { ...workflowWhere, isActive: false } }),
      this.prisma.approvalWorkflow.count({
        where: { ...workflowWhere, isActive: true, steps: { none: { deletedAt: null } } },
      }),
      this.prisma.approvalStep.count({
        where: { deletedAt: null, workflow: { ...workflowWhere, isActive: true } },
      }),
      this.prisma.approvalRequest.count({ where: requestWhere }),
      this.prisma.approvalRequest.count({
        where: { ...requestWhere, status: ApprovalRequestStatus.PENDING },
      }),
      this.prisma.approvalRequest.count({
        where: {
          ...requestWhere,
          status: ApprovalRequestStatus.PENDING,
          dueAt: { lt: now },
        },
      }),
      this.prisma.approvalRequest.count({
        where: {
          ...requestWhere,
          status: ApprovalRequestStatus.APPROVED,
          approvedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.approvalRequest.count({
        where: {
          ...requestWhere,
          status: ApprovalRequestStatus.REJECTED,
          rejectedAt: { gte: thirtyDaysAgo },
        },
      }),
      this.prisma.approvalRequest.count({
        where: { ...requestWhere, status: ApprovalRequestStatus.ESCALATED },
      }),
      this.prisma.approvalAction.count({
        where: { approvalRequest: requestWhere },
      }),
      this.prisma.approvalAttachment.count({
        where: { approvalRequest: requestWhere },
      }),
      this.prisma.approvalDelegation.count({
        where: {
          ...delegationWhere,
          status: DelegationStatus.ACTIVE,
          startDate: { lte: now },
          endDate: { gte: now },
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...dataQualityWhere,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...dataQualityWhere,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
          severity: DataQualityIssueSeverity.HIGH,
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...dataQualityWhere,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
          severity: DataQualityIssueSeverity.CRITICAL,
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...dataQualityWhere,
          status: { in: [DataQualityIssueStatus.OPEN, DataQualityIssueStatus.ACKNOWLEDGED] },
          detectedAt: { lt: fourteenDaysAgo },
        },
      }),
      this.prisma.dataQualityIssue.count({
        where: {
          ...dataQualityWhere,
          status: DataQualityIssueStatus.RESOLVED,
          resolvedAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.approvalRequest.groupBy({
        by: ['status'],
        where: requestWhere,
        _count: { _all: true },
      }),
      this.prisma.dataQualityIssue.groupBy({
        by: ['status'],
        where: dataQualityWhere,
        _count: { _all: true },
      }),
    ]);

    const checks: ApprovalWorkflowReadinessCheck[] = [
      this.buildWorkflowCoverageCheck(
        activeWorkflows,
        inactiveWorkflows,
        workflowsWithoutSteps,
        activeSteps,
      ),
      this.buildApprovalSlaCheck(
        totalRequests,
        pendingRequests,
        overduePendingRequests,
        escalatedRequests,
      ),
      this.buildActionTrailCheck(totalRequests, actionTrailEntries, attachmentCount),
      this.buildDataQualityRiskCheck(
        openDataQualityIssues,
        highDataQualityIssues,
        criticalDataQualityIssues,
      ),
      this.buildDataQualityLifecycleCheck(staleOpenDataQualityIssues, resolvedDataQualityIssues),
      this.buildDelegationContinuityCheck(
        activeDelegations,
        approvedLast30Days,
        rejectedLast30Days,
      ),
    ];

    const score = averageScore(checks);
    const status: ReadinessStatus = checks.some((check) => check.status === 'CRITICAL')
      ? 'CRITICAL'
      : score >= 90
        ? 'READY'
        : 'WARNING';

    return {
      score,
      target: 90,
      status,
      maturity:
        status === 'READY'
          ? 'Approvals, workflow, and data-quality controls are above the 90% threshold'
          : status === 'WARNING'
            ? 'Workflow controls are usable with items requiring owner review'
            : 'Approval or data-quality blockers require action before sign-off',
      updatedAt: new Date().toISOString(),
      indicators: {
        activeWorkflows,
        inactiveWorkflows,
        workflowsWithoutSteps,
        activeSteps,
        totalRequests,
        pendingRequests,
        overduePendingRequests,
        approvedLast30Days,
        rejectedLast30Days,
        escalatedRequests,
        actionTrailEntries,
        attachmentCount,
        activeDelegations,
        openDataQualityIssues,
        highDataQualityIssues,
        criticalDataQualityIssues,
        staleOpenDataQualityIssues,
        resolvedDataQualityIssues,
      },
      requestStatusBreakdown: countBy(requestStatusRows as GroupCount[], 'status'),
      dataQualityStatusBreakdown: countBy(dataQualityStatusRows as GroupCount[], 'status'),
      checks,
    };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.approvalRequest.findFirst({
      where: { id, deletedAt: null },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        workflow: {
          include: { steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } } },
        },
        actions: {
          orderBy: { createdAt: 'asc' },
          include: { actionBy: { select: { id: true, fullName: true, email: true } } },
        },
      },
    });
    if (!record) throw new NotFoundException('Approval request not found');
    return record;
  }

  async findPendingForMe(user: any, query: any) {
    const { page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { status: 'PENDING', deletedAt: null };
    const [data, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          requestedBy: { select: { id: true, fullName: true, email: true } },
          workflow: { select: { id: true, name: true } },
        },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findSubmittedByMe(user: any, query: any) {
    const { page = 1, limit = 20, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { requestedById: user.id, deletedAt: null };
    if (status) where.status = status;
    const [data, total] = await Promise.all([
      this.prisma.approvalRequest.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { workflow: { select: { id: true, name: true } } },
      }),
      this.prisma.approvalRequest.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async create(dto: CreateApprovalRequestDto, user: any) {
    const approvalRequestNumber = `REQ-${Date.now()}`;
    const record = await this.prisma.approvalRequest.create({
      data: {
        approvalRequestNumber,
        workflowId: dto.workflowId,
        companyId: dto.companyId,
        entityType: dto.entityType,
        entityId: dto.entityId,
        requestTitle: dto.requestTitle,
        requestSummary: dto.requestSummary,
        actionType: dto.actionType,
        notes: dto.notes,
        status: 'DRAFT',
        requestedById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'ApprovalRequest',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async submit(id: string, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT requests can be submitted');
    if (record.requestedById !== user.id)
      throw new ForbiddenException('Only the requester can submit this request');
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'PENDING', submittedAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: {
        approvalRequestId: id,
        action: 'SUBMITTED',
        actionById: user.id,
        stepOrder: 0,
        comment: 'Request submitted for approval',
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalRequest',
      entityId: id,
      newValue: { status: 'PENDING' },
    });
    return updated;
  }

  async approve(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'PENDING')
      throw new BadRequestException('Only PENDING requests can be approved');
    if (record.requestedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: you cannot approve a request you submitted. Another approver must act.',
      );
    }
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'APPROVED', approvedAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: {
        approvalRequestId: id,
        action: 'APPROVED',
        actionById: user.id,
        stepOrder: record.currentStepOrder,
        comment: dto.comment,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalRequest',
      entityId: id,
      newValue: { status: 'APPROVED' },
    });
    return updated;
  }

  async reject(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    if (record.status !== 'PENDING')
      throw new BadRequestException('Only PENDING requests can be rejected');
    if (record.requestedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: you cannot reject a request you submitted. Another approver must act.',
      );
    }
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: {
        approvalRequestId: id,
        action: 'REJECTED',
        actionById: user.id,
        stepOrder: record.currentStepOrder,
        reason: dto.reason,
        comment: dto.comment,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalRequest',
      entityId: id,
      newValue: { status: 'REJECTED' },
    });
    return updated;
  }

  async cancel(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    if (!['DRAFT', 'PENDING'].includes(record.status as string))
      throw new BadRequestException('Cannot cancel this request');
    const updated = await this.prisma.approvalRequest.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    await this.prisma.approvalAction.create({
      data: {
        approvalRequestId: id,
        action: 'CANCELLED',
        actionById: user.id,
        stepOrder: record.currentStepOrder,
        reason: dto.reason,
        comment: dto.comment,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalRequest',
      entityId: id,
      newValue: { status: 'CANCELLED' },
    });
    return updated;
  }

  async addComment(id: string, dto: ApprovalActionDto, user: any) {
    const record = await this.findOne(id, user);
    const action = await this.prisma.approvalAction.create({
      data: {
        approvalRequestId: id,
        action: 'COMMENTED',
        actionById: user.id,
        stepOrder: record.currentStepOrder,
        comment: dto.comment,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalRequest',
      entityId: id,
      newValue: { comment: dto.comment },
    });
    return action;
  }

  private buildWorkflowCoverageCheck(
    activeWorkflows: number,
    inactiveWorkflows: number,
    workflowsWithoutSteps: number,
    activeSteps: number,
  ): ApprovalWorkflowReadinessCheck {
    const status: ReadinessStatus =
      workflowsWithoutSteps > 0 ? 'CRITICAL' : activeWorkflows === 0 ? 'WARNING' : 'READY';
    return {
      key: 'workflow-coverage',
      title: 'Workflow coverage and approver steps',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 88 : 50,
      message:
        status === 'READY'
          ? 'Active approval workflows have executable approver steps.'
          : status === 'WARNING'
            ? 'No active approval workflows are configured yet.'
            : 'One or more active approval workflows have no approver steps.',
      details: { activeWorkflows, inactiveWorkflows, workflowsWithoutSteps, activeSteps },
    };
  }

  private buildApprovalSlaCheck(
    totalRequests: number,
    pendingRequests: number,
    overduePendingRequests: number,
    escalatedRequests: number,
  ): ApprovalWorkflowReadinessCheck {
    const status: ReadinessStatus =
      overduePendingRequests > 5 || escalatedRequests > 0
        ? 'CRITICAL'
        : overduePendingRequests > 0
          ? 'WARNING'
          : 'READY';
    return {
      key: 'approval-sla',
      title: 'Approval queue SLA',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 55,
      message:
        status === 'READY'
          ? 'Pending approvals have no overdue SLA blockers.'
          : status === 'WARNING'
            ? 'Some approval requests are past due and need owner follow-up.'
            : 'Escalated or heavily overdue approval queues require immediate action.',
      details: { totalRequests, pendingRequests, overduePendingRequests, escalatedRequests },
    };
  }

  private buildActionTrailCheck(
    totalRequests: number,
    actionTrailEntries: number,
    attachmentCount: number,
  ): ApprovalWorkflowReadinessCheck {
    const status: ReadinessStatus =
      totalRequests > 0 && actionTrailEntries === 0 ? 'CRITICAL' : 'READY';
    return {
      key: 'audit-evidence',
      title: 'Approval audit evidence',
      status,
      score: status === 'READY' ? 100 : 50,
      message:
        status === 'READY'
          ? 'Approval actions and attachments are available for workflow evidence.'
          : 'Approval requests exist without action-trail evidence.',
      details: { totalRequests, actionTrailEntries, attachmentCount },
    };
  }

  private buildDataQualityRiskCheck(
    openDataQualityIssues: number,
    highDataQualityIssues: number,
    criticalDataQualityIssues: number,
  ): ApprovalWorkflowReadinessCheck {
    const status: ReadinessStatus =
      criticalDataQualityIssues > 0 ? 'CRITICAL' : highDataQualityIssues > 0 ? 'WARNING' : 'READY';
    return {
      key: 'data-quality-risk',
      title: 'Data-quality risk gate',
      status,
      score: status === 'READY' ? 100 : status === 'WARNING' ? 90 : 45,
      message:
        status === 'READY'
          ? 'No open critical or high data-quality issues are blocking workflow trust.'
          : status === 'WARNING'
            ? 'High severity data-quality issues should be acknowledged or resolved.'
            : 'Critical data-quality issues are open and must be handled before sign-off.',
      details: { openDataQualityIssues, highDataQualityIssues, criticalDataQualityIssues },
    };
  }

  private buildDataQualityLifecycleCheck(
    staleOpenDataQualityIssues: number,
    resolvedDataQualityIssues: number,
  ): ApprovalWorkflowReadinessCheck {
    const status: ReadinessStatus = staleOpenDataQualityIssues > 0 ? 'WARNING' : 'READY';
    return {
      key: 'data-quality-lifecycle',
      title: 'Data-quality resolution lifecycle',
      status,
      score: status === 'READY' ? 100 : 90,
      message:
        status === 'READY'
          ? 'Open data-quality issues are within the active review window.'
          : 'Some open data-quality issues have been stale for more than 14 days.',
      details: { staleOpenDataQualityIssues, resolvedDataQualityIssues },
    };
  }

  private buildDelegationContinuityCheck(
    activeDelegations: number,
    approvedLast30Days: number,
    rejectedLast30Days: number,
  ): ApprovalWorkflowReadinessCheck {
    return {
      key: 'workflow-continuity',
      title: 'Delegation and decision continuity',
      status: 'READY',
      score: 100,
      message:
        'Approval decisions, maker-checker actions, and active delegations are visible for continuity.',
      details: { activeDelegations, approvedLast30Days, rejectedLast30Days },
    };
  }
}

type GroupCount = { _count: { _all: number } } & Record<string, unknown>;

function averageScore(checks: ApprovalWorkflowReadinessCheck[]) {
  if (checks.length === 0) return 0;
  return Math.round(checks.reduce((sum, check) => sum + check.score, 0) / checks.length);
}

function countBy(rows: GroupCount[], key: string, emptyLabel = 'UNKNOWN') {
  return rows.reduce<Record<string, number>>((acc, row) => {
    const value = row[key];
    const label =
      value === null || value === undefined || value === '' ? emptyLabel : String(value);
    acc[label] = row._count._all;
    return acc;
  }, {});
}

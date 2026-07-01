import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import {
  AccessLevel,
  ApproverType,
  ApprovalRequestStatus,
  DataQualityIssueSeverity,
  DataQualityIssueStatus,
  DelegationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalRequestDto } from './dto/create-approval-request.dto';
import { ApprovalActionDto } from './dto/approval-action.dto';
import { CompanyScopeService, applyCompanyScopeWhere } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

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
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(user: AuthUser, query: any) {
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

  async findOne(id: string, user: AuthUser) {
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
    // ITMB: company-scope reads. Assert the caller can reach the request's
    // company before returning it, mirroring the receivables canonical pattern
    // (fetch by id, then assertCanAccessCompany). This also correctly handles
    // group-level (null companyId) requests, which only group-scoped users may
    // reach. Throw NotFound rather than Forbidden so a foreign-tenant id does
    // not leak the record's existence.
    try {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, AccessLevel.READ);
    } catch {
      throw new NotFoundException('Approval request not found');
    }
    return record;
  }

  async findPendingForMe(user: AuthUser, query: any) {
    const { page = 1, limit = 20, companyId } = query;
    const take = Number(limit);
    const skip = (Number(page) - 1) * take;

    // ITMB (CRITICAL): this queue previously returned every PENDING request in
    // the database with no company scope and no user filter — a cross-company
    // leak and a broken "awaiting my action" queue. Scope to the caller's
    // accessible companies, exclude the caller's own requests (maker-checker),
    // then keep only requests for which the caller is an eligible approver of
    // the current step.
    const where: any = { status: ApprovalRequestStatus.PENDING, deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    where.requestedById = { not: user.id };

    // Resolve the caller's role ids once so ROLE-based steps can be evaluated
    // (AuthUser only carries role names / permission codes, not role ids).
    const roleIds = await this.getUserRoleIds(user);
    const delegatorIds = await this.getActiveDelegatorIdsFor(user);

    // Fetch the company-scoped candidate set with the current step config so we
    // can filter by approver eligibility in-memory. We over-fetch relative to
    // the page window because eligibility cannot be expressed as a single
    // Prisma where-clause across the polymorphic approver model.
    const candidates = await this.prisma.approvalRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        requestedBy: { select: { id: true, fullName: true, email: true } },
        workflow: {
          select: {
            id: true,
            name: true,
            steps: {
              where: { deletedAt: null },
              orderBy: { stepOrder: 'asc' },
              select: {
                stepOrder: true,
                approverType: true,
                approverUserId: true,
                approverRoleId: true,
                approverPermission: true,
                allowSelfApproval: true,
              },
            },
          },
        },
      },
    });

    const eligible = candidates.filter((req) =>
      this.isEligibleApprover(req as any, user, roleIds, delegatorIds),
    );

    const total = eligible.length;
    const data = eligible.slice(skip, skip + take).map((req) => {
      // Trim the step config from the payload — it was only needed for filtering
      // and mirrors the previous response shape.
      const { workflow, ...rest } = req as any;
      return {
        ...rest,
        workflow: workflow ? { id: workflow.id, name: workflow.name } : null,
      };
    });

    return { data, total, page: Number(page), limit: take };
  }

  async findSubmittedByMe(user: AuthUser, query: any) {
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
    // ITMB: never trust a client-supplied companyId for authorization. Validate
    // it against the caller's access before stamping it on the new request
    // (a null companyId is a group-level request and requires group scope).
    await this.companyScope.assertCanAccessCompany(user, dto.companyId ?? null, AccessLevel.WRITE);
    const approvalRequestNumber = `REQ-${Date.now()}`;
    // Whitelist explicit fields — never spread the raw DTO into prisma.create.
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

  async submit(id: string, user: AuthUser) {
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

  async approve(id: string, dto: ApprovalActionDto, user: AuthUser) {
    // findOne now enforces company scope, so a cross-tenant id 404s here.
    const record = await this.findOne(id, user);
    if (record.status !== 'PENDING')
      throw new BadRequestException('Only PENDING requests can be approved');
    if (record.requestedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: you cannot approve a request you submitted. Another approver must act.',
      );
    }
    // ITMB (HIGH): enforce the designated step approver / role / permission /
    // delegation. Previously any holder of the coarse approval_requests.approve
    // permission could approve any request, defeating segregation of duties.
    await this.assertEligibleApprover(record, user);
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

  async reject(id: string, dto: ApprovalActionDto, user: AuthUser) {
    // findOne now enforces company scope, so a cross-tenant id 404s here.
    const record = await this.findOne(id, user);
    if (record.status !== 'PENDING')
      throw new BadRequestException('Only PENDING requests can be rejected');
    if (record.requestedById === user.id) {
      throw new BadRequestException(
        'Maker-checker: you cannot reject a request you submitted. Another approver must act.',
      );
    }
    // ITMB (HIGH): rejecting is a decision on the current step; require the same
    // step-approver eligibility as approve so a non-approver cannot kill a
    // request they merely hold the coarse permission for.
    await this.assertEligibleApprover(record, user);
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

  async cancel(id: string, dto: ApprovalActionDto, user: AuthUser) {
    // findOne now enforces company scope, so a cross-tenant id 404s here.
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

  async addComment(id: string, dto: ApprovalActionDto, user: AuthUser) {
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

  /**
   * ITMB (HIGH): resolve whether `user` is a valid approver for the request's
   * CURRENT step and throw ForbiddenException otherwise.
   *
   * Scope of this wave: honor the per-step designated approver (USER / ROLE /
   * PERMISSION), allowSelfApproval, and active ApprovalDelegation (a delegate
   * may act for a designated USER approver). Multi-step advancement,
   * minRequiredApprovals counting, and the other approver types
   * (DEPARTMENT_MANAGER / COMPANY_MANAGER / GROUP_CONTROL / DIRECT_MANAGER /
   * CUSTOM) are intentionally DEFERRED to a later wave (see class notes). For a
   * request with no workflow or no matching step, we fall back to the coarse
   * approval_requests.approve/reject permission already enforced by the guard
   * (do NOT over-restrict legitimate approvals when no step is configured).
   */
  private async assertEligibleApprover(record: any, user: AuthUser) {
    const roleIds = await this.getUserRoleIds(user);
    const delegatorIds = await this.getActiveDelegatorIdsFor(user);
    if (!this.isEligibleApprover(record, user, roleIds, delegatorIds)) {
      throw new ForbiddenException(
        'You are not a designated approver for the current step of this request.',
      );
    }
  }

  private isEligibleApprover(
    record: {
      requestedById: string;
      currentStepOrder: number;
      workflow?: {
        steps?: Array<{
          stepOrder: number;
          approverType: ApproverType;
          approverUserId: string | null;
          approverRoleId: string | null;
          approverPermission: string | null;
          allowSelfApproval: boolean;
        }>;
      } | null;
    },
    user: AuthUser,
    roleIds: Set<string>,
    delegatorIds: Set<string>,
  ): boolean {
    const steps = record.workflow?.steps ?? [];
    // No workflow / no step config -> fall back to the coarse permission the
    // controller guard already enforced.
    if (steps.length === 0) return true;

    const step =
      steps.find((s) => s.stepOrder === record.currentStepOrder) ??
      // If currentStepOrder does not line up (legacy data), use the lowest step.
      steps[0];
    if (!step) return true;

    // Self-approval guard: a designated user may only self-approve when the step
    // explicitly allows it.
    const isRequester = record.requestedById === user.id;

    switch (step.approverType) {
      case ApproverType.USER: {
        if (!step.approverUserId) return true; // misconfigured -> don't block
        if (step.approverUserId === user.id) {
          return !isRequester || step.allowSelfApproval;
        }
        // Active delegation: the caller may act on behalf of the designated user.
        return delegatorIds.has(step.approverUserId);
      }
      case ApproverType.ROLE: {
        if (!step.approverRoleId) return true; // misconfigured -> don't block
        if (!roleIds.has(step.approverRoleId)) return false;
        return !isRequester || step.allowSelfApproval;
      }
      case ApproverType.PERMISSION: {
        if (!step.approverPermission) return true; // misconfigured -> don't block
        if (!(user.permissions ?? []).includes(step.approverPermission)) return false;
        return !isRequester || step.allowSelfApproval;
      }
      default:
        // DEFERRED approver types (DEPARTMENT_MANAGER/COMPANY_MANAGER/
        // GROUP_CONTROL/DIRECT_MANAGER/CUSTOM): not resolvable in this wave.
        // Fall back to the coarse permission guard rather than block legitimate
        // approvals.
        return true;
    }
  }

  private async getUserRoleIds(user: AuthUser): Promise<Set<string>> {
    const rows = await this.prisma.userRole.findMany({
      where: { userId: user.id },
      select: { roleId: true },
    });
    return new Set(rows.map((r) => r.roleId));
  }

  /**
   * Ids of users who have delegated their approval authority TO `user` under an
   * active, in-window, non-deleted delegation. A delegate may then act on steps
   * that designate one of these users as the approver.
   */
  private async getActiveDelegatorIdsFor(user: AuthUser): Promise<Set<string>> {
    const now = new Date();
    const rows = await this.prisma.approvalDelegation.findMany({
      where: {
        delegateUserId: user.id,
        status: DelegationStatus.ACTIVE,
        startDate: { lte: now },
        endDate: { gte: now },
        deletedAt: null,
      },
      select: { delegatorUserId: true },
    });
    return new Set(rows.map((r) => r.delegatorUserId));
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

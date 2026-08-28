import { Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { assertCanAccessCompanyFromUser, companyWhereForUser } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalStepDto } from './dto/create-approval-step.dto';
import { UpdateApprovalStepDto } from './dto/update-approval-step.dto';

@Injectable()
export class ApprovalStepsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  /**
   * ApprovalStep has no companyId column, so tenant isolation is enforced
   * through the parent ApprovalWorkflow relation (which is company-scoped).
   * Returns a nested relation filter suitable for spreading into a step where
   * clause, or null when no scoping should be applied (e.g. no user context).
   */
  private workflowScopeFilter(user: AuthUser | undefined) {
    if (!user) return null;
    return { workflow: { is: companyWhereForUser(user) } };
  }

  async findByWorkflow(workflowId: string, user: AuthUser) {
    const scope = this.workflowScopeFilter(user);
    const steps = await this.prisma.approvalStep.findMany({
      where: { workflowId, ...(scope ?? {}) },
      orderBy: { stepOrder: 'asc' },
    });
    return { data: steps, total: steps.length };
  }

  async findOne(id: string, user: AuthUser) {
    const scope = this.workflowScopeFilter(user);
    const record = await this.prisma.approvalStep.findFirst({
      where: { id, ...(scope ?? {}) },
    });
    if (!record) throw new NotFoundException('Approval step not found');
    return record;
  }

  async create(workflowId: string, dto: CreateApprovalStepDto, user: AuthUser) {
    const scope = this.workflowScopeFilter(user);
    const workflow = await this.prisma.approvalWorkflow.findFirst({
      where: scope ? { id: workflowId, ...companyWhereForUser(user) } : { id: workflowId },
    });
    if (!workflow) throw new NotFoundException('Approval workflow not found');
    const record = await this.prisma.approvalStep.create({
      data: { ...dto, workflowId } as any,
    });
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ApprovalStep', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: UpdateApprovalStepDto, user: AuthUser) {
    await this.findOne(id, user);
    const record = await this.prisma.approvalStep.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalStep', entityId: id, newValue: dto as any });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    const workflow = await this.prisma.approvalWorkflow.findUniqueOrThrow({
      where: { id: existing.workflowId },
      select: { companyId: true },
    });
    assertCanAccessCompanyFromUser(user, workflow.companyId, AccessLevel.WRITE);
    await this.prisma.approvalStep.delete({ where: { id } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'ApprovalStep',
      entityId: id,
      companyId: workflow.companyId,
      oldValue: existing as unknown as Record<string, unknown>,
    });
    return { message: 'Approval step deleted' };
  }
}

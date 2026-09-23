import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalWorkflowDto } from './dto/create-approval-workflow.dto';
import { UpdateApprovalWorkflowDto } from './dto/update-approval-workflow.dto';
import {
  applyCompanyScopeWhere,
  assertCanAccessCompanyFromUser,
  isGroupScopedUser,
} from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { AccessLevel } from '@prisma/client';

@Injectable()
export class ApprovalWorkflowsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditLogsService,
  ) {}

  async findAll(user: AuthUser, query: any) {
    const { page = 1, limit = 20, companyId, entityType, isActive, search } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    const scope = applyCompanyScopeWhere({}, user, companyId);
    where.AND = [
      !companyId && isGroupScopedUser(user) ? { OR: [scope, { companyId: null }] } : scope,
    ];
    if (entityType) where.entityType = entityType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (search?.trim())
      where.OR = ['name', 'workflowCode'].map((field) => ({
        [field]: { contains: search.trim(), mode: 'insensitive' },
      }));
    const [data, total] = await Promise.all([
      this.prisma.approvalWorkflow.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          company: { select: { id: true, name: true, code: true } },
          steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } },
        },
      }),
      this.prisma.approvalWorkflow.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser) {
    const record = await this.prisma.approvalWorkflow.findFirst({
      where: { id, deletedAt: null },
      include: { steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } } },
    });
    if (!record) throw new NotFoundException('Approval workflow not found');
    assertCanAccessCompanyFromUser(user, record.companyId);
    return record;
  }

  async create(dto: CreateApprovalWorkflowDto, user: AuthUser) {
    assertCanAccessCompanyFromUser(user, dto.companyId, AccessLevel.WRITE);
    const workflowCode = dto.workflowCode ?? `WF-${Date.now()}`;
    const record = await this.prisma.approvalWorkflow.create({
      data: {
        workflowCode,
        name: dto.name,
        entityType: dto.entityType,
        description: dto.description,
        workflowScope: dto.workflowScope,
        triggerAction: dto.triggerAction,
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        licensedBusinessUnitId: dto.licensedBusinessUnitId,
        isActive: dto.isActive ?? true,
        priority: dto.priority ?? 0,
        createdById: user.id,
      },
    });
    await this.audit.log({
      userId: user.id,
      action: 'CREATE',
      entityType: 'ApprovalWorkflow',
      entityId: record.id,
      newValue: dto as any,
    });
    return record;
  }

  async update(id: string, dto: UpdateApprovalWorkflowDto, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    const record = await this.prisma.approvalWorkflow.update({ where: { id }, data: dto as any });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalWorkflow',
      entityId: id,
      newValue: dto as any,
    });
    return record;
  }

  async activate(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    const record = await this.prisma.approvalWorkflow.update({
      where: { id },
      data: { isActive: true },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalWorkflow',
      entityId: id,
      newValue: { isActive: true },
    });
    return record;
  }

  async deactivate(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    const record = await this.prisma.approvalWorkflow.update({
      where: { id },
      data: { isActive: false },
    });
    await this.audit.log({
      userId: user.id,
      action: 'UPDATE',
      entityType: 'ApprovalWorkflow',
      entityId: id,
      newValue: { isActive: false },
    });
    return record;
  }

  async remove(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user);
    assertCanAccessCompanyFromUser(user, existing.companyId, AccessLevel.WRITE);
    await this.prisma.approvalWorkflow.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({
      userId: user.id,
      action: 'DELETE',
      entityType: 'ApprovalWorkflow',
      entityId: id,
      newValue: {},
    });
    return { message: 'Approval workflow deleted' };
  }
}

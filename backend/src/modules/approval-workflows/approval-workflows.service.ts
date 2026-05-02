import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CreateApprovalWorkflowDto } from './dto/create-approval-workflow.dto';
import { UpdateApprovalWorkflowDto } from './dto/update-approval-workflow.dto';

@Injectable()
export class ApprovalWorkflowsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditLogsService) {}

  async findAll(user: any, query: any) {
    const { page = 1, limit = 20, companyId, entityType, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    else if (user.companyId) where.companyId = user.companyId;
    if (entityType) where.entityType = entityType;
    if (isActive !== undefined) where.isActive = isActive === 'true';
    const [data, total] = await Promise.all([
      this.prisma.approvalWorkflow.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } } },
      }),
      this.prisma.approvalWorkflow.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: any) {
    const record = await this.prisma.approvalWorkflow.findFirst({
      where: { id, deletedAt: null },
      include: { steps: { where: { deletedAt: null }, orderBy: { stepOrder: 'asc' } } },
    });
    if (!record) throw new NotFoundException('Approval workflow not found');
    return record;
  }

  async create(dto: CreateApprovalWorkflowDto, user: any) {
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
    await this.audit.log({ userId: user.id, action: 'CREATE', entityType: 'ApprovalWorkflow', entityId: record.id, newValue: dto as any });
    return record;
  }

  async update(id: string, dto: UpdateApprovalWorkflowDto, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.approvalWorkflow.update({ where: { id }, data: dto as any });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalWorkflow', entityId: id, newValue: dto as any });
    return record;
  }

  async activate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.approvalWorkflow.update({ where: { id }, data: { isActive: true } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalWorkflow', entityId: id, newValue: { isActive: true } });
    return record;
  }

  async deactivate(id: string, user: any) {
    await this.findOne(id, user);
    const record = await this.prisma.approvalWorkflow.update({ where: { id }, data: { isActive: false } });
    await this.audit.log({ userId: user.id, action: 'UPDATE', entityType: 'ApprovalWorkflow', entityId: id, newValue: { isActive: false } });
    return record;
  }

  async remove(id: string, user: any) {
    await this.findOne(id, user);
    await this.prisma.approvalWorkflow.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.audit.log({ userId: user.id, action: 'DELETE', entityType: 'ApprovalWorkflow', entityId: id, newValue: {} });
    return { message: 'Approval workflow deleted' };
  }
}

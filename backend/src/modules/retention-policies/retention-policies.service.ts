import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class RetentionPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { page = 1, limit = 20, companyId, dataCategory, status } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (dataCategory) where.dataCategory = dataCategory;
    if (status) where.status = status;

    const [data, total] = await Promise.all([
      this.prisma.retentionPolicy.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.retentionPolicy.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.retentionPolicy.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Retention policy not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.retentionPolicy.create({
      data: {
        retentionPolicyCode: 'RP-' + Date.now(),
        name: dto.name,
        dataCategory: dto.dataCategory,
        retentionDays: dto.retentionDays,
        archiveAfterDays: dto.archiveAfterDays,
        deletionAllowed: dto.deletionAllowed ?? false,
        requiresApproval: dto.requiresApproval ?? true,
        legalHold: dto.legalHold ?? false,
        status: dto.status ?? 'DRAFT',
        companyId: dto.companyId,
        createdById: userId,
      },
    });
    await this.auditLogs.log({ action: 'RETENTION_POLICY_CREATED', entityType: 'RetentionPolicy', entityId: record.id, userId, severity: AuditSeverity.HIGH });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.retentionPolicy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.retentionDays !== undefined && { retentionDays: dto.retentionDays }),
        ...(dto.archiveAfterDays !== undefined && { archiveAfterDays: dto.archiveAfterDays }),
        ...(dto.deletionAllowed !== undefined && { deletionAllowed: dto.deletionAllowed }),
        ...(dto.requiresApproval !== undefined && { requiresApproval: dto.requiresApproval }),
        ...(dto.legalHold !== undefined && { legalHold: dto.legalHold }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
    await this.auditLogs.log({ action: 'RETENTION_POLICY_UPDATED', entityType: 'RetentionPolicy', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.MEDIUM });
    return record;
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.retentionPolicy.update({
      where: { id },
      data: { status: 'ACTIVE', approvedById: userId, approvedAt: new Date() },
    });
    await this.auditLogs.log({ action: 'RETENTION_POLICY_APPROVED', entityType: 'RetentionPolicy', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.HIGH });
    return record;
  }

  async remove(id: string, userId: string) {
    await this.findOne(id);
    await this.prisma.retentionPolicy.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'RETENTION_POLICY_DELETED', entityType: 'RetentionPolicy', entityId: id, userId, severity: AuditSeverity.HIGH });
    return { success: true };
  }
}

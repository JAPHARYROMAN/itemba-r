import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditSeverity } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class SecurityPoliciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { page = 1, limit = 20, companyId, policyType, isActive } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (policyType) where.policyType = policyType;
    if (isActive !== undefined) where.isActive = isActive === 'true' || isActive === true;

    const [data, total] = await Promise.all([
      this.prisma.securityPolicy.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.securityPolicy.count({ where }),
    ]);
    return { data, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const record = await this.prisma.securityPolicy.findFirst({ where: { id, deletedAt: null } });
    if (!record) throw new NotFoundException('Security policy not found');
    return record;
  }

  async create(dto: any, userId: string) {
    const record = await this.prisma.securityPolicy.create({
      data: {
        policyCode: dto.policyCode ?? 'SP-' + Date.now(),
        name: dto.name,
        policyType: dto.policyType,
        settings: dto.settings ?? {},
        isActive: dto.isActive ?? true,
        companyId: dto.companyId,
        createdById: userId,
      },
    });
    await this.auditLogs.log({ action: 'SECURITY_POLICY_CREATED', entityType: 'SecurityPolicy', entityId: record.id, userId, newValue: record as any, severity: AuditSeverity.HIGH });
    return record;
  }

  async update(id: string, dto: any, userId: string) {
    const existing = await this.findOne(id);
    const record = await this.prisma.securityPolicy.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.policyType !== undefined && { policyType: dto.policyType }),
        ...(dto.settings !== undefined && { settings: dto.settings }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
        ...(dto.approvedById !== undefined && { approvedById: dto.approvedById }),
        ...(dto.approvedAt !== undefined && { approvedAt: new Date(dto.approvedAt) }),
      },
    });
    await this.auditLogs.log({ action: 'SECURITY_POLICY_UPDATED', entityType: 'SecurityPolicy', entityId: id, userId, oldValue: existing as any, newValue: record as any, severity: AuditSeverity.HIGH });
    return record;
  }

  async remove(id: string, userId: string) {
    const existing = await this.findOne(id);
    await this.prisma.securityPolicy.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'SECURITY_POLICY_DELETED', entityType: 'SecurityPolicy', entityId: id, userId, oldValue: existing as any, severity: AuditSeverity.HIGH });
    return { success: true };
  }
}

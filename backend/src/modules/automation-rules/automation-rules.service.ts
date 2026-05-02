import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class AutomationRulesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.automationRule.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.automationRule.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.automationRule.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Automation rule not found');
    return item;
  }

  async create(dto: any, user: any) {
    const { companyId, ...rest } = dto;
    const item = await this.prisma.automationRule.create({ data: { ...rest, status: 'INACTIVE' as any, createdById: user.id, ...(companyId ? { companyId } : {}) } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'AutomationRule', entityId: item.id, userId: user.id, companyId: item.companyId ?? undefined });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.automationRule.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'AutomationRule', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async remove(id: string, user: any) {
    await this.findOne(id);
    await this.prisma.automationRule.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.auditLogs.log({ action: 'DELETE', entityType: 'AutomationRule', entityId: id, userId: user.id });
    return { success: true };
  }

  async setStatus(id: string, status: string, user: any) {
    await this.findOne(id);
    const updated = await this.prisma.automationRule.update({ where: { id }, data: { status: status as any } });
    await this.auditLogs.log({ action: status === 'ACTIVE' ? 'ACTIVATE' : 'PAUSE', entityType: 'AutomationRule', entityId: id, userId: user.id });
    return updated;
  }
}

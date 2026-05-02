import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class CommunicationLogsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, entityType, entityId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    const [items, total] = await Promise.all([
      this.prisma.communicationLog.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.communicationLog.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.communicationLog.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Communication log not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.communicationLog.create({ data: { ...dto, status: 'OPEN', createdById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'CommunicationLog', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.communicationLog.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'CommunicationLog', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async close(id: string, user: any) {
    await this.findOne(id);
    const updated = await this.prisma.communicationLog.update({ where: { id }, data: { status: 'CLOSED' as any } });
    await this.auditLogs.log({ action: 'CLOSE', entityType: 'CommunicationLog', entityId: id, userId: user.id });
    return updated;
  }
}

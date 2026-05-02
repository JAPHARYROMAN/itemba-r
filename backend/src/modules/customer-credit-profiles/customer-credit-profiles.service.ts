import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class CustomerCreditProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, customerId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    applyCompanyScopeWhere(where, user, companyId);
    if (customerId) where.customerId = customerId;
    const [items, total] = await Promise.all([
      this.prisma.customerCreditProfile.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.customerCreditProfile.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.customerCreditProfile.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Credit profile not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.customerCreditProfile.create({ data: { ...dto, createdById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'CustomerCreditProfile', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.customerCreditProfile.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'CustomerCreditProfile', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }
}

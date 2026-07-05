import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class ProcurementPlansService {
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
      this.prisma.procurementPlan.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { lines: true } }),
      this.prisma.procurementPlan.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.procurementPlan.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!item) throw new NotFoundException('Procurement plan not found');
    return item;
  }

  async create(dto: any, user: any) {
    const { lines, ...rest } = dto;
    const item = await this.prisma.procurementPlan.create({
      data: { ...rest, status: 'DRAFT', createdById: user.id, lines: lines ? { create: lines } : undefined },
      include: { lines: true },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'ProcurementPlan', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const data = { ...dto };
    delete data.companyId;
    delete data.status;
    delete data.createdById;
    delete data.lines;
    const updated = await this.prisma.procurementPlan.update({ where: { id }, data });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'ProcurementPlan', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async approve(id: string, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT plans can be approved');
    const updated = await this.prisma.procurementPlan.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'ProcurementPlan', entityId: id, userId: user.id });
    return updated;
  }
}

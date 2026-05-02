import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

@Injectable()
export class SupplierPerformanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async findAll(query: any) {
    const { companyId, supplierId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    if (companyId) where.companyId = companyId;
    if (supplierId) where.supplierId = supplierId;
    const [items, total] = await Promise.all([
      this.prisma.supplierPerformanceProfile.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.supplierPerformanceProfile.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.supplierPerformanceProfile.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Supplier performance profile not found');
    return item;
  }

  async create(dto: any, user: any) {
    const item = await this.prisma.supplierPerformanceProfile.create({ data: { ...dto, createdById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'SupplierPerformanceProfile', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.supplierPerformanceProfile.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'SupplierPerformanceProfile', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }
}

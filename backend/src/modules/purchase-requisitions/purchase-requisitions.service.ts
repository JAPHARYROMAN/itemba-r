import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere } from '../../common/services';

@Injectable()
export class PurchaseRequisitionsService {
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
      this.prisma.purchaseRequisition.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { lines: true } }),
      this.prisma.purchaseRequisition.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.purchaseRequisition.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!item) throw new NotFoundException('Purchase requisition not found');
    return item;
  }

  async create(dto: any, user: any) {
    const { lines, ...rest } = dto;
    const item = await this.prisma.purchaseRequisition.create({
      data: {
        ...rest,
        status: 'DRAFT',
        requestedById: user.id,
        lines: lines ? { create: lines } : undefined,
      },
      include: { lines: true },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'PurchaseRequisition', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'PurchaseRequisition', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async submit(id: string, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT requisitions can be submitted');
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data: { status: 'SUBMITTED' } });
    await this.auditLogs.log({ action: 'SUBMIT', entityType: 'PurchaseRequisition', entityId: id, userId: user.id });
    return updated;
  }

  async approve(id: string, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'SUBMITTED') throw new BadRequestException('Only SUBMITTED requisitions can be approved');
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'PurchaseRequisition', entityId: id, userId: user.id });
    return updated;
  }

  async reject(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    if (!['SUBMITTED'].includes(existing.status)) throw new BadRequestException('Cannot reject in current status');
    const updated = await this.prisma.purchaseRequisition.update({ where: { id }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectedById: user.id, rejectionReason: dto.reason } });
    await this.auditLogs.log({ action: 'REJECT', entityType: 'PurchaseRequisition', entityId: id, userId: user.id });
    return updated;
  }
}

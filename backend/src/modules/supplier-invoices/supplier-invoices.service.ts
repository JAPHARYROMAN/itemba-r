import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class SupplierInvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, supplierId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (supplierId) where.supplierId = supplierId;
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.supplierInvoice.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { lines: true } }),
      this.prisma.supplierInvoice.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierInvoice.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!item) throw new NotFoundException('Supplier invoice not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    if (dto.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    }
    const { lines, ...rest } = dto;
    const item = await this.prisma.supplierInvoice.create({
      data: { ...rest, status: 'DRAFT', createdById: user.id, lines: lines ? { create: lines } : undefined },
      include: { lines: true },
    });
    await this.auditLogs.log({ action: 'SUPPLIER_INVOICE_CREATE', entityType: 'SupplierInvoice', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const updated = await this.prisma.supplierInvoice.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'SUPPLIER_INVOICE_UPDATE', entityType: 'SupplierInvoice', entityId: id, userId: user.id, companyId: existing.companyId, oldValue: existing, newValue: updated });
    return updated;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT invoices can be approved');
    const updated = await this.prisma.supplierInvoice.update({ where: { id }, data: { status: 'APPROVED', approvedAt: new Date(), approvedById: user.id } });
    await this.auditLogs.log({ action: 'SUPPLIER_INVOICE_APPROVE', entityType: 'SupplierInvoice', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }
}

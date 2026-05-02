import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class SupplierQuotationsService {
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
      this.prisma.supplierQuotation.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { lines: true } }),
      this.prisma.supplierQuotation.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.supplierQuotation.findFirst({ where: { id, deletedAt: null }, include: { lines: true } });
    if (!item) throw new NotFoundException('Supplier quotation not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    const { lines, ...rest } = dto;
    await this.companyScope.assertCanAccessCompany(user, rest.companyId, AccessLevel.WRITE);
    await this.assertSupplierBelongsToCompany(rest.supplierId, rest.companyId);
    const item = await this.prisma.supplierQuotation.create({
      data: {
        ...rest,
        status: 'DRAFT',
        createdById: user.id,
        lines: lines ? { create: lines } : undefined,
      },
      include: { lines: true },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'SupplierQuotation', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (dto.companyId && dto.companyId !== existing.companyId) {
      throw new BadRequestException('Supplier quotation company cannot be changed');
    }
    if (dto.supplierId) {
      await this.assertSupplierBelongsToCompany(dto.supplierId, existing.companyId);
    }
    const { companyId: _companyId, createdById: _createdById, acceptedById: _acceptedById, acceptedAt: _acceptedAt, lines: _lines, ...data } = dto;
    const updated = await this.prisma.supplierQuotation.update({ where: { id }, data });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'SupplierQuotation', entityId: id, userId: user.id, companyId: existing.companyId, oldValue: existing, newValue: updated });
    return updated;
  }

  async accept(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'SUBMITTED'].includes(existing.status)) throw new BadRequestException('Cannot accept in current status');
    const updated = await this.prisma.supplierQuotation.update({ where: { id }, data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedById: user.id } });
    await this.auditLogs.log({ action: 'ACCEPT', entityType: 'SupplierQuotation', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  async reject(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'SUBMITTED'].includes(existing.status)) throw new BadRequestException('Cannot reject in current status');
    const updated = await this.prisma.supplierQuotation.update({ where: { id }, data: { status: 'REJECTED' as any } });
    await this.auditLogs.log({ action: 'REJECT', entityType: 'SupplierQuotation', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  private async assertSupplierBelongsToCompany(supplierId: string, companyId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId, deletedAt: null },
      select: { id: true },
    });
    if (!supplier) {
      throw new BadRequestException('Supplier does not belong to the selected company');
    }
  }
}

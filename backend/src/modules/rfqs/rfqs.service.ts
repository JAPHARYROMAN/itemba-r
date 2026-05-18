import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { applyCompanyScopeWhere, CompanyScopeService } from '../../common/services';

@Injectable()
export class RfqsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user?: any) {
    const { companyId, divisionId, branchId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = { deletedAt: null };
    // Phase 1: hierarchy-scoped where (company + optional division + branch).
    if (user) {
      Object.assign(
        where,
        await this.companyScope.scopedWhereFor(user, { companyId, divisionId, branchId }),
      );
    } else {
      applyCompanyScopeWhere(where, user, companyId);
    }
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.requestForQuotation.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' }, include: { rfqSuppliers: true } }),
      this.prisma.requestForQuotation.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string) {
    const item = await this.prisma.requestForQuotation.findFirst({ where: { id, deletedAt: null }, include: { rfqSuppliers: true } });
    if (!item) throw new NotFoundException('RFQ not found');
    return item;
  }

  async create(dto: any, user: any) {
    const { rfqSuppliers, suppliers, ...rest } = dto;
    const suppliersToCreate = rfqSuppliers ?? suppliers;

    // Phase 1: auto-derive divisionId/branchId from the linked PurchaseRequisition when not supplied.
    let divisionId = rest.divisionId as string | undefined;
    let branchId = rest.branchId as string | undefined;
    if (rest.purchaseRequisitionId && (!divisionId || !branchId)) {
      const pr = await this.prisma.purchaseRequisition.findFirst({
        where: { id: rest.purchaseRequisitionId, companyId: rest.companyId, deletedAt: null },
        select: { divisionId: true, branchId: true },
      });
      divisionId = divisionId ?? pr?.divisionId ?? undefined;
      branchId = branchId ?? pr?.branchId ?? undefined;
    }

    const item = await this.prisma.requestForQuotation.create({
      data: {
        ...rest,
        divisionId,
        branchId,
        status: 'DRAFT',
        createdById: user.id,
        rfqSuppliers: suppliersToCreate ? { create: suppliersToCreate } : undefined,
      },
      include: { rfqSuppliers: true },
    });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'RequestForQuotation', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async update(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    const updated = await this.prisma.requestForQuotation.update({ where: { id }, data: dto });
    await this.auditLogs.log({ action: 'UPDATE', entityType: 'RequestForQuotation', entityId: id, userId: user.id, oldValue: existing, newValue: updated });
    return updated;
  }

  async send(id: string, dto: any, user: any) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only DRAFT RFQs can be sent');
    if (dto.supplierIds?.length) {
      await Promise.all(
        dto.supplierIds.map((supplierId: string) =>
          this.prisma.rFQSupplier.upsert({ where: { id: '' }, create: { rfqId: id, supplierId }, update: { supplierId } }),
        ),
      );
    }
    const updated = await this.prisma.requestForQuotation.update({ where: { id }, data: { status: 'SENT' } });
    await this.auditLogs.log({ action: 'SEND', entityType: 'RequestForQuotation', entityId: id, userId: user.id });
    return updated;
  }
}

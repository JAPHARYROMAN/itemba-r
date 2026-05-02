import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';

@Injectable()
export class ThreeWayMatchingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, status, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (status) where.status = status;
    const [items, total] = await Promise.all([
      this.prisma.threeWayMatch.findMany({ where, skip, take: Number(limit), orderBy: { createdAt: 'desc' } }),
      this.prisma.threeWayMatch.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.threeWayMatch.findFirst({ where: { id, deletedAt: null } });
    if (!item) throw new NotFoundException('Three-way match not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertProcurementReferencesInCompany(dto);
    const item = await this.prisma.threeWayMatch.create({ data: { ...dto, matchedById: user.id } });
    await this.auditLogs.log({ action: 'CREATE', entityType: 'ThreeWayMatch', entityId: item.id, userId: user.id, companyId: item.companyId });
    return item;
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['MATCHED', 'PARTIAL_MATCH', 'VARIANCE'].includes(existing.matchStatus)) throw new BadRequestException('Cannot approve in current status');
    const updated = await this.prisma.threeWayMatch.update({ where: { id }, data: { approvedAt: new Date(), approvedById: user.id } });
    await this.auditLogs.log({ action: 'APPROVE', entityType: 'ThreeWayMatch', entityId: id, userId: user.id, companyId: existing.companyId });
    return updated;
  }

  private async assertProcurementReferencesInCompany(dto: any) {
    const checks: Array<Promise<{ companyId: string } | null>> = [];
    if (dto.purchaseOrderId) {
      checks.push(this.prisma.purchaseOrder.findFirst({
        where: { id: dto.purchaseOrderId, companyId: dto.companyId, deletedAt: null },
        select: { companyId: true },
      }));
    }
    if (dto.goodsReceivedNoteId) {
      checks.push(this.prisma.goodsReceivedNote.findFirst({
        where: { id: dto.goodsReceivedNoteId, companyId: dto.companyId, deletedAt: null },
        select: { companyId: true },
      }));
    }
    if (dto.supplierInvoiceId) {
      checks.push(this.prisma.supplierInvoice.findFirst({
        where: { id: dto.supplierInvoiceId, companyId: dto.companyId, deletedAt: null },
        select: { companyId: true },
      }));
    }

    const results = await Promise.all(checks);
    if (results.some((row) => !row)) {
      throw new BadRequestException('Procurement references must belong to the selected company');
    }
  }
}

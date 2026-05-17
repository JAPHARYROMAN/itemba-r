import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

@Injectable()
export class GoodsReceivedNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: any, user: AuthUser) {
    const { companyId, divisionId, branchId, status, supplierId, page = 1, limit = 20 } = query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    const [items, total] = await Promise.all([
      this.prisma.goodsReceivedNote.findMany({
        where,
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          lines: true,
        },
      }),
      this.prisma.goodsReceivedNote.count({ where }),
    ]);
    return { items, total, page: Number(page), limit: Number(limit) };
  }

  async findOne(id: string, user: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const item = await this.prisma.goodsReceivedNote.findFirst({
      where: { id, deletedAt: null },
      include: {
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        lines: true,
      },
    });
    if (!item) throw new NotFoundException('GRN not found');
    await this.companyScope.assertCanAccessCompany(user, item.companyId, minimum);
    return item;
  }

  async create(dto: any, user: AuthUser) {
    if (dto.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    }
    const { lines, ...rest } = dto;
    const scope = await this.resolveReceiptScope(rest);
    const item = await this.prisma.goodsReceivedNote.create({
      data: {
        ...rest,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        status: 'DRAFT',
        receivedById: user.id,
        lines: lines ? { create: lines } : undefined,
      },
      include: { lines: true },
    });
    await this.auditLogs.log({
      action: 'GOODS_RECEIVED_NOTE_CREATE',
      entityType: 'GoodsReceivedNote',
      entityId: item.id,
      userId: user.id,
      companyId: item.companyId,
    });
    return item;
  }

  async update(id: string, dto: any, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    const scope = await this.resolveReceiptScope({
      companyId: dto.companyId ?? existing.companyId,
      divisionId: dto.divisionId !== undefined ? dto.divisionId : existing.divisionId,
      branchId: dto.branchId !== undefined ? dto.branchId : existing.branchId,
      purchaseOrderId:
        dto.purchaseOrderId !== undefined ? dto.purchaseOrderId : existing.purchaseOrderId,
    });
    const updated = await this.prisma.goodsReceivedNote.update({
      where: { id },
      data: { ...dto, divisionId: scope.divisionId, branchId: scope.branchId },
    });
    await this.auditLogs.log({
      action: 'GOODS_RECEIVED_NOTE_UPDATE',
      entityType: 'GoodsReceivedNote',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
      oldValue: existing,
      newValue: updated,
    });
    return updated;
  }

  private async resolveReceiptScope(input: {
    companyId?: string;
    divisionId?: string | null;
    branchId?: string | null;
    purchaseOrderId?: string | null;
  }) {
    let divisionId = input.divisionId || null;
    let branchId = input.branchId || null;

    if (input.purchaseOrderId) {
      const po = await this.prisma.purchaseOrder.findFirst({
        where: { id: input.purchaseOrderId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true },
      });
      if (!po) throw new BadRequestException('Purchase order not found');
      if (input.companyId && po.companyId !== input.companyId) {
        throw new BadRequestException('Purchase order does not belong to this company');
      }
      if (divisionId && po.divisionId && divisionId !== po.divisionId) {
        throw new BadRequestException('Purchase order does not belong to the selected division');
      }
      if (branchId && po.branchId && branchId !== po.branchId) {
        throw new BadRequestException(
          'Purchase order does not belong to the selected branch/location',
        );
      }
      divisionId = po.divisionId || divisionId;
      branchId = po.branchId || branchId;
    }

    if (branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || (input.companyId && branch.division.companyId !== input.companyId)) {
        throw new BadRequestException('Branch/location does not belong to this company');
      }
      if (!divisionId) divisionId = branch.divisionId;
      if (divisionId && branch.divisionId !== divisionId) {
        throw new BadRequestException('Branch/location does not belong to the selected division');
      }
    }

    return { divisionId, branchId };
  }

  async approve(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT GRNs can be approved');
    const updated = await this.prisma.goodsReceivedNote.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: user.id },
    });
    await this.auditLogs.log({
      action: 'GOODS_RECEIVED_NOTE_APPROVE',
      entityType: 'GoodsReceivedNote',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
    });
    return updated;
  }

  async post(id: string, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'APPROVED')
      throw new BadRequestException('Only APPROVED GRNs can be posted');
    const updated = await this.prisma.goodsReceivedNote.update({
      where: { id },
      data: { status: 'POSTED', postedAt: new Date(), postedById: user.id },
    });
    await this.auditLogs.log({
      action: 'GOODS_RECEIVED_NOTE_POST',
      entityType: 'GoodsReceivedNote',
      entityId: id,
      userId: user.id,
      companyId: existing.companyId,
    });
    return updated;
  }
}

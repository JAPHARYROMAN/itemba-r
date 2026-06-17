import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';

@Injectable()
export class GoodsReceivedNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly inventoryMovements: InventoryMovementsService,
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
    if (!existing.branchId) {
      throw new BadRequestException('GRN branch/location is required before posting inventory');
    }
    const branchId = existing.branchId;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (existing.purchaseOrderId) {
        await this.assertLinkedPurchaseOrderCanReceiveStock({
          purchaseOrderId: existing.purchaseOrderId,
          companyId: existing.companyId,
          goodsReceivedNoteId: existing.id,
          tx,
        });
      }

      const postedAt = new Date();
      const claim = await tx.goodsReceivedNote.updateMany({
        where: { id, deletedAt: null, status: 'APPROVED' as any },
        data: { status: 'POSTED' as any, postedAt, postedById: user.id },
      });
      if (claim.count !== 1) {
        throw new BadRequestException('GRN has already been posted or is no longer postable');
      }

      const productIds = Array.from(new Set(existing.lines.map((line) => line.productId)));
      const products = await tx.product.findMany({
        where: { id: { in: productIds }, companyId: existing.companyId, deletedAt: null },
        select: { id: true, name: true, trackInventory: true },
      });
      const productById = new Map(products.map((product) => [product.id, product]));
      if (productById.size !== productIds.length) {
        throw new BadRequestException('GRN contains a product outside this company');
      }

      const poLines = existing.purchaseOrderId
        ? await tx.purchaseOrderLine.findMany({
            where: { purchaseOrderId: existing.purchaseOrderId },
            select: {
              productId: true,
              unitId: true,
              unitCost: true,
              batchNumber: true,
              expiryDate: true,
            },
          })
        : [];
      const poLineByProductUnit = new Map(
        poLines.map((line) => [`${line.productId}:${line.unitId}`, line]),
      );

      for (const line of existing.lines) {
        const product = productById.get(line.productId);
        if (!product?.trackInventory) continue;
        const acceptedQuantity = Number(line.acceptedQuantity);
        if (acceptedQuantity <= 0) continue;
        const poLine = poLineByProductUnit.get(`${line.productId}:${line.unitId}`);
        await this.inventoryMovements.createMovement({
          companyId: existing.companyId,
          divisionId: existing.divisionId ?? undefined,
          branchId,
          productId: line.productId,
          movementType: 'PURCHASE_RECEIPT',
          quantity: acceptedQuantity,
          unitId: line.unitId,
          unitCost: poLine ? Number(poLine.unitCost) : undefined,
          movementDate: existing.receivedDate,
          createdById: user.id,
          referenceType: 'GoodsReceivedNote',
          referenceId: existing.id,
          batchNumber: poLine?.batchNumber ?? undefined,
          expiryDate: poLine?.expiryDate ?? undefined,
          notes: `GRN ${existing.grnNumber}`,
          tx,
        });
      }

      if (existing.purchaseOrderId) {
        await tx.purchaseOrder.updateMany({
          where: {
            id: existing.purchaseOrderId,
            companyId: existing.companyId,
            deletedAt: null,
            status: { in: ['CONFIRMED', 'PARTIALLY_RECEIVED'] as any },
          },
          data: {
            status: 'RECEIVED' as any,
            receivedAt: existing.receivedDate,
            receivedById: user.id,
          },
        });
      }

      return tx.goodsReceivedNote.findFirst({
        where: { id },
        include: {
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          lines: true,
        },
      });
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

  private async assertLinkedPurchaseOrderCanReceiveStock(input: {
    purchaseOrderId: string;
    companyId: string;
    goodsReceivedNoteId: string;
    tx: Prisma.TransactionClient;
  }) {
    const [purchaseOrder, directReceipt, postedGrn] = await Promise.all([
      input.tx.purchaseOrder.findFirst({
        where: { id: input.purchaseOrderId, companyId: input.companyId, deletedAt: null },
        select: { status: true, purchaseOrderNumber: true },
      }),
      input.tx.inventoryMovement.findFirst({
        where: {
          companyId: input.companyId,
          referenceType: 'PurchaseOrder',
          referenceId: input.purchaseOrderId,
          movementType: 'PURCHASE_RECEIPT',
        },
        select: { id: true },
      }),
      input.tx.goodsReceivedNote.findFirst({
        where: {
          companyId: input.companyId,
          purchaseOrderId: input.purchaseOrderId,
          status: 'POSTED',
          deletedAt: null,
          id: { not: input.goodsReceivedNoteId },
        },
        select: { grnNumber: true },
      }),
    ]);

    if (!purchaseOrder) {
      throw new BadRequestException('Linked purchase order not found');
    }
    if (purchaseOrder.status === 'RECEIVED') {
      throw new BadRequestException(
        `Purchase order ${purchaseOrder.purchaseOrderNumber} has already been received`,
      );
    }
    if (!['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(String(purchaseOrder.status))) {
      throw new BadRequestException(
        `Purchase order ${purchaseOrder.purchaseOrderNumber} is not ready to receive stock`,
      );
    }
    if (directReceipt) {
      throw new BadRequestException(
        `Purchase order ${purchaseOrder.purchaseOrderNumber} already has posted stock receipts`,
      );
    }
    if (postedGrn) {
      throw new BadRequestException(
        `Purchase order ${purchaseOrder.purchaseOrderNumber} was already posted by GRN ${postedGrn.grnNumber}`,
      );
    }
  }
}

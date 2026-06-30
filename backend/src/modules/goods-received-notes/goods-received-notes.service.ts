import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { UpdateGoodsReceivedNoteDto } from './dto/update-goods-received-note.dto';

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
    const limitN = Number(limit);
    // `data` mirrors the paginated shape the rest of the app (and the frontend
    // `backendPage`/`normalizePaginated` helper) expects; `items` is kept for
    // backwards compatibility with any existing consumer.
    return {
      data: items,
      items,
      total,
      page: Number(page),
      limit: limitN,
      totalPages: Math.ceil(total / limitN) || 1,
    };
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

  async update(id: string, dto: UpdateGoodsReceivedNoteDto, user: AuthUser) {
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    // Once a GRN is approved/posted it has driven (or is about to drive) inventory
    // movements and purchase-order receipt state, so its header and lines must stay
    // immutable. Only DRAFTs are editable.
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT GRNs can be edited');
    }
    const { lines, ...rest } = dto;
    const scope = await this.resolveReceiptScope({
      companyId: dto.companyId ?? existing.companyId,
      divisionId: dto.divisionId !== undefined ? dto.divisionId : existing.divisionId,
      branchId: dto.branchId !== undefined ? dto.branchId : existing.branchId,
      purchaseOrderId:
        dto.purchaseOrderId !== undefined ? dto.purchaseOrderId : existing.purchaseOrderId,
    });
    const updated = await this.prisma.goodsReceivedNote.update({
      where: { id },
      data: {
        ...rest,
        divisionId: scope.divisionId,
        branchId: scope.branchId,
        // Replacing the lines wholesale mirrors the create idiom and keeps the
        // accepted/received quantities consistent with the header on a DRAFT.
        // NOTE (deferred): persisting per-line landed/unit cost on the GRN needs a
        // new `unitCost` column on GoodsReceivedNoteLine (a DB migration), so it is
        // intentionally not captured here.
        ...(lines ? { lines: { deleteMany: {}, create: lines as any } } : {}),
      },
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
        select: {
          id: true,
          name: true,
          trackInventory: true,
          baseUnitId: true,
          defaultPurchasePrice: true,
          productFamily: { select: { defaultPurchasePrice: true } },
        },
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
              quantity: true,
              unitCost: true,
              batchNumber: true,
              expiryDate: true,
            },
          })
        : [];
      const poLineByProductUnit = new Map(
        poLines.map((line) => [`${line.productId}:${line.unitId}`, line]),
      );

      // Ordered quantity per PO line, keyed by product:unit. A PO can in principle
      // carry the same product on multiple lines/units, so we accumulate.
      const orderedByProductUnit = new Map<string, number>();
      const orderedProductIds = new Set<string>();
      for (const poLine of poLines) {
        const key = `${poLine.productId}:${poLine.unitId}`;
        orderedByProductUnit.set(key, (orderedByProductUnit.get(key) ?? 0) + Number(poLine.quantity));
        orderedProductIds.add(poLine.productId);
      }

      // Quantity already accepted on this PO by *prior* POSTED GRNs. This GRN was
      // just flipped to POSTED above, so we exclude it explicitly by id.
      const priorReceivedByProductUnit = new Map<string, number>();
      if (existing.purchaseOrderId) {
        const priorLines = await tx.goodsReceivedNoteLine.findMany({
          where: {
            goodsReceivedNote: {
              purchaseOrderId: existing.purchaseOrderId,
              companyId: existing.companyId,
              status: 'POSTED' as any,
              deletedAt: null,
              id: { not: existing.id },
            },
          },
          select: { productId: true, unitId: true, acceptedQuantity: true },
        });
        for (const priorLine of priorLines) {
          const key = `${priorLine.productId}:${priorLine.unitId}`;
          priorReceivedByProductUnit.set(
            key,
            (priorReceivedByProductUnit.get(key) ?? 0) + Number(priorLine.acceptedQuantity),
          );
        }
      }

      // Over-receipt guard: the running received-to-date (prior POSTED GRNs + this
      // GRN) must never exceed the ordered quantity for any PO line.
      if (existing.purchaseOrderId) {
        const thisReceiptByProductUnit = new Map<string, number>();
        for (const line of existing.lines) {
          const key = `${line.productId}:${line.unitId}`;
          thisReceiptByProductUnit.set(
            key,
            (thisReceiptByProductUnit.get(key) ?? 0) + Number(line.acceptedQuantity),
          );
        }
        for (const [key, accepted] of thisReceiptByProductUnit) {
          if (!orderedByProductUnit.has(key)) {
            // Product is on the PO but received in a different unit than ordered.
            // There is no unit conversion in this path, so quantities cannot be
            // reconciled — reject rather than let the over-receipt ceiling be
            // silently bypassed (which would also leave the PO stuck at
            // PARTIALLY_RECEIVED forever). A product NOT on the PO at all carries
            // no ordered ceiling and is allowed through.
            const productId = key.slice(0, key.indexOf(':'));
            if (orderedProductIds.has(productId)) {
              throw new BadRequestException(
                'Received unit does not match the ordered unit for this product on the purchase order',
              );
            }
            continue;
          }
          const ordered = orderedByProductUnit.get(key) ?? 0;
          const prior = priorReceivedByProductUnit.get(key) ?? 0;
          if (prior + accepted > ordered) {
            throw new BadRequestException(
              'Accepted quantity exceeds the outstanding ordered quantity on the purchase order',
            );
          }
        }
      }

      for (const line of existing.lines) {
        const product = productById.get(line.productId);
        if (!product?.trackInventory) continue;
        const acceptedQuantity = Number(line.acceptedQuantity);
        if (acceptedQuantity <= 0) continue;
        const poLine = poLineByProductUnit.get(`${line.productId}:${line.unitId}`);
        // Resolve a real per-unit cost for this receipt, in priority order:
        //   1. the GRN line's own captured unitCost (an explicit landed cost),
        //   2. the matching PO line's unitCost (keyed by product:unit, so unit-safe),
        //   3. the product (then family) default purchase price.
        // The product/family defaults are denominated in the product's BASE unit and
        // there is no UoM conversion in this path, so they are only valid when the
        // received unit IS the base unit. When nothing applies the cost is left
        // undefined so the receipt fails loudly via assertInventoryMovementHasCost
        // rather than valuing at a wrong-unit cost (which would corrupt WAC).
        const baseUnitDefaultCost =
          line.unitId === product.baseUnitId
            ? product.defaultPurchasePrice != null
              ? Number(product.defaultPurchasePrice)
              : product.productFamily?.defaultPurchasePrice != null
                ? Number(product.productFamily.defaultPurchasePrice)
                : undefined
            : undefined;
        const resolvedUnitCost =
          line.unitCost != null
            ? Number(line.unitCost)
            : poLine
              ? Number(poLine.unitCost)
              : baseUnitDefaultCost;
        // Persist the resolved cost back onto the GRN line so the posted receipt
        // carries the cost it was valued at (lines without their own unitCost yet).
        if (line.unitCost == null && resolvedUnitCost != null) {
          await tx.goodsReceivedNoteLine.update({
            where: { id: line.id },
            data: { unitCost: resolvedUnitCost },
          });
        }
        await this.inventoryMovements.createMovement({
          companyId: existing.companyId,
          divisionId: existing.divisionId ?? undefined,
          branchId,
          productId: line.productId,
          movementType: 'PURCHASE_RECEIPT',
          quantity: acceptedQuantity,
          unitId: line.unitId,
          unitCost: resolvedUnitCost,
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
        // Roll the running received-to-date forward with this GRN's accepted
        // quantities, then decide PARTIALLY_RECEIVED vs RECEIVED. The PO is only
        // RECEIVED once every ordered line has been fully received-to-date.
        const receivedByProductUnit = new Map(priorReceivedByProductUnit);
        for (const line of existing.lines) {
          const key = `${line.productId}:${line.unitId}`;
          receivedByProductUnit.set(
            key,
            (receivedByProductUnit.get(key) ?? 0) + Number(line.acceptedQuantity),
          );
        }
        const fullyReceived = [...orderedByProductUnit.entries()].every(
          ([key, ordered]) => (receivedByProductUnit.get(key) ?? 0) >= ordered,
        );
        const nextStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
        await tx.purchaseOrder.updateMany({
          where: {
            id: existing.purchaseOrderId,
            companyId: existing.companyId,
            deletedAt: null,
            status: { in: ['CONFIRMED', 'PARTIALLY_RECEIVED'] as any },
          },
          data: {
            status: nextStatus as any,
            // Only stamp the received-by/at fields once the PO is fully received.
            ...(fullyReceived
              ? { receivedAt: existing.receivedDate, receivedById: user.id }
              : {}),
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
    tx: Prisma.TransactionClient;
  }) {
    const [purchaseOrder, directReceipt] = await Promise.all([
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
      // A direct (non-GRN) PO stock receipt already exists. Layering GRN receipts
      // on top of that path would double-count, so block it. Prior POSTED GRNs are
      // intentionally allowed here to support partial receiving across GRNs; the
      // over-receipt guard in post() enforces the ordered-quantity ceiling.
      throw new BadRequestException(
        `Purchase order ${purchaseOrder.purchaseOrderNumber} already has posted stock receipts`,
      );
    }
  }
}

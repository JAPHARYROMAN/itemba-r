import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AccessLevel, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { UpdateGoodsReceivedNoteDto } from './dto/update-goods-received-note.dto';
import { CreateGoodsReceivedNoteDto } from './dto/create-goods-received-note.dto';
import { QueryGoodsReceivedNotesDto } from './dto/query-goods-received-notes.dto';

// Product types that do NOT carry stock value, mirroring profit.isStockProduct().
// A product of one of these types must never post a cost-less inventory receipt,
// even if it is (mis)flagged trackInventory:true.
const STOCK_EXEMPT_PRODUCT_TYPES = new Set(['SERVICE', 'NON_STOCK_ITEM']);

function isStockProduct(product: {
  productType?: string | null;
  trackInventory?: boolean | null;
}): boolean {
  if (product.trackInventory === false) return false;
  return !STOCK_EXEMPT_PRODUCT_TYPES.has(String(product.productType ?? '').toUpperCase());
}

// Quantities are Decimal(18,4) but compared here as JS numbers; this tolerance
// absorbs binary-float rounding (e.g. 0.1 + 0.2 = 0.30000000000000004) so an exact
// receipt isn't falsely rejected as over-receipt or mis-classified as partial. It
// is far below the 4-decimal storage precision, so it never masks a real overage.
const QTY_EPSILON = 1e-6;

@Injectable()
export class GoodsReceivedNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly inventoryMovements: InventoryMovementsService,
  ) {}

  async findAll(query: QueryGoodsReceivedNotesDto, user: AuthUser) {
    const { companyId, divisionId, branchId, status, supplierId, search, page = 1, limit = 20 } =
      query;
    const skip = (Number(page) - 1) * Number(limit);
    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (supplierId) where.supplierId = supplierId;
    const term = search?.trim();
    if (term) {
      // GoodsReceivedNote has no Prisma relation to Supplier (supplierId is a raw
      // column), so supplier-name matching resolves the matching supplier ids
      // first and ORs them with a grnNumber match. Company scoping on the GRN
      // `where` above keeps out-of-scope suppliers from ever surfacing rows.
      const matchingSuppliers = await this.prisma.supplier.findMany({
        where: { name: { contains: term, mode: 'insensitive' } },
        select: { id: true },
      });
      where.OR = [
        { grnNumber: { contains: term, mode: 'insensitive' } },
        ...(matchingSuppliers.length
          ? [{ supplierId: { in: matchingSuppliers.map((supplier) => supplier.id) } }]
          : []),
      ];
    }
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
    const withSuppliers = await this.attachSuppliers(items);
    const limitN = Number(limit);
    // `data` mirrors the paginated shape the rest of the app (and the frontend
    // `backendPage`/`normalizePaginated` helper) expects; `items` is kept for
    // backwards compatibility with any existing consumer.
    return {
      data: withSuppliers,
      items: withSuppliers,
      total,
      page: Number(page),
      limit: limitN,
      totalPages: Math.ceil(total / limitN) || 1,
    };
  }

  /**
   * GoodsReceivedNote stores supplierId as a raw column with no Prisma relation
   * to Supplier, so `include: { supplier: ... }` is not available. Batch-fetch
   * the referenced suppliers and attach a relation-shaped `supplier` object so
   * consumers can render names instead of UUIDs. Soft-deleted suppliers are
   * intentionally included — a historical GRN should still show its name.
   */
  private async attachSuppliers<T extends { supplierId: string | null }>(
    items: T[],
  ): Promise<Array<T & { supplier: { id: string; name: string; supplierCode: string } | null }>> {
    const supplierIds = Array.from(
      new Set(items.map((item) => item.supplierId).filter((id): id is string => Boolean(id))),
    );
    const suppliers = supplierIds.length
      ? await this.prisma.supplier.findMany({
          where: { id: { in: supplierIds } },
          select: { id: true, name: true, supplierCode: true },
        })
      : [];
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    return items.map((item) => ({
      ...item,
      supplier: item.supplierId ? (supplierById.get(item.supplierId) ?? null) : null,
    }));
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
    const [withSupplier] = await this.attachSuppliers([item]);
    return withSupplier;
  }

  async create(dto: any, user: AuthUser) {
    // The controller types the body as `any`, so the global ValidationPipe never
    // runs against a typed DTO here. Validate explicitly so crafted negative line
    // quantities (which the posting loop would skip while still reducing the PO
    // received-to-date accumulation) are rejected at the boundary. Mirrors the
    // global pipe: transform + whitelist.
    const candidate = plainToInstance(CreateGoodsReceivedNoteDto, dto, {
      enableImplicitConversion: true,
    });
    const errors = validateSync(candidate as object, {
      whitelist: true,
      forbidNonWhitelisted: false,
    });
    if (errors.length > 0) {
      const messages = errors.flatMap((error) => Object.values(error.constraints ?? {}));
      const nested = errors.flatMap((error) =>
        (error.children ?? []).flatMap((child) =>
          (child.children ?? []).flatMap((leaf) => Object.values(leaf.constraints ?? {})),
        ),
      );
      throw new BadRequestException([...messages, ...nested].join('; ') || 'Invalid GRN payload');
    }

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
        // Serialize concurrent GRN posts against the same PO. Without this lock,
        // two GRNs posted at the same instant each read prior-received under
        // Read Committed isolation (the other's POSTED row not yet committed) and
        // both pass the over-receipt ceiling, silently over-receiving. Taking a
        // row lock on the PO forces the second poster to wait until the first
        // commits, so it sees the committed received-to-date before evaluating
        // the ceiling below.
        const lockedPo = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
          SELECT "id" FROM "purchase_orders"
          WHERE "id" = ${existing.purchaseOrderId}
            AND "companyId" = ${existing.companyId}
            AND "deletedAt" IS NULL
          FOR UPDATE`);
        if (lockedPo.length === 0) {
          throw new BadRequestException('Linked purchase order not found');
        }

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
          productType: true,
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
            (priorReceivedByProductUnit.get(key) ?? 0) +
              Math.max(0, Number(priorLine.acceptedQuantity)),
          );
        }
      }

      // Over-receipt guard: the running received-to-date (prior POSTED GRNs + this
      // GRN) must never exceed the ordered quantity for any PO line.
      if (existing.purchaseOrderId) {
        // A PO-linked GRN against a PO that carries no lines has no ordered
        // ceiling at all: every received key would fall into the "not on the PO"
        // branch below and pass unbounded, and fullyReceived would vacuously mark
        // the PO RECEIVED. Reject so an empty PO cannot receive arbitrary stock.
        if (orderedByProductUnit.size === 0) {
          throw new BadRequestException(
            'Linked purchase order has no order lines to receive against',
          );
        }
        const thisReceiptByProductUnit = new Map<string, number>();
        for (const line of existing.lines) {
          const key = `${line.productId}:${line.unitId}`;
          // Clamp negatives to 0 so a crafted negative line cannot net-down the
          // over-receipt total and let a positive line slip past the ceiling
          // (the movement loop skips non-positive lines, so they post no stock).
          const accepted = Math.max(0, Number(line.acceptedQuantity));
          thisReceiptByProductUnit.set(
            key,
            (thisReceiptByProductUnit.get(key) ?? 0) + accepted,
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
          if (prior + accepted - ordered > QTY_EPSILON) {
            throw new BadRequestException(
              'Accepted quantity exceeds the outstanding ordered quantity on the purchase order',
            );
          }
        }
      }

      for (const line of existing.lines) {
        const product = productById.get(line.productId);
        if (!product) continue;
        // Gate on the SAME stock-product predicate the valuation/cost layer uses,
        // not just trackInventory. A SERVICE / NON_STOCK_ITEM typed product is
        // exempt from assertInventoryMovementHasCost, so posting a movement for it
        // would inflate quantityOnHand with a held (zero-added) totalValue and a
        // stuck average. Such a product never carries stock value, so skip the
        // receipt rather than corrupt its balance. (PO received-to-date tracking
        // below still counts the line so PO closure is unaffected.)
        if (!isStockProduct(product)) continue;
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
        // Guard on poLine.unitCost being non-null (not just poLine existing): a PO
        // line with a NULL unitCost must fall through to the base-unit default,
        // otherwise Number(null)=0 would value the receipt at 0 and corrupt WAC. An
        // explicit 0 (genuinely free goods) is honoured.
        const resolvedUnitCost =
          line.unitCost != null
            ? Number(line.unitCost)
            : poLine?.unitCost != null
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
            (receivedByProductUnit.get(key) ?? 0) + Math.max(0, Number(line.acceptedQuantity)),
          );
        }
        const fullyReceived = [...orderedByProductUnit.entries()].every(
          ([key, ordered]) => (receivedByProductUnit.get(key) ?? 0) >= ordered - QTY_EPSILON,
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

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { TaxAutoApplyService } from '../tax-auto-apply/tax-auto-apply.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreatePurchaseOrderDto, PurchaseOrderLineDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';
import { AccessLevel, AuditSeverity, PurchaseType } from '@prisma/client';

type PurchaseOrderReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  supplierId?: string | null;
  lines?: PurchaseOrderLineDto[];
};

function calcLineTotals(line: {
  quantity: number;
  unitCost: number;
  discountAmount?: number;
  taxAmount?: number;
}) {
  const discount = line.discountAmount ?? 0;
  const tax = line.taxAmount ?? 0;
  return {
    lineTotal: line.quantity * line.unitCost - discount + tax,
    subtotalContrib: line.quantity * line.unitCost,
    discount,
    tax,
  };
}

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger(PurchaseOrdersService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly inventoryMovements: InventoryMovementsService,
    private readonly taxAutoApply: TaxAutoApplyService,
    private readonly codes: EntityCodeGeneratorService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async findAll(query: QueryPurchaseOrderDto, user: AuthUser) {
    const {
      page = 1,
      limit = 20,
      companyId,
      divisionId,
      branchId,
      supplierId,
      purchaseType,
      status,
      paymentStatus,
      dateFrom,
      dateTo,
      search,
    } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (purchaseType) where.purchaseType = purchaseType;
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = new Date(dateFrom);
      if (dateTo) where.orderDate.lte = new Date(dateTo);
    }
    if (search) {
      where.OR = [
        { purchaseOrderNumber: { contains: search, mode: 'insensitive' } },
        { supplierName: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          supplier: { select: { id: true, name: true } },
          lines: {
            include: {
              product: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true, symbol: true } },
            },
          },
        },
        orderBy: { orderDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: { select: { id: true, name: true, code: true } },
        supplier: { select: { id: true, name: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
        confirmedBy: { select: { id: true, fullName: true } },
        receivedBy: { select: { id: true, fullName: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    });
    if (!record) throw new NotFoundException('Purchase order not found');
    if (user) await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    return record;
  }

  async create(dto: CreatePurchaseOrderDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    await this.assertReferencesBelongToCompany(dto.companyId, dto);
    const userId = user.id;
    let subtotal = 0;
    let totalDiscount = 0;
    let totalTax = 0;

    const linesData = dto.lines.map((line) => {
      const { lineTotal, subtotalContrib, discount, tax } = calcLineTotals(line);
      subtotal += subtotalContrib;
      totalDiscount += discount;
      totalTax += tax;
      return {
        productId: line.productId,
        description: line.description,
        quantity: line.quantity,
        unitId: line.unitId,
        unitCost: line.unitCost,
        discountAmount: discount,
        taxAmount: tax,
        lineTotal,
        inventoryLocationId: line.inventoryLocationId,
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
      };
    });

    const totalAmount = subtotal - totalDiscount + totalTax;

    const record = await this.prisma.$transaction(async (tx) => {
      const purchaseOrderNumber = await this.codes.next({
        entityType: 'PurchaseOrder',
        companyId: dto.companyId,
        tx,
      });
      return tx.purchaseOrder.create({
        data: {
          purchaseOrderNumber,
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          supplierId: dto.supplierId,
          supplierName: dto.supplierName,
          purchaseType: dto.purchaseType,
          orderDate: new Date(dto.orderDate),
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          currency: dto.currency,
          subtotal,
          discountAmount: totalDiscount,
          taxAmount: totalTax,
          totalAmount,
          paidAmount: 0,
          outstandingAmount: totalAmount,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          notes: dto.notes,
          createdById: userId,
          lines: { create: linesData },
        },
        include: { lines: true },
      });
    });

    await this.auditLogs.log({
      action: 'PURCHASE_ORDER_CREATE',
      entityType: 'PurchaseOrder',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return record;
  }

  async update(id: string, dto: UpdatePurchaseOrderDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Purchase order can only be updated in DRAFT status');
    }
    await this.assertReferencesBelongToCompany(existing.companyId, {
      divisionId: dto.divisionId ?? existing.divisionId,
      branchId: dto.branchId ?? existing.branchId,
      supplierId: dto.supplierId ?? existing.supplierId,
      lines: dto.lines,
    });

    let subtotal: number | undefined;
    let totalDiscount: number | undefined;
    let totalTax: number | undefined;
    let totalAmount: number | undefined;
    let linesData: any[] | undefined;

    if (dto.lines) {
      subtotal = 0;
      totalDiscount = 0;
      totalTax = 0;

      linesData = dto.lines.map((line) => {
        const { lineTotal, subtotalContrib, discount, tax } = calcLineTotals(line);
        subtotal! += subtotalContrib;
        totalDiscount! += discount;
        totalTax! += tax;
        return {
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitId: line.unitId,
          unitCost: line.unitCost,
          discountAmount: discount,
          taxAmount: tax,
          lineTotal,
          inventoryLocationId: line.inventoryLocationId,
          batchNumber: line.batchNumber,
          expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
        };
      });

      totalAmount = subtotal - totalDiscount + totalTax;
    }

    const record = await this.prisma.$transaction(async (tx) => {
      if (linesData) {
        await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
          ...(dto.supplierName !== undefined && { supplierName: dto.supplierName }),
          ...(dto.purchaseType && { purchaseType: dto.purchaseType }),
          ...(dto.orderDate && { orderDate: new Date(dto.orderDate) }),
          ...(dto.expectedDate !== undefined && {
            expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
          }),
          ...(dto.currency && { currency: dto.currency }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
          ...(dto.branchId !== undefined && { branchId: dto.branchId }),
          ...(subtotal !== undefined && {
            subtotal,
            discountAmount: totalDiscount,
            taxAmount: totalTax,
            totalAmount,
            outstandingAmount: totalAmount,
          }),
          ...(linesData && { lines: { create: linesData } }),
        },
        include: { lines: true },
      });
    });

    await this.auditLogs.log({
      action: 'PURCHASE_ORDER_UPDATE',
      entityType: 'PurchaseOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return record;
  }

  private async assertReferencesBelongToCompany(
    companyId: string,
    refs: PurchaseOrderReferenceIds,
  ) {
    if (refs.divisionId) {
      const division = await this.prisma.division.findFirst({
        where: { id: refs.divisionId, deletedAt: null },
        select: { companyId: true },
      });
      if (!division || division.companyId !== companyId) {
        throw new BadRequestException('Division does not belong to this company');
      }
    }

    if (refs.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: refs.branchId, deletedAt: null },
        select: { divisionId: true, division: { select: { companyId: true } } },
      });
      if (!branch || branch.division.companyId !== companyId) {
        throw new BadRequestException('Branch does not belong to this company');
      }
      if (refs.divisionId && branch.divisionId !== refs.divisionId) {
        throw new BadRequestException('Branch does not belong to the selected division');
      }
    }

    if (refs.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({
        where: { id: refs.supplierId, deletedAt: null },
        select: { companyId: true, divisionId: true },
      });
      if (!supplier || supplier.companyId !== companyId) {
        throw new BadRequestException('Supplier does not belong to this company');
      }
      if (supplier.divisionId && !refs.divisionId) {
        throw new BadRequestException('Purchase order division is required for this supplier');
      }
      if (supplier.divisionId && refs.divisionId !== supplier.divisionId) {
        throw new BadRequestException('Supplier does not operate in the selected division');
      }
    }

    await this.assertLineReferencesBelongToCompany(
      companyId,
      refs.lines,
      refs.divisionId,
      refs.branchId,
    );
  }

  private async assertLineReferencesBelongToCompany(
    companyId: string,
    lines: PurchaseOrderLineDto[] | undefined,
    divisionId?: string | null,
    branchId?: string | null,
  ) {
    if (!lines?.length) return;

    const unique = (ids: Array<string | undefined>) =>
      Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
    const productIds = unique(lines.map((line) => line.productId));
    const inventoryLocationIds = unique(lines.map((line) => line.inventoryLocationId));
    const unitIds = unique(lines.map((line) => line.unitId));

    const [products, inventoryLocations, units] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, companyId: true },
      }),
      inventoryLocationIds.length
        ? this.prisma.inventoryLocation.findMany({
            where: {
              id: { in: inventoryLocationIds },
              deletedAt: null,
              isActive: true,
            },
            select: { id: true, companyId: true, divisionId: true, branchId: true },
          })
        : Promise.resolve([]),
      this.prisma.unitOfMeasure.findMany({
        where: { id: { in: unitIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, companyId: true },
      }),
    ]);

    const validProductIds = new Set(
      products.filter((product) => product.companyId === companyId).map((product) => product.id),
    );
    if (validProductIds.size !== productIds.length) {
      throw new BadRequestException('Purchase order product does not belong to this company');
    }

    const validLocationIds = new Set(
      inventoryLocations
        .filter((location) => {
          if (location.companyId !== companyId) return false;
          if (location.branchId) return !branchId || location.branchId === branchId;
          if (location.divisionId) return !divisionId || location.divisionId === divisionId;
          return true;
        })
        .map((location) => location.id),
    );
    if (validLocationIds.size !== inventoryLocationIds.length) {
      throw new BadRequestException(
        branchId
          ? 'Purchase order inventory location is not available for the selected branch or division'
          : 'Purchase order inventory location does not belong to this company',
      );
    }

    const validUnitIds = new Set(
      units
        .filter((unit) => unit.companyId === null || unit.companyId === companyId)
        .map((unit) => unit.id),
    );
    if (validUnitIds.size !== unitIds.length) {
      throw new BadRequestException('Purchase order unit does not belong to this company');
    }
  }

  async confirm(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT purchase orders can be confirmed');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CONFIRMED', confirmedById: userId, confirmedAt: new Date() },
      });

      // ── Tax auto-apply (Sprint C2) ─────────────────────────────────────
      // Capture per-line input VAT into the TaxTransaction ledger so VAT
      // returns can net input against output. Soft-fails: errors are logged
      // and do NOT roll back the confirmation. Env-flag gated.
      try {
        const taxResult = await this.taxAutoApply.applyForPurchaseOrder(id, userId, tx);
        if (taxResult.error) {
          this.logger.warn(`Tax auto-apply for purchase order ${id}: ${taxResult.error}`);
        }
      } catch (err) {
        this.logger.warn(
          `Tax auto-apply threw for purchase order ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return updated;
    });

    await this.auditLogs.log({
      action: 'PURCHASE_ORDER_CONFIRM',
      entityType: 'PurchaseOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'CONFIRMED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    return record;
  }

  async receive(id: string, user: AuthUser, dto: ReceivePurchaseOrderDto = {}) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['CONFIRMED', 'PARTIALLY_RECEIVED'].includes(existing.status as string)) {
      throw new BadRequestException(
        'Only CONFIRMED or PARTIALLY_RECEIVED purchase orders can be received',
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      for (const line of existing.lines as any[]) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: { id: true, trackInventory: true },
        });

        if (!product) {
          throw new NotFoundException(`Product ${line.productId} not found`);
        }

        if (product.trackInventory) {
          const inventoryLocationId = line.inventoryLocationId ?? dto.inventoryLocationId;
          if (!inventoryLocationId) {
            throw new BadRequestException(
              `Receiving location is required for tracked product on line with product ${line.productId}`,
            );
          }

          await this.inventoryMovements.createMovement({
            companyId: existing.companyId,
            productId: line.productId,
            inventoryLocationId,
            movementType: 'PURCHASE_RECEIPT',
            quantity: Number(line.quantity),
            unitId: line.unitId,
            unitCost: Number(line.unitCost),
            movementDate: new Date(),
            createdById: userId,
            referenceType: 'PurchaseOrder',
            referenceId: id,
            batchNumber: line.batchNumber ?? undefined,
            expiryDate: line.expiryDate ?? undefined,
            divisionId: existing.divisionId ?? undefined,
            branchId: existing.branchId ?? undefined,
            tx,
          });

          if (!line.inventoryLocationId) {
            await tx.purchaseOrderLine.update({
              where: { id: line.id },
              data: { inventoryLocationId },
            });
          }
        }
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: { status: 'RECEIVED', receivedById: userId, receivedAt: new Date() },
      });
    });

    await this.auditLogs.log({
      action: 'PURCHASE_ORDER_RECEIVE',
      entityType: 'PurchaseOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'RECEIVED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    return record;
  }

  async cancel(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'CONFIRMED'].includes(existing.status as string)) {
      throw new BadRequestException('Only DRAFT or CONFIRMED purchase orders can be cancelled');
    }

    const record = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await this.auditLogs.log({
      action: 'PURCHASE_ORDER_CANCEL',
      entityType: 'PurchaseOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'CANCELLED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    return record;
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT purchase orders can be deleted');
    }

    await this.prisma.purchaseOrder.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'PURCHASE_ORDER_DELETE',
      entityType: 'PurchaseOrder',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }
}

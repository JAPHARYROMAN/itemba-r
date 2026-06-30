import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { TaxAutoApplyService } from '../tax-auto-apply/tax-auto-apply.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import { AccountResolverService, AccountRole, CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreatePurchaseOrderDto, PurchaseOrderLineDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { QueryPurchaseOrderDto } from './dto/query-purchase-order.dto';
import { ProfitService } from '../profit/profit.service';
import {
  ReceiveFuelTankAllocationDto,
  ReceivePurchaseOrderDto,
} from './dto/receive-purchase-order.dto';
import {
  AccessLevel,
  AuditSeverity,
  CashAccountType,
  Prisma,
  PurchaseType,
} from '@prisma/client';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';

type PurchaseOrderReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  supplierId?: string | null;
  lines?: PurchaseOrderLineDto[];
};

type FuelPurchaseReceipt = {
  tankId: string;
  productId: string;
  quantity: number;
  totalCost: number;
};

type FuelTankReceiptTarget = {
  id: string;
  tankCode: string;
  tankName: string;
};

function calcLineTotals(line: {
  quantity: number;
  unitCost: number;
  discountAmount?: number;
  taxAmount?: number;
}) {
  const quantity = Number(line.quantity);
  const unitCost = Number(line.unitCost);
  const discount = line.discountAmount ?? 0;
  const tax = line.taxAmount ?? 0;
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new BadRequestException('Purchase order line quantity must be greater than zero');
  }
  if (!Number.isFinite(unitCost) || unitCost <= 0) {
    throw new BadRequestException('Purchase order line unit cost must be greater than zero');
  }
  if (!Number.isFinite(discount) || discount < 0) {
    throw new BadRequestException('Purchase order line discount cannot be negative');
  }
  if (!Number.isFinite(tax) || tax < 0) {
    throw new BadRequestException('Purchase order line tax cannot be negative');
  }
  const extended = quantity * unitCost;
  if (discount > extended) {
    throw new BadRequestException(
      'Purchase order line discount cannot exceed the line amount (quantity x unit cost)',
    );
  }
  return {
    lineTotal: extended - discount + tax,
    subtotalContrib: extended,
    discount,
    tax,
  };
}

function paymentStateForPurchaseType(purchaseType: PurchaseType, totalAmount: number) {
  if (purchaseType === PurchaseType.CASH_PURCHASE) {
    return {
      paidAmount: totalAmount,
      outstandingAmount: 0,
      paymentStatus: 'PAID' as const,
    };
  }

  return {
    paidAmount: 0,
    outstandingAmount: totalAmount,
    paymentStatus: 'UNPAID' as const,
  };
}

function purchaseDebitRole(purchaseType: PurchaseType): AccountRole {
  switch (purchaseType) {
    case PurchaseType.ASSET_PURCHASE:
      return 'FIXED_ASSET';
    case PurchaseType.SERVICE_PURCHASE:
    case PurchaseType.INTERNAL_COMPANY:
    case PurchaseType.OTHER:
      return 'GENERAL_EXPENSE';
    default:
      return 'INVENTORY_ASSET';
  }
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
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
    private readonly postingEngine: PostingEngineService,
    private readonly accountResolver: AccountResolverService,
    private readonly profit: ProfitService,
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
      if (dateFrom) where.orderDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.orderDate.lte = dateRangeEnd(dateTo);
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
              product: {
                select: {
                  id: true,
                  name: true,
                  category: { select: { id: true, name: true, categoryType: true } },
                },
              },
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

  /**
   * Register-wide stat-card aggregate: counts and money totals grouped by
   * status, plus a flat roll-up. Shares the same filter idiom as findAll
   * (company scope + division/branch/supplier/type/date) so the workbench
   * header cards line up with the list below them.
   */
  async summary(query: QueryPurchaseOrderDto, user: AuthUser) {
    const { companyId, divisionId, branchId, supplierId, purchaseType, dateFrom, dateTo } = query;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };
    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (supplierId) where.supplierId = supplierId;
    if (purchaseType) where.purchaseType = purchaseType;
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.orderDate.lte = dateRangeEnd(dateTo);
    }

    const grouped = await this.prisma.purchaseOrder.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
      _sum: { totalAmount: true, outstandingAmount: true },
    });

    const byStatus = grouped.map((row) => ({
      status: row.status,
      count: row._count._all,
      totalAmount: Number(row._sum.totalAmount ?? 0),
      outstandingAmount: Number(row._sum.outstandingAmount ?? 0),
    }));

    const totals = byStatus.reduce(
      (acc, row) => {
        acc.count += row.count;
        acc.totalAmount += row.totalAmount;
        acc.outstandingAmount += row.outstandingAmount;
        return acc;
      },
      { count: 0, totalAmount: 0, outstandingAmount: 0 },
    );

    return {
      totals: {
        count: totals.count,
        totalAmount: roundMoney(totals.totalAmount),
        outstandingAmount: roundMoney(totals.outstandingAmount),
      },
      byStatus,
    };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.purchaseOrder.findFirst({
      where: { id, deletedAt: null },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            code: true,
            phone: true,
            email: true,
            website: true,
            logoUrl: true,
            group: {
              select: {
                name: true,
                code: true,
                address: true,
                phone: true,
                email: true,
                website: true,
              },
            },
            profile: {
              select: {
                registeredName: true,
                tradingName: true,
                brelaRegNumber: true,
                tin: true,
                vrn: true,
                registeredAddress: true,
                postalAddress: true,
              },
            },
          },
        },
        branch: { select: { id: true, name: true, code: true, address: true, phone: true } },
        supplier: {
          select: {
            id: true,
            name: true,
            supplierCode: true,
            tin: true,
            vrn: true,
            phone: true,
            email: true,
            address: true,
            contactPerson: true,
            paymentTerms: true,
          },
        },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                productCode: true,
                category: { select: { id: true, name: true, categoryType: true } },
              },
            },
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
    const supplierName = await this.resolveSupplierName(
      dto.companyId,
      dto.supplierId,
      dto.supplierName,
    );
    await this.profit.assertPurchaseLinesHaveCost(dto.companyId, dto.lines);
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
        batchNumber: line.batchNumber,
        expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
      };
    });

    const totalAmount = subtotal - totalDiscount + totalTax;
    const paymentState = paymentStateForPurchaseType(dto.purchaseType, totalAmount);

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
          supplierName,
          purchaseType: dto.purchaseType,
          orderDate: new Date(dto.orderDate),
          expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
          currency: dto.currency,
          subtotal,
          discountAmount: totalDiscount,
          taxAmount: totalTax,
          totalAmount,
          paidAmount: paymentState.paidAmount,
          outstandingAmount: paymentState.outstandingAmount,
          status: 'DRAFT',
          paymentStatus: paymentState.paymentStatus,
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
    const nextSupplierId =
      dto.supplierId !== undefined ? (dto.supplierId || null) : existing.supplierId;
    const supplierName =
      dto.supplierId !== undefined || dto.supplierName !== undefined
        ? await this.resolveSupplierName(existing.companyId, nextSupplierId, dto.supplierName)
        : undefined;

    let subtotal: number | undefined;
    let totalDiscount: number | undefined;
    let totalTax: number | undefined;
    let totalAmount: number | undefined;
    let linesData: any[] | undefined;

    if (dto.lines) {
      await this.profit.assertPurchaseLinesHaveCost(existing.companyId, dto.lines);
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
      const nextPurchaseType = dto.purchaseType ?? existing.purchaseType;
      const nextTotalAmount = totalAmount ?? Number(existing.totalAmount);
      const nextPaymentState =
        dto.purchaseType !== undefined || totalAmount !== undefined
          ? paymentStateForPurchaseType(nextPurchaseType, nextTotalAmount)
          : null;

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(dto.supplierId !== undefined && { supplierId: dto.supplierId }),
          ...(supplierName !== undefined && { supplierName }),
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
          }),
          ...(nextPaymentState && {
            paidAmount: nextPaymentState.paidAmount,
            outstandingAmount: nextPaymentState.outstandingAmount,
            paymentStatus: nextPaymentState.paymentStatus,
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
        select: { companyId: true, divisionId: true, status: true },
      });
      if (!supplier || supplier.companyId !== companyId) {
        throw new BadRequestException('Supplier does not belong to this company');
      }
      if (supplier.status === 'BLOCKED') {
        throw new BadRequestException('Blocked suppliers cannot be used on purchase orders');
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

  private async resolveSupplierName(
    companyId: string,
    supplierId?: string | null,
    fallbackName?: string | null,
  ) {
    if (!supplierId) return fallbackName?.trim() || undefined;
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, companyId, deletedAt: null },
      select: { name: true },
    });
    return supplier?.name?.trim() || fallbackName?.trim() || undefined;
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
    const unitIds = unique(lines.map((line) => line.unitId));

    const [products, units] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, companyId: true },
      }),
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
    await this.profit.assertPurchaseLinesHaveCost(existing.companyId, existing.lines as any[]);
    await this.assertCashAccountCurrencyMatches(existing);

    const record = await this.prisma.$transaction(async (tx) => {
      // Atomically claim DRAFT -> CONFIRMED. The status check above is outside the
      // transaction, so two concurrent confirms could both pass it; this guarded
      // updateMany takes the row lock and a second confirm matches 0 rows ->
      // throws and rolls back instead of double-running tax auto-apply. Mirrors
      // the guarded claim already used in receive().
      const claim = await tx.purchaseOrder.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'CONFIRMED', confirmedById: userId, confirmedAt: new Date() },
      });
      if (claim.count === 0) {
        throw new BadRequestException('Purchase order is no longer DRAFT (already confirmed).');
      }
      const updated = await tx.purchaseOrder.findUniqueOrThrow({ where: { id } });

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

  /**
   * Guard a CASH_PURCHASE confirmation against a currency mismatch: the cash
   * that settles the order is held in a CASH_ON_HAND cash account, so the
   * order currency must be one this company actually holds cash in. Credit
   * purchases skip this — they settle later through a Payable, not cash on
   * confirm. If the company has not set up any active cash-on-hand account
   * yet we stay out of the way (the receive-time posting resolves the GL
   * CASH_ON_HAND role separately); we only block a definite mismatch.
   */
  private async assertCashAccountCurrencyMatches(order: {
    companyId: string;
    purchaseType: PurchaseType;
    currency: string;
  }) {
    if (order.purchaseType !== PurchaseType.CASH_PURCHASE) return;

    const cashAccounts = await this.prisma.cashAccount.findMany({
      where: {
        companyId: order.companyId,
        accountType: CashAccountType.CASH_ON_HAND,
        isActive: true,
        deletedAt: null,
      },
      select: { currency: true },
    });
    if (cashAccounts.length === 0) return;

    const hasMatch = cashAccounts.some((account) => account.currency === order.currency);
    if (!hasMatch) {
      throw new BadRequestException(
        `No active cash account holds ${order.currency}; cash purchase currency must match a company cash account`,
      );
    }
  }

  async receive(id: string, user: AuthUser, dto: ReceivePurchaseOrderDto = {}) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    // Audit finding #20: this Operations receive path has no per-line received
    // quantity input — it posts a PURCHASE_RECEIPT for the FULL ordered quantity
    // of every line and flips the PO straight to RECEIVED. It is therefore a
    // full-receipt-only path. Partial / multi-shipment receipts must go through
    // the GRN flow (goods-received-notes), which tracks received-to-date per
    // product/unit and only marks the PO RECEIVED once every line is satisfied.
    // Accepting PARTIALLY_RECEIVED here would let this path post the full
    // quantity again on top of an earlier partial GRN, overstating inventory.
    if (existing.status !== 'CONFIRMED') {
      throw new BadRequestException(
        'Only CONFIRMED purchase orders can be received here; record partial receipts through the goods-received-note (GRN) flow',
      );
    }
    if (!existing.branchId) {
      throw new BadRequestException('Purchase order branch/location is required to receive stock');
    }
    const receivingBranchId = existing.branchId;
    const requestedFuelAllocations = dto.fuelTankAllocations ?? [];
    this.assertFuelTankAllocationsReferenceOrderLines(
      existing.lines as any[],
      requestedFuelAllocations,
    );

    const record = await this.prisma.$transaction(async (tx) => {
      const receivedAt = new Date();
      const fuelReceipts = new Map<string, FuelPurchaseReceipt>();
      const claim = await tx.purchaseOrder.updateMany({
        where: {
          id,
          deletedAt: null,
          status: 'CONFIRMED',
        },
        data: {
          status: 'RECEIVED',
          receivedById: userId,
          receivedAt,
        },
      });
      if (claim.count !== 1) {
        throw new BadRequestException(
          'Purchase order has already been received or is no longer receivable',
        );
      }
      await this.assertPurchaseOrderStockNotAlreadyPosted(id, existing.companyId, tx);

      for (const line of existing.lines as any[]) {
        const product = await tx.product.findUnique({
          where: { id: line.productId },
          select: {
            id: true,
            name: true,
            trackInventory: true,
            category: { select: { categoryType: true } },
          },
        });

        if (!product) {
          throw new NotFoundException(`Product ${line.productId} not found`);
        }

        if (product.trackInventory) {
          const unitCost =
            Number(line.quantity) > 0
              ? Number(line.lineTotal) / Number(line.quantity)
              : Number(line.unitCost);
          const fuelReceiptPlan: FuelPurchaseReceipt[] = [];
          const lineAllocations = this.fuelTankAllocationsForLine(line, requestedFuelAllocations);
          if (lineAllocations.length > 0) {
            const allocatedQuantity = lineAllocations.reduce(
              (sum, allocation) => sum + Number(allocation.quantity),
              0,
            );
            if (Math.abs(allocatedQuantity - Number(line.quantity)) > 0.0001) {
              throw new BadRequestException(
                `Fuel tank allocations for ${product.name} must equal the purchase line quantity`,
              );
            }

            for (const allocation of lineAllocations) {
              const tank = await this.resolveAllocatedFuelTankForReceipt({
                companyId: existing.companyId,
                branchId: receivingBranchId,
                productId: line.productId,
                tankId: allocation.tankId,
                tx,
              });
              fuelReceiptPlan.push({
                tankId: tank.id,
                productId: line.productId,
                quantity: Number(allocation.quantity),
                totalCost:
                  Number(line.quantity) > 0
                    ? Number(line.lineTotal) * (Number(allocation.quantity) / Number(line.quantity))
                    : 0,
              });
            }
          } else {
            const tank = await this.resolveSingleFuelTankForReceipt({
              companyId: existing.companyId,
              branchId: receivingBranchId,
              productId: line.productId,
              productLabel: product.name,
              productIsFuel: product.category?.categoryType === 'FUEL',
              tx,
            });
            if (tank) {
              fuelReceiptPlan.push({
                tankId: tank.id,
                productId: line.productId,
                quantity: Number(line.quantity),
                totalCost: Number(line.lineTotal),
              });
            }
          }

          await this.inventoryMovements.createMovement({
            companyId: existing.companyId,
            productId: line.productId,
            movementType: 'PURCHASE_RECEIPT',
            quantity: Number(line.quantity),
            unitId: line.unitId,
            unitCost,
            movementDate: receivedAt,
            createdById: userId,
            referenceType: 'PurchaseOrder',
            referenceId: id,
            batchNumber: line.batchNumber ?? undefined,
            expiryDate: line.expiryDate ?? undefined,
            divisionId: existing.divisionId ?? undefined,
            branchId: receivingBranchId,
            tx,
          });

          for (const receipt of fuelReceiptPlan) {
            this.addFuelReceipt(fuelReceipts, receipt);
          }
        }
      }

      await this.postOperationsFuelReceipts({
        order: existing as any,
        receipts: Array.from(fuelReceipts.values()),
        receivedAt,
        userId,
        tx,
      });

      // AP OWNERSHIP (audit findings #1 + #7): this goods-received path posts the
      // INVENTORY side only. Accounts Payable is owned exclusively by the
      // supplier-invoice approve flow, which independently creates the Payable and
      // credits AP_CONTROL at the full invoice amount. receive() must NOT create a
      // Payable nor credit AP_CONTROL on a credit purchase, otherwise the liability
      // (and inventory) is double-counted once the matching supplier invoice is
      // approved. For a CASH purchase there is a genuine cash settlement at receipt
      // that no supplier-invoice flow ever posts, so the inventory/cash ledger is
      // PO-owned and still posted here.
      let journalEntry: { id: string } | null = null;
      if (existing.purchaseType === PurchaseType.CASH_PURCHASE) {
        journalEntry = await this.postPurchaseOrderCashReceiptLedger({
          order: existing as any,
          transactionDate: receivedAt,
          userId,
          tx,
        });
      }

      return tx.purchaseOrder.update({
        where: { id },
        data: {
          status: 'RECEIVED',
          receivedById: userId,
          receivedAt,
          ...(journalEntry ? { journalEntryId: journalEntry.id } : {}),
          ...(existing.purchaseType === PurchaseType.CASH_PURCHASE && {
            paidAmount: existing.totalAmount,
            outstandingAmount: 0,
            paymentStatus: 'PAID',
          }),
        },
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

  private async assertPurchaseOrderStockNotAlreadyPosted(
    purchaseOrderId: string,
    companyId: string,
    tx: Prisma.TransactionClient,
  ) {
    const [directReceipt, postedGrn] = await Promise.all([
      tx.inventoryMovement.findFirst({
        where: {
          companyId,
          referenceType: 'PurchaseOrder',
          referenceId: purchaseOrderId,
          movementType: 'PURCHASE_RECEIPT',
        },
        select: { id: true },
      }),
      tx.goodsReceivedNote.findFirst({
        where: {
          companyId,
          purchaseOrderId,
          status: 'POSTED' as any,
          deletedAt: null,
        },
        select: { grnNumber: true },
      }),
    ]);

    if (directReceipt) {
      throw new BadRequestException('Purchase order stock has already been received');
    }
    if (postedGrn) {
      throw new BadRequestException(
        `Purchase order stock was already posted by GRN ${postedGrn.grnNumber}`,
      );
    }
  }

  private assertFuelTankAllocationsReferenceOrderLines(
    lines: Array<{ id?: string; productId: string }>,
    allocations: ReceiveFuelTankAllocationDto[],
  ) {
    if (allocations.length === 0) return;
    const lineIds = new Set(lines.map((line) => line.id).filter(Boolean));
    const productIds = new Set(lines.map((line) => line.productId));

    for (const allocation of allocations) {
      if (!allocation.purchaseOrderLineId && !allocation.productId) {
        throw new BadRequestException(
          'Fuel tank allocation must reference a purchase order line or product',
        );
      }
      if (allocation.purchaseOrderLineId && !lineIds.has(allocation.purchaseOrderLineId)) {
        throw new BadRequestException(
          'Fuel tank allocation references a line that is not on this purchase order',
        );
      }
      if (allocation.productId && !productIds.has(allocation.productId)) {
        throw new BadRequestException(
          'Fuel tank allocation references a product that is not on this purchase order',
        );
      }
    }
  }

  private fuelTankAllocationsForLine(
    line: { id?: string; productId: string },
    allocations: ReceiveFuelTankAllocationDto[],
  ) {
    const lineAllocations = allocations.filter(
      (allocation) => allocation.purchaseOrderLineId && allocation.purchaseOrderLineId === line.id,
    );
    if (lineAllocations.length > 0) return lineAllocations;
    return allocations.filter(
      (allocation) => !allocation.purchaseOrderLineId && allocation.productId === line.productId,
    );
  }

  private addFuelReceipt(receipts: Map<string, FuelPurchaseReceipt>, receipt: FuelPurchaseReceipt) {
    const key = `${receipt.tankId}:${receipt.productId}`;
    const current = receipts.get(key) ?? {
      tankId: receipt.tankId,
      productId: receipt.productId,
      quantity: 0,
      totalCost: 0,
    };
    current.quantity += receipt.quantity;
    current.totalCost += receipt.totalCost;
    receipts.set(key, current);
  }

  private async resolveAllocatedFuelTankForReceipt(input: {
    companyId: string;
    branchId: string;
    productId: string;
    tankId: string;
    tx: Prisma.TransactionClient;
  }): Promise<FuelTankReceiptTarget> {
    const tank = await input.tx.fuelTank.findFirst({
      where: {
        id: input.tankId,
        companyId: input.companyId,
        branchId: input.branchId,
        productId: input.productId,
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: { id: true, tankCode: true, tankName: true },
    });
    if (!tank) {
      throw new BadRequestException(
        'Selected fuel tank must be active and match the purchase order company, branch, and product',
      );
    }
    return tank;
  }

  private async resolveSingleFuelTankForReceipt(input: {
    companyId: string;
    branchId: string;
    productId: string;
    productLabel: string;
    productIsFuel: boolean;
    tx: Prisma.TransactionClient;
  }): Promise<FuelTankReceiptTarget | null> {
    const tanks = await input.tx.fuelTank.findMany({
      where: {
        companyId: input.companyId,
        branchId: input.branchId,
        productId: input.productId,
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: { id: true, tankCode: true, tankName: true },
      orderBy: { tankCode: 'asc' },
    });

    if (tanks.length === 0) {
      if (input.productIsFuel) {
        throw new BadRequestException(
          `Fuel product "${input.productLabel}" has no active tank at the purchase order receiving branch. Create a Petroleum fuel tank or select a tank allocation before receiving.`,
        );
      }
      return null;
    }
    if (tanks.length > 1) {
      throw new BadRequestException(
        'This fuel product has multiple active tanks at the receiving branch. Select the destination tank in the Operations receive modal or receive it through Petroleum > Fuel Deliveries.',
      );
    }
    return tanks[0];
  }

  private async postOperationsFuelReceipts(input: {
    order: {
      id: string;
      purchaseOrderNumber: string;
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
      supplierId: string | null;
      supplierName: string | null;
      expectedDate: Date | null;
      currency: string;
    };
    receipts: FuelPurchaseReceipt[];
    receivedAt: Date;
    userId: string;
    tx: Prisma.TransactionClient;
  }) {
    if (input.receipts.length === 0) return;

    for (const receipt of input.receipts) {
      const existingPostedDelivery = await input.tx.fuelDelivery.findFirst({
        where: {
          purchaseOrderId: input.order.id,
          tankId: receipt.tankId,
          productId: receipt.productId,
          status: 'POSTED',
          deletedAt: null,
        },
        select: { id: true },
      });
      if (existingPostedDelivery) {
        throw new BadRequestException(
          'A posted petroleum delivery already exists for this purchase order and tank. Avoid receiving the same fuel purchase twice.',
        );
      }

      if (input.order.supplierId) {
        const deliveryNumber = await this.codes.next({
          entityType: 'FuelDelivery',
          companyId: input.order.companyId,
          tx: input.tx,
        });
        const unitCost =
          receipt.quantity > 0 ? roundMoney(receipt.totalCost / receipt.quantity) : undefined;

        await input.tx.fuelDelivery.create({
          data: {
            deliveryNumber,
            companyId: input.order.companyId,
            branchId: input.order.branchId!,
            supplierId: input.order.supplierId,
            productId: receipt.productId,
            tankId: receipt.tankId,
            purchaseOrderId: input.order.id,
            deliveryDate: input.receivedAt,
            deliveryNoteNumber: input.order.purchaseOrderNumber,
            orderedLitres: receipt.quantity,
            deliveredLitres: receipt.quantity,
            acceptedLitres: receipt.quantity,
            rejectedLitres: 0,
            unitCost,
            totalCost: roundMoney(receipt.totalCost),
            notes: `Auto-posted from Operations purchase order ${input.order.purchaseOrderNumber}`,
            status: 'POSTED',
            receivedById: input.userId,
            approvedById: input.userId,
            approvedAt: input.receivedAt,
            postedById: input.userId,
            postedAt: input.receivedAt,
          },
        });
      }

      await input.tx.fuelTank.update({
        where: { id: receipt.tankId },
        data: { currentBookBalance: { increment: receipt.quantity } },
      });
    }
  }

  /**
   * Cash-purchase receipt ledger: DR Inventory/Asset/Expense, CR Cash-on-hand for
   * the full order total. Only ever called for CASH_PURCHASE — a cash purchase
   * settles at receipt and is never carried through the supplier-invoice/AP flow,
   * so this posting is owned solely by the PO. Credit purchases post NO ledger here
   * (AP and the matching inventory debit are owned by the supplier-invoice approve
   * flow); see the AP-ownership note in receive() and audit findings #1/#7.
   */
  private async postPurchaseOrderCashReceiptLedger(input: {
    order: {
      id: string;
      purchaseOrderNumber: string;
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
      purchaseType: PurchaseType;
      totalAmount: Prisma.Decimal | number | string;
    };
    transactionDate: Date;
    userId: string;
    tx: Prisma.TransactionClient;
  }) {
    const amount = roundMoney(Number(input.order.totalAmount));
    if (amount <= 0) {
      throw new BadRequestException('Purchase order total must be greater than zero to post');
    }

    const debitRole = purchaseDebitRole(input.order.purchaseType);
    const creditRole: AccountRole = 'CASH_ON_HAND';
    const accounts = await this.accountResolver.resolveMany(
      input.order.companyId,
      [debitRole, creditRole],
      input.tx,
    );
    const description = `Purchase order ${input.order.purchaseOrderNumber}`;

    return this.postingEngine.postLines(
      {
        companyId: input.order.companyId,
        divisionId: input.order.divisionId,
        branchId: input.order.branchId,
        transactionDate: input.transactionDate,
        description,
        referenceType: 'PurchaseOrder',
        referenceId: input.order.id,
        moduleName: 'purchase-orders',
        userId: input.userId,
        lines: [
          {
            accountId: accounts[debitRole].id,
            description:
              debitRole === 'INVENTORY_ASSET'
                ? 'Inventory received'
                : debitRole === 'FIXED_ASSET'
                  ? 'Asset purchased'
                  : 'Purchase expense',
            debit: amount,
            credit: 0,
          },
          {
            accountId: accounts[creditRole].id,
            description: 'Cash paid',
            debit: 0,
            credit: amount,
          },
        ],
      },
      input.tx,
    );
  }

  async cancel(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'CONFIRMED'].includes(existing.status as string)) {
      throw new BadRequestException('Only DRAFT or CONFIRMED purchase orders can be cancelled');
    }

    const record = await this.prisma.$transaction(async (tx) => {
      if (existing.payableId) {
        const cancelledPayable = await tx.payable.update({
          where: { id: existing.payableId },
          data: {
            status: 'CANCELLED',
            outstandingAmount: 0,
          },
        });
        await this.syncSupplierBalance(tx, cancelledPayable.companyId, cancelledPayable.supplierId);
      }

      // Audit finding #19: reset the PO row's outstanding so the cancelled order
      // no longer feeds summary()'s outstandingAmount roll-up. cancel() already
      // zeroes the linked Payable's outstanding above; the PO row must move with
      // it or the purchasing workbench keeps reporting exposure that no longer
      // exists. (PaymentStatus has no CANCELLED member — status='CANCELLED' on the
      // order already signals the lifecycle state — so we only zero the money.)
      return tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CANCELLED', outstandingAmount: 0 },
      });
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

  private async syncSupplierBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    supplierId?: string | null,
  ) {
    if (!supplierId) return;
    const summary = await tx.payable.aggregate({
      where: {
        companyId,
        supplierId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as any },
      },
      _sum: { outstandingAmount: true },
    });
    await tx.supplier.updateMany({
      where: { id: supplierId, companyId, deletedAt: null },
      data: { currentBalance: summary._sum.outstandingAmount ?? 0 },
    });
  }
}

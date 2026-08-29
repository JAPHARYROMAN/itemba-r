import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { InventoryMovementsService } from '../inventory-movements/inventory-movements.service';
import { TaxAutoApplyService } from '../tax-auto-apply/tax-auto-apply.service';
import { PostingEngineService } from '../accounting-engine/posting-engine.service';
import { EntityCodeGeneratorService } from '../entity-code-generator/entity-code-generator.service';
import {
  AccountResolverService,
  AccountRole,
  CompanyScopeService,
  assertCashAccountForScope,
} from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CreateSalesOrderDto, SalesOrderLineDto } from './dto/create-sales-order.dto';
import { UpdateSalesOrderDto } from './dto/update-sales-order.dto';
import { QuerySalesOrderDto } from './dto/query-sales-order.dto';
import { ProfitService, SaleLineProfitSnapshot } from '../profit/profit.service';
import {
  AccessLevel,
  AuditSeverity,
  CashAccountType,
  CurrencyCode,
  PaymentStatus,
  Prisma,
  SalesPaymentMethod,
  SalesOrderStatus,
  SalesType,
} from '@prisma/client';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';

type SalesOrderReferenceIds = {
  divisionId?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  salespersonId?: string | null;
  cashAccountId?: string | null;
  paymentMethod?: SalesPaymentMethod | null;
  lines?: SalesOrderLineDto[];
};

type SalesOrderCreateContext = {
  mobilePosTerminalId?: string;
};

type LinkedReceivableSnapshot = {
  id: string;
  sourceId: string | null;
  paidAmount: Prisma.Decimal | number | string;
  outstandingAmount: Prisma.Decimal | number | string;
  status: string;
};

const RECEIPT_ACCOUNT_TYPES = [
  CashAccountType.CASH_ON_HAND,
  CashAccountType.PETTY_CASH,
  CashAccountType.BANK,
  CashAccountType.MOBILE_MONEY,
  CashAccountType.OTHER,
];

function accountTypesForPaymentMethod(method?: SalesPaymentMethod | null): CashAccountType[] {
  switch (method) {
    case SalesPaymentMethod.CASH:
      return [CashAccountType.CASH_ON_HAND, CashAccountType.PETTY_CASH];
    case SalesPaymentMethod.BANK_CARD:
    case SalesPaymentMethod.BANK_TRANSFER:
      return [CashAccountType.BANK];
    case SalesPaymentMethod.MOBILE_MONEY:
      return [CashAccountType.MOBILE_MONEY];
    case SalesPaymentMethod.MIXED:
    case SalesPaymentMethod.OTHER:
      return RECEIPT_ACCOUNT_TYPES;
    default:
      return [];
  }
}

function cashAccountRole(accountType?: CashAccountType | null): AccountRole {
  return accountType === CashAccountType.BANK ? 'BANK' : 'CASH_ON_HAND';
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Tanzania standard output-VAT rate (percentage points). Used as the fallback
 * rate when a taxable product carries no explicit `taxRate` of its own. Kept as
 * a percentage value (18, not 0.18) to match Product.taxRate semantics.
 */
const STANDARD_VAT_RATE_PERCENT = 18;

function normalizePaymentMethodForSalesType(
  salesType: SalesType,
  paymentMethod?: SalesPaymentMethod | null,
): SalesPaymentMethod {
  if (salesType === SalesType.CASH_SALE || salesType === SalesType.RETAIL) {
    return paymentMethod && paymentMethod !== SalesPaymentMethod.CREDIT
      ? paymentMethod
      : SalesPaymentMethod.CASH;
  }

  if (salesType === SalesType.CREDIT_SALE) {
    return SalesPaymentMethod.CREDIT;
  }

  return paymentMethod ?? SalesPaymentMethod.CREDIT;
}

function hasPermission(user: AuthUser, permission: string) {
  return user.permissions?.includes(permission) ?? false;
}

function calculateLineTotals(
  lines: {
    productId: string;
    description?: string;
    quantity: number;
    unitId: string;
    unitPrice: number;
    discountAmount?: number;
    taxAmount?: number;
    batchId?: string;
  }[],
) {
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  const computed = lines.map((line) => {
    const qty = Number(line.quantity);
    const price = Number(line.unitPrice);
    const unitDiscount = Number(line.discountAmount ?? 0);
    const tax = Number(line.taxAmount ?? 0);
    // Defensive server-side validation (ITMB-003/ITMB-041): reject quantities,
    // prices, discounts or taxes that would corrupt totals or inventory. The
    // DTO already enforces these, but recompute here so update() (which can
    // reuse stored lines) and any future caller cannot bypass the guard.
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new BadRequestException('Sales order line quantity must be greater than zero');
    }
    if (!Number.isFinite(price) || price <= 0) {
      throw new BadRequestException('Sales order line unit price must be greater than zero');
    }
    if (!Number.isFinite(unitDiscount) || unitDiscount < 0) {
      throw new BadRequestException('Sales order line discount per unit cannot be negative');
    }
    if (!Number.isFinite(tax) || tax < 0) {
      throw new BadRequestException('Sales order line tax cannot be negative');
    }
    const extended = qty * price;
    if (unitDiscount > price) {
      throw new BadRequestException(
        'Sales order line discount per unit cannot exceed the unit price',
      );
    }
    const discount = qty * unitDiscount;
    const lineTotal = extended - discount + tax;
    subtotal += extended;
    totalDiscount += discount;
    totalTax += tax;
    return { ...line, discountAmount: discount, lineTotal };
  });

  const totalAmount = subtotal - totalDiscount + totalTax;
  return { computed, subtotal, totalDiscount, totalTax, totalAmount };
}

type SalesOrderTotals = ReturnType<typeof calculateLineTotals>;

/**
 * Fold an order-level (document) discount into the line-derived totals.
 *
 * The document discount is a flat currency amount deducted from the whole order
 * ON TOP OF the per-line discounts. It is treated as a PRE-TAX reduction of the
 * revenue base: it lowers `totalAmount` (and therefore the posted revenue, the
 * AR/cash debit, and the receivable) but does NOT recompute VAT — exactly how
 * per-line discounts behave in `calculateLineTotals`, where `taxAmount` is the
 * caller-supplied per-line value and is never re-derived from the net base.
 *
 * `discountAmount` on the order accumulates both the per-line discount total and
 * the document discount so the persisted, displayed, and posted figures agree.
 *
 * Guards (defensive; the DTO already enforces `>= 0`): rejects a negative or
 * non-finite discount and one that exceeds the net-of-line-discount subtotal
 * (`subtotal - totalDiscount`) so the order total can never go negative and
 * revenue stays non-negative. Default 0 leaves the totals untouched
 * (backward-compatible).
 */
function applyDocumentDiscount(
  totals: SalesOrderTotals,
  documentDiscountInput?: number | null,
): SalesOrderTotals & { documentDiscount: number } {
  const documentDiscount = roundMoney(Number(documentDiscountInput ?? 0));
  if (!Number.isFinite(documentDiscount) || documentDiscount < 0) {
    throw new BadRequestException('Document discount cannot be negative');
  }
  const netLineSubtotal = roundMoney(totals.subtotal - totals.totalDiscount);
  if (documentDiscount > netLineSubtotal) {
    throw new BadRequestException(
      'Document discount cannot exceed the order subtotal after line discounts',
    );
  }
  if (documentDiscount === 0) {
    return { ...totals, documentDiscount: 0 };
  }
  return {
    ...totals,
    // Roll the document discount into the aggregate discount total so the order's
    // discountAmount reflects every reduction applied to the sale.
    totalDiscount: roundMoney(totals.totalDiscount + documentDiscount),
    totalAmount: roundMoney(totals.totalAmount - documentDiscount),
    documentDiscount,
  };
}

function salesLineProfitData(snapshot: SaleLineProfitSnapshot | undefined) {
  if (!snapshot) return {};
  return {
    unitCostAtSale: snapshot.unitCostAtSale,
    cogsAmount: snapshot.cogsAmount,
    grossProfitAmount: snapshot.grossProfitAmount,
    grossMarginPct: snapshot.grossMarginPct,
    profitCostSource: snapshot.profitCostSource,
  };
}

type IdempotentSalesOrderSnapshot = {
  companyId: string;
  divisionId: string | null;
  branchId: string | null;
  customerId: string | null;
  customerName: string | null;
  salesType: SalesType;
  orderDate: Date | string;
  dueDate: Date | string | null;
  currency: CurrencyCode;
  paymentMethod: SalesPaymentMethod | null;
  cashAccountId: string | null;
  subtotal: Prisma.Decimal | number | string;
  discountAmount: Prisma.Decimal | number | string;
  documentDiscount: Prisma.Decimal | number | string;
  taxAmount: Prisma.Decimal | number | string;
  totalAmount: Prisma.Decimal | number | string;
  lines: Array<{
    productId: string;
    quantity: Prisma.Decimal | number | string;
    unitId: string;
    unitPrice: Prisma.Decimal | number | string;
    discountAmount: Prisma.Decimal | number | string | null;
    taxAmount: Prisma.Decimal | number | string | null;
    batchId: string | null;
  }>;
};

function dateKey(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function moneyValue(value: Prisma.Decimal | number | string | null | undefined) {
  return roundMoney(Number(value ?? 0));
}

function sameMoney(left: Prisma.Decimal | number | string | null | undefined, right: number) {
  return Math.abs(moneyValue(left) - roundMoney(right)) < 0.01;
}

function normalizeCustomerName(value?: string | null) {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function isGenericWalkInName(value?: string | null) {
  const normalized = normalizeCustomerName(value)?.toLowerCase();
  if (!normalized) return true;
  return new Set([
    'walk-in',
    'walk in',
    'walkin',
    'walk-in customer',
    'walk in customer',
    'customer',
    'cash customer',
  ]).has(normalized);
}

function sameSalesOrderCustomer(existing: IdempotentSalesOrderSnapshot, dto: CreateSalesOrderDto) {
  if (dto.customerId) return existing.customerId === dto.customerId;
  return normalizeCustomerName(existing.customerName) === normalizeCustomerName(dto.customerName);
}

function salesOrderReceivableCustomerName(order: {
  customer?: { name?: string | null } | null;
  customerName?: string | null;
}) {
  return (
    normalizeCustomerName(order.customer?.name) ??
    normalizeCustomerName(order.customerName) ??
    'Walk-in Customer'
  );
}

function lineSignature(line: {
  productId: string;
  quantity: Prisma.Decimal | number | string;
  unitId: string;
  unitPrice: Prisma.Decimal | number | string;
  discountAmount?: Prisma.Decimal | number | string | null;
  taxAmount?: Prisma.Decimal | number | string | null;
  batchId?: string | null;
}) {
  return [
    line.productId,
    line.unitId,
    line.batchId ?? '',
    moneyValue(line.quantity).toFixed(3),
    moneyValue(line.unitPrice).toFixed(2),
    moneyValue(line.discountAmount).toFixed(2),
    moneyValue(line.taxAmount).toFixed(2),
  ].join('|');
}

function idempotentSalesOrderMatchesDto(
  existing: IdempotentSalesOrderSnapshot,
  dto: CreateSalesOrderDto,
) {
  const paymentMethod = normalizePaymentMethodForSalesType(dto.salesType, dto.paymentMethod);
  const cashAccountId =
    paymentMethod === SalesPaymentMethod.CREDIT ? null : (dto.cashAccountId ?? null);
  // Fold the document discount in the same way create() does so an idempotent
  // replay of a discounted order matches the persisted totals instead of
  // falsely reporting a payload mismatch.
  const { computed, subtotal, totalDiscount, totalTax, totalAmount, documentDiscount } =
    applyDocumentDiscount(calculateLineTotals(dto.lines), dto.documentDiscount);
  const expectedLines = computed.map(lineSignature).sort();
  const existingLines = existing.lines.map(lineSignature).sort();

  return (
    existing.companyId === dto.companyId &&
    existing.divisionId === (dto.divisionId ?? null) &&
    existing.branchId === (dto.branchId ?? null) &&
    sameSalesOrderCustomer(existing, dto) &&
    existing.salesType === dto.salesType &&
    dateKey(existing.orderDate) === dateKey(dto.orderDate) &&
    dateKey(existing.dueDate) === dateKey(dto.dueDate) &&
    existing.currency === dto.currency &&
    existing.paymentMethod === paymentMethod &&
    existing.cashAccountId === cashAccountId &&
    sameMoney(existing.subtotal, subtotal) &&
    sameMoney(existing.discountAmount, totalDiscount) &&
    sameMoney(existing.documentDiscount, documentDiscount) &&
    sameMoney(existing.taxAmount, totalTax) &&
    sameMoney(existing.totalAmount, totalAmount) &&
    existingLines.length === expectedLines.length &&
    existingLines.every((signature, index) => signature === expectedLines[index])
  );
}

@Injectable()
export class SalesOrdersService {
  private readonly logger = new Logger(SalesOrdersService.name);
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

  private async resolveSalesOrderCustomer(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      divisionId?: string | null;
      branchId?: string | null;
      customerId?: string | null;
      customerName?: string | null;
      userId: string;
    },
  ): Promise<{ customerId: string | null; customerName: string | null }> {
    if (input.customerId) {
      const customer = await tx.customer.findFirst({
        where: { id: input.customerId, companyId: input.companyId, deletedAt: null },
        select: { id: true, name: true, status: true },
      });
      if (!customer) throw new BadRequestException('Customer does not belong to this company');
      if (customer.status === 'BLOCKED') {
        throw new BadRequestException('Blocked customers cannot be used on sales orders');
      }
      return { customerId: customer.id, customerName: customer.name };
    }

    const customerName = normalizeCustomerName(input.customerName);
    if (!customerName) return { customerId: null, customerName: null };
    if (isGenericWalkInName(customerName)) return { customerId: null, customerName };
    if (!input.branchId) {
      throw new BadRequestException('Branch/location is required to save a walk-in customer');
    }

    const branch = await tx.branch.findFirst({
      where: { id: input.branchId, deletedAt: null },
      select: { divisionId: true, division: { select: { companyId: true } } },
    });
    if (!branch || branch.division.companyId !== input.companyId) {
      throw new BadRequestException('Branch does not belong to this company');
    }
    if (input.divisionId && branch.divisionId !== input.divisionId) {
      throw new BadRequestException('Branch does not belong to the selected division');
    }

    const existing = await tx.customer.findFirst({
      where: {
        companyId: input.companyId,
        branchId: input.branchId,
        deletedAt: null,
        name: { equals: customerName, mode: 'insensitive' },
      },
      select: { id: true, name: true },
    });
    if (existing) return { customerId: existing.id, customerName: existing.name };

    const customerCode = await this.codes.next({
      entityType: 'Customer',
      companyId: input.companyId,
      tx,
    });
    const created = await tx.customer.create({
      data: {
        customerCode,
        companyId: input.companyId,
        divisionId: input.divisionId ?? branch.divisionId,
        branchId: input.branchId,
        customerType: 'WALK_IN',
        name: customerName,
        status: 'ACTIVE',
        notes: 'Auto-created from a sales order walk-in customer name.',
        createdById: input.userId,
        updatedById: input.userId,
      },
      select: { id: true, name: true },
    });

    return { customerId: created.id, customerName: created.name };
  }

  private async salesOrderWhere(query: QuerySalesOrderDto, user: AuthUser) {
    const {
      companyId,
      divisionId,
      branchId,
      customerId,
      salespersonId,
      salesType,
      status,
      paymentStatus,
      paymentMethod,
      dateFrom,
      dateTo,
      search,
    } = query;

    const where: any = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, companyId)),
    };

    if (divisionId) where.divisionId = divisionId;
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (salespersonId) where.salespersonId = salespersonId;
    if (salesType) where.salesType = salesType;
    if (status) where.status = status;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (dateFrom || dateTo) {
      where.orderDate = {};
      if (dateFrom) where.orderDate.gte = dateRangeStart(dateFrom);
      if (dateTo) where.orderDate.lte = dateRangeEnd(dateTo);
    }
    if (search?.trim()) {
      const term = search.trim();
      where.OR = [
        { salesOrderNumber: { contains: term, mode: 'insensitive' } },
        { customerName: { contains: term, mode: 'insensitive' } },
        { customer: { is: { name: { contains: term, mode: 'insensitive' } } } },
        { customer: { is: { customerCode: { contains: term, mode: 'insensitive' } } } },
        { branch: { is: { name: { contains: term, mode: 'insensitive' } } } },
        { division: { is: { name: { contains: term, mode: 'insensitive' } } } },
      ];
    }

    return where;
  }

  async findAll(query: QuerySalesOrderDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where = await this.salesOrderWhere(query, user);

    const [data, total] = await Promise.all([
      this.prisma.salesOrder.findMany({
        where,
        include: {
          company: { select: { id: true, name: true, code: true } },
          division: { select: { id: true, name: true, code: true } },
          branch: { select: { id: true, name: true, code: true } },
          customer: {
            select: {
              id: true,
              name: true,
              customerCode: true,
              creditLimit: true,
              currentBalance: true,
              status: true,
            },
          },
          salesperson: {
            select: { id: true, employeeCode: true, firstName: true, lastName: true },
          },
          cashAccount: {
            select: { id: true, accountName: true, accountType: true, currency: true },
          },
          receivable: {
            select: {
              id: true,
              receivableNumber: true,
              sourceId: true,
              paidAmount: true,
              outstandingAmount: true,
              status: true,
            },
          },
          lines: {
            include: {
              product: { select: { id: true, name: true } },
              unit: { select: { id: true, name: true, symbol: true } },
            },
          },
          deliveryNotes: {
            where: { deletedAt: null },
            select: { id: true, deliveryNoteNumber: true, status: true },
            orderBy: { createdAt: 'desc' },
            take: 3,
          },
        },
        orderBy: { orderDate: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.salesOrder.count({ where }),
    ]);

    const sourceReceivables = await this.findSalesOrderSourceReceivables(
      data.map((order) => order.id),
    );

    return {
      data: data.map((order) =>
        this.withReceivablePaymentSnapshot(order, sourceReceivables.get(order.id)),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async workbenchSummary(query: QuerySalesOrderDto, user: AuthUser) {
    const where = await this.salesOrderWhere(query, user);
    const today = new Date();

    const confirmedStatuses: SalesOrderStatus[] = [
      SalesOrderStatus.CONFIRMED,
      SalesOrderStatus.PARTIALLY_PAID,
      SalesOrderStatus.PAID,
    ];
    const deadStatuses: SalesOrderStatus[] = [SalesOrderStatus.CANCELLED, SalesOrderStatus.VOIDED];
    // Live = everything except CANCELLED/VOIDED. Reused for every money rollup
    // and the count predicates below so the exclusion stays consistent.
    const liveWhere = { ...where, status: { notIn: deadStatuses } };

    // Push the per-status counts and the money rollups into the database
    // instead of loading every row and reducing in JS. groupBy gives us the
    // status histogram (totalOrders/draft/confirmed/cancelled) in one query;
    // _sum over the live subset gives revenue/outstanding/paidAmount.
    const [statusGroups, liveTotals, unpaidCount, overdueCreditOrders] = await Promise.all([
      this.prisma.salesOrder.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.salesOrder.aggregate({
        where: liveWhere,
        _sum: { totalAmount: true, outstandingAmount: true, paidAmount: true },
      }),
      this.prisma.salesOrder.count({
        where: { ...liveWhere, paymentStatus: { not: PaymentStatus.PAID } },
      }),
      this.prisma.salesOrder.count({
        where: {
          ...liveWhere,
          paymentMethod: SalesPaymentMethod.CREDIT,
          outstandingAmount: { gt: 0 },
          dueDate: { not: null, lt: today },
        },
      }),
    ]);

    const countByStatus = new Map(statusGroups.map((group) => [group.status, group._count._all]));
    const sumStatuses = (statuses: SalesOrderStatus[]) =>
      statuses.reduce((sum, status) => sum + (countByStatus.get(status) ?? 0), 0);
    const totalOrders = statusGroups.reduce((sum, group) => sum + group._count._all, 0);

    return {
      totalOrders,
      draft: countByStatus.get(SalesOrderStatus.DRAFT) ?? 0,
      confirmed: sumStatuses(confirmedStatuses),
      cancelled: sumStatuses(deadStatuses),
      revenue: roundMoney(moneyValue(liveTotals._sum.totalAmount)),
      outstanding: roundMoney(moneyValue(liveTotals._sum.outstandingAmount)),
      paidAmount: roundMoney(moneyValue(liveTotals._sum.paidAmount)),
      unpaidCount,
      overdueCreditOrders,
      blockedFailedActionCount: 0,
    };
  }

  async customerDaySummary(query: QuerySalesOrderDto, user: AuthUser) {
    const { page = 1, limit = 20 } = query;
    const skip = (page - 1) * limit;
    const where = await this.salesOrderWhere(query, user);

    const orders = await this.prisma.salesOrder.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        customer: { select: { id: true, name: true, customerCode: true } },
        salesperson: {
          select: { id: true, employeeCode: true, firstName: true, lastName: true },
        },
        receivable: {
          select: {
            id: true,
            receivableNumber: true,
            sourceId: true,
            paidAmount: true,
            outstandingAmount: true,
            status: true,
          },
        },
      },
      orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
    });

    const sourceReceivables = await this.findSalesOrderSourceReceivables(
      orders.map((order) => order.id),
    );
    const groups = new Map<string, any>();

    for (const rawOrder of orders) {
      const order: any = this.withReceivablePaymentSnapshot(
        rawOrder,
        sourceReceivables.get(rawOrder.id),
      );
      const day = dateKey(order.orderDate) ?? 'unknown-date';
      const manualName = normalizeCustomerName(order.customerName);
      const customerName =
        order.customer?.name ??
        (manualName && !isGenericWalkInName(manualName) ? manualName : 'Walk-in Customer');
      const customerKey = order.customerId
        ? `customer:${order.customerId}`
        : `manual:${customerName.toLowerCase()}`;
      const currency = String(order.currency ?? 'TZS');
      const key = `${day}:${customerKey}:${currency}`;

      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          date: day,
          currency,
          customer: {
            id: order.customerId ?? null,
            name: customerName,
            customerCode: order.customer?.customerCode ?? null,
            isWalkIn: !order.customerId,
          },
          orderCount: 0,
          totalAmount: 0,
          paidAmount: 0,
          outstandingAmount: 0,
          statusCounts: {},
          paymentStatusCounts: {},
          orders: [],
        });
      }

      const group = groups.get(key);
      const status = String(order.status ?? 'UNKNOWN');
      const paymentStatus = String(order.paymentStatus ?? 'UNKNOWN');
      group.orderCount += 1;
      group.totalAmount = roundMoney(group.totalAmount + moneyValue(order.totalAmount));
      group.paidAmount = roundMoney(group.paidAmount + moneyValue(order.paidAmount));
      group.outstandingAmount = roundMoney(
        group.outstandingAmount + moneyValue(order.outstandingAmount),
      );
      group.statusCounts[status] = (group.statusCounts[status] ?? 0) + 1;
      group.paymentStatusCounts[paymentStatus] =
        (group.paymentStatusCounts[paymentStatus] ?? 0) + 1;
      group.orders.push({
        id: order.id,
        salesOrderNumber: order.salesOrderNumber,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        customerName,
        receivableId: order.receivableId ?? order.receivable?.id ?? null,
        companyId: order.companyId,
        divisionId: order.divisionId,
        branchId: order.branchId,
        company: order.company,
        division: order.division,
        branch: order.branch,
        salesperson: order.salesperson,
        salesType: order.salesType,
        status: order.status,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        currency,
        totalAmount: moneyValue(order.totalAmount),
        paidAmount: moneyValue(order.paidAmount),
        outstandingAmount: moneyValue(order.outstandingAmount),
      });
    }

    const data = Array.from(groups.values()).sort((left, right) => {
      const dayCompare = String(right.date).localeCompare(String(left.date));
      if (dayCompare !== 0) return dayCompare;
      return String(left.customer.name).localeCompare(String(right.customer.name));
    });
    const total = data.length;

    return {
      data: data.slice(skip, skip + limit),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  private async loadControlCenterOrder(
    id: string,
    user: AuthUser,
    minimum: AccessLevel = AccessLevel.READ,
  ) {
    const record = await this.prisma.salesOrder.findFirst({
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
          },
        },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true, address: true, phone: true } },
        customer: {
          select: {
            id: true,
            name: true,
            customerCode: true,
            phone: true,
            email: true,
            address: true,
            creditLimit: true,
            currentBalance: true,
            paymentTerms: true,
            status: true,
          },
        },
        salesperson: {
          select: { id: true, employeeCode: true, firstName: true, lastName: true },
        },
        cashAccount: {
          select: {
            id: true,
            accountName: true,
            accountType: true,
            currency: true,
            currentBalance: true,
          },
        },
        receivable: {
          select: {
            id: true,
            receivableNumber: true,
            sourceId: true,
            amount: true,
            paidAmount: true,
            outstandingAmount: true,
            status: true,
            issueDate: true,
            dueDate: true,
            customer: { select: { id: true, name: true, customerCode: true } },
          },
        },
        createdBy: { select: { id: true, fullName: true, email: true } },
        confirmedBy: { select: { id: true, fullName: true, email: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                productCode: true,
                sku: true,
                name: true,
                productType: true,
                trackInventory: true,
                category: { select: { id: true, name: true, categoryType: true } },
                productFamily: { select: { id: true, name: true, brand: true } },
              },
            },
            unit: { select: { id: true, name: true, symbol: true } },
            batch: true,
          },
        },
        deliveryNotes: {
          where: { deletedAt: null },
          include: {
            deliveredBy: { select: { id: true, fullName: true, email: true } },
            lines: {
              include: {
                product: { select: { id: true, productCode: true, name: true } },
                unit: { select: { id: true, name: true, symbol: true } },
              },
            },
          },
          orderBy: { deliveryDate: 'desc' },
        },
        commissions: {
          where: { deletedAt: null },
          include: {
            employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          },
          orderBy: { createdAt: 'desc' },
        },
        proformaInvoices: {
          where: { deletedAt: null },
          select: {
            id: true,
            proformaNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
        quotations: {
          where: { deletedAt: null },
          select: {
            id: true,
            quotationNumber: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    if (!record) throw new NotFoundException('Sales order not found');
    await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);

    const sourceReceivable = record.receivable
      ? null
      : await this.prisma.receivable.findFirst({
          where: { sourceType: 'SalesOrder', sourceId: id, deletedAt: null },
          select: {
            id: true,
            receivableNumber: true,
            sourceId: true,
            amount: true,
            paidAmount: true,
            outstandingAmount: true,
            status: true,
            issueDate: true,
            dueDate: true,
            customer: { select: { id: true, name: true, customerCode: true } },
          },
          orderBy: { updatedAt: 'desc' },
        });

    return this.withReceivablePaymentSnapshot(record, sourceReceivable);
  }

  async controlCenter(id: string, user: AuthUser) {
    const order = await this.loadControlCenterOrder(id, user);
    const [ledger, fulfillment, profit] = await Promise.all([
      this.ledger(id, user),
      this.fulfillment(id, user),
      this.salesOrderProfit(id, user),
    ]);
    const stockBalances = await this.prisma.inventoryBalance.findMany({
      where: {
        companyId: order.companyId,
        branchId: order.branchId ?? null,
        productId: { in: order.lines.map((line) => line.productId) },
      },
      select: {
        productId: true,
        quantityOnHand: true,
        quantityReserved: true,
        averageCost: true,
        totalValue: true,
      },
    });
    const stockByProduct = new Map(stockBalances.map((balance) => [balance.productId, balance]));
    const orderWithStock = {
      ...order,
      lines: order.lines.map((line) => ({
        ...line,
        stockSnapshot: stockByProduct.get(line.productId) ?? null,
      })),
    };

    const creditLimit = moneyValue(order.customer?.creditLimit);
    const currentBalance = moneyValue(order.customer?.currentBalance);

    return {
      order: orderWithStock,
      customerCredit: order.customer
        ? {
            customerId: order.customer.id,
            status: order.customer.status,
            creditLimit,
            currentBalance,
            availableCredit: Math.max(0, roundMoney(creditLimit - currentBalance)),
          }
        : null,
      ledger,
      fulfillment,
      profit,
      audit: {
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
        createdBy: order.createdBy,
        confirmedAt: order.confirmedAt,
        confirmedBy: order.confirmedBy,
      },
    };
  }

  async ledger(id: string, user: AuthUser) {
    const order = await this.loadControlCenterOrder(id, user);
    const [journalEntry, sourceReceivable] = await Promise.all([
      order.journalEntryId
        ? this.prisma.journalEntry.findFirst({
            where: { id: order.journalEntryId, companyId: order.companyId, deletedAt: null },
            include: {
              lines: {
                include: {
                  account: {
                    select: { id: true, accountCode: true, accountName: true, accountType: true },
                  },
                },
              },
              createdBy: { select: { id: true, fullName: true } },
              postedBy: { select: { id: true, fullName: true } },
            },
          })
        : this.prisma.journalEntry.findFirst({
            where: {
              companyId: order.companyId,
              referenceType: 'SalesOrder',
              referenceId: id,
              deletedAt: null,
            },
            include: {
              lines: {
                include: {
                  account: {
                    select: { id: true, accountCode: true, accountName: true, accountType: true },
                  },
                },
              },
              createdBy: { select: { id: true, fullName: true } },
              postedBy: { select: { id: true, fullName: true } },
            },
            orderBy: { createdAt: 'desc' },
          }),
      order.receivableId
        ? this.prisma.receivable.findFirst({
            where: { id: order.receivableId, companyId: order.companyId, deletedAt: null },
            include: {
              customer: { select: { id: true, name: true, customerCode: true } },
              journalEntry: {
                include: {
                  lines: {
                    include: {
                      account: {
                        select: {
                          id: true,
                          accountCode: true,
                          accountName: true,
                          accountType: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          })
        : this.prisma.receivable.findFirst({
            where: {
              companyId: order.companyId,
              sourceType: 'SalesOrder',
              sourceId: id,
              deletedAt: null,
            },
            include: {
              customer: { select: { id: true, name: true, customerCode: true } },
              journalEntry: {
                include: {
                  lines: {
                    include: {
                      account: {
                        select: {
                          id: true,
                          accountCode: true,
                          accountName: true,
                          accountType: true,
                        },
                      },
                    },
                  },
                },
              },
            },
            orderBy: { updatedAt: 'desc' },
          }),
    ]);

    return {
      orderId: id,
      companyId: order.companyId,
      payment: {
        method: order.paymentMethod,
        reference: order.paymentReference,
        status: order.paymentStatus,
        paidAmount: order.paidAmount,
        outstandingAmount: order.outstandingAmount,
        cashAccount: order.cashAccount,
      },
      receivable: sourceReceivable,
      journalEntry: journalEntry ?? sourceReceivable?.journalEntry ?? null,
    };
  }

  async fulfillment(id: string, user: AuthUser) {
    const order = await this.loadControlCenterOrder(id, user);
    const inventoryMovements = await this.prisma.inventoryMovement.findMany({
      where: {
        companyId: order.companyId,
        referenceType: 'SalesOrder',
        referenceId: id,
      },
      include: {
        branch: { select: { id: true, code: true, name: true } },
        product: { select: { id: true, productCode: true, name: true } },
        unit: { select: { id: true, name: true, symbol: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
      orderBy: { movementDate: 'desc' },
    });

    const statuses = order.deliveryNotes.map((note) => String(note.status));
    const fulfillmentStatus =
      order.status === SalesOrderStatus.DRAFT
        ? 'DRAFT'
        : statuses.length === 0
          ? 'AWAITING_DELIVERY'
          : statuses.some((status) => ['DELIVERED', 'CLOSED'].includes(status))
            ? 'DELIVERED'
            : statuses.some((status) =>
                  ['DISPATCHED', 'PARTIALLY_DELIVERED', 'IN_TRANSIT'].includes(status),
                )
              ? 'IN_PROGRESS'
              : 'OPEN';

    return {
      orderId: id,
      summary: {
        status: fulfillmentStatus,
        deliveryNoteCount: order.deliveryNotes.length,
        inventoryMovementCount: inventoryMovements.length,
        issuedQuantity: roundMoney(
          inventoryMovements.reduce(
            (sum, movement) => sum + Math.abs(moneyValue(movement.quantity)),
            0,
          ),
        ),
      },
      deliveryNotes: order.deliveryNotes,
      inventoryMovements,
    };
  }

  async salesOrderProfit(id: string, user: AuthUser) {
    const order = await this.loadControlCenterOrder(id, user);
    const lines = order.lines.map((line) => {
      const revenueExTax = moneyValue(line.lineTotal) - moneyValue(line.taxAmount);
      const cogs = moneyValue(line.cogsAmount);
      const grossProfit =
        line.grossProfitAmount == null
          ? roundMoney(revenueExTax - cogs)
          : moneyValue(line.grossProfitAmount);
      return {
        id: line.id,
        product: line.product,
        quantity: line.quantity,
        unit: line.unit,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        taxAmount: line.taxAmount,
        lineTotal: line.lineTotal,
        unitCostAtSale: line.unitCostAtSale,
        cogsAmount: line.cogsAmount,
        grossProfitAmount: line.grossProfitAmount,
        grossMarginPct: line.grossMarginPct,
        profitCostSource: line.profitCostSource,
        revenueExTax,
        computedGrossProfit: grossProfit,
      };
    });
    const revenueExTax = roundMoney(lines.reduce((sum, line) => sum + line.revenueExTax, 0));
    const cogsAmount = roundMoney(
      lines.reduce((sum, line) => sum + moneyValue(line.cogsAmount), 0),
    );
    const grossProfitAmount = roundMoney(
      lines.reduce((sum, line) => sum + line.computedGrossProfit, 0),
    );

    return {
      orderId: id,
      summary: {
        revenueExTax,
        cogsAmount,
        grossProfitAmount,
        grossMarginPct: revenueExTax > 0 ? roundMoney((grossProfitAmount / revenueExTax) * 100) : 0,
        lineCount: lines.length,
      },
      lines,
    };
  }

  async findOne(id: string, user?: AuthUser, minimum: AccessLevel = AccessLevel.READ) {
    const record = await this.prisma.salesOrder.findFirst({
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
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true, address: true, phone: true } },
        customer: { select: { id: true, name: true } },
        receivable: {
          select: {
            id: true,
            sourceId: true,
            paidAmount: true,
            outstandingAmount: true,
            status: true,
          },
        },
        createdBy: { select: { id: true, fullName: true } },
        confirmedBy: { select: { id: true, fullName: true } },
        cashAccount: { select: { id: true, accountName: true, accountType: true, currency: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
            unit: { select: { id: true, name: true, symbol: true } },
          },
        },
      },
    });
    if (!record) throw new NotFoundException('Sales order not found');
    if (user) {
      await this.companyScope.assertCanAccessCompany(user, record.companyId, minimum);
    }

    const sourceReceivable = record.receivable
      ? null
      : await this.prisma.receivable.findFirst({
          where: { sourceType: 'SalesOrder', sourceId: id, deletedAt: null },
          select: {
            id: true,
            sourceId: true,
            paidAmount: true,
            outstandingAmount: true,
            status: true,
          },
          orderBy: { updatedAt: 'desc' },
        });

    return this.withReceivablePaymentSnapshot(record, sourceReceivable);
  }

  private async findSalesOrderSourceReceivables(salesOrderIds: string[]) {
    if (salesOrderIds.length === 0) return new Map<string, LinkedReceivableSnapshot>();

    const receivables = await this.prisma.receivable.findMany({
      where: { sourceType: 'SalesOrder', sourceId: { in: salesOrderIds }, deletedAt: null },
      select: {
        id: true,
        sourceId: true,
        paidAmount: true,
        outstandingAmount: true,
        status: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    const bySalesOrderId = new Map<string, LinkedReceivableSnapshot>();
    for (const receivable of receivables) {
      if (receivable.sourceId && !bySalesOrderId.has(receivable.sourceId)) {
        bySalesOrderId.set(receivable.sourceId, receivable);
      }
    }
    return bySalesOrderId;
  }

  private withReceivablePaymentSnapshot<
    T extends {
      receivable?: LinkedReceivableSnapshot | null;
      receivableId?: string | null;
    },
  >(order: T, sourceReceivable?: LinkedReceivableSnapshot | null): T {
    const receivable = order.receivable ?? sourceReceivable;
    if (!receivable) return order;

    const paidAmount = new Prisma.Decimal(receivable.paidAmount ?? 0).toDecimalPlaces(2);
    const outstandingAmount = new Prisma.Decimal(receivable.outstandingAmount ?? 0).toDecimalPlaces(
      2,
    );
    const paymentStatus = outstandingAmount.isZero()
      ? PaymentStatus.PAID
      : paidAmount.gt(0)
        ? PaymentStatus.PARTIALLY_PAID
        : PaymentStatus.UNPAID;

    return {
      ...order,
      receivableId: order.receivableId ?? receivable.id,
      receivable: order.receivable ?? receivable,
      paidAmount,
      outstandingAmount,
      paymentStatus,
    } as T;
  }

  async findReceiptAccounts(
    query: {
      companyId?: string;
      divisionId?: string;
      branchId?: string;
      paymentMethod?: SalesPaymentMethod;
      limit?: string | number;
    },
    user: AuthUser,
  ) {
    if (!query.companyId || query.paymentMethod === SalesPaymentMethod.CREDIT) {
      return [];
    }

    await this.companyScope.assertCanAccessCompany(user, query.companyId, AccessLevel.READ);

    const paymentMethod = query.paymentMethod as SalesPaymentMethod | undefined;
    const allowedTypes = paymentMethod
      ? accountTypesForPaymentMethod(paymentMethod)
      : RECEIPT_ACCOUNT_TYPES;
    if (allowedTypes.length === 0) return [];

    const max = Math.min(Math.max(Number(query.limit ?? 500), 1), 1000);
    const accounts = await this.findReceiptAccountRows(query.companyId, allowedTypes);
    const filtered = this.filterReceiptAccountRows(accounts, query);

    // This method backs GET /sales-orders/receipt-accounts and is deliberately
    // query-only. Missing receipt accounts must be provisioned through the
    // explicit POST /cash-accounts write path, which retains cash_accounts.manage
    // permission and WRITE company-scope enforcement.
    return filtered.slice(0, max);
  }

  private findReceiptAccountRows(companyId: string, allowedTypes: CashAccountType[]) {
    return this.prisma.cashAccount.findMany({
      where: {
        companyId,
        deletedAt: null,
        isActive: true,
        accountType: { in: allowedTypes },
      },
      include: {
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        linkedBank: {
          select: { id: true, bankName: true, accountName: true, accountNumber: true },
        },
      },
      orderBy: { accountName: 'asc' },
      take: 1000,
    });
  }

  private filterReceiptAccountRows(
    accounts: Awaited<ReturnType<SalesOrdersService['findReceiptAccountRows']>>,
    query: { divisionId?: string; branchId?: string },
  ) {
    return accounts.filter((account) => {
      if (account.accountType === CashAccountType.BANK) {
        return (
          (!account.divisionId || account.divisionId === query.divisionId) &&
          (!account.branchId || account.branchId === query.branchId)
        );
      }

      return (
        Boolean(query.divisionId) &&
        Boolean(query.branchId) &&
        account.divisionId === query.divisionId &&
        account.branchId === query.branchId
      );
    });
  }

  async mobilePosBootstrap(user: AuthUser, requestedCompanyId?: string) {
    const company = await this.resolveMobilePosCompany(user, requestedCompanyId);

    const [divisions, branches, customers] = await Promise.all([
      this.prisma.division.findMany({
        where: { companyId: company.id, deletedAt: null, isActive: true },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.branch.findMany({
        where: { division: { companyId: company.id }, deletedAt: null, isActive: true },
        select: { id: true, name: true, code: true, divisionId: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.customer.findMany({
        where: { companyId: company.id, deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          name: true,
          customerCode: true,
          divisionId: true,
          branchId: true,
          customerType: true,
        },
        orderBy: { name: 'asc' },
        take: 500,
      }),
    ]);

    return {
      company,
      divisions,
      branches,
      customers,
      defaults: {
        currency: CurrencyCode.TZS,
        salesType: SalesType.CASH_SALE,
        paymentMethod: SalesPaymentMethod.CASH,
      },
    };
  }

  async mobilePosQuickSale(dto: CreateSalesOrderDto, user: AuthUser) {
    // Mobile POS now mirrors the Operations sales-order experience: any company,
    // division, branch, sales type, customer, and payment method (including
    // CREDIT) the operator can access. Company-scope and reference ownership are
    // enforced inside create()/confirm() via assertCanAccessCompany(WRITE), so
    // we only normalize defaults and tag the source here. Unlike quickSale(),
    // CREDIT is preserved — a counter operator may sell on account.
    const safeDto: CreateSalesOrderDto = {
      ...dto,
      salesType: dto.salesType ?? SalesType.CASH_SALE,
      currency: dto.currency ?? CurrencyCode.TZS,
      notes: [dto.notes, 'Created from Mobile POS'].filter(Boolean).join('\n'),
      paymentMethod: dto.paymentMethod ?? SalesPaymentMethod.CASH,
    };

    const normalizedPaymentMethod = normalizePaymentMethodForSalesType(
      safeDto.salesType,
      safeDto.paymentMethod,
    );
    if (
      normalizedPaymentMethod === SalesPaymentMethod.CREDIT &&
      !hasPermission(user, 'sales.create')
    ) {
      throw new ForbiddenException('Credit sales require sales.create permission');
    }

    return this.createAndConfirm(safeDto, user);
  }

  /**
   * Trusted entry point for the locked-down Mobile POS Lite flow. The terminal
   * service derives the entire order context server-side before it reaches
   * here; this method only records the already verified terminal identity.
   */
  async mobilePosLiteQuickSale(
    dto: CreateSalesOrderDto,
    user: AuthUser,
    terminalId: string,
    terminalCode: string,
  ) {
    const safeDto: CreateSalesOrderDto = {
      ...dto,
      currency: dto.currency ?? CurrencyCode.TZS,
      notes: [dto.notes, `Created from Mobile POS Lite (${terminalCode})`]
        .filter(Boolean)
        .join('\n'),
    };
    return this.createAndConfirm(safeDto, user, { mobilePosTerminalId: terminalId });
  }

  /**
   * Derive per-line output VAT server-side so cash-sale / POS / Quick-Sale /
   * Kaunta paths (which POST `taxAmount: 0` on every line) still split their
   * revenue into net + 18% output VAT instead of booking the whole tender as
   * revenue.
   *
   * ITEMBA-R till/shelf prices are VAT-INCLUSIVE (the customer pays the sticker
   * price), so for a taxable product we back-calculate the tax OUT of the gross
   * unit price rather than adding it on top:
   *
   *   tax   = gross × rate / (100 + rate)
   *   net   = gross − tax
   *
   * We rewrite the line's `unitPrice`/`discountAmount` to their net equivalents
   * and set a per-line `taxAmount` equal to the carved-out VAT, so the existing
   * `calculateLineTotals` produces `lineTotal = net − netDiscount + tax ==
   * grossAfterDiscount`. Net effect on the JE (via postSalesOrderLedger, which
   * already credits TAX_VAT_PAYABLE when taxAmount > 0 and derives revenue as
   * total − tax): DR Cash gross / CR Revenue net / CR VAT — totals reconcile
   * (net + vat == gross). The TaxTransaction ledger needs no extra booking:
   * confirm() already mirrors per-line taxAmount into TaxTransactions via
   * taxAutoApply.applyForSalesOrder inside the same transaction, so the derived
   * VAT flows into the filing reports automatically.
   *
   * PROFIT-GUARD POLICY (deliberate): derivation runs BEFORE
   * profit.assertSaleLinesProfitable, so the guard evaluates the NET (ex-VAT)
   * unit price against cost. The 18% carved out of the sticker price belongs to
   * TRA, not the company — comparing the VAT-inclusive gross to cost would let
   * a below-cost sale pass whenever the margin was thinner than the VAT.
   * confirm() re-runs the guard on the persisted (already-net) lines, so the
   * two checks agree.
   *
   * Rules:
   *   - Only lines the caller left UNTAXED (`taxAmount` absent/0) are derived,
   *     so a normal Sales Order that already sends its own per-line VAT is
   *     never double-charged. This also makes the derivation idempotent: a
   *     second pass over already-derived lines is a no-op, so it is safe that
   *     both createAndConfirm() (ahead of the idempotent-replay matcher) and
   *     create() apply it.
   *   - A line flagged `taxManual` is NEVER derived, even at taxAmount 0: the
   *     operator explicitly set that VAT in the sales-order editor (e.g. a
   *     deliberate zero for a VAT-relieved/exempt customer buying a taxable
   *     product), and re-deriving would silently carve 18% back out of the
   *     entered price. POS/Quick-Sale/Kaunta never send the flag, so their
   *     hardcoded taxAmount:0 lines keep being derived.
   *   - Only lines whose product is `isTaxable` are touched; exempt/zero-rated
   *     products keep the whole tender as revenue.
   *   - The rate is the product's own `taxRate` (percentage) when set,
   *     otherwise the Tanzania standard 18%.
   *   - No taxable-with-derivable-line ⇒ the original array is returned
   *     unchanged (backward compatible; non-taxable payloads are untouched).
   */
  private async deriveInclusiveOutputVat(
    companyId: string,
    lines: SalesOrderLineDto[],
  ): Promise<SalesOrderLineDto[]> {
    if (!lines?.length) return lines;

    // Which lines are candidates? Caller left them untaxed. A line that already
    // carries a positive taxAmount — or whose tax was explicitly set by the
    // operator (taxManual, including an intentional zero) — is trusted as-is.
    const needsDerivation = lines.some(
      (line) => !line.taxManual && Number(line.taxAmount ?? 0) <= 0,
    );
    if (!needsDerivation) return lines;

    const productIds = Array.from(
      new Set(lines.map((line) => line.productId).filter((id): id is string => Boolean(id))),
    );
    if (!productIds.length) return lines;

    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds }, companyId, deletedAt: null },
      select: { id: true, isTaxable: true, taxRate: true },
    });
    const taxById = new Map(products.map((p) => [p.id, p]));

    return lines.map((line) => {
      // Respect an operator's explicit per-line VAT override (even zero).
      if (line.taxManual) return line;
      // Respect an explicit caller-supplied tax; never re-derive or double it.
      if (Number(line.taxAmount ?? 0) > 0) return line;

      const product = taxById.get(line.productId);
      if (!product || !product.isTaxable) return line;

      const rate = new Prisma.Decimal(
        product.taxRate != null ? product.taxRate : STANDARD_VAT_RATE_PERCENT,
      );
      // A 0% (zero-rated) taxable product carries no VAT — leave the line net.
      if (rate.lte(0)) return line;

      const qty = new Prisma.Decimal(line.quantity);
      const grossUnitPrice = new Prisma.Decimal(line.unitPrice);
      const grossUnitDiscount = new Prisma.Decimal(line.discountAmount ?? 0);

      // Inclusive back-calc of the tax fraction: net = gross × 100 / (100 + rate).
      const netFactor = new Prisma.Decimal(100).div(new Prisma.Decimal(100).plus(rate));
      const netUnitPrice = grossUnitPrice.mul(netFactor).toDecimalPlaces(2);
      const netUnitDiscount = grossUnitDiscount.mul(netFactor).toDecimalPlaces(2);

      // Whole-line VAT = grossAfterDiscount − netAfterDiscount, computed on the
      // rounded net figures so the persisted line totals reconcile exactly.
      const grossLine = grossUnitPrice.minus(grossUnitDiscount).mul(qty);
      const netLine = netUnitPrice.minus(netUnitDiscount).mul(qty);
      const taxAmount = grossLine.minus(netLine).toDecimalPlaces(2);
      if (taxAmount.lte(0)) return line;

      return {
        ...line,
        unitPrice: netUnitPrice.toNumber(),
        discountAmount: netUnitDiscount.toNumber(),
        taxAmount: taxAmount.toNumber(),
      };
    });
  }

  async create(dto: CreateSalesOrderDto, user: AuthUser, context: SalesOrderCreateContext = {}) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const paymentMethod = normalizePaymentMethodForSalesType(dto.salesType, dto.paymentMethod);
    const cashAccountId =
      paymentMethod === SalesPaymentMethod.CREDIT ? undefined : dto.cashAccountId;
    await this.assertReferencesBelongToCompany(dto.companyId, {
      ...dto,
      paymentMethod,
      cashAccountId,
    });
    const userId = user.id;
    // Carve output VAT out of VAT-inclusive till/shelf prices for any line the
    // caller left untaxed (POS / Quick-Sale / Kaunta send taxAmount:0). A normal
    // Sales Order that already supplies per-line VAT is passed through untouched.
    // No-op when createAndConfirm() already derived (idempotent by design).
    const linesWithTax = await this.deriveInclusiveOutputVat(dto.companyId, dto.lines);
    const { computed, subtotal, totalDiscount, totalTax, totalAmount, documentDiscount } =
      applyDocumentDiscount(calculateLineTotals(linesWithTax), dto.documentDiscount);
    // NOTE: `computed` carries the post-derivation NET unit prices, so the
    // profit guard below deliberately evaluates ex-VAT revenue against cost
    // (see deriveInclusiveOutputVat's PROFIT-GUARD POLICY).
    const profitSnapshots = await this.profit.assertSaleLinesProfitable(
      {
        companyId: dto.companyId,
        branchId: dto.branchId,
        lines: computed.map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountAmount: Number(line.discountAmount ?? 0),
        })),
      },
      this.prisma,
      { user, source: 'SalesOrderCreate', referenceType: 'SalesOrder' },
    );

    const record = await this.prisma.$transaction(async (tx) => {
      const customer = await this.resolveSalesOrderCustomer(tx, {
        companyId: dto.companyId,
        divisionId: dto.divisionId,
        branchId: dto.branchId,
        customerId: dto.customerId,
        customerName: dto.customerName,
        userId,
      });
      await this.assertCustomerCreditAvailable(tx, {
        companyId: dto.companyId,
        customerId: customer.customerId,
        paymentMethod,
        totalAmount,
      });
      const salesOrderNumber = await this.codes.next({
        entityType: 'SalesOrder',
        companyId: dto.companyId,
        tx,
      });
      const order = await tx.salesOrder.create({
        data: {
          salesOrderNumber,
          companyId: dto.companyId,
          divisionId: dto.divisionId,
          branchId: dto.branchId,
          customerId: customer.customerId,
          customerName: customer.customerName,
          salesType: dto.salesType,
          orderDate: new Date(dto.orderDate),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          currency: dto.currency as CurrencyCode,
          subtotal,
          discountAmount: totalDiscount,
          documentDiscount,
          taxAmount: totalTax,
          totalAmount,
          paidAmount: 0,
          outstandingAmount: totalAmount,
          status: 'DRAFT',
          paymentStatus: 'UNPAID',
          notes: dto.notes,
          salespersonId: dto.salespersonId,
          paymentMethod,
          cashAccountId: cashAccountId ?? null,
          paymentReference: dto.paymentReference,
          idempotencyKey: dto.idempotencyKey ?? null,
          mobilePosTerminalId: context.mobilePosTerminalId ?? null,
          createdById: userId,
        },
      });

      await tx.salesOrderLine.createMany({
        data: computed.map((line, index) => ({
          salesOrderId: order.id,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitId: line.unitId,
          unitPrice: line.unitPrice,
          discountAmount: line.discountAmount ?? 0,
          taxAmount: line.taxAmount ?? 0,
          lineTotal: line.lineTotal,
          batchId: line.batchId,
          ...salesLineProfitData(profitSnapshots[index]),
        })),
      });

      return order;
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CREATE',
      entityType: 'SalesOrder',
      entityId: record.id,
      userId,
      companyId: record.companyId,
      newValue: record as any,
    });

    return this.findOne(record.id, user);
  }

  /**
   * Resolve the company a Mobile POS session should open against. Honors an
   * explicit companyId (access-checked), otherwise falls back to the operator's
   * primary company and finally the first company they can access. Replaces the
   * former Westsides-only lookup so the POS works for any accessible company.
   */
  private async resolveMobilePosCompany(user: AuthUser, requestedCompanyId?: string) {
    let targetId = requestedCompanyId ?? user.companyId ?? null;
    if (!targetId) {
      const accessible = await this.companyScope.accessibleCompanyIds(user);
      targetId = accessible[0] ?? null;
    }
    if (!targetId) {
      throw new NotFoundException('No accessible company is configured for Mobile POS');
    }
    await this.companyScope.assertCanAccessCompany(user, targetId, AccessLevel.READ);
    const company = await this.prisma.company.findFirst({
      where: { id: targetId, deletedAt: null },
      select: { id: true, name: true, code: true },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }

  async update(id: string, dto: UpdateSalesOrderDto, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Sales order can only be updated in DRAFT status');
    }
    const nextSalesType = dto.salesType ?? existing.salesType;
    const nextPaymentMethod = normalizePaymentMethodForSalesType(
      nextSalesType,
      dto.paymentMethod ?? ((existing as any).paymentMethod as SalesPaymentMethod),
    );
    const nextCashAccountId =
      nextPaymentMethod === SalesPaymentMethod.CREDIT
        ? null
        : (dto.cashAccountId ?? (existing as any).cashAccountId ?? null);
    await this.assertReferencesBelongToCompany(existing.companyId, {
      divisionId: dto.divisionId ?? existing.divisionId,
      branchId: dto.branchId ?? existing.branchId,
      customerId: dto.customerId !== undefined ? dto.customerId : existing.customerId,
      salespersonId: dto.salespersonId ?? existing.salespersonId,
      cashAccountId: nextCashAccountId ?? undefined,
      paymentMethod: nextPaymentMethod,
      lines: dto.lines,
    });

    const linesToProcess =
      dto.lines ??
      (existing.lines as any[]).map((line) => {
        const quantity = Number(line.quantity ?? 0);
        return {
          ...line,
          quantity,
          unitPrice: Number(line.unitPrice ?? 0),
          discountAmount:
            quantity > 0
              ? Number(line.discountAmount ?? 0) / quantity
              : Number(line.discountAmount ?? 0),
          taxAmount: Number(line.taxAmount ?? 0),
        };
      });
    // Effective document discount: an explicit value in the DTO wins, otherwise
    // the stored value is preserved so a totals refresh triggered by a line/branch
    // edit doesn't silently drop a previously-applied order-level discount.
    const effectiveDocumentDiscount =
      dto.documentDiscount ?? Number((existing as any).documentDiscount ?? 0);
    // Re-derive output VAT for edited lines the caller left untaxed, so a DRAFT
    // edit cannot strip the VAT that create() carved out of an inclusive price
    // (e.g. a POS draft re-saved with gross lines and taxAmount: 0). Lines
    // reconstructed from storage already carry their derived taxAmount and are
    // passed through untouched.
    const linesWithTax = await this.deriveInclusiveOutputVat(
      existing.companyId,
      linesToProcess as SalesOrderLineDto[],
    );
    const { computed, subtotal, totalDiscount, totalTax, totalAmount, documentDiscount } =
      applyDocumentDiscount(calculateLineTotals(linesWithTax), effectiveDocumentDiscount);
    // Did the derivation actually rewrite a line? deriveInclusiveOutputVat
    // returns untouched lines by OBJECT IDENTITY (only rewritten lines are new
    // objects), so a reference comparison detects it exactly.
    const derivationChangedLines = linesWithTax.some(
      (line, index) => line !== (linesToProcess as SalesOrderLineDto[])[index],
    );
    // Refresh the persisted totals when the lines/branch change OR when the
    // caller supplies a new document discount (which alters totalAmount even
    // though the lines are untouched).
    //
    // A derivation pass that rewrote a line must ALSO refresh the stored line
    // rows: otherwise a documentDiscount-only PATCH on a DRAFT whose stored
    // lines are still gross/untaxed (legacy row, or product flipped taxable
    // after creation) would persist derived header totals (net subtotal + VAT)
    // against line rows still carrying gross unitPrice and taxAmount 0 — and
    // confirm() would post header VAT to the GL that taxAutoApply (which reads
    // the LINES) never mirrors into the TaxTransaction filing ledger.
    const shouldRefreshLines =
      Boolean(dto.lines || dto.branchId !== undefined) || derivationChangedLines;
    const shouldRefreshTotals = shouldRefreshLines || dto.documentDiscount !== undefined;
    const profitSnapshots = await this.profit.assertSaleLinesProfitable(
      {
        companyId: existing.companyId,
        branchId: dto.branchId ?? existing.branchId,
        lines: computed.map((line) => ({
          productId: line.productId,
          quantity: Number(line.quantity),
          unitPrice: Number(line.unitPrice),
          discountAmount: Number(line.discountAmount ?? 0),
        })),
      },
      this.prisma,
      {
        user,
        source: 'SalesOrderUpdate',
        referenceType: 'SalesOrder',
        referenceId: id,
      },
    );

    const record = await this.prisma.$transaction(async (tx) => {
      const customer =
        dto.customerId !== undefined || dto.customerName !== undefined
          ? await this.resolveSalesOrderCustomer(tx, {
              companyId: existing.companyId,
              divisionId: dto.divisionId ?? existing.divisionId,
              branchId: dto.branchId ?? existing.branchId,
              customerId: dto.customerId ?? null,
              customerName: dto.customerName ?? null,
              userId,
            })
          : null;
      await this.assertCustomerCreditAvailable(tx, {
        companyId: existing.companyId,
        customerId: customer ? customer.customerId : existing.customerId,
        paymentMethod: nextPaymentMethod,
        totalAmount,
      });

      if (shouldRefreshLines) {
        await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } });
        await tx.salesOrderLine.createMany({
          data: computed.map((line, index) => ({
            salesOrderId: id,
            productId: line.productId,
            description: line.description,
            quantity: line.quantity,
            unitId: line.unitId,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount ?? 0,
            taxAmount: line.taxAmount ?? 0,
            lineTotal: line.lineTotal,
            batchId: line.batchId,
            ...salesLineProfitData(profitSnapshots[index]),
          })),
        });
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          ...(customer && { customerId: customer.customerId, customerName: customer.customerName }),
          ...(dto.salesType && { salesType: dto.salesType }),
          ...(dto.orderDate && { orderDate: new Date(dto.orderDate) }),
          ...(dto.dueDate !== undefined && { dueDate: dto.dueDate ? new Date(dto.dueDate) : null }),
          ...(dto.currency && { currency: dto.currency }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.divisionId !== undefined && { divisionId: dto.divisionId }),
          ...(dto.branchId !== undefined && { branchId: dto.branchId }),
          ...(dto.salespersonId !== undefined && { salespersonId: dto.salespersonId }),
          paymentMethod: nextPaymentMethod,
          cashAccountId: nextCashAccountId,
          ...(dto.paymentReference !== undefined && { paymentReference: dto.paymentReference }),
          ...(shouldRefreshTotals && {
            subtotal,
            discountAmount: totalDiscount,
            documentDiscount,
            taxAmount: totalTax,
            totalAmount,
            outstandingAmount: totalAmount,
          }),
        },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_UPDATE',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: existing as any,
      newValue: record as any,
    });

    return this.findOne(id, user);
  }

  private async assertReferencesBelongToCompany(companyId: string, refs: SalesOrderReferenceIds) {
    if (
      refs.paymentMethod &&
      refs.paymentMethod !== SalesPaymentMethod.CREDIT &&
      !refs.cashAccountId
    ) {
      throw new BadRequestException('Receipt account is required for non-credit sales');
    }

    if (refs.paymentMethod === SalesPaymentMethod.CREDIT && refs.cashAccountId) {
      throw new BadRequestException('Receipt account is only valid for non-credit sales');
    }

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

    if (refs.customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: refs.customerId, deletedAt: null },
        select: { companyId: true, divisionId: true, branchId: true, status: true },
      });
      if (!customer || customer.companyId !== companyId) {
        throw new BadRequestException('Customer does not belong to this company');
      }
      if (customer.status === 'BLOCKED') {
        throw new BadRequestException('Blocked customers cannot be used on sales orders');
      }
      if (!refs.branchId) {
        throw new BadRequestException('Sales order branch is required for this customer');
      }
      if (customer.branchId && refs.branchId !== customer.branchId) {
        throw new BadRequestException('Customer does not belong to the selected branch');
      }
      if (customer.divisionId && refs.divisionId && refs.divisionId !== customer.divisionId) {
        throw new BadRequestException('Customer does not belong to the selected division');
      }
    }

    if (refs.salespersonId) {
      const salesperson = await this.prisma.employee.findFirst({
        where: { id: refs.salespersonId, deletedAt: null },
        select: { companyId: true },
      });
      if (!salesperson || salesperson.companyId !== companyId) {
        throw new BadRequestException('Salesperson does not belong to this company');
      }
    }

    if (refs.cashAccountId) {
      // Company + payment-method-type + division/branch custody guard, shared
      // with the other cash-receiving modules (cash-account-scope.helper.ts).
      // Sales orders use STRICT mode: a non-BANK receipt account must match
      // the order's division AND branch exactly (BANK accounts may be
      // company-wide). Behaviour and error wording are unchanged — this block
      // is where the shared guard was extracted FROM.
      await assertCashAccountForScope(this.prisma, {
        cashAccountId: refs.cashAccountId,
        companyId,
        divisionId: refs.divisionId ?? null,
        branchId: refs.branchId ?? null,
        allowedTypes: accountTypesForPaymentMethod(refs.paymentMethod),
        requireScopeForNonBank: true,
      });
    }

    await this.assertLineReferencesBelongToCompany(companyId, refs.lines, refs.branchId);
  }

  private async assertCustomerCreditAvailable(
    tx: Prisma.TransactionClient,
    input: {
      companyId: string;
      customerId?: string | null;
      paymentMethod?: SalesPaymentMethod | null;
      totalAmount: number;
    },
  ) {
    if (input.paymentMethod !== SalesPaymentMethod.CREDIT || !input.customerId) return;

    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, companyId: input.companyId, deletedAt: null },
      select: { name: true, status: true, creditLimit: true, currentBalance: true },
    });
    if (!customer) throw new BadRequestException('Customer does not belong to this company');
    if (customer.status === 'BLOCKED') {
      throw new BadRequestException('Blocked customers cannot be used for credit sales');
    }

    const creditLimit = Number(customer.creditLimit ?? 0);
    if (creditLimit <= 0) return;

    const projectedBalance = Number(customer.currentBalance ?? 0) + input.totalAmount;
    if (projectedBalance > creditLimit) {
      throw new BadRequestException(
        `Credit sale exceeds ${customer.name}'s credit limit. Limit: ${creditLimit.toFixed(
          2,
        )}, projected balance: ${projectedBalance.toFixed(2)}`,
      );
    }
  }

  private async assertLineReferencesBelongToCompany(
    companyId: string,
    lines: SalesOrderLineDto[] | undefined,
    branchId?: string | null,
  ) {
    if (!lines?.length) return;

    const unique = (ids: Array<string | undefined>) =>
      Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
    const productIds = unique(lines.map((line) => line.productId));
    const unitIds = unique(lines.map((line) => line.unitId));
    const batchIds = unique(lines.map((line) => line.batchId));

    const [products, units, batches] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: productIds }, deletedAt: null },
        select: { id: true, companyId: true },
      }),
      this.prisma.unitOfMeasure.findMany({
        where: { id: { in: unitIds }, deletedAt: null, status: 'ACTIVE' },
        select: { id: true, companyId: true },
      }),
      batchIds.length
        ? this.prisma.productBatch.findMany({
            where: { id: { in: batchIds }, deletedAt: null },
            select: { id: true, companyId: true, productId: true },
          })
        : Promise.resolve([]),
    ]);

    const validProductIds = new Set(
      products.filter((product) => product.companyId === companyId).map((product) => product.id),
    );
    if (validProductIds.size !== productIds.length) {
      throw new BadRequestException('Sales order product does not belong to this company');
    }

    const validUnitIds = new Set(
      units
        .filter((unit) => unit.companyId === null || unit.companyId === companyId)
        .map((unit) => unit.id),
    );
    if (validUnitIds.size !== unitIds.length) {
      throw new BadRequestException('Sales order unit does not belong to this company');
    }

    const batchById = new Map(batches.map((batch) => [batch.id, batch]));
    for (const line of lines) {
      if (!line.batchId) continue;
      const batch = batchById.get(line.batchId);
      if (!batch || batch.companyId !== companyId || batch.productId !== line.productId) {
        throw new BadRequestException('Sales order batch does not belong to this company');
      }
    }
  }

  async confirm(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT sales orders can be confirmed');
    }
    if (!existing.branchId) {
      throw new BadRequestException('Sales order branch/location is required to issue stock');
    }
    const issuingBranchId = existing.branchId;

    const record = await this.prisma.$transaction(async (tx) => {
      // Atomically claim the order: flip DRAFT -> CONFIRMED in one guarded write
      // BEFORE doing any of the posting work. The status check above happened
      // outside the transaction, so two concurrent confirms could both pass it;
      // this updateMany takes the row lock and a second confirm matches 0 rows
      // (status already CONFIRMED) -> it throws and rolls back instead of
      // double-issuing stock, double-creating the receivable, and double-posting.
      const claim = await tx.salesOrder.updateMany({
        where: { id, status: 'DRAFT' },
        data: { status: 'CONFIRMED' },
      });
      if (claim.count === 0) {
        throw new BadRequestException('Sales order is no longer DRAFT (already confirmed).');
      }

      let cogsAmount = 0;
      const profitSnapshots = await this.profit.assertSaleLinesProfitable(
        {
          companyId: existing.companyId,
          branchId: issuingBranchId,
          lines: (existing.lines as any[]).map((line) => ({
            productId: line.productId,
            quantity: Number(line.quantity),
            unitPrice: Number(line.unitPrice),
            discountAmount: Number(line.discountAmount ?? 0),
          })),
        },
        tx,
        {
          user,
          source: 'SalesOrderConfirm',
          referenceType: 'SalesOrder',
          referenceId: id,
        },
      );

      for (const [index, line] of (existing.lines as any[]).entries()) {
        const profitSnapshot = profitSnapshots[index];
        if (profitSnapshot) {
          await tx.salesOrderLine.update({
            where: { id: line.id },
            data: salesLineProfitData(profitSnapshot),
          });
          cogsAmount += profitSnapshot.cogsAmount;
        }

        const product = await tx.product.findUnique({ where: { id: line.productId } });
        if (!product || !this.profit.isStockProduct(product)) continue;

        try {
          const unitCost = Number(profitSnapshot?.unitCostAtSale ?? 0);

          await this.inventoryMovements.createMovement({
            companyId: existing.companyId,
            productId: line.productId,
            movementType: 'SALE_ISSUE',
            quantity: Number(line.quantity),
            unitId: line.unitId,
            unitCost,
            movementDate: existing.orderDate,
            createdById: userId,
            referenceType: 'SalesOrder',
            referenceId: id,
            divisionId: existing.divisionId ?? undefined,
            branchId: issuingBranchId,
            tx,
          });
        } catch (err: any) {
          throw new BadRequestException(
            `Failed to create inventory movement for product "${product.name}": ${err.message}`,
          );
        }

        // Decrement the specific batch's remainingQuantity if a batch was picked.
        if (line.batchId) {
          await tx.productBatch.update({
            where: { id: line.batchId },
            data: { remainingQuantity: { decrement: Number(line.quantity) } },
          });
        }
      }

      // ── Payment routing ────────────────────────────────────────────────
      // Non-CREDIT methods credit the chosen cash account immediately and
      // mark the order PAID. CREDIT creates a Receivable instead.
      const paymentMethod = (existing as any).paymentMethod ?? 'CREDIT';
      let paymentStatus: 'UNPAID' | 'PAID' = 'UNPAID';
      let paidAmount = 0;
      let outstandingAmount = Number(existing.totalAmount);
      let receivableId: string | null = null;

      if (paymentMethod === 'CREDIT') {
        await this.assertCustomerCreditAvailable(tx, {
          companyId: existing.companyId,
          customerId: existing.customerId,
          paymentMethod,
          totalAmount: Number(existing.totalAmount),
        });
        const receivableCustomerName = salesOrderReceivableCustomerName(existing);
        const recNumber = await this.codes.next({
          entityType: 'Receivable',
          companyId: existing.companyId,
          tx,
        });
        const receivable = await tx.receivable.create({
          data: {
            receivableNumber: recNumber,
            companyId: existing.companyId,
            divisionId: existing.divisionId ?? null,
            branchId: existing.branchId ?? null,
            customerId: existing.customerId ?? null,
            customerName: receivableCustomerName,
            amount: existing.totalAmount,
            paidAmount: 0,
            outstandingAmount: existing.totalAmount,
            currency: existing.currency,
            issueDate: new Date(),
            dueDate: existing.dueDate ?? new Date(Date.now() + 30 * 24 * 3600 * 1000),
            status: 'OPEN' as any,
            sourceType: 'SalesOrder',
            sourceId: id,
            notes: `Sales Order ${existing.salesOrderNumber}`,
          },
        });
        receivableId = receivable.id;
      } else if ((existing as any).cashAccountId) {
        // Guard against posting a receipt into a cash account denominated in a
        // different currency than the sale: incrementing its balance with the
        // order total would silently mix currencies on the cash ledger. We only
        // reach here for non-credit sales (CREDIT raises a Receivable above).
        const cashAccountCurrency = existing.cashAccount?.currency;
        if (cashAccountCurrency && cashAccountCurrency !== existing.currency) {
          throw new BadRequestException(
            `Receipt account currency (${cashAccountCurrency}) does not match the sales order currency (${existing.currency}). Choose a ${existing.currency} receipt account.`,
          );
        }
        // Credit the cash account balance.
        await tx.cashAccount.update({
          where: { id: (existing as any).cashAccountId },
          data: { currentBalance: { increment: existing.totalAmount } },
        });
        paymentStatus = 'PAID';
        paidAmount = Number(existing.totalAmount);
        outstandingAmount = 0;
      }

      const journalEntry = await this.postSalesOrderLedger({
        order: existing as any,
        paymentMethod,
        cashAccountType: existing.cashAccount?.accountType ?? null,
        cogsAmount,
        userId,
        tx,
      });

      if (receivableId) {
        const linkedReceivable = await tx.receivable.update({
          where: { id: receivableId },
          data: { journalEntryId: journalEntry.id },
        });
        await this.syncCustomerBalance(tx, linkedReceivable.companyId, linkedReceivable.customerId);
      }

      // ── Tax auto-apply (Sprint C2) ───────────────────────────────────────
      // Mirror line-level taxAmount values into the TaxTransaction ledger so
      // C3 filing reports can aggregate them. Soft-fails: any error inside
      // the auto-apply is logged inside the service and does NOT roll back
      // the order confirmation. Env-flag gated (TAX_AUTO_APPLY=true).
      try {
        const taxResult = await this.taxAutoApply.applyForSalesOrder(id, userId, tx);
        if (taxResult.error) {
          this.logger.warn(`Tax auto-apply for order ${id}: ${taxResult.error}`);
        }
      } catch (err) {
        this.logger.warn(
          `Tax auto-apply threw for order ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      return tx.salesOrder.update({
        where: { id },
        data: {
          status: 'CONFIRMED',
          confirmedById: userId,
          confirmedAt: new Date(),
          paymentStatus,
          paidAmount,
          outstandingAmount,
          journalEntryId: journalEntry.id,
          ...(receivableId ? { receivableId } : {}),
        },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CONFIRM',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: 'DRAFT' } as any,
      newValue: { status: 'CONFIRMED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    // Auto-create a DRAFT SalesCommission when the order has a salesperson
    // with a defaultCommissionRate set. Idempotent: the unique key on
    // (salesOrderId, employeeId) means a prior commission blocks a duplicate
    // (e.g. if the order is unconfirmed/reconfirmed). Soft-fails so a
    // configuration gap doesn't break the confirmation flow.
    try {
      await this.maybeCreateAutoCommission(id, userId);
    } catch (err) {
      this.logger.warn(
        `Auto-commission creation failed for order ${id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return this.findOne(id, user);
  }

  /**
   * Helper for `confirm()` — looks up the salesperson and rate, computes
   * a GROSS-basis commission amount, and creates the row. Skips silently
   * when there's no salesperson, no rate, or a commission already exists.
   */
  private async maybeCreateAutoCommission(orderId: string, userId: string) {
    const order = await this.prisma.salesOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        companyId: true,
        salespersonId: true,
        subtotal: true,
        currency: true,
      },
    });
    if (!order?.salespersonId) return;

    const salesperson = await this.prisma.employee.findFirst({
      where: { id: order.salespersonId, companyId: order.companyId, deletedAt: null },
      select: { id: true, defaultCommissionRate: true },
    });
    if (!salesperson?.defaultCommissionRate) return;

    const existing = await this.prisma.salesCommission.findFirst({
      where: { salesOrderId: orderId, employeeId: salesperson.id, deletedAt: null },
      select: { id: true },
    });
    if (existing) return;

    const rate = Number(salesperson.defaultCommissionRate);
    const subtotal = Number(order.subtotal);
    const amount = Math.round(subtotal * rate * 100) / 100;

    await this.prisma.salesCommission.create({
      data: {
        companyId: order.companyId,
        employeeId: salesperson.id,
        salesOrderId: order.id,
        basis: 'GROSS',
        rate,
        amount,
        currency: order.currency,
        status: 'DRAFT',
        notes: 'Auto-created on order confirmation',
        createdById: userId,
      },
    });
  }

  /**
   * ACCOUNTING POLICY — revenue is recognised at CONFIRMATION, in this one JE.
   *
   * Revenue, COGS and output VAT all post here, atomically with confirm():
   *   DR AR|Cash / CR Sales revenue, CR VAT payable; DR COGS / CR Inventory.
   * Confirmation is the Tanzanian tax point (the fiscal invoice/receipt is
   * issued at confirm, and tax-auto-apply mirrors the line VAT into the filing
   * ledger in the same transaction), and stock physically issues at confirm
   * (SALE_ISSUE movements). Delivery notes are documentary only —
   * DeliveryNotesService is deliberately inventory- and ledger-inert (a
   * source-level spec asserts this).
   *
   * The cutoff exposure this creates — confirmed-but-undelivered orders carry
   * recognised revenue — is monitored rather than deferred: the undelivered
   * confirmed-orders report (the awaiting-delivery predicate in
   * westsides-dashboard.service.ts, `deliveryNotes: { none: ... }` over open
   * confirmed orders) is the exposure monitor to check at period close. Do not
   * move recognition to the delivery event without revisiting the VAT tax
   * point, every reversal path (cancel, credit notes), and the delivery-note
   * inertness spec.
   */
  private async postSalesOrderLedger(input: {
    order: {
      id: string;
      salesOrderNumber: string;
      companyId: string;
      divisionId: string | null;
      branchId: string | null;
      orderDate: Date;
      totalAmount: Prisma.Decimal | number | string;
      taxAmount: Prisma.Decimal | number | string;
    };
    paymentMethod: SalesPaymentMethod | string;
    cashAccountType?: CashAccountType | null;
    cogsAmount: number;
    userId: string;
    tx: Prisma.TransactionClient;
  }) {
    const totalAmount = roundMoney(Number(input.order.totalAmount));
    const taxAmount = roundMoney(Number(input.order.taxAmount ?? 0));
    const revenueAmount = roundMoney(totalAmount - taxAmount);
    const cogsAmount = roundMoney(input.cogsAmount);
    if (totalAmount <= 0) {
      throw new BadRequestException('Sales order total must be greater than zero to post');
    }

    const receivableOrCashRole: AccountRole =
      input.paymentMethod === SalesPaymentMethod.CREDIT
        ? 'AR_CONTROL'
        : cashAccountRole(input.cashAccountType);
    const roles: AccountRole[] = [receivableOrCashRole, 'SALES_REVENUE'];
    if (taxAmount > 0) roles.push('TAX_VAT_PAYABLE');
    if (cogsAmount > 0) roles.push('COST_OF_GOODS_SOLD', 'INVENTORY_ASSET');

    const accounts = await this.accountResolver.resolveMany(input.order.companyId, roles, input.tx);
    const description = `Sales order ${input.order.salesOrderNumber}`;
    const lines = [
      {
        accountId: accounts[receivableOrCashRole].id,
        description:
          input.paymentMethod === SalesPaymentMethod.CREDIT ? 'Customer receivable' : 'Cash sale',
        debit: totalAmount,
        credit: 0,
      },
      ...(revenueAmount > 0
        ? [
            {
              accountId: accounts.SALES_REVENUE.id,
              description: 'Sales revenue',
              debit: 0,
              credit: revenueAmount,
            },
          ]
        : []),
      ...(taxAmount > 0
        ? [
            {
              accountId: accounts.TAX_VAT_PAYABLE.id,
              description: 'Output tax',
              debit: 0,
              credit: taxAmount,
            },
          ]
        : []),
      ...(cogsAmount > 0
        ? [
            {
              accountId: accounts.COST_OF_GOODS_SOLD.id,
              description: 'Cost of goods sold',
              debit: cogsAmount,
              credit: 0,
            },
            {
              accountId: accounts.INVENTORY_ASSET.id,
              description: 'Inventory issued',
              debit: 0,
              credit: cogsAmount,
            },
          ]
        : []),
    ];

    return this.postingEngine.postLines(
      {
        companyId: input.order.companyId,
        divisionId: input.order.divisionId,
        branchId: input.order.branchId,
        transactionDate: input.order.orderDate,
        description,
        referenceType: 'SalesOrder',
        referenceId: input.order.id,
        moduleName: 'sales-orders',
        userId: input.userId,
        lines,
      },
      input.tx,
    );
  }

  /**
   * Post a balanced reversing journal entry that exactly unwinds the
   * confirmation entry for a sales order being cancelled (DECISION 2).
   *
   * Looks up the original POSTED journal (preferring the stored
   * `journalEntryId`, falling back to the SalesOrder reference) and posts a new
   * entry that swaps debit and credit on EVERY original line. Swapping each line
   * always balances (the original balanced) and exactly offsets the original's
   * AR/Cash, Revenue, VAT and COGS/Inventory impact. Runs inside the caller's
   * cancellation transaction so the GL reversal commits atomically with the
   * receivable cancellation and stock return.
   *
   * No-op (returns null) when the order has no traceable confirmation journal —
   * e.g. a DRAFT that never posted — so cancelling such an order is safe.
   */
  private async reverseSalesOrderJournal(
    tx: Prisma.TransactionClient,
    order: {
      id: string;
      companyId: string;
      salesOrderNumber: string;
      journalEntryId?: string | null;
      orderDate: Date;
    },
    userId: string,
  ): Promise<{ id: string; journalNumber: string } | null> {
    const original = order.journalEntryId
      ? await tx.journalEntry.findFirst({
          where: { id: order.journalEntryId, companyId: order.companyId, deletedAt: null },
          include: { lines: true },
        })
      : await tx.journalEntry.findFirst({
          where: {
            companyId: order.companyId,
            referenceType: 'SalesOrder',
            referenceId: order.id,
            deletedAt: null,
          },
          include: { lines: true },
          orderBy: { createdAt: 'desc' },
        });

    if (!original || original.lines.length === 0) return null;

    // Atomic claim: flip the original entry to REVERSED, guarded on it not already
    // being reversed, BEFORE posting anything. Two concurrent cancels race here; the
    // loser sees count 0 and skips, so the reversal swing is posted exactly once. A
    // failure further down rolls this claim back with the transaction.
    const claim = await tx.journalEntry.updateMany({
      where: { id: original.id, status: { not: 'REVERSED' }, deletedAt: null },
      data: { status: 'REVERSED', reversedAt: new Date(), reversedById: userId },
    });
    if (claim.count !== 1) return null;

    const reversedLines = original.lines.map((line) => ({
      accountId: line.accountId,
      // Swap each side: a debit becomes a credit of the same magnitude and
      // vice-versa. A zero stays zero.
      debit: roundMoney(Number(line.credit ?? 0)),
      credit: roundMoney(Number(line.debit ?? 0)),
      description: `Reversal: ${line.description ?? ''}`.trim(),
      divisionId: line.divisionId ?? undefined,
      branchId: line.branchId ?? undefined,
    }));

    const reversal = await this.postingEngine.postLines(
      {
        companyId: original.companyId,
        divisionId: original.divisionId,
        branchId: original.branchId,
        transactionDate: new Date(),
        description: `Reversal of sales order ${order.salesOrderNumber}`,
        referenceType: 'SalesOrder',
        referenceId: order.id,
        moduleName: 'sales-orders',
        userId,
        lines: reversedLines,
      },
      tx,
    );

    // Link the reversal to the original (already flipped to REVERSED by the atomic
    // claim above) so reconciliation can pair them.
    await tx.journalEntry.update({
      where: { id: reversal.id },
      data: { reversalOfId: original.id },
    });

    return reversal;
  }

  /**
   * One-shot create + confirm in a single operator action — the heart of the
   * Quick Sale flow (Westsides W2). Internally still creates the SalesOrder
   * first (its own transaction) then confirms (a second transaction that
   * issues inventory, decrements batches, posts the cash receipt or
   * receivable, and auto-creates a commission). If `confirm` throws, the
   * created DRAFT order is left in the database — the operator sees it in
   * the regular list and can retry or delete.
   */
  async quickSale(dto: CreateSalesOrderDto, user: AuthUser) {
    // Quick-sale defaults: never CREDIT (a counter sale is paid before
    // walking out). Operators who need credit should use the standard
    // Sales Order flow or the Mobile POS, which preserves CREDIT.
    const safeDto: CreateSalesOrderDto = {
      ...dto,
      paymentMethod:
        dto.paymentMethod && dto.paymentMethod !== 'CREDIT' ? dto.paymentMethod : 'CASH',
    };
    return this.createAndConfirm(safeDto, user);
  }

  /**
   * Shared atomic create + confirm used by both quickSale() (cash-only) and
   * mobilePosQuickSale() (full parity, CREDIT allowed). Backfills the division
   * from the branch, and — when an idempotencyKey is supplied — replays the
   * original order instead of creating a duplicate, so a retried checkout over
   * a flaky mobile network is safe.
   */
  private async createAndConfirm(
    dto: CreateSalesOrderDto,
    user: AuthUser,
    context: SalesOrderCreateContext = {},
  ) {
    const safeDto: CreateSalesOrderDto = { ...dto };
    if (!safeDto.divisionId && safeDto.branchId) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: safeDto.branchId, deletedAt: null },
        select: { divisionId: true },
      });
      if (branch) safeDto.divisionId = branch.divisionId;
    }

    // Derive output VAT BEFORE the idempotent-replay matcher. create() persists
    // the DERIVED lines (net unitPrice + carved-out taxAmount), so a retried
    // checkout carrying the original gross/untaxed payload must be normalized
    // the same way here — otherwise idempotentSalesOrderMatchesDto would compare
    // gross signatures against the persisted net lines, false-mismatch, and 409
    // every legitimate retry. Also covers the Kaunta / Mobile POS Lite path,
    // whose terminal service builds lines with taxAmount: 0 and routes through
    // mobilePosLiteQuickSale -> here.
    safeDto.lines = await this.deriveInclusiveOutputVat(safeDto.companyId, safeDto.lines);

    if (safeDto.idempotencyKey) {
      const replay = await this.replayQuickSale(
        safeDto.companyId,
        safeDto.idempotencyKey,
        safeDto,
        user,
      );
      if (replay) return replay;
    }

    let draft: Awaited<ReturnType<SalesOrdersService['create']>>;
    try {
      draft = await this.create(safeDto, user, context);
    } catch (error) {
      // Lost a race with a concurrent request carrying the same key — the
      // company-scoped unique index rejected the duplicate. Replay the winner.
      if (
        safeDto.idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.replayQuickSale(
          safeDto.companyId,
          safeDto.idempotencyKey,
          safeDto,
          user,
        );
        if (replay) return replay;
      }
      throw error;
    }
    return this.confirm(draft.id, user);
  }

  private async replayQuickSale(
    companyId: string,
    idempotencyKey: string,
    dto: CreateSalesOrderDto,
    user: AuthUser,
  ) {
    // IMPORTANT (#32): do NOT filter by deletedAt here. The unique index backing
    // idempotencyKey is @@unique([companyId, idempotencyKey]) with no deletedAt
    // component, so a soft-deleted order still occupies the key in the index. If
    // we hid soft-deleted rows, a retry whose original was soft-deleted would
    // (a) miss the pre-check replay, (b) run create(), (c) hit P2002, and (d)
    // miss the post-create replay too — wedging the client into a 500 loop that
    // can never succeed. By surfacing the soft-deleted row we can return a
    // deterministic ConflictException instead.
    const existing = await this.prisma.salesOrder.findFirst({
      where: { companyId, idempotencyKey },
      select: {
        id: true,
        companyId: true,
        divisionId: true,
        branchId: true,
        customerId: true,
        customerName: true,
        salesType: true,
        orderDate: true,
        dueDate: true,
        currency: true,
        paymentMethod: true,
        cashAccountId: true,
        subtotal: true,
        discountAmount: true,
        documentDiscount: true,
        taxAmount: true,
        totalAmount: true,
        status: true,
        deletedAt: true,
        lines: {
          select: {
            productId: true,
            quantity: true,
            unitId: true,
            unitPrice: true,
            discountAmount: true,
            taxAmount: true,
            batchId: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!existing) return null;

    // The original order behind this key was soft-deleted. The key value is
    // still occupied in the unique index, so we can't create a fresh order with
    // it. Fail deterministically instead of letting create() throw a raw P2002
    // that surfaces as a 500 the client retries forever.
    if (existing.deletedAt) {
      throw new ConflictException(
        'This checkout retry key belongs to a deleted sales order and can no longer be reused. Start a new sale with a fresh key.',
      );
    }

    if (!idempotentSalesOrderMatchesDto(existing, dto)) {
      throw new ConflictException(
        'This checkout retry key is already attached to a different sales order. Start a new sale and try again.',
      );
    }

    if (existing.status !== 'CONFIRMED' && existing.status !== 'PAID') {
      throw new ConflictException(
        'The previous checkout attempt was not confirmed. Open the sales order list to retry or delete the draft before charging again.',
      );
    }

    return this.findOne(existing.id, user);
  }

  async cancel(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (!['DRAFT', 'CONFIRMED'].includes(existing.status as string)) {
      throw new BadRequestException('Only DRAFT or CONFIRMED sales orders can be cancelled');
    }
    // Double-reversal guard (fail-closed): if an ISSUED credit note already
    // exists against this order, revenue/VAT/AR have ALREADY been reversed by
    // that credit note. Letting cancel() run its own confirmation reversal here
    // would unwind the same amounts a second time and double-count the trial
    // balance. Reject and require voiding the credit note first. This is purely
    // additive — it changes nothing about the existing reversal / receivable
    // zeroing behaviour below.
    const issuedCreditNote = await this.prisma.creditNote.findFirst({
      where: {
        salesOrderId: id,
        companyId: existing.companyId,
        status: 'ISSUED',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (issuedCreditNote) {
      throw new ConflictException(
        'Cannot cancel a sales order that has an issued credit note against it; void the credit note first.',
      );
    }
    // Money guard: a cash sale (paid at confirmation) or a partially/fully paid
    // credit order has collected cash. Cancelling here only reverses stock and
    // zeroes the receivable's outstanding — it posts NO reversing cash/journal
    // entry and leaves paidAmount orphaned, drifting the ledger. Block it and
    // require an explicit refund / credit note to reverse the payment first.
    if (Number(existing.paidAmount ?? 0) > 0 || existing.paymentStatus !== 'UNPAID') {
      throw new BadRequestException(
        'This sales order has received payment and cannot be cancelled directly. ' +
          'Record a refund or credit note to reverse the payment first.',
      );
    }

    const record = await this.prisma.$transaction(async (tx) => {
      if (existing.status === 'CONFIRMED') {
        // GL reversal (DECISION 2): a CONFIRMED order posted a balanced
        // confirmation journal (DR AR/Cash, CR Revenue/VAT, plus DR COGS / CR
        // Inventory). The SALES_RETURN movement below unwinds the inventory
        // subledger, but the GL still carries the confirmation entry. Post a
        // balanced reversing journal that swaps debit/credit on every line of
        // the original entry, inside this transaction, so AR/Revenue/VAT/COGS
        // unwind together with the receivable and stock. Without this, every
        // cancelled confirmed order permanently drifts the trial balance.
        // (reverseSalesOrderJournal no-ops when no confirmation JE exists, e.g.
        // quotation/proforma-converted orders, so the GL stays untouched there.)
        await this.reverseSalesOrderJournal(tx, existing as any, userId);

        // Phantom-inventory guard: only reverse stock that was ACTUALLY issued.
        // confirm() is the sole path that posts SALE_ISSUE movements; but
        // quotation/proforma conversion creates a CONFIRMED order WITHOUT ever
        // issuing stock (no SALE_ISSUE). Blindly posting a SALES_RETURN for every
        // stock line (an INBOUND movement) would inject phantom on-hand quantity
        // that was never removed, with no offsetting GL entry. Load the real
        // SALE_ISSUE movements for this order and reverse each product only up to
        // the net quantity that was issued, so a never-issued order reverses
        // nothing.
        const issueMovements = await tx.inventoryMovement.findMany({
          where: {
            companyId: existing.companyId,
            referenceType: 'SalesOrder',
            referenceId: id,
            movementType: 'SALE_ISSUE',
          },
          select: { productId: true, quantity: true },
        });
        // Sum issued quantity per product (a product may span multiple lines).
        const issuedQtyByProduct = new Map<string, number>();
        for (const mv of issueMovements) {
          issuedQtyByProduct.set(
            mv.productId,
            (issuedQtyByProduct.get(mv.productId) ?? 0) + Number(mv.quantity),
          );
        }
        // Guard against already-recorded SALES_RETURN reversals (idempotency /
        // partial prior reversal): subtract any stock already returned for this
        // order so a re-run never over-reverses.
        const returnMovements = await tx.inventoryMovement.findMany({
          where: {
            companyId: existing.companyId,
            referenceType: 'SalesOrder',
            referenceId: id,
            movementType: 'SALES_RETURN',
          },
          select: { productId: true, quantity: true },
        });
        for (const mv of returnMovements) {
          issuedQtyByProduct.set(
            mv.productId,
            (issuedQtyByProduct.get(mv.productId) ?? 0) - Number(mv.quantity),
          );
        }

        for (const line of existing.lines as any[]) {
          const product = await tx.product.findUnique({ where: { id: line.productId } });
          if (!product || !this.profit.isStockProduct(product)) continue;
          if (!existing.branchId) {
            throw new BadRequestException(
              'Sales order branch/location is required to reverse stock',
            );
          }

          // Reverse at most the quantity that remains outstanding-issued for this
          // product. If nothing was issued (converted order) this is <= 0 and we
          // skip the line, so no phantom stock is created.
          const remainingIssued = issuedQtyByProduct.get(line.productId) ?? 0;
          if (remainingIssued <= 0) continue;
          const reverseQty = Math.min(Number(line.quantity), remainingIssued);
          if (reverseQty <= 0) continue;
          // Consume the reversed amount so multiple lines of the same product
          // don't each reverse the full issued quantity.
          issuedQtyByProduct.set(line.productId, remainingIssued - reverseQty);

          try {
            const quantity = reverseQty;
            const lineQuantity = Number(line.quantity);
            const frozenUnitCost = Number(line.unitCostAtSale ?? 0);
            // Per-unit cost is derived from the FULL line's cogsAmount/quantity,
            // not the (possibly partial) reversed quantity, so a partial reversal
            // still values each returned unit at its true unit cost.
            const cogsUnitCost =
              lineQuantity > 0 && line.cogsAmount != null
                ? Number(line.cogsAmount) / lineQuantity
                : 0;
            const unitCost =
              frozenUnitCost > 0
                ? frozenUnitCost
                : cogsUnitCost > 0
                  ? cogsUnitCost
                  : Number(product.defaultPurchasePrice ?? 0);
            await this.inventoryMovements.createMovement({
              companyId: existing.companyId,
              productId: line.productId,
              movementType: 'SALES_RETURN',
              quantity,
              unitId: line.unitId,
              unitCost,
              movementDate: new Date(),
              createdById: userId,
              referenceType: 'SalesOrder',
              referenceId: id,
              notes: `Reversal: cancellation of sales order ${existing.salesOrderNumber}`,
              divisionId: existing.divisionId ?? undefined,
              branchId: existing.branchId,
              tx,
            });
          } catch (err: any) {
            throw new BadRequestException(
              `Failed to reverse inventory movement for product "${product.name}": ${err.message}`,
            );
          }
        }
      }

      if (existing.receivableId) {
        const cancelledReceivable = await tx.receivable.update({
          where: { id: existing.receivableId },
          data: {
            status: 'CANCELLED',
            outstandingAmount: 0,
          },
        });
        await this.syncCustomerBalance(
          tx,
          cancelledReceivable.companyId,
          cancelledReceivable.customerId,
        );
      }

      return tx.salesOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });
    });

    await this.auditLogs.log({
      action: 'SALES_ORDER_CANCEL',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: record.companyId,
      oldValue: { status: existing.status } as any,
      newValue: { status: 'CANCELLED' } as any,
      severity: AuditSeverity.MEDIUM,
    });

    return this.findOne(id, user);
  }

  async remove(id: string, user: AuthUser) {
    const userId = user.id;
    const existing = await this.findOne(id, user, AccessLevel.WRITE);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT sales orders can be deleted');
    }

    await this.prisma.salesOrder.update({ where: { id }, data: { deletedAt: new Date() } });

    await this.auditLogs.log({
      action: 'SALES_ORDER_DELETE',
      entityType: 'SalesOrder',
      entityId: id,
      userId,
      companyId: existing.companyId,
      oldValue: existing as any,
    });

    return { success: true };
  }

  private async syncCustomerBalance(
    tx: Prisma.TransactionClient,
    companyId: string,
    customerId?: string | null,
  ) {
    if (!customerId) return;
    const summary = await tx.receivable.aggregate({
      where: {
        companyId,
        customerId,
        deletedAt: null,
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] as any },
      },
      _sum: { outstandingAmount: true },
    });
    await tx.customer.updateMany({
      where: { id: customerId, companyId, deletedAt: null },
      data: { currentBalance: summary._sum.outstandingAmount ?? 0 },
    });
  }
}

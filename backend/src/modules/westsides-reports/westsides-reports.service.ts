import { Injectable } from '@nestjs/common';
import {
  AccessLevel,
  DeliveryNoteStatus,
  PurchaseOrderStatus,
  SalesOrderStatus,
  SalesPaymentMethod,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { businessDayWindow } from '../../common/utils/business-day';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { QueryReportDto } from './dto/query-report.dto';
import { SaveDailyCloseDto } from './dto/save-daily-close.dto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';

/**
 * All sales metrics now read from SalesOrder (POS module retired in W1).
 * "Confirmed" sales = SalesOrder.status ∈ {CONFIRMED, PARTIALLY_PAID, PAID}.
 * SalesOrderStatus is { DRAFT, CONFIRMED, PARTIALLY_PAID, PAID, CANCELLED, VOIDED } —
 * `CLOSED` was a stale value carried over from an earlier draft of the enum
 * and caused Prisma to reject `status: { in: [...] }` clauses at runtime.
 * Reference the enum so any future drift is a compile error.
 * The "transaction date" equivalent is SalesOrder.orderDate.
 */
const CONFIRMED_SALES_STATUSES = [
  SalesOrderStatus.CONFIRMED,
  SalesOrderStatus.PARTIALLY_PAID,
  SalesOrderStatus.PAID,
] as const;

const REPORTABLE_PURCHASE_STATUSES = [
  PurchaseOrderStatus.CONFIRMED,
  PurchaseOrderStatus.RECEIVED,
  PurchaseOrderStatus.PARTIALLY_RECEIVED,
] as const;

/**
 * Delivery-note statuses that count as DELIVERED COVERAGE in the undelivered
 * confirmed-orders cutoff report. DRAFT / DISPATCHED notes are goods that may
 * be on a truck — reported as in-transit context, never as coverage.
 * PARTIALLY_DELIVERED is enum-legal (and read by dashboards) even though no
 * service writes it today.
 */
const DELIVERY_COVERING_STATUSES: ReadonlySet<string> = new Set([
  DeliveryNoteStatus.DELIVERED,
  DeliveryNoteStatus.PARTIALLY_DELIVERED,
]);

/**
 * Product types that carry no stock value, mirroring profit.isStockProduct()
 * (and the STOCK_PRODUCT_WHERE filter profit.service.ts uses for its
 * missing-cost disclosure). A stock line whose cogsAmount was never
 * snapshotted must be FLAGGED, not silently folded into totals as zero cost —
 * a service/non-stock line legitimately has no COGS and is never flagged.
 */
const STOCK_EXEMPT_PRODUCT_TYPES: ReadonlySet<string> = new Set(['SERVICE', 'NON_STOCK_ITEM']);

function isStockProductShape(
  product?: { trackInventory?: boolean | null; productType?: string | null } | null,
): boolean {
  if (product?.trackInventory === false) return false;
  return !STOCK_EXEMPT_PRODUCT_TYPES.has(String(product?.productType ?? '').toUpperCase());
}

/** Candidate orders examined per undelivered-orders request (totals scope). */
const UNDELIVERED_ORDERS_SCAN_CAP = 1000;
/** Rows returned per undelivered-orders request (largest exposure first). */
const UNDELIVERED_ORDERS_ROW_CAP = 200;
/** Days after which an undelivered order with no delivery note is CRITICAL. */
const UNDELIVERED_STALE_DAYS = 30;

export type ReportReadinessStatus = 'READY' | 'INFO' | 'WARNING' | 'CRITICAL';

export interface ReportReadinessCheck {
  key: string;
  status: ReportReadinessStatus;
  label: string;
  detail: string;
}

export interface ReportRowMeta {
  readiness?: {
    status: ReportReadinessStatus;
    score?: number;
    message: string;
    checks?: ReportReadinessCheck[];
  };
  lineage?: {
    source: string;
    sourceTables: string[];
    measures: string[];
    scope: string;
  };
  drillThrough?: Array<{
    label: string;
    href: string;
    entityType?: string;
    entityId?: string | null;
  }>;
  actions?: Array<{
    label: string;
    href: string;
    kind: 'view' | 'review' | 'print' | 'export';
  }>;
}

/** One (paymentMethod, cashAccount) expected-receipts cell of a till row. */
export interface DailyCloseTerminalMethodRow {
  paymentMethod: string;
  cashAccountId: string | null;
  cashAccountName: string | null;
  cashAccountType: string | null;
  /** The terminal's own configured label for this method (a till number, say). */
  methodLabel: string | null;
  count: number;
  expected: number;
  paid: number;
}

/**
 * One per-till row of the daily close: expected receipts attributed to the
 * terminal that rang them, joined with the terminal's own MobilePosDayReport
 * (its custody record) for the same business day. `kind: 'COUNTER'` is the
 * remainder row — confirmed sales with no terminal (desk quick sale etc.).
 */
export interface DailyCloseTerminalRow {
  terminalId: string | null;
  kind: 'TERMINAL' | 'COUNTER';
  terminalCode: string | null;
  terminalName: string | null;
  /** The terminal's configured CASH label (a till number, say). */
  tillLabel: string | null;
  cashier: {
    userId: string | null;
    name: string | null;
    source: 'DAY_REPORT' | 'TERMINAL_ASSIGNED' | null;
  };
  salesCount: number;
  expectedTotal: number;
  paidTotal: number;
  expectedByMethod: DailyCloseTerminalMethodRow[];
  /**
   * Expected receipts over the SAME business-day window the terminal's own
   * day report covers ([00:00, 24:00) in MOBILE_POS_BUSINESS_TIMEZONE) — the
   * figure `dayReport.grossTotal` must be compared against. `expectedTotal`
   * above stays on this Z-report's own day window so the till rows keep
   * summing exactly to the branch totals; on a host whose local day matches
   * the business day the two figures coincide.
   */
  businessDayExpectedTotal: number;
  businessDaySalesCount: number;
  dayReport: {
    submittedAt: string;
    repUserId: string;
    /** The newest rep, or every summed rep joined with ' + ' on a handover. */
    repName: string;
    salesCount: number;
    grossTotal: number;
    byMethod: Array<{
      paymentMethod: string;
      label: string | null;
      count: number;
      amount: number;
    }>;
    declaredHeldCount: number;
    declaredHeldAmount: number;
    /** How many reports the terminal filed for the day (all reps, re-closes included). */
    reportCount: number;
    /**
     * How many cashiers' latest closes are summed into the figures above. A
     * day report is cumulative PER REP-DAY, so under a shift handover the
     * terminal-day is the SUM of each rep's latest close — never just the
     * newest report.
     */
    repCount: number;
  } | null;
}

@Injectable()
export class WestsidesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  private dateFilter(dateFrom?: string, dateTo?: string) {
    if (!dateFrom && !dateTo) return undefined;
    return {
      ...(dateFrom && { gte: new Date(dateFrom) }),
      ...(dateTo && { lte: new Date(dateTo) }),
    };
  }

  private async companyWhere(
    query: Pick<QueryReportDto, 'companyId'>,
    user: AuthUser,
  ): Promise<any> {
    return this.companyScope.companyWhereFor(user, query.companyId) as any;
  }

  private toNumber(value: unknown): number {
    return Number(value ?? 0);
  }

  private groupLineRowsByDimensions(
    rows: Record<string, unknown>[],
    input: {
      dimensionKeys: string[];
      documentKey: string;
      averageKey: string;
    },
  ) {
    const grouped = new Map<string, Record<string, unknown>>();
    const documentsByGroup = new Map<string, Set<string>>();

    for (const row of rows) {
      const key = input.dimensionKeys.map((dimension) => String(row[dimension] ?? '')).join('|');
      const current =
        grouped.get(key) ??
        Object.fromEntries([
          ...input.dimensionKeys.map((dimension) => [dimension, row[dimension]]),
          ['documentCount', 0],
          ['lineCount', 0],
          ['quantity', 0],
          ['totalAmount', 0],
          ['discountAmount', 0],
          ['taxAmount', 0],
          [input.averageKey, 0],
        ]);
      const documents = documentsByGroup.get(key) ?? new Set<string>();
      if (row[input.documentKey]) documents.add(String(row[input.documentKey]));

      current.documentCount = documents.size;
      current.lineCount = this.toNumber(current.lineCount) + 1;
      current.quantity = this.toNumber(current.quantity) + this.toNumber(row.quantity);
      current.totalAmount = this.toNumber(current.totalAmount) + this.toNumber(row.amount);
      current.discountAmount =
        this.toNumber(current.discountAmount) + this.toNumber(row.discountAmount);
      current.taxAmount = this.toNumber(current.taxAmount) + this.toNumber(row.taxAmount);
      current[input.averageKey] =
        this.toNumber(current.quantity) > 0
          ? this.toNumber(current.totalAmount) / this.toNumber(current.quantity)
          : 0;

      documentsByGroup.set(key, documents);
      grouped.set(key, current);
    }

    return Array.from(grouped.values()).sort(
      (a, b) => this.toNumber(b.totalAmount) - this.toNumber(a.totalAmount),
    );
  }

  private route(path: string, params: Record<string, unknown> = {}) {
    const query = Object.entries(params)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
      .join('&');
    return query ? `${path}${path.includes('?') ? '&' : '?'}${query}` : path;
  }

  private reportMeta(meta: ReportRowMeta) {
    return { _reportMeta: meta };
  }

  private lineage(source: string, sourceTables: string[], measures: string[], scope = 'Westsides') {
    return { source, sourceTables, measures, scope };
  }

  private readiness(
    status: ReportReadinessStatus,
    message: string,
    checks: ReportReadinessCheck[] = [],
    score?: number,
  ) {
    return { status, score, message, checks };
  }

  private statusFromAmount(amount: number, warningAt = 1): ReportReadinessStatus {
    if (amount <= 0) return 'READY';
    return amount >= warningAt ? 'WARNING' : 'INFO';
  }

  private daysUntil(date: Date | null | undefined, from = new Date()) {
    if (!date) return null;
    const ms = date.getTime() - from.getTime();
    return Math.ceil(ms / (24 * 3600 * 1000));
  }

  private dailyCloseReadiness(checks: ReportReadinessCheck[]) {
    const critical = checks.filter((check) => check.status === 'CRITICAL').length;
    const warnings = checks.filter((check) => check.status === 'WARNING').length;
    const infos = checks.filter((check) => check.status === 'INFO').length;
    const score = Math.max(0, 100 - critical * 25 - warnings * 10 - infos * 2);
    return {
      status: critical > 0 ? 'BLOCKED' : warnings > 0 ? 'NEEDS_REVIEW' : 'READY',
      closeReady: critical === 0,
      score,
      target: 90,
      criticalCount: critical,
      warningCount: warnings,
      infoCount: infos,
      checks,
    };
  }

  private async productMap(productIds: Array<string | null | undefined>) {
    const ids = Array.from(new Set(productIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0)
      return new Map<
        string,
        { id: string; productCode: string; name: string; sku: string | null }
      >();
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      select: { id: true, productCode: true, name: true, sku: true },
    });
    return new Map(products.map((product) => [product.id, product]));
  }

  private async employeeMap(employeeIds: Array<string | null | undefined>) {
    const ids = Array.from(new Set(employeeIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0)
      return new Map<string, { id: string; fullName: string; employeeCode: string }>();
    const employees = await this.prisma.employee.findMany({
      where: { id: { in: ids } },
      select: { id: true, fullName: true, employeeCode: true },
    });
    return new Map(employees.map((employee) => [employee.id, employee]));
  }

  private async customerMap(customerIds: Array<string | null | undefined>) {
    const ids = Array.from(new Set(customerIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0)
      return new Map<string, { id: string; name: string; customerCode: string }>();
    const customers = await this.prisma.customer.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, customerCode: true },
    });
    return new Map(customers.map((customer) => [customer.id, customer]));
  }

  private async supplierMap(supplierIds: Array<string | null | undefined>) {
    const ids = Array.from(new Set(supplierIds.filter((id): id is string => Boolean(id))));
    if (ids.length === 0)
      return new Map<string, { id: string; name: string; supplierCode: string }>();
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, supplierCode: true },
    });
    return new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  }

  private async salesWhere(query: QueryReportDto, user: AuthUser): Promise<any> {
    const { companyId, branchId, dateFrom, dateTo } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const where: any = {
      ...companyWhere,
      status: { in: CONFIRMED_SALES_STATUSES as unknown as any },
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;
    const df = this.dateFilter(dateFrom, dateTo);
    if (df) where.orderDate = df;
    return where;
  }

  private async purchaseWhere(query: QueryReportDto, user: AuthUser): Promise<any> {
    const { companyId, branchId, dateFrom, dateTo } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const where: any = {
      ...companyWhere,
      status: { in: REPORTABLE_PURCHASE_STATUSES as unknown as any },
      deletedAt: null,
    };
    if (branchId) where.branchId = branchId;
    const df = this.dateFilter(dateFrom, dateTo);
    if (df) where.orderDate = df;
    return where;
  }

  async salesReport(query: QueryReportDto, user: AuthUser) {
    const where = await this.salesWhere(query, user);
    const [ordersAgg, lines] = await Promise.all([
      this.prisma.salesOrder.aggregate({
        where,
        _count: { id: true },
        _sum: {
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
        },
      }),
      this.prisma.salesOrderLine.findMany({
        where: { salesOrder: where },
        orderBy: [{ salesOrder: { orderDate: 'desc' } }, { createdAt: 'asc' }],
        include: {
          product: { select: { productCode: true, name: true, sku: true } },
          unit: { select: { symbol: true, name: true } },
          salesOrder: {
            select: {
              salesOrderNumber: true,
              orderDate: true,
              customerName: true,
              customer: { select: { name: true, customerCode: true } },
              salesType: true,
              paymentMethod: true,
              paymentStatus: true,
              salesperson: { select: { fullName: true, employeeCode: true } },
            },
          },
        },
      }),
    ]);

    const rows = lines.map((line) => ({
      date: line.salesOrder.orderDate.toISOString(),
      salesOrderNumber: line.salesOrder.salesOrderNumber,
      customer:
        line.salesOrder.customer?.name ??
        line.salesOrder.customerName ??
        'Walk-in / unassigned customer',
      customerCode: line.salesOrder.customer?.customerCode ?? null,
      productCode: line.product.productCode,
      sku: line.product.sku,
      product: line.product.name,
      description: line.description,
      quantity: this.toNumber(line.quantity),
      unit: line.unit.symbol || line.unit.name,
      unitPrice: this.toNumber(line.unitPrice),
      discountAmount: this.toNumber(line.discountAmount),
      taxAmount: this.toNumber(line.taxAmount),
      amount: this.toNumber(line.lineTotal),
      paymentMethod: line.salesOrder.paymentMethod,
      paymentStatus: line.salesOrder.paymentStatus,
      salesperson:
        line.salesOrder.salesperson?.fullName ?? line.salesOrder.salesperson?.employeeCode ?? null,
    }));

    return {
      summary: {
        orders: ordersAgg._count.id,
        lines: rows.length,
        quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
        subtotal: this.toNumber(ordersAgg._sum.subtotal),
        discountAmount: this.toNumber(ordersAgg._sum.discountAmount),
        taxAmount: this.toNumber(ordersAgg._sum.taxAmount),
        totalAmount: this.toNumber(ordersAgg._sum.totalAmount),
        paidAmount: this.toNumber(ordersAgg._sum.paidAmount),
        outstandingAmount: this.toNumber(ordersAgg._sum.outstandingAmount),
      },
      rows,
    };
  }

  async salesByCustomer(query: QueryReportDto, user: AuthUser) {
    const rows = await this.prisma.salesOrder.groupBy({
      by: ['customerId', 'customerName'],
      where: await this.salesWhere(query, user),
      _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      _count: { id: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
    });
    const customers = await this.customerMap(rows.map((row) => row.customerId));
    return rows.map((row) => {
      const customer = row.customerId ? customers.get(row.customerId) : null;
      return {
        customerCode: customer?.customerCode ?? null,
        customer: customer?.name ?? row.customerName ?? 'Walk-in / unassigned customer',
        orders: row._count.id,
        totalAmount: this.toNumber(row._sum.totalAmount),
        paidAmount: this.toNumber(row._sum.paidAmount),
        outstandingAmount: this.toNumber(row._sum.outstandingAmount),
      };
    });
  }

  async customerProductSales(query: QueryReportDto, user: AuthUser) {
    const report = await this.salesReport(query, user);
    return {
      summary: report.summary,
      rows: this.groupLineRowsByDimensions(report.rows, {
        dimensionKeys: ['customerCode', 'customer', 'productCode', 'sku', 'product', 'unit'],
        documentKey: 'salesOrderNumber',
        averageKey: 'averageUnitPrice',
      }),
    };
  }

  async purchaseReport(query: QueryReportDto, user: AuthUser) {
    const where = await this.purchaseWhere(query, user);
    const [ordersAgg, lines] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where,
        _count: { id: true },
        _sum: {
          subtotal: true,
          discountAmount: true,
          taxAmount: true,
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
        },
      }),
      this.prisma.purchaseOrderLine.findMany({
        where: { purchaseOrder: where },
        orderBy: [{ purchaseOrder: { orderDate: 'desc' } }, { createdAt: 'asc' }],
        include: {
          product: { select: { productCode: true, name: true, sku: true } },
          unit: { select: { symbol: true, name: true } },
          purchaseOrder: {
            select: {
              purchaseOrderNumber: true,
              orderDate: true,
              supplierName: true,
              supplier: { select: { name: true, supplierCode: true } },
              purchaseType: true,
              paymentStatus: true,
              status: true,
            },
          },
        },
      }),
    ]);

    const rows = lines.map((line) => ({
      date: line.purchaseOrder.orderDate.toISOString(),
      purchaseOrderNumber: line.purchaseOrder.purchaseOrderNumber,
      supplier:
        line.purchaseOrder.supplier?.name ??
        line.purchaseOrder.supplierName ??
        'Unassigned supplier',
      supplierCode: line.purchaseOrder.supplier?.supplierCode ?? null,
      productCode: line.product.productCode,
      sku: line.product.sku,
      product: line.product.name,
      description: line.description,
      quantity: this.toNumber(line.quantity),
      unit: line.unit.symbol || line.unit.name,
      unitCost: this.toNumber(line.unitCost),
      discountAmount: this.toNumber(line.discountAmount),
      taxAmount: this.toNumber(line.taxAmount),
      amount: this.toNumber(line.lineTotal),
      purchaseType: line.purchaseOrder.purchaseType,
      status: line.purchaseOrder.status,
      paymentStatus: line.purchaseOrder.paymentStatus,
    }));

    return {
      summary: {
        purchaseOrders: ordersAgg._count.id,
        lines: rows.length,
        quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
        subtotal: this.toNumber(ordersAgg._sum.subtotal),
        discountAmount: this.toNumber(ordersAgg._sum.discountAmount),
        taxAmount: this.toNumber(ordersAgg._sum.taxAmount),
        totalAmount: this.toNumber(ordersAgg._sum.totalAmount),
        paidAmount: this.toNumber(ordersAgg._sum.paidAmount),
        outstandingAmount: this.toNumber(ordersAgg._sum.outstandingAmount),
      },
      rows,
    };
  }

  async purchasesBySupplier(query: QueryReportDto, user: AuthUser) {
    const rows = await this.prisma.purchaseOrder.groupBy({
      by: ['supplierId', 'supplierName'],
      where: await this.purchaseWhere(query, user),
      _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      _count: { id: true },
      orderBy: { _sum: { totalAmount: 'desc' } },
    });
    const suppliers = await this.supplierMap(rows.map((row) => row.supplierId));
    return rows.map((row) => {
      const supplier = row.supplierId ? suppliers.get(row.supplierId) : null;
      return {
        supplierCode: supplier?.supplierCode ?? null,
        supplier: supplier?.name ?? row.supplierName ?? 'Unassigned supplier',
        purchaseOrders: row._count.id,
        totalAmount: this.toNumber(row._sum.totalAmount),
        paidAmount: this.toNumber(row._sum.paidAmount),
        outstandingAmount: this.toNumber(row._sum.outstandingAmount),
      };
    });
  }

  async supplierProductPurchases(query: QueryReportDto, user: AuthUser) {
    const report = await this.purchaseReport(query, user);
    return {
      summary: report.summary,
      rows: this.groupLineRowsByDimensions(report.rows, {
        dimensionKeys: ['supplierCode', 'supplier', 'productCode', 'sku', 'product', 'unit'],
        documentKey: 'purchaseOrderNumber',
        averageKey: 'averageUnitCost',
      }),
    };
  }

  async customersReport(query: QueryReportDto, user: AuthUser) {
    const { companyId, branchId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const where: any = { ...companyWhere, deletedAt: null };
    if (branchId) where.branchId = branchId;
    const [customers, salesRows] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          customerCode: true,
          name: true,
          phone: true,
          email: true,
          creditLimit: true,
          currentBalance: true,
          paymentTerms: true,
          status: true,
        },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['customerId'],
        where: await this.salesWhere(query, user),
        _sum: { totalAmount: true, outstandingAmount: true },
        _count: { id: true },
      }),
    ]);
    const salesByCustomer = new Map(salesRows.map((row) => [row.customerId, row]));
    return customers.map((customer) => {
      const sales = salesByCustomer.get(customer.id);
      return {
        customerCode: customer.customerCode,
        customer: customer.name,
        phone: customer.phone,
        email: customer.email,
        status: customer.status,
        paymentTerms: customer.paymentTerms,
        creditLimit: this.toNumber(customer.creditLimit),
        currentBalance: this.toNumber(customer.currentBalance),
        orders: sales?._count.id ?? 0,
        totalSales: this.toNumber(sales?._sum.totalAmount),
        outstandingSales: this.toNumber(sales?._sum.outstandingAmount),
      };
    });
  }

  async suppliersReport(query: QueryReportDto, user: AuthUser) {
    const { companyId, branchId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const where: any = { ...companyWhere, deletedAt: null };
    if (branchId) where.branchId = branchId;
    const [suppliers, purchaseRows] = await Promise.all([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          supplierCode: true,
          name: true,
          phone: true,
          email: true,
          creditLimit: true,
          currentBalance: true,
          paymentTerms: true,
          status: true,
        },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ['supplierId'],
        where: await this.purchaseWhere(query, user),
        _sum: { totalAmount: true, outstandingAmount: true },
        _count: { id: true },
      }),
    ]);
    const purchasesBySupplier = new Map(purchaseRows.map((row) => [row.supplierId, row]));
    return suppliers.map((supplier) => {
      const purchases = purchasesBySupplier.get(supplier.id);
      return {
        supplierCode: supplier.supplierCode,
        supplier: supplier.name,
        phone: supplier.phone,
        email: supplier.email,
        status: supplier.status,
        paymentTerms: supplier.paymentTerms,
        creditLimit: this.toNumber(supplier.creditLimit),
        currentBalance: this.toNumber(supplier.currentBalance),
        purchaseOrders: purchases?._count.id ?? 0,
        totalPurchases: this.toNumber(purchases?._sum.totalAmount),
        outstandingPurchases: this.toNumber(purchases?._sum.outstandingAmount),
      };
    });
  }

  /**
   * Daily Close / Z-Report — single-day aggregation across every dimension a
   * counter manager needs to reconcile cash/mobile-money/card receipts at
   * end-of-shift. Read-only; persists nothing. Operator-counted amounts and
   * variances are computed client-side against the `expectedByMethod` figures
   * returned here.
   */
  async dailyClose(query: { companyId: string; branchId?: string; date?: string }, user: AuthUser) {
    if (!query.companyId) {
      return null;
    }
    await this.companyScope.assertCanAccessCompany(user, query.companyId);
    const baseDate = query.date ? new Date(query.date) : new Date();
    // Truncate to local-day boundaries (UTC). For Tanzania (UTC+3) this is
    // close enough; if multi-timezone support is needed later, take an
    // explicit `tz` param and shift the boundary accordingly.
    const dayStart = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
    const yesterdayStart = new Date(dayStart.getTime() - 24 * 3600 * 1000);
    const closeDateKey = localCalendarDateKey(baseDate);
    // The window a terminal's own MobilePosDayReport is computed over:
    // [00:00, 24:00) of the SAME calendar label in the pinned business zone
    // (see common/utils/business-day.ts). Used ONLY for the per-till
    // reported-vs-expected comparison below, so the roll-up figures — and the
    // invariant that till rows sum exactly to the branch totals — keep the
    // Z-report's own day window untouched.
    const businessWindow = businessDayWindow(closeDateKey.toISOString().slice(0, 10));

    const where: any = {
      companyId: query.companyId,
      status: { in: CONFIRMED_SALES_STATUSES as unknown as any },
      deletedAt: null,
      orderDate: { gte: dayStart, lt: dayEnd },
    };
    if (query.branchId) where.branchId = query.branchId;

    const [
      totals,
      byMethod,
      bySalesType,
      bySalesperson,
      orders,
      mobileMoneyOrders,
      yesterdayTotals,
      byTerminalMethod,
      byTerminalBusinessDay,
    ] = await Promise.all([
      // Top-line totals.
      this.prisma.salesOrder.aggregate({
        where,
        _sum: {
          totalAmount: true,
          paidAmount: true,
          outstandingAmount: true,
          taxAmount: true,
          discountAmount: true,
        },
        _count: { id: true },
      }),
      // Per payment method (cash, mobile money, card, etc.) — grouped by
      // BOTH method and cashAccountId so an account-level reconciliation is
      // possible (e.g. M-Pesa Float vs Tigo Pesa Float).
      this.prisma.salesOrder.groupBy({
        by: ['paymentMethod', 'cashAccountId'],
        where,
        _sum: { totalAmount: true, paidAmount: true },
        _count: { id: true },
      }),
      // Per salesType (CASH_SALE / CREDIT_SALE / WHOLESALE / RETAIL / etc).
      this.prisma.salesOrder.groupBy({
        by: ['salesType'],
        where,
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Per salesperson.
      this.prisma.salesOrder.groupBy({
        by: ['salespersonId'],
        where,
        _sum: { totalAmount: true },
        _count: { id: true },
        orderBy: { _sum: { totalAmount: 'desc' } },
      }),
      // Order list for the bottom of the Z-report (compact list with order
      // number, time, customer, amount, payment method).
      this.prisma.salesOrder.findMany({
        where,
        orderBy: { orderDate: 'asc' },
        select: {
          id: true,
          salesOrderNumber: true,
          orderDate: true,
          customerName: true,
          customer: { select: { name: true } },
          totalAmount: true,
          paymentMethod: true,
          paymentReference: true,
          salesperson: { select: { fullName: true, employeeCode: true } },
        },
      }),
      // Mobile-money payment-reference list — for manual reconciliation
      // against the M-Pesa / Tigo Pesa paybill statement.
      this.prisma.salesOrder.findMany({
        where: { ...where, paymentMethod: 'MOBILE_MONEY' as any },
        select: {
          id: true,
          salesOrderNumber: true,
          paymentReference: true,
          totalAmount: true,
          cashAccountId: true,
        },
      }),
      // Yesterday's total — for the day-over-day delta tile.
      this.prisma.salesOrder.aggregate({
        where: {
          ...where,
          orderDate: { gte: yesterdayStart, lt: dayStart },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
      // Per (terminal, method, account) — the custody dimension. Every Kaunta
      // sale carries SalesOrder.mobilePosTerminalId, so expected receipts can
      // be attributed to the till that rang them; the NULL group is the
      // counter/quick-sale remainder. Same `where` as every query above, so
      // these rows always sum exactly to `totals` and `byMethod`.
      this.prisma.salesOrder.groupBy({
        by: ['mobilePosTerminalId', 'paymentMethod', 'cashAccountId'],
        where,
        _sum: { totalAmount: true, paidAmount: true },
        _count: { id: true },
      }),
      // Per terminal over the BUSINESS-day window — the window the terminal's
      // own MobilePosDayReport covers. This is what the report's declared
      // figures are compared against; the roll-up rows above keep the
      // Z-report's own window so they still sum exactly to `totals`.
      this.prisma.salesOrder.groupBy({
        by: ['mobilePosTerminalId'],
        where: {
          ...where,
          orderDate: { gte: businessWindow.dayStart, lt: businessWindow.dayEnd },
        },
        _sum: { totalAmount: true },
        _count: { id: true },
      }),
    ]);

    // Top SKUs for the day (top 10 by line total).
    const orderIds = orders.map((o) => o.id);
    const topProductsRaw =
      orderIds.length > 0
        ? await this.prisma.salesOrderLine.groupBy({
            by: ['productId'],
            where: { salesOrderId: { in: orderIds } },
            _sum: { quantity: true, lineTotal: true },
            orderBy: { _sum: { lineTotal: 'desc' } },
            take: 10,
          })
        : [];
    const productMeta =
      topProductsRaw.length > 0
        ? await this.prisma.product.findMany({
            where: { id: { in: topProductsRaw.map((p) => p.productId) } },
            select: { id: true, name: true, sku: true },
          })
        : [];
    const productById = new Map(productMeta.map((p) => [p.id, p]));
    const topProducts = topProductsRaw.map((p) => ({
      productId: p.productId,
      productName: productById.get(p.productId)?.name ?? 'Unknown',
      sku: productById.get(p.productId)?.sku ?? null,
      quantity: Number(p._sum.quantity ?? 0),
      total: Number(p._sum.lineTotal ?? 0),
    }));

    // Resolve cashAccount + salesperson names referenced by groupBy results.
    const cashAccountIds = Array.from(
      new Set(byMethod.map((m) => m.cashAccountId).filter((x): x is string => !!x)),
    );
    const cashAccounts =
      cashAccountIds.length > 0
        ? await this.prisma.cashAccount.findMany({
            where: { id: { in: cashAccountIds } },
            select: { id: true, accountName: true, accountType: true },
          })
        : [];
    const cashAccountById = new Map(cashAccounts.map((a) => [a.id, a]));

    const salespersonIds = bySalesperson
      .map((s) => s.salespersonId)
      .filter((x): x is string => !!x);
    const salespersons =
      salespersonIds.length > 0
        ? await this.prisma.employee.findMany({
            where: { id: { in: salespersonIds } },
            select: { id: true, fullName: true, employeeCode: true },
          })
        : [];
    const salespersonById = new Map(salespersons.map((e) => [e.id, e]));

    // ── Per-till attribution ────────────────────────────────────────────────
    // The POS reform's custody chain (device secret → terminal → cashier →
    // business day → drawer) records the terminal on every sale, and the
    // terminal files its own close as a MobilePosDayReport. Joining the two
    // here lets a branch cash variance be attributed per till instead of per
    // branch.
    //
    // Window note: the EXPECTED figures reuse this Z-report's own day window
    // (the shared `where`), so the till rows always tie out to the branch
    // rows above. The MobilePosDayReport is joined by its business-day LABEL
    // (`businessDate`, derived by Mobile POS Lite in
    // MOBILE_POS_BUSINESS_TIMEZONE) and its figures cover the BUSINESS-day
    // window, so the reported-vs-expected comparison reads
    // `businessDayExpectedTotal` — the same window — never `expectedTotal`.
    // The declared held figures are the one fact the server cannot compute
    // ("sent plus held is the drawer") and are surfaced BESIDE the expected
    // figures, never folded into them.
    //
    // A terminal that traded ONLY inside the business-day window (a night
    // till whose sales fall before the process-local boundary, say) still
    // gets a row: its `expectedTotal` is 0 — so the sum invariant holds — and
    // its day report is compared against its business-day figure.
    const terminalIds = Array.from(
      new Set(
        [...byTerminalMethod, ...byTerminalBusinessDay]
          .map((t) => t.mobilePosTerminalId)
          .filter((x): x is string => !!x),
      ),
    );
    const [terminals, terminalDayReports] = await Promise.all([
      terminalIds.length > 0
        ? this.prisma.mobilePosTerminal.findMany({
            where: { id: { in: terminalIds } },
            select: {
              id: true,
              terminalCode: true,
              name: true,
              assignedUser: { select: { id: true, fullName: true } },
              paymentMethods: { select: { paymentMethod: true, label: true } },
            },
          })
        : [],
      terminalIds.length > 0
        ? this.prisma.mobilePosDayReport.findMany({
            // Newest first. A day report is CUMULATIVE PER REP-DAY
            // (computeDayReport scopes sales to the closing rep), so a
            // same-rep re-close supersedes that rep's earlier report while a
            // cross-rep handover splits the terminal-day across reps. The
            // terminal-day truth is therefore the SUM of the latest report
            // per rep — assembled below — and `reportCount` discloses how
            // many reports were filed in all.
            where: {
              companyId: query.companyId,
              terminalId: { in: terminalIds },
              businessDate: closeDateKey,
            },
            orderBy: { submittedAt: 'desc' },
            select: {
              terminalId: true,
              repUserId: true,
              repName: true,
              submittedAt: true,
              salesCount: true,
              grossTotal: true,
              byMethod: true,
              declaredHeldCount: true,
              declaredHeldAmount: true,
            },
          })
        : [],
    ]);
    const terminalById = new Map(terminals.map((t) => [t.id, t]));
    const dayReportsByTerminal = new Map<string, typeof terminalDayReports>();
    for (const report of terminalDayReports) {
      const list = dayReportsByTerminal.get(report.terminalId) ?? [];
      list.push(report);
      dayReportsByTerminal.set(report.terminalId, list);
    }

    const terminalGroups = new Map<string | null, typeof byTerminalMethod>();
    for (const group of byTerminalMethod) {
      const key = group.mobilePosTerminalId ?? null;
      const list = terminalGroups.get(key) ?? [];
      list.push(group);
      terminalGroups.set(key, list);
    }
    const businessDayByTerminal = new Map(
      byTerminalBusinessDay.map((group) => [group.mobilePosTerminalId ?? null, group]),
    );
    // Every till the day touched in EITHER window gets a row; a
    // business-day-only till contributes 0 to the roll-up sums.
    const terminalRowKeys = new Set<string | null>([
      ...terminalGroups.keys(),
      ...businessDayByTerminal.keys(),
    ]);

    const byTerminal: DailyCloseTerminalRow[] = Array.from(terminalRowKeys).map((terminalId) => {
      const groups = terminalGroups.get(terminalId) ?? [];
      const terminal = terminalId ? terminalById.get(terminalId) : undefined;
      const reports = terminalId ? (dayReportsByTerminal.get(terminalId) ?? []) : [];
      // A day report is cumulative per rep-day, so the latest report PER
      // REP is that rep's whole slice of the terminal-day; keeping only the
      // newest overall would drop the first shift of a handover. `reports`
      // is submittedAt-desc, so first-seen-wins keeps each rep's latest.
      const latestPerRep: typeof reports = [];
      const seenReps = new Set<string>();
      for (const report of reports) {
        if (seenReps.has(report.repUserId)) continue;
        seenReps.add(report.repUserId);
        latestPerRep.push(report);
      }
      const latestReport = latestPerRep[0] ?? null;
      const mergedByMethod = new Map<
        string,
        { paymentMethod: string; label: string | null; count: number; amount: number }
      >();
      for (const report of latestPerRep) {
        const entries = (report.byMethod ?? []) as unknown as Array<{
          paymentMethod: string;
          label: string | null;
          count: number;
          amount: number;
        }>;
        for (const entry of entries) {
          const merged = mergedByMethod.get(entry.paymentMethod);
          if (merged) {
            merged.count += Number(entry.count ?? 0);
            merged.amount += Number(entry.amount ?? 0);
            if (merged.label == null && entry.label != null) merged.label = entry.label;
          } else {
            mergedByMethod.set(entry.paymentMethod, {
              paymentMethod: entry.paymentMethod,
              label: entry.label ?? null,
              count: Number(entry.count ?? 0),
              amount: Number(entry.amount ?? 0),
            });
          }
        }
      }
      const businessDayGroup = businessDayByTerminal.get(terminalId);
      const expectedByMethod: DailyCloseTerminalMethodRow[] = groups
        .map((g) => ({
          paymentMethod: String(g.paymentMethod),
          cashAccountId: g.cashAccountId,
          cashAccountName: g.cashAccountId
            ? (cashAccountById.get(g.cashAccountId)?.accountName ?? null)
            : null,
          cashAccountType: g.cashAccountId
            ? String(cashAccountById.get(g.cashAccountId)?.accountType ?? '') || null
            : null,
          methodLabel:
            terminal?.paymentMethods.find((p) => p.paymentMethod === g.paymentMethod)?.label ??
            null,
          count: g._count.id,
          expected: Number(g._sum.totalAmount ?? 0),
          paid: Number(g._sum.paidAmount ?? 0),
        }))
        .sort((a, b) => b.expected - a.expected);
      return {
        terminalId,
        kind: terminalId ? ('TERMINAL' as const) : ('COUNTER' as const),
        terminalCode: terminal?.terminalCode ?? null,
        terminalName: terminal?.name ?? (terminalId ? null : 'Counter / quick sale'),
        tillLabel:
          terminal?.paymentMethods.find((p) => p.paymentMethod === SalesPaymentMethod.CASH)
            ?.label ?? null,
        cashier: latestReport
          ? { userId: latestReport.repUserId, name: latestReport.repName, source: 'DAY_REPORT' }
          : terminal?.assignedUser
            ? {
                userId: terminal.assignedUser.id,
                name: terminal.assignedUser.fullName,
                source: 'TERMINAL_ASSIGNED',
              }
            : { userId: null, name: null, source: null },
        salesCount: expectedByMethod.reduce((sum, m) => sum + m.count, 0),
        expectedTotal: expectedByMethod.reduce((sum, m) => sum + m.expected, 0),
        paidTotal: expectedByMethod.reduce((sum, m) => sum + m.paid, 0),
        expectedByMethod,
        businessDayExpectedTotal: Number(businessDayGroup?._sum.totalAmount ?? 0),
        businessDaySalesCount: businessDayGroup?._count.id ?? 0,
        dayReport: latestReport
          ? {
              submittedAt: latestReport.submittedAt.toISOString(),
              repUserId: latestReport.repUserId,
              repName:
                latestPerRep.length > 1
                  ? latestPerRep.map((report) => report.repName).join(' + ')
                  : latestReport.repName,
              // Terminal-day figures: the SUM of each rep's latest
              // (cumulative rep-day) report, so a shift handover's first
              // shift is never dropped from the custody totals.
              salesCount: latestPerRep.reduce((sum, r) => sum + r.salesCount, 0),
              grossTotal: latestPerRep.reduce((sum, r) => sum + Number(r.grossTotal), 0),
              // `[{ paymentMethod, label, count, amount }]` — the shape the
              // day-report writer stores (see DayReportMethodTotal in
              // mobile-pos-lite.service.ts), merged across the summed
              // per-rep reports.
              byMethod: Array.from(mergedByMethod.values()),
              declaredHeldCount: latestPerRep.reduce((sum, r) => sum + r.declaredHeldCount, 0),
              declaredHeldAmount: latestPerRep.reduce(
                (sum, r) => sum + Number(r.declaredHeldAmount),
                0,
              ),
              reportCount: reports.length,
              repCount: latestPerRep.length,
            }
          : null,
      };
    });
    // Tills by expected size; the counter remainder always last.
    byTerminal.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'COUNTER' ? 1 : -1;
      return b.expectedTotal - a.expectedTotal;
    });

    const methodRows = byMethod.map((m) => {
      const expected = Number(m._sum.totalAmount ?? 0);
      const paid = Number(m._sum.paidAmount ?? 0);
      const requiresCashAccount = m.paymentMethod !== 'CREDIT';
      const missingCashAccount = requiresCashAccount && !m.cashAccountId;
      const varianceAtSource = Math.abs(expected - paid);
      return {
        paymentMethod: m.paymentMethod,
        cashAccountId: m.cashAccountId,
        cashAccountName: m.cashAccountId
          ? (cashAccountById.get(m.cashAccountId)?.accountName ?? null)
          : null,
        cashAccountType: m.cashAccountId
          ? (cashAccountById.get(m.cashAccountId)?.accountType ?? null)
          : null,
        count: m._count.id,
        expected,
        paid,
        varianceAtSource,
        requiresCount: m.paymentMethod !== 'CREDIT',
        readinessStatus: missingCashAccount
          ? 'CRITICAL'
          : varianceAtSource > 0
            ? 'WARNING'
            : 'READY',
        ...this.reportMeta({
          readiness: this.readiness(
            missingCashAccount ? 'CRITICAL' : varianceAtSource > 0 ? 'WARNING' : 'READY',
            missingCashAccount
              ? 'Payment method needs a mapped cash or bank account before close sign-off.'
              : varianceAtSource > 0
                ? 'Paid amount differs from expected sales amount; reconcile before approval.'
                : 'Payment method is ready for counted cash entry.',
          ),
          lineage: this.lineage(
            'Daily close payment-method aggregation',
            ['sales_orders', 'cash_accounts'],
            ['totalAmount', 'paidAmount', 'paymentMethod', 'cashAccountId'],
          ),
          drillThrough: [
            {
              label: 'Review sales orders',
              href: this.route('/operations/sales-orders', {
                companyId: query.companyId,
                branchId: query.branchId,
                paymentMethod: m.paymentMethod,
                dateFrom: dayStart.toISOString().slice(0, 10),
                dateTo: dayStart.toISOString().slice(0, 10),
              }),
              entityType: 'salesOrder',
            },
          ],
          actions: [
            {
              label: 'Open daily close',
              href: this.route('/westsides/daily-close', {
                companyId: query.companyId,
                branchId: query.branchId,
                date: dayStart.toISOString().slice(0, 10),
              }),
              kind: 'review',
            },
          ],
        }),
      };
    });

    const mobileMoneyReferences = mobileMoneyOrders.map((o) => ({
      id: o.id,
      salesOrderNumber: o.salesOrderNumber,
      reference: o.paymentReference,
      amount: Number(o.totalAmount),
      cashAccountId: o.cashAccountId,
      cashAccountName: o.cashAccountId
        ? (cashAccountById.get(o.cashAccountId)?.accountName ?? null)
        : null,
      readinessStatus: o.paymentReference ? 'READY' : 'WARNING',
      ...this.reportMeta({
        readiness: this.readiness(
          o.paymentReference ? 'READY' : 'WARNING',
          o.paymentReference
            ? 'Mobile-money reference is captured.'
            : 'Payment reference is missing; reconcile against the mobile-money statement.',
        ),
        lineage: this.lineage(
          'Mobile-money reference listing',
          ['sales_orders', 'cash_accounts'],
          ['paymentReference', 'totalAmount', 'cashAccountId'],
        ),
        drillThrough: [
          {
            label: 'Open sales order',
            href: this.route('/operations/sales-orders', { search: o.salesOrderNumber }),
            entityType: 'salesOrder',
            entityId: o.id,
          },
        ],
      }),
    }));

    const unassignedPaymentAccountCount = methodRows.filter(
      (m) => m.paymentMethod !== 'CREDIT' && !m.cashAccountId,
    ).length;
    const missingMobileMoneyReferenceCount = mobileMoneyReferences.filter(
      (m) => !m.reference,
    ).length;
    const unattributedSalespersonCount = bySalesperson
      .filter((s) => !s.salespersonId)
      .reduce((sum, s) => sum + s._count.id, 0);
    const exceptionList = [
      ...(totals._count.id === 0
        ? [
            {
              code: 'NO_SALES',
              severity: 'info',
              title: 'No sales recorded',
              detail: 'There are no confirmed sales for the selected close date.',
            },
          ]
        : []),
      ...(Number(totals._sum.outstandingAmount ?? 0) > 0
        ? [
            {
              code: 'CREDIT_OUTSTANDING',
              severity: 'warning',
              title: 'Credit exposure remains',
              detail: `TZS ${Number(totals._sum.outstandingAmount ?? 0).toLocaleString('en-TZ')} is outstanding on confirmed sales.`,
            },
          ]
        : []),
      ...(unassignedPaymentAccountCount > 0
        ? [
            {
              code: 'UNASSIGNED_CASH_ACCOUNT',
              severity: 'critical',
              title: 'Payment method missing cash account',
              detail: `${unassignedPaymentAccountCount} payment method group has no cash or bank account assigned.`,
            },
          ]
        : []),
      ...(missingMobileMoneyReferenceCount > 0
        ? [
            {
              code: 'MISSING_MOBILE_REFERENCE',
              severity: 'warning',
              title: 'Mobile-money references missing',
              detail: `${missingMobileMoneyReferenceCount} mobile-money sale needs a payment reference before approval.`,
            },
          ]
        : []),
      ...(unattributedSalespersonCount > 0
        ? [
            {
              code: 'UNATTRIBUTED_SALESPERSON',
              severity: 'warning',
              title: 'Sales without salesperson attribution',
              detail: `${unattributedSalespersonCount} sale${unattributedSalespersonCount === 1 ? '' : 's'} should be attributed before performance reporting.`,
            },
          ]
        : []),
    ];

    const readinessChecks: ReportReadinessCheck[] = [
      {
        key: 'sales-present',
        status: totals._count.id === 0 ? 'INFO' : 'READY',
        label: 'Sales activity',
        detail:
          totals._count.id === 0
            ? 'No confirmed sales were recorded for this close date.'
            : `${totals._count.id} confirmed sale${totals._count.id === 1 ? '' : 's'} included.`,
      },
      {
        key: 'cash-account-mapping',
        status: unassignedPaymentAccountCount > 0 ? 'CRITICAL' : 'READY',
        label: 'Cash account mapping',
        detail:
          unassignedPaymentAccountCount > 0
            ? `${unassignedPaymentAccountCount} payment group${unassignedPaymentAccountCount === 1 ? '' : 's'} missing cash/bank account mapping.`
            : 'Every non-credit payment method is mapped to a cash or bank account.',
      },
      {
        key: 'mobile-money-reference',
        status: missingMobileMoneyReferenceCount > 0 ? 'WARNING' : 'READY',
        label: 'Mobile-money references',
        detail:
          missingMobileMoneyReferenceCount > 0
            ? `${missingMobileMoneyReferenceCount} mobile-money sale${missingMobileMoneyReferenceCount === 1 ? '' : 's'} missing payment reference.`
            : 'All mobile-money sales include payment references.',
      },
      {
        key: 'salesperson-attribution',
        status: unattributedSalespersonCount > 0 ? 'WARNING' : 'READY',
        label: 'Salesperson attribution',
        detail:
          unattributedSalespersonCount > 0
            ? `${unattributedSalespersonCount} sale${unattributedSalespersonCount === 1 ? '' : 's'} missing salesperson attribution.`
            : 'All grouped sales have salesperson attribution.',
      },
      {
        key: 'credit-exposure',
        status: Number(totals._sum.outstandingAmount ?? 0) > 0 ? 'WARNING' : 'READY',
        label: 'Credit exposure',
        detail:
          Number(totals._sum.outstandingAmount ?? 0) > 0
            ? `TZS ${Number(totals._sum.outstandingAmount ?? 0).toLocaleString('en-TZ')} remains outstanding.`
            : 'No outstanding amount remains on confirmed sales.',
      },
    ];
    const closeReadiness = this.dailyCloseReadiness(readinessChecks);

    const savedClose = await this.prisma.westsidesDailyClose.findFirst({
      where: {
        companyId: query.companyId,
        branchId: query.branchId ?? null,
        closeDate: closeDateKey,
      },
    });

    return {
      date: dayStart.toISOString(),
      companyId: query.companyId,
      branchId: query.branchId ?? null,
      generatedAt: new Date().toISOString(),
      savedClose,
      scope: {
        companyId: query.companyId,
        branchId: query.branchId ?? null,
        date: closeDateKey.toISOString().slice(0, 10),
      },
      lineage: this.lineage(
        'Daily Close / Z-Report',
        [
          'sales_orders',
          'sales_order_lines',
          'products',
          'cash_accounts',
          'employees',
          'mobile_pos_terminals',
          'mobile_pos_day_reports',
        ],
        ['totalAmount', 'paidAmount', 'outstandingAmount', 'taxAmount', 'discountAmount'],
      ),
      exportOptions: ['PRINT', 'CSV', 'JSON'],
      actions: [
        {
          label: 'Open close screen',
          href: this.route('/westsides/daily-close', {
            companyId: query.companyId,
            branchId: query.branchId,
            date: dayStart.toISOString().slice(0, 10),
          }),
          kind: 'review',
        },
        {
          label: 'Review sales orders',
          href: this.route('/operations/sales-orders', {
            companyId: query.companyId,
            branchId: query.branchId,
            dateFrom: dayStart.toISOString().slice(0, 10),
            dateTo: dayStart.toISOString().slice(0, 10),
          }),
          kind: 'view',
        },
      ],
      totals: {
        salesCount: totals._count.id,
        totalSales: Number(totals._sum.totalAmount ?? 0),
        paidAmount: Number(totals._sum.paidAmount ?? 0),
        outstandingAmount: Number(totals._sum.outstandingAmount ?? 0),
        taxAmount: Number(totals._sum.taxAmount ?? 0),
        discountAmount: Number(totals._sum.discountAmount ?? 0),
        averageOrder:
          totals._count.id > 0 ? Number(totals._sum.totalAmount ?? 0) / totals._count.id : 0,
      },
      yesterday: {
        salesCount: yesterdayTotals._count.id,
        totalSales: Number(yesterdayTotals._sum.totalAmount ?? 0),
      },
      // Expected receipts per (paymentMethod, cashAccount) — operator
      // compares against actual count to compute variance.
      byMethod: methodRows,
      // Per-till attribution of the same day window (additive — existing
      // consumers keep their shape). Terminal rows carry the terminal's own
      // MobilePosDayReport beside the expected figures; the COUNTER row is
      // the non-terminal remainder, so the rows always sum to `totals`.
      byTerminal,
      bySalesType: bySalesType.map((s) => ({
        salesType: s.salesType,
        count: s._count.id,
        total: Number(s._sum.totalAmount ?? 0),
      })),
      bySalesperson: bySalesperson.map((s) => ({
        salespersonId: s.salespersonId,
        name: s.salespersonId
          ? (salespersonById.get(s.salespersonId)?.fullName ??
            salespersonById.get(s.salespersonId)?.employeeCode ??
            null)
          : null,
        count: s._count.id,
        total: Number(s._sum.totalAmount ?? 0),
      })),
      topProducts,
      orders: orders.map((o) => ({
        id: o.id,
        salesOrderNumber: o.salesOrderNumber,
        orderDate: o.orderDate,
        customerName: o.customer?.name ?? o.customerName ?? 'Walk-in',
        salesperson: o.salesperson?.fullName ?? o.salesperson?.employeeCode ?? null,
        totalAmount: Number(o.totalAmount),
        paymentMethod: o.paymentMethod,
        paymentReference: o.paymentReference,
        readinessStatus:
          o.paymentMethod === 'MOBILE_MONEY' && !o.paymentReference ? 'WARNING' : 'READY',
        ...this.reportMeta({
          readiness: this.readiness(
            o.paymentMethod === 'MOBILE_MONEY' && !o.paymentReference ? 'WARNING' : 'READY',
            o.paymentMethod === 'MOBILE_MONEY' && !o.paymentReference
              ? 'Mobile-money order needs a payment reference.'
              : 'Order is included in the close evidence set.',
          ),
          lineage: this.lineage(
            'Daily close sales-order evidence',
            ['sales_orders'],
            ['totalAmount', 'paymentMethod', 'paymentReference'],
          ),
          drillThrough: [
            {
              label: 'Open sales order',
              href: this.route('/operations/sales-orders', { search: o.salesOrderNumber }),
              entityType: 'salesOrder',
              entityId: o.id,
            },
          ],
        }),
      })),
      mobileMoneyReferences,
      readiness: {
        status: closeReadiness.status,
        closeReady: closeReadiness.closeReady,
        score: closeReadiness.score,
        target: closeReadiness.target,
        exceptionCount: exceptionList.length,
        criticalCount: closeReadiness.criticalCount,
        warningCount: closeReadiness.warningCount,
        infoCount: closeReadiness.infoCount,
        cashAccountsAssigned: unassignedPaymentAccountCount === 0,
        mobileMoneyReferencesComplete: missingMobileMoneyReferenceCount === 0,
        unassignedPaymentAccountCount,
        missingMobileMoneyReferenceCount,
        unattributedSalespersonCount,
        checks: closeReadiness.checks,
      },
      exceptions: exceptionList,
    };
  }

  async salesByChannel(query: QueryReportDto, user: AuthUser) {
    // SalesOrder doesn't carry salesChannelId today; group by salesType as the
    // closest equivalent (CASH_SALE, CREDIT_SALE, WHOLESALE, RETAIL, etc.).
    const rows = await this.prisma.salesOrder.groupBy({
      by: ['salesType'],
      where: await this.salesWhere(query, user),
      _sum: { totalAmount: true },
      _count: { id: true },
    });

    return rows.map((row) => ({
      salesType: row.salesType,
      channel: String(row.salesType).replace(/_/g, ' '),
      orderCount: row._count.id,
      totalAmount: this.toNumber(row._sum.totalAmount),
      readinessStatus: row._count.id > 0 ? 'READY' : 'INFO',
      ...this.reportMeta({
        readiness: this.readiness(
          row._count.id > 0 ? 'READY' : 'INFO',
          row._count.id > 0
            ? 'Channel has confirmed sales in the selected scope.'
            : 'No confirmed sales were found for this channel in the selected scope.',
          [],
          row._count.id > 0 ? 95 : 80,
        ),
        lineage: this.lineage('Sales by channel', ['sales_orders'], ['totalAmount', 'salesType']),
        drillThrough: [
          {
            label: 'Open sales orders',
            href: this.route('/operations/sales-orders', {
              companyId: query.companyId,
              branchId: query.branchId,
              salesType: row.salesType,
              dateFrom: query.dateFrom,
              dateTo: query.dateTo,
            }),
            entityType: 'salesOrder',
          },
        ],
      }),
    }));
  }

  async salesByProduct(query: QueryReportDto, user: AuthUser) {
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.salesWhere(query, user),
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];

    const rows = await this.prisma.salesOrderLine.groupBy({
      by: ['productId'],
      where: { salesOrderId: { in: orderIds } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
    });
    const products = await this.productMap(rows.map((row) => row.productId));

    return rows.map((row) => {
      const product = products.get(row.productId);
      const quantity = this.toNumber(row._sum.quantity);
      const totalAmount = this.toNumber(row._sum.lineTotal);
      return {
        productId: row.productId,
        productCode: product?.productCode ?? null,
        sku: product?.sku ?? null,
        productName: product?.name ?? 'Unknown product',
        quantity,
        totalAmount,
        averageSellingPrice: quantity > 0 ? totalAmount / quantity : 0,
        readinessStatus: product ? 'READY' : 'WARNING',
        ...this.reportMeta({
          readiness: this.readiness(
            product ? 'READY' : 'WARNING',
            product
              ? 'Product sales can be traced back to master data and source orders.'
              : 'Sales reference a product that could not be resolved in product master data.',
          ),
          lineage: this.lineage(
            'Sales by product',
            ['sales_orders', 'sales_order_lines', 'products'],
            ['quantity', 'lineTotal'],
          ),
          drillThrough: [
            {
              label: 'Open product',
              href: this.route('/inventory?tab=catalog&view=products', {
                search: product?.productCode ?? product?.sku ?? product?.name ?? row.productId,
              }),
              entityType: 'product',
              entityId: row.productId,
            },
            {
              label: 'Review live stock',
              href: this.route('/inventory?tab=stock&view=live', {
                companyId: query.companyId,
                branchId: query.branchId,
                productId: row.productId,
              }),
              entityType: 'inventoryBalance',
            },
          ],
        }),
      };
    });
  }

  async salesByCashier(query: QueryReportDto, user: AuthUser) {
    // Renamed in spirit: "by salesperson" since POS cashiers no longer exist.
    const rows = await this.prisma.salesOrder.groupBy({
      by: ['salespersonId'],
      where: await this.salesWhere(query, user),
      _sum: { totalAmount: true },
      _count: { id: true },
    });
    const employees = await this.employeeMap(rows.map((row) => row.salespersonId));

    return rows.map((row) => {
      const employee = row.salespersonId ? employees.get(row.salespersonId) : null;
      return {
        salespersonId: row.salespersonId,
        salesperson: employee?.fullName ?? employee?.employeeCode ?? 'Unassigned',
        orderCount: row._count.id,
        totalAmount: this.toNumber(row._sum.totalAmount),
        readinessStatus: row.salespersonId ? 'READY' : 'WARNING',
        ...this.reportMeta({
          readiness: this.readiness(
            row.salespersonId ? 'READY' : 'WARNING',
            row.salespersonId
              ? 'Salesperson attribution is available for commission and performance review.'
              : 'Orders in this group are missing salesperson attribution.',
          ),
          lineage: this.lineage(
            'Sales by salesperson',
            ['sales_orders', 'employees'],
            ['totalAmount', 'salespersonId'],
          ),
          drillThrough: [
            {
              label: 'Open sales orders',
              href: this.route('/operations/sales-orders', {
                companyId: query.companyId,
                branchId: query.branchId,
                salespersonId: row.salespersonId,
                dateFrom: query.dateFrom,
                dateTo: query.dateTo,
              }),
              entityType: 'salesOrder',
            },
          ],
        }),
      };
    });
  }

  async batchStatus(query: QueryReportDto, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const rows = await this.prisma.productBatch.findMany({
      where: { ...companyWhere, deletedAt: null },
      select: {
        id: true,
        batchNumber: true,
        status: true,
        expiryDate: true,
        receivedDate: true,
        remainingQuantity: true,
        initialQuantity: true,
        unitCost: true,
        product: { select: { id: true, productCode: true, name: true, sku: true } },
        unit: { select: { symbol: true, name: true } },
        branch: { select: { code: true, name: true } },
        supplier: { select: { supplierCode: true, name: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    return rows.map((row) => {
      const initialQuantity = this.toNumber(row.initialQuantity);
      const remainingQuantity = this.toNumber(row.remainingQuantity);
      const daysToExpiry = this.daysUntil(row.expiryDate);
      const depletionPercent =
        initialQuantity > 0 ? ((initialQuantity - remainingQuantity) / initialQuantity) * 100 : 0;
      const readinessStatus: ReportReadinessStatus =
        daysToExpiry !== null && daysToExpiry < 0
          ? 'CRITICAL'
          : daysToExpiry !== null && daysToExpiry <= 14
            ? 'WARNING'
            : remainingQuantity <= 0
              ? 'INFO'
              : 'READY';
      return {
        batchNumber: row.batchNumber,
        productCode: row.product.productCode,
        sku: row.product.sku,
        productName: row.product.name,
        branch: row.branch ? `${row.branch.code} - ${row.branch.name}` : 'All branches',
        supplier: row.supplier ? `${row.supplier.supplierCode} - ${row.supplier.name}` : null,
        status: row.status,
        receivedDate: row.receivedDate,
        expiryDate: row.expiryDate,
        daysToExpiry,
        initialQuantity,
        remainingQuantity,
        depletionPercent,
        unit: row.unit.symbol ?? row.unit.name,
        unitCost: this.toNumber(row.unitCost),
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            readinessStatus === 'CRITICAL'
              ? 'Batch is expired and should be reviewed before sale.'
              : readinessStatus === 'WARNING'
                ? 'Batch is close to expiry and should be prioritized or quarantined.'
                : readinessStatus === 'INFO'
                  ? 'Batch has no remaining quantity.'
                  : 'Batch is active and usable.',
          ),
          lineage: this.lineage(
            'Batch status',
            ['product_batches', 'products', 'branches', 'suppliers'],
            ['initialQuantity', 'remainingQuantity', 'unitCost', 'expiryDate'],
          ),
          drillThrough: [
            {
              label: 'Open product batches',
              href: this.route('/inventory?tab=stock&view=batches', {
                companyId: query.companyId,
                branchId: query.branchId,
                search: row.batchNumber,
              }),
              entityType: 'productBatch',
              entityId: row.id,
            },
          ],
        }),
      };
    });
  }

  async stockDamageReport(query: QueryReportDto, user: AuthUser) {
    const { companyId, branchId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const where: any = { ...companyWhere, deletedAt: null };
    if (branchId) where.branchId = branchId;

    const rows = await this.prisma.stockDamage.groupBy({
      by: ['damageType', 'status'],
      where,
      _sum: { quantity: true, estimatedValue: true },
      _count: { id: true },
    });

    return rows.map((row) => {
      const estimatedValue = this.toNumber(row._sum.estimatedValue);
      const readinessStatus: ReportReadinessStatus =
        row.status === 'DRAFT' || row.status === 'SUBMITTED' ? 'WARNING' : 'READY';
      return {
        damageType: row.damageType,
        status: row.status,
        reportCount: row._count.id,
        quantity: this.toNumber(row._sum.quantity),
        estimatedValue,
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            readinessStatus === 'WARNING'
              ? 'Damage entries still need review or approval.'
              : 'Damage entries are in a controlled status.',
          ),
          lineage: this.lineage(
            'Stock damage report',
            ['stock_damages'],
            ['quantity', 'estimatedValue', 'damageType', 'status'],
          ),
          drillThrough: [
            {
              label: 'Review stock damage',
              href: this.route('/inventory?tab=controls&view=damage', {
                companyId: query.companyId,
                branchId: query.branchId,
                status: row.status,
                damageType: row.damageType,
              }),
              entityType: 'stockDamage',
            },
          ],
        }),
      };
    });
  }

  async packageBalanceReport(query: QueryReportDto, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const rows = await this.prisma.customerPackageBalance.findMany({
      where: companyWhere,
      include: {
        customer: { select: { id: true, name: true, customerCode: true } },
        returnablePackage: { select: { packageCode: true, name: true, packageType: true } },
      },
    });

    return rows.map((row) => {
      const owedByCustomer = this.toNumber(row.quantityOwedByCustomer);
      const owedToCustomer = this.toNumber(row.quantityOwedToCustomer);
      const depositBalance = this.toNumber(row.depositBalance);
      const exposure = Math.abs(depositBalance) + owedByCustomer + owedToCustomer;
      const readinessStatus = this.statusFromAmount(exposure, 10);
      return {
        customerCode: row.customer.customerCode,
        customerName: row.customer.name,
        packageCode: row.returnablePackage?.packageCode ?? null,
        packageName: row.returnablePackage?.name ?? 'Unassigned package',
        packageType: row.returnablePackage?.packageType ?? null,
        quantityOwedByCustomer: owedByCustomer,
        quantityOwedToCustomer: owedToCustomer,
        depositBalance,
        netPackageExposure: exposure,
        updatedAt: row.updatedAt,
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            exposure > 0
              ? 'Customer package balance needs follow-up or reconciliation.'
              : 'No package exposure is outstanding for this customer/package.',
          ),
          lineage: this.lineage(
            'Customer package balance',
            ['customer_package_balances', 'customers', 'returnable_packages'],
            ['quantityOwedByCustomer', 'quantityOwedToCustomer', 'depositBalance'],
          ),
          drillThrough: [
            {
              label: 'Open customer',
              href: `/westsides/customers/${row.customer.id}`,
              entityType: 'customer',
              entityId: row.customer.id,
            },
            {
              label: 'Review package movements',
              href: this.route('/westsides/package-movements', {
                companyId: query.companyId,
                customerId: row.customer.id,
              }),
              entityType: 'packageMovement',
            },
          ],
        }),
      };
    });
  }

  async quotationConversion(query: QueryReportDto, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const byStatus = await this.prisma.quotation.groupBy({
      by: ['status'],
      where: { ...companyWhere, deletedAt: null },
      _count: { id: true },
    });
    const total = byStatus.reduce((sum, s) => sum + s._count.id, 0);
    const converted = byStatus.find((s) => s.status === 'CONVERTED')?._count.id ?? 0;
    const conversionRate = total > 0 ? (converted / total) * 100 : 0;
    return byStatus.map((row) => {
      const readinessStatus: ReportReadinessStatus =
        row.status === 'EXPIRED' || row.status === 'REJECTED' ? 'WARNING' : 'READY';
      return {
        status: row.status,
        quotationCount: row._count.id,
        totalQuotations: total,
        convertedQuotations: converted,
        conversionRate,
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            readinessStatus === 'WARNING'
              ? 'Quotation status indicates sales leakage or follow-up risk.'
              : 'Quotation status is active or successfully controlled.',
          ),
          lineage: this.lineage(
            'Quotation conversion',
            ['quotations'],
            ['status', 'convertedSalesOrderId'],
          ),
          drillThrough: [
            {
              label: 'Open quotations',
              href: this.route('/westsides/quotations', {
                companyId: query.companyId,
                status: row.status,
              }),
              entityType: 'quotation',
            },
          ],
        }),
      };
    });
  }

  async deliveryPerformance(query: QueryReportDto, user: AuthUser) {
    const { companyId, branchId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    // Delivery PERFORMANCE is about goods dispatched to a customer. A POS
    // counter sale is a collection, not a dispatch, so its auto-issued note is
    // excluded — and it must be, because this report flags DRAFT / DISPATCHED /
    // PARTIALLY_DELIVERED as WARNING "need operational follow-up", which is
    // exactly what a counter note stranded mid-chain would become.
    const where: any = { ...companyWhere, counterSaleOrderId: null, deletedAt: null };
    if (branchId) where.branchId = branchId;

    const rows = await this.prisma.deliveryNote.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    });

    return rows.map((row) => {
      const readinessStatus: ReportReadinessStatus =
        row.status === 'DRAFT' ||
        row.status === 'DISPATCHED' ||
        row.status === 'PARTIALLY_DELIVERED'
          ? 'WARNING'
          : 'READY';
      return {
        status: row.status,
        deliveryCount: row._count.id,
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            readinessStatus === 'WARNING'
              ? 'Deliveries in this status need operational follow-up.'
              : 'Delivery status is finalized or closed.',
          ),
          lineage: this.lineage(
            'Delivery performance',
            ['delivery_notes'],
            ['status', 'deliveryDate'],
          ),
          drillThrough: [
            {
              label: 'Open delivery notes',
              href: this.route('/westsides/delivery-notes', {
                companyId: query.companyId,
                branchId: query.branchId,
                status: row.status,
              }),
              entityType: 'deliveryNote',
            },
          ],
        }),
      };
    });
  }

  /**
   * Undelivered confirmed CREDIT orders as of a cutoff date — the revenue
   * cutoff exposure report. Revenue, COGS and stock issue all post at
   * SalesOrder.confirm(); the delivery note is documentary. This report puts
   * a TZS value on the confirm-to-deliver gap: confirmed (not cancelled or
   * voided) CREDIT orders whose non-cancelled delivery notes dated on or
   * before the cutoff do not fully cover the ordered quantities.
   *
   * Coverage is HEURISTIC BY DESIGN: `delivery_note_lines` has no
   * `salesOrderLineId` column (the DTO field is accepted and dropped — see
   * DeliveryNotesService.create), so delivered quantity is matched to ordered
   * quantity PER PRODUCT within each order. Coverage of one product is capped
   * at its ordered quantity, so over-delivery of product A can never mask a
   * shortfall of product B.
   *
   * Only DELIVERED / PARTIALLY_DELIVERED notes count as coverage; DRAFT /
   * DISPATCHED notes surface as in-transit context. POS counter sales
   * auto-issue a DELIVERED note for the full quantity ("a counter sale is
   * delivered in full by definition"), so credit counter sales are fully
   * covered and drop out naturally.
   *
   * Query params follow the module's report idiom: `dateTo` is the as-of
   * cutoff (whole calendar day, inclusive; defaults to today) and `dateFrom`
   * optionally bounds how far back orders are scanned.
   */
  async undeliveredConfirmedOrders(query: QueryReportDto, user: AuthUser) {
    const companyWhere = await this.companyWhere({ companyId: query.companyId }, user);
    const asOfBase = query.dateTo ? new Date(query.dateTo) : new Date();
    // Same local-day truncation trade-off as dailyClose above: UTC boundary,
    // "close enough" for Tanzania (UTC+3). The cutoff is EXCLUSIVE of the day
    // after the as-of date, so the whole as-of day is included.
    const cutoffEnd = new Date(asOfBase.getFullYear(), asOfBase.getMonth(), asOfBase.getDate() + 1);
    const asOfKey = localCalendarDateKey(asOfBase).toISOString().slice(0, 10);

    const where: any = {
      ...companyWhere,
      status: { in: CONFIRMED_SALES_STATUSES as unknown as any },
      deletedAt: null,
      paymentMethod: SalesPaymentMethod.CREDIT,
      orderDate: {
        lt: cutoffEnd,
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
      },
    };
    if (query.branchId) where.branchId = query.branchId;

    const candidates = await this.prisma.salesOrder.findMany({
      where,
      orderBy: { orderDate: 'asc' },
      // +1 so a full page is distinguishable from a truncated scan.
      take: UNDELIVERED_ORDERS_SCAN_CAP + 1,
      select: {
        id: true,
        salesOrderNumber: true,
        orderDate: true,
        branchId: true,
        status: true,
        paymentStatus: true,
        customerId: true,
        customerName: true,
        customer: { select: { name: true, customerCode: true } },
        totalAmount: true,
        taxAmount: true,
        outstandingAmount: true,
        lines: {
          select: {
            productId: true,
            quantity: true,
            lineTotal: true,
            taxAmount: true,
            cogsAmount: true,
            // Needed for the missing-cost disclosure below: only STOCK lines
            // with a NULL cogsAmount are a data defect worth flagging.
            product: { select: { trackInventory: true, productType: true } },
          },
        },
        deliveryNotes: {
          where: {
            deletedAt: null,
            status: { not: DeliveryNoteStatus.CANCELLED },
            deliveryDate: { lt: cutoffEnd },
          },
          select: {
            id: true,
            deliveryNoteNumber: true,
            status: true,
            deliveryDate: true,
            lines: { select: { productId: true, deliveredQuantity: true } },
          },
        },
      },
    });
    const scanTruncated = candidates.length > UNDELIVERED_ORDERS_SCAN_CAP;
    const scanned = scanTruncated ? candidates.slice(0, UNDELIVERED_ORDERS_SCAN_CAP) : candidates;

    const flagged = scanned.flatMap((order) => {
      // Per-product ordered/net/COGS from the order lines. COGS is the
      // snapshot the profit guard wrote at confirm (SalesOrderLine.cogsAmount)
      // — never a recomputation. A STOCK line whose snapshot is NULL (legacy
      // orders confirmed before COGS snapshotting) is tracked as
      // `cogsMissing` — the profit.service standard — instead of silently
      // contributing zero cost and overstating gross-profit exposure.
      const perProduct = new Map<
        string,
        {
          ordered: number;
          net: number;
          cogs: number;
          cogsMissing: boolean;
          delivered: number;
          inTransit: number;
        }
      >();
      for (const line of order.lines) {
        const entry = perProduct.get(line.productId) ?? {
          ordered: 0,
          net: 0,
          cogs: 0,
          cogsMissing: false,
          delivered: 0,
          inTransit: 0,
        };
        entry.ordered += this.toNumber(line.quantity);
        entry.net += this.toNumber(line.lineTotal) - this.toNumber(line.taxAmount);
        entry.cogs += this.toNumber(line.cogsAmount);
        if (line.cogsAmount == null && isStockProductShape(line.product)) {
          entry.cogsMissing = true;
        }
        perProduct.set(line.productId, entry);
      }
      for (const note of order.deliveryNotes) {
        const covering = DELIVERY_COVERING_STATUSES.has(String(note.status));
        for (const noteLine of note.lines) {
          // A note line for a product not on the order cannot be attributed —
          // the line-level link does not exist, so the heuristic ignores it.
          const entry = perProduct.get(noteLine.productId);
          if (!entry) continue;
          if (covering) entry.delivered += this.toNumber(noteLine.deliveredQuantity);
          else entry.inTransit += this.toNumber(noteLine.deliveredQuantity);
        }
      }

      let orderedQuantity = 0;
      let deliveredQuantity = 0;
      let undeliveredQuantity = 0;
      let inTransitQuantity = 0;
      let netRevenueExposure = 0;
      let cogsExposure = 0;
      let cogsAmount = 0;
      let cogsMissing = false;
      for (const entry of perProduct.values()) {
        const covered = Math.min(entry.delivered, entry.ordered);
        const undelivered = Math.max(0, entry.ordered - covered);
        orderedQuantity += entry.ordered;
        deliveredQuantity += covered;
        undeliveredQuantity += undelivered;
        // "Of the undelivered quantity, how much is already on a truck."
        inTransitQuantity += Math.min(entry.inTransit, undelivered);
        cogsAmount += entry.cogs;
        if (entry.ordered > 0 && undelivered > 0) {
          const fraction = undelivered / entry.ordered;
          netRevenueExposure += fraction * entry.net;
          cogsExposure += fraction * entry.cogs;
          // The undelivered slice of a missing-cost stock line is exposure
          // with an understated COGS — the row must say so.
          if (entry.cogsMissing) cogsMissing = true;
        }
      }
      if (orderedQuantity <= 0 || undeliveredQuantity <= 0) return []; // fully covered

      const coverageRatio = deliveredQuantity / orderedQuantity;
      const deliveryState =
        order.deliveryNotes.length === 0
          ? ('NO_DELIVERY_NOTE' as const)
          : deliveredQuantity > 0
            ? ('PARTIALLY_DELIVERED' as const)
            : ('NOT_DELIVERED' as const);
      const daysSinceOrder = Math.max(
        0,
        Math.floor((cutoffEnd.getTime() - order.orderDate.getTime()) / (24 * 3600 * 1000)),
      );
      const netRevenue = this.toNumber(order.totalAmount) - this.toNumber(order.taxAmount);
      const readinessStatus: ReportReadinessStatus =
        deliveryState === 'NO_DELIVERY_NOTE' && daysSinceOrder > UNDELIVERED_STALE_DAYS
          ? 'CRITICAL'
          : 'WARNING';

      return [
        {
          salesOrderId: order.id,
          salesOrderNumber: order.salesOrderNumber,
          orderDate: order.orderDate.toISOString(),
          branchId: order.branchId,
          status: order.status,
          paymentStatus: order.paymentStatus,
          customerName: order.customer?.name ?? order.customerName ?? 'Walk-in',
          customerCode: order.customer?.customerCode ?? null,
          outstandingAmount: this.toNumber(order.outstandingAmount),
          orderedQuantity,
          deliveredQuantity,
          undeliveredQuantity,
          inTransitQuantity,
          coverageRatio,
          deliveryState,
          daysSinceOrder,
          // Full-order figures (as posted at confirm)…
          netRevenue,
          cogsAmount,
          grossProfit: netRevenue - cogsAmount,
          // …and the undelivered slice of them (the actual cutoff exposure).
          netRevenueExposure,
          cogsExposure,
          grossProfitExposure: netRevenueExposure - cogsExposure,
          // True when an undelivered STOCK product carries a line with no
          // snapshotted cost: cogsExposure is understated and
          // grossProfitExposure overstated for this order.
          cogsMissing,
          deliveryNotes: order.deliveryNotes.map((note) => ({
            id: note.id,
            deliveryNoteNumber: note.deliveryNoteNumber,
            status: note.status,
            deliveryDate: note.deliveryDate.toISOString(),
          })),
          readinessStatus,
          ...this.reportMeta({
            readiness: this.readiness(
              readinessStatus,
              (deliveryState === 'NO_DELIVERY_NOTE'
                ? `Confirmed ${daysSinceOrder} day${daysSinceOrder === 1 ? '' : 's'} ago with no delivery note — revenue and COGS are posted for goods with no delivery evidence.`
                : deliveryState === 'NOT_DELIVERED'
                  ? 'Delivery notes exist but none is delivered yet; posted revenue is not covered by delivery evidence.'
                  : 'Partially delivered; the undelivered remainder is posted revenue without delivery evidence.') +
                (cogsMissing
                  ? ' A stock line has no snapshotted cost (COGS): the COGS exposure is understated and the gross-profit exposure overstated.'
                  : ''),
            ),
            lineage: this.lineage(
              'Undelivered confirmed credit orders',
              ['sales_orders', 'sales_order_lines', 'delivery_notes', 'delivery_note_lines'],
              ['quantity', 'deliveredQuantity', 'lineTotal', 'taxAmount', 'cogsAmount'],
            ),
            drillThrough: [
              {
                label: 'Open sales order',
                href: this.route('/operations/sales-orders', { search: order.salesOrderNumber }),
                entityType: 'salesOrder',
                entityId: order.id,
              },
              {
                label: 'Open delivery notes',
                href: this.route('/westsides/delivery-notes', {
                  companyId: query.companyId,
                  branchId: query.branchId,
                  search: order.salesOrderNumber,
                }),
                entityType: 'deliveryNote',
              },
            ],
          }),
        },
      ];
    });

    // Largest exposure first; totals cover every flagged order in the scan,
    // not just the rows returned.
    flagged.sort((a, b) => b.netRevenueExposure - a.netRevenueExposure);
    const rows = flagged.slice(0, UNDELIVERED_ORDERS_ROW_CAP);

    return {
      scope: {
        companyId: query.companyId,
        branchId: query.branchId ?? null,
        asOf: asOfKey,
        dateFrom: query.dateFrom ?? null,
      },
      generatedAt: new Date().toISOString(),
      lineage: this.lineage(
        'Undelivered confirmed credit orders (revenue cutoff exposure)',
        ['sales_orders', 'sales_order_lines', 'delivery_notes', 'delivery_note_lines'],
        ['quantity', 'deliveredQuantity', 'lineTotal', 'taxAmount', 'cogsAmount'],
      ),
      // Disclosed because delivery_note_lines carry no salesOrderLineId: the
      // per-product matching above is the strongest coverage the data allows.
      coverageBasis: 'PER_PRODUCT_HEURISTIC',
      totals: {
        orderCount: flagged.length,
        orderedQuantity: flagged.reduce((sum, r) => sum + r.orderedQuantity, 0),
        deliveredQuantity: flagged.reduce((sum, r) => sum + r.deliveredQuantity, 0),
        undeliveredQuantity: flagged.reduce((sum, r) => sum + r.undeliveredQuantity, 0),
        netRevenueExposure: flagged.reduce((sum, r) => sum + r.netRevenueExposure, 0),
        cogsExposure: flagged.reduce((sum, r) => sum + r.cogsExposure, 0),
        grossProfitExposure: flagged.reduce((sum, r) => sum + r.grossProfitExposure, 0),
        // Flagged orders whose undelivered stock lines carry no snapshotted
        // cost — for those, cogsExposure is understated (profit.service's
        // missing-cost standard, disclosed instead of silently zeroed).
        ordersMissingCost: flagged.filter((r) => r.cogsMissing).length,
      },
      rows,
      rowCap: UNDELIVERED_ORDERS_ROW_CAP,
      truncated: flagged.length > rows.length,
      scanCap: UNDELIVERED_ORDERS_SCAN_CAP,
      scanTruncated,
    };
  }

  async priceListReport(query: QueryReportDto, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const priceLists = await this.prisma.priceList.findMany({
      where: { ...companyWhere, deletedAt: null },
      select: {
        id: true,
        name: true,
        priceListType: true,
        currency: true,
        effectiveFrom: true,
        effectiveTo: true,
        status: true,
        approvedAt: true,
        _count: { select: { items: true } },
      },
    });
    return priceLists.map((priceList) => {
      const expired =
        priceList.effectiveTo !== null && priceList.effectiveTo.getTime() < Date.now();
      const readinessStatus: ReportReadinessStatus =
        priceList.status !== 'ACTIVE' || expired || priceList._count.items === 0
          ? 'WARNING'
          : 'READY';
      return {
        name: priceList.name,
        priceListType: priceList.priceListType,
        currency: priceList.currency,
        effectiveFrom: priceList.effectiveFrom,
        effectiveTo: priceList.effectiveTo,
        status: priceList.status,
        itemCount: priceList._count.items,
        approvedAt: priceList.approvedAt,
        isExpired: expired,
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            expired
              ? 'Price list is past its effective end date.'
              : priceList._count.items === 0
                ? 'Price list has no items and cannot drive pricing.'
                : priceList.status !== 'ACTIVE'
                  ? 'Price list is not active.'
                  : 'Price list is active, effective, and populated.',
          ),
          lineage: this.lineage(
            'Price list report',
            ['price_lists', 'price_list_items'],
            ['status', 'effectiveFrom', 'effectiveTo', 'itemCount'],
          ),
          drillThrough: [
            {
              label: 'Open price lists',
              href: this.route('/westsides/price-lists', {
                companyId: query.companyId,
                search: priceList.name,
              }),
              entityType: 'priceList',
              entityId: priceList.id,
            },
          ],
        }),
      };
    });
  }

  async fastMovingItems(query: QueryReportDto, user: AuthUser) {
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.salesWhere(query, user),
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];

    const rows = await this.prisma.salesOrderLine.groupBy({
      by: ['productId'],
      where: { salesOrderId: { in: orderIds } },
      _sum: { quantity: true, lineTotal: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 20,
    });
    const products = await this.productMap(rows.map((row) => row.productId));

    return rows.map((row, index) => {
      const product = products.get(row.productId);
      const quantity = this.toNumber(row._sum.quantity);
      const totalAmount = this.toNumber(row._sum.lineTotal);
      return {
        rank: index + 1,
        productCode: product?.productCode ?? null,
        sku: product?.sku ?? null,
        productName: product?.name ?? 'Unknown product',
        quantity,
        totalAmount,
        velocitySignal: index < 5 ? 'TOP_SELLER' : 'FAST_MOVING',
        readinessStatus: product ? 'READY' : 'WARNING',
        ...this.reportMeta({
          readiness: this.readiness(
            product ? 'READY' : 'WARNING',
            product
              ? 'Fast-moving product can be replenished against live stock and sales history.'
              : 'Fast-moving row is missing product master metadata.',
          ),
          lineage: this.lineage(
            'Fast-moving items',
            ['sales_orders', 'sales_order_lines', 'products'],
            ['quantity', 'lineTotal'],
          ),
          drillThrough: [
            {
              label: 'Review live stock',
              href: this.route('/inventory?tab=stock&view=live', {
                companyId: query.companyId,
                branchId: query.branchId,
                productId: row.productId,
              }),
              entityType: 'inventoryBalance',
            },
          ],
        }),
      };
    });
  }

  async slowMovingItems(query: QueryReportDto, user: AuthUser) {
    const { companyId, branchId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000);

    const recentOrders = await this.prisma.salesOrder.findMany({
      where: {
        ...companyWhere,
        status: { in: CONFIRMED_SALES_STATUSES as unknown as any },
        orderDate: { gte: cutoff },
        deletedAt: null,
      },
      select: { id: true },
    });
    const orderIds = recentOrders.map((o) => o.id);

    const soldProductIds = (
      await this.prisma.salesOrderLine.findMany({
        where: { salesOrderId: { in: orderIds } },
        distinct: ['productId'],
        select: { productId: true },
      })
    ).map((l) => l.productId);

    const where: any = {
      ...companyWhere,
      productId: { notIn: soldProductIds },
      quantityOnHand: { gt: 0 },
    };
    if (branchId) where.branchId = branchId;

    const rows = await this.prisma.inventoryBalance.findMany({
      where,
      include: {
        product: { select: { id: true, productCode: true, name: true, sku: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { quantityOnHand: 'desc' },
    });

    return rows.map((row) => {
      const quantityOnHand = this.toNumber(row.quantityOnHand);
      const totalValue = this.toNumber(row.totalValue);
      const daysSinceMovement = row.lastMovementAt
        ? Math.floor((Date.now() - row.lastMovementAt.getTime()) / (24 * 3600 * 1000))
        : null;
      const readinessStatus: ReportReadinessStatus = totalValue > 0 ? 'WARNING' : 'INFO';
      return {
        productCode: row.product.productCode,
        sku: row.product.sku,
        productName: row.product.name,
        branch: row.branch ? `${row.branch.code} - ${row.branch.name}` : 'All branches',
        quantityOnHand,
        quantityReserved: this.toNumber(row.quantityReserved),
        totalValue,
        daysSinceMovement,
        lastMovementAt: row.lastMovementAt,
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            totalValue > 0
              ? 'Stock has value but no sales movement in the last 30 days.'
              : 'Slow-moving stock has no current value exposure.',
          ),
          lineage: this.lineage(
            'Slow-moving items',
            ['inventory_balances', 'sales_orders', 'sales_order_lines', 'products'],
            ['quantityOnHand', 'quantityReserved', 'totalValue', 'lastMovementAt'],
          ),
          drillThrough: [
            {
              label: 'Review live stock',
              href: this.route('/inventory?tab=stock&view=live', {
                companyId: query.companyId,
                branchId: query.branchId,
                productId: row.productId,
              }),
              entityType: 'inventoryBalance',
              entityId: row.id,
            },
          ],
        }),
      };
    });
  }

  async productProfitability(query: QueryReportDto, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.salesWhere(query, user),
      select: { id: true },
    });
    const orderIds = orders.map((o) => o.id);
    if (orderIds.length === 0) return [];

    const revenue = await this.prisma.salesOrderLine.groupBy({
      by: ['productId'],
      where: { salesOrderId: { in: orderIds } },
      _sum: { quantity: true, lineTotal: true },
    });

    const costByProduct = await this.prisma.productBatch.groupBy({
      by: ['productId'],
      where: companyWhere,
      _avg: { unitCost: true },
    });

    const costMap = new Map(costByProduct.map((c) => [c.productId, c._avg.unitCost ?? 0]));
    const products = await this.productMap(revenue.map((row) => row.productId));

    return revenue.map((r) => {
      const totalRevenue = Number(r._sum.lineTotal ?? 0);
      const avgCost = Number(costMap.get(r.productId) ?? 0);
      const totalCost = avgCost * Number(r._sum.quantity ?? 0);
      const product = products.get(r.productId);
      const grossProfit = totalRevenue - totalCost;
      const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;
      const readinessStatus: ReportReadinessStatus =
        grossMargin < 0 ? 'CRITICAL' : grossMargin < 15 ? 'WARNING' : 'READY';
      return {
        productId: r.productId,
        productCode: product?.productCode ?? null,
        sku: product?.sku ?? null,
        productName: product?.name ?? 'Unknown product',
        quantity: this.toNumber(r._sum.quantity),
        averageUnitCost: avgCost,
        totalRevenue,
        totalCost,
        grossProfit,
        grossMargin,
        readinessStatus,
        ...this.reportMeta({
          readiness: this.readiness(
            readinessStatus,
            readinessStatus === 'CRITICAL'
              ? 'Product is selling below estimated cost.'
              : readinessStatus === 'WARNING'
                ? 'Product margin is below the operating review threshold.'
                : 'Product margin is healthy against estimated batch cost.',
          ),
          lineage: this.lineage(
            'Product profitability',
            ['sales_orders', 'sales_order_lines', 'product_batches', 'products'],
            ['lineTotal', 'quantity', 'unitCost'],
          ),
          drillThrough: [
            {
              label: 'Review product sales',
              href: this.route('/operations/sales-orders', {
                companyId: query.companyId,
                branchId: query.branchId,
                productId: r.productId,
                dateFrom: query.dateFrom,
                dateTo: query.dateTo,
              }),
              entityType: 'salesOrder',
            },
            {
              label: 'Review pricing',
              href: this.route('/westsides/price-lists', {
                companyId: query.companyId,
                search: product?.productCode ?? product?.name ?? r.productId,
              }),
              entityType: 'priceList',
            },
          ],
        }),
      };
    });
  }

  async creditCustomersReport(query: QueryReportDto, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const rows = await this.prisma.receivable.groupBy({
      by: ['customerId'],
      where: { ...companyWhere, status: { in: ['OPEN', 'OVERDUE'] as any } },
      _sum: { amount: true, outstandingAmount: true },
      _count: { id: true },
      orderBy: { _sum: { outstandingAmount: 'desc' } },
    });
    const customers = await this.customerMap(rows.map((row) => row.customerId));

    return rows.map((row) => {
      const customer = row.customerId ? customers.get(row.customerId) : null;
      return {
        customerId: row.customerId,
        customerCode: customer?.customerCode ?? null,
        customerName: customer?.name ?? 'Walk-in or unassigned',
        invoiceCount: row._count.id,
        invoicedAmount: this.toNumber(row._sum.amount),
        outstandingAmount: this.toNumber(row._sum.outstandingAmount),
        readinessStatus: this.toNumber(row._sum.outstandingAmount) > 0 ? 'WARNING' : 'READY',
        ...this.reportMeta({
          readiness: this.readiness(
            this.toNumber(row._sum.outstandingAmount) > 0 ? 'WARNING' : 'READY',
            this.toNumber(row._sum.outstandingAmount) > 0
              ? 'Customer has open receivable exposure requiring collection follow-up.'
              : 'Customer receivable exposure is settled.',
          ),
          lineage: this.lineage(
            'Credit customers',
            ['receivables', 'customers'],
            ['amount', 'outstandingAmount', 'status'],
          ),
          drillThrough: [
            ...(row.customerId
              ? [
                  {
                    label: 'Open customer',
                    href: `/westsides/customers/${row.customerId}`,
                    entityType: 'customer',
                    entityId: row.customerId,
                  },
                ]
              : []),
            {
              label: 'Review receivables',
              href: this.route('/finance/receivables', {
                companyId: query.companyId,
                customerId: row.customerId,
              }),
              entityType: 'receivable',
            },
          ],
        }),
      };
    });
  }

  async dailySalesSummary(query: QueryReportDto, user: AuthUser) {
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.salesWhere(query, user),
      select: { orderDate: true, totalAmount: true },
      orderBy: { orderDate: 'asc' },
    });

    const daily = new Map<string, { date: string; total: number; count: number }>();
    for (const o of orders) {
      const key = o.orderDate.toISOString().split('T')[0];
      const entry = daily.get(key) ?? { date: key, total: 0, count: 0 };
      entry.total += Number(o.totalAmount);
      entry.count += 1;
      daily.set(key, entry);
    }
    return Array.from(daily.values()).map((row) => ({
      ...row,
      averageOrderValue: row.count > 0 ? row.total / row.count : 0,
      readinessStatus: row.count > 0 ? 'READY' : 'INFO',
      ...this.reportMeta({
        readiness: this.readiness(
          row.count > 0 ? 'READY' : 'INFO',
          row.count > 0
            ? 'Daily sales are traceable to confirmed sales orders.'
            : 'No confirmed sales orders exist for this day.',
        ),
        lineage: this.lineage(
          'Daily sales summary',
          ['sales_orders'],
          ['totalAmount', 'orderDate'],
        ),
        drillThrough: [
          {
            label: 'Open day orders',
            href: this.route('/operations/sales-orders', {
              companyId: query.companyId,
              branchId: query.branchId,
              dateFrom: row.date,
              dateTo: row.date,
            }),
            entityType: 'salesOrder',
          },
          {
            label: 'Open Z-report',
            href: this.route('/westsides/daily-close', {
              companyId: query.companyId,
              branchId: query.branchId,
              date: row.date,
            }),
            entityType: 'dailyClose',
          },
        ],
      }),
    }));
  }

  async monthlySalesSummary(query: QueryReportDto, user: AuthUser) {
    const orders = await this.prisma.salesOrder.findMany({
      where: await this.salesWhere(query, user),
      select: { orderDate: true, totalAmount: true },
      orderBy: { orderDate: 'asc' },
    });

    const monthly = new Map<string, { month: string; total: number; count: number }>();
    for (const o of orders) {
      const d = o.orderDate;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const entry = monthly.get(key) ?? { month: key, total: 0, count: 0 };
      entry.total += Number(o.totalAmount);
      entry.count += 1;
      monthly.set(key, entry);
    }
    return Array.from(monthly.values()).map((row) => ({
      ...row,
      averageOrderValue: row.count > 0 ? row.total / row.count : 0,
      readinessStatus: row.count > 0 ? 'READY' : 'INFO',
      ...this.reportMeta({
        readiness: this.readiness(
          row.count > 0 ? 'READY' : 'INFO',
          row.count > 0
            ? 'Monthly sales are traceable to confirmed sales orders.'
            : 'No confirmed sales orders exist for this month.',
        ),
        lineage: this.lineage(
          'Monthly sales summary',
          ['sales_orders'],
          ['totalAmount', 'orderDate'],
        ),
        drillThrough: [
          {
            label: 'Open month orders',
            href: this.route('/operations/sales-orders', {
              companyId: query.companyId,
              branchId: query.branchId,
              month: row.month,
            }),
            entityType: 'salesOrder',
          },
        ],
      }),
    }));
  }

  /**
   * Upsert the persisted daily close for a company/branch/date. One record per
   * scope+date; a re-save overwrites the previous sign-off (the record keeps
   * who saved last and when, which is the supervisor sign-off of record).
   */
  async saveDailyClose(dto: SaveDailyCloseDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.WRITE);
    const baseDate = new Date(dto.closeDate);
    // PostgreSQL DATE values are returned as UTC midnight. Preserve the local
    // calendar label in that canonical representation instead of sending a
    // local-midnight instant that the database can truncate to the prior day.
    const closeDate = localCalendarDateKey(baseDate);
    const scope = {
      companyId: dto.companyId,
      branchId: dto.branchId ?? null,
      closeDate,
    };
    const data = {
      countedByMethod: dto.countedByMethod,
      expectedTotal: dto.expectedTotal,
      countedTotal: dto.countedTotal,
      varianceTotal: dto.varianceTotal,
      notes: dto.notes ?? null,
      closedById: user.id,
      closedByName: user.fullName ?? user.email,
      closedAt: new Date(),
    };
    const existing = await this.prisma.westsidesDailyClose.findFirst({ where: scope });
    const record = existing
      ? await this.prisma.westsidesDailyClose.update({ where: { id: existing.id }, data })
      : await this.prisma.westsidesDailyClose.create({ data: { ...scope, ...data } });
    await this.auditLogs.log({
      action: existing ? 'WESTSIDES_DAILY_CLOSE_UPDATE' : 'WESTSIDES_DAILY_CLOSE_CREATE',
      entityType: 'WestsidesDailyClose',
      entityId: record.id,
      userId: user.id,
      companyId: record.companyId,
      ...(existing ? { oldValue: existing as unknown as Record<string, unknown> } : {}),
      newValue: record as unknown as Record<string, unknown>,
    });
    return record;
  }
}

function localCalendarDateKey(value: Date): Date {
  return new Date(Date.UTC(value.getFullYear(), value.getMonth(), value.getDate()));
}

import { Injectable } from '@nestjs/common';
import { SalesOrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services/company-scope.service';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { QueryReportDto } from './dto/query-report.dto';

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

@Injectable()
export class WestsidesReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
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

    const methodRows = byMethod.map((m) => ({
      paymentMethod: m.paymentMethod,
      cashAccountId: m.cashAccountId,
      cashAccountName: m.cashAccountId
        ? (cashAccountById.get(m.cashAccountId)?.accountName ?? null)
        : null,
      cashAccountType: m.cashAccountId
        ? (cashAccountById.get(m.cashAccountId)?.accountType ?? null)
        : null,
      count: m._count.id,
      expected: Number(m._sum.totalAmount ?? 0),
      paid: Number(m._sum.paidAmount ?? 0),
    }));

    const mobileMoneyReferences = mobileMoneyOrders.map((o) => ({
      id: o.id,
      salesOrderNumber: o.salesOrderNumber,
      reference: o.paymentReference,
      amount: Number(o.totalAmount),
      cashAccountId: o.cashAccountId,
      cashAccountName: o.cashAccountId
        ? (cashAccountById.get(o.cashAccountId)?.accountName ?? null)
        : null,
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

    return {
      date: dayStart.toISOString(),
      companyId: query.companyId,
      branchId: query.branchId ?? null,
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
      })),
      mobileMoneyReferences,
      readiness: {
        status: exceptionList.some((item) => item.severity === 'critical')
          ? 'BLOCKED'
          : exceptionList.some((item) => item.severity === 'warning')
            ? 'NEEDS_REVIEW'
            : 'READY',
        closeReady:
          exceptionList.length === 0 || !exceptionList.some((item) => item.severity === 'critical'),
        exceptionCount: exceptionList.length,
        cashAccountsAssigned: unassignedPaymentAccountCount === 0,
        mobileMoneyReferencesComplete: missingMobileMoneyReferenceCount === 0,
        unassignedPaymentAccountCount,
        missingMobileMoneyReferenceCount,
        unattributedSalespersonCount,
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
      return {
        productId: row.productId,
        productCode: product?.productCode ?? null,
        sku: product?.sku ?? null,
        productName: product?.name ?? 'Unknown product',
        quantity: this.toNumber(row._sum.quantity),
        totalAmount: this.toNumber(row._sum.lineTotal),
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

    return rows.map((row) => ({
      batchNumber: row.batchNumber,
      productCode: row.product.productCode,
      sku: row.product.sku,
      productName: row.product.name,
      branch: row.branch ? `${row.branch.code} - ${row.branch.name}` : 'All branches',
      supplier: row.supplier ? `${row.supplier.supplierCode} - ${row.supplier.name}` : null,
      status: row.status,
      receivedDate: row.receivedDate,
      expiryDate: row.expiryDate,
      initialQuantity: this.toNumber(row.initialQuantity),
      remainingQuantity: this.toNumber(row.remainingQuantity),
      unit: row.unit.symbol ?? row.unit.name,
      unitCost: this.toNumber(row.unitCost),
    }));
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

    return rows.map((row) => ({
      damageType: row.damageType,
      status: row.status,
      reportCount: row._count.id,
      quantity: this.toNumber(row._sum.quantity),
      estimatedValue: this.toNumber(row._sum.estimatedValue),
    }));
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

    return rows.map((row) => ({
      customerCode: row.customer.customerCode,
      customerName: row.customer.name,
      packageCode: row.returnablePackage?.packageCode ?? null,
      packageName: row.returnablePackage?.name ?? 'Unassigned package',
      packageType: row.returnablePackage?.packageType ?? null,
      quantityOwedByCustomer: this.toNumber(row.quantityOwedByCustomer),
      quantityOwedToCustomer: this.toNumber(row.quantityOwedToCustomer),
      depositBalance: this.toNumber(row.depositBalance),
      updatedAt: row.updatedAt,
    }));
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
    return byStatus.map((row) => ({
      status: row.status,
      quotationCount: row._count.id,
      totalQuotations: total,
      convertedQuotations: converted,
      conversionRate,
    }));
  }

  async deliveryPerformance(query: QueryReportDto, user: AuthUser) {
    const { companyId, branchId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const where: any = { ...companyWhere, deletedAt: null };
    if (branchId) where.branchId = branchId;

    const rows = await this.prisma.deliveryNote.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
    });

    return rows.map((row) => ({
      status: row.status,
      deliveryCount: row._count.id,
    }));
  }

  async priceListReport(query: QueryReportDto, user: AuthUser) {
    const { companyId } = query;
    const companyWhere = await this.companyWhere({ companyId }, user);
    const priceLists = await this.prisma.priceList.findMany({
      where: { ...companyWhere, deletedAt: null },
      include: { _count: { select: { items: true } } },
    });
    return priceLists.map((priceList) => ({
      name: priceList.name,
      priceListType: priceList.priceListType,
      currency: priceList.currency,
      effectiveFrom: priceList.effectiveFrom,
      effectiveTo: priceList.effectiveTo,
      status: priceList.status,
      itemCount: priceList._count.items,
      approvedAt: priceList.approvedAt,
    }));
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
      return {
        rank: index + 1,
        productCode: product?.productCode ?? null,
        sku: product?.sku ?? null,
        productName: product?.name ?? 'Unknown product',
        quantity: this.toNumber(row._sum.quantity),
        totalAmount: this.toNumber(row._sum.lineTotal),
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

    return rows.map((row) => ({
      productCode: row.product.productCode,
      sku: row.product.sku,
      productName: row.product.name,
      branch: row.branch ? `${row.branch.code} - ${row.branch.name}` : 'All branches',
      quantityOnHand: this.toNumber(row.quantityOnHand),
      quantityReserved: this.toNumber(row.quantityReserved),
      totalValue: this.toNumber(row.totalValue),
      lastMovementAt: row.lastMovementAt,
    }));
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
      return {
        productId: r.productId,
        productCode: product?.productCode ?? null,
        sku: product?.sku ?? null,
        productName: product?.name ?? 'Unknown product',
        quantity: this.toNumber(r._sum.quantity),
        averageUnitCost: avgCost,
        totalRevenue,
        totalCost,
        grossProfit: totalRevenue - totalCost,
        grossMargin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0,
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
    return Array.from(daily.values());
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
    return Array.from(monthly.values());
  }
}

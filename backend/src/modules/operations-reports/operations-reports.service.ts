import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CompanyScopeService } from '../../common/services';
import { AuthUser } from '../../common/decorators/current-user.decorator';

type OperationsReportQuery = Record<string, string | undefined>;

@Injectable()
export class OperationsReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
  ) {}

  async getStockValuation(
    companyId: string | undefined,
    locationId: string | undefined,
    divisionId: string | undefined,
    user: AuthUser,
    productId?: string,
  ) {
    return this.getStockValuationRows({ companyId, locationId, divisionId, productId }, user);
  }

  async getSalesSummary(
    companyId: string | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    divisionId: string | undefined,
    user: AuthUser,
  ) {
    const query = { companyId, dateFrom, dateTo, divisionId };
    const where = await this.salesOrderWhere(query, user);

    const [aggregate, byTypeRaw, byPaymentRaw] = await Promise.all([
      this.prisma.salesOrder.aggregate({
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['salesType'],
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.salesOrder.groupBy({
        by: ['paymentStatus'],
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
    ]);

    const byType = byTypeRaw.map((group) => ({
      section: 'Sales Type',
      salesType: group.salesType,
      orderCount: group._count,
      totalAmount: this.toNumber(group._sum.totalAmount),
      paidAmount: this.toNumber(group._sum.paidAmount),
      outstandingAmount: this.toNumber(group._sum.outstandingAmount),
    }));
    const byPaymentStatus = byPaymentRaw.map((group) => ({
      section: 'Payment Status',
      paymentStatus: group.paymentStatus,
      orderCount: group._count,
      totalAmount: this.toNumber(group._sum.totalAmount),
      paidAmount: this.toNumber(group._sum.paidAmount),
      outstandingAmount: this.toNumber(group._sum.outstandingAmount),
    }));

    return {
      totalSalesOrders: aggregate._count,
      totalSalesValue: this.toNumber(aggregate._sum.totalAmount),
      totalPaid: this.toNumber(aggregate._sum.paidAmount),
      totalOutstanding: this.toNumber(aggregate._sum.outstandingAmount),
      byType,
      byPaymentStatus,
      rows: [...byType, ...byPaymentStatus],
      generatedAt: new Date().toISOString(),
    };
  }

  async getPurchaseSummary(
    companyId: string | undefined,
    dateFrom: string | undefined,
    dateTo: string | undefined,
    divisionId: string | undefined,
    user: AuthUser,
  ) {
    const query = { companyId, dateFrom, dateTo, divisionId };
    const where = await this.purchaseOrderWhere(query, user);

    const [aggregate, byTypeRaw, byPaymentRaw] = await Promise.all([
      this.prisma.purchaseOrder.aggregate({
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ['purchaseType'],
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
      this.prisma.purchaseOrder.groupBy({
        by: ['paymentStatus'],
        where,
        _count: true,
        _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
      }),
    ]);

    const byType = byTypeRaw.map((group) => ({
      section: 'Purchase Type',
      purchaseType: group.purchaseType,
      orderCount: group._count,
      totalAmount: this.toNumber(group._sum.totalAmount),
      paidAmount: this.toNumber(group._sum.paidAmount),
      outstandingAmount: this.toNumber(group._sum.outstandingAmount),
    }));
    const byPaymentStatus = byPaymentRaw.map((group) => ({
      section: 'Payment Status',
      paymentStatus: group.paymentStatus,
      orderCount: group._count,
      totalAmount: this.toNumber(group._sum.totalAmount),
      paidAmount: this.toNumber(group._sum.paidAmount),
      outstandingAmount: this.toNumber(group._sum.outstandingAmount),
    }));

    return {
      totalPurchaseOrders: aggregate._count,
      totalPurchaseValue: this.toNumber(aggregate._sum.totalAmount),
      totalPaid: this.toNumber(aggregate._sum.paidAmount),
      totalOutstanding: this.toNumber(aggregate._sum.outstandingAmount),
      byType,
      byPaymentStatus,
      rows: [...byType, ...byPaymentStatus],
      generatedAt: new Date().toISOString(),
    };
  }

  async getInventoryMovements(
    companyId?: string,
    productId?: string,
    locationId?: string,
    dateFrom?: string,
    dateTo?: string,
    page = 1,
    pageSize = 20,
    divisionId?: string,
    user?: AuthUser,
  ) {
    const query = { companyId, productId, locationId, dateFrom, dateTo, divisionId };
    const where = user
      ? await this.inventoryMovementWhere(query, user)
      : this.rawCompanyWhere(companyId);

    const safePage = Math.max(1, page);
    const safePageSize = Math.min(Math.max(1, pageSize), 1000);

    const [total, items] = await Promise.all([
      this.prisma.inventoryMovement.count({ where }),
      this.prisma.inventoryMovement.findMany({
        where,
        include: {
          product: { select: { id: true, productCode: true, sku: true, name: true } },
          branch: { select: { id: true, name: true, code: true } },
          unit: { select: { id: true, name: true, symbol: true } },
        },
        orderBy: { movementDate: 'desc' },
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
    ]);

    const rows = items.map((movement) => ({
      movementNumber: movement.movementNumber,
      movementDate: movement.movementDate,
      movementType: movement.movementType,
      branch: this.branchLabel(movement.branch),
      productCode: movement.product.productCode,
      sku: movement.product.sku,
      product: movement.product.name,
      quantity: this.toNumber(movement.quantity),
      unit: this.unitLabel(movement.unit),
      unitCost: movement.unitCost !== null ? this.toNumber(movement.unitCost) : null,
      totalCost: movement.totalCost !== null ? this.toNumber(movement.totalCost) : null,
      referenceType: movement.referenceType,
      referenceId: movement.referenceId,
      batchNumber: movement.batchNumber,
      expiryDate: movement.expiryDate,
      notes: movement.notes,
    }));

    return {
      total,
      page: safePage,
      pageSize: safePageSize,
      items: rows,
      rows,
      generatedAt: new Date().toISOString(),
    };
  }

  async getSalesReport(query: OperationsReportQuery, user: AuthUser) {
    const salesOrder = await this.salesOrderWhere(query, user);
    const where: Record<string, unknown> = { salesOrder };
    if (query.productId) where.productId = query.productId;

    const rows = await this.prisma.salesOrderLine.findMany({
      where,
      include: {
        salesOrder: {
          select: {
            salesOrderNumber: true,
            orderDate: true,
            salesType: true,
            status: true,
            paymentMethod: true,
            paymentStatus: true,
            customerName: true,
            customer: { select: { customerCode: true, name: true } },
            branch: { select: { name: true, code: true } },
            salesperson: { select: { employeeCode: true, fullName: true } },
          },
        },
        product: { select: { productCode: true, sku: true, name: true } },
        unit: { select: { name: true, symbol: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: this.limit(query),
    });

    return rows.map((line) => ({
      date: line.salesOrder.orderDate,
      salesOrderNumber: line.salesOrder.salesOrderNumber,
      customerCode: line.salesOrder.customer?.customerCode ?? null,
      customer:
        line.salesOrder.customer?.name ?? line.salesOrder.customerName ?? 'Walk-in customer',
      branch: this.branchLabel(line.salesOrder.branch),
      salesType: line.salesOrder.salesType,
      status: line.salesOrder.status,
      paymentMethod: line.salesOrder.paymentMethod,
      paymentStatus: line.salesOrder.paymentStatus,
      productCode: line.product.productCode,
      sku: line.product.sku,
      product: line.product.name,
      quantity: this.toNumber(line.quantity),
      unit: this.unitLabel(line.unit),
      unitPrice: this.toNumber(line.unitPrice),
      discountAmount: this.toNumber(line.discountAmount),
      taxAmount: this.toNumber(line.taxAmount),
      amount: this.toNumber(line.lineTotal),
      salesperson: line.salesOrder.salesperson
        ? `${line.salesOrder.salesperson.employeeCode ?? ''} ${line.salesOrder.salesperson.fullName ?? ''}`.trim()
        : null,
    }));
  }

  async getSalesByCustomer(query: OperationsReportQuery, user: AuthUser) {
    const where = await this.salesOrderWhere(query, user);
    const orders = await this.prisma.salesOrder.findMany({
      where,
      include: {
        customer: { select: { customerCode: true, name: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { orderDate: 'desc' },
      take: this.limit(query),
    });

    const grouped = new Map<string, Record<string, unknown>>();
    for (const order of orders) {
      const customerCode = order.customer?.customerCode ?? 'WALK-IN';
      const customer = order.customer?.name ?? order.customerName ?? 'Walk-in customer';
      const key = order.customerId ?? customer;
      const current = grouped.get(key) ?? {
        customerCode,
        customer,
        orderCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
      };
      current.orderCount = this.toNumber(current.orderCount) + 1;
      current.totalAmount = this.toNumber(current.totalAmount) + this.toNumber(order.totalAmount);
      current.paidAmount = this.toNumber(current.paidAmount) + this.toNumber(order.paidAmount);
      current.outstandingAmount =
        this.toNumber(current.outstandingAmount) + this.toNumber(order.outstandingAmount);
      grouped.set(key, current);
    }

    return Array.from(grouped.values()).sort(
      (a, b) => this.toNumber(b.totalAmount) - this.toNumber(a.totalAmount),
    );
  }

  async getSalesByProduct(query: OperationsReportQuery, user: AuthUser) {
    return this.groupLineRows(await this.getSalesReport(query, user), 'productCode', [
      'productCode',
      'sku',
      'product',
    ]);
  }

  async getCustomerProductSales(query: OperationsReportQuery, user: AuthUser) {
    return this.groupLineRowsByDimensions(await this.getSalesReport(query, user), {
      dimensionKeys: ['customerCode', 'customer', 'productCode', 'sku', 'product', 'unit'],
      documentKey: 'salesOrderNumber',
      averageKey: 'averageUnitPrice',
    });
  }

  async getPurchaseReport(query: OperationsReportQuery, user: AuthUser) {
    const purchaseOrder = await this.purchaseOrderWhere(query, user);
    const where: Record<string, unknown> = { purchaseOrder };
    if (query.productId) where.productId = query.productId;

    const rows = await this.prisma.purchaseOrderLine.findMany({
      where,
      include: {
        purchaseOrder: {
          select: {
            purchaseOrderNumber: true,
            orderDate: true,
            expectedDate: true,
            purchaseType: true,
            status: true,
            paymentStatus: true,
            supplierName: true,
            supplier: { select: { supplierCode: true, name: true } },
            branch: { select: { name: true, code: true } },
          },
        },
        product: { select: { productCode: true, sku: true, name: true } },
        unit: { select: { name: true, symbol: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: this.limit(query),
    });

    return rows.map((line) => ({
      date: line.purchaseOrder.orderDate,
      expectedDate: line.purchaseOrder.expectedDate,
      purchaseOrderNumber: line.purchaseOrder.purchaseOrderNumber,
      supplierCode: line.purchaseOrder.supplier?.supplierCode ?? null,
      supplier: line.purchaseOrder.supplier?.name ?? line.purchaseOrder.supplierName ?? 'Supplier',
      branch: this.branchLabel(line.purchaseOrder.branch),
      purchaseType: line.purchaseOrder.purchaseType,
      status: line.purchaseOrder.status,
      paymentStatus: line.purchaseOrder.paymentStatus,
      productCode: line.product.productCode,
      sku: line.product.sku,
      product: line.product.name,
      quantity: this.toNumber(line.quantity),
      unit: this.unitLabel(line.unit),
      unitCost: this.toNumber(line.unitCost),
      discountAmount: this.toNumber(line.discountAmount),
      taxAmount: this.toNumber(line.taxAmount),
      amount: this.toNumber(line.lineTotal),
      batchNumber: line.batchNumber,
      expiryDate: line.expiryDate,
    }));
  }

  async getPurchasesBySupplier(query: OperationsReportQuery, user: AuthUser) {
    const where = await this.purchaseOrderWhere(query, user);
    const orders = await this.prisma.purchaseOrder.findMany({
      where,
      include: {
        supplier: { select: { supplierCode: true, name: true } },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { orderDate: 'desc' },
      take: this.limit(query),
    });

    const grouped = new Map<string, Record<string, unknown>>();
    for (const order of orders) {
      const supplierCode = order.supplier?.supplierCode ?? 'UNASSIGNED';
      const supplier = order.supplier?.name ?? order.supplierName ?? 'Supplier';
      const key = order.supplierId ?? supplier;
      const current = grouped.get(key) ?? {
        supplierCode,
        supplier,
        purchaseOrderCount: 0,
        totalAmount: 0,
        paidAmount: 0,
        outstandingAmount: 0,
      };
      current.purchaseOrderCount = this.toNumber(current.purchaseOrderCount) + 1;
      current.totalAmount = this.toNumber(current.totalAmount) + this.toNumber(order.totalAmount);
      current.paidAmount = this.toNumber(current.paidAmount) + this.toNumber(order.paidAmount);
      current.outstandingAmount =
        this.toNumber(current.outstandingAmount) + this.toNumber(order.outstandingAmount);
      grouped.set(key, current);
    }

    return Array.from(grouped.values()).sort(
      (a, b) => this.toNumber(b.totalAmount) - this.toNumber(a.totalAmount),
    );
  }

  async getPurchasesByProduct(query: OperationsReportQuery, user: AuthUser) {
    return this.groupLineRows(await this.getPurchaseReport(query, user), 'productCode', [
      'productCode',
      'sku',
      'product',
    ]);
  }

  async getSupplierProductPurchases(query: OperationsReportQuery, user: AuthUser) {
    return this.groupLineRowsByDimensions(await this.getPurchaseReport(query, user), {
      dimensionKeys: ['supplierCode', 'supplier', 'productCode', 'sku', 'product', 'unit'],
      documentKey: 'purchaseOrderNumber',
      averageKey: 'averageUnitCost',
    });
  }

  async getLowStock(query: OperationsReportQuery, user: AuthUser) {
    const rows = await this.getStockValuationRows(query, user);
    return rows
      .filter((row) => {
        const threshold = Math.max(
          this.toNumber(row.reorderLevel),
          this.toNumber(row.minimumStockLevel),
        );
        return threshold > 0 && this.toNumber(row.quantityOnHand) <= threshold;
      })
      .map((row) => ({
        ...row,
        shortageQuantity: Math.max(
          this.toNumber(row.reorderLevel) - this.toNumber(row.quantityOnHand),
          0,
        ),
      }));
  }

  /**
   * Stock ageing / slow-moving — for every product-in-stock, how long since its
   * last movement, bucketed into age bands, with the capital tied up in slow
   * stock flagged as "value at risk". Helps clear dead inventory.
   */
  async getStockAgeing(query: OperationsReportQuery, user: AuthUser) {
    const rows = await this.getStockValuationRows(query, user);
    const now = Date.now();
    return rows
      .filter((row) => this.toNumber(row.quantityOnHand) > 0)
      .map((row) => {
        const last = row.lastMovementAt ? row.lastMovementAt.getTime() : null;
        const daysSinceLastMovement =
          last === null ? null : Math.max(0, Math.floor((now - last) / (1000 * 60 * 60 * 24)));
        const ageBand =
          daysSinceLastMovement === null
            ? 'No movement recorded'
            : daysSinceLastMovement <= 30
              ? '0-30 days'
              : daysSinceLastMovement <= 60
                ? '31-60 days'
                : daysSinceLastMovement <= 90
                  ? '61-90 days'
                  : daysSinceLastMovement <= 180
                    ? '91-180 days'
                    : 'Over 180 days';
        const slowMoving = daysSinceLastMovement === null || daysSinceLastMovement > 90;
        return {
          productCode: row.productCode,
          sku: row.sku,
          product: row.product,
          category: row.category,
          branch: row.branch,
          quantityOnHand: row.quantityOnHand,
          unit: row.unit,
          averageCost: row.averageCost,
          totalValue: row.totalValue,
          lastMovementAt: row.lastMovementAt,
          daysSinceLastMovement,
          ageBand,
          slowMoving,
          valueAtRisk: slowMoving ? row.totalValue : 0,
        };
      })
      .sort((a, b) => (b.daysSinceLastMovement ?? 99999) - (a.daysSinceLastMovement ?? 99999));
  }

  async getStockAdjustments(query: OperationsReportQuery, user: AuthUser) {
    const stockAdjustment = await this.stockAdjustmentWhere(query, user);
    const rows = await this.prisma.stockAdjustmentLine.findMany({
      where: {
        stockAdjustment,
        ...(query.productId ? { productId: query.productId } : {}),
      },
      include: {
        stockAdjustment: {
          select: {
            adjustmentNumber: true,
            reason: true,
            status: true,
            createdAt: true,
            postedAt: true,
            branch: { select: { name: true, code: true } },
          },
        },
        product: { select: { productCode: true, sku: true, name: true } },
        unit: { select: { name: true, symbol: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: this.limit(query),
    });

    return rows.map((line) => ({
      adjustmentNumber: line.stockAdjustment.adjustmentNumber,
      date: line.stockAdjustment.postedAt ?? line.stockAdjustment.createdAt,
      branch: this.branchLabel(line.stockAdjustment.branch),
      status: line.stockAdjustment.status,
      productCode: line.product.productCode,
      sku: line.product.sku,
      product: line.product.name,
      systemQuantity: this.toNumber(line.systemQuantity),
      countedQuantity: this.toNumber(line.countedQuantity),
      varianceQuantity: this.toNumber(line.varianceQuantity),
      unit: this.unitLabel(line.unit),
      headerReason: line.stockAdjustment.reason,
      lineReason: line.reason,
    }));
  }

  /**
   * Branch profitability — revenue, COGS, gross profit and margin% per branch,
   * from confirmed sales order lines (where COGS has been computed by the
   * posting/profit engine). Filter by ?productId to see a single product's
   * profitability across branches. The biggest "where do we actually make
   * money" question for a multi-branch hardware business.
   */
  async getBranchProfitability(query: OperationsReportQuery, user: AuthUser) {
    const salesOrder = await this.salesOrderWhere(query, user);
    const where: Record<string, unknown> = {
      cogsAmount: { not: null },
      salesOrder,
      ...(query.productId ? { productId: query.productId } : {}),
    };

    const lines = await this.prisma.salesOrderLine.findMany({
      where,
      select: {
        quantity: true,
        lineTotal: true,
        cogsAmount: true,
        grossProfitAmount: true,
        salesOrder: {
          select: { branchId: true, branch: { select: { code: true, name: true } } },
        },
      },
      take: this.limit(query),
    });

    type Row = {
      branch: string;
      lineCount: number;
      unitsSold: number;
      revenue: number;
      cogs: number;
      grossProfit: number;
      grossMarginPct: number;
    };
    const grouped = new Map<string, Row>();
    for (const line of lines) {
      const key = line.salesOrder.branchId ?? 'unassigned';
      const row: Row = grouped.get(key) ?? {
        branch: this.branchLabel(line.salesOrder.branch) ?? 'Unassigned branch',
        lineCount: 0,
        unitsSold: 0,
        revenue: 0,
        cogs: 0,
        grossProfit: 0,
        grossMarginPct: 0,
      };
      row.lineCount += 1;
      row.unitsSold += this.toNumber(line.quantity);
      row.revenue += this.toNumber(line.lineTotal);
      row.cogs += this.toNumber(line.cogsAmount);
      row.grossProfit += this.toNumber(line.grossProfitAmount);
      grouped.set(key, row);
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        grossMarginPct:
          row.revenue > 0 ? Number(((row.grossProfit / row.revenue) * 100).toFixed(2)) : 0,
      }))
      .sort((a, b) => b.grossProfit - a.grossProfit);
  }

  private async getStockValuationRows(query: OperationsReportQuery, user: AuthUser) {
    const where = await this.inventoryBalanceWhere(query, user);

    const balances = await this.prisma.inventoryBalance.findMany({
      where,
      include: {
        product: {
          select: {
            id: true,
            productCode: true,
            sku: true,
            name: true,
            reorderLevel: true,
            minimumStockLevel: true,
            maximumStockLevel: true,
            category: { select: { name: true } },
            baseUnit: { select: { name: true, symbol: true } },
          },
        },
        branch: { select: { id: true, name: true, code: true, divisionId: true } },
      },
      orderBy: [{ product: { productCode: 'asc' } }, { branch: { name: 'asc' } }],
    });

    return balances.map((balance) => {
      const quantityOnHand = this.toNumber(balance.quantityOnHand);
      const quantityReserved = this.toNumber(balance.quantityReserved);
      const reorderLevel = this.toNumber(balance.product.reorderLevel);
      const minimumStockLevel = this.toNumber(balance.product.minimumStockLevel);
      return {
        productCode: balance.product.productCode,
        sku: balance.product.sku,
        product: balance.product.name,
        productName: balance.product.name,
        category: balance.product.category.name,
        branch: this.branchLabel(balance.branch),
        locationName: this.branchLabel(balance.branch) ?? 'Unassigned branch/location',
        quantityOnHand,
        quantityReserved,
        availableQuantity: quantityOnHand - quantityReserved,
        unit: this.unitLabel(balance.product.baseUnit),
        averageCost: this.toNumber(balance.averageCost),
        totalValue: this.toNumber(balance.totalValue),
        reorderLevel,
        minimumStockLevel,
        maximumStockLevel: this.toNumber(balance.product.maximumStockLevel),
        stockStatus:
          Math.max(reorderLevel, minimumStockLevel) > 0 &&
          quantityOnHand <= Math.max(reorderLevel, minimumStockLevel)
            ? 'LOW_STOCK'
            : 'OK',
        lastMovementAt: balance.lastMovementAt,
      };
    });
  }

  private async inventoryBalanceWhere(query: OperationsReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.companyScope.companyWhereFor(
      user,
      query.companyId,
    );
    const branchId = query.branchId ?? query.locationId;
    if (branchId) where.branchId = branchId;
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.productId) where.productId = query.productId;
    return where;
  }

  private async inventoryMovementWhere(query: OperationsReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = await this.companyScope.companyWhereFor(
      user,
      query.companyId,
    );
    const branchId = query.branchId ?? query.locationId;
    if (branchId) where.branchId = branchId;
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.productId) where.productId = query.productId;
    this.applyDateFilter(where, 'movementDate', query);
    if (query.status) where.movementType = query.status;
    return where;
  }

  private async salesOrderWhere(query: OperationsReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
    const branchId = query.branchId ?? query.locationId;
    if (branchId) where.branchId = branchId;
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.customerId) where.customerId = query.customerId;
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    this.applyDateFilter(where, 'orderDate', query);
    return where;
  }

  private async purchaseOrderWhere(query: OperationsReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
    const branchId = query.branchId ?? query.locationId;
    if (branchId) where.branchId = branchId;
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus;
    this.applyDateFilter(where, 'orderDate', query);
    return where;
  }

  private async stockAdjustmentWhere(query: OperationsReportQuery, user: AuthUser) {
    const where: Record<string, unknown> = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
    };
    const branchId = query.branchId ?? query.locationId;
    if (branchId) where.branchId = branchId;
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.status) where.status = query.status;
    this.applyDateFilter(where, 'createdAt', query);
    return where;
  }

  private rawCompanyWhere(companyId?: string) {
    return companyId ? { companyId } : {};
  }

  private applyDateFilter(
    where: Record<string, unknown>,
    key: string,
    query: OperationsReportQuery,
  ) {
    const filter = this.dateFilter(query);
    if (filter) where[key] = filter;
  }

  private dateFilter(query: OperationsReportQuery) {
    const from = query.from ?? query.dateFrom;
    const to = query.to ?? query.dateTo;
    if (!from && !to) return undefined;
    return {
      ...(from ? { gte: this.startOfDay(from) } : {}),
      ...(to ? { lte: this.endOfDay(to) } : {}),
    };
  }

  private startOfDay(value: string) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private endOfDay(value: string) {
    const date = new Date(value);
    date.setHours(23, 59, 59, 999);
    return date;
  }

  private limit(query: OperationsReportQuery) {
    const raw = Number(query.pageSize ?? query.limit ?? 500);
    return Math.min(Math.max(Number.isFinite(raw) ? raw : 500, 1), 1000);
  }

  private groupLineRows(
    rows: Record<string, unknown>[],
    keyName: string,
    labelKeys: string[],
  ): Record<string, unknown>[] {
    const grouped = new Map<string, Record<string, unknown>>();
    for (const row of rows) {
      const key = String(row[keyName] ?? row.product ?? 'UNASSIGNED');
      const current =
        grouped.get(key) ??
        Object.fromEntries([
          ...labelKeys.map((labelKey) => [labelKey, row[labelKey]]),
          ['lineCount', 0],
          ['quantity', 0],
          ['totalAmount', 0],
          ['discountAmount', 0],
          ['taxAmount', 0],
        ]);
      current.lineCount = this.toNumber(current.lineCount) + 1;
      current.quantity = this.toNumber(current.quantity) + this.toNumber(row.quantity);
      current.totalAmount = this.toNumber(current.totalAmount) + this.toNumber(row.amount);
      current.discountAmount =
        this.toNumber(current.discountAmount) + this.toNumber(row.discountAmount);
      current.taxAmount = this.toNumber(current.taxAmount) + this.toNumber(row.taxAmount);
      grouped.set(key, current);
    }
    return Array.from(grouped.values()).sort(
      (a, b) => this.toNumber(b.totalAmount) - this.toNumber(a.totalAmount),
    );
  }

  private groupLineRowsByDimensions(
    rows: Record<string, unknown>[],
    input: {
      dimensionKeys: string[];
      documentKey: string;
      averageKey: string;
    },
  ): Record<string, unknown>[] {
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

      current.lineCount = this.toNumber(current.lineCount) + 1;
      current.quantity = this.toNumber(current.quantity) + this.toNumber(row.quantity);
      current.totalAmount = this.toNumber(current.totalAmount) + this.toNumber(row.amount);
      current.discountAmount =
        this.toNumber(current.discountAmount) + this.toNumber(row.discountAmount);
      current.taxAmount = this.toNumber(current.taxAmount) + this.toNumber(row.taxAmount);
      current.documentCount = documents.size;
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

  private toNumber(value: unknown): number {
    const number = Number(value ?? 0);
    return Number.isFinite(number) ? number : 0;
  }

  private branchLabel(branch?: { code?: string | null; name?: string | null } | null) {
    if (!branch) return null;
    return branch.code ? `${branch.code} - ${branch.name ?? ''}`.trim() : (branch.name ?? null);
  }

  private unitLabel(unit?: { name?: string | null; symbol?: string | null } | null) {
    if (!unit) return null;
    return unit.symbol ? `${unit.symbol} - ${unit.name ?? ''}`.trim() : (unit.name ?? null);
  }
}

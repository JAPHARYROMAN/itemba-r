import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessLevel, AuditSeverity, Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import {
  Supplier360ExportQueryDto,
  Supplier360ReportQueryDto,
  Supplier360Section,
} from './dto/supplier-360-report.dto';

const EXPORT_LIMIT = 50_000;

type InvoiceReference = {
  number: string;
  date: Date | null;
  source: 'PROCUREMENT_INVOICE' | 'PURCHASE_ORDER_REFERENCE';
};

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  return value == null ? 0 : Number(value);
}

function csvEscape(value: unknown) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class Supplier360ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companyScope: CompanyScopeService,
    private readonly generatedDocuments: GeneratedDocumentsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  async getReport(query: Supplier360ReportQueryDto, user: AuthUser) {
    await this.companyScope.assertCanAccessCompany(user, query.companyId, AccessLevel.READ);
    const supplier = await this.prisma.supplier.findFirst({
      where: {
        id: query.supplierId,
        companyId: query.companyId,
        deletedAt: null,
      },
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        productCategories: {
          include: { productCategory: { select: { id: true, name: true } } },
        },
      },
    });
    if (!supplier) throw new NotFoundException('Supplier not found');

    const purchaseWhere = this.purchaseWhere(query);
    const payableWhere = this.payableWhere(query);
    const [currencyGroups, payableGroups, missingInvoices, linkedInvoices, productGroups] =
      await Promise.all([
        this.prisma.purchaseOrder.groupBy({
          by: ['currency'],
          where: purchaseWhere,
          _count: { _all: true },
          _sum: { totalAmount: true, paidAmount: true, outstandingAmount: true },
        }),
        this.prisma.payable.groupBy({
          by: ['currency'],
          where: payableWhere,
          _count: { _all: true },
          _sum: { amount: true, paidAmount: true, outstandingAmount: true },
        }),
        this.prisma.purchaseOrder.count({
          where: {
            ...purchaseWhere,
            supplierInvoiceNumber: null,
            supplierInvoices: { none: { deletedAt: null } },
          },
        }),
        this.prisma.purchaseOrder.count({
          where: { ...purchaseWhere, supplierInvoices: { some: { deletedAt: null } } },
        }),
        this.prisma.purchaseOrderLine.groupBy({
          by: ['productId'],
          where: { purchaseOrder: purchaseWhere },
          _count: { _all: true },
        }),
      ]);

    const overdueGroups = await this.prisma.payable.groupBy({
      by: ['currency'],
      where: {
        ...payableWhere,
        dueDate: { lt: new Date() },
        status: { in: ['OPEN', 'PARTIALLY_PAID', 'OVERDUE'] },
      },
      _sum: { outstandingAmount: true },
    });
    const overdue = new Map(
      overdueGroups.map((row) => [row.currency, toNumber(row._sum.outstandingAmount)]),
    );
    const payableByCurrency = new Map(payableGroups.map((row) => [row.currency, row]));
    const summaryByCurrency = currencyGroups.map((row) => {
      const payable = payableByCurrency.get(row.currency);
      const totalPurchased = toNumber(row._sum.totalAmount);
      return {
        currency: row.currency,
        purchaseOrderCount: row._count._all,
        totalPurchased,
        paidAmount: toNumber(row._sum.paidAmount),
        outstandingAmount: toNumber(row._sum.outstandingAmount),
        averagePurchaseValue: row._count._all ? totalPurchased / row._count._all : 0,
        payableCount: payable?._count._all ?? 0,
        payableAmount: toNumber(payable?._sum.amount),
        payablePaidAmount: toNumber(payable?._sum.paidAmount),
        payableOutstandingAmount: toNumber(payable?._sum.outstandingAmount),
        overduePayableAmount: overdue.get(row.currency) ?? 0,
      };
    });

    const section = query.section ?? 'OVERVIEW';
    const sectionResult = await this.section(section, query, purchaseWhere, payableWhere);
    const result = {
      supplier: {
        id: supplier.id,
        supplierCode: supplier.supplierCode,
        name: supplier.name,
        legalName: supplier.legalName,
        status: supplier.status,
        phone: supplier.phone,
        email: supplier.email,
        address: supplier.address,
        tin: supplier.tin,
        vrn: supplier.vrn,
        paymentTerms: supplier.paymentTerms,
        company: supplier.company,
        division: supplier.division,
        categories: supplier.productCategories.map((row) => row.productCategory),
      },
      filters: this.filterMetadata(query),
      summary: {
        byCurrency: summaryByCurrency,
        uniqueProducts: productGroups.length,
        missingInvoiceCount: missingInvoices,
        linkedInvoiceCount: linkedInvoices,
      },
      section,
      ...sectionResult,
      generatedAt: new Date().toISOString(),
    };

    await this.auditLogs.log({
      action: 'SUPPLIER_360_REPORT_VIEW',
      entityType: 'Supplier',
      entityId: supplier.id,
      userId: user.id,
      companyId: supplier.companyId,
      newValue: { section, filters: result.filters } as any,
      severity: AuditSeverity.LOW,
    });
    return result;
  }

  async export(query: Supplier360ExportQueryDto, user: AuthUser, res: Response) {
    const fullQuery = { ...query, page: 1, limit: 500 } as Supplier360ReportQueryDto;
    const overview = await this.getReport({ ...fullQuery, section: 'OVERVIEW' }, user);
    const sections = await Promise.all(
      (['PURCHASES', 'PRODUCTS', 'PAYABLES'] as Supplier360Section[]).map((section) =>
        this.exportSection({ ...fullQuery, section }, user),
      ),
    );
    const [purchases, products, payables] = sections;
    const stem = `supplier-360-${this.safeFileName(overview.supplier.name)}-${new Date()
      .toISOString()
      .slice(0, 10)}`;

    await this.auditLogs.log({
      action: 'SUPPLIER_360_REPORT_EXPORT',
      entityType: 'Supplier',
      entityId: query.supplierId,
      userId: user.id,
      companyId: query.companyId,
      newValue: { format: query.format, filters: overview.filters } as any,
      severity: AuditSeverity.MEDIUM,
    });

    if (query.format === 'json') {
      return res.json({
        success: true,
        data: { ...overview, sections: { purchases, products, payables } },
      });
    }

    if (query.format === 'csv') {
      const selected =
        query.section === 'PRODUCTS'
          ? products
          : query.section === 'PAYABLES'
            ? payables
            : purchases;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${stem}.csv"`);
      return res.send(this.rowsToCsv(selected.columns, selected.rows));
    }

    if (query.format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'ITEMBA-R';
      workbook.created = new Date();
      this.addOverviewSheet(workbook, overview);
      this.addDataSheet(workbook, 'Purchases', purchases.columns, purchases.rows);
      this.addDataSheet(workbook, 'Products', products.columns, products.rows);
      this.addDataSheet(workbook, 'Payables', payables.columns, payables.rows);
      const buffer = await workbook.xlsx.writeBuffer();
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', `attachment; filename="${stem}.xlsx"`);
      return res.send(Buffer.from(buffer));
    }

    const combined = this.combinedPdfRows(purchases.rows, products.rows, payables.rows);
    if (combined.length > 5000) {
      throw new BadRequestException('PDF report exceeds 5,000 rows; narrow the report filters');
    }
    const summary = overview.summary.byCurrency.flatMap((row) => [
      { label: `Purchases (${row.currency})`, value: this.money(row.totalPurchased, row.currency) },
      { label: `Paid (${row.currency})`, value: this.money(row.paidAmount, row.currency) },
      {
        label: `Outstanding (${row.currency})`,
        value: this.money(row.outstandingAmount, row.currency),
      },
    ]);
    const generated = await this.generatedDocuments.generateTablePdf(
      {
        title: 'Supplier 360 Report',
        subtitle: `${overview.supplier.name} | Purchases, products and payable exposure`,
        companyId: query.companyId,
        orientation: 'portrait',
        columns: [
          'Section',
          'Reference',
          'Description',
          'Date',
          'Quantity',
          'Amount',
          'Paid',
          'Outstanding',
          'Status',
        ],
        rows: combined,
        numericColumns: [4, 5, 6, 7],
        columnWeights: [0.7, 1, 1.8, 0.9, 0.8, 1, 1, 1, 0.9],
        stripedRows: true,
        sectionTitle: 'Supplier Activity',
        summary: summary.slice(0, 16),
        meta: [
          { label: 'Supplier Code', value: overview.supplier.supplierCode || 'Not assigned' },
          {
            label: 'Reporting Period',
            value: `${query.dateFrom || 'First record'} to ${query.dateTo || 'Latest record'}`,
          },
          { label: 'Unique Products', value: String(overview.summary.uniqueProducts) },
          { label: 'Missing Invoices', value: String(overview.summary.missingInvoiceCount) },
        ],
        baseName: stem,
      },
      user,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${generated.fileName}"`);
    return res.send(generated.buffer);
  }

  private async exportSection(query: Supplier360ReportQueryDto, user: AuthUser) {
    const purchaseWhere = this.purchaseWhere(query);
    const payableWhere = this.payableWhere(query);
    const result = await this.section(
      query.section ?? 'PURCHASES',
      { ...query, page: 1, limit: EXPORT_LIMIT },
      purchaseWhere,
      payableWhere,
      EXPORT_LIMIT,
    );
    if (result.total > EXPORT_LIMIT) {
      throw new BadRequestException(
        `Export exceeds ${EXPORT_LIMIT.toLocaleString()} rows; narrow the report filters`,
      );
    }
    return { columns: result.columns, rows: result.rows };
  }

  private async section(
    section: Supplier360Section,
    query: Supplier360ReportQueryDto,
    purchaseWhere: Prisma.PurchaseOrderWhereInput,
    payableWhere: Prisma.PayableWhereInput,
    explicitLimit?: number,
  ): Promise<{ columns: string[]; rows: any[]; total: number; page: number; limit: number }> {
    const page = Number(query.page ?? 1);
    const limit = explicitLimit ?? Number(query.limit ?? 50);
    const skip = (page - 1) * limit;
    if (section === 'OVERVIEW') {
      return { columns: [], rows: [], total: 0, page, limit };
    }
    if (section === 'PURCHASES') {
      const [orders, total] = await Promise.all([
        this.prisma.purchaseOrder.findMany({
          where: purchaseWhere,
          include: {
            branch: { select: { id: true, name: true, code: true } },
            division: { select: { id: true, name: true, code: true } },
            supplierInvoices: {
              where: { deletedAt: null },
              select: { id: true, supplierInvoiceNumber: true, invoiceDate: true, status: true },
              orderBy: { invoiceDate: 'desc' },
            },
            lines: {
              include: {
                product: { select: { id: true, productCode: true, sku: true, name: true } },
                unit: { select: { name: true, symbol: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: [{ orderDate: 'desc' }, { purchaseOrderNumber: 'desc' }],
          skip,
          take: limit,
        }),
        this.prisma.purchaseOrder.count({ where: purchaseWhere }),
      ]);
      const rows = orders.map((order) => {
        const invoice = this.invoiceReference(order);
        return {
          id: order.id,
          purchaseOrderNumber: order.purchaseOrderNumber,
          invoiceNumber: invoice.map((row) => row.number).join(', '),
          invoiceDate: invoice[0]?.date ?? null,
          invoiceSource: invoice[0]?.source ?? 'MISSING',
          orderDate: order.orderDate,
          branch: order.branch?.name ?? '',
          division: order.division?.name ?? '',
          purchaseType: order.purchaseType,
          lineCount: order.lines.length,
          status: order.status,
          paymentStatus: order.paymentStatus,
          currency: order.currency,
          totalAmount: toNumber(order.totalAmount),
          paidAmount: toNumber(order.paidAmount),
          outstandingAmount: toNumber(order.outstandingAmount),
          lines: order.lines.map((line) => ({
            id: line.id,
            productId: line.productId,
            productCode: line.product.productCode,
            sku: line.product.sku,
            product: line.product.name,
            quantity: toNumber(line.quantity),
            unit: line.unit.symbol || line.unit.name,
            unitCost: toNumber(line.unitCost),
            lineTotal: toNumber(line.lineTotal),
          })),
          sourceHref: `/operations/purchase-orders/${order.id}`,
        };
      });
      return {
        columns: [
          'purchaseOrderNumber',
          'invoiceNumber',
          'invoiceDate',
          'orderDate',
          'branch',
          'purchaseType',
          'status',
          'paymentStatus',
          'currency',
          'totalAmount',
          'paidAmount',
          'outstandingAmount',
        ],
        rows,
        total,
        page,
        limit,
      };
    }
    if (section === 'PRODUCTS') {
      const lineWhere: Prisma.PurchaseOrderLineWhereInput = { purchaseOrder: purchaseWhere };
      const [lines, sourceLineCount] = await Promise.all([
        this.prisma.purchaseOrderLine.findMany({
          where: lineWhere,
          include: {
            purchaseOrder: {
              select: { id: true, purchaseOrderNumber: true, orderDate: true, currency: true },
            },
            product: {
              select: {
                id: true,
                productCode: true,
                sku: true,
                name: true,
                category: { select: { id: true, name: true } },
              },
            },
            unit: { select: { name: true, symbol: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: EXPORT_LIMIT,
        }),
        this.prisma.purchaseOrderLine.count({ where: lineWhere }),
      ]);
      if (sourceLineCount > EXPORT_LIMIT) {
        throw new BadRequestException(
          `Product report source exceeds ${EXPORT_LIMIT.toLocaleString()} lines; narrow the report filters`,
        );
      }
      const grouped = new Map<string, any>();
      for (const line of lines) {
        const key = `${line.productId}:${line.unitId}:${line.purchaseOrder.currency}`;
        const current = grouped.get(key) ?? {
          productId: line.productId,
          productCode: line.product.productCode,
          sku: line.product.sku,
          product: line.product.name,
          category: line.product.category?.name ?? '',
          unit: line.unit.symbol || line.unit.name,
          currency: line.purchaseOrder.currency,
          purchaseCount: 0,
          lineCount: 0,
          quantity: 0,
          totalAmount: 0,
          weightedCost: 0,
          lastPurchaseDate: line.purchaseOrder.orderDate,
          orderIds: new Set<string>(),
        };
        const quantity = toNumber(line.quantity);
        current.lineCount += 1;
        current.quantity += quantity;
        current.totalAmount += toNumber(line.lineTotal);
        current.weightedCost += quantity * toNumber(line.unitCost);
        current.orderIds.add(line.purchaseOrder.id);
        if (line.purchaseOrder.orderDate > current.lastPurchaseDate) {
          current.lastPurchaseDate = line.purchaseOrder.orderDate;
        }
        grouped.set(key, current);
      }
      const allRows = Array.from(grouped.values())
        .map((row) => ({
          ...row,
          purchaseCount: row.orderIds.size,
          averageUnitCost: row.quantity ? row.weightedCost / row.quantity : 0,
          sourceHref: `/inventory/products/${row.productId}`,
          orderIds: undefined,
          weightedCost: undefined,
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount);
      return {
        columns: [
          'productCode',
          'sku',
          'product',
          'category',
          'unit',
          'currency',
          'purchaseCount',
          'quantity',
          'averageUnitCost',
          'totalAmount',
          'lastPurchaseDate',
        ],
        rows: allRows.slice(skip, skip + limit),
        total: allRows.length,
        page,
        limit,
      };
    }

    const [payables, total] = await Promise.all([
      this.prisma.payable.findMany({
        where: payableWhere,
        include: {
          branch: { select: { id: true, name: true, code: true } },
          purchaseOrders: {
            include: {
              supplierInvoices: {
                where: { deletedAt: null },
                select: { id: true, supplierInvoiceNumber: true, invoiceDate: true, status: true },
              },
            },
          },
        },
        orderBy: [{ issueDate: 'desc' }, { payableNumber: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.payable.count({ where: payableWhere }),
    ]);
    return {
      columns: [
        'payableNumber',
        'purchaseOrderNumber',
        'invoiceNumber',
        'issueDate',
        'dueDate',
        'branch',
        'currency',
        'amount',
        'paidAmount',
        'outstandingAmount',
        'status',
      ],
      rows: payables.map((payable) => {
        const orders = payable.purchaseOrders;
        const invoiceNumbers = orders.flatMap((order) =>
          this.invoiceReference(order).map((invoice) => invoice.number),
        );
        return {
          id: payable.id,
          payableNumber: payable.payableNumber,
          purchaseOrderNumber: orders.map((order) => order.purchaseOrderNumber).join(', '),
          invoiceNumber: invoiceNumbers.join(', '),
          issueDate: payable.issueDate,
          dueDate: payable.dueDate,
          branch: payable.branch?.name ?? '',
          currency: payable.currency,
          amount: toNumber(payable.amount),
          paidAmount: toNumber(payable.paidAmount),
          outstandingAmount: toNumber(payable.outstandingAmount),
          status: payable.status,
          sourceHref: `/finance/payables/${payable.id}`,
        };
      }),
      total,
      page,
      limit,
    };
  }

  private purchaseWhere(query: Supplier360ReportQueryDto): Prisma.PurchaseOrderWhereInput {
    const where: Prisma.PurchaseOrderWhereInput = {
      companyId: query.companyId,
      supplierId: query.supplierId,
      deletedAt: null,
    };
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.purchaseStatus) where.status = query.purchaseStatus as any;
    if (query.paymentStatus) where.paymentStatus = query.paymentStatus as any;
    if (query.dateFrom || query.dateTo) {
      where.orderDate = {
        ...(query.dateFrom ? { gte: dateRangeStart(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: dateRangeEnd(query.dateTo) } : {}),
      };
    }
    if (query.invoiceStatus === 'MISSING') {
      where.AND = [
        { supplierInvoiceNumber: null },
        { supplierInvoices: { none: { deletedAt: null } } },
      ];
    } else if (query.invoiceStatus === 'RECORDED') {
      where.AND = [
        { supplierInvoiceNumber: { not: null } },
        { supplierInvoices: { none: { deletedAt: null } } },
      ];
    } else if (query.invoiceStatus === 'LINKED') {
      where.supplierInvoices = { some: { deletedAt: null } };
    }
    if (query.search?.trim()) {
      const search = query.search.trim();
      where.OR = [
        { purchaseOrderNumber: { contains: search, mode: 'insensitive' } },
        { supplierInvoiceNumber: { contains: search, mode: 'insensitive' } },
        {
          supplierInvoices: {
            some: {
              deletedAt: null,
              supplierInvoiceNumber: { contains: search, mode: 'insensitive' },
            },
          },
        },
        {
          lines: {
            some: {
              product: {
                OR: [
                  { name: { contains: search, mode: 'insensitive' } },
                  { productCode: { contains: search, mode: 'insensitive' } },
                  { sku: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
      ];
    }
    return where;
  }

  private payableWhere(query: Supplier360ReportQueryDto): Prisma.PayableWhereInput {
    const where: Prisma.PayableWhereInput = {
      companyId: query.companyId,
      supplierId: query.supplierId,
      deletedAt: null,
    };
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.paymentStatus === 'PAID') {
      where.status = 'PAID';
    } else if (query.paymentStatus === 'PARTIALLY_PAID') {
      where.status = 'PARTIALLY_PAID';
    } else if (query.paymentStatus === 'UNPAID') {
      where.status = { in: ['OPEN', 'OVERDUE'] };
    }
    if (query.dateFrom || query.dateTo) {
      where.issueDate = {
        ...(query.dateFrom ? { gte: dateRangeStart(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: dateRangeEnd(query.dateTo) } : {}),
      };
    }
    if (query.search?.trim()) {
      where.OR = [
        { payableNumber: { contains: query.search.trim(), mode: 'insensitive' } },
        { supplierName: { contains: query.search.trim(), mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private invoiceReference(order: {
    supplierInvoiceNumber?: string | null;
    supplierInvoiceDate?: Date | null;
    supplierInvoices?: Array<{ supplierInvoiceNumber: string; invoiceDate: Date }>;
  }): InvoiceReference[] {
    if (order.supplierInvoices?.length) {
      return order.supplierInvoices.map((invoice) => ({
        number: invoice.supplierInvoiceNumber,
        date: invoice.invoiceDate,
        source: 'PROCUREMENT_INVOICE',
      }));
    }
    return order.supplierInvoiceNumber
      ? [
          {
            number: order.supplierInvoiceNumber,
            date: order.supplierInvoiceDate ?? null,
            source: 'PURCHASE_ORDER_REFERENCE',
          },
        ]
      : [];
  }

  private filterMetadata(query: Supplier360ReportQueryDto) {
    return {
      companyId: query.companyId,
      supplierId: query.supplierId,
      divisionId: query.divisionId ?? null,
      branchId: query.branchId ?? null,
      dateFrom: query.dateFrom ?? null,
      dateTo: query.dateTo ?? null,
      purchaseStatus: query.purchaseStatus ?? null,
      paymentStatus: query.paymentStatus ?? null,
      invoiceStatus: query.invoiceStatus ?? null,
      search: query.search ?? null,
    };
  }

  private rowsToCsv(columns: string[], rows: any[]) {
    return [
      columns.map(csvEscape).join(','),
      ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(',')),
    ].join('\n');
  }

  private addOverviewSheet(workbook: ExcelJS.Workbook, report: any) {
    const sheet = workbook.addWorksheet('Overview');
    sheet.addRow(['Supplier', report.supplier.name]);
    sheet.addRow(['Supplier Code', report.supplier.supplierCode || '']);
    sheet.addRow([
      'Period',
      `${report.filters.dateFrom || 'First record'} to ${report.filters.dateTo || 'Latest record'}`,
    ]);
    sheet.addRow([]);
    sheet.addRow(['Currency', 'Purchases', 'Total Purchased', 'Paid', 'Outstanding', 'Overdue AP']);
    for (const row of report.summary.byCurrency) {
      sheet.addRow([
        row.currency,
        row.purchaseOrderCount,
        row.totalPurchased,
        row.paidAmount,
        row.outstandingAmount,
        row.overduePayableAmount,
      ]);
    }
    sheet.getRow(5).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10233F' } };
    sheet.columns = [
      { width: 20 },
      { width: 16 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
      { width: 20 },
    ];
  }

  private addDataSheet(workbook: ExcelJS.Workbook, name: string, columns: string[], rows: any[]) {
    const sheet = workbook.addWorksheet(name.slice(0, 31));
    sheet.columns = columns.map((column) => ({
      header: this.heading(column),
      key: column,
      width: Math.min(Math.max(column.length + 5, 14), 30),
    }));
    sheet.addRows(
      rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column]]))),
    );
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10233F' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (columns.length)
      sheet.autoFilter = { from: 'A1', to: `${this.excelColumn(columns.length)}1` };
  }

  private combinedPdfRows(purchases: any[], products: any[], payables: any[]) {
    const date = (value: unknown) =>
      value ? new Date(value as any).toLocaleDateString('en-GB') : '';
    return [
      ...purchases.map((row) => [
        'Purchase',
        row.purchaseOrderNumber,
        row.invoiceNumber || 'Invoice missing',
        date(row.orderDate),
        String(row.lineCount ?? ''),
        this.money(row.totalAmount, row.currency),
        this.money(row.paidAmount, row.currency),
        this.money(row.outstandingAmount, row.currency),
        row.status,
      ]),
      ...products.map((row) => [
        'Product',
        row.productCode || row.sku || '',
        row.product,
        date(row.lastPurchaseDate),
        String(row.quantity),
        this.money(row.totalAmount, row.currency),
        '',
        '',
        `${row.purchaseCount} purchase(s)`,
      ]),
      ...payables.map((row) => [
        'Payable',
        row.payableNumber,
        row.invoiceNumber || row.purchaseOrderNumber || '',
        date(row.issueDate),
        '',
        this.money(row.amount, row.currency),
        this.money(row.paidAmount, row.currency),
        this.money(row.outstandingAmount, row.currency),
        row.status,
      ]),
    ];
  }

  private money(value: unknown, currency = 'TZS') {
    return `${currency} ${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(toNumber(value as any))}`;
  }

  private heading(value: string) {
    return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase());
  }

  private safeFileName(value: string) {
    return (
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'supplier'
    );
  }

  private excelColumn(length: number) {
    let value = length;
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }
}

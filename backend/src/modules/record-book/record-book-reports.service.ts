import { BadRequestException, Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { AccessLevel, Prisma, RecordBookStatus } from '@prisma/client';
import type { Response } from 'express';
import { AuthUser } from '../../common/decorators/current-user.decorator';
import { CompanyScopeService } from '../../common/services';
import { dateRangeEnd, dateRangeStart } from '../../common/utils/date-range';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { GeneratedDocumentsService } from '../generated-documents/generated-documents.service';
import {
  ExportRecordBookReportDto,
  QueryRecordBookReportDto,
  RECORD_BOOK_REPORT_KEYS,
  RecordBookExportAuditDto,
  RecordBookReportKey,
} from './dto/record-book.dto';

const EXPORT_LIMIT = 50_000;

const REPORT_DEFINITIONS: Record<RecordBookReportKey, { title: string; description: string }> = {
  'daily-sales': {
    title: 'Daily Sales Report',
    description: 'Day-end sales totals with their complete receipt-method split.',
  },
  'receipt-methods': {
    title: 'Sales by Receipt Method',
    description: 'Recorded sales grouped by cash, mobile money, bank, card, and other receipts.',
  },
  'expenses-by-category': {
    title: 'Expenses by Category',
    description: 'Money-out totals grouped by the independent Records Book categories.',
  },
  'expenses-by-payee': {
    title: 'Expenses by Payee',
    description: 'Money-out totals grouped by the person or organization paid.',
  },
  'net-movement': {
    title: 'Daily Net Movement',
    description: 'Recorded sales less money out for each day.',
  },
  'branch-comparison': {
    title: 'Branch Comparison',
    description: 'Recorded sales, expenses, and net movement by branch.',
  },
  'monthly-trend': {
    title: 'Monthly Sales and Expense Trend',
    description: 'Monthly movement of recorded sales, expenses, and net position.',
  },
};

type ColumnType = 'text' | 'date' | 'number' | 'currency' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  align?: 'left' | 'right';
}

export interface ReportRow extends Record<string, unknown> {
  currency: string;
  sourceIds: string[];
  sourceHref?: string;
}

interface ReportData {
  columns: ReportColumn[];
  rows: ReportRow[];
}

function toNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function csvEscape(value: unknown) {
  const text = Array.isArray(value) ? value.join(', ') : value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows: Array<Record<string, unknown>>, columns: ReportColumn[]) {
  const header = columns.map((column) => csvEscape(column.label)).join(',');
  return [
    header,
    ...rows.map((row) => columns.map((column) => csvEscape(row[column.key])).join(',')),
  ].join('\n');
}

function dateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function monthKey(value: Date) {
  return value.toISOString().slice(0, 7);
}

function normalizedLabel(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed || fallback;
}

@Injectable()
export class RecordBookReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly companyScope: CompanyScopeService,
    private readonly generatedDocuments: GeneratedDocumentsService,
  ) {}

  async run(reportKey: string, query: QueryRecordBookReportDto, user: AuthUser) {
    const key = this.assertReportKey(reportKey);
    const [sales, expenses] = await Promise.all([
      this.loadSales(query, user),
      this.loadExpenses(query, user),
    ]);
    if (sales.length + expenses.length > EXPORT_LIMIT) {
      throw new BadRequestException(
        `This report matches more than ${EXPORT_LIMIT.toLocaleString()} source records. Narrow the date or scope filters.`,
      );
    }

    const report = this.buildReport(key, sales, expenses);
    const payload = {
      key,
      title: REPORT_DEFINITIONS[key].title,
      description: REPORT_DEFINITIONS[key].description,
      reportStatus: query.reportStatus ?? query.status ?? 'FINALIZED',
      filters: {
        companyId: query.companyId ?? null,
        divisionId: query.divisionId ?? null,
        branchId: query.branchId ?? null,
        dateFrom: query.dateFrom ?? null,
        dateTo: query.dateTo ?? null,
        currency: query.currency ?? null,
        expenseCategoryId: query.expenseCategoryId ?? null,
        receiptType: query.receiptType ?? null,
        paymentMethod: query.paymentMethod ?? null,
        search: query.search ?? null,
      },
      summaryByCurrency: this.currencySummary(sales, expenses),
      columns: report.columns,
      rows: report.rows,
      rowCount: report.rows.length,
      sourceRecordCount: sales.length + expenses.length,
      generatedAt: new Date().toISOString(),
    };

    await this.auditLogs.log({
      action: 'RECORD_BOOK_REPORT_RUN',
      entityType: 'RecordBookReport',
      entityId: key,
      userId: user.id,
      companyId: query.companyId,
      newValue: {
        reportKey: key,
        rowCount: report.rows.length,
        filters: payload.filters,
      } as any,
    });

    return payload;
  }

  async export(reportKey: string, query: ExportRecordBookReportDto, user: AuthUser, res: Response) {
    const result = await this.run(reportKey, query, user);
    const format = query.format ?? 'json';
    const fileStem = `record-book-${result.key}-${new Date().toISOString().slice(0, 10)}`;
    const exportRows = result.rows.map((row) =>
      Object.fromEntries(result.columns.map((column) => [column.key, row[column.key]])),
    );

    await this.auditExport(
      {
        scope: 'report',
        reportKey: result.key,
        format,
        rowCount: exportRows.length,
        companyId: query.companyId,
        divisionId: query.divisionId,
        branchId: query.branchId,
        dateFrom: query.dateFrom,
        dateTo: query.dateTo,
      },
      user,
    );

    if (format === 'json') {
      return res.json({ success: true, data: result, timestamp: new Date().toISOString() });
    }

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${fileStem}.csv"`);
      return res.send(rowsToCsv(exportRows, result.columns));
    }

    if (format === 'pdf') {
      const pdfColumns = result.columns.filter((column) => {
        if (query.companyId && column.key === 'company') return false;
        if (query.currency && column.key === 'currency') return false;
        if (!['ACTIVE', 'ALL'].includes(result.reportStatus) && column.key === 'status') {
          return false;
        }
        return true;
      });
      const periodLabel = `${query.dateFrom || 'First record'} to ${query.dateTo || 'Latest record'}`;
      const summary = result.summaryByCurrency.flatMap((currency) => [
        {
          label: `Recorded Sales (${currency.currency})`,
          value: this.displayMoney(currency.recordedSales, currency.currency),
        },
        {
          label: `Money Out (${currency.currency})`,
          value: this.displayMoney(currency.expenses, currency.currency),
        },
        {
          label: `Net Movement (${currency.currency})`,
          value: this.displayMoney(currency.netMovement, currency.currency),
        },
        {
          label: `Source Records (${currency.currency})`,
          value: String(currency.salesCount + currency.expenseCount),
        },
      ]);
      const generated = await this.generatedDocuments.generateTablePdf(
        {
          title: result.title,
          subtitle: 'Records Book | Independent daily sales and money-out control report',
          status: result.reportStatus,
          orientation: pdfColumns.length >= 6 ? 'landscape' : 'portrait',
          companyId: query.companyId,
          columns: pdfColumns.map((column) => column.label),
          rows: result.rows.map((row) =>
            pdfColumns.map((column) => this.displayCell(row[column.key], column.type)),
          ),
          numericColumns: pdfColumns
            .map((column, index) => (column.align === 'right' ? index : -1))
            .filter((index) => index >= 0),
          columnWeights: this.pdfColumnWeights(pdfColumns),
          stripedRows: true,
          sectionTitle: 'Report Detail',
          summary,
          note: 'This document contains independent manual Records Book entries. It does not post to Accounting, Sales Orders, Inventory, Receivables, Payables, or Cash Accounts.',
          meta: [
            { label: 'Reporting Period', value: periodLabel },
            { label: 'Currency', value: query.currency || 'Separated by currency' },
            { label: 'Source records', value: String(result.sourceRecordCount) },
            { label: 'Report rows', value: String(result.rowCount) },
          ],
          baseName: `record-book-${result.key}`,
        },
        user,
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${generated.fileName}"`);
      return res.send(generated.buffer);
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'ITEMBA-R';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(result.title.slice(0, 31));
    sheet.columns = result.columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: Math.min(Math.max(column.label.length + 4, 14), 34),
    }));
    sheet.addRows(exportRows);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10233F' } };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: `${this.excelColumn(result.columns.length)}1` };
    const buffer = await workbook.xlsx.writeBuffer();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="${fileStem}.xlsx"`);
    return res.send(Buffer.from(buffer));
  }

  async auditExport(dto: RecordBookExportAuditDto, user: AuthUser) {
    if (dto.companyId) {
      await this.companyScope.assertCanAccessCompany(user, dto.companyId, AccessLevel.READ);
    }
    await this.auditLogs.log({
      action: 'RECORD_BOOK_EXPORT',
      entityType: dto.scope === 'report' ? 'RecordBookReport' : 'RecordBookExport',
      entityId: dto.reportKey ?? dto.scope,
      userId: user.id,
      companyId: dto.companyId,
      newValue: dto as any,
      severity: 'MEDIUM' as any,
    });
    return { success: true };
  }

  private buildReport(reportKey: RecordBookReportKey, sales: any[], expenses: any[]): ReportData {
    switch (reportKey) {
      case 'daily-sales':
        return this.dailySalesReport(sales);
      case 'receipt-methods':
        return this.receiptMethodsReport(sales);
      case 'expenses-by-category':
        return this.expensesByCategoryReport(expenses);
      case 'expenses-by-payee':
        return this.expensesByPayeeReport(expenses);
      case 'net-movement':
        return this.netMovementReport(sales, expenses, 'day');
      case 'branch-comparison':
        return this.branchComparisonReport(sales, expenses);
      case 'monthly-trend':
        return this.netMovementReport(sales, expenses, 'month');
    }
  }

  private dailySalesReport(sales: any[]): ReportData {
    const columns: ReportColumn[] = [
      { key: 'recordDate', label: 'Date', type: 'date' },
      { key: 'company', label: 'Company', type: 'text' },
      { key: 'division', label: 'Division', type: 'text' },
      { key: 'branch', label: 'Branch', type: 'text' },
      { key: 'totalSales', label: 'Total Sales', type: 'currency', align: 'right' },
      { key: 'cash', label: 'Cash', type: 'currency', align: 'right' },
      { key: 'mobileMoney', label: 'Mobile Money', type: 'currency', align: 'right' },
      { key: 'bank', label: 'Bank', type: 'currency', align: 'right' },
      { key: 'cardOther', label: 'Card / Other', type: 'currency', align: 'right' },
      { key: 'currency', label: 'Currency', type: 'text' },
      { key: 'status', label: 'Status', type: 'text' },
    ];
    const rows: ReportRow[] = sales.map((sale) => {
      const receipt = (type: string) =>
        sale.receipts
          .filter((row: any) => row.receiptType === type)
          .reduce((sum: number, row: any) => sum + toNumber(row.amount), 0);
      return {
        recordDate: dateKey(sale.recordDate),
        company: sale.company.name,
        division: sale.division?.name ?? '',
        branch: sale.branch?.name ?? 'All branches',
        totalSales: toNumber(sale.totalSalesAmount),
        cash: receipt('CASH'),
        mobileMoney: receipt('MPESA') + receipt('LIPA_NAMBA'),
        bank: receipt('BANK'),
        cardOther: receipt('CARD') + receipt('OTHER'),
        currency: sale.currency,
        status: sale.status,
        sourceIds: [`sale:${sale.id}`],
        sourceHref: `/record-book/daily-sales/${sale.id}`,
      };
    });
    return { columns, rows };
  }

  private receiptMethodsReport(sales: any[]): ReportData {
    const grouped = new Map<string, ReportRow & { saleIds: Set<string> }>();
    for (const sale of sales) {
      for (const receipt of sale.receipts) {
        const label = normalizedLabel(receipt.label, receipt.receiptType.replace('_', ' '));
        const key = `${sale.currency}|${receipt.receiptType}|${label.toLowerCase()}`;
        const current: ReportRow & { saleIds: Set<string> } = grouped.get(key) ?? {
          method: receipt.receiptType.replace('_', ' '),
          label,
          amount: 0,
          recordCount: 0,
          percentage: 0,
          currency: sale.currency,
          sourceIds: [] as string[],
          saleIds: new Set<string>(),
        };
        current.amount = Number(current.amount) + toNumber(receipt.amount);
        current.saleIds.add(sale.id);
        current.sourceIds.push(`sale:${sale.id}`);
        grouped.set(key, current);
      }
    }
    const totals = new Map<string, number>();
    for (const row of grouped.values()) {
      totals.set(row.currency, (totals.get(row.currency) ?? 0) + Number(row.amount));
    }
    const rows = Array.from(grouped.values()).map(({ saleIds, ...row }) => ({
      ...row,
      recordCount: saleIds.size,
      percentage: totals.get(row.currency)
        ? (Number(row.amount) / totals.get(row.currency)!) * 100
        : 0,
      sourceIds: Array.from(new Set(row.sourceIds)),
    })) as ReportRow[];
    rows.sort((a, b) => Number(b.amount) - Number(a.amount));
    return {
      columns: [
        { key: 'method', label: 'Receipt Method', type: 'text' },
        { key: 'label', label: 'Receipt Label', type: 'text' },
        { key: 'recordCount', label: 'Sales Days', type: 'number', align: 'right' },
        { key: 'amount', label: 'Amount', type: 'currency', align: 'right' },
        { key: 'percentage', label: 'Share %', type: 'percent', align: 'right' },
        { key: 'currency', label: 'Currency', type: 'text' },
      ],
      rows,
    };
  }

  private expensesByCategoryReport(expenses: any[]): ReportData {
    return this.groupExpenses(expenses, (expense) => expense.expenseCategory.name, 'Category');
  }

  private expensesByPayeeReport(expenses: any[]): ReportData {
    return this.groupExpenses(
      expenses,
      (expense) => normalizedLabel(expense.paidTo, 'Unspecified payee'),
      'Payee',
    );
  }

  private groupExpenses(
    expenses: any[],
    labelFor: (expense: any) => string,
    label: string,
  ): ReportData {
    const grouped = new Map<string, ReportRow>();
    for (const expense of expenses) {
      const group = labelFor(expense);
      const key = `${expense.currency}|${group.toLowerCase()}`;
      const current: ReportRow = grouped.get(key) ?? {
        group,
        recordCount: 0,
        amount: 0,
        averageAmount: 0,
        percentage: 0,
        currency: expense.currency,
        sourceIds: [] as string[],
      };
      current.recordCount = Number(current.recordCount) + 1;
      current.amount = Number(current.amount) + toNumber(expense.amount);
      current.sourceIds.push(`expense:${expense.id}`);
      grouped.set(key, current);
    }
    const totals = new Map<string, number>();
    for (const row of grouped.values()) {
      totals.set(row.currency, (totals.get(row.currency) ?? 0) + Number(row.amount));
    }
    const rows = Array.from(grouped.values()).map((row) => ({
      ...row,
      averageAmount: Number(row.recordCount) ? Number(row.amount) / Number(row.recordCount) : 0,
      percentage: totals.get(row.currency)
        ? (Number(row.amount) / totals.get(row.currency)!) * 100
        : 0,
    })) as ReportRow[];
    rows.sort((a, b) => Number(b.amount) - Number(a.amount));
    return {
      columns: [
        { key: 'group', label, type: 'text' },
        { key: 'recordCount', label: 'Records', type: 'number', align: 'right' },
        { key: 'amount', label: 'Total Amount', type: 'currency', align: 'right' },
        { key: 'averageAmount', label: 'Average Amount', type: 'currency', align: 'right' },
        { key: 'percentage', label: 'Share %', type: 'percent', align: 'right' },
        { key: 'currency', label: 'Currency', type: 'text' },
      ],
      rows,
    };
  }

  private netMovementReport(sales: any[], expenses: any[], grain: 'day' | 'month'): ReportData {
    const grouped = new Map<string, ReportRow>();
    const periodFor = (value: Date) => (grain === 'day' ? dateKey(value) : monthKey(value));
    for (const sale of sales) {
      const period = periodFor(sale.recordDate);
      const key = `${sale.currency}|${period}`;
      const current: ReportRow = grouped.get(key) ?? {
        period,
        sales: 0,
        expenses: 0,
        netMovement: 0,
        currency: sale.currency,
        sourceIds: [] as string[],
      };
      current.sales = Number(current.sales) + toNumber(sale.totalSalesAmount);
      current.sourceIds.push(`sale:${sale.id}`);
      grouped.set(key, current);
    }
    for (const expense of expenses) {
      const period = periodFor(expense.recordDate);
      const key = `${expense.currency}|${period}`;
      const current: ReportRow = grouped.get(key) ?? {
        period,
        sales: 0,
        expenses: 0,
        netMovement: 0,
        currency: expense.currency,
        sourceIds: [] as string[],
      };
      current.expenses = Number(current.expenses) + toNumber(expense.amount);
      current.sourceIds.push(`expense:${expense.id}`);
      grouped.set(key, current);
    }
    const rows = Array.from(grouped.values()).map((row) => ({
      ...row,
      netMovement: Number(row.sales) - Number(row.expenses),
    })) as ReportRow[];
    rows.sort((a, b) => String(a.period).localeCompare(String(b.period)));
    return {
      columns: [
        { key: 'period', label: grain === 'day' ? 'Date' : 'Month', type: 'date' },
        { key: 'sales', label: 'Recorded Sales', type: 'currency', align: 'right' },
        { key: 'expenses', label: 'Money Out', type: 'currency', align: 'right' },
        { key: 'netMovement', label: 'Net Movement', type: 'currency', align: 'right' },
        { key: 'currency', label: 'Currency', type: 'text' },
      ],
      rows,
    };
  }

  private branchComparisonReport(sales: any[], expenses: any[]): ReportData {
    const grouped = new Map<string, ReportRow>();
    const rowFor = (record: any) => {
      const branch = record.branch?.name ?? record.division?.name ?? 'All branches';
      const key = `${record.currency}|${record.companyId}|${record.branchId ?? record.divisionId ?? 'all'}`;
      const current: ReportRow = grouped.get(key) ?? {
        company: record.company.name,
        division: record.division?.name ?? '',
        branch,
        sales: 0,
        expenses: 0,
        netMovement: 0,
        currency: record.currency,
        sourceIds: [] as string[],
      };
      return { key, current };
    };
    for (const sale of sales) {
      const { key, current } = rowFor(sale);
      current.sales = Number(current.sales) + toNumber(sale.totalSalesAmount);
      current.sourceIds.push(`sale:${sale.id}`);
      grouped.set(key, current);
    }
    for (const expense of expenses) {
      const { key, current } = rowFor(expense);
      current.expenses = Number(current.expenses) + toNumber(expense.amount);
      current.sourceIds.push(`expense:${expense.id}`);
      grouped.set(key, current);
    }
    const rows = Array.from(grouped.values()).map((row) => ({
      ...row,
      netMovement: Number(row.sales) - Number(row.expenses),
    })) as ReportRow[];
    rows.sort((a, b) => Number(b.sales) - Number(a.sales));
    return {
      columns: [
        { key: 'company', label: 'Company', type: 'text' },
        { key: 'division', label: 'Division', type: 'text' },
        { key: 'branch', label: 'Branch', type: 'text' },
        { key: 'sales', label: 'Recorded Sales', type: 'currency', align: 'right' },
        { key: 'expenses', label: 'Money Out', type: 'currency', align: 'right' },
        { key: 'netMovement', label: 'Net Movement', type: 'currency', align: 'right' },
        { key: 'currency', label: 'Currency', type: 'text' },
      ],
      rows,
    };
  }

  private currencySummary(sales: any[], expenses: any[]) {
    const grouped = new Map<
      string,
      {
        currency: string;
        recordedSales: number;
        expenses: number;
        netMovement: number;
        salesCount: number;
        expenseCount: number;
      }
    >();
    for (const sale of sales) {
      const current = grouped.get(sale.currency) ?? {
        currency: sale.currency,
        recordedSales: 0,
        expenses: 0,
        netMovement: 0,
        salesCount: 0,
        expenseCount: 0,
      };
      current.recordedSales += toNumber(sale.totalSalesAmount);
      current.salesCount += 1;
      grouped.set(sale.currency, current);
    }
    for (const expense of expenses) {
      const current = grouped.get(expense.currency) ?? {
        currency: expense.currency,
        recordedSales: 0,
        expenses: 0,
        netMovement: 0,
        salesCount: 0,
        expenseCount: 0,
      };
      current.expenses += toNumber(expense.amount);
      current.expenseCount += 1;
      grouped.set(expense.currency, current);
    }
    return Array.from(grouped.values()).map((row) => ({
      ...row,
      netMovement: row.recordedSales - row.expenses,
    }));
  }

  private async loadSales(query: QueryRecordBookReportDto, user: AuthUser) {
    const where: Prisma.RecordBookDailySaleWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
      status: this.statusFilter(query),
    };
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.currency) where.currency = query.currency;
    if (query.receiptType) where.receipts = { some: { receiptType: query.receiptType } };
    if (query.dateFrom || query.dateTo) {
      where.recordDate = {};
      if (query.dateFrom) where.recordDate.gte = dateRangeStart(query.dateFrom);
      if (query.dateTo) where.recordDate.lte = dateRangeEnd(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { notes: { contains: query.search, mode: 'insensitive' } },
        { receipts: { some: { label: { contains: query.search, mode: 'insensitive' } } } },
        { receipts: { some: { reference: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }
    return this.prisma.recordBookDailySale.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        receipts: query.receiptType ? { where: { receiptType: query.receiptType } } : true,
      },
      orderBy: [{ recordDate: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_LIMIT + 1,
    });
  }

  private async loadExpenses(query: QueryRecordBookReportDto, user: AuthUser) {
    const where: Prisma.RecordBookExpenseWhereInput = {
      deletedAt: null,
      ...(await this.companyScope.companyWhereFor(user, query.companyId)),
      status: this.statusFilter(query),
    };
    if (query.divisionId) where.divisionId = query.divisionId;
    if (query.branchId) where.branchId = query.branchId;
    if (query.currency) where.currency = query.currency;
    if (query.expenseCategoryId) where.expenseCategoryId = query.expenseCategoryId;
    if (query.paymentMethod) where.paymentMethod = query.paymentMethod;
    if (query.dateFrom || query.dateTo) {
      where.recordDate = {};
      if (query.dateFrom) where.recordDate.gte = dateRangeStart(query.dateFrom);
      if (query.dateTo) where.recordDate.lte = dateRangeEnd(query.dateTo);
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { paidTo: { contains: query.search, mode: 'insensitive' } },
        { paymentLabel: { contains: query.search, mode: 'insensitive' } },
        { reference: { contains: query.search, mode: 'insensitive' } },
        { notes: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.recordBookExpense.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, code: true } },
        division: { select: { id: true, name: true, code: true } },
        branch: { select: { id: true, name: true, code: true } },
        expenseCategory: { select: { id: true, name: true } },
      },
      orderBy: [{ recordDate: 'asc' }, { createdAt: 'asc' }],
      take: EXPORT_LIMIT + 1,
    });
  }

  private statusFilter(query: QueryRecordBookReportDto) {
    if (query.status) return query.status;
    switch (query.reportStatus ?? 'FINALIZED') {
      case 'DRAFT':
        return RecordBookStatus.DRAFT;
      case 'VOIDED':
        return RecordBookStatus.VOIDED;
      case 'ACTIVE':
        return { in: [RecordBookStatus.DRAFT, RecordBookStatus.FINALIZED] };
      case 'ALL':
        return undefined;
      default:
        return RecordBookStatus.FINALIZED;
    }
  }

  private assertReportKey(value: string): RecordBookReportKey {
    if (!RECORD_BOOK_REPORT_KEYS.includes(value as RecordBookReportKey)) {
      throw new BadRequestException('Unknown Records Book report');
    }
    return value as RecordBookReportKey;
  }

  private excelColumn(count: number) {
    let value = count;
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result || 'A';
  }

  private displayCell(value: unknown, type: ColumnType) {
    if (type === 'currency') {
      return Number(value ?? 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
    if (type === 'percent') return `${Number(value ?? 0).toFixed(2)}%`;
    if (type === 'number') return Number(value ?? 0).toLocaleString();
    return value == null || value === '' ? '-' : String(value);
  }

  private displayMoney(value: number, currency: string) {
    return `${currency} ${Number(value ?? 0).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }

  private pdfColumnWeights(columns: ReportColumn[]) {
    return columns.map((column) => {
      if (column.key === 'company') return 1.8;
      if (column.key === 'division' || column.key === 'branch') return 1.5;
      if (column.key === 'group' || column.key === 'label') return 1.7;
      if (column.key === 'currency') return 0.7;
      if (column.key === 'status') return 0.9;
      if (column.type === 'date') return 1;
      if (column.type === 'currency') return 1.25;
      if (column.type === 'number' || column.type === 'percent') return 0.85;
      return 1.15;
    });
  }
}

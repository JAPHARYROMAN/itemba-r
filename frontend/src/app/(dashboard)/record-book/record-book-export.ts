import type { TablePdfRequest } from '@/lib/export-download';

export type RecordBookExportType = 'sales' | 'expenses' | 'combined';

export interface RecordBookPdfContext {
  companyId?: string;
  companyName?: string;
  divisionId?: string;
  divisionName?: string;
  branchId?: string;
  branchName?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
}

type RawRow = Record<string, unknown>;

interface Column<Row> {
  label: string;
  weight: number;
  numeric?: boolean;
  value: (row: Row) => string;
}

const INDEPENDENCE_NOTE =
  'This document contains independent manual Records Book entries. It does not post to Accounting, Sales Orders, Inventory, Receivables, Payables, or Cash Accounts.';

function text(value: unknown, fallback = '') {
  const result = String(value ?? '').trim();
  return result || fallback;
}

function amount(value: unknown) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function displayAmount(value: number) {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayDate(value: unknown) {
  const source = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(source);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : source || '-';
}

function displayMethod(value: unknown) {
  return text(value, '-').replaceAll('_', ' ');
}

function period(context: RecordBookPdfContext) {
  return `${context.dateFrom ? displayDate(context.dateFrom) : 'First record'} to ${
    context.dateTo ? displayDate(context.dateTo) : 'Latest record'
  }`;
}

function scope(context: RecordBookPdfContext) {
  const division = context.divisionName || 'All divisions';
  const branch = context.branchName || 'All branches';
  return `${division} / ${branch}`;
}

function common(
  title: string,
  baseName: string,
  context: RecordBookPdfContext,
  rowCount: number,
): Pick<
  TablePdfRequest,
  | 'title'
  | 'subtitle'
  | 'status'
  | 'orientation'
  | 'companyId'
  | 'meta'
  | 'stripedRows'
  | 'sectionTitle'
  | 'note'
  | 'baseName'
> {
  return {
    title,
    subtitle: 'Records Book | Independent manual control register',
    status: context.status || 'ACTIVE RECORDS',
    orientation: 'landscape',
    companyId: context.companyId,
    meta: [
      { label: 'Reporting Period', value: period(context) },
      { label: 'Company', value: context.companyName || 'All accessible companies' },
      { label: 'Scope', value: scope(context) },
      { label: 'Source Rows', value: rowCount.toLocaleString() },
    ],
    stripedRows: true,
    sectionTitle: 'Record Detail',
    note: INDEPENDENCE_NOTE,
    baseName,
  };
}

function table<Row>(columns: Column<Row>[], rows: Row[]) {
  return {
    columns: columns.map((column) => column.label),
    rows: rows.map((row) => columns.map((column) => column.value(row))),
    columnWeights: columns.map((column) => column.weight),
    numericColumns: columns
      .map((column, index) => (column.numeric ? index : -1))
      .filter((index) => index >= 0),
  };
}

interface DailySalesRow {
  recordDate: string;
  company: string;
  division: string;
  branch: string;
  currency: string;
  status: string;
  totalSales: number;
  cash: number;
  mpesa: number;
  lipaNamba: number;
  bank: number;
  cardOther: number;
}

function buildSales(rows: RawRow[], context: RecordBookPdfContext): TablePdfRequest {
  const grouped = new Map<string, DailySalesRow>();
  for (const row of rows) {
    const recordDate = text(row.recordDate);
    const company = text(row.company, 'Unspecified company');
    const division = text(row.division);
    const branch = text(row.branch);
    const currency = text(row.currency, 'TZS');
    const status = text(row.status, 'ACTIVE');
    const totalSales = amount(row.totalSalesAmount);
    const key = [recordDate, company, division, branch, currency, status, totalSales].join('|');
    const current = grouped.get(key) ?? {
      recordDate,
      company,
      division,
      branch,
      currency,
      status,
      totalSales,
      cash: 0,
      mpesa: 0,
      lipaNamba: 0,
      bank: 0,
      cardOther: 0,
    };
    const receiptAmount = amount(row.receiptAmount);
    switch (text(row.receiptType).toUpperCase()) {
      case 'CASH':
        current.cash += receiptAmount;
        break;
      case 'MPESA':
        current.mpesa += receiptAmount;
        break;
      case 'LIPA_NAMBA':
        current.lipaNamba += receiptAmount;
        break;
      case 'BANK':
        current.bank += receiptAmount;
        break;
      default:
        current.cardOther += receiptAmount;
    }
    grouped.set(key, current);
  }

  const records = Array.from(grouped.values()).sort((a, b) =>
    b.recordDate.localeCompare(a.recordDate),
  );
  const currencies = new Set(records.map((row) => row.currency));
  const columns: Column<DailySalesRow>[] = [
    { label: 'Date', weight: 0.9, value: (row) => displayDate(row.recordDate) },
  ];
  if (!context.companyId) {
    columns.push({ label: 'Company', weight: 1.6, value: (row) => row.company });
  }
  if (!context.divisionId) {
    columns.push({ label: 'Division', weight: 1.45, value: (row) => row.division || '-' });
  }
  if (!context.branchId) {
    columns.push({ label: 'Branch', weight: 1.35, value: (row) => row.branch || '-' });
  }
  columns.push(
    {
      label: 'Total Sales',
      weight: 1.25,
      numeric: true,
      value: (row) => displayAmount(row.totalSales),
    },
    { label: 'Cash', weight: 1.15, numeric: true, value: (row) => displayAmount(row.cash) },
    { label: 'M-Pesa', weight: 1.15, numeric: true, value: (row) => displayAmount(row.mpesa) },
    {
      label: 'Lipa Namba',
      weight: 1.15,
      numeric: true,
      value: (row) => displayAmount(row.lipaNamba),
    },
    { label: 'Bank', weight: 1.15, numeric: true, value: (row) => displayAmount(row.bank) },
    {
      label: 'Card / Other',
      weight: 1.15,
      numeric: true,
      value: (row) => displayAmount(row.cardOther),
    },
  );
  if (currencies.size > 1) {
    columns.push({ label: 'Currency', weight: 0.7, value: (row) => row.currency });
  }
  if (!context.status) {
    columns.push({ label: 'Status', weight: 0.85, value: (row) => row.status });
  }

  const totals = new Map<string, { sales: number; days: number }>();
  for (const row of records) {
    const current = totals.get(row.currency) ?? { sales: 0, days: 0 };
    current.sales += row.totalSales;
    current.days += 1;
    totals.set(row.currency, current);
  }
  const summary = Array.from(totals.entries()).flatMap(([currency, total]) => [
    { label: `Recorded Sales (${currency})`, value: `${currency} ${displayAmount(total.sales)}` },
    { label: `Recorded Days (${currency})`, value: total.days.toLocaleString() },
  ]);

  return {
    ...common('Records Book - Daily Sales', 'record-book-sales', context, records.length),
    ...table(columns, records),
    summary,
  };
}

function buildExpenses(rows: RawRow[], context: RecordBookPdfContext): TablePdfRequest {
  const currencies = new Set(rows.map((row) => text(row.currency, 'TZS')));
  const columns: Column<RawRow>[] = [
    { label: 'Date', weight: 0.9, value: (row) => displayDate(row.recordDate) },
  ];
  if (!context.companyId) {
    columns.push({ label: 'Company', weight: 1.5, value: (row) => text(row.company, '-') });
  }
  if (!context.divisionId) {
    columns.push({ label: 'Division', weight: 1.3, value: (row) => text(row.division, '-') });
  }
  if (!context.branchId) {
    columns.push({ label: 'Branch', weight: 1.2, value: (row) => text(row.branch, '-') });
  }
  columns.push(
    { label: 'Category', weight: 1.2, value: (row) => text(row.category, '-') },
    { label: 'Description', weight: 2, value: (row) => text(row.description, '-') },
    { label: 'Paid To', weight: 1.35, value: (row) => text(row.paidTo, '-') },
    {
      label: 'Amount',
      weight: 1.2,
      numeric: true,
      value: (row) => displayAmount(amount(row.amount)),
    },
    { label: 'Method', weight: 1, value: (row) => displayMethod(row.paymentMethod) },
    { label: 'Reference', weight: 1.2, value: (row) => text(row.reference, '-') },
  );
  if (currencies.size > 1) {
    columns.push({ label: 'Currency', weight: 0.7, value: (row) => text(row.currency, 'TZS') });
  }
  if (!context.status) {
    columns.push({ label: 'Status', weight: 0.85, value: (row) => text(row.status, '-') });
  }

  const totals = new Map<string, { amount: number; count: number }>();
  for (const row of rows) {
    const currency = text(row.currency, 'TZS');
    const current = totals.get(currency) ?? { amount: 0, count: 0 };
    current.amount += amount(row.amount);
    current.count += 1;
    totals.set(currency, current);
  }
  const summary = Array.from(totals.entries()).flatMap(([currency, total]) => [
    { label: `Money Out (${currency})`, value: `${currency} ${displayAmount(total.amount)}` },
    { label: `Expense Records (${currency})`, value: total.count.toLocaleString() },
  ]);

  return {
    ...common('Records Book - Money Out', 'record-book-expenses', context, rows.length),
    ...table(columns, rows),
    summary,
  };
}

interface MovementRow {
  recordDate: string;
  recordType: string;
  scope: string;
  description: string;
  method: string;
  moneyIn: number;
  moneyOut: number;
  currency: string;
  reference: string;
}

function buildCombined(rows: RawRow[], context: RecordBookPdfContext): TablePdfRequest {
  const records: MovementRow[] = rows.map((row) => {
    const isSale = text(row.recordType) === 'SALE_RECEIPT';
    const branch = text(row.branch);
    const division = text(row.division);
    const scopeLabel = branch || division || 'All branches';
    const receiptLabel = text(row.receiptLabel, displayMethod(row.receiptType));
    const expenseDescription = [text(row.category), text(row.description), text(row.paidTo)]
      .filter(Boolean)
      .join(' - ');
    return {
      recordDate: text(row.recordDate),
      recordType: isSale ? 'Money In' : 'Money Out',
      scope: scopeLabel,
      description: isSale ? `${receiptLabel} sales receipt` : expenseDescription || 'Expense',
      method: displayMethod(isSale ? row.receiptType : row.paymentMethod),
      moneyIn: amount(row.moneyIn),
      moneyOut: amount(row.moneyOut),
      currency: text(row.currency, 'TZS'),
      reference: text(row.reference, '-'),
    };
  });
  const currencies = new Set(records.map((row) => row.currency));
  const columns: Column<MovementRow>[] = [
    { label: 'Date', weight: 0.9, value: (row) => displayDate(row.recordDate) },
    { label: 'Type', weight: 0.8, value: (row) => row.recordType },
    { label: 'Scope', weight: 1.25, value: (row) => row.scope },
    { label: 'Description / Payee', weight: 2.2, value: (row) => row.description },
    { label: 'Method', weight: 1, value: (row) => row.method },
    {
      label: 'Money In',
      weight: 1.2,
      numeric: true,
      value: (row) => displayAmount(row.moneyIn),
    },
    {
      label: 'Money Out',
      weight: 1.2,
      numeric: true,
      value: (row) => displayAmount(row.moneyOut),
    },
  ];
  if (currencies.size > 1) {
    columns.push({ label: 'Currency', weight: 0.7, value: (row) => row.currency });
  }
  columns.push({ label: 'Reference', weight: 1.15, value: (row) => row.reference });

  const totals = new Map<string, { moneyIn: number; moneyOut: number }>();
  for (const row of records) {
    const current = totals.get(row.currency) ?? { moneyIn: 0, moneyOut: 0 };
    current.moneyIn += row.moneyIn;
    current.moneyOut += row.moneyOut;
    totals.set(row.currency, current);
  }
  const summary = Array.from(totals.entries())
    .flatMap(([currency, total]) => [
      { label: `Money In (${currency})`, value: `${currency} ${displayAmount(total.moneyIn)}` },
      { label: `Money Out (${currency})`, value: `${currency} ${displayAmount(total.moneyOut)}` },
      {
        label: `Net Movement (${currency})`,
        value: `${currency} ${displayAmount(total.moneyIn - total.moneyOut)}`,
      },
    ])
    .slice(0, 16);

  return {
    ...common('Records Book - Money Movement', 'record-book-combined', context, records.length),
    ...table(columns, records),
    summary,
  };
}

export function buildRecordBookPdfRequest(
  type: RecordBookExportType,
  rows: RawRow[],
  context: RecordBookPdfContext,
): TablePdfRequest {
  if (type === 'sales') return buildSales(rows, context);
  if (type === 'expenses') return buildExpenses(rows, context);
  return buildCombined(rows, context);
}

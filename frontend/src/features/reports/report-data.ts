import { backendGet } from '@/lib/api-client';
import { toCsv } from '@/lib/report-export';
import { dateLabel, money, type Invoice } from '@/features/invoice-desk/types';
import type { Sale } from '@/features/sales-desk/types';
import {
  expenseCategories,
  movementLabels,
  type Movement,
  type Loan,
} from '@/features/cash-desk/types';
import type { ReportDefinition } from './report-definitions';

export type Balance = {
  id: string;
  name: string;
  currency: string;
  outstanding: string;
  count: number;
};
export type ReportRow = Sale | Invoice | Movement | Loan | Balance;
export type Totals = {
  currency: string;
  total?: string;
  paid: string;
  outstanding?: string;
  overdue?: string;
  reversed?: string;
  count: number;
  categories?: Record<string, string>;
};
export type ReportResponse = {
  rows?: ReportRow[];
  total?: number;
  pageSize?: number;
  currencies?: Totals[];
  customers?: Balance[];
  suppliers?: Balance[];
};
export type ReportColumn = { title: string; value: (row: ReportRow) => string; numeric?: boolean };
const col = (title: string, value: (r: ReportRow) => string, numeric = false): ReportColumn => ({
  title,
  value,
  numeric,
});
export function reportColumns(mode: ReportDefinition['mode']): ReportColumn[] {
  if (mode === 'customers' || mode === 'suppliers')
    return [
      col(mode === 'customers' ? 'Customer' : 'Supplier', (r) => (r as Balance).name),
      col('Currency', (r) => r.currency),
      col('Open invoices', (r) => String((r as Balance).count), true),
      col('Outstanding', (r) => (r as Balance).outstanding, true),
    ];
  if (mode === 'sales' || mode === 'purchases')
    return [
      col('Reference', (r) =>
        mode === 'sales' ? (r as Sale).saleNumber : (r as Invoice).invoiceNumber,
      ),
      col(mode === 'sales' ? 'Customer' : 'Supplier', (r) =>
        mode === 'sales' ? (r as Sale).customer.name : (r as Invoice).supplier.name,
      ),
      col('Date', (r) =>
        dateLabel(mode === 'sales' ? (r as Sale).saleDate : (r as Invoice).invoiceDate),
      ),
      col('Company', (r) => (r as Sale).company.name),
      col('Division', (r) => (r as Sale).division.name),
      col('Branch', (r) => (r as Sale).branch.name),
      col('Currency', (r) => r.currency),
      col('Amount', (r) => (r as Sale).totalAmount, true),
      col('Paid to date', (r) => (r as Sale).paidAmount, true),
      col('Outstanding', (r) => (r as Sale).outstanding, true),
      col('Due date', (r) => dateLabel((r as Sale).dueDate)),
      col('Status', (r) => (r as Sale).status),
    ];
  if (mode === 'loans')
    return [
      col('Lender', (r) => `${(r as Loan).lender.company.name} · ${(r as Loan).lender.name}`),
      col('Borrower', (r) => `${(r as Loan).borrower.company.name} · ${(r as Loan).borrower.name}`),
      col('Date', (r) => dateLabel((r as Loan).loanDate)),
      col('Due date', (r) => ((r as Loan).dueDate ? dateLabel((r as Loan).dueDate!) : '—')),
      col('Currency', (r) => r.currency),
      col('Principal', (r) => (r as Loan).principal, true),
      col('Outstanding', (r) => (r as Loan).outstanding, true),
      col('Status', (r) => ((r as Loan).voidedAt ? 'Reversed' : 'Recorded')),
    ];
  return [
    col('Date', (r) => dateLabel((r as Movement).businessDate)),
    col('Description', (r) => (r as Movement).description),
    ...(mode === 'expenses'
      ? [
          col(
            'Category',
            (r) => expenseCategories[(r as Movement).expenseCategory ?? ''] ?? 'Uncategorised',
          ),
          col('Payee', (r) => (r as Movement).payee ?? '—'),
        ]
      : [col('Movement', (r) => movementLabels[(r as Movement).kind] ?? (r as Movement).kind)]),
    col('Accounts', (r) =>
      (r as Movement).entries
        .map((e) => `${e.account.company.name} · ${e.account.name}: ${money(e.amount, r.currency)}`)
        .join('; '),
    ),
    col('Reference', (r) => (r as Movement).reference),
    col('Currency', (r) => r.currency),
    col('Amount', (r) => (r as Movement).amount, true),
    col('Status', (r) =>
      (r as Movement).reversedAt
        ? 'Reversed'
        : (r as Movement).reversalOfId
          ? 'Reversal entry'
          : 'Recorded',
    ),
  ];
}
export function reportRows(report: ReportDefinition, data: ReportResponse): ReportRow[] {
  return report.mode === 'customers'
    ? (data.customers ?? [])
    : report.mode === 'suppliers'
      ? (data.suppliers ?? [])
      : (data.rows ?? []);
}
// Treat every textual cell as untrusted input when opened by spreadsheet software.
export function reportCsv(columns: ReportColumn[], rows: ReportRow[]) {
  const safe = (v: string) => (/^[\s]*[=+\-@]/.test(v) || /^[\t\r\n]/.test(v) ? `'${v}` : v);
  return (
    '\uFEFF' +
    toCsv(
      columns.map((c) => c.title),
      rows.map((r) => columns.map((c) => safe(c.value(r)))),
    )
  );
}
export async function allReportRows(
  report: ReportDefinition,
  query: Record<string, string | number>,
  signal: AbortSignal,
): Promise<ReportRow[]> {
  const rows: ReportRow[] = [];
  let expected: number | undefined;
  for (let page = 1; ; page++) {
    const data = await backendGet<ReportResponse>(report.path, {
      query: { ...query, page },
      signal,
    });
    if (report.mode === 'customers' || report.mode === 'suppliers') {
      const balances = reportRows(report, data);
      if (balances.length > 10000)
        throw new Error('This report exceeds 10,000 rows. Narrow the filters before exporting.');
      return balances;
    }
    const batch = data.rows ?? [];
    if (expected === undefined) expected = data.total ?? batch.length;
    if (expected > 10000)
      throw new Error('This report exceeds 10,000 rows. Narrow the filters before exporting.');
    if (data.total !== expected)
      throw new Error('Records changed during export. Refresh the report and try again.');
    rows.push(...batch);
    if (rows.length >= expected) {
      if (rows.length !== expected || new Set(rows.map((r) => r.id)).size !== rows.length)
        throw new Error('Records changed during export. Refresh and try again.');
      return rows;
    }
    if (!batch.length)
      throw new Error('The complete report could not be loaded. Please try again.');
  }
}

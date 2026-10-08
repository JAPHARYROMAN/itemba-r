import { formatAccountMoney } from './account-consolidation';

interface FinancialDocument {
  status: string;
  lifecycleStatus?: string;
  outstandingAmount: number | string;
  paidAmount?: number | string | null;
  dueDate?: string | null;
  canDelete?: boolean;
}

const OPEN_STATUSES = new Set(['OPEN', 'PARTIALLY_PAID', 'OVERDUE']);

export function financialLifecycleStatus(document: FinancialDocument): string {
  return document.lifecycleStatus ?? document.status;
}

export function canSettleFinancialDocument(document: FinancialDocument): boolean {
  return (
    OPEN_STATUSES.has(financialLifecycleStatus(document)) && Number(document.outstandingAmount) > 0
  );
}

/** Due dates are calendar dates: a document due today becomes overdue tomorrow. */
export function isFinancialDocumentOverdue(
  document: FinancialDocument,
  asOf = new Date(),
): boolean {
  if (!canSettleFinancialDocument(document) || !document.dueDate) return false;
  const due = new Date(document.dueDate);
  if (!Number.isFinite(due.getTime())) return false;
  return due.toISOString().slice(0, 10) < asOf.toISOString().slice(0, 10);
}

export function financialDocumentStatus(document: FinancialDocument): string {
  const lifecycle = financialLifecycleStatus(document);
  if (isFinancialDocumentOverdue(document)) return 'OVERDUE';
  // An old stored OVERDUE marker must not mark an undated/future document overdue.
  if (lifecycle === 'OVERDUE') {
    if (Number(document.outstandingAmount) <= 0) return 'PAID';
    if (document.status === 'PARTIALLY_PAID' || Number(document.paidAmount) > 0) {
      return 'PARTIALLY_PAID';
    }
    return 'OPEN';
  }
  return lifecycle;
}

export function financialAgingBucket(dueDate?: string | null, asOf = new Date()): string {
  if (!dueDate) return '—';
  const due = new Date(dueDate);
  if (!Number.isFinite(due.getTime())) return '—';
  const today = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate());
  const day = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const days = (today - day) / 86400000;
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return '90+ days';
}

/** The server evaluates journal posting, allocations, settlement and source links. */
export function canDeleteFinancialDocument(document: FinancialDocument): boolean {
  return document.canDelete === true;
}

export interface CurrencySummary {
  currency: string;
  totalAmount: number | string;
  outstandingAmount?: number | string;
  paidAmount?: number | string;
  overdueAmount?: number | string;
  unbilledAmount?: number | string;
}

export function currencySummaryValues(
  rows: CurrencySummary[],
  field: keyof Omit<CurrencySummary, 'currency'>,
): Array<{ currency: string; amount: number | string }> {
  return rows.map((row) => ({ currency: row.currency, amount: row[field] ?? 0 }));
}

export function sumFinancialAmounts(values: Array<number | string>): string {
  let cents = 0n;
  for (const value of values) {
    const text = typeof value === 'number' ? value.toFixed(2) : value;
    const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
    if (!match) throw new Error('Invalid monetary amount in the financial register.');
    const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
    cents += match[1] ? -amount : amount;
  }
  const absolute = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}

export function formatFinancialTotals(
  rows: Array<{ currency: string; amount: number | string }>,
): string {
  const groups = new Map<string, Array<number | string>>();
  for (const row of rows) {
    const values = groups.get(row.currency) ?? [];
    values.push(row.amount);
    groups.set(row.currency, values);
  }
  return (
    [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, values]) => formatAccountMoney(sumFinancialAmounts(values), currency))
      .join(' · ') || '—'
  );
}

export function accountingCoverageLabel(value?: string): string {
  return (
    {
      UNBILLED: 'Received · no posted payable',
      POSTED: 'Posted payable',
      UNPOSTED: 'Order commitment',
      INACTIVE: 'Inactive',
      CONFLICT: 'Requires account review',
    }[value ?? ''] ?? 'Coverage unavailable'
  );
}

export function settlementLabel(record: {
  paymentStatus: string;
  settlementStatus?: string;
}): string {
  return record.settlementStatus ?? record.paymentStatus;
}

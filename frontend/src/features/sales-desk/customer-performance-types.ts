import { performanceToday } from './customer-performance-dates';

export function performanceDefaultDates(today = performanceToday()) {
  const from = new Date(`${today}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - 89);
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: today };
}
export type PerformanceCategory =
  | 'best'
  | 'good'
  | 'needs-attention'
  | 'insufficient-history'
  | 'inactive';
export const performanceCategories: Record<PerformanceCategory, string> = {
  best: 'Best',
  good: 'Good',
  'needs-attention': 'Needs attention',
  'insufficient-history': 'Insufficient history',
  inactive: 'Inactive',
};
export type PerformanceFilters = {
  companyId: string;
  divisionId: string;
  branchId: string;
  currency: string;
  dateFrom: string;
  dateTo: string;
  search: string;
  category: string;
  sort: string;
};
export type PerformanceAccess = { sales: boolean; balances: boolean; receipts: boolean };
export type CustomerPerformanceRow = {
  id: string;
  companyId: string;
  code: string | null;
  name: string;
  category: PerformanceCategory;
  reasons: string[];
  salesRank: number | null;
  netSales: string;
  previousNetSales: string;
  salesCount: number;
  collected: string | null;
  receiptBasis: 'actual-receipts' | 'scoped-settlements' | null;
  lastPaymentDate: string | null;
  outstanding: string | null;
  overdue: string | null;
  customerCredit: string | null;
  netDue: string | null;
  oldestDaysOverdue: number | null;
  onTimePercent: number | null;
  eligibleInvoiceCount: number | null;
  missingDueDateCount: number | null;
  paymentLabel:
    | 'reliable'
    | 'needs-attention'
    | 'paid-at-sale'
    | 'insufficient-history'
    | 'restricted';
};
export type CustomerPerformance = {
  period: { dateFrom: string; dateTo: string; previousFrom: string; previousTo: string };
  asOf: string;
  reliabilityAsOf: string;
  currency: string;
  receiptBasis: 'actual-receipts' | 'scoped-settlements' | null;
  access: PerformanceAccess;
  rules: {
    minimumDueInvoices: number;
    bestOnTimePercent: number;
    goodOnTimePercent: number;
    topSalesPercent: number;
    salesBasis: string;
  };
  summary: {
    customers: number;
    best: number;
    good: number;
    needsAttention: number;
    insufficientHistory: number;
    inactive: number;
    netSales: string;
    collected: string | null;
    outstanding: string | null;
    overdue: string | null;
    customerCredit: string | null;
    netDue: string | null;
  };
  warnings?: string[];
  rows: CustomerPerformanceRow[];
  total: number;
  page: number;
  limit: number;
};
export type CustomerPaymentHistory = {
  customer: { id: string; name: string; code: string | null; companyId: string };
  performance: CustomerPerformanceRow;
  asOf: string;
  reliabilityAsOf: string;
  access: PerformanceAccess;
  currency: string;
  period: { dateFrom: string; dateTo: string };
  warnings?: string[];
  rows: {
    id: string;
    date: string;
    reference: string;
    source: string;
    sourceType?: string;
    sourceUrl?: string | null;
    method: string | null;
    amount: string;
    appliedAmount: string;
    unappliedAmount: string;
    status: string;
    reversedAt?: string | null;
    reversalAmount?: string | null;
    reversalReason?: string | null;
    allocations: {
      reference: string;
      amount: string;
      dueDate: string | null;
      receivableId?: string;
      date?: string;
    }[];
  }[];
  total: number;
  page: number;
  limit: number;
};
const groupedWhole = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
/** Preserve every cent in backend decimal strings, including amounts above JS safe integers. */
export function performanceMoney(amount: string | number | null | undefined, currency: string) {
  if (amount == null || (typeof amount === 'number' && !Number.isFinite(amount)))
    return 'Unavailable';
  const parsed = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(String(amount).trim());
  if (!parsed) return 'Unavailable';
  const fraction = parsed[3] ?? '';
  let minor = BigInt(parsed[2]) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'));
  if (fraction.length > 2 && fraction[2] >= '5') minor += 1n;
  const sign = parsed[1] === '-' && minor !== 0n ? '-' : '';
  return `${currency} ${sign}${groupedWhole.format(minor / 100n)}.${(minor % 100n).toString().padStart(2, '0')}`;
}
export const paymentLabels: Record<CustomerPerformanceRow['paymentLabel'], string> = {
  reliable: 'Reliable payer',
  'needs-attention': 'Payment needs attention',
  'paid-at-sale': 'Paid at sale · credit history unproven',
  'insufficient-history': 'Insufficient credit history',
  restricted: 'Payment access required',
};
export const paymentSourceLabel = (source: string) =>
  ({
    CustomerPayment: 'Customer payment',
    JournalEntry: 'Receivable settlement',
    SalesOrder: 'Sale receipt',
  })[source] ?? source;

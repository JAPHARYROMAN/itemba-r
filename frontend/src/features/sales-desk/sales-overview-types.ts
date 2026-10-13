export type OverviewSale = {
  id: string;
  reference: string;
  date: string;
  customerId: string | null;
  customer: string;
  branch: string;
  status: string;
  paymentStatus: string;
  amount: string;
  outstanding: string | null;
};
export type OverviewRanking = { id: string; name: string; amount: string; count: number };
export type SalesOverview = {
  currency: string;
  period: { dateFrom: string; dateTo: string; previousFrom: string; previousTo: string };
  asOf: string;
  access: { balances: boolean; receipts: boolean; customers: boolean };
  receiptBasis?: 'actual-receipts' | 'scoped-settlements';
  warnings?: string[];
  metrics: {
    salesValue: string;
    salesCount: number;
    averageSale: string;
    collected: string | null;
    outstanding: string | null;
    overdue: string | null;
    previousSalesValue: string;
    previousSalesCount: number;
    previousAverageSale: string;
    previousCollected: string | null;
    purchasingCustomers: number | null;
    newCustomers: number | null;
  };
  trend: { date: string; dateTo: string; sales: string; collected: string | null }[];
  aging: { label: string; amount: string }[];
  salesMix: { label: string; amount: string; count: number }[];
  paymentMethods: { label: string; amount: string }[];
  topCustomers: OverviewRanking[];
  branches: OverviewRanking[];
  salespeople: OverviewRanking[];
  topProducts: { id: string; name: string; unit: string; quantity: string; amount: string }[];
  attention: {
    drafts: number;
    overdue: number | null;
    dueSoon: number | null;
    unappliedPayments: number | null;
    draftSales: OverviewSale[];
    overdueSales: (OverviewSale & { dueDate: string | null })[];
    dueSoonSales: (OverviewSale & { dueDate: string | null })[];
  };
  recentSales: OverviewSale[];
  recentReceipts: {
    id: string;
    reference: string;
    date: string;
    amount: string;
    method: string;
    saleId: string;
  }[];
};
export const overviewMoney = (value: string | number | null, currency: string) =>
  value === null
    ? '—'
    : `${currency} ${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(Number(value))}`;
export const overviewDate = (value: string, includeYear = false) =>
  new Date(`${value.slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'Africa/Nairobi',
  });
export const overviewToday = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
export function overviewDates(preset: string, today = overviewToday()) {
  const date = new Date(`${today}T00:00:00Z`);
  if (preset === 'today') return { dateFrom: today, dateTo: today };
  if (preset === 'week') date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  else date.setUTCDate(1);
  return { dateFrom: date.toISOString().slice(0, 10), dateTo: today };
}
export function overviewChange(current: string | number, previous: string | number) {
  const before = Number(previous),
    after = Number(current);
  if (!before) return after ? 'No previous-period activity' : 'No change';
  const change = ((after - before) / before) * 100;
  return `${change > 0 ? '+' : ''}${change.toLocaleString('en-GB', { maximumFractionDigits: 1 })}% vs previous period`;
}

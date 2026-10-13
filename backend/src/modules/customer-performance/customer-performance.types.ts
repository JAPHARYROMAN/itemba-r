import { PerformanceCategory } from './customer-performance.dto';

export interface CustomerPerformanceRow {
  id: string;
  companyId: string;
  code: string;
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
}

export interface CustomerPaymentHistoryRow {
  id: string;
  date: string;
  reference: string;
  source: string;
  sourceType: string;
  sourceUrl?: string;
  method: string;
  amount: string;
  appliedAmount: string;
  unappliedAmount: string;
  status: string;
  reversedAt: string | null;
  reversalAmount: string | null;
  allocations: {
    receivableId: string;
    reference: string;
    amount: string;
    dueDate: string | null;
  }[];
}

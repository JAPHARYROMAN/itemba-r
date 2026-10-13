import { Prisma } from '@prisma/client';
import type { SettlementHistory } from '../../common/utils/settlement-history';

/** A single ledger movement on a customer statement. */
export type StatementLineType = 'INVOICE' | 'PAYMENT' | 'CREDIT_NOTE' | 'REFUND' | 'ADJUSTMENT';

/**
 * Sign convention (customer AR ledger, i.e. what the customer OWES us):
 *   debit  increases the balance (invoices raised, cash refunded to customer)
 *   credit decreases the balance (payments received, credit notes issued)
 * Exactly one of debit/credit is non-zero per line.
 */
export interface StatementLine {
  date: Date;
  type: StatementLineType;
  reference: string;
  description: string;
  sourceId: string;
  sourceType?: string;
  sourceUrl?: string;
  receivableId?: string;
  salesOrderId?: string;
  reversalOfId?: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** Running balance AFTER this line is applied. Filled in during assembly. */
  balance: Prisma.Decimal;
}

export interface StatementAging {
  current: number | string;
  days1_30: number | string;
  days31_60: number | string;
  days61_90: number | string;
  over90: number | string;
  total: number | string;
  oldestDaysOverdue: number;
}

export interface CustomerStatement {
  runId?: string;
  statementRunNumber?: string;
  company?: {
    id: string;
    name: string;
    code: string;
    address?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  customer?: {
    id: string;
    name: string;
    customerCode: string;
    email: string | null;
    phone: string | null;
    address: string | null;
  };
  scope?: {
    companyId?: string;
    divisionId?: string;
    branchId?: string;
    divisionIds: string[];
    branchIds: string[];
    unrestricted: boolean;
  };
  warnings?: string[];
  integrityIssues?: string[];
  settlementHistory?: SettlementHistory;
  openInvoiceBalance?: Prisma.Decimal;
  customerCredit?: Prisma.Decimal;
  netBalance?: Prisma.Decimal;
  companyId: string;
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  currency: string;
  dateFrom: Date;
  dateTo: Date;
  openingBalance: Prisma.Decimal;
  totalDebits: Prisma.Decimal;
  totalCredits: Prisma.Decimal;
  closingBalance: Prisma.Decimal;
  lineCount: number;
  lines: StatementLine[];
  aging: StatementAging;
  /** Aging reconstructs invoice allocations and adjustments as of dateTo. */
  agingAsOf: Date;
  generatedAt: Date;
}

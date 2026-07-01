import { Prisma } from '@prisma/client';

/** A single ledger movement on a customer statement. */
export type StatementLineType =
  | 'INVOICE'
  | 'PAYMENT'
  | 'CREDIT_NOTE'
  | 'REFUND'
  | 'ADJUSTMENT';

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
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  /** Running balance AFTER this line is applied. Filled in during assembly. */
  balance: Prisma.Decimal;
}

export interface StatementAging {
  current: number;
  days1_30: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
  oldestDaysOverdue: number;
}

export interface CustomerStatement {
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
  /**
   * As-of date the {@link aging} summary was computed at. This is a LIVE
   * snapshot (today), NOT `dateTo`: it is derived from each receivable's
   * current `outstandingAmount`, which already reflects payments / credit
   * notes applied AFTER `dateTo`. For a backdated statement (dateTo in the
   * past) the aging therefore does NOT tie out to `closingBalance` — it
   * describes what the customer owes right now, by age band.
   */
  agingAsOf: Date;
  generatedAt: Date;
}

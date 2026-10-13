import { CurrencyCode, Prisma } from '@prisma/client';
import { StatementAging, StatementLineType } from './statement.types';
import type { SettlementHistory } from '../../common/utils/settlement-history';

export interface CustomerAccountQuery {
  companyId?: string;
  divisionId?: string;
  branchId?: string;
  currency?: CurrencyCode;
  dateTo: string;
  customerIds?: string[];
}
export interface CustomerAccountMovement {
  date: Date;
  type: StatementLineType;
  reference: string;
  description: string;
  sourceId: string;
  sourceType: string;
  sourceUrl: string;
  debit: Prisma.Decimal;
  credit: Prisma.Decimal;
  receivableId?: string;
  salesOrderId?: string;
  reversalOfId?: string;
}
export interface CustomerAccountAllocation {
  receivableId: string;
  amount: Prisma.Decimal;
  issueDate: Date;
  dueDate: Date | null;
  /** Receipts cannot settle an invoice before the allocation was recorded. */
  date: Date;
}
export interface CustomerAccountPayment {
  id: string;
  date: Date;
  reference: string;
  method: string;
  amount: Prisma.Decimal;
  appliedAmount: Prisma.Decimal;
  unappliedAmount: Prisma.Decimal;
  status: string;
  reversedAt: Date | null;
  sourceType: string;
  sourceUrl: string;
  allocations: CustomerAccountAllocation[];
}
export interface CustomerAccountObligation {
  id: string;
  issueDate: Date;
  dueDate: Date | null;
  amount: Prisma.Decimal;
  outstanding: Prisma.Decimal;
  salesOrderId?: string;
  payments: Array<{
    date: Date;
    amount: Prisma.Decimal;
    paymentId: string;
    reversedAt: Date | null;
  }>;
}
export interface CustomerAccountSnapshot {
  customer: {
    id: string;
    companyId: string;
    name: string;
    customerCode: string;
    email: string | null;
    phone: string | null;
    address: string | null;
    createdAt: Date;
    company: {
      id: string;
      name: string;
      code: string;
      address?: string | null;
      email?: string | null;
      phone?: string | null;
    };
  };
  sales: Array<{
    id: string;
    date: Date;
    totalAmount: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    status: string;
    paymentMethod: string;
    sourceUrl: string;
  }>;
  movements: CustomerAccountMovement[];
  obligations: CustomerAccountObligation[];
  payments: CustomerAccountPayment[];
  aging: StatementAging;
  openInvoiceBalance: Prisma.Decimal;
  customerCredit: Prisma.Decimal;
  netBalance: Prisma.Decimal;
  warnings: string[];
  integrityIssues?: string[];
  settlementHistory?: SettlementHistory;
}
export interface CustomerAccountProjection {
  asOf: Date;
  currency: CurrencyCode;
  scope: {
    companyId?: string;
    divisionId?: string;
    branchId?: string;
    divisionIds: string[];
    branchIds: string[];
    unrestricted: boolean;
  };
  accounts: CustomerAccountSnapshot[];
  warnings: string[];
}

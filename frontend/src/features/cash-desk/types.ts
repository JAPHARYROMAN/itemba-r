export { money, dateLabel, localToday } from '../invoice-desk/types';
export type { Directory, Scope, Invoice, Overview as InvoiceOverview } from '../invoice-desk/types';
export type Account = {
  id: string;
  name: string;
  companyId: string;
  divisionId: string;
  branchId: string;
  currency: string;
  kind: string;
  balance: string;
  openingDate: string;
  company: { name: string };
  division: { name: string };
  branch: { name: string };
  // Party linkage (Phase 3 PR-8): the connected ERP cash account and its stored mirror.
  erpCashAccountId?: string | null;
  erpCashAccount?: {
    id: string;
    accountName: string;
    currentBalance: string | number;
    currency: string;
  } | null;
};
/** Exact cents from a decimal string of any length (no thousands separators). */
function cents(value: string | number): bigint {
  const text = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(text);
  if (!match) throw new Error(`Not a decimal amount: ${text}`);
  const [, sign, whole, fraction = ''] = match;
  const units = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign ? -units : units;
}
function fromCents(units: bigint): string {
  const absolute = units < 0n ? -units : units;
  const text = `${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
  return units < 0n ? `-${text}` : text;
}
/** The ERP mirror beside a desk balance, exact to the cent: a difference is a finding. */
export function erpMirror(account: Account) {
  const erp = account.erpCashAccount;
  if (!erp) return null;
  try {
    const mirror = cents(erp.currentBalance ?? '0');
    const difference = mirror - cents(account.balance);
    return {
      name: erp.accountName,
      mirror: fromCents(mirror),
      difference: fromCents(difference),
      inStep: difference === 0n,
    };
  } catch {
    return {
      name: erp.accountName,
      mirror: String(erp.currentBalance),
      difference: '?',
      inStep: false,
    };
  }
}
export type Movement = {
  journalEntryId?: string | null;
  journalEntry?: { id: string; journalNumber: string } | null;
  fuelReportPostingId?: string | null;
  payrollRunId?: string | null;
  loanFinancialEvent?: { loanId: string; id: string } | null;
  salesPaymentId?: string | null;
  expenseCategory?: string | null;
  payee?: string | null;
  expenseNotes?: string | null;
  id: string;
  kind: string;
  amount: string;
  currency: string;
  businessDate: string;
  description: string;
  reference: string;
  actorName: string;
  createdAt: string;
  reversedAt: string | null;
  reversalReason: string | null;
  reversalOfId: string | null;
  invoicePaymentId: string | null;
  // Party linkage (Phase 2): who the money went to or came from, and what it settled.
  partyType?: string | null;
  supplierId?: string | null;
  customerId?: string | null;
  supplier?: { id: string; name: string } | null;
  customer?: { id: string; name: string } | null;
  payable?: {
    id: string;
    payableNumber: string;
    supplierInvoices?: {
      id: string;
      supplierInvoiceNumber: string;
      purchaseOrder?: { id: string; purchaseOrderNumber: string } | null;
      goodsReceivedNote?: { id: string; grnNumber: string } | null;
    }[];
    purchaseOrders?: { id: string; purchaseOrderNumber: string }[];
  } | null;
  receivable?: { id: string; receivableNumber: string } | null;
  expense?: { id: string; expenseNumber: string } | null;
  refund?: { id: string; refundNumber: string } | null;
  supplierPayment?: {
    unappliedAmount?: string;
    appliedAmount?: string;
    purchaseAdvance?: {
      purchaseOrder: {
        id: string;
        purchaseOrderNumber: string;
        internalInvoiceNumber?: string | null;
        supplierInvoiceNumber?: string | null;
      };
    } | null;
    id: string;
    paymentNumber: string;
    sourceType?: string | null;
    sourceId?: string | null;
  } | null;
  customerPayment?: { id: string; paymentNumber: string } | null;
  invoicePayment?: { id: string; invoiceId: string; invoice: { invoiceNumber: string } } | null;
  salesPayment?: { id: string; saleId: string; sale: { saleNumber: string } } | null;
  entries: {
    id: string;
    amount: string;
    account: Pick<Account, 'id' | 'name' | 'company' | 'companyId' | 'currency'>;
  }[];
};
export const expenseCategories: Record<string, string> = {
  RENT: 'Rent & premises',
  UTILITIES: 'Utilities',
  TRANSPORT: 'Travel & transport',
  FUEL: 'Fuel',
  MEALS: 'Meals & refreshments',
  OFFICE: 'Office & supplies',
  MAINTENANCE: 'Repairs & maintenance',
  STAFF: 'Staff costs',
  FEES: 'Bank & professional fees',
  TAXES: 'Taxes & licences',
  OTHER: 'Other expenses',
};
export type ExpenseReport = Page<Movement> & {
  currencies: {
    currency: string;
    paid: string;
    reversed: string;
    count: number;
    categories: Record<string, string>;
  }[];
};
export type Loan = {
  id: string;
  currency: string;
  principal: string;
  outstanding: string;
  loanDate: string;
  dueDate: string | null;
  description: string;
  voidedAt: string | null;
  lender: Pick<Account, 'id' | 'name' | 'company' | 'companyId' | 'currency'>;
  borrower: Pick<Account, 'id' | 'name' | 'company' | 'companyId' | 'currency'>;
};
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };
export type CashOverview = {
  date: string;
  currencies: { currency: string; balance: string; sales: string; accounts: number }[];
};
export const movementLabels: Record<string, string> = {
  PAYROLL_PAYMENT: 'Payroll payment',
  SALE_RECEIPT: 'Sales Desk receipt',
  DAILY_SALES: 'Daily sales',
  OTHER_IN: 'Other money in',
  EXPENSE: 'Expense',
  TRANSFER: 'Account transfer',
  LOAN: 'Intercompany loan',
  LOAN_REPAYMENT: 'Loan repayment',
  SUPPLIER_PAYMENT: 'Purchases',
  CUSTOMER_RECEIPT: 'Customer collection',
  REFUND: 'Customer refund',
  OPENING: 'Opening balance',
  REVERSAL: 'Reversal',
  BORROWING: 'Borrowing received',
  DEBT_REPAYMENT: 'External loan repayment',
};
export const partyTypeLabels: Record<string, string> = {
  SUPPLIER: 'Suppliers',
  CUSTOMER: 'Customers',
  EMPLOYEE: 'Employees',
  COMPANY: 'Group companies',
  NONE: 'No counterparty',
};
export type Editor = {
  draftId?: string;
  needsReview?: boolean;
  kind: 'account' | 'movement' | 'reverse';
  movementKind?: string;
  movement?: Movement;
  invoice?: import('../invoice-desk/types').Invoice;
  loan?: Loan;
};
export type PurchaseOption = {
  purpose?: 'CASH_PURCHASE_SETTLEMENT' | 'SUPPLIER_ADVANCE';
  source: 'PAYABLE' | 'INVOICE_DESK' | 'PURCHASE_ORDER';
  id: string;
  number: string;
  supplierId: string;
  supplierName: string;
  currency: string;
  outstanding: string;
  version?: number;
  status: string;
  canPay: boolean;
  businessDate?: string;
  purchaseInvoiceId?: string;
  purchaseInvoiceNumber?: string;
  purchaseOrderId?: string;
  purchaseOrderNumber?: string;
  internalInvoiceNumber?: string | null;
  supplierInvoiceNumber?: string | null;
  goodsReceivedNoteId?: string;
  goodsReceivedNoteNumber?: string;
  payableNumber?: string;
};
export type PurchaseOptions = Page<PurchaseOption> & {
  totalPages: number;
  orderMatches?: {
    id: string;
    purchaseOrderNumber: string;
    internalInvoiceNumber?: string | null;
    supplierInvoiceNumber?: string | null;
    status: string;
    paymentStatus: string;
    purchaseType: string;
  }[];
};
export function exactAmount(value: string): bigint | null {
  if (!/^\d{1,16}(?:\.\d{1,2})?$/.test(value)) return null;
  return cents(value);
}
export function purchaseSnapshot(value: PurchaseOption) {
  return JSON.stringify([
    value.source,
    value.id,
    value.outstanding,
    value.version ?? null,
    value.status,
    value.canPay ?? null,
  ]);
}

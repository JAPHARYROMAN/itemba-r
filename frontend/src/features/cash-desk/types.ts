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
};
export type Movement = {
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
  SUPPLIER_PAYMENT: 'Supplier payment',
  OPENING: 'Opening balance',
  REVERSAL: 'Reversal',
  BORROWING: 'Borrowing received',
  DEBT_REPAYMENT: 'External loan repayment',
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

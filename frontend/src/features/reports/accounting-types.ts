export type InvoiceSource = {
  id: string;
  kind: 'sales' | 'purchases';
  reference: string;
  date: string;
  currency: string;
  amount: string;
  status: string;
  fingerprint: string;
  journalId: string | null;
};
export type InvoiceReview = {
  source: InvoiceSource;
  fingerprint: string;
  status: string;
  blocked: string | null;
  journals: { id: string; number: string; status: string }[];
  accounts: { id: string; accountCode: string; accountName: string; accountType: string }[];
};

export type Scope = { companyId: string; divisionId: string | null; branchId: string | null };
export type Ledger = Scope & {
  id: string;
  accountName: string;
  accountCode: string;
  accountType: string;
  ledgerBalance?: string;
};
export type Bank = Scope & {
  canConnect?: boolean;
  recordedBalance?: string;
  balanceDifference: string | null;
  ledgerBalance: string | null;
  id: string;
  accountName: string;
  currency: string;
  ledgerAccountId: string | null;
  ledgerAccount: Ledger | null;
};
export type Desk = Scope & {
  canConnect: boolean;
  id: string;
  name: string;
  currency: string;
  erpCashAccountId: string | null;
  company: { name: string };
  branch: { name: string };
};
export type Connections = { desk: Desk[]; bank: Bank[]; ledger: Ledger[] };
export type Movement = {
  id: string;
  kind: string;
  date: string;
  description: string;
  reference: string;
  amount: string;
  currency: string;
  status: string;
  entries: { name: string; amount: string }[];
};
export type CashReview = {
  source: Movement;
  fingerprint: string;
  issues: string[];
  offsetId: string | null;
  accounts: Ledger[];
  journals: { id: string; number: string; status: string }[];
  cashAccounts: { id?: string; name?: string; amount: string }[];
};
export const compatible = (a: Scope, b: Scope) =>
  a.companyId === b.companyId &&
  (!a.divisionId || a.divisionId === b.divisionId) &&
  (!a.branchId || a.branchId === b.branchId);
export const movementLabel = (kind: string) =>
  ({
    DAILY_SALES: 'Daily cash sales',
    OTHER_IN: 'Other receipt',
    OPENING: 'Opening balance',
    SUPPLIER_PAYMENT: 'Supplier payment',
    SALE_RECEIPT: 'Customer receipt',
    EXPENSE: 'Expense',
    TRANSFER: 'Transfer',
    REVERSAL: 'Reversal',
    LOAN: 'Loan',
    LOAN_REPAYMENT: 'Loan repayment',
    BORROWING: 'Borrowing received',
    DEBT_REPAYMENT: 'External loan repayment',
  })[kind] || kind;

export type UnlinkedPayment = {
  id: string;
  amount: string;
  paymentDate: string;
  reference: string;
  invoice: Scope & {
    id: string;
    invoiceNumber: string;
    currency: string;
    supplier: { name: string };
  };
};
export type AccountingTarget =
  | import('./accounting-controls-types').ControlTarget
  | import('./report-viewer-types').SavedViewTarget
  | import('./reconciliation-types').ReconciliationTarget
  | { kind: 'invoice-posting'; id: string; sourceKind: 'sales' | 'purchases' }
  | { kind: 'cash-posting'; id: string }
  | {
      kind: 'account-connection';
      id: string;
      accountKind: 'desk' | 'bank';
      query: Record<string, string>;
    }
  | { kind: 'payment-link'; id: string; query: Record<string, string> };

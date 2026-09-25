export const registers = [
  {
    id: 'debtors',
    kind: 'DEBTOR',
    label: 'Debtors',
    singular: 'debtor',
    description: 'Money owed to you',
    colour: 'teal',
  },
  {
    id: 'creditors',
    kind: 'CREDITOR',
    label: 'Creditors',
    singular: 'creditor',
    description: 'Money you owe',
    colour: 'amber',
  },
  {
    id: 'sales',
    kind: 'SALE',
    label: 'Sales',
    singular: 'sale',
    description: 'What you sold',
    colour: 'blue',
  },
  {
    id: 'purchases',
    kind: 'PURCHASE',
    label: 'Purchases',
    singular: 'purchase',
    description: 'What you bought',
    colour: 'violet',
  },
  {
    id: 'expenses',
    kind: 'EXPENSE',
    label: 'Expenses',
    singular: 'expense',
    description: 'What you spent',
    colour: 'rose',
  },
  {
    id: 'notes',
    kind: 'NOTE',
    label: 'Notes',
    singular: 'note',
    description: 'Anything worth keeping',
    colour: 'slate',
  },
] as const;
export type RecordKind = (typeof registers)[number]['kind'];
export type Section = 'overview' | (typeof registers)[number]['id'];
export type Scope = { companyId: string; divisionId: string; branchId: string };
export type Directory = {
  companies: { id: string; name: string }[];
  divisions: { id: string; name: string; companyId: string }[];
  branches: { id: string; name: string; divisionId: string }[];
};
export type Entry = {
  id: string;
  kind: RecordKind;
  title: string;
  counterparty: string | null;
  contact: string | null;
  reference: string | null;
  category: string | null;
  notes: string | null;
  companyId: string | null;
  divisionId: string | null;
  branchId: string | null;
  company?: { name: string } | null;
  division?: { name: string } | null;
  branch?: { name: string } | null;
  currency: string;
  amount: string;
  settledAmount: string;
  balance: string;
  status: string;
  recordDate: string;
  lastActivityDate?: string;
  dueDate: string | null;
  version: number;
  voidedAt: string | null;
  voidReason: string | null;
  settlements?: {
    id: string;
    amount: string;
    date: string;
    reference: string | null;
    notes: string | null;
    reversedAt: string | null;
    reversalReason: string | null;
  }[];
  events?: { id: string; actorName: string; action: string; detail: string; createdAt: string }[];
};
export type Summary = {
  kind: RecordKind;
  currency: string;
  count: number;
  amount: string;
  balance: string;
};
export type Editor = {
  mode: 'create' | 'edit' | 'settle' | 'reverse' | 'void';
  kind: RecordKind;
  entry?: Entry;
  settlementId?: string;
};
export const isDebt = (kind: string) => kind === 'DEBTOR' || kind === 'CREDITOR';
export const money = (value: string, currency: string) =>
  `${currency} ${Number(value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateLabel = (date: string | null) =>
  date
    ? new Date(date).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '—';
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const emptyScope: Scope = { companyId: '', divisionId: '', branchId: '' };
export const emptyDirectory: Directory = { companies: [], divisions: [], branches: [] };
export function paymentRemaining(balance: string, amount: string): string | null {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(amount)) return null;
  const cents = (value: string) => {
    const [whole, fraction = ''] = value.split('.');
    return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  };
  const paid = cents(amount),
    owed = cents(balance);
  return paid > 0 && paid <= owed ? ((owed - paid) / 100).toFixed(2) : null;
}

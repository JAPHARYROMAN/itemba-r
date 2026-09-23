export type Choice = { id: string; name: string; companyId?: string; divisionId?: string };
export type Directory = { companies: Choice[]; divisions: Choice[]; branches: Choice[] };
export type Scope = { companyId: string; divisionId: string; branchId: string };
export type Supplier = Choice & { email?: string | null; phone?: string | null };
export type Invoice = Scope & {
  id: string;
  supplierId: string;
  invoiceNumber: string;
  description: string;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  totalAmount: string;
  paidAmount: string;
  outstanding: string;
  status: string;
  version: number;
  notes?: string | null;
  voidedAt: string | null;
  company: { name: string };
  division: { name: string };
  branch: { name: string };
  supplier: Supplier;
  payments?: {
    id: string;
    amount: string;
    paymentDate: string;
    method: string;
    reference: string;
    reversedAt: string | null;
    reversalReason: string | null;
    cashMovement?: { id: string } | null;
  }[];
  attachments?: { id: string; name: string; size: number }[];
  events?: { id: string; actorName: string; action: string; detail: string; createdAt: string }[];
};
export type Overview = {
  currencies: {
    currency: string;
    total: string;
    paid: string;
    outstanding: string;
    overdue: string;
    due: string;
    count: number;
  }[];
  suppliers: { id: string; name: string; currency: string; outstanding: string; count: number }[];
};
export const dateLabel = (value: string) =>
  new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(value));
// Format decimal strings without converting large financial amounts to floating point.
export function money(value: string, currency = '') {
  const [whole, fraction = ''] = value.split('.');
  return `${currency ? `${currency} ` : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`;
}
export const localToday = () => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
};

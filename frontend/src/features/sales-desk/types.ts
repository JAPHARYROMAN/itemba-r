export { money, dateLabel, localToday } from '../invoice-desk/types';
export type { Directory, Scope } from '../invoice-desk/types';
export type Customer = {
  id: string;
  companyId: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  company?: { name: string };
};
export type Sale = {
  id: string;
  companyId: string;
  divisionId: string;
  branchId: string;
  customerId: string;
  saleNumber: string;
  saleDate: string;
  dueDate: string;
  currency: string;
  totalAmount: string;
  paidAmount: string;
  outstanding: string;
  status: string;
  version: number;
  voidedAt: string | null;
  notes?: string | null;
  customer: Customer;
  company: { name: string };
  division: { name: string };
  branch: { name: string };
  lines?: {
    id: string;
    description: string;
    quantity: string;
    unitPrice: string;
    totalAmount: string;
  }[];
  payments?: {
    id: string;
    amount: string;
    paymentDate: string;
    reference: string;
    reversedAt: string | null;
    cashMovement?: { id: string } | null;
  }[];
  events?: { id: string; actorName: string; action: string; detail: string; createdAt: string }[];
};
export type Summary = {
  currencies: {
    currency: string;
    total: string;
    paid: string;
    outstanding: string;
    overdue: string;
    count: number;
  }[];
  customers: { id: string; name: string; currency: string; outstanding: string; count: number }[];
};
export type Page<T> = { rows: T[]; total: number; page: number; pageSize: number };
export type Editor = {
  draftId?: string;
  needsReview?: boolean;
  kind: 'sale' | 'customer' | 'payment' | 'void';
  sale?: Sale;
};
// Same per-line half-up rounding as the server, without binary floating-point amounts.
export function lineTotal(quantity: string, price: string): string | null {
  if (!/^\d{1,9}(\.\d{1,3})?$/.test(quantity) || !/^\d{1,16}(\.\d{1,2})?$/.test(price)) return null;
  const scaled = (v: string, digits: number) => {
    const [w, f = ''] = v.split('.');
    return BigInt(w) * 10n ** BigInt(digits) + BigInt(f.padEnd(digits, '0'));
  };
  const q = scaled(quantity, 3),
    p = scaled(price, 2);
  if (q <= 0n || p <= 0n) return null;
  const cents = (q * p + 500n) / 1000n;
  if (cents <= 0n || cents >= 1000000000000000000n) return null;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export function saleTotal(lines: { quantity: string; unitPrice: string }[]): string | null {
  let cents = 0n;
  for (const line of lines) {
    const v = lineTotal(line.quantity, line.unitPrice);
    if (v === null) return null;
    cents += BigInt(v.replace('.', ''));
  }
  if (cents >= 1000000000000000000n) return null;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}

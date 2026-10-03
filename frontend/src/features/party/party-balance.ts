/**
 * The party balance resolver's shapes (party linkage, Phase 2). Every surface that shows
 * what a supplier or customer owes reads one of these from `/party-balance/*`; no screen
 * adds up documents on its own, and the cached `currentBalance` is never shown as a balance.
 */
export type MoneyByCurrency = { currency: string; amount: string };

export type PartyBalanceSummary = {
  kind: 'supplier' | 'customer';
  partyId: string;
  companyId: string;
  name: string;
  code: string;
  baseCurrency: string;
  /** ERP sub-ledger: open payables (supplier) or receivables (customer). */
  erp: { currency: string; open: string; overdue: string; documents: number }[];
  /** Desk ledger: unpromoted Invoice Desk invoices or Sales Desk sales. */
  desk: { currency: string; outstanding: string; overdue: string; documents: number }[];
  /** NoteBook creditor / debtor records linked to the party. Informal; never in `total`. */
  notebook: { currency: string; outstanding: string; records: number }[];
  /** erp + desk per currency. */
  total: MoneyByCurrency[];
  overdue: MoneyByCurrency[];
  creditLimit: string;
  creditAvailable: string | null;
  cached: string;
  lastPaymentAt: string | null;
};

export const partyProfileHref = (kind: 'supplier' | 'customer', id: string) =>
  kind === 'supplier'
    ? `/invoice-desk/suppliers/${encodeURIComponent(id)}`
    : `/sales-desk/customers/${encodeURIComponent(id)}`;

/** The per-party resolver (`/party-balance/suppliers/:id`, `/customers/:id`), with aging. */
export type PartyBalance = {
  kind: 'supplier' | 'customer';
  partyId: string;
  companyId: string;
  asOf: string;
  baseCurrency: string;
  erp: {
    currency: string;
    open: string;
    overdue: string;
    current: string;
    days1to30: string;
    days31to60: string;
    days61to90: string;
    over90: string;
    documents: number;
  }[];
  desk: { currency: string; outstanding: string; overdue: string; documents: number }[];
  notebook: { currency: string; outstanding: string; records: number }[];
  total: MoneyByCurrency[];
  creditLimit: string;
  creditAvailable: string | null;
  cached: string;
  lastPaymentAt: string | null;
};

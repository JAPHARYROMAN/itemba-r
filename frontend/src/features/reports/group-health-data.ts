import type { Analysis, AnalysisRow, AnalysisTable } from './analysis-types';
export type Financing = {
  source: string;
  period: { from: string; to: string };
  generatedAt: string;
  basis: string;
  currencies: {
    currency: string;
    principal?: string | null;
    overdue?: string;
    due7?: string;
    due30?: string;
    due90?: string;
    receivable?: string;
    payable?: string;
    eliminated?: string;
  }[];
  tables: AnalysisTable[];
};
export const cents = (value: string | number) => {
  const s = String(value),
    negative = s.startsWith('-'),
    [whole, fraction = ''] = s.replace('-', '').split('.');
  return (
    (BigInt(whole || 0) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2))) *
    (negative ? -1n : 1n)
  );
};
export const decimal = (value: bigint) =>
  `${value < 0n ? '-' : ''}${(value < 0n ? -value : value) / 100n}.${String((value < 0n ? -value : value) % 100n).padStart(2, '0')}`;
export function commitments(
  purchases: Analysis | null,
  loans: Financing | null,
  internal: Financing | null,
  currency: string,
  asOf: string,
): AnalysisTable {
  const end = new Date(new Date(asOf).getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const rows: AnalysisRow[] = [];
  for (const r of purchases?.tables.find((t) => t.id === 'overdue')?.rows ?? [])
    if (r.currency === currency && String(r.dueDate) <= end)
      rows.push({
        id: `supplier:${r.id}`,
        kind: 'Supplier invoice',
        reference: r.reference,
        party: r.party,
        dueDate: r.dueDate,
        currency,
        amount: r.outstanding,
        href: '/reports?view=suppliers&tab=overdue',
      });
  for (const r of loans?.tables.find((t) => t.id === 'commitments')?.rows ?? [])
    if (r.currency === currency && r.treatment === 'External borrowing')
      rows.push({ ...r, id: `loan:${r.id}`, kind: 'Loan instalment', party: r.lender });
  for (const r of internal?.tables.find((t) => t.id === 'internal')?.rows ?? [])
    if (
      r.currency === currency &&
      r.dueDate &&
      String(r.dueDate) <= end &&
      cents(r.payable) > 0n &&
      cents(r.eliminated) === 0n
    )
      rows.push({
        id: `internal:${r.id}`,
        kind: 'Intercompany repayment',
        reference: r.description || 'Intercompany loan',
        party: r.lender,
        dueDate: r.dueDate,
        currency,
        amount: r.payable,
        href: '/cash-desk',
      });
  return {
    id: 'health-commitments',
    title: 'Known payments due',
    columns: [
      { key: 'dueDate', label: 'Due date' },
      { key: 'kind', label: 'Type' },
      { key: 'party', label: 'Payee' },
      { key: 'reference', label: 'Reference' },
      { key: 'currency', label: 'Currency' },
      { key: 'amount', label: 'Remaining amount', money: true },
    ],
    rows: rows.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))),
  };
}
export function dueThrough(rows: AnalysisRow[], asOf: string, days: number) {
  const end = new Date(new Date(asOf).getTime() + days * 86400000).toISOString().slice(0, 10);
  return rows.filter((r) => String(r.dueDate) <= end).reduce((n, r) => n + cents(r.amount), 0n);
}

import type { StatementRow } from './statement-csv';

export type ReconciliationLine = Omit<StatementRow, 'debitAmount' | 'creditAmount'> & {
  id: string;
  debitAmount: string | number;
  creditAmount: string | number;
  balance?: string | number | null;
  matched: boolean;
  matchedTransactionId?: string | null;
};
export type Reconciliation = {
  id: string;
  reconciliationNumber: string;
  companyId: string;
  cashAccountId: string;
  currency: string;
  status: string;
  updatedAt?: string;
  statementStartDate: string;
  statementEndDate: string;
  statementOpeningBalance: string | number;
  statementClosingBalance: string | number;
  bookOpeningBalance: string | number;
  bookClosingBalance: string | number;
  reconciledBalance: string | number;
  differenceAmount: string | number;
  statementLines?: ReconciliationLine[];
  matches?: { id: string; bankStatementLineId: string; matchedEntityId: string }[];
};
export type ReconciliationEvidence = {
  ready: boolean;
  issues: string[];
  calculatedClose: string;
  note?: string;
};
export type CompanyChoice = { id: string; name: string };
export type CashAccountChoice = {
  id: string;
  companyId: string;
  accountName: string;
  currency: string;
  isActive?: boolean;
};
export type MatchingResult = {
  summary: { totalLines: number; autoMatched: number; ambiguous: number; stillUnmatched: number };
  perLine: {
    lineId: string;
    suggestions?: { entityId: string; description: string; amount: number; date: string }[];
  }[];
};
export const reconciliationActions = {
  'run-matching': {
    label: 'Review automatic matching',
    submit: 'Run matching',
    permission: 'bank_reconciliations.update',
    status: 'DRAFT',
    effect:
      'Match exact amounts within three days. The matching engine saves confident matches and offers candidates when the result is ambiguous.',
  },
  match: {
    label: 'Review selected match',
    submit: 'Match selected entry',
    permission: 'bank_reconciliations.update',
    status: 'DRAFT',
    effect:
      'Link this statement line to the selected journal entry. The journal must still be eligible and unused.',
  },
  unmatch: {
    label: 'Review match removal',
    submit: 'Remove match',
    permission: 'bank_reconciliations.update',
    status: 'DRAFT',
    effect:
      'Remove this statement line’s journal match. The statement line and journal remain in their registers.',
  },
  approve: {
    label: 'Review reconciliation approval',
    submit: 'Approve reconciliation',
    permission: 'bank_reconciliations.approve',
    status: 'DRAFT',
    effect:
      'Approve after statement totals and journal matches agree. The preparer cannot approve their own reconciliation.',
  },
  close: {
    label: 'Review reconciliation closure',
    submit: 'Close reconciliation',
    permission: 'bank_reconciliations.close',
    status: 'APPROVED',
    effect:
      'Close this approved reconciliation after checking statement totals and journal matches again.',
  },
} as const;
export type ReconciliationAction = keyof typeof reconciliationActions;
export type ReconciliationTarget =
  | { kind: 'reconciliation-create'; companyId?: string }
  | { kind: 'reconciliation-import'; id: string }
  | { kind: 'reconciliation-line'; id: string }
  | {
      kind: 'reconciliation-action';
      id: string;
      action: ReconciliationAction;
      lineId?: string;
      journalEntryLineId?: string;
      candidateLabel?: string;
    };
export function reconciliationVersion(row: Reconciliation) {
  return JSON.stringify([
    row.id,
    row.updatedAt,
    row.status,
    row.companyId,
    row.cashAccountId,
    row.currency,
    row.statementStartDate,
    row.statementEndDate,
    row.statementOpeningBalance,
    row.statementClosingBalance,
    row.bookOpeningBalance,
    row.bookClosingBalance,
    row.statementLines?.map((line) => [
      line.id,
      line.transactionDate,
      line.description,
      line.reference,
      line.debitAmount,
      line.creditAmount,
      line.matched,
      line.matchedTransactionId,
    ]),
    row.matches,
  ]);
}
export function validStatementDate(value: string) {
  const date = new Date(value);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
  );
}
/** Four-place integer arithmetic keeps import previews exact, including large CSV values. */
export function statementUnits(value: string) {
  if (!/^-?\d{1,14}(\.\d{1,4})?$/.test(value))
    throw new Error('Use a decimal amount with up to four places, without thousands separators.');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = value.replace('-', '').split('.');
  return (BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'))) * (negative ? -1n : 1n);
}
export function statementAmount(units: bigint) {
  const absolute = units < 0n ? -units : units;
  const fraction = (absolute % 10000n)
    .toString()
    .padStart(4, '0')
    .replace(/0{1,2}$/, '');
  return `${units < 0n ? '-' : ''}${(absolute / 10000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}
/** Legacy create/line endpoints accept JSON numbers. Reject precision loss explicitly. */
export function entryAmount(value: string) {
  const units = statementUnits(value || '0'),
    numeric = Number(value || '0');
  let roundTrip: bigint;
  try {
    roundTrip = statementUnits(String(numeric));
  } catch {
    throw new Error('This amount is too precise for this entry form. Do not round it to continue.');
  }
  if (roundTrip !== units)
    throw new Error('This amount is too precise for this entry form. Do not round it to continue.');
  return numeric;
}
export function statementPreview(rows: StatementRow[]) {
  const seen = new Set<string>();
  let debit = 0n,
    credit = 0n,
    duplicates = 0;
  for (const row of rows) {
    const dr = statementUnits(row.debitAmount),
      cr = statementUnits(row.creditAmount);
    debit += dr;
    credit += cr;
    const key = JSON.stringify([
      row.transactionDate,
      row.description.trim(),
      row.reference.trim(),
      dr.toString(),
      cr.toString(),
    ]);
    if (seen.has(key)) duplicates++;
    else seen.add(key);
  }
  return { debit: statementAmount(debit), credit: statementAmount(credit), duplicates };
}

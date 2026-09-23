import { Prisma } from '@prisma/client';
import { normalizeStatementRow, statementEvidence, statementKey } from './statement-integrity';
const d = (value: number) => new Prisma.Decimal(value);
const start = new Date('2026-09-01'),
  end = new Date('2026-09-30');
const row = {
  transactionDate: '2026-09-18',
  description: 'Supplier payment',
  reference: 'P1',
  debitAmount: '300',
  creditAmount: '0',
};
describe('Statement import and integrity', () => {
  it('uses exact normalized keys for replayed imports', () => {
    const first = normalizeStatementRow(row, start, end),
      second = normalizeStatementRow({ ...row, debitAmount: '300.0000' }, start, end);
    expect(statementKey(first)).toBe(statementKey(second));
    expect(first.debitAmount.toFixed(4)).toBe('300.0000');
  });
  it.each([
    { ...row, transactionDate: '2026-02-30' },
    { ...row, transactionDate: '2026-08-31' },
    { ...row, creditAmount: '20' },
    { ...row, debitAmount: '-20' },
    { ...row, debitAmount: '1.00001' },
  ])('rejects malformed row %j', (value) => {
    expect(() => normalizeStatementRow(value, start, end)).toThrow();
  });
  it('requires statement continuity and complete matching even if stored difference is zero', () => {
    const record = {
      statementStartDate: start,
      statementEndDate: end,
      statementOpeningBalance: d(1000),
      statementClosingBalance: d(700),
      bookOpeningBalance: d(1000),
      bookClosingBalance: d(700),
      statementLines: [
        {
          id: 'l1',
          transactionDate: new Date(row.transactionDate),
          debitAmount: d(300),
          creditAmount: d(0),
          matched: true,
        },
      ],
    };
    expect(statementEvidence(record).issues).toEqual([]);
    expect(
      statementEvidence({ ...record, statementClosingBalance: d(1000) }).issues.length,
    ).toBeGreaterThan(0);
    expect(
      statementEvidence({
        ...record,
        statementLines: [{ ...record.statementLines[0], matched: false }],
      }).issues,
    ).toContain('Every statement line must be matched before approval.');
  });
});

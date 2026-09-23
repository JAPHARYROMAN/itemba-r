import { describe, expect, it } from 'vitest';
import { entryAmount, statementPreview, validStatementDate } from './reconciliation-types';
import { parseStatementCsv } from './statement-csv';
describe('Reconciliation input and preview amounts', () => {
  it('totals the full CSV exactly and identifies normalized duplicate rows', () => {
    const rows = parseStatementCsv(
      'date,description,reference,debit,credit\n2026-09-20,Large,P1,99999999999999.9999,0\n2026-09-20,Small,P2,0.0001,0\n2026-09-20,Small,P2,00.0001,0\n2026-09-20,Credit,P3,0,0001.2500\n',
    );
    expect(statementPreview(rows)).toEqual({
      debit: '100,000,000,000,000.0001',
      credit: '1.25',
      duplicates: 1,
    });
  });
  it.each(['2026-02-30', '2026-9-1', 'invalid'])('rejects invalid date %s', (date) =>
    expect(validStatementDate(date)).toBe(false),
  );
  it('keeps supported negative opening balances and zero while rejecting numeric precision loss', () => {
    expect(entryAmount('-120.2500')).toBe(-120.25);
    expect(entryAmount('0.0001')).toBe(0.0001);
    expect(entryAmount('')).toBe(0);
    expect(() => entryAmount('99999999999999.9999')).toThrow('too precise');
    expect(() => entryAmount('1e3')).toThrow('decimal amount');
  });
});

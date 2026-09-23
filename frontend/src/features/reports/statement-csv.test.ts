import { describe, expect, it } from 'vitest';
import { parseStatementCsv } from './statement-csv';
const header = 'date,description,reference,debit,credit\n';
describe('Statement CSV', () => {
  it('reads BOM, quoted descriptions, escaped quotes and exact large amounts', () => {
    expect(
      parseStatementCsv(
        '\uFEFF' + header + '2026-09-18,"Supplier, ""A""",P1,99999999999999.9999,\r\n',
      ),
    ).toEqual([
      {
        transactionDate: '2026-09-18',
        description: 'Supplier, "A"',
        reference: 'P1',
        debitAmount: '99999999999999.9999',
        creditAmount: '0',
      },
    ]);
  });
  it.each([
    '2026-02-30,Test,P1,10,0',
    '2026-09-18,Test,P1,10,10',
    '2026-09-18,Test,P1,-1,0',
    '2026-09-18,"Unclosed,P1,10,0',
  ])('rejects invalid row %s', (row) => {
    expect(() => parseStatementCsv(header + row)).toThrow();
  });
});

import { Prisma } from '@prisma/client';
import { statementRows, statementCsv, statementPdf } from './records.statement';
const movements = [
  {
    id: '1',
    date: new Date('2026-01-01'),
    delta: new Prisma.Decimal('100.30'),
    kind: 'DEBT',
    description: 'Debt recorded',
    reference: null,
  },
  {
    id: '2',
    date: new Date('2026-01-03'),
    delta: new Prisma.Decimal('-30.10'),
    kind: 'PAYMENT',
    description: 'Payment',
    reference: '=unsafe',
  },
  {
    id: '3',
    date: new Date('2026-01-05'),
    delta: new Prisma.Decimal('30.10'),
    kind: 'REVERSAL',
    description: 'Reversed',
    reference: null,
  },
];
describe('Records statements', () => {
  it('uses debit for debtor charges and credit for partial receipts', () => {
    const s = statementRows('DEBTOR', movements, undefined, '2026-01-04');
    expect(s).toMatchObject({
      openingBalance: '0.00',
      closingBalance: '70.20',
      totalDebit: '100.30',
      totalCredit: '30.10',
      balanceSide: 'Dr',
    });
    expect(s.rows[1]).toMatchObject({ debit: '0.00', credit: '30.10', balance: '70.20' });
  });
  it('uses credit for creditor charges and debit for partial payments', () => {
    const s = statementRows('CREDITOR', movements, undefined, '2026-01-04');
    expect(s).toMatchObject({
      closingBalance: '70.20',
      totalDebit: '30.10',
      totalCredit: '100.30',
      balanceSide: 'Cr',
    });
    expect(s.rows[1]).toMatchObject({ debit: '30.10', credit: '0.00', balance: '70.20' });
  });
  it('carries an opening balance and reverses only on the reversal date', () => {
    const s = statementRows('DEBTOR', movements, '2026-01-04', '2026-01-05');
    expect(s).toMatchObject({
      openingBalance: '70.20',
      closingBalance: '100.30',
      totalDebit: '30.10',
      totalCredit: '0.00',
    });
    expect(s.rows).toHaveLength(1);
    expect(statementRows('DEBTOR', movements, '2026-02-01', '2026-02-02')).toMatchObject({
      openingBalance: '100.30',
      closingBalance: '100.30',
      rows: [],
    });
  });
  it('uses the same statement in both exports and protects CSV references', () => {
    const s = {
      ...statementRows('DEBTOR', movements, undefined, '2026-01-04'),
      from: null,
      to: '2026-01-04',
      startsOn: null,
      record: {
        id: 'test-id',
        kind: 'DEBTOR',
        title: 'Advance',
        counterparty: 'Test customer',
        contact: null,
        currency: 'TZS',
        reference: null,
        dueDate: null,
      },
    };
    const csv = statementCsv(s),
      pdf = statementPdf(s);
    expect(csv).toContain('"\'=unsafe"');
    expect(csv).toContain('"70.20"');
    expect(pdf.sections[0].table?.rows[2]).toContain('70.20 Dr');
    expect(pdf.sections[0].totals?.at(-1)?.value).toBe('TZS 70.20 Dr');
  });
});

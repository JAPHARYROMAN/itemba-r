import { Prisma } from '@prisma/client';
import {
  buildSupplierStatement,
  supplierStatementCsv,
  supplierStatementPdf,
} from './supplier-statement-export';

/** Party linkage, Phase 3 PR-6: a statement run's period as a document, built purely. */
const d = (v: string) => new Prisma.Decimal(v);
const run = {
  id: 'run-1',
  statementRunNumber: 'SSTAT-1',
  companyId: 'c1',
  supplierId: 'sup-1',
  periodStart: new Date('2026-09-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-30T00:00:00.000Z'),
  openingBalance: d('100'),
  totalDebits: d('250'),
  totalCredits: d('50'),
  closingBalance: d('300'),
  currency: 'TZS',
  generatedAt: new Date('2026-10-01T08:00:00.000Z'),
  status: 'GENERATED',
  company: { id: 'c1', name: 'Mwanjalisi Ltd', code: 'MWJ' },
};
const supplier = { id: 'sup-1', name: 'Fuel Co', supplierCode: 'SUP-1' };
const payables = [
  {
    id: 'p2',
    payableNumber: 'PAY-2',
    issueDate: new Date('2026-09-20T00:00:00.000Z'),
    amount: d('150'),
  },
  {
    id: 'p1',
    payableNumber: 'PAY-1',
    issueDate: new Date('2026-09-05T00:00:00.000Z'),
    amount: d('100'),
  },
];
const payments = [
  {
    id: 's1',
    paymentNumber: 'SPAY-1',
    paymentDate: new Date('2026-09-20T00:00:00.000Z'),
    amount: d('80'),
    method: 'BANK_TRANSFER',
    reference: 'TT-9',
  },
];

describe('supplier statement export', () => {
  it('orders activity by date with payables before payments and runs the balance from the recorded opening', () => {
    const s = buildSupplierStatement(run, supplier, payables, payments);
    expect(s.lines.map((l) => [l.date, l.type, l.reference, l.debit, l.credit, l.balance])).toEqual(
      [
        ['2026-09-05', 'PAYABLE', 'PAY-1', '100.00', '0.00', '200.00'],
        ['2026-09-20', 'PAYABLE', 'PAY-2', '150.00', '0.00', '350.00'],
        ['2026-09-20', 'PAYMENT', 'SPAY-1', '0.00', '80.00', '270.00'],
      ],
    );
    expect(s.lines[2].description).toBe('Payment · BANK_TRANSFER · ref TT-9');
    expect(s.activity).toEqual({ debits: '250.00', credits: '80.00', closing: '270.00' });
  });

  it('names the supplier on each line of a whole-company run', () => {
    const s = buildSupplierStatement(
      { ...run, supplierId: null },
      null,
      [{ ...payables[1], supplierName: 'Fuel Co' }],
      [{ ...payments[0], supplier: { name: 'Fuel Co' } }],
    );
    expect(s.lines.map((l) => l.description)).toEqual([
      'Payable raised · Fuel Co',
      'Payment · BANK_TRANSFER · ref TT-9 · Fuel Co',
    ]);
    expect(supplierStatementPdf(s).subtitle).toBe('All suppliers');
  });

  it('writes a CSV with the recorded opening and closing around the activity, escaping cells', () => {
    const s = buildSupplierStatement(
      run,
      supplier,
      [payables[1]],
      [{ ...payments[0], reference: 'a,"b"' }],
    );
    const csv = supplierStatementCsv(s);
    const rows = csv.trim().split('\n');
    expect(rows[0]).toBe('Date,Type,Reference,Description,Debit,Credit,Balance');
    expect(rows[1]).toBe('2026-09-01,OPENING,SSTAT-1,Opening balance (recorded),,,100.00');
    expect(rows[2]).toBe('2026-09-05,PAYABLE,PAY-1,Payable raised,100.00,0.00,200.00');
    expect(rows[3]).toBe(
      '2026-09-20,PAYMENT,SPAY-1,"Payment · BANK_TRANSFER · ref a,""b""",0.00,80.00,120.00',
    );
    expect(rows[4]).toBe(
      '2026-09-30,CLOSING,SSTAT-1,Closing balance (recorded),250.00,50.00,300.00',
    );
  });

  it('builds the letterhead model with recorded balances, the activity table and the mismatch note', () => {
    const s = buildSupplierStatement(run, supplier, payables, payments);
    const pdf = supplierStatementPdf(s);
    expect(pdf).toMatchObject({
      title: 'Supplier statement',
      subtitle: 'Fuel Co',
      reference: 'SSTAT-1',
      status: 'GENERATED',
      firstPageComplete: true,
    });
    expect(pdf.compactPartyHeader).toMatchObject({
      partyLabel: 'Supplier',
      partyName: 'Fuel Co',
      partyDetails: ['Code SUP-1', 'Company Mwanjalisi Ltd'],
    });
    expect(pdf.sections[0].items).toEqual([
      { label: 'Opening balance', value: 'TZS 100.00' },
      { label: 'Payables raised', value: 'TZS 250.00' },
      { label: 'Settlements', value: 'TZS 50.00' },
      { label: 'Closing balance', value: 'TZS 300.00' },
    ]);
    expect(pdf.sections[1].table?.rows).toHaveLength(4);
    expect(pdf.sections[1].table?.rows[3]).toEqual([
      '2026-09-20',
      'SPAY-1',
      'Payment · BANK_TRANSFER · ref TT-9',
      '-',
      '80.00',
      '270.00',
    ]);
    expect(pdf.sections[1].totals).toEqual([
      { label: 'Payables raised in period', value: 'TZS 250.00' },
      { label: 'Payments in period', value: 'TZS 80.00' },
      { label: 'Balance after activity', value: 'TZS 270.00', emphasis: true },
      { label: 'Recorded closing balance', value: 'TZS 300.00' },
    ]);
    const agreeing = supplierStatementPdf(
      buildSupplierStatement({ ...run, closingBalance: d('270') }, supplier, payables, payments),
    );
    expect(agreeing.sections[1].totals).toHaveLength(3);
  });
});

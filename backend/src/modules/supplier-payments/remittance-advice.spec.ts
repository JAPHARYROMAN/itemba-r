import { Prisma } from '@prisma/client';
import { remittancePdf } from './remittance-advice';

/** Party linkage, Phase 3 PR-6: a supplier payment as a remittance advice, built purely. */
const d = (v: string) => new Prisma.Decimal(v);
const payment = {
  id: 'spay-1',
  paymentNumber: 'SPAY-2026-000001',
  paymentDate: new Date('2026-09-20T00:00:00.000Z'),
  amount: d('500'),
  appliedAmount: d('450'),
  unappliedAmount: d('50'),
  currency: 'TZS',
  method: 'BANK_TRANSFER',
  reference: 'TT-9',
  notes: 'September deliveries',
  status: 'COMPLETED',
  reversedAt: null,
  supplier: { id: 'sup-1', name: 'Fuel Co', supplierCode: 'SUP-1' },
  company: { name: 'Mwanjalisi Ltd' },
  cashAccount: { accountName: 'Main bank' },
  allocations: [
    {
      id: 'a1',
      amount: d('300'),
      payable: {
        payableNumber: 'PAY-1',
        amount: d('300'),
        paidAmount: d('300'),
        outstandingAmount: d('0'),
        status: 'PAID',
      },
    },
    {
      id: 'a2',
      amount: d('150'),
      payable: {
        payableNumber: 'PAY-2',
        amount: d('400'),
        paidAmount: d('150'),
        outstandingAmount: d('250'),
        status: 'PARTIALLY_PAID',
      },
    },
  ],
};

describe('remittance advice', () => {
  it('lists every allocation with payable balances and the applied / on-account split', () => {
    const pdf = remittancePdf(payment);
    expect(pdf).toMatchObject({
      title: 'Remittance advice',
      subtitle: 'Fuel Co',
      reference: 'SPAY-2026-000001',
      status: 'COMPLETED',
      firstPageComplete: true,
    });
    expect(pdf.compactPartyHeader?.documentDetails).toEqual([
      { label: 'Payment', value: 'SPAY-2026-000001' },
      { label: 'Date', value: '2026-09-20' },
      { label: 'Method', value: 'BANK_TRANSFER' },
      { label: 'Reference', value: 'TT-9' },
      { label: 'Paid from', value: 'Main bank' },
      { label: 'Amount', value: 'TZS 500.00' },
    ]);
    expect(pdf.sections[0].table?.rows).toEqual([
      ['PAY-1', '300.00', '300.00', '300.00', '0.00'],
      ['PAY-2', '400.00', '150.00', '150.00', '250.00'],
    ]);
    expect(pdf.sections[0].totals).toEqual([
      { label: 'Applied to payables', value: 'TZS 450.00' },
      { label: 'On account (unapplied)', value: 'TZS 50.00' },
      { label: 'Total paid', value: 'TZS 500.00', emphasis: true },
    ]);
    expect(pdf.sections[1]).toEqual({ title: 'Notes', paragraphs: ['September deliveries'] });
  });

  it('says when a payment is on account and marks a reversed payment', () => {
    const pdf = remittancePdf({
      ...payment,
      allocations: [],
      notes: null,
      reversedAt: new Date('2026-09-21T00:00:00.000Z'),
    });
    expect(pdf.status).toBe('REVERSED');
    expect(pdf.sections).toHaveLength(1);
    expect(pdf.sections[0].table).toBeUndefined();
    expect(pdf.sections[0].paragraphs).toEqual([
      'Payment held on account: no payables were allocated.',
    ]);
  });
});

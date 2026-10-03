import { recordValues } from './records.domain';

/**
 * Party linkage, Phase 2 PR-3 (D2): a NoteBook record may name its party, identity only.
 * Debtors and sales name a customer; creditors, purchases and expenses name a supplier;
 * a note names nobody; never both. The record's money is untouched by the link.
 */
const base = { title: 'Fuel', currency: 'TZS', amount: '10.00', recordDate: '2026-10-01' };

describe('NoteBook record party rules', () => {
  it('lets a debtor or sale name a customer and a creditor, purchase or expense a supplier', () => {
    expect(
      recordValues({
        ...base,
        kind: 'DEBTOR',
        counterparty: 'Westsides',
        customerId: 'cus-1',
      } as any),
    ).toMatchObject({ customerId: 'cus-1', supplierId: null });
    expect(recordValues({ ...base, kind: 'SALE', customerId: 'cus-1' } as any)).toMatchObject({
      customerId: 'cus-1',
    });
    for (const kind of ['CREDITOR', 'PURCHASE', 'EXPENSE'])
      expect(
        recordValues({ ...base, kind, counterparty: 'Mwanjalisi', supplierId: 'sup-1' } as any),
      ).toMatchObject({ supplierId: 'sup-1', customerId: null });
    expect(recordValues({ ...base, kind: 'NOTE', amount: '0' } as any)).toMatchObject({
      supplierId: null,
      customerId: null,
    });
  });
  it('refuses the wrong party kind, both parties, or a party on a note', () => {
    expect(() =>
      recordValues({ ...base, kind: 'DEBTOR', counterparty: 'X', supplierId: 'sup-1' } as any),
    ).toThrow('customer, not a supplier');
    expect(() =>
      recordValues({ ...base, kind: 'CREDITOR', counterparty: 'X', customerId: 'cus-1' } as any),
    ).toThrow('supplier, not a customer');
    expect(() =>
      recordValues({ ...base, kind: 'PURCHASE', supplierId: 'sup-1', customerId: 'cus-1' } as any),
    ).toThrow('not both');
    expect(() =>
      recordValues({ ...base, kind: 'NOTE', amount: '0', customerId: 'cus-1' } as any),
    ).toThrow('no linked party');
  });
  it('leaves the money untouched: a linked party changes no amount or date', () => {
    const values = recordValues({
      ...base,
      kind: 'DEBTOR',
      counterparty: 'Westsides',
      customerId: 'cus-1',
      dueDate: '2026-10-20',
    } as any);
    expect(values.amount.toFixed(2)).toBe('10.00');
    expect(values.dueDate?.toISOString().slice(0, 10)).toBe('2026-10-20');
    expect(values.counterparty).toBe('Westsides');
  });
});

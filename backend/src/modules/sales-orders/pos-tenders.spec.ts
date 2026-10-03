import { readPosTenders, tenderTotal } from './pos-tenders';
describe('POS allocations', () => {
  it('normalizes supported payments and sums decimal amounts exactly', () => {
    const value = readPosTenders([
      { method: 'MOBILE_MONEY', amount: 0.2, cashAccountId: 'm', reference: ' REF ' },
      { method: 'CASH', amount: 0.1, cashAccountId: 'c' },
    ])!;
    expect(value[0].method).toBe('CASH');
    expect(value[1].reference).toBe('REF');
    expect(tenderTotal(value).toString()).toBe('0.3');
    expect(readPosTenders(null)).toBeNull();
  });
  it.each(
    [
      [],
      [null],
      [{ method: 'CASH', amount: 1.001, cashAccountId: 'c' }],
      [{ method: 'CASH', amount: -1, cashAccountId: 'c' }],
      [{ method: 'CARD', amount: 1, cashAccountId: 'c' }],
      [{ method: 'MOBILE_MONEY', amount: 1, cashAccountId: 'm' }],
      [
        { method: 'CASH', amount: 1, cashAccountId: 'c' },
        { method: 'CASH', amount: 2, cashAccountId: 'c' },
      ],
    ].map((v) => [v]),
  )('refuses malformed or ambiguous allocations (%j)', (value) => {
    expect(() => readPosTenders(value)).toThrow();
  });
});

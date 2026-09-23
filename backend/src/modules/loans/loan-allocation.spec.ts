import { Prisma } from '@prisma/client';
import { allocateScheduledPayment, allocateLoanPayment, loanMoney } from './loan-allocation';
const D = (v: string | number) => new Prisma.Decimal(v);
describe('Exact loan payment allocation', () => {
  it('allocates fees as well as principal and interest', () => {
    const a = allocateScheduledPayment('55', { principal: 100, interest: 8, fees: 2 });
    expect([a.principal, a.interest, a.fees].map((n) => n.toFixed(2))).toEqual([
      '50.00',
      '4.00',
      '1.00',
    ]);
  });
  it('keeps every cent over repeated partial payments and final settlement', () => {
    let remaining = { principal: D('1.01'), interest: D('.07'), fees: D('.03') };
    for (let n = 0; n < 111; n++) {
      const a = allocateScheduledPayment('.01'.replace(/^\./, '0.'), remaining);
      expect(a.principal.plus(a.interest).plus(a.fees).toFixed(2)).toBe('0.01');
      remaining = {
        principal: remaining.principal.minus(a.principal),
        interest: remaining.interest.minus(a.interest),
        fees: remaining.fees.minus(a.fees),
      };
      expect(Object.values(remaining).every((n) => n.gte(0))).toBe(true);
    }
    expect(Object.values(remaining).every((n) => n.isZero())).toBe(true);
  });
  it('uses exact integer arithmetic at the largest supported amounts', () => {
    const a = allocateScheduledPayment('80000000000000.01', {
      principal: '70000000000000.01',
      interest: '10000000000000.01',
      fees: '10000000000000.01',
    });
    expect(a.principal.plus(a.interest).plus(a.fees).eq(a.amount)).toBe(true);
    expect(a.principal.lte('70000000000000.01')).toBe(true);
  });
  it('rejects even one cent over the installment', () =>
    expect(() =>
      allocateScheduledPayment('1.02', { principal: '1.01', interest: 0, fees: 0 }),
    ).toThrow('exceed'));
  it('reduces principal only by the principal component', () => {
    const a = allocateLoanPayment(
      { amount: '115', interest: '10', fees: '3', penalties: '2' },
      D(100),
    );
    expect(a.principal.eq(100)).toBe(true);
  });
  it('rejects mismatched allocation, excessive principal and fractional cents', () => {
    expect(() => allocateLoanPayment({ amount: '10', principal: '10', fees: '1' }, D(100))).toThrow(
      'equal',
    );
    expect(() => allocateLoanPayment({ amount: '101' }, D(100))).toThrow('exceeds');
    expect(() => loanMoney('0.001')).toThrow('decimal');
  });
});

import { Prisma } from '@prisma/client';
import { allocateRepayment } from './repayment-allocation';
const q = { amount: '12.00', interest: '2.00', repaymentDate: '2025-09-10' },
  balance = new Prisma.Decimal('100'),
  date = new Date('2025-01-01');
describe('Loan repayment allocation', () => {
  it('reduces principal only and persists a split for reporting', () => {
    const r = allocateRepayment(q, balance, 'TZS', date);
    expect(r.principal.toFixed(2)).toBe('10.00');
    expect(r.financeCharge.toFixed(2)).toBe('2.00');
    expect(r.balance.toFixed(2)).toBe('90.00');
  });
  it('rejects overpayments, mismatched components, currency and impossible dates', () => {
    for (const p of [
      { principal: '101', amount: '101', interest: '0' },
      { principal: '10', interest: '3' },
      { currency: 'USD' as const },
      { repaymentDate: '2025-02-30' },
      { repaymentDate: '2024-01-01' },
      { interest: '-2' },
      { amount: '1.001' },
    ])
      expect(() => allocateRepayment({ ...q, ...p }, balance, 'TZS', date)).toThrow();
  });
  it('keeps exact cents for large balances and separates penalties', () => {
    const r = allocateRepayment(
      { ...q, amount: '0.31', interest: '0.10', penalties: '0.01' },
      new Prisma.Decimal('9007199254740993.11'),
      'TZS',
      date,
    );
    expect(r.principal.toFixed(2)).toBe('0.20');
    expect(r.balance.toFixed(2)).toBe('9007199254740992.91');
  });
});

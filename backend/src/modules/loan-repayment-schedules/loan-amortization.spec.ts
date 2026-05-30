import { LoanRepaymentSchedulesService } from './loan-repayment-schedules.service';

describe('LoanRepaymentSchedulesService — amortization math', () => {
  // We construct the service with throwaway dependencies because the math
  // helpers are pure and don't touch them.
  const svc = new LoanRepaymentSchedulesService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  // Reach into the private method for direct testing.
  const amortize = (svc as any).amortize.bind(svc) as (
    principal: number,
    monthlyRate: number,
    n: number,
  ) => Array<{ principal: number; interest: number }>;

  it('produces n installments', () => {
    const rows = amortize(12000, 0.01, 12);
    expect(rows).toHaveLength(12);
  });

  it('every installment principal+interest sums to the EMI within rounding', () => {
    const rows = amortize(12000, 0.01, 12);
    const emi = (12000 * 0.01 * Math.pow(1.01, 12)) / (Math.pow(1.01, 12) - 1);
    for (const r of rows) {
      expect(Math.abs(r.principal + r.interest - emi)).toBeLessThan(0.5);
    }
  });

  it('total principal repaid equals starting principal within accumulated rounding drift', () => {
    const rows = amortize(100000, 0.005, 24);
    const total = rows.reduce((s, r) => s + r.principal, 0);
    // 2-decimal rounding over 24 installments can drift a few cents;
    // financial systems typically reconcile with a final adjustment.
    expect(Math.abs(total - 100000)).toBeLessThan(0.5);
  });

  it('zero-interest path splits principal evenly', () => {
    const rows = amortize(1200, 0, 12);
    expect(rows.every((r) => r.interest === 0)).toBe(true);
    const total = rows.reduce((s, r) => s + r.principal, 0);
    expect(total).toBeCloseTo(1200, 2);
  });

  it('first installment has the highest interest portion (declining schedule)', () => {
    const rows = amortize(50000, 0.015, 6);
    for (let i = 1; i < rows.length; i++) {
      // Each subsequent interest should be less than the previous one.
      expect(rows[i].interest).toBeLessThanOrEqual(rows[i - 1].interest + 0.01);
    }
  });
});

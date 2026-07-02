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

describe('LoanRepaymentSchedulesService — repayment frequency', () => {
  const svc = new LoanRepaymentSchedulesService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  const amortize = (svc as any).amortize.bind(svc) as (
    principal: number,
    periodicRate: number,
    n: number,
  ) => Array<{ principal: number; interest: number }>;
  const frequencyProfile = (svc as any).frequencyProfile.bind(svc) as (
    frequency: string,
  ) => { periodsPerYear: number; monthsPerPeriod: number; advance: (d: Date, p: number) => Date };
  const computePeriodCount = (svc as any).computePeriodCount.bind(svc) as (
    start: Date,
    end: Date,
    profile: { monthsPerPeriod: number },
  ) => number;

  it('maps each real RepaymentFrequency enum value to the right cadence', () => {
    expect(frequencyProfile('MONTHLY')).toMatchObject({ periodsPerYear: 12, monthsPerPeriod: 1 });
    expect(frequencyProfile('QUARTERLY')).toMatchObject({ periodsPerYear: 4, monthsPerPeriod: 3 });
    expect(frequencyProfile('SEMI_ANNUALLY')).toMatchObject({ periodsPerYear: 2, monthsPerPeriod: 6 });
    expect(frequencyProfile('ANNUALLY')).toMatchObject({ periodsPerYear: 1, monthsPerPeriod: 12 });
  });

  it('BULLET/OTHER/unknown fall back to a single balloon period', () => {
    for (const f of ['BULLET', 'OTHER', 'SOMETHING_ELSE']) {
      const p = frequencyProfile(f);
      expect(p.monthsPerPeriod).toBe(0);
      expect(p.periodsPerYear).toBe(1);
    }
  });

  it('QUARTERLY advances due dates by 3 months per installment', () => {
    const profile = frequencyProfile('QUARTERLY');
    const start = new Date('2026-01-01T00:00:00.000Z');
    const d1 = profile.advance(start, 1);
    const d2 = profile.advance(start, 2);
    // 3 months and 6 months after the start.
    expect(d1.getMonth()).toBe(new Date('2026-04-01').getMonth());
    expect(d2.getMonth()).toBe(new Date('2026-07-01').getMonth());
  });

  it('computes period count from tenure and cadence (not always monthly)', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const end = new Date('2027-01-01T00:00:00.000Z'); // 12 months
    expect(computePeriodCount(start, end, frequencyProfile('MONTHLY'))).toBe(12);
    expect(computePeriodCount(start, end, frequencyProfile('QUARTERLY'))).toBe(4);
    expect(computePeriodCount(start, end, frequencyProfile('SEMI_ANNUALLY'))).toBe(2);
    expect(computePeriodCount(start, end, frequencyProfile('ANNUALLY'))).toBe(1);
    // BULLET → single period regardless of tenure.
    expect(computePeriodCount(start, end, frequencyProfile('BULLET'))).toBe(1);
  });

  it('periodic rate differs by frequency: a quarterly loan uses annual/4, not annual/12', () => {
    // A 12% annual loan quarterly should charge ~3% per period on the first
    // installment, whereas the buggy monthly assumption charged ~1%.
    const annualRate = 0.12;
    const quarterly = frequencyProfile('QUARTERLY');
    const quarterlyRate = annualRate / quarterly.periodsPerYear;
    expect(quarterlyRate).toBeCloseTo(0.03, 6);

    const firstInterest = amortize(100000, quarterlyRate, 4)[0].interest;
    // First-period interest on 100k at 3% ≈ 3000; the old monthly (1%) path
    // would have produced ≈ 1000.
    expect(firstInterest).toBeGreaterThan(2500);
  });
});

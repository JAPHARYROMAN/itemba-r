import { describe, expect, it } from 'vitest';
import {
  adjustmentTotals,
  assetScheduleDefaults,
  controlCreateBody,
  initialControlValues,
  type ControlKind,
} from './accounting-controls-types';

function values(kind: ControlKind, fields: Record<string, string> = {}) {
  const value = initialControlValues(kind, 'company');
  Object.assign(value.fields, fields);
  return value;
}
describe('Accounting control input boundaries', () => {
  it('prefills asset values using exact decimal subtraction', () => {
    expect(
      assetScheduleDefaults({
        id: 'asset',
        acquisitionCost: '1000.3456',
        residualValue: '0.1256',
        usefulLifeYears: 5,
      }),
    ).toMatchObject({
      totalDepreciableAmount: '1000.22',
      salvageValue: '0.1256',
      usefulLifeMonths: '60',
    });
  });
  it('keeps exact four-place posting totals and strips unrelated fields', () => {
    expect(
      controlCreateBody(
        'posting-runs',
        values('posting-runs', { totalDebit: '12.3456', totalCredit: '12.3456' }),
      ),
    ).toMatchObject({ totalDebit: 12.3456, totalCredit: 12.3456, companyId: 'company' });
    expect(controlCreateBody('posting-runs', values('posting-runs'))).not.toHaveProperty(
      'fiscalYearId',
    );
  });
  it.each(['-1', 'NaN', 'Infinity', '1e3', '99999999999999.9999', '1.00001'])(
    'rejects unsafe posting amounts: %s',
    (amount) => {
      expect(() =>
        controlCreateBody('posting-runs', values('posting-runs', { totalDebit: amount })),
      ).toThrow();
    },
  );
  it('requires the complete period-close scope', () => {
    expect(() => controlCreateBody('period-close', values('period-close'))).toThrow('fiscal year');
  });
  it.each([
    { lockedFrom: '2026-02-30' },
    { lockedFrom: '2026-10-01', lockedTo: '2026-09-01' },
    { lockType: 'MODULE_LOCK', moduleName: '' },
  ])('rejects invalid lock scope %j', (fields) => {
    expect(() =>
      controlCreateBody('accounting-locks', values('accounting-locks', fields)),
    ).toThrow();
  });
  it('accepts explicit fiscal-year and period lock scope without converting dates', () => {
    expect(
      controlCreateBody(
        'accounting-locks',
        values('accounting-locks', {
          fiscalYearId: 'year',
          accountingPeriodId: 'period',
          lockedFrom: '2026-09-01',
        }),
      ),
    ).toMatchObject({
      fiscalYearId: 'year',
      accountingPeriodId: 'period',
      lockedFrom: '2026-09-01',
    });
  });
  it('balances adjustment lines exactly and rejects precision the database cannot store', () => {
    const form = values('audit-adjustments', { description: 'Accrual', reason: 'Month end' });
    form.lines = [
      { accountId: 'a', description: '', debit: '0.10', credit: '0' },
      { accountId: 'a', description: '', debit: '0.20', credit: '0' },
      { accountId: 'b', description: '', debit: '0', credit: '0.30' },
    ];
    expect(adjustmentTotals(form.lines)).toEqual({ debit: 3000n, credit: 3000n });
    expect(controlCreateBody('audit-adjustments', form)).toHaveProperty('lines');
    form.lines[0].debit = '0.1001';
    expect(() => controlCreateBody('audit-adjustments', form)).toThrow('two decimal');
    form.lines[0].debit = '0.11';
    expect(() => controlCreateBody('audit-adjustments', form)).toThrow('balance exactly');
  });
  it('rejects a debit and credit on the same adjustment line', () => {
    const form = values('audit-adjustments', { description: 'Accrual', reason: 'Month end' });
    form.lines[0] = { accountId: 'a', description: '', debit: '10', credit: '10' };
    expect(() => controlCreateBody('audit-adjustments', form)).toThrow(
      'either a debit or a credit',
    );
  });
  it('uses ISO dates and six-place annual rates for depreciation', () => {
    expect(
      controlCreateBody(
        'depreciation',
        values('depreciation', {
          fixedAssetId: 'asset',
          startDate: '2026-09-01',
          totalDepreciableAmount: '1000',
          depreciationRate: '0.123456',
        }),
      ),
    ).toMatchObject({
      startDate: '2026-09-01T00:00:00.000Z',
      depreciationRate: 0.123456,
      totalDepreciableAmount: 1000,
    });
  });
  it.each([
    { accumulatedDepreciation: '1001' },
    { usefulLifeMonths: '1.5' },
    { usefulLifeMonths: '' },
    { depreciationRate: '25' },
    { depreciationRate: '0.1234567' },
  ])('rejects invalid depreciation configuration %j', (fields) => {
    expect(() =>
      controlCreateBody(
        'depreciation',
        values('depreciation', {
          fixedAssetId: 'asset',
          totalDepreciableAmount: '1000',
          ...fields,
        }),
      ),
    ).toThrow();
  });
});

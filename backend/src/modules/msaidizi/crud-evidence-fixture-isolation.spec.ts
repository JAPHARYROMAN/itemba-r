import {
  CRUD_EVIDENCE_NON_POSTING_LOCK_MODULE,
  assertCrudEvidenceAccountingLockSeed,
  crudEvidenceMetadataSeedValueMatches,
  materializeCrudEvidenceMetadataSeedFields,
  materializeCrudEvidenceMetadataSeedValue,
} from './crud-evidence-fixture-isolation';

describe('CRUD evidence fixture isolation', () => {
  const isolatedLock = {
    id: 'lock-1',
    lockType: 'MODULE_LOCK',
    moduleName: CRUD_EVIDENCE_NON_POSTING_LOCK_MODULE,
    fiscalYearId: null,
    accountingPeriodId: null,
    lockedFrom: null,
    lockedTo: null,
    status: 'RELEASED',
    deletedAt: null,
  };

  it('accepts the exact cached released, unscoped, non-posting lock seed', () => {
    expect(() => assertCrudEvidenceAccountingLockSeed(isolatedLock, 'lock-1')).not.toThrow();
  });

  it('rejects an absent or different cached seed identity', () => {
    expect(() => assertCrudEvidenceAccountingLockSeed(undefined, 'lock-1')).toThrow(
      'absent from the shared seed cache',
    );
    expect(() => assertCrudEvidenceAccountingLockSeed(isolatedLock, 'lock-2')).toThrow(
      'must be the cached RELEASED',
    );
  });

  it.each([
    ['active', { status: 'ACTIVE' }],
    ['posting module', { moduleName: 'accounting' }],
    ['period scope', { accountingPeriodId: 'period-1' }],
    ['fiscal-year scope', { fiscalYearId: 'year-1' }],
  ])('rejects a %s lock that could contaminate journal fixtures', (_label, override) => {
    expect(() =>
      assertCrudEvidenceAccountingLockSeed({ ...isolatedLock, ...override }, 'lock-1'),
    ).toThrow('must be the cached RELEASED');
  });

  it('materializes an explicitly tagged canonical UTC date and preserves primitives', () => {
    const fields = materializeCrudEvidenceMetadataSeedFields({
      dueDate: { dateIso: '2000-01-01T00:00:00.000Z' },
      status: 'OUTSTANDING',
      active: true,
      count: 1,
      optional: null,
    });

    expect(fields).toEqual({
      dueDate: new Date('2000-01-01T00:00:00.000Z'),
      status: 'OUTSTANDING',
      active: true,
      count: 1,
      optional: null,
    });
  });

  it('matches a persisted Date only against the exact signed date instant', () => {
    const signed = { dateIso: '2000-01-01T00:00:00.000Z' } as const;

    expect(crudEvidenceMetadataSeedValueMatches(new Date(signed.dateIso), signed)).toBe(true);
    expect(crudEvidenceMetadataSeedValueMatches(new Date('2000-01-01T00:00:00.001Z'), signed)).toBe(
      false,
    );
    expect(crudEvidenceMetadataSeedValueMatches(signed.dateIso, signed)).toBe(false);
    expect(crudEvidenceMetadataSeedValueMatches('OUTSTANDING', 'OUTSTANDING')).toBe(true);
  });

  it.each([
    ['plain object', { value: '2000-01-01T00:00:00.000Z' }],
    ['extra field', { dateIso: '2000-01-01T00:00:00.000Z', timezone: 'UTC' }],
    ['non-string date', { dateIso: 946684800000 }],
    ['non-canonical offset', { dateIso: '2000-01-01T03:00:00.000+03:00' }],
    ['invalid date', { dateIso: 'not-a-date' }],
    ['array', ['2000-01-01T00:00:00.000Z']],
  ])('rejects a %s metadata date representation', (_label, value) => {
    expect(() => materializeCrudEvidenceMetadataSeedValue(value)).toThrow(/CRUD metadata/);
  });
});

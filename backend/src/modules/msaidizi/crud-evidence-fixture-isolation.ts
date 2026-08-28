export const CRUD_EVIDENCE_NON_POSTING_LOCK_MODULE = 'crud_evidence_nonposting';

export type CrudEvidenceMetadataSeedPrimitive = string | number | boolean | null;

/**
 * A date in a signed metadata-read fixture is deliberately tagged. Treating an
 * arbitrary string as a date at the database boundary would make the fixture
 * contract ambiguous and could silently change an enum/text field instead.
 */
export type CrudEvidenceMetadataSeedValue =
  | CrudEvidenceMetadataSeedPrimitive
  | Readonly<{ dateIso: string }>;

export type CrudEvidenceMetadataSeedFields = Readonly<
  Record<string, CrudEvidenceMetadataSeedValue>
>;

export type CrudEvidenceMaterializedMetadataSeedValue = CrudEvidenceMetadataSeedPrimitive | Date;

/** Materializes only the exact signed `{ dateIso }` representation. */
export function materializeCrudEvidenceMetadataSeedValue(
  value: unknown,
): CrudEvidenceMaterializedMetadataSeedValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CRUD metadata seed value has an unsupported signed representation.');
  }

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.length !== 1 || keys[0] !== 'dateIso' || typeof record.dateIso !== 'string') {
    throw new Error('CRUD metadata date seed must contain exactly one string dateIso field.');
  }

  const date = new Date(record.dateIso);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== record.dateIso) {
    throw new Error('CRUD metadata date seed must be a canonical UTC ISO instant.');
  }
  return date;
}

export function materializeCrudEvidenceMetadataSeedFields(
  fields: CrudEvidenceMetadataSeedFields,
): Readonly<Record<string, CrudEvidenceMaterializedMetadataSeedValue>> {
  return Object.fromEntries(
    Object.entries(fields).map(([field, value]) => [
      field,
      materializeCrudEvidenceMetadataSeedValue(value),
    ]),
  );
}

/** Exact persisted-value matcher; strings are never implicitly parsed as dates. */
export function crudEvidenceMetadataSeedValueMatches(
  actual: unknown,
  signedExpected: CrudEvidenceMetadataSeedValue,
): boolean {
  const expected = materializeCrudEvidenceMetadataSeedValue(signedExpected);
  if (expected instanceof Date) {
    return actual instanceof Date && actual.getTime() === expected.getTime();
  }
  return actual === expected;
}

export type CrudEvidenceAccountingLockSeedRecord = Readonly<{
  id?: unknown;
  lockType?: unknown;
  moduleName?: unknown;
  fiscalYearId?: unknown;
  accountingPeriodId?: unknown;
  lockedFrom?: unknown;
  lockedTo?: unknown;
  status?: unknown;
  deletedAt?: unknown;
}>;

/**
 * Fails before loopback execution if the cached AccountingLock seed could
 * influence posting. The release fixture temporarily activates this row, so
 * both its baseline status and its scope/module must be isolated from journals.
 */
export function assertCrudEvidenceAccountingLockSeed(
  value: unknown,
  expectedId: string,
): asserts value is CrudEvidenceAccountingLockSeedRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('CRUD evidence AccountingLock seed is absent from the shared seed cache.');
  }

  const record = value as CrudEvidenceAccountingLockSeedRecord;
  const isolated =
    record.id === expectedId &&
    record.lockType === 'MODULE_LOCK' &&
    record.moduleName === CRUD_EVIDENCE_NON_POSTING_LOCK_MODULE &&
    record.fiscalYearId === null &&
    record.accountingPeriodId === null &&
    record.lockedFrom === null &&
    record.lockedTo === null &&
    record.status === 'RELEASED' &&
    record.deletedAt === null;

  if (!isolated) {
    throw new Error(
      'CRUD evidence AccountingLock seed must be the cached RELEASED, unscoped, non-posting MODULE_LOCK.',
    );
  }
}

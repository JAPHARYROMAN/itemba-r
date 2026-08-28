import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Pure, negative-testable validators used by the signed CRUD loopback harness. */

/**
 * Resolves a fixture response path against the controller payload rather than
 * the global HTTP transform envelope. The returned value is intentionally
 * ephemeral: callers proving a response secret must compare it in memory and
 * must never include it in evidence, logs, or assertion details.
 */
export function capabilityResponseValueAtPath(
  responseBody: unknown,
  path: readonly string[],
): unknown {
  let value: unknown = isProductionResponseEnvelope(responseBody)
    ? responseBody.data
    : responseBody;
  for (const segment of path) {
    if (!isRecord(value)) return undefined;
    value = value[segment];
  }
  return value;
}

/**
 * Verifies a one-time secret against a persisted SHA-256 hex digest. The helper
 * returns only a boolean so callers cannot accidentally serialize the secret or
 * derived digest into an assertion detail.
 */
export function responseSecretDigestMatches(actual: unknown, responseSecret: unknown): boolean {
  if (
    typeof actual !== 'string' ||
    !/^[a-f0-9]{64}$/.test(actual) ||
    typeof responseSecret !== 'string' ||
    responseSecret.length < 32 ||
    responseSecret.length > 4096
  ) {
    return false;
  }
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = createHash('sha256').update(responseSecret, 'utf8').digest();
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** HMAC equivalent of responseSecretDigestMatches for peppered API-key storage. */
export function responseSecretHmacDigestMatches(
  actual: unknown,
  responseSecret: unknown,
  pepper: unknown,
): boolean {
  if (
    typeof actual !== 'string' ||
    !/^[a-f0-9]{64}$/.test(actual) ||
    typeof responseSecret !== 'string' ||
    responseSecret.length < 32 ||
    responseSecret.length > 4096 ||
    typeof pepper !== 'string' ||
    pepper.length < 32
  ) {
    return false;
  }
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = createHmac('sha256', pepper).update(responseSecret, 'utf8').digest();
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

/** Compares only the declared prefix length and never returns either secret value. */
export function responseSecretPrefixMatches(
  actual: unknown,
  responseSecret: unknown,
  length: number,
): boolean {
  return (
    typeof actual === 'string' &&
    typeof responseSecret === 'string' &&
    Number.isSafeInteger(length) &&
    length > 0 &&
    length <= 64 &&
    responseSecret.length >= length &&
    actual.length === length &&
    actual === responseSecret.slice(0, length)
  );
}

/**
 * Prisma exposes numeric scalar defaults as JavaScript numbers in the DMMF,
 * while Decimal values read from the database serialize as numeric strings.
 * Keep this coercion deliberately narrow: only a numeric schema default and a
 * database value object (such as Prisma.Decimal) may cross that representation
 * boundary.
 */
export function prismaNumericDefaultMatches(actual: unknown, expected: unknown): boolean {
  if (typeof expected !== 'number' || !Number.isFinite(expected)) return false;
  if (typeof actual === 'number') return actual === expected;
  if (!actual || typeof actual !== 'object') return false;
  const numeric = Number(String(actual));
  return Number.isFinite(numeric) && numeric === expected;
}

export function schemaGeneratedIdentifierMatches(actual: unknown, generator: string): boolean {
  const normalized = generator.toLowerCase().trim();
  if (normalized === 'autoincrement') {
    return (
      (typeof actual === 'number' && Number.isSafeInteger(actual) && actual > 0) ||
      (typeof actual === 'bigint' && actual > 0n)
    );
  }
  const value = typeof actual === 'string' ? actual : '';
  const uuid = /^uuid(?:\(([1-8])\))?$/.exec(normalized);
  if (uuid) {
    const version = uuid[1] ?? '4';
    return new RegExp(
      `^[0-9a-f]{8}-[0-9a-f]{4}-${version}[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
    ).test(value);
  }
  if (normalized === 'cuid') return /^c[0-9a-z]{24}$/.test(value);
  if (normalized === 'ulid') return /^[0-9A-HJKMNP-TV-Z]{26}$/.test(value);
  return false;
}

export function canonicalActionIsoSuffixMatches(
  actual: unknown,
  prefix: string,
  startedAt: Date,
  finishedAt: Date,
  trailingSuffix = '',
): boolean {
  const value = String(actual ?? '');
  if (!value.startsWith(prefix) || !value.endsWith(trailingSuffix)) return false;
  const timestampText = value.slice(
    prefix.length,
    trailingSuffix ? value.length - trailingSuffix.length : undefined,
  );
  const timestamp = Date.parse(timestampText);
  return (
    Number.isFinite(timestamp) &&
    new Date(timestamp).toISOString() === timestampText &&
    timestamp >= startedAt.getTime() - 1_000 &&
    timestamp <= finishedAt.getTime() + 1_000
  );
}

export function localCalendarDaysActionTimeMatches(
  actual: unknown,
  offsetDays: number,
  startedAt: Date,
  finishedAt: Date,
): boolean {
  const lower = new Date(startedAt);
  const upper = new Date(finishedAt);
  lower.setDate(lower.getDate() + offsetDays);
  upper.setDate(upper.getDate() + offsetDays);
  const value = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
  return (
    Number.isFinite(value) &&
    value >= Math.min(lower.getTime(), upper.getTime()) - 1_000 &&
    value <= Math.max(lower.getTime(), upper.getTime()) + 1_000
  );
}

/** Mirrors services that deliberately normalize domain periods with setUTCHours. */
export function utcDayBoundaryMatches(
  actual: unknown,
  source: unknown,
  boundary: 'start' | 'end',
): boolean {
  const expected = source instanceof Date ? new Date(source) : new Date(String(source));
  if (!Number.isFinite(expected.getTime())) return false;
  if (boundary === 'start') expected.setUTCHours(0, 0, 0, 0);
  else expected.setUTCHours(23, 59, 59, 999);
  const actualTime = actual instanceof Date ? actual.getTime() : Date.parse(String(actual));
  return Number.isFinite(actualTime) && actualTime === expected.getTime();
}

/**
 * Exact persisted-value comparison with JSON object keys treated as unordered.
 * Arrays remain ordered, and missing or additional object properties remain a
 * mismatch. The numeric object exception is limited to Prisma.Decimal-like
 * values and preserves the harness's existing number contract.
 */
export function canonicalPersistedValueMatches(actual: unknown, expected: unknown): boolean {
  if (actual instanceof Date && typeof expected === 'string') {
    const expectedTime = Date.parse(expected);
    return Number.isFinite(expectedTime) && actual.getTime() === expectedTime;
  }
  if (expected instanceof Date && typeof actual === 'string') {
    const actualTime = Date.parse(actual);
    return Number.isFinite(actualTime) && expected.getTime() === actualTime;
  }
  if (typeof expected === 'number' && actual && typeof actual === 'object') {
    const numeric = Number(String(actual));
    if (Number.isFinite(numeric)) return numeric === expected;
  }
  if (typeof actual === 'number' && expected && typeof expected === 'object') {
    const numeric = Number(String(expected));
    if (Number.isFinite(numeric)) return actual === numeric;
  }
  return (
    JSON.stringify(normalizeComparableValue(actual)) ===
    JSON.stringify(normalizeComparableValue(expected))
  );
}

function normalizeComparableValue(value: unknown): unknown {
  if (value instanceof Date) return { $date: value.toISOString() };
  if (typeof value === 'bigint') return { $bigint: value.toString() };
  if (typeof value === 'number' && !Number.isFinite(value)) return { $number: String(value) };
  if (Array.isArray(value)) return value.map(normalizeComparableValue);
  if (value && typeof value === 'object') {
    if ('toJSON' in value && typeof value.toJSON === 'function') {
      return normalizeComparableValue(value.toJSON());
    }
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeComparableValue(item)]),
    );
  }
  if (value === undefined) return { $undefined: true };
  return value;
}

function isProductionResponseEnvelope(
  value: unknown,
): value is { success: true; data: unknown; timestamp: string } {
  return (
    isRecord(value) &&
    value.success === true &&
    Object.prototype.hasOwnProperty.call(value, 'data') &&
    typeof value.timestamp === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

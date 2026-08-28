import { Prisma } from '@prisma/client';
import {
  capabilityResponseValueAtPath,
  canonicalPersistedValueMatches,
  canonicalActionIsoSuffixMatches,
  localCalendarDaysActionTimeMatches,
  prismaNumericDefaultMatches,
  responseSecretDigestMatches,
  responseSecretHmacDigestMatches,
  responseSecretPrefixMatches,
  schemaGeneratedIdentifierMatches,
  utcDayBoundaryMatches,
} from './crud-mutation-generated-field-verifiers';

describe('CRUD generated-field verifier primitives', () => {
  it('resolves response-secret paths through the production HTTP envelope without persisting them', () => {
    const activationCode = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const response = {
      success: true,
      data: { terminalCode: 'MPL-ABC123', activationCode },
      timestamp: '2026-08-27T08:00:00.000Z',
    };

    expect(capabilityResponseValueAtPath(response, ['activationCode'])).toBe(activationCode);
    expect(capabilityResponseValueAtPath(response.data, ['activationCode'])).toBe(activationCode);
    expect(capabilityResponseValueAtPath(response, ['missing'])).toBeUndefined();
    expect(
      capabilityResponseValueAtPath({ data: { activationCode }, domainResult: true }, [
        'activationCode',
      ]),
    ).toBeUndefined();
  });

  it('matches a response secret to its digest without returning either value', () => {
    const responseSecret = 'f'.repeat(64);
    const digest = 'df0790f236013511e91fa4532fb7761f62320a51a3868dabf4a13fe5f53e3263';

    expect(responseSecretDigestMatches(digest, responseSecret)).toBe(true);
    expect(responseSecretDigestMatches('0'.repeat(64), responseSecret)).toBe(false);
    expect(responseSecretDigestMatches(digest.toUpperCase(), responseSecret)).toBe(false);
    expect(responseSecretDigestMatches(digest, 'short')).toBe(false);
  });

  it('proves peppered API-key hashes and prefixes without exposing the response secret', () => {
    const secret = '0123456789abcdef'.repeat(4);
    const pepper = 'evidence-pepper-value-that-is-at-least-32-bytes';
    const hmac = '3a17e9dc5a56fafa50e72355d7757e4ca76c4209840809c1c2dd9e308c02f575';

    expect(responseSecretHmacDigestMatches(hmac, secret, pepper)).toBe(true);
    expect(responseSecretHmacDigestMatches('0'.repeat(64), secret, pepper)).toBe(false);
    expect(responseSecretPrefixMatches('01234567', secret, 8)).toBe(true);
    expect(responseSecretPrefixMatches('deadbeef', secret, 8)).toBe(false);
  });

  it('matches Prisma Decimal values to numeric DMMF defaults without widening string equality', () => {
    expect(prismaNumericDefaultMatches(new Prisma.Decimal('0.00'), 0)).toBe(true);
    expect(prismaNumericDefaultMatches(new Prisma.Decimal('1.25'), 1.25)).toBe(true);
    expect(prismaNumericDefaultMatches(new Prisma.Decimal('1.25'), 1)).toBe(false);
    expect(prismaNumericDefaultMatches('0', 0)).toBe(false);
    expect(prismaNumericDefaultMatches(null, 0)).toBe(false);
  });

  it('binds UUID defaults to the declared RFC 4122 version and canonical form', () => {
    const v4 = '123e4567-e89b-42d3-a456-426614174000';
    expect(schemaGeneratedIdentifierMatches(v4, 'uuid(4)')).toBe(true);
    expect(schemaGeneratedIdentifierMatches(v4, 'uuid')).toBe(true);
    expect(schemaGeneratedIdentifierMatches(v4, 'uuid(7)')).toBe(false);
    expect(schemaGeneratedIdentifierMatches('not-a-uuid', 'uuid(4)')).toBe(false);
    expect(schemaGeneratedIdentifierMatches(v4.toUpperCase(), 'uuid(4)')).toBe(false);
  });

  it('rejects malformed values for the other admitted schema generators', () => {
    expect(schemaGeneratedIdentifierMatches(1, 'autoincrement')).toBe(true);
    expect(schemaGeneratedIdentifierMatches(0, 'autoincrement')).toBe(false);
    expect(schemaGeneratedIdentifierMatches('c123456789012345678901234', 'cuid')).toBe(true);
    expect(schemaGeneratedIdentifierMatches('c-short', 'cuid')).toBe(false);
    expect(schemaGeneratedIdentifierMatches('01ARZ3NDEKTSV4RRFFQ69G5FAV', 'ulid')).toBe(true);
    expect(schemaGeneratedIdentifierMatches('01ARZ3NDEKTSV4RRFFQ69G5FAI', 'ulid')).toBe(false);
    expect(schemaGeneratedIdentifierMatches('anything', 'dbgenerated')).toBe(false);
  });

  it('requires an exact canonical ISO suffix inside the action window', () => {
    const startedAt = new Date('2026-08-25T08:00:00.000Z');
    const finishedAt = new Date('2026-08-25T08:00:02.000Z');
    const prefix = 'Template - ';
    expect(
      canonicalActionIsoSuffixMatches(
        'Template - 2026-08-25T08:00:01.000Z',
        prefix,
        startedAt,
        finishedAt,
      ),
    ).toBe(true);
    expect(
      canonicalActionIsoSuffixMatches(
        'Template - Tue, 25 Aug 2026 08:00:01 GMT',
        prefix,
        startedAt,
        finishedAt,
      ),
    ).toBe(false);
    expect(
      canonicalActionIsoSuffixMatches(
        'Template - 2026-08-25T11:00:01+03:00',
        prefix,
        startedAt,
        finishedAt,
      ),
    ).toBe(false);
    expect(
      canonicalActionIsoSuffixMatches(
        'Auto-computed 2026-08-25T08:00:01.000Z.',
        'Auto-computed ',
        startedAt,
        finishedAt,
        '.',
      ),
    ).toBe(true);
    expect(
      canonicalActionIsoSuffixMatches(
        'Auto-computed 2026-08-25T08:00:01.000Z',
        'Auto-computed ',
        startedAt,
        finishedAt,
        '.',
      ),
    ).toBe(false);
  });

  it('uses local calendar arithmetic rather than a fixed millisecond offset', () => {
    const startedAt = new Date(2026, 2, 28, 10, 0, 0, 0);
    const finishedAt = new Date(2026, 2, 28, 10, 0, 2, 0);
    const expected = new Date(startedAt);
    expected.setDate(expected.getDate() + 1);
    expect(localCalendarDaysActionTimeMatches(expected, 1, startedAt, finishedAt)).toBe(true);
    expect(
      localCalendarDaysActionTimeMatches(
        new Date(expected.getTime() + 60 * 60 * 1_000),
        1,
        startedAt,
        finishedAt,
      ),
    ).toBe(false);
  });

  it('matches explicit UTC day boundaries independently of the process timezone', () => {
    const source = '2026-08-01T12:34:56.789Z';
    expect(utcDayBoundaryMatches('2026-08-01T00:00:00.000Z', source, 'start')).toBe(true);
    expect(utcDayBoundaryMatches('2026-08-01T23:59:59.999Z', source, 'end')).toBe(true);
    expect(utcDayBoundaryMatches('2026-07-31T21:00:00.000Z', source, 'start')).toBe(false);
    expect(utcDayBoundaryMatches('2026-08-01T20:59:59.999Z', source, 'end')).toBe(false);
  });

  it('compares persisted JSON canonically while preserving closed object and ordered array semantics', () => {
    const persisted = {
      steps: [],
      rawPaye: 0,
      pwdRelief: 0,
      residency: 'RESIDENT',
    };
    const declared = {
      rawPaye: 0,
      pwdRelief: 0,
      steps: [],
      residency: 'RESIDENT',
    };

    expect(canonicalPersistedValueMatches(persisted, declared)).toBe(true);
    expect(canonicalPersistedValueMatches({ ...persisted, extra: true }, declared)).toBe(false);
    expect(
      canonicalPersistedValueMatches(
        { ...persisted, steps: [1, 2] },
        { ...declared, steps: [2, 1] },
      ),
    ).toBe(false);
  });
});

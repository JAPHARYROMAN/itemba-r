import {
  containsPersistedSecret,
  PERSISTED_SECRET_PLACEHOLDER,
  redactPersistedSecrets,
  sanitizePersistedValue,
} from './persistent-secret-redaction';

describe('persistent secret redaction', () => {
  it('preserves a scoped vault reference identifier because it is not bearer authority', () => {
    const value = {
      vaultReferenceId: '123e4567-e89b-42d3-a456-426614174000',
      scopeSha256: 'a'.repeat(64),
    };

    expect(sanitizePersistedValue(value)).toEqual({ value, redactionsApplied: false });
  });

  it.each([
    ['password=hunter2', `password=${PERSISTED_SECRET_PLACEHOLDER}`],
    ['password is hunter2', `password is ${PERSISTED_SECRET_PLACEHOLDER}`],
    ['API key equals abc-123', `API key equals ${PERSISTED_SECRET_PLACEHOLDER}`],
    ['enrollmentCode=AAAA-BBBB', `enrollmentCode=${PERSISTED_SECRET_PLACEHOLDER}`],
    [
      'activationCode=AbCdEfGhIjKlMnOpQrStUvWxYz012345',
      `activationCode=${PERSISTED_SECRET_PLACEHOLDER}`,
    ],
    [
      '/mobile-pos/activate?terminal=MPL-ABC123&code=AbCdEfGhIjKlMnOpQrStUvWxYz012345',
      `/mobile-pos/activate?terminal=MPL-ABC123&code=${PERSISTED_SECRET_PLACEHOLDER}`,
    ],
    ['{"clientSecret":"very-secret-value"}', `{"clientSecret":"${PERSISTED_SECRET_PLACEHOLDER}"}`],
    [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abcdefghijklmno.qrstuvwxyz12345',
      `Authorization: Bearer ${PERSISTED_SECRET_PLACEHOLDER}`,
    ],
    [
      'postgres://itemba:do-not-store@db.internal/itemba',
      `postgres://${PERSISTED_SECRET_PLACEHOLDER}@db.internal/itemba`,
    ],
    ['use sk-proj-abcdefghijklmnopqrstuv', `use ${PERSISTED_SECRET_PLACEHOLDER}`],
  ])('redacts %s', (input, expected) => {
    expect(redactPersistedSecrets(input)).toBe(expected);
    expect(containsPersistedSecret(input)).toBe(true);
  });

  it('redacts complete multiline private keys', () => {
    const input = 'before\n-----BEGIN PRIVATE KEY-----\nabc123\n-----END PRIVATE KEY-----\nafter';
    expect(redactPersistedSecrets(input)).toBe(`before\n${PERSISTED_SECRET_PLACEHOLDER}\nafter`);
  });

  it('redacts unlabeled hex credentials instead of assuming they are digests', () => {
    const rawHexSecret = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    expect(redactPersistedSecrets(`credential material ${rawHexSecret}`)).toBe(
      `credential material ${PERSISTED_SECRET_PLACEHOLDER}`,
    );
  });

  it('does not rewrite ordinary operational prose', () => {
    const input = 'Rotate credentials tomorrow and keep the token budget below 20 dollars.';
    expect(redactPersistedSecrets(input)).toBe(input);
    expect(containsPersistedSecret(input)).toBe(false);
    expect(redactPersistedSecrets('CustomerCreditProfilesController_findAll')).toBe(
      'CustomerCreditProfilesController_findAll',
    );
    expect(redactPersistedSecrets('ms_0123456789abcdef0123456789abcdef')).toBe(
      'ms_0123456789abcdef0123456789abcdef',
    );
    expect(redactPersistedSecrets('SOD-2026-000001')).toBe('SOD-2026-000001');
  });

  it('is idempotent over its own placeholder', () => {
    const once = redactPersistedSecrets('password=hunter2');
    expect(redactPersistedSecrets(once)).toBe(once);
    expect(redactPersistedSecrets(PERSISTED_SECRET_PLACEHOLDER)).toBe(PERSISTED_SECRET_PLACEHOLDER);
  });

  it('redacts sensitive JSON keys and opaque credentials recursively', () => {
    const result = sanitizePersistedValue({
      nested: {
        password: 'short',
        note: 'Kf9+qL3zP2_vX8mN7sR4aT6cY1uB0eD5',
        stableId: 'a018f36a-8f88-4e44-a508-31b02c9d9654',
      },
    });

    expect(result.redactionsApplied).toBe(true);
    expect(result.value.nested.password).toBe(PERSISTED_SECRET_PLACEHOLDER);
    expect(result.value.nested.note).toBe(PERSISTED_SECRET_PLACEHOLDER);
    expect(result.value.nested.stableId).toBe('a018f36a-8f88-4e44-a508-31b02c9d9654');
  });

  it('treats an alphanumeric Mobile POS activation code as bearer authority', () => {
    const code = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345';
    const result = sanitizePersistedValue({
      activationCode: code,
      activationPath: `/mobile-pos-lite/activate?activationCode=${code}`,
    });

    expect(result).toEqual({
      value: {
        activationCode: PERSISTED_SECRET_PLACEHOLDER,
        activationPath: `/mobile-pos-lite/activate?activationCode=${PERSISTED_SECRET_PLACEHOLDER}`,
      },
      redactionsApplied: true,
    });
  });

  it('preserves only the six exact SHA-256 journal receipt link fields', () => {
    const receiptHashes = {
      journalPrepareEntryHash: 'a'.repeat(64),
      journalPreparePreviousHash: 'b'.repeat(64),
      journalRecoveryPreparedEntryHash: 'c'.repeat(64),
      journalRecoveryPreparedPreviousHash: 'd'.repeat(64),
      journalEntryHash: 'e'.repeat(64),
      journalPreviousHash: 'f'.repeat(64),
    };

    expect(sanitizePersistedValue(receiptHashes)).toEqual({
      value: receiptHashes,
      redactionsApplied: false,
    });
  });

  it('does not turn arbitrary hash fields or sensitive digest fields into persistence bypasses', () => {
    const result = sanitizePersistedValue({
      journalHeadHash: 'a'.repeat(64),
      arbitraryHash: 'b'.repeat(64),
      nearlyJournalEntryHash: 'c'.repeat(64),
      JournalEntryHash: 'c'.repeat(64),
      ActionTokenSha256: 'd'.repeat(64),
      secretDigest: 'e'.repeat(64),
      contentSha256: 'f'.repeat(64),
    });

    expect(result).toEqual({
      value: {
        journalHeadHash: PERSISTED_SECRET_PLACEHOLDER,
        arbitraryHash: PERSISTED_SECRET_PLACEHOLDER,
        nearlyJournalEntryHash: PERSISTED_SECRET_PLACEHOLDER,
        JournalEntryHash: PERSISTED_SECRET_PLACEHOLDER,
        ActionTokenSha256: PERSISTED_SECRET_PLACEHOLDER,
        secretDigest: PERSISTED_SECRET_PLACEHOLDER,
        contentSha256: 'f'.repeat(64),
      },
      redactionsApplied: true,
    });
  });
});

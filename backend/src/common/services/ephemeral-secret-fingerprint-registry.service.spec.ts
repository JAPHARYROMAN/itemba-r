import { PERSISTED_SECRET_PLACEHOLDER } from '../utils/persistent-secret-redaction';
import { EphemeralSecretFingerprintRegistry } from './ephemeral-secret-fingerprint-registry.service';

describe('EphemeralSecretFingerprintRegistry', () => {
  it('finds exact, embedded, short, and low-entropy declared values', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    registry.register('hunter2');
    registry.register('123456');

    const result = registry.redactText('before-hunter2-after and receipt=xx123456yy');

    expect(result).toEqual({
      value: `before-${PERSISTED_SECRET_PLACEHOLDER}-after and receipt=xx${PERSISTED_SECRET_PLACEHOLDER}yy`,
      redactionsApplied: true,
    });
  });

  it('finds common Base64, Base64url, hex, and URL encodings as substrings', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    const secret = 'hunter2 ???';
    registry.register(secret);
    const bytes = Buffer.from(secret, 'utf8');
    const transformed = [
      bytes.toString('base64'),
      bytes.toString('base64url'),
      bytes.toString('hex'),
      bytes.toString('hex').toUpperCase(),
      encodeURIComponent(secret),
      encodeURIComponent(secret).replace(/%20/gu, '+'),
    ];

    const result = registry.redactText(
      transformed.map((value, index) => `variant-${index}=${value}`).join(';'),
    );

    expect(result.redactionsApplied).toBe(true);
    for (const value of transformed) expect(result.value).not.toContain(value);
    expect(result.value.match(/\[REDACTED SECRET\]/gu)).toHaveLength(transformed.length);
  });

  it('recursively redacts transformed declared values at a JSON boundary', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    registry.register('123456');

    const result = registry.sanitizeValue({
      note: `embedded:${Buffer.from('123456').toString('base64')}:value`,
      nested: [{ raw: 'prefix123456suffix' }],
      prefix123456suffix: 'known secrets in JSON keys are durable too',
      numericCopy: 123456,
    });

    expect(result).toEqual({
      value: {
        note: `embedded:${PERSISTED_SECRET_PLACEHOLDER}:value`,
        nested: [{ raw: `prefix${PERSISTED_SECRET_PLACEHOLDER}suffix` }],
        [`prefix${PERSISTED_SECRET_PLACEHOLDER}suffix`]:
          'known secrets in JSON keys are durable too',
        numericCopy: PERSISTED_SECRET_PLACEHOLDER,
      },
      redactionsApplied: true,
    });
  });

  it('does not retain declared raw values as serializable instance state', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    registry.register('hunter2');

    expect(Reflect.ownKeys(registry)).toEqual([]);
    expect(JSON.stringify(registry)).toBe('{}');
  });

  it('cannot detect an unlabelled value that was never declared secret', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    const input = 'The undeclared value 654321 remains ordinary data to this registry.';

    expect(registry.redactText(input)).toEqual({ value: input, redactionsApplied: false });
  });

  it('does not reintroduce a declared secret through the normal placeholder', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    registry.register('SECRET');

    const result = registry.redactText('before SECRET after');

    expect(result.redactionsApplied).toBe(true);
    expect(result.value).not.toContain('SECRET');
    expect(registry.redactText(result.value)).toEqual({
      value: result.value,
      redactionsApplied: false,
    });
  });

  it('selects a clean replacement for a one-character declared value', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    registry.register('E');

    const result = registry.redactText('BEFORE');

    expect(result.redactionsApplied).toBe(true);
    expect(result.value).not.toContain('E');
    expect(registry.redactText(result.value).redactionsApplied).toBe(false);
  });

  it('removes a match when every nonempty replacement is itself tainted', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    registry.register('[');

    const result = registry.redactText('[');

    expect(result).toEqual({ value: '', redactionsApplied: true });
    expect(registry.redactText(result.value).redactionsApplied).toBe(false);
  });
});

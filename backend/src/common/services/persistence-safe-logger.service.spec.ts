import { EphemeralSecretFingerprintRegistry } from './ephemeral-secret-fingerprint-registry.service';
import { PersistenceSecretGuard } from './persistence-secret-guard.service';
import { sanitizeLogPayload } from './persistence-safe-logger.service';

describe('PersistenceSafeLoggerService', () => {
  it('removes declared raw, embedded, encoded, and numeric copies from log payloads', () => {
    const registry = new EphemeralSecretFingerprintRegistry();
    const guard = new PersistenceSecretGuard(registry);
    const encoded = Buffer.from('123456').toString('base64');
    registry.register('123456');

    const output = sanitizeLogPayload(
      {
        message: 'prefix123456suffix',
        encoded: `prefix${encoded}suffix`,
        numeric: 123456,
      },
      guard,
    );
    const serialized = JSON.stringify(output);

    expect(serialized).not.toContain('123456');
    expect(serialized).not.toContain(encoded);
    expect(registry.redactText(serialized).redactionsApplied).toBe(false);
  });

  it('fails closed for cyclic structured log context', () => {
    const guard = new PersistenceSecretGuard(new EphemeralSecretFingerprintRegistry());
    const value: Record<string, unknown> = {};
    value.self = value;

    expect(sanitizeLogPayload(value, guard)).toBe('[UNSERIALIZABLE LOG CONTEXT]');
  });
});

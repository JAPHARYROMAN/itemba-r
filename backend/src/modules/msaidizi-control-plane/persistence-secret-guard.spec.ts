import { PERSISTED_SECRET_PLACEHOLDER } from '../../common/utils/persistent-secret-redaction';
import { EphemeralSecretFingerprintRegistry } from '../../common/services';
import { PersistenceSecretGuard } from './persistence-secret-guard';

describe('PersistenceSecretGuard', () => {
  let ephemeralSecrets: EphemeralSecretFingerprintRegistry;
  let guard: PersistenceSecretGuard;

  beforeEach(() => {
    ephemeralSecrets = new EphemeralSecretFingerprintRegistry();
    guard = new PersistenceSecretGuard(ephemeralSecrets);
  });

  it('redacts labelled, provider, JWT, and opaque credentials from durable text', () => {
    const input = [
      'password=hunter2',
      'sk-proj-abcdefghijklmnopqrstuvwxyz012345',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
      'Kf9+qL3zP2_vX8mN7sR4aT6cY1uB0eD5',
    ].join(' ');

    const result = guard.sanitizeText(input);

    expect(result.redactionsApplied).toBe(true);
    expect(result.value).not.toContain('hunter2');
    expect(result.value).not.toContain('sk-proj-');
    expect(result.value).not.toContain('eyJhbGci');
    expect(result.value).not.toContain('Kf9+qL3z');
    expect(result.value).toContain(PERSISTED_SECRET_PLACEHOLDER);
  });

  it('redacts sensitive JSON keys and nested free-form values', () => {
    const result = guard.sanitizeJson({
      apiKey: 'plain-value',
      nested: [{ note: 'refresh_token=very-secret-value' }],
    });

    expect(result.redactionsApplied).toBe(true);
    expect(JSON.stringify(result.value)).not.toContain('plain-value');
    expect(JSON.stringify(result.value)).not.toContain('very-secret-value');
  });

  it('redacts declared short secrets and embedded copies at text and JSON boundaries', () => {
    ephemeralSecrets.register('hunter2');
    ephemeralSecrets.register('123456');

    const text = guard.sanitizeText('prefixhunter2suffix / receipt=xx123456yy');
    const json = guard.sanitizeJson({
      note: `wrapped-${Buffer.from('123456').toString('base64')}-value`,
      contentSha256: 'hunter2',
    });

    expect(text.redactionsApplied).toBe(true);
    expect(text.value).not.toContain('hunter2');
    expect(text.value).not.toContain('123456');
    expect(json.redactionsApplied).toBe(true);
    expect(JSON.stringify(json.value)).not.toContain(Buffer.from('123456').toString('base64'));
    expect(JSON.stringify(json.value)).not.toContain('hunter2');
  });

  it('lets declared-secret taint override a typed digest exemption', () => {
    const declared = 'a'.repeat(64);
    ephemeralSecrets.register(declared);

    const result = guard.sanitizeJson({ contentSha256: declared });

    expect(result).toEqual({
      value: { contentSha256: PERSISTED_SECRET_PLACEHOLDER },
      redactionsApplied: true,
    });
  });

  it('re-scans heuristic placeholders so persistence never reintroduces a declared value', () => {
    ephemeralSecrets.register('SECRET');

    const text = guard.sanitizeText('password=hunter2');
    const json = guard.sanitizeJson({ note: 'password=hunter2' });

    expect(text.redactionsApplied).toBe(true);
    expect(text.value).not.toContain('SECRET');
    expect(ephemeralSecrets.redactText(text.value).redactionsApplied).toBe(false);
    expect(JSON.stringify(json.value)).not.toContain('SECRET');
    expect(ephemeralSecrets.sanitizeValue(json.value).redactionsApplied).toBe(false);
  });
});

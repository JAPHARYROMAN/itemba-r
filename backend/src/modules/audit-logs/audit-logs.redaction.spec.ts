import { redactSensitiveFields } from './audit-logs.service';

describe('redactSensitiveFields', () => {
  it('redacts Mobile POS activation material by key', () => {
    expect(
      redactSensitiveFields({
        activationCode: 'ABCD1234EFGH5678IJKL9012MNOP3456',
        activationPath: '/mobile-pos/activate?code=ABCD1234EFGH5678IJKL9012MNOP3456',
        terminalCode: 'TERM-1',
      }),
    ).toEqual({
      activationCode: '[REDACTED]',
      activationPath: '[REDACTED]',
      terminalCode: 'TERM-1',
    });
  });
  it('redacts top-level password field', () => {
    expect(redactSensitiveFields({ email: 'a@b.com', password: 'p@ss' })).toEqual({
      email: 'a@b.com',
      password: '[REDACTED]',
    });
  });

  it('redacts nested secret fields recursively', () => {
    expect(
      redactSensitiveFields({
        user: { email: 'a@b.com', passwordHash: 'argon2$...', nested: { token: 'abc' } },
        meta: { idempotencyKey: 'k1' },
      }),
    ).toEqual({
      user: { email: 'a@b.com', passwordHash: '[REDACTED]', nested: { token: '[REDACTED]' } },
      meta: { idempotencyKey: '[REDACTED]' },
    });
  });

  it('never persists governed artifact payload bytes in audit or host-action projections', () => {
    const payload = Buffer.from('reviewed report payload', 'utf8').toString('base64');
    const redacted = redactSensitiveFields({
      attachment: {
        artifactId: '10000000-0000-4000-8000-000000000007',
        sha256: 'a'.repeat(64),
        contentBase64: payload,
      },
    });

    expect(redacted).toEqual({
      attachment: {
        artifactId: '10000000-0000-4000-8000-000000000007',
        sha256: '[REDACTED SECRET]',
        contentBase64: '[REDACTED]',
      },
    });
    expect(JSON.stringify(redacted)).not.toContain(payload);
  });

  it('redacts inside arrays of objects', () => {
    expect(redactSensitiveFields([{ apiKey: 'k1' }, { apiSecret: 's1', name: 'ok' }])).toEqual([
      { apiKey: '[REDACTED]' },
      { apiSecret: '[REDACTED]', name: 'ok' },
    ]);
  });

  it('catches OTP, PIN, CVV, backup codes, and one-time enrollment codes', () => {
    expect(
      redactSensitiveFields({
        otp: '123456',
        pin: '0000',
        cvv: '123',
        backupCode: 'AAAA-BBBB',
        pairingCode: 'PAIR-ONCE',
        enrollmentCode: 'ENROLL-ONCE',
      }),
    ).toEqual({
      otp: '[REDACTED]',
      pin: '[REDACTED]',
      cvv: '[REDACTED]',
      backupCode: '[REDACTED]',
      pairingCode: '[REDACTED]',
      enrollmentCode: '[REDACTED]',
    });
  });

  it('passes through non-sensitive fields untouched', () => {
    const input = { id: 1, name: 'X', amount: 100, status: 'OK' };
    expect(redactSensitiveFields(input)).toEqual(input);
  });

  it('handles null and undefined', () => {
    expect(redactSensitiveFields(null)).toBeNull();
    expect(redactSensitiveFields(undefined)).toBeUndefined();
  });

  it('caps recursion at depth 10 without returning an uninspected raw subtree', () => {
    const deep: any = {};
    let cur = deep;
    for (let i = 0; i < 50; i++) {
      cur.next = {};
      cur = cur.next;
    }
    cur.password = 'deep-secret-that-must-not-persist';
    const redacted = redactSensitiveFields(deep);
    expect(JSON.stringify(redacted)).not.toContain('deep-secret-that-must-not-persist');
    expect(JSON.stringify(redacted)).toContain('[REDACTED]');
  });
});

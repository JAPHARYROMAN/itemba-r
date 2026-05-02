import { redactSensitiveFields } from './audit-logs.service';

describe('redactSensitiveFields', () => {
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

  it('redacts inside arrays of objects', () => {
    expect(
      redactSensitiveFields([{ apiKey: 'k1' }, { apiSecret: 's1', name: 'ok' }]),
    ).toEqual([{ apiKey: '[REDACTED]' }, { apiSecret: '[REDACTED]', name: 'ok' }]);
  });

  it('catches OTP, PIN, CVV, and backup codes', () => {
    expect(
      redactSensitiveFields({
        otp: '123456',
        pin: '0000',
        cvv: '123',
        backupCode: 'AAAA-BBBB',
      }),
    ).toEqual({
      otp: '[REDACTED]',
      pin: '[REDACTED]',
      cvv: '[REDACTED]',
      backupCode: '[REDACTED]',
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

  it('caps recursion at depth 10 — no stack overflow on cyclic-ish nesting', () => {
    const deep: any = {};
    let cur = deep;
    for (let i = 0; i < 50; i++) {
      cur.next = {};
      cur = cur.next;
    }
    expect(() => redactSensitiveFields(deep)).not.toThrow();
  });
});

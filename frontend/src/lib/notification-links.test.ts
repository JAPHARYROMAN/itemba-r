import { describe, expect, it } from 'vitest';
import { safeNotificationActionUrl } from './notification-links';

describe('safeNotificationActionUrl', () => {
  it('preserves exact internal Msaidizi task and recovery deep links', () => {
    expect(
      safeNotificationActionUrl(
        '/msaidizi?workspace=tasks&taskId=11111111-1111-4111-8111-111111111111',
      ),
    ).toBe('/msaidizi?workspace=tasks&taskId=11111111-1111-4111-8111-111111111111');
    expect(
      safeNotificationActionUrl(
        '/msaidizi?workspace=devices&deviceId=22222222-2222-4222-8222-222222222222&recoveryId=33333333-3333-4333-8333-333333333333',
      ),
    ).toContain('recoveryId=33333333-3333-4333-8333-333333333333');
  });

  it.each([
    'https://attacker.invalid/steal',
    '//attacker.invalid/steal',
    '/\\attacker.invalid/steal',
    'javascript:alert(1)',
    '/msaidizi\nhttps://attacker.invalid',
    null,
    42,
  ])('refuses an unsafe persisted target: %s', (value) => {
    expect(safeNotificationActionUrl(value)).toBeNull();
  });
});

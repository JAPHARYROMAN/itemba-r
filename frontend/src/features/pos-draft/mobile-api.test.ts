import { beforeEach, describe, expect, it } from 'vitest';
import {
  prepareRegistration,
  readPendingRegistration,
  readPendingEnrollment,
  clearPendingRegistration,
} from './mobile-api';

beforeEach(() => localStorage.clear());
describe('durable mobile registration identity', () => {
  it('saves a cryptographic claim and UUID before submission, separately from accepted enrollment', () => {
    const attempt = prepareRegistration('invite', ' Operator A ', 'ADMIN');
    expect(attempt.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(attempt.claimToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(readPendingRegistration()).toEqual({ ...attempt, name: 'Operator A' });
    expect(readPendingEnrollment()).toBeNull();
    expect(prepareRegistration('invite', 'Operator A', 'ADMIN')).toEqual(attempt);
  });
  it.each(['invite', 'name', 'role'])(
    'preserves the unacknowledged identity when its %s changes',
    (field) => {
      const original = prepareRegistration('invite', 'Operator A', 'CASHIER');
      expect(() =>
        prepareRegistration(
          field === 'invite' ? 'other' : 'invite',
          field === 'name' ? 'Operator B' : 'Operator A',
          field === 'role' ? 'STOCKIST' : 'CASHIER',
        ),
      ).toThrow('Retry your saved access request');
      expect(readPendingRegistration()).toEqual(original);
    },
  );
  it('does not clear a newer request when an older acknowledgement arrives', () => {
    const original = prepareRegistration('invite', 'Operator A', 'CASHIER');
    clearPendingRegistration(original.requestId);
    const changed = prepareRegistration('invite', 'Operator B', 'ADMIN');
    clearPendingRegistration(original.requestId);
    expect(readPendingRegistration()).toEqual(changed);
    clearPendingRegistration(changed.requestId);
    expect(readPendingRegistration()).toBeNull();
  });
  it.each([' A ', 'A'.repeat(121)])(
    'does not save or hydrate a name outside the server length limits',
    (name) => {
      expect(() => prepareRegistration('invite', name, 'CASHIER')).toThrow('between 2 and 120');
      expect(readPendingRegistration()).toBeNull();
      localStorage.setItem(
        'itemba.pos.registration-attempt.v1',
        JSON.stringify({
          inviteToken: 'invite',
          name: name.trim(),
          role: 'CASHIER',
          requestId: crypto.randomUUID(),
          claimToken: 'a'.repeat(32),
        }),
      );
      expect(readPendingRegistration()).toBeNull();
    },
  );
});

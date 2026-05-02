import { describe, it, expect } from 'vitest';
import {
  hasPermission,
  hasAnyPermission,
  maskSensitiveValue,
  canViewSensitiveValue,
  SENSITIVE_PERMISSIONS,
} from './permissions';

describe('hasPermission', () => {
  it('returns false on empty/missing permissions', () => {
    expect(hasPermission(null, 'x')).toBe(false);
    expect(hasPermission(undefined, 'x')).toBe(false);
    expect(hasPermission([], 'x')).toBe(false);
  });

  it('matches single permission', () => {
    expect(hasPermission(['a', 'b'], 'a')).toBe(true);
    expect(hasPermission(['a', 'b'], 'c')).toBe(false);
  });

  it('requires ALL permissions when given an array', () => {
    expect(hasPermission(['a', 'b', 'c'], ['a', 'b'])).toBe(true);
    expect(hasPermission(['a', 'b'], ['a', 'c'])).toBe(false);
  });
});

describe('hasAnyPermission', () => {
  it('returns true when ANY required permission is present', () => {
    expect(hasAnyPermission(['a', 'b'], ['x', 'a'])).toBe(true);
  });

  it('returns false when none match', () => {
    expect(hasAnyPermission(['a'], ['x', 'y'])).toBe(false);
  });
});

describe('maskSensitiveValue', () => {
  it('shows the value when canView is true', () => {
    expect(maskSensitiveValue('1,000,000 TZS', true)).toBe('1,000,000 TZS');
    expect(maskSensitiveValue(42, true)).toBe('42');
  });

  it('masks the value when canView is false', () => {
    expect(maskSensitiveValue('1,000,000 TZS', false)).toBe('••••••');
  });

  it('shows em-dash for null/undefined/empty when allowed', () => {
    expect(maskSensitiveValue(null, true)).toBe('—');
    expect(maskSensitiveValue(undefined, true)).toBe('—');
    expect(maskSensitiveValue('', true)).toBe('—');
  });

  it('respects custom mask text', () => {
    expect(maskSensitiveValue('secret', false, 'HIDDEN')).toBe('HIDDEN');
  });
});

describe('canViewSensitiveValue', () => {
  it('returns true when no permission is required', () => {
    expect(canViewSensitiveValue(['x'], null)).toBe(true);
    expect(canViewSensitiveValue(['x'], undefined)).toBe(true);
  });

  it('checks the required permission against the user list', () => {
    expect(canViewSensitiveValue([SENSITIVE_PERMISSIONS.PAYROLL_BI], SENSITIVE_PERMISSIONS.PAYROLL_BI)).toBe(true);
    expect(canViewSensitiveValue([], SENSITIVE_PERMISSIONS.PAYROLL_BI)).toBe(false);
  });
});

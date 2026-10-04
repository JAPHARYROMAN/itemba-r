import { describe, expect, it } from 'vitest';
import {
  mobilePosProxyAllowed,
  mobilePosSetupStartUrl,
  publicMobilePosOperation,
} from './mobile-pos-proxy-policy';

describe('mobile POS proxy confinement', () => {
  it('allows enrolment and draft decisions but never legacy posting or arbitrary ERP access', () => {
    expect(mobilePosProxyAllowed(['mobile-pos-auth', 'invite', 'secret'], 'POST')).toBe(true);
    expect(mobilePosProxyAllowed(['pos-drafts', 'draft', 'approve'], 'POST')).toBe(true);
    for (const path of [
      ['sales-orders'],
      ['auth', 'refresh'],
      ['mobile-pos-lite', 'sales'],
      ['stock-adjustments', 'id', 'post'],
      ['users'],
    ]) {
      expect(mobilePosProxyAllowed(path, 'POST')).toBe(false);
    }
    expect(mobilePosProxyAllowed(['mobile-pos-auth', '..', 'login'], 'POST')).toBe(false);
    expect(mobilePosProxyAllowed(['pos-drafts', '..%2fusers'], 'DELETE')).toBe(false);
  });
  it('marks only initial enrolment and PIN sign-in as unauthenticated', () => {
    expect(publicMobilePosOperation(['mobile-pos-auth', 'setup'])).toBe(true);
    expect(publicMobilePosOperation(['mobile-pos-auth', 'refresh'])).toBe(false);
    expect(publicMobilePosOperation(['mobile-pos-onboarding', 'enrollments'])).toBe(false);
  });
  it('resumes setup without accepting a redirect or script URL', () => {
    expect(mobilePosSetupStartUrl('abcdefghijklmnopqrstuvwxyz123456')).toBe(
      '/mobile-pos/join/abcdefghijklmnopqrstuvwxyz123456',
    );
    for (const input of [
      null,
      '//example.com',
      'javascript:alert(1)',
      '../login',
      'a?next=/users',
    ]) {
      expect(mobilePosSetupStartUrl(input)).toBe('/mobile-pos');
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  backendProxyRequestOriginAllowed,
  buildBackendProxyAllowedOrigins,
} from './backend-proxy-origin';

describe('backend proxy origin guard', () => {
  it('allows the configured frontend origin when the internal request origin differs', () => {
    expect(
      backendProxyRequestOriginAllowed({
        origin: 'https://app.itembagrouptz.com',
        referer: null,
        requestOrigin: 'http://frontend:3000',
        env: {
          NODE_ENV: 'production',
          FRONTEND_URL: 'https://app.itembagrouptz.com',
        },
      }),
    ).toBe(true);
  });

  it('allows comma-separated CORS origins and normalizes path entries to origins', () => {
    const allowed = buildBackendProxyAllowedOrigins('http://frontend:3000', {
      CORS_ORIGIN:
        'https://app.itembagrouptz.com, https://itembagrouptz.com/some/path, https://www.itembagrouptz.com',
    });

    expect(allowed.has('https://app.itembagrouptz.com')).toBe(true);
    expect(allowed.has('https://itembagrouptz.com')).toBe(true);
    expect(allowed.has('https://www.itembagrouptz.com')).toBe(true);
  });

  it('rejects unlisted origins in production', () => {
    expect(
      backendProxyRequestOriginAllowed({
        origin: 'https://attacker.example',
        referer: null,
        requestOrigin: 'http://frontend:3000',
        env: {
          NODE_ENV: 'production',
          FRONTEND_URL: 'https://app.itembagrouptz.com',
        },
      }),
    ).toBe(false);
  });

  it('falls back to referer when origin is absent', () => {
    expect(
      backendProxyRequestOriginAllowed({
        origin: null,
        referer: 'https://app.itembagrouptz.com/finance/receivables',
        requestOrigin: 'http://frontend:3000',
        env: {
          NODE_ENV: 'production',
          APP_URL: 'https://app.itembagrouptz.com',
        },
      }),
    ).toBe(true);
  });
});

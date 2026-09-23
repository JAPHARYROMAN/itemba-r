import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe('middleware route protection', () => {
  it('keeps Fuel Reporting authentication in its standalone portal', () => {
    const res = proxy(request('/fuel-reporting?shift=NIGHT'));
    expect(res.headers.get('location')).toBe(
      'http://localhost/fuel-reporting/login?from=%2Ffuel-reporting%3Fshift%3DNIGHT',
    );
    expect(proxy(request('/fuel-reporting/login')).headers.get('x-middleware-next')).toBe('1');
    expect(proxy(request('/fuel-reporting', 'itemba_auth=1')).status).toBe(307);
    expect(
      proxy(request('/fuel-reporting', 'itemba_access=token')).headers.get('x-middleware-next'),
    ).toBe('1');
    expect(proxy(request('/fuel-reporting/history')).headers.get('location')).toContain(
      '/fuel-reporting/login?',
    );
    expect(proxy(request('/fuel-reporting/login-extra')).status).toBe(307);
  });
  it('redirects unauthenticated dashboard requests to login with return path', () => {
    const res = proxy(request('/dashboard'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login?from=%2Fdashboard');
  });

  it('allows public auth routes without a session cookie', () => {
    const res = proxy(request('/login'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('allows health checks without a session cookie', () => {
    const res = proxy(request('/api/health'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not allow protected routes with only the stale session flag cookie', () => {
    const res = proxy(request('/dashboard', 'itemba_auth=1'));

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost/login?from=%2Fdashboard');
  });

  it('allows protected routes when the access token cookie is present', () => {
    const res = proxy(request('/dashboard', 'itemba_access=token'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });

  it('allows protected routes when only the refresh token cookie is present', () => {
    const res = proxy(request('/dashboard', 'itemba_refresh=token'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

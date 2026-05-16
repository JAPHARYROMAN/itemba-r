import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from './proxy';

function request(path: string, cookie?: string) {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

describe('middleware route protection', () => {
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

  it('allows protected routes when the session flag cookie is present', () => {
    const res = proxy(request('/dashboard', 'itemba_auth=1'));

    expect(res.headers.get('x-middleware-next')).toBe('1');
  });
});

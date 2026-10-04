import { NextRequest, NextResponse } from 'next/server';
import { getBackendInternalUrl } from '@/lib/backend-url';
import { backendProxyRequestOriginAllowed } from '@/lib/backend-proxy-origin';
import { SESSION_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth-cookie-config';
import { mobilePosProxyAllowed, publicMobilePosOperation } from '@/lib/mobile-pos-proxy-policy';
import { refreshMobilePosSession } from '@/lib/server/mobile-pos-refresh';
import { coordinatedRefresh } from '@/lib/server/refresh-coordinator';

const options = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api/mobile-pos',
  maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
};

async function handler(req: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (!mobilePosProxyAllowed(path, req.method))
    return NextResponse.json(
      { message: 'This operation is not available in mobile POS.' },
      { status: 403 },
    );
  const publicOperation = publicMobilePosOperation(path);
  const csrfPath = path.join('/') === 'mobile-pos-auth/csrf';
  if (!['GET', 'HEAD'].includes(req.method)) {
    const originAllowed = backendProxyRequestOriginAllowed({
      origin: req.headers.get('origin'),
      referer: req.headers.get('referer'),
      requestOrigin: req.nextUrl.origin,
      env: process.env,
    });
    const csrf = req.cookies.get('itemba_pos_csrf')?.value;
    const valid = publicOperation
      ? req.headers.get('x-itemba-pos') === '1'
      : !!csrf && csrf === req.headers.get('x-csrf-token');
    if (!originAllowed || !valid)
      return NextResponse.json(
        { message: 'Invalid request origin or security token.' },
        { status: 403 },
      );
  }
  if (csrfPath) {
    const res = NextResponse.json({ ready: true });
    res.cookies.set(
      'itemba_pos_csrf',
      req.cookies.get('itemba_pos_csrf')?.value ?? crypto.randomUUID(),
      { ...options, httpOnly: false, path: '/' },
    );
    return res;
  }
  const pinSession = req.cookies.has('itemba_pos_access') || req.cookies.has('itemba_pos_refresh');
  let access = req.cookies.get(pinSession ? 'itemba_pos_access' : 'itemba_access')?.value;
  const refresh = pinSession
    ? req.cookies.get('itemba_pos_refresh')?.value
    : (req.cookies.get('itemba_refresh')?.value ??
      req.cookies.get('itemba_backend_refresh')?.value);
  if (!publicOperation && !access && !refresh)
    return NextResponse.json({ message: 'Sign in to mobile POS.' }, { status: 401 });
  let body = ['GET', 'HEAD'].includes(req.method) ? undefined : await req.text();
  try {
    if (path.join('/') === 'mobile-pos-auth/refresh') {
      const parsed = body ? JSON.parse(body) : {};
      body = JSON.stringify({
        ...parsed,
        refreshToken: refresh,
        deviceSecret: req.headers.get('x-mobile-pos-device') ?? parsed.deviceSecret,
      });
    }
    if (path.join('/') === 'mobile-pos-auth/logout') {
      const parsed = body ? JSON.parse(body) : {};
      body = JSON.stringify({ ...parsed, refreshToken: refresh });
    }
  } catch {
    return NextResponse.json({ message: 'Invalid JSON body.' }, { status: 400 });
  }
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const key of ['x-mobile-pos-terminal', 'x-mobile-pos-device', 'user-agent']) {
    const value = req.headers.get(key);
    if (value) headers.set(key, value);
  }
  const url = new URL(`${getBackendInternalUrl()}/${path.map(encodeURIComponent).join('/')}`);
  req.nextUrl.searchParams.forEach((value, key) => url.searchParams.set(key, value));
  async function forward(token?: string) {
    if (token) headers.set('Authorization', `Bearer ${token}`);
    else headers.delete('Authorization');
    return fetch(url, { method: req.method, headers, body: body || undefined, cache: 'no-store' });
  }
  let upstream: Response;
  let rotated: { accessToken: string; refreshToken: string } | null = null;
  try {
    upstream = await forward(access);
    if (
      !publicOperation &&
      upstream.status === 401 &&
      refresh &&
      path.join('/') !== 'mobile-pos-auth/refresh'
    ) {
      if (pinSession)
        rotated = await refreshMobilePosSession(
          refresh,
          req.headers.get('x-mobile-pos-device') ?? '',
        );
      else {
        const result = await coordinatedRefresh(refresh, {
          userAgent: req.headers.get('user-agent') ?? undefined,
        });
        if (result.ok)
          rotated = { accessToken: result.accessToken, refreshToken: result.refreshToken };
      }
      if (rotated) {
        access = rotated.accessToken;
        upstream = await forward(access);
      }
    }
  } catch {
    return NextResponse.json(
      { message: 'Unable to reach the server. Your captured work remains on this device.' },
      { status: 502 },
    );
  }
  let res: NextResponse;
  if ((upstream.headers.get('content-type') ?? '').includes('application/json')) {
    const parsed = await upstream.json().catch(() => ({ message: 'Empty server response.' }));
    const data = parsed.data ?? parsed;
    if (
      upstream.ok &&
      typeof data.accessToken === 'string' &&
      typeof data.refreshToken === 'string'
    ) {
      rotated = { accessToken: data.accessToken, refreshToken: data.refreshToken };
      delete data.accessToken;
      delete data.refreshToken;
    }
    res = NextResponse.json(parsed, { status: upstream.status });
  } else {
    res = new NextResponse(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('content-type') ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      },
    });
    const disposition = upstream.headers.get('content-disposition');
    if (disposition) res.headers.set('content-disposition', disposition);
  }
  res.headers.set('Cache-Control', 'no-store');
  if (rotated) {
    if (pinSession || publicOperation || path[0] === 'mobile-pos-auth') {
      res.cookies.set('itemba_pos_access', rotated.accessToken, options);
      res.cookies.set('itemba_pos_refresh', rotated.refreshToken, options);
    } else {
      res.cookies.set('itemba_access', rotated.accessToken, { ...options, path: '/' });
      res.cookies.set('itemba_refresh', rotated.refreshToken, { ...options, path: '/' });
      res.cookies.set('itemba_backend_refresh', rotated.refreshToken, {
        ...options,
        path: '/api/backend',
      });
    }
  }
  if (upstream.ok && path.join('/') === 'mobile-pos-auth/logout') {
    res.cookies.set('itemba_pos_access', '', { ...options, maxAge: 0 });
    res.cookies.set('itemba_pos_refresh', '', { ...options, maxAge: 0 });
  }
  return res;
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;

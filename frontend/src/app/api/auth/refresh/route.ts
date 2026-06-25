import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth-cookie-config';
import { coordinatedRefresh } from '@/lib/server/refresh-coordinator';

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
const REFRESH_COOKIE = 'itemba_refresh';
const BACKEND_REFRESH_COOKIE = 'itemba_backend_refresh';
const AUTH_REFRESH_PATH = '/';
const LEGACY_AUTH_REFRESH_PATH = '/api/auth/refresh';
const BACKEND_REFRESH_PATH = '/api/backend';

function setRefreshCookies(res: NextResponse, refreshToken: string) {
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
    path: AUTH_REFRESH_PATH,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  res.cookies.set(REFRESH_COOKIE, '', {
    ...COOKIE_OPTS,
    path: LEGACY_AUTH_REFRESH_PATH,
    maxAge: 0,
  });
  res.cookies.set(BACKEND_REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
    path: BACKEND_REFRESH_PATH,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

function setSessionCookies(res: NextResponse, req: NextRequest) {
  res.cookies.set('itemba_auth', '1', {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  res.cookies.set('itemba_csrf', req.cookies.get('itemba_csrf')?.value ?? crypto.randomUUID(), {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

function getForwardedFor(req: NextRequest) {
  return req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
}

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: 'No refresh token' }, { status: 401 });
  }

  // Shared with the /api/backend proxy: concurrent proactive + reactive
  // refreshes for the same token coalesce onto one rotation (see
  // refresh-coordinator).
  const outcome = await coordinatedRefresh(refreshToken, {
    forwardedFor: getForwardedFor(req),
    userAgent: req.headers.get('user-agent') ?? undefined,
  });

  if (!outcome.ok) {
    return NextResponse.json(outcome.data, { status: outcome.status });
  }

  const res = NextResponse.json({ success: true });
  res.cookies.set('itemba_access', outcome.accessToken, {
    ...COOKIE_OPTS,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  setRefreshCookies(res, outcome.refreshToken);
  setSessionCookies(res, req);

  return res;
}

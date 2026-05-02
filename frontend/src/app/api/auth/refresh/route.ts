import { NextRequest, NextResponse } from 'next/server';
import { getBackendInternalUrl } from '@/lib/backend-url';

const BACKEND = getBackendInternalUrl();
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
};
const REFRESH_COOKIE = 'itemba_refresh';
const BACKEND_REFRESH_COOKIE = 'itemba_backend_refresh';
const REFRESH_MAX_AGE = 60 * 60 * 24 * 7;
const AUTH_REFRESH_PATH = '/api/auth/refresh';
const BACKEND_REFRESH_PATH = '/api/backend';

function setRefreshCookies(res: NextResponse, refreshToken: string) {
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
    path: AUTH_REFRESH_PATH,
    maxAge: REFRESH_MAX_AGE,
  });
  res.cookies.set(BACKEND_REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
    path: BACKEND_REFRESH_PATH,
    maxAge: REFRESH_MAX_AGE,
  });
}

function clearRefreshCookies(res: NextResponse) {
  res.cookies.set(REFRESH_COOKIE, '', {
    ...COOKIE_OPTS,
    path: AUTH_REFRESH_PATH,
    maxAge: 0,
  });
  res.cookies.set(BACKEND_REFRESH_COOKIE, '', {
    ...COOKIE_OPTS,
    path: BACKEND_REFRESH_PATH,
    maxAge: 0,
  });
}

function getForwardedFor(req: NextRequest) {
  return req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
}

function backendUnavailableResponse() {
  return NextResponse.json({ message: 'Backend service unavailable' }, { status: 502 });
}

export async function POST(req: NextRequest) {
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: 'No refresh token' }, { status: 401 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/auth/refresh`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${refreshToken}`,
        'x-forwarded-for': getForwardedFor(req),
        'user-agent': req.headers.get('user-agent') ?? '',
      },
    });
  } catch {
    return backendUnavailableResponse();
  }

  const data = await upstream
    .json()
    .catch(() => ({ message: 'Backend returned an empty response' }));

  if (!upstream.ok) {
    // Refresh failed — clear all cookies
    const res = NextResponse.json(data, { status: upstream.status });
    res.cookies.delete('itemba_access');
    clearRefreshCookies(res);
    res.cookies.delete('itemba_auth');
    return res;
  }

  const { accessToken, refreshToken: newRefreshToken } = data.data;
  const res = NextResponse.json({ success: true });

  res.cookies.set('itemba_access', accessToken, {
    ...COOKIE_OPTS,
    maxAge: 60 * 15,
  });
  setRefreshCookies(res, newRefreshToken);

  return res;
}

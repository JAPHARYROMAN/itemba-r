import { NextRequest, NextResponse } from 'next/server';
import { getBackendInternalUrl } from '@/lib/backend-url';
import { SESSION_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth-cookie-config';

const BACKEND = getBackendInternalUrl();
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};
const REFRESH_COOKIE = 'itemba_refresh';
const BACKEND_REFRESH_COOKIE = 'itemba_backend_refresh';
const LEGACY_AUTH_REFRESH_PATH = '/api/auth/refresh';
const BACKEND_REFRESH_PATH = '/api/backend';

function backendUnavailableResponse() {
  return NextResponse.json({ message: 'Backend service unavailable' }, { status: 502 });
}

function setRefreshCookies(res: NextResponse, refreshToken: string) {
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
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

async function fetchMe(accessToken: string): Promise<Response> {
  return fetch(`${BACKEND}/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
}

async function refreshAccessToken(req: NextRequest, refreshToken: string) {
  const upstream = await fetch(`${BACKEND}/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      'x-forwarded-for': getForwardedFor(req),
      'user-agent': req.headers.get('user-agent') ?? '',
    },
    cache: 'no-store',
  });
  if (!upstream.ok) return null;
  const data = await upstream.json().catch(() => ({}));
  const { accessToken, refreshToken: newRefreshToken } = data.data ?? {};
  if (!accessToken || !newRefreshToken) return null;
  return { accessToken, refreshToken: newRefreshToken };
}

async function jsonFrom(
  upstream: Response,
  req: NextRequest,
  rotated?: { accessToken: string; refreshToken: string } | null,
) {
  const data = await upstream
    .json()
    .catch(() => ({ message: 'Backend returned an empty response' }));
  const res = NextResponse.json(data, { status: upstream.status });
  if (rotated) {
    res.cookies.set('itemba_access', rotated.accessToken, {
      ...COOKIE_OPTS,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    setRefreshCookies(res, rotated.refreshToken);
    setSessionCookies(res, req);
  }
  return res;
}

export async function GET(req: NextRequest) {
  let accessToken = req.cookies.get('itemba_access')?.value;
  const refreshToken =
    req.cookies.get(REFRESH_COOKIE)?.value ?? req.cookies.get(BACKEND_REFRESH_COOKIE)?.value;

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  let upstream: Response;
  try {
    if (accessToken) {
      upstream = await fetchMe(accessToken);
      if (upstream.ok || upstream.status !== 401 || !refreshToken) {
        return jsonFrom(upstream, req);
      }
    }

    if (!refreshToken) {
      return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
    }

    const rotated = await refreshAccessToken(req, refreshToken);
    if (!rotated) {
      return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
    }
    accessToken = rotated.accessToken;
    upstream = await fetchMe(rotated.accessToken);
    return jsonFrom(upstream, req, rotated);
  } catch {
    return backendUnavailableResponse();
  }
}

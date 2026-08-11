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
const AUTH_REFRESH_PATH = '/';
const BACKEND_REFRESH_PATH = '/api/backend';

function setRefreshCookies(res: NextResponse, refreshToken: string) {
  res.cookies.set(REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
    path: AUTH_REFRESH_PATH,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  res.cookies.set(BACKEND_REFRESH_COOKIE, refreshToken, {
    ...COOKIE_OPTS,
    path: BACKEND_REFRESH_PATH,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
}

function getForwardedFor(req: NextRequest) {
  return req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
}

function backendUnavailableResponse() {
  return NextResponse.json({ message: 'Backend service unavailable' }, { status: 502 });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  if (!body) {
    return NextResponse.json({ message: 'Invalid JSON body' }, { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${BACKEND}/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-forwarded-for': getForwardedFor(req),
        'user-agent': req.headers.get('user-agent') ?? '',
      },
      body: JSON.stringify(body),
    });
  } catch {
    return backendUnavailableResponse();
  }

  const data = await upstream
    .json()
    .catch(() => ({ message: 'Backend returned an empty response' }));

  if (!upstream.ok) {
    return NextResponse.json(data, { status: upstream.status });
  }

  const authData = data.data ?? data;
  const { accessToken, refreshToken } = authData;

  if (!accessToken || !refreshToken) {
    return NextResponse.json(
      { message: 'Backend returned an incomplete authentication response' },
      { status: 502 },
    );
  }

  let user: unknown = null;
  try {
    const meRes = await fetch(`${BACKEND}/auth/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (meRes.ok) {
      const meJson = await meRes.json();
      user = meJson.data ?? meJson;
    }
  } catch {
    // Client can re-fetch the user profile after redirect.
    user = null;
  }

  const res = NextResponse.json({ user });
  const csrfToken = crypto.randomUUID();

  res.cookies.set('itemba_access', accessToken, {
    ...COOKIE_OPTS,
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  setRefreshCookies(res, refreshToken);
  res.cookies.set('itemba_auth', '1', {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  res.cookies.set('itemba_csrf', csrfToken, {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });

  return res;
}

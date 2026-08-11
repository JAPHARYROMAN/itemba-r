import { NextRequest, NextResponse } from 'next/server';
import { getBackendInternalUrl } from '@/lib/backend-url';

const BACKEND = getBackendInternalUrl();
const REFRESH_COOKIE = 'itemba_refresh';
const BACKEND_REFRESH_COOKIE = 'itemba_backend_refresh';
const AUTH_REFRESH_PATH = '/';
const BACKEND_REFRESH_PATH = '/api/backend';
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
};

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

export async function POST(req: NextRequest) {
  const accessToken = req.cookies.get('itemba_access')?.value;
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;

  // Best-effort: tell backend to revoke the refresh token
  if (accessToken && refreshToken) {
    await fetch(`${BACKEND}/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ refreshToken }),
      // Backend revoke is best-effort — cookies are cleared regardless.
    }).catch(() => undefined);
  }

  const res = NextResponse.json({ message: 'Logged out' });
  res.cookies.delete('itemba_access');
  res.cookies.delete('itemba_auth');
  res.cookies.delete('itemba_csrf');
  clearRefreshCookies(res);
  return res;
}

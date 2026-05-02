import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getBackendInternalUrl } from '@/lib/backend-url';

const BACKEND = getBackendInternalUrl();
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
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

function backendUnavailableResponse() {
  return NextResponse.json({ message: 'Backend service unavailable' }, { status: 502 });
}

// In-memory single-flight refresh map keyed by refresh token. When two
// requests in the same Next runtime see a 401 simultaneously, the second one
// waits on the first's refresh promise instead of issuing a parallel /refresh
// call. Without this, parallel refreshes consume each other's tokens and
// trigger refresh-token reuse detection on the backend.
const refreshInFlight = new Map<
  string,
  Promise<{ accessToken: string; refreshToken: string } | null>
>();

function requestOriginAllowed(req: NextRequest): boolean {
  const expectedOrigin = req.nextUrl.origin;
  const origin = req.headers.get('origin');
  if (origin) return origin === expectedOrigin;

  const referer = req.headers.get('referer');
  if (referer) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  return process.env.NODE_ENV !== 'production';
}

function csrfTokenValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('itemba_csrf')?.value;
  const headerToken = req.headers.get('x-csrf-token');
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

async function refreshAccessTokenSingleFlight(
  refreshToken: string,
): Promise<{ accessToken: string; refreshToken: string } | null> {
  // Coalesce concurrent refresh attempts for the same token.
  const existing = refreshInFlight.get(refreshToken);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const upstream = await fetch(`${BACKEND}/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${refreshToken}` },
      });
      if (!upstream.ok) return null;
      const data = await upstream.json();
      const { accessToken, refreshToken: newRefreshToken } = data.data ?? {};
      if (!accessToken || !newRefreshToken) return null;
      return { accessToken, refreshToken: newRefreshToken };
    } catch {
      return null;
    } finally {
      // Always release the slot so a later 401 can refresh again.
      refreshInFlight.delete(refreshToken);
    }
  })();

  refreshInFlight.set(refreshToken, promise);
  return promise;
}

async function forwardToBackend(
  pathSegments: string[],
  req: NextRequest,
  body: string | undefined,
  accessToken: string,
): Promise<Response> {
  const url = new URL(`${BACKEND}/${pathSegments.join('/')}`);
  req.nextUrl.searchParams.forEach((value, key) => url.searchParams.set(key, value));

  const init: RequestInit = {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    cache: 'no-store',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD' && body) {
    init.body = body;
  }
  return fetch(url.toString(), init);
}

async function handler(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  if (UNSAFE_METHODS.has(req.method)) {
    if (!requestOriginAllowed(req)) {
      return NextResponse.json({ message: 'Invalid request origin' }, { status: 403 });
    }
    if (!csrfTokenValid(req)) {
      return NextResponse.json({ message: 'Invalid CSRF token' }, { status: 403 });
    }
  }

  const { path } = await params;
  const cookieStore = await cookies();
  let accessToken = cookieStore.get('itemba_access')?.value;
  const refreshToken =
    cookieStore.get(BACKEND_REFRESH_COOKIE)?.value ?? cookieStore.get(REFRESH_COOKIE)?.value;

  if (!accessToken && !refreshToken) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  // Read body once — we may need it twice (initial call + retry after refresh).
  const body = req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : undefined;

  // First attempt with the current access token (if any).
  let backendRes: Response | null = null;
  if (accessToken) {
    try {
      backendRes = await forwardToBackend(path, req, body, accessToken);
    } catch {
      return backendUnavailableResponse();
    }
  }

  let rotated: { accessToken: string; refreshToken: string } | null = null;

  // If the backend rejected the access token (or we had none), try to refresh
  // and retry the request once. We retry safe methods unconditionally; for
  // unsafe methods we only retry when no body has been observed by the
  // backend (i.e. it returned 401 before processing).
  const shouldRetry =
    refreshToken && (backendRes === null || backendRes.status === 401) && refreshToken.length > 0;

  if (shouldRetry && refreshToken) {
    rotated = await refreshAccessTokenSingleFlight(refreshToken);
    if (rotated) {
      accessToken = rotated.accessToken;
      try {
        backendRes = await forwardToBackend(path, req, body, rotated.accessToken);
      } catch {
        return backendUnavailableResponse();
      }
    }
  }

  if (!backendRes) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const json = await backendRes.json().catch(() => ({}));
  const res = NextResponse.json(json, { status: backendRes.status });

  if (rotated) {
    res.cookies.set('itemba_access', rotated.accessToken, {
      ...COOKIE_OPTS,
      maxAge: 60 * 15,
    });
    setRefreshCookies(res, rotated.refreshToken);
  }

  // If the backend definitively says the session is gone, clear flag + cookies
  // so the client redirects to login on the next navigation.
  if (backendRes.status === 401 && !rotated) {
    res.cookies.delete('itemba_access');
    clearRefreshCookies(res);
    res.cookies.delete('itemba_auth');
    res.cookies.delete('itemba_csrf');
  }

  return res;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;

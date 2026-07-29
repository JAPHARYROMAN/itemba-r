import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { getBackendInternalUrl } from '@/lib/backend-url';
import { SESSION_COOKIE_MAX_AGE_SECONDS } from '@/lib/auth-cookie-config';
import { backendProxyRequestOriginAllowed } from '@/lib/backend-proxy-origin';
import { coordinatedRefresh } from '@/lib/server/refresh-coordinator';

const BACKEND = getBackendInternalUrl();
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
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

function backendUnavailableResponse() {
  return NextResponse.json({ message: 'Backend service unavailable' }, { status: 502 });
}

function requestOriginAllowed(req: NextRequest): boolean {
  return backendProxyRequestOriginAllowed({
    origin: req.headers.get('origin'),
    referer: req.headers.get('referer'),
    requestOrigin: req.nextUrl.origin,
    env: process.env,
  });
}

function getForwardedFor(req: NextRequest) {
  return req.headers.get('x-forwarded-for') ?? req.headers.get('x-real-ip') ?? '';
}

function csrfTokenValid(req: NextRequest): boolean {
  const cookieToken = req.cookies.get('itemba_csrf')?.value;
  const headerToken = req.headers.get('x-csrf-token');
  return Boolean(cookieToken && headerToken && cookieToken === headerToken);
}

async function forwardToBackend(
  pathSegments: string[],
  req: NextRequest,
  body: BodyInit | undefined,
  accessToken: string,
): Promise<Response> {
  const url = new URL(`${BACKEND}/${pathSegments.join('/')}`);
  req.nextUrl.searchParams.forEach((value, key) => url.searchParams.set(key, value));

  const contentType = req.headers.get('content-type');
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };

  // POS terminal credentials are validated by the backend. Keep the proxy
  // allowlist narrow rather than forwarding arbitrary browser headers.
  for (const name of ['x-mobile-pos-terminal', 'x-mobile-pos-device']) {
    const value = req.headers.get(name);
    if (value) headers[name] = value;
  }

  if (body) headers['Content-Type'] = contentType ?? 'application/json';

  const init: RequestInit = {
    method: req.method,
    headers,
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
  const body =
    req.method !== 'GET' && req.method !== 'HEAD'
      ? await req.arrayBuffer().then((buffer) => (buffer.byteLength ? buffer : undefined))
      : undefined;

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
    // Shared with /api/auth/refresh so a reactive (401) refresh and a proactive
    // refresh for the same token coalesce onto one rotation (see
    // refresh-coordinator) instead of double-rotating and tripping reuse detection.
    const outcome = await coordinatedRefresh(refreshToken, {
      forwardedFor: getForwardedFor(req),
      userAgent: req.headers.get('user-agent') ?? undefined,
    });
    if (outcome.ok) {
      rotated = { accessToken: outcome.accessToken, refreshToken: outcome.refreshToken };
      accessToken = outcome.accessToken;
      try {
        backendRes = await forwardToBackend(path, req, body, outcome.accessToken);
      } catch {
        return backendUnavailableResponse();
      }
    }
  }

  if (!backendRes) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
  }

  const contentType = backendRes.headers.get('content-type') ?? '';
  const isJson = contentType.toLowerCase().includes('application/json');
  const res = isJson
    ? NextResponse.json(await backendRes.json().catch(() => ({})), { status: backendRes.status })
    : new NextResponse(backendRes.body, {
        status: backendRes.status,
        headers: passthroughHeaders(backendRes.headers),
      });

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

function passthroughHeaders(headers: Headers) {
  const nextHeaders = new Headers();
  for (const name of ['content-type', 'content-disposition', 'content-length', 'cache-control']) {
    const value = headers.get(name);
    if (value) nextHeaders.set(name, value);
  }
  return nextHeaders;
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;

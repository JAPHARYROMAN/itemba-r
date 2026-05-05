import { NextRequest, NextResponse } from 'next/server';

/** Public routes that do not require authentication. */
// /api/backend/* is excluded: the proxy route handler validates auth via the
// httpOnly itemba_access cookie forwarded as a Bearer token to the backend.
// The backend enforces all permission checks; middleware should not block these.
const PUBLIC_PATHS = ['/login', '/signup', '/api/auth/', '/api/backend/', '/brand/'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow all public routes and static files
  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  // `itemba_auth` is a non-httpOnly flag cookie set alongside the real tokens.
  // It lets the Edge middleware know the user has an active session.
  const isAuthenticated = req.cookies.has('itemba_auth');

  if (!isAuthenticated) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

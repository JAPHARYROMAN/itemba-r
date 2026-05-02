// Single source of truth for the server-side internal backend URL.
//
// Server route handlers (proxy at /api/backend/[...path]/route.ts and the
// /api/auth/* routes) talk to the backend over the internal Docker network
// or localhost — never via the browser-facing public domain. Use this helper
// so all server routes resolve the URL the same way and the contract lives
// in one place.
//
// Convention: the env value MUST include the API prefix (e.g. /api/v1).
// Route handlers append paths like `/auth/login`.
//
// Resolution order:
//   1. BACKEND_INTERNAL_URL  — canonical (server-only)
//   2. BACKEND_URL           — legacy fallback (will be removed)
//   3. http://localhost:3001/api/v1 — local-dev default
//
// Do NOT fall back to NEXT_PUBLIC_API_URL: that variable is for the browser
// bundle and points at the public domain, which would force server-to-server
// traffic out through the internet in production.

const DEFAULT_LOCAL = 'http://localhost:3001/api/v1';

function configuredUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getBackendInternalUrl(): string {
  const url =
    configuredUrl(process.env.BACKEND_INTERNAL_URL) ??
    configuredUrl(process.env.BACKEND_URL) ??
    DEFAULT_LOCAL;
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

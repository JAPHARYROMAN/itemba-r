import { getBackendInternalUrl } from '@/lib/backend-url';

/**
 * Single source of truth for rotating an access/refresh token pair against the
 * backend, shared by BOTH server-side refresh paths:
 *   - the standalone `/api/auth/refresh` route (proactive refresh: tab focus,
 *     visibilitychange, the auth-context timer, and the api-client 401 retry), and
 *   - the `/api/backend/[...path]` proxy's own reactive refresh on a 401.
 *
 * Those paths used to each keep their OWN in-flight map, so when a proactive
 * refresh and a reactive refresh fired at the same moment (classic on returning
 * to an idle tab and immediately acting) the same refresh token was rotated
 * twice. With backend refresh-token rotation + reuse detection, the second
 * rotation tripped REUSE_DETECTED and the whole token family was revoked —
 * surfacing as "Unauthorized" on every subsequent request.
 *
 * This coordinator de-duplicates in two layers within a single Next.js runtime:
 *   1. In-flight coalescing: concurrent callers for the same token share one
 *      upstream /auth/refresh call.
 *   2. Short result cache: a token that was just rotated returns the SAME new
 *      pair for a few seconds instead of rotating again, so a slightly-late
 *      second caller never issues a second rotation.
 *
 * Cross-instance races (multiple replicas) are handled on the backend by a
 * generous rotation grace window; this layer removes the same-instance races.
 */

const BACKEND = getBackendInternalUrl();

export type RefreshOutcome =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; status: number; data: unknown };

interface RefreshMeta {
  forwardedFor?: string;
  userAgent?: string;
}

// Serve a just-completed rotation to near-simultaneous callers presenting the
// same (old) token, so they coalesce onto one rotation instead of each issuing
// their own. Kept short — only long enough to cover the burst of refreshes that
// fire around a single access-token expiry.
const RESULT_CACHE_TTL_MS = 10_000;
const MAX_CACHE_ENTRIES = 256;

const inFlight = new Map<string, Promise<RefreshOutcome>>();
const recent = new Map<string, { outcome: Extract<RefreshOutcome, { ok: true }>; at: number }>();

function pruneRecent(nowMs: number) {
  if (recent.size <= MAX_CACHE_ENTRIES) return;
  for (const [key, value] of recent) {
    if (nowMs - value.at >= RESULT_CACHE_TTL_MS) recent.delete(key);
  }
}

async function rotate(refreshToken: string, meta: RefreshMeta): Promise<RefreshOutcome> {
  const upstream = await fetch(`${BACKEND}/auth/refresh`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${refreshToken}`,
      'x-forwarded-for': meta.forwardedFor ?? '',
      'user-agent': meta.userAgent ?? '',
    },
  });

  const data = await upstream
    .json()
    .catch(() => ({ message: 'Backend returned an empty response' }));

  if (!upstream.ok) {
    return { ok: false, status: upstream.status, data };
  }

  const inner = (data as { data?: { accessToken?: string; refreshToken?: string } })?.data;
  if (!inner?.accessToken || !inner?.refreshToken) {
    return { ok: false, status: 502, data: { message: 'Malformed refresh response' } };
  }

  return { ok: true, accessToken: inner.accessToken, refreshToken: inner.refreshToken };
}

/**
 * Rotate the given refresh token, coalescing concurrent and back-to-back calls
 * for the same token. Only successful rotations are cached; failures are never
 * cached so a transient error cannot poison later retries.
 */
export async function coordinatedRefresh(
  refreshToken: string,
  meta: RefreshMeta = {},
): Promise<RefreshOutcome> {
  const cached = recent.get(refreshToken);
  if (cached && Date.now() - cached.at < RESULT_CACHE_TTL_MS) {
    return cached.outcome;
  }

  const existing = inFlight.get(refreshToken);
  if (existing) return existing;

  const promise = (async (): Promise<RefreshOutcome> => {
    try {
      const outcome = await rotate(refreshToken, meta);
      if (outcome.ok) {
        const now = Date.now();
        recent.set(refreshToken, { outcome, at: now });
        pruneRecent(now);
      }
      return outcome;
    } catch {
      return { ok: false, status: 502, data: { message: 'Backend service unavailable' } };
    } finally {
      inFlight.delete(refreshToken);
    }
  })();

  inFlight.set(refreshToken, promise);
  return promise;
}

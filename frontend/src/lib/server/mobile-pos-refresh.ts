import { createHash } from 'node:crypto';
import { getBackendInternalUrl } from '@/lib/backend-url';

type RefreshResult = { accessToken: string; refreshToken: string } | null;
const rotations = new Map<string, { promise: Promise<RefreshResult>; expires: number }>();

/** Coalesce refresh rotation across windows without mixing normal OS sessions. */
export function refreshMobilePosSession(
  token: string,
  deviceSecret: string,
): Promise<RefreshResult> {
  if (!/^[a-f0-9]{64}$/i.test(deviceSecret)) return Promise.resolve(null);
  const now = Date.now();
  for (const [key, entry] of rotations) if (entry.expires <= now) rotations.delete(key);
  const key = createHash('sha256').update(token).update(deviceSecret).digest('hex');
  const existing = rotations.get(key);
  if (existing) return existing.promise;
  const promise = (async () => {
    try {
      const response = await fetch(`${getBackendInternalUrl()}/mobile-pos-auth/refresh`, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: token, deviceSecret }),
      });
      const body = await response.json();
      const data = body.data ?? body;
      return response.ok &&
        typeof data.accessToken === 'string' &&
        typeof data.refreshToken === 'string'
        ? { accessToken: data.accessToken, refreshToken: data.refreshToken }
        : null;
    } catch {
      return null;
    }
  })();
  rotations.set(key, { promise, expires: now + 10_000 });
  return promise;
}

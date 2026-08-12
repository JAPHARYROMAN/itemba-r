/**
 * Kaunta POS haptics (design direction §2.5) — the ONLY things that vibrate.
 * Scarcity is the signal: four patterns, nothing else.
 *
 * IMPORTANT — user-gesture contract: every export here must only ever be
 * called from user-gesture-driven code paths (tap handlers and their async
 * continuations). Browsers gate `navigator.vibrate` on user activation and
 * silently drop calls outside it; the POS call sites satisfy this because the
 * stamp haptics run inside `completeSale`/`recordPurchase` — invoked from the
 * slab verb's tap — and a post-`await` continuation of that tap still holds
 * the page's sticky user activation. A POS that buzzes on its own would be
 * wrong anyway.
 *
 * Patterns (ms):
 * - tick        15          add-to-cart / quantity commit
 * - stampSent   [30,40,30]  MUHURI, sale/purchase accepted by the office
 * - stampHeld   [80]        MUHURI, sale held on the phone (distinct palm
 *                           signature for queued vs sent — literacy-free)
 * - reject      [60,40,60]  a retried sale was rejected again
 */
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safe-storage';

const STORAGE_KEY = 'itemba-pos-haptics';

/** Validated read: only 'off' disables; anything else means the default ON. */
export function isHapticsEnabled(): boolean {
  return safeLocalStorageGet(STORAGE_KEY) !== 'off';
}

export function setHapticsEnabled(enabled: boolean): void {
  safeLocalStorageSet(STORAGE_KEY, enabled ? 'on' : 'off');
}

function vibrate(pattern: number | number[]): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (!isHapticsEnabled()) return;
  navigator.vibrate(pattern);
}

export function tick(): void {
  vibrate(15);
}

export function stampSent(): void {
  vibrate([30, 40, 30]);
}

export function stampHeld(): void {
  vibrate([80]);
}

export function reject(): void {
  vibrate([60, 40, 60]);
}

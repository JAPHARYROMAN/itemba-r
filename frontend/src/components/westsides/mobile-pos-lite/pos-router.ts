'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Kaunta hash pseudo-router — spec-sales §0.3 (hash-only mandate, amended
 * 2026-08-11). One rule above all others: only `location.hash` ever changes.
 * The service-worker navigate allowlist is an exact-path Set, so a path-shaped
 * pushState (`/mobile-pos/malipo`) would dead-end every offline reload and
 * 404 an online refresh; hashes never reach the server or the SW match.
 *
 * Hash map (Phase 2b subset — Stoo ships Phase 4, so `#stoo`/`#hesabu` are
 * deliberately NOT registered yet and normalize to the root like any unknown
 * hash): `#mauzo` (root/default) · `#malipo` · `#risiti` · `#leo` ·
 * `#leo/foleni` · `#manunuzi` (gated on `session.purchasesEnabled`) ·
 * `#mipangilio`.
 *
 * Stack discipline — the history stack is never deeper than [#mauzo, screen]:
 * - Forward from the root PUSHES; forward between non-root screens REPLACES.
 *   Entering #risiti therefore replaces #malipo, so hardware back can never
 *   re-open the payment screen (Risiti → Mauzo fresh, per the back-map).
 * - Navigating to the root is always `history.back()`, never a push — which
 *   keeps "back on Mauzo exits the PWA" true: no entry of ours sits below the
 *   root, so the final back unwinds out of the app untouched.
 * - Cold-boot deep links manufacture the [#mauzo, deep-link] stack so hardware
 *   back obeys the module back-map (module → Mauzo) instead of exiting.
 *
 * Cold-boot contract (spec-sales §0.3): boot reads `location.hash`. Module
 * hashes are honored as deep links (gated ones only when the session flag
 * permits); flow-interior hashes (`#malipo`/`#risiti`) normalize to `#mauzo`
 * because their state is memory-only and does not survive a cold boot; empty
 * or unknown hashes normalize to `#mauzo` via replaceState. The pathname and
 * query string (QR `?terminal=&code=` login survival) are always preserved.
 */

export type KauntaRoute =
  | 'mauzo'
  | 'malipo'
  | 'risiti'
  | 'leo'
  | 'leo/foleni'
  | 'manunuzi'
  | 'mipangilio';

const ALL_ROUTES: ReadonlySet<string> = new Set([
  'mauzo',
  'malipo',
  'risiti',
  'leo',
  'leo/foleni',
  'manunuzi',
  'mipangilio',
]);

/** Screens a hash may land on directly; `#malipo`/`#risiti` are flow-interior. */
const MODULE_ROUTES: ReadonlySet<KauntaRoute> = new Set<KauntaRoute>([
  'mauzo',
  'leo',
  'leo/foleni',
  'manunuzi',
  'mipangilio',
]);

function routeFromHash(hash: string): KauntaRoute | null {
  const clean = hash.replace(/^#/, '');
  return ALL_ROUTES.has(clean) ? (clean as KauntaRoute) : null;
}

/**
 * The cold-boot (and popstate) normalizer: unknown/empty → root; flow-interior
 * → root (memory-only state); gated modules → root unless the session allows.
 */
export function bootRouteFromHash(hash: string, opts: { purchasesEnabled: boolean }): KauntaRoute {
  const raw = routeFromHash(hash);
  if (!raw || !MODULE_ROUTES.has(raw)) return 'mauzo';
  if (raw === 'manunuzi' && !opts.purchasesEnabled) return 'mauzo';
  return raw;
}

/** Same pathname + query (QR login params survive), only the hash changes. */
function hashUrl(route: KauntaRoute): string {
  return `${window.location.pathname}${window.location.search}#${route}`;
}

export function useKauntaRouter({
  purchasesEnabled,
  onExit,
}: {
  purchasesEnabled: boolean;
  /**
   * Fired once per route change (forward nav and popstate alike), before the
   * new route renders. The shell uses it for the leave-Risiti rule: any exit
   * from the receipt begins a fresh sale, so a stale cart can never ride back
   * into Mauzo and be re-submitted.
   */
  onExit?: (from: KauntaRoute, to: KauntaRoute) => void;
}): { route: KauntaRoute; navigate: (to: KauntaRoute) => void } {
  const [route, setRoute] = useState<KauntaRoute>(() =>
    typeof window === 'undefined'
      ? 'mauzo'
      : bootRouteFromHash(window.location.hash, { purchasesEnabled }),
  );
  // Mirrors kept fresh outside render (event handlers read them); the route
  // mirror is additionally written inside navigate/popstate so back-to-back
  // navigations in one tick never read a stale "from".
  const routeRef = useRef(route);
  const onExitRef = useRef(onExit);
  const purchasesRef = useRef(purchasesEnabled);
  useEffect(() => {
    onExitRef.current = onExit;
    purchasesRef.current = purchasesEnabled;
  });
  // True while a programmatic history.back() is in flight (popstate is async):
  // a second navigate-to-root in that window must not unwind past our root.
  const backPendingRef = useRef(false);

  // Cold boot: canonicalize the address bar, and for deep links manufacture
  // the [#mauzo, deep-link] stack so hardware back lands on the counter.
  useEffect(() => {
    const boot = routeRef.current;
    window.history.replaceState(null, '', hashUrl('mauzo'));
    if (boot !== 'mauzo') window.history.pushState(null, '', hashUrl(boot));
  }, []);

  useEffect(() => {
    const onPop = () => {
      backPendingRef.current = false;
      const from = routeRef.current;
      const raw = routeFromHash(window.location.hash);
      // Re-apply the boot rules on traversal: forward-button trips into
      // flow-interior or gated territory normalize back to the root.
      const next = bootRouteFromHash(window.location.hash, {
        purchasesEnabled: purchasesRef.current,
      });
      if (raw !== next) window.history.replaceState(null, '', hashUrl(next));
      if (from === next) return;
      onExitRef.current?.(from, next);
      routeRef.current = next;
      setRoute(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: KauntaRoute) => {
    const from = routeRef.current;
    if (to === from || backPendingRef.current) return;
    if (to === 'mauzo') {
      // The root is reached by unwinding, never by pushing: the stack
      // discipline guarantees the entry below any non-root screen is #mauzo,
      // and the popstate handler applies the route change + exit hooks.
      backPendingRef.current = true;
      window.history.back();
      return;
    }
    if (from === 'mauzo') window.history.pushState(null, '', hashUrl(to));
    else window.history.replaceState(null, '', hashUrl(to));
    onExitRef.current?.(from, to);
    routeRef.current = to;
    setRoute(to);
  }, []);

  return { route, navigate };
}

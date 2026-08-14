'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Kaunta hash pseudo-router — spec-sales §0.3 (hash-only mandate, amended
 * 2026-08-11). One rule above all others: only `location.hash` ever changes.
 * The service-worker navigate allowlist is an exact-path Set, so a path-shaped
 * pushState (`/mobile-pos/malipo`) would dead-end every offline reload and
 * 404 an online refresh; hashes never reach the server or the SW match.
 *
 * Hash map: `#mauzo` (root/default) · `#malipo` · `#risiti` · `#leo` ·
 * `#leo/foleni` · `#stoo` (all `mobile_pos_lite.use` holders) · `#hesabu`
 * (Phase 5 count mode; entered from Stoo, gated on the session's
 * `stockCountsEnabled`) · `#manunuzi` (gated on `session.purchasesEnabled`) ·
 * `#historia` · `#funga` · `#ripoti` (spec-history-reports; entered from Leo,
 * `mobile_pos_lite.use`) · `#manunuzi/historia` (entered from Manunuzi and
 * gated on the SAME `purchasesEnabled` its parent is) · `#mipangilio`.
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
 * - Hesabu is the one screen whose back-map parent is NOT the root (Hesabu →
 *   Stoo, draft persisting). Its back unwinds to the root and immediately
 *   PUSHES #stoo, which restores the canonical [#mauzo, screen] depth — so the
 *   next back still exits the app rather than walking a growing stack. That
 *   rewrite is only honest while Hesabu is really on screen, which is why a
 *   revoked count permission settles the route onto #stoo below: pushing a
 *   parent that is already rendered would spend a back press on nothing.
 *
 * Cold-boot contract (spec-sales §0.3): boot reads `location.hash`. Module
 * hashes are honored as deep links (gated ones only when the session flag
 * permits); flow-interior hashes normalize to their PARENT, because their
 * state is memory-only (`#malipo`/`#risiti` → `#mauzo`: no cart survives a
 * cold boot) or because entry has to pass a ritual (`#hesabu` → `#stoo`: the
 * draft does survive in IDB, but the resume offer and the queue gate are part
 * of entering). Empty or unknown hashes normalize to `#mauzo` via
 * replaceState. The pathname and query string (QR `?terminal=&code=` login
 * survival) are always preserved.
 */

export type KauntaRoute =
  | 'mauzo'
  | 'malipo'
  | 'risiti'
  | 'leo'
  | 'leo/foleni'
  | 'stoo'
  | 'hesabu'
  | 'manunuzi'
  | 'historia'
  | 'manunuzi/historia'
  | 'funga'
  | 'ripoti'
  | 'mipangilio';

const ALL_ROUTES: ReadonlySet<string> = new Set([
  'mauzo',
  'malipo',
  'risiti',
  'leo',
  'leo/foleni',
  'stoo',
  'hesabu',
  'manunuzi',
  'historia',
  'manunuzi/historia',
  'funga',
  'ripoti',
  'mipangilio',
]);

/**
 * Screens a hash may land on directly; `#malipo`/`#risiti`/`#hesabu` and the
 * four spec-history-reports screens are flow-interior and normalize to their
 * parent below. None of the history/report screens is a module route on
 * purpose: all four are reached from the module whose book they are, and a
 * cold boot or a forward-button trip must land on a parent that fetches rather
 * than on a screen whose data was never asked for.
 */
const MODULE_ROUTES: ReadonlySet<KauntaRoute> = new Set<KauntaRoute>([
  'mauzo',
  'leo',
  'leo/foleni',
  'stoo',
  'manunuzi',
  'mipangilio',
]);

/** The back-map for flow-interior screens (design direction §3). */
const FLOW_PARENT: Partial<Record<KauntaRoute, KauntaRoute>> = {
  malipo: 'mauzo',
  risiti: 'mauzo',
  hesabu: 'stoo',
  // spec-history-reports §2.2. Leo is the day book, so both the sales history
  // and the closing ritual unwind to it; the purchase history belongs to
  // Manunuzi, whose gate it therefore inherits (see bootRouteFromHash).
  historia: 'leo',
  'manunuzi/historia': 'manunuzi',
  funga: 'leo',
  ripoti: 'leo',
};

function routeFromHash(hash: string): KauntaRoute | null {
  const clean = hash.replace(/^#/, '');
  return ALL_ROUTES.has(clean) ? (clean as KauntaRoute) : null;
}

/**
 * The cold-boot (and popstate) normalizer: unknown/empty → root;
 * flow-interior → its back-map parent; gated modules → root unless the session
 * allows.
 *
 * THE GATE RUNS AFTER THE PARENT RESOLUTION, and the order is load-bearing
 * (spec-history-reports §2.2). Until `#manunuzi/historia` existed, every
 * flow-interior route returned early — before the `purchasesEnabled` check —
 * and that was correct only by accident, because `#hesabu`'s parent `stoo` is
 * ungated. A hand-typed or restored `#manunuzi/historia` under the old shape
 * would have resolved a rep's boot straight onto `#manunuzi`, past the gate
 * that is the whole reason the purchase book is managers-only. Resolving
 * first and gating the RESULT means a flow-interior route inherits its
 * parent's permission by construction, whatever is added below it next.
 */
export function bootRouteFromHash(hash: string, opts: { purchasesEnabled: boolean }): KauntaRoute {
  const raw = routeFromHash(hash);
  if (!raw) return 'mauzo';
  const resolved = MODULE_ROUTES.has(raw) ? raw : (FLOW_PARENT[raw] ?? 'mauzo');
  if (resolved === 'manunuzi' && !opts.purchasesEnabled) return 'mauzo';
  return resolved;
}

/** Same pathname + query (QR login params survive), only the hash changes. */
function hashUrl(route: KauntaRoute): string {
  return `${window.location.pathname}${window.location.search}#${route}`;
}

export function useKauntaRouter({
  purchasesEnabled,
  stockCountsEnabled,
  onExit,
}: {
  purchasesEnabled: boolean;
  /**
   * The session's count permission. Only the live route depends on it — the
   * hash normalizer already sends `#hesabu` to its parent — but a session
   * refresh can drop it under a manager standing in count mode, and the route
   * must never name a screen the shell no longer renders.
   */
  stockCountsEnabled: boolean;
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
      // Whether THIS pop is our own navigate-to-root: an explicit request for
      // Mauzo must never be re-routed by the back-map below.
      const programmatic = backPendingRef.current;
      backPendingRef.current = false;
      const from = routeRef.current;
      const raw = routeFromHash(window.location.hash);
      // Re-apply the boot rules on traversal: forward-button trips into
      // flow-interior or gated territory normalize back to their parent.
      let next = bootRouteFromHash(window.location.hash, {
        purchasesEnabled: purchasesRef.current,
      });
      if (raw !== next) window.history.replaceState(null, '', hashUrl(next));
      // Back-map for a screen whose parent is not the root (Hesabu → Stoo):
      // the back already unwound to #mauzo, so push the parent to restore the
      // canonical two-entry stack. Hardware back only — the count receipt's
      // MAUZO MAPYA asks for the counter and must get the counter.
      const parent = programmatic ? undefined : FLOW_PARENT[from];
      if (parent && parent !== 'mauzo' && next === 'mauzo') {
        next = parent;
        window.history.pushState(null, '', hashUrl(next));
      }
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

  // A gate revoked mid-session (a session refresh drops `stock_count` under a
  // manager standing in Hesabu) leaves the route naming a screen the shell
  // falls through: Stoo is what renders. Settle the route on it, so the
  // address bar, the slab and the back-map all describe the same screen —
  // without this, hardware back runs the Hesabu → Stoo rewrite above and
  // pushes the screen already in front of her, and the press reads as dead.
  useEffect(() => {
    if (route === 'hesabu' && !stockCountsEnabled) navigate('stoo');
    // The same rule for the purchase book (spec-history-reports §2.2): a
    // session refresh that drops `mobile_pos_lite.purchase` under a manager
    // standing in the receiving history must not leave the route naming a
    // screen the shell no longer renders. Mauzo, not Manunuzi — the module she
    // came from is gated by the same flag that just went away.
    if (route === 'manunuzi/historia' && !purchasesEnabled) navigate('mauzo');
  }, [navigate, purchasesEnabled, route, stockCountsEnabled]);

  return { route, navigate };
}

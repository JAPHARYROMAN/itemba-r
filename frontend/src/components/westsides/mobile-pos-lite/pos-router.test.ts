/**
 * Kaunta hash pseudo-router — the stack rules the screens cannot reach
 * (docs/pos-reform/spec-sales §0.3 hash-only mandate, design-direction §3
 * back-map). Driven directly because they are about the history stack, not
 * about pixels: the shell suites cover what each route renders.
 *
 * ROUTER-1  Hesabu is the one screen whose back-map parent is not the root:
 *           hardware back lands on Stoo, and the NEXT back still leaves for
 *           the counter — the [#mauzo, screen] depth is restored, not grown.
 * ROUTER-2  A count permission revoked mid-session settles the route on the
 *           screen the shell actually renders, so the manager's next back
 *           press moves her somewhere real instead of re-pushing Stoo over
 *           the Stoo already in front of her.
 * ROUTER-3  The gate-ordering fix (spec-history-reports §2.2): a flow-interior
 *           hash resolves to its parent FIRST and the permission gate runs on
 *           the RESULT, so `#manunuzi/historia` cannot walk a rep into the
 *           purchase module. All four new hashes normalise to their parents.
 * ROUTER-4  A purchase permission revoked while the manager stands in the
 *           receiving history settles the route the way a revoked count does.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { bootRouteFromHash, useKauntaRouter } from './pos-router';

/**
 * Hardware back. jsdom queues the traversal as a task, so the popstate the
 * router listens on lands several macrotasks later — hence the poll rather
 * than a single tick. The handler rewrites the hash synchronously, so the
 * address bar settling is the signal that the route has settled with it.
 */
async function hardwareBack(landsOn: string) {
  window.history.back();
  await waitFor(() => expect(window.location.hash).toBe(landsOn));
}

beforeEach(() => {
  // Boot on Stoo: the manager reached count mode from the branch-stock screen,
  // which is the only door Hesabu has.
  window.history.replaceState(null, '', '/mobile-pos#stoo');
});

/* ------------------------------------------------------------------------ *
 * ROUTER-1
 * ------------------------------------------------------------------------ */
describe('ROUTER-1: Hesabu backs out to Stoo, and Stoo still exits to Mauzo', () => {
  it('spends one back press on the parent and the next on leaving', async () => {
    const { result } = renderHook(() =>
      useKauntaRouter({ purchasesEnabled: true, stockCountsEnabled: true }),
    );
    expect(result.current.route).toBe('stoo');

    act(() => result.current.navigate('hesabu'));
    expect(result.current.route).toBe('hesabu');
    expect(window.location.hash).toBe('#hesabu');

    // The count draft persists behind this; the back-map, not the screen, is
    // what decides where the press goes.
    await hardwareBack('#stoo');
    expect(result.current.route).toBe('stoo');

    // The parent push restored the canonical depth rather than growing it, so
    // the counter is one press away and never two.
    await hardwareBack('#mauzo');
    expect(result.current.route).toBe('mauzo');
  });
});

/* ------------------------------------------------------------------------ *
 * ROUTER-2
 * ------------------------------------------------------------------------ */
describe('ROUTER-2: a revoked count permission settles the route on the real screen', () => {
  it('leaves #hesabu behind, so back is never a press that changes nothing', async () => {
    const { result, rerender } = renderHook(
      ({ stockCountsEnabled }) => useKauntaRouter({ purchasesEnabled: true, stockCountsEnabled }),
      { initialProps: { stockCountsEnabled: true } },
    );
    act(() => result.current.navigate('hesabu'));
    expect(result.current.route).toBe('hesabu');

    // A session refresh drops `mobile_pos_lite.stock_count` under a manager
    // standing in count mode. The shell falls Hesabu through to Stoo, so Stoo
    // is what she is looking at — and the route must say so too.
    rerender({ stockCountsEnabled: false });
    expect(result.current.route).toBe('stoo');
    expect(window.location.hash).toBe('#stoo');

    // One press, one real move. While the route still read `hesabu` this press
    // ran the Hesabu → Stoo rewrite and pushed the screen already on screen:
    // the hash changed, nothing else did, and she had to press twice to leave.
    await hardwareBack('#mauzo');
    expect(result.current.route).toBe('mauzo');
  });
});

/* ------------------------------------------------------------------------ *
 * ROUTER-3
 * ------------------------------------------------------------------------ */
describe('ROUTER-3: the gate runs after the parent resolution', () => {
  it('sends #manunuzi/historia to Mauzo for a rep who has no purchase permission', () => {
    // THE BUG THIS PINS: while the gate ran before the parent resolution, a
    // flow-interior hash returned `FLOW_PARENT[raw]` and never reached the
    // check — so a hand-typed or restored `#manunuzi/historia` booted a rep
    // straight onto `#manunuzi`, past the manager gate that is the entire
    // reason the receiving book is not hers to see. The old shape was correct
    // only by accident: `#hesabu`'s parent `stoo` happens to be ungated.
    expect(bootRouteFromHash('#manunuzi/historia', { purchasesEnabled: false })).toBe('mauzo');
    expect(bootRouteFromHash('#manunuzi', { purchasesEnabled: false })).toBe('mauzo');
  });

  it('honours the same hash for a manager who does', () => {
    // Still flow-interior: a manager gets the MODULE, not the deep screen, so
    // a cold boot lands on a form that fetches rather than on a list whose
    // data was never asked for.
    expect(bootRouteFromHash('#manunuzi/historia', { purchasesEnabled: true })).toBe('manunuzi');
    expect(bootRouteFromHash('#manunuzi', { purchasesEnabled: true })).toBe('manunuzi');
  });

  it('normalises all four new hashes to their back-map parents on a cold boot', () => {
    expect(bootRouteFromHash('#historia', { purchasesEnabled: true })).toBe('leo');
    expect(bootRouteFromHash('#funga', { purchasesEnabled: true })).toBe('leo');
    expect(bootRouteFromHash('#ripoti', { purchasesEnabled: true })).toBe('leo');
    expect(bootRouteFromHash('#manunuzi/historia', { purchasesEnabled: true })).toBe('manunuzi');
    // …and the pre-existing map is untouched by the restructure.
    expect(bootRouteFromHash('#hesabu', { purchasesEnabled: true })).toBe('stoo');
    expect(bootRouteFromHash('#malipo', { purchasesEnabled: true })).toBe('mauzo');
    expect(bootRouteFromHash('#risiti', { purchasesEnabled: true })).toBe('mauzo');
    expect(bootRouteFromHash('#leo/foleni', { purchasesEnabled: true })).toBe('leo/foleni');
    expect(bootRouteFromHash('#nonsense', { purchasesEnabled: true })).toBe('mauzo');
    expect(bootRouteFromHash('', { purchasesEnabled: true })).toBe('mauzo');
  });
});

describe('ROUTER-3b: the new screens unwind to their parents, not out of the app', () => {
  it('spends one back press on Leo and the next on leaving', async () => {
    window.history.replaceState(null, '', '/mobile-pos#leo');
    const { result } = renderHook(() =>
      useKauntaRouter({ purchasesEnabled: true, stockCountsEnabled: true }),
    );
    expect(result.current.route).toBe('leo');

    act(() => result.current.navigate('funga'));
    expect(window.location.hash).toBe('#funga');
    // #funga → #ripoti REPLACES (both are non-root), so hardware back from the
    // report can never re-open the confirm — the Risiti rule, same reason.
    act(() => result.current.navigate('ripoti'));
    expect(window.location.hash).toBe('#ripoti');

    await hardwareBack('#leo');
    expect(result.current.route).toBe('leo');
    // The parent push restored the canonical depth rather than growing it.
    await hardwareBack('#mauzo');
    expect(result.current.route).toBe('mauzo');
  });
});

/* ------------------------------------------------------------------------ *
 * ROUTER-4
 * ------------------------------------------------------------------------ */
describe('ROUTER-4: a revoked purchase permission settles the receiving history', () => {
  it('leaves #manunuzi/historia for Mauzo, never for the module it gates', async () => {
    window.history.replaceState(null, '', '/mobile-pos#manunuzi');
    const { result, rerender } = renderHook(
      ({ purchasesEnabled }) => useKauntaRouter({ purchasesEnabled, stockCountsEnabled: false }),
      { initialProps: { purchasesEnabled: true } },
    );
    act(() => result.current.navigate('manunuzi/historia'));
    expect(result.current.route).toBe('manunuzi/historia');

    // A session refresh drops `mobile_pos_lite.purchase` under a manager
    // standing in the receiving book. Mauzo, not Manunuzi: the module she came
    // from is gated by the very flag that just went away.
    rerender({ purchasesEnabled: false });
    await waitFor(() => expect(result.current.route).toBe('mauzo'));
    expect(window.location.hash).toBe('#mauzo');
  });
});

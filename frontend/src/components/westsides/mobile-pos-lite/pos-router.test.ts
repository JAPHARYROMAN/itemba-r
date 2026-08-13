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
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useKauntaRouter } from './pos-router';

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

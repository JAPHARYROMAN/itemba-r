import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PosHostContext, type PosHost } from './pos-host-context';
import { useKauntaRouter } from '@/components/westsides/mobile-pos-lite/pos-router';
import { usePosStep } from '../ui/use-pos-step';

function transport(hash = '') {
  let current = hash;
  const listeners = new Set<() => void>();
  const host: PosHost = {
    basePath: '/pos',
    ownsInput: () => true,
    router: { replace: vi.fn() },
    history: {
      hash: () => current,
      replace: vi.fn((value: string) => {
        current = value;
      }),
      push: vi.fn((value: string) => {
        current = value;
      }),
      back: vi.fn(),
      listen: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  };
  return {
    host,
    pop: (value: string) => {
      current = value;
      listeners.forEach((fn) => fn());
    },
    wrapper: ({ children }: { children: ReactNode }) => (
      <PosHostContext.Provider value={host}>{children}</PosHostContext.Provider>
    ),
  };
}
describe('hosted POS routing', () => {
  it('uses its instance transport for sale steps and normalises unfinished payments on reload', () => {
    window.history.replaceState(null, '', '/reports?view=health');
    const t = transport('#pos/pay');
    const { result } = renderHook(usePosStep, { wrapper: t.wrapper });
    expect(result.current.step).toBe('sale');
    act(() => result.current.go('pay'));
    expect(t.host.history.push).toHaveBeenCalledWith('#pos/pay');
    act(() => t.pop('#pos/sale'));
    expect(result.current.step).toBe('sale');
    expect(window.location.pathname + window.location.search + window.location.hash).toBe(
      '/reports?view=health',
    );
  });
  it('keeps module navigation local and enforces revoked permissions', () => {
    const t = transport('#stoo');
    const { result, rerender } = renderHook(
      ({ counts }) => useKauntaRouter({ purchasesEnabled: false, stockCountsEnabled: counts }),
      { initialProps: { counts: true }, wrapper: t.wrapper },
    );
    expect(result.current.route).toBe('stoo');
    act(() => result.current.navigate('hesabu'));
    rerender({ counts: false });
    expect(result.current.route).toBe('stoo');
    act(() => t.pop('#manunuzi/historia'));
    expect(result.current.route).toBe('mauzo');
  });
});

import { act, render, renderHook, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { PosHostContext, type PosHost } from './pos-host-context';
import { useKauntaRouter } from '@/components/westsides/mobile-pos-lite/pos-router';
import { usePosStep } from '../ui/use-pos-step';
import { CheckoutRecoveryPanel } from '../ui/CheckoutRecoveryPanel';
import type { PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';

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

describe('recovery focus in the desktop', () => {
  const attempt: PendingMobilePosLiteSale = {
    id: 'saved-sale',
    terminalCode: 'T-001',
    createdAt: '2026-10-03',
    payload: { paymentMethod: 'CASH', idempotencyKey: 'original-sale-request', lines: [] },
  };
  const recovery = (
    <CheckoutRecoveryPanel
      attempt={attempt}
      t={(key) => key}
      lang="en"
      onCheck={async () => ({ state: 'not_found' })}
      onRetry={async () => undefined}
    />
  );

  it('keeps typing focus in another app when an inactive POS window recovers', () => {
    const t = transport();
    t.host.ownsInput = () => false;
    const view = render(
      <>
        <button>Other app</button>
        <PosHostContext.Provider value={t.host}>{null}</PosHostContext.Provider>
      </>,
    );
    screen.getByRole('button', { name: 'Other app' }).focus();
    view.rerender(
      <>
        <button>Other app</button>
        <PosHostContext.Provider value={t.host}>{recovery}</PosHostContext.Provider>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Other app' })).toHaveFocus();
  });

  it('announces the protected sale by focusing its heading in the active POS window', () => {
    const t = transport();
    render(<PosHostContext.Provider value={t.host}>{recovery}</PosHostContext.Provider>);
    expect(screen.getByRole('heading', { name: 'posRecoveryTitle' })).toHaveFocus();
  });
});

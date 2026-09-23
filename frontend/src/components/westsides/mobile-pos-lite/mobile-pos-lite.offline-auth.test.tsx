/**
 * Offline cold start through the auth layer (POS_REMAKE_PLAN_2026-09-23.md
 * §2 invariant 8, §3 P1).
 *
 * The dashboard AuthGate lets a POS path render when the server is
 * unreachable and there is no user. MobilePosLite must then open the till
 * from the terminal binding and the cached session, not refuse the rep
 * because a permission check has no user to ask. A signed-in user who lacks
 * mobile_pos_lite.use, and a signed-out user with the server reachable,
 * must still be refused.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobilePosLite } from './mobile-pos-lite';

const h = vi.hoisted(() => {
  const state = {
    binding: null as null | { terminalCode: string; deviceSecret: string; activatedAt: string },
    session: null as unknown,
  };
  const auth = {
    user: null as null | { permissions: string[] },
    authOffline: false,
  };
  const router = { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
  return {
    state,
    auth,
    router,
    backendGet: vi.fn(),
    backendPost: vi.fn(),
    logout: vi.fn(),
  };
});

vi.mock('next/navigation', () => ({ useRouter: () => h.router }));
vi.mock('@/lib/api-client', () => ({ backendGet: h.backendGet, backendPost: h.backendPost }));
vi.mock('@/components/ui', () => ({ showToast: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    logout: h.logout,
    loading: false,
    user: h.auth.user,
    authOffline: h.auth.authOffline,
    hasPermission: (...perms: string[]) =>
      !!h.auth.user && perms.every((p) => h.auth.user!.permissions.includes(p)),
  }),
}));
vi.mock('@/lib/mobile-pos-lite-store', () => ({
  getMobilePosLiteBinding: vi.fn(async () => h.state.binding),
  clearMobilePosLiteBinding: vi.fn(async () => undefined),
  getMobilePosLiteCatalog: vi.fn(async () => [
    {
      id: 'p-soda',
      name: 'Soda Baridi',
      code: 'SODA',
      barcode: null,
      unitId: 'u1',
      unitSymbol: 'pc',
      sellingPrice: 1200,
      availableStock: 10,
      trackInventory: true,
      imageUrl: null,
    },
  ]),
  saveMobilePosLiteCatalog: vi.fn(async () => undefined),
  getMobilePosLiteSession: vi.fn(async () => h.state.session),
  saveMobilePosLiteSession: vi.fn(async () => undefined),
  getMobilePosLiteFrequents: vi.fn(async () => ({})),
  bumpMobilePosLiteFrequents: vi.fn(async () => ({})),
  enqueueMobilePosLiteSale: vi.fn(async () => undefined),
  getPendingMobilePosLiteSales: vi.fn(async () => []),
  removePendingMobilePosLiteSale: vi.fn(async () => undefined),
  updatePendingMobilePosLiteSaleError: vi.fn(async () => undefined),
  bumpDaylogTally: vi.fn(async () => undefined),
  posDaylogDate: vi.fn(() => '2026-09-23'),
  writeDaylogSent: vi.fn(async () => undefined),
}));

const SESSION = {
  terminal: { id: 't1', code: 'T-001', name: 'Kaunta 1', configVersion: 1, offlineCashEnabled: true },
  company: { id: 'c1', name: 'Duka Ltd', code: 'DL' },
  division: { id: 'd1', name: 'Rejareja', code: 'RJ' },
  branch: { id: 'b1', name: 'Tawi la Kariakoo', code: 'KRK' },
  rep: { id: 'r1', name: 'Asha Rep' },
  paymentMethods: [{ code: 'CASH', label: 'Taslimu', requiresReference: false }],
  purchasesEnabled: false,
};

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

beforeEach(() => {
  h.state.binding = {
    terminalCode: 'T-001',
    deviceSecret: 'secret-1',
    activatedAt: '2026-08-01T00:00:00.000Z',
  };
  h.state.session = SESSION;
  h.backendGet.mockImplementation(async () => {
    throw new TypeError('Failed to fetch');
  });
  h.backendPost.mockImplementation(async () => {
    throw new TypeError('Failed to fetch');
  });
});

afterEach(() => {
  vi.clearAllMocks();
  setOnLine(true);
});

describe('MobilePosLite offline cold start through auth', () => {
  it('opens the till from the cached session when the server is unreachable and there is no user', async () => {
    h.auth.user = null;
    h.auth.authOffline = true;
    setOnLine(false);

    render(<MobilePosLite />);

    expect(await screen.findByText('Tawi la Kariakoo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mauzo Mapya' })).toBeInTheDocument();
    expect(screen.queryByText('Access Restricted')).not.toBeInTheDocument();
  });

  it('still refuses a signed-in user without mobile_pos_lite.use', async () => {
    h.auth.user = { permissions: ['sales_orders.view'] };
    h.auth.authOffline = false;

    render(<MobilePosLite />);

    expect(await screen.findByText('Access Restricted')).toBeInTheDocument();
    expect(h.backendGet).not.toHaveBeenCalled();
  });

  it('does not grant offline grace when the server answered and there is no user', async () => {
    h.auth.user = null;
    h.auth.authOffline = false;

    render(<MobilePosLite />);

    expect(await screen.findByText('Access Restricted')).toBeInTheDocument();
    expect(h.backendGet).not.toHaveBeenCalled();
  });
});

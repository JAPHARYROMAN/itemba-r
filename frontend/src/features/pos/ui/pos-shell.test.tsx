/**
 * New POS on ITEMBA OS (uiVersion 3), driven through the real orchestrator
 * (MobilePosLite) so every money path is the proven one; only the network,
 * IndexedDB and auth are faked. POS_REMAKE_PLAN_2026-09-23.md §8 phase 1-2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobilePosLite } from '@/components/westsides/mobile-pos-lite/mobile-pos-lite';

const h = vi.hoisted(() => {
  const state = {
    binding: null as null | { terminalCode: string; deviceSecret: string; activatedAt: string },
    session: null as unknown,
    outbox: [] as Array<Record<string, unknown>>,
  };
  const router = { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
  return { state, router, backendGet: vi.fn(), backendPost: vi.fn(), logout: vi.fn() };
});

const SODA = {
  id: 'p-soda',
  name: 'Soda Baridi',
  code: 'SODA',
  barcode: '6200001',
  unitId: 'u1',
  unitSymbol: 'pc',
  sellingPrice: 1200,
  availableStock: 48,
  trackInventory: true,
  imageUrl: null,
};
const MAJI = {
  ...SODA,
  id: 'p-maji',
  name: 'Maji ya Uhai',
  code: 'MAJI',
  barcode: null,
  sellingPrice: 1000,
  availableStock: 3,
};

vi.mock('next/navigation', () => ({ useRouter: () => h.router }));
vi.mock('@/lib/api-client', () => ({ backendGet: h.backendGet, backendPost: h.backendPost }));
vi.mock('@/components/ui', () => ({ showToast: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    logout: h.logout,
    loading: false,
    user: { permissions: ['mobile_pos_lite.use'] },
    authOffline: false,
    hasPermission: (...perms: string[]) => perms.every((p) => p === 'mobile_pos_lite.use'),
  }),
}));
vi.mock('@/lib/mobile-pos-lite-store', () => ({
  getMobilePosLiteBinding: vi.fn(async () => h.state.binding),
  clearMobilePosLiteBinding: vi.fn(async () => undefined),
  getMobilePosLiteCatalog: vi.fn(async () => [SODA, MAJI]),
  saveMobilePosLiteCatalog: vi.fn(async () => undefined),
  getMobilePosLiteSession: vi.fn(async () => h.state.session),
  saveMobilePosLiteSession: vi.fn(async () => undefined),
  getMobilePosLiteFrequents: vi.fn(async () => ({ 'p-soda': 5 })),
  bumpMobilePosLiteFrequents: vi.fn(async () => ({})),
  enqueueMobilePosLiteSale: vi.fn(async (sale: Record<string, unknown>) => {
    h.state.outbox.push(sale);
  }),
  getPendingMobilePosLiteSales: vi.fn(async () => [...h.state.outbox]),
  removePendingMobilePosLiteSale: vi.fn(async (id: string) => {
    h.state.outbox = h.state.outbox.filter((item) => item.id !== id);
  }),
  updatePendingMobilePosLiteSaleError: vi.fn(async () => undefined),
  bumpDaylogTally: vi.fn(async () => undefined),
  posDaylogDate: vi.fn(() => '2026-09-23'),
  writeDaylogSent: vi.fn(async () => undefined),
  // Kaunta (v2) boot reads these; the v2 comparison test mounts it.
  readCachedStock: vi.fn(async () => null),
  sweepOrphanDrafts: vi.fn(async () => []),
  getDaylogEntry: vi.fn(async () => null),
}));

function makeSession(uiVersion: number) {
  return {
    terminal: {
      id: 't1',
      code: 'T-001',
      name: 'Kaunta 1',
      configVersion: 1,
      offlineCashEnabled: true,
      uiVersion,
    },
    company: { id: 'c1', name: 'Duka Ltd', code: 'DL' },
    division: { id: 'd1', name: 'Rejareja', code: 'RJ' },
    branch: { id: 'b1', name: 'Kisimani Main', code: 'KSM' },
    rep: { id: 'r1', name: 'Jofu K.' },
    paymentMethods: [
      { code: 'CASH', label: 'Taslimu', requiresReference: false },
      { code: 'MOBILE_MONEY', label: 'M-Pesa', requiresReference: true },
      { code: 'CREDIT', label: 'Mkopo', requiresReference: false },
    ],
    purchasesEnabled: false,
  };
}

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function salesPosts() {
  return h.backendPost.mock.calls.filter(([path]) => path === '/mobile-pos-lite/sales');
}

beforeEach(() => {
  window.history.replaceState(null, '', '/mobile-pos');
  h.state.binding = {
    terminalCode: 'T-001',
    deviceSecret: 'secret-1',
    activatedAt: '2026-08-01T00:00:00.000Z',
  };
  h.state.session = makeSession(3);
  h.state.outbox = [];
  setOnLine(true);
  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return h.state.session;
    if (path === '/mobile-pos-lite/catalog') return [SODA, MAJI];
    if (path === '/mobile-pos-lite/customers')
      return [{ id: 'cu-1', name: 'Asha Duka', customerCode: 'C-01' }];
    return [];
  });
  h.backendPost.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/sales')
      return { id: 'so-1', salesOrderNumber: 'SO-0001', totalAmount: 2400 };
    throw new Error(`Unexpected POST ${path}`);
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

async function boot() {
  const utils = render(<MobilePosLite />);
  await screen.findByText('Kisimani Main · Jofu K.');
  return utils;
}

describe('uiVersion 3 mounts the new POS', () => {
  it('draws the OS shell for a v3 terminal and leaves a v2 terminal on Kaunta', async () => {
    const { container, unmount } = await boot();
    expect(container.querySelector('.pos-app')).not.toBeNull();
    expect(window.location.hash).toBe('#pos/sale');
    unmount();

    h.state.session = makeSession(2);
    const second = render(<MobilePosLite />);
    await waitFor(() =>
      expect(h.backendGet).toHaveBeenCalledWith('/mobile-pos-lite/session', expect.anything()),
    );
    await waitFor(() => expect(second.container.querySelector('.pos-shell')).not.toBeNull());
    expect(second.container.querySelector('.pos-app')).toBeNull();
  });
});

describe('selling on the new POS', () => {
  it('builds a cart, pays in cash and sends lines with no price fields', async () => {
    const user = userEvent.setup();
    await boot();

    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getByRole('button', { name: 'Ongeza Soda Baridi' }));
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    expect(within(cart).getByText('2')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    expect(window.location.hash).toBe('#pos/pay');
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo · TZS 2,400/ }));

    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    expect(screen.getByText('SO-0001')).toBeInTheDocument();
    const [, payload] = salesPosts()[0];
    expect(payload).toMatchObject({
      paymentMethod: 'CASH',
      lines: [{ productId: 'p-soda', quantity: 2 }],
    });
    expect(Object.keys(payload.lines[0]).sort()).toEqual(['productId', 'quantity']);
    expect(window.location.hash).toBe('#pos/done');
  });

  it('adds the top search result on Enter, which is what a keyboard scanner sends', async () => {
    const user = userEvent.setup();
    await boot();
    const search = screen.getByLabelText('Tafuta au skani bidhaa');
    await user.type(search, 'maji{Enter}');
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    expect(within(cart).getByText('Maji ya Uhai')).toBeInTheDocument();
    expect(search).toHaveValue('');
  });

  it('keeps Complete disabled on credit until a customer is picked', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mkopo' }));

    const complete = screen.getByRole('button', { name: /Maliza Mauzo/ });
    expect(complete).toBeDisabled();
    expect(screen.getByText('Chagua mteja wa mauzo haya ya mkopo.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Jina, simu au namba ya mteja'), 'as');
    await user.click(await screen.findByRole('button', { name: /Asha Duka/ }));
    expect(complete).toBeEnabled();
  });

  it('F12 completes the sale from the keyboard', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    fireEvent.keyDown(window, { key: 'F12' });
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    expect(salesPosts()).toHaveLength(1);
  });

  it('never lets a finished sale back into the cart, even via the queue', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });

    await user.click(screen.getByRole('button', { name: 'Mauzo yanayosubiri kutumwa' }));
    await user.click(screen.getByRole('button', { name: /Rudi kwenye mauzo/ }));

    const cart = await screen.findByRole('region', { name: 'Bidhaa za mauzo' });
    expect(within(cart).queryByText('Soda Baridi')).toBeNull();
    fireEvent.keyDown(window, { key: 'F12' });
    expect(salesPosts()).toHaveLength(1);
  });

  it('hardware back from pay returns to the sale with the cart intact', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    expect(window.location.hash).toBe('#pos/pay');

    await act(async () => {
      window.history.back();
      await new Promise((resolve) => window.addEventListener('popstate', resolve, { once: true }));
    });
    expect(window.location.hash).toBe('#pos/sale');
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    expect(within(cart).getByText('Soda Baridi')).toBeInTheDocument();
  });
});

describe('offline custody on the new POS', () => {
  it('holds an offline cash sale on the phone and says so honestly', async () => {
    const user = userEvent.setup();
    await boot();
    setOnLine(false);
    fireEvent(window, new Event('offline'));
    h.backendPost.mockRejectedValue(new TypeError('Failed to fetch'));

    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    expect(screen.getByRole('button', { name: 'M-Pesa' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));

    await screen.findByRole('heading', { name: 'Imehifadhiwa kwenye simu' });
    expect(h.state.outbox).toHaveLength(1);
    expect(h.state.outbox[0]).toMatchObject({
      terminalCode: 'T-001',
      payload: { paymentMethod: 'CASH', lines: [{ productId: 'p-soda', quantity: 1 }] },
    });
    expect(
      screen.getByRole('button', { name: /Hakuna mtandao · 1 yanasubiri kutumwa/ }),
    ).toBeInTheDocument();
  });

  it('shows a refused queued sale in plain words with retry and a confirmed remove', async () => {
    const user = userEvent.setup();
    h.state.outbox = [
      {
        id: 'pend-1',
        terminalCode: 'T-001',
        payload: {
          paymentMethod: 'CASH',
          idempotencyKey: 'k'.repeat(32),
          lines: [{ productId: 'p-soda', quantity: 1 }],
        },
        createdAt: '2026-09-23T09:00:00.000Z',
        lastError: 'Insufficient stock at branch/location for Soda Baridi',
        totalAmount: 1200,
        lineSummary: '1× Soda Baridi',
      },
    ];
    // The boot sync resends it; the server still refuses, so it stays queued.
    h.backendPost.mockRejectedValue(
      new Error('Insufficient stock at branch/location for Soda Baridi'),
    );
    await boot();
    await user.click(await screen.findByRole('button', { name: /1 yanasubiri kutumwa/ }));

    expect(await screen.findByText('Stoo haitoshi kwa bidhaa hii')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jaribu tena' })).toBeInTheDocument();

    // Remove asks first; keeping it destroys nothing.
    await user.click(screen.getByRole('button', { name: 'Ondoa' }));
    expect(screen.getByText('Uondoe mauzo haya?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Yaache' }));
    expect(h.state.outbox).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Ondoa' }));
    await user.click(screen.getByRole('button', { name: 'Ndiyo, ondoa' }));
    await waitFor(() => expect(h.state.outbox).toHaveLength(0));
  });
});

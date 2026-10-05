/**
 * New POS on ITEMBA OS (uiVersion 3), driven through the real orchestrator
 * (MobilePosLite) so every money path is the proven one; only the network,
 * IndexedDB and auth are faked. POS_REMAKE_PLAN_2026-09-23.md §8 phase 1-2.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobilePosLite } from '@/components/westsides/mobile-pos-lite/mobile-pos-lite';
import { deviceDatabase, deviceLocks } from '../core/testing/device-database';
import { PosHostContext, type PosHost } from '../core/pos-host-context';
import { writeCountDraft, savePurchaseDraft } from '@/lib/mobile-pos-lite-store';

const h = vi.hoisted(() => {
  const state = {
    binding: null as null | { terminalCode: string; deviceSecret: string; activatedAt: string },
    session: null as unknown,
    outbox: [] as Array<Record<string, unknown>>,
    drafts: new Map<string, unknown>(),
  };
  const router = { replace: vi.fn(), push: vi.fn(), prefetch: vi.fn(), back: vi.fn() };
  return {
    state,
    router,
    db: null as unknown as IDBDatabase,
    backendGet: vi.fn(),
    backendPost: vi.fn(),
    logout: vi.fn(),
  };
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
    user: { id: 'r1', permissions: ['mobile_pos_lite.use'] },
    authOffline: false,
    hasPermission: (...perms: string[]) => perms.every((p) => p === 'mobile_pos_lite.use'),
  }),
}));
vi.mock('@/lib/mobile-pos-lite-store', () => ({
  openDatabase: async () => h.db,
  getMobilePosLiteBinding: vi.fn(async () => h.state.binding),
  clearMobilePosLiteBinding: vi.fn(async () => undefined),
  getMobilePosLiteCatalog: vi.fn(async () => [SODA, MAJI]),
  saveMobilePosLiteCatalog: vi.fn(async () => undefined),
  getMobilePosLiteSession: vi.fn(async () => h.state.session),
  saveMobilePosLiteSession: vi.fn(async () => undefined),
  getMobilePosLiteFrequents: vi.fn(async () => ({ 'p-soda': 5 })),
  bumpMobilePosLiteFrequents: vi.fn(async () => ({})),
  enqueueMobilePosLiteSale: vi.fn(async (sale: Record<string, unknown>) => {
    h.state.outbox = h.state.outbox.filter((item) => item.id !== sale.id);
    h.state.outbox.push(sale);
  }),
  getPendingMobilePosLiteSales: vi.fn(async () => [...h.state.outbox]),
  removePendingMobilePosLiteSale: vi.fn(async (id: string) => {
    h.state.outbox = h.state.outbox.filter((item) => item.id !== id);
  }),
  updatePendingMobilePosLiteSaleError: vi.fn(async (id: string, lastError: string) => {
    h.state.outbox = h.state.outbox.map((item) => (item.id === id ? { ...item, lastError } : item));
  }),
  bumpDaylogTally: vi.fn(async () => undefined),
  posDaylogDate: vi.fn(() => '2026-09-23'),
  writeDaylogSent: vi.fn(async () => undefined),
  // Kaunta (v2) boot reads these; the v2 comparison test mounts it.
  readCachedStock: vi.fn(async () => null),
  writeCachedStock: vi.fn(async () => undefined),
  readPurchaseDraft: vi.fn(async (code: string) => h.state.drafts.get(code + ':purchase') ?? null),
  savePurchaseDraft: vi.fn(async (code: string, value: unknown) => {
    h.state.drafts.set(code + ':purchase', structuredClone(value));
  }),
  deletePurchaseDraft: vi.fn(async (code: string) => {
    h.state.drafts.delete(code + ':purchase');
  }),
  readCountDraft: vi.fn(async (code: string) => h.state.drafts.get(code + ':count') ?? null),
  writeCountDraft: vi.fn(async (code: string, value: unknown) => {
    h.state.drafts.set(code + ':count', structuredClone(value));
  }),
  clearCountDraft: vi.fn(async (code: string) => {
    h.state.drafts.delete(code + ':count');
  }),
  sweepOrphanDrafts: vi.fn(async () => []),
  getDaylogEntry: vi.fn(async () => null),
}));

function makeSession(uiVersion: number, extra: Record<string, unknown> = {}) {
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
    ...extra,
  };
}

function setOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

function salesPosts() {
  return h.backendPost.mock.calls.filter(([path]) => path === '/mobile-pos-lite/sales');
}

beforeEach(() => {
  localStorage.removeItem('itemba-pos-lang');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  h.db = deviceDatabase().db;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: deviceLocks() });
  sessionStorage.clear();
  window.history.replaceState(null, '', '/mobile-pos');
  h.state.binding = {
    terminalCode: 'T-001',
    deviceSecret: 'secret-1',
    activatedAt: '2026-08-01T00:00:00.000Z',
  };
  h.state.session = makeSession(3);
  h.state.outbox = [];
  h.state.drafts.clear();
  setOnLine(true);
  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return h.state.session;
    if (path === '/mobile-pos-lite/catalog') return [SODA, MAJI];
    if (path === '/mobile-pos-lite/products') return [SODA, MAJI];
    if (path.startsWith('/mobile-pos-lite/sales/requests/')) return { state: 'not_found' };
    if (path === '/mobile-pos-lite/my-sales-today') return { count: 0, totalAmount: 0, sales: [] };
    if (path === '/mobile-pos-lite/stock')
      return {
        asOf: new Date().toISOString(),
        branch: { id: 'b1', name: 'Kisimani Main' },
        items: [],
      };
    if (path.startsWith('/mobile-pos-lite/transactions/'))
      return {
        id: path.split('/').pop(),
        number: 'SO-PAID',
        total: 1200,
        outstanding: 0,
        tenders: [{ method: 'CASH', amount: 1200, reference: null }],
        collections: [],
        returns: [],
        actions: [],
        lines: [],
        canCollect: false,
        canReturn: false,
        canRefund: false,
      };
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
  Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  vi.clearAllMocks();
});

async function boot() {
  const utils = render(<MobilePosLite />);
  await screen.findByText('Kisimani Main · Jofu K.');
  if (utils.container.querySelector('.pos-app'))
    await screen.findAllByRole('button', { name: /Soda Baridi/ });
  return utils;
}

describe('uiVersion 3 mounts the new POS', () => {
  it('draws the OS shell for a v3 terminal and leaves a v2 terminal on Kaunta', async () => {
    const { container, unmount } = await boot();
    expect(container.querySelector('.pos-app')).not.toBeNull();
    // The step hook writes the hash in an effect after the header renders, so
    // wait for it rather than racing it (this failed intermittently in CI).
    await waitFor(() => expect(window.location.hash).toBe('#pos/sale'));
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
  it('requires a named customer for partial payment and submits the reviewed split allocations', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: 'Gawanya malipo / lipa sehemu' }));
    fireEvent.change(screen.getByLabelText('Taslimu'), { target: { value: '500' } });
    fireEvent.change(screen.getByLabelText('M-Pesa'), { target: { value: '400' } });
    await user.type(screen.getByLabelText('Kumbukumbu · M-Pesa'), 'MP-SPLIT');
    expect(screen.getByRole('button', { name: /Maliza Mauzo/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Jina, simu au namba ya mteja'), 'as');
    await user.click(await screen.findByRole('button', { name: /Asha Duka/ }));
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    expect(salesPosts()[0][1]).toMatchObject({
      paymentMethod: 'MIXED',
      expectedTotal: 1200,
      customerId: 'cu-1',
      payments: [
        { method: 'CASH', amount: 500 },
        { method: 'MOBILE_MONEY', amount: 400, reference: 'MP-SPLIT' },
      ],
    });
  });
  it('requires enough received cash and a configured payment reference before completing', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.type(screen.getByLabelText(/Amepokea/), '500');
    expect(screen.getByRole('button', { name: /Maliza Mauzo/ })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'F12' });
    expect(salesPosts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'M-Pesa' }));
    expect(screen.getByRole('button', { name: /Maliza Mauzo/ })).toBeDisabled();
    await user.type(screen.getByLabelText('Kumbukumbu'), 'MP-123');
    expect(screen.getByRole('button', { name: /Maliza Mauzo/ })).toBeEnabled();
  });

  it('opens the menu by keyboard, moves between items and restores focus on Escape', async () => {
    await boot();
    const menu = screen.getByRole('button', { name: 'Menyu' });
    menu.focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getAllByRole('menuitem')[0]).toHaveFocus());
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(screen.getAllByRole('menuitem')[1]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(menu).toHaveFocus();
  });
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

  it('warns, without blocking, when a line asks for more than the stock shows', async () => {
    const user = userEvent.setup();
    await boot();
    await user.type(screen.getByLabelText('Tafuta au skani bidhaa'), 'maji{Enter}');
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    for (let i = 0; i < 2; i += 1) {
      await user.click(screen.getByRole('button', { name: 'Ongeza Maji ya Uhai' }));
    }
    // Three of three left is fine.
    expect(within(cart).queryByText(/Stoo inaonyesha/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Ongeza Maji ya Uhai' }));
    expect(within(cart).getByText('Stoo inaonyesha 3 tu')).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    expect(screen.getByText(/Baadhi ya bidhaa zimezidi stoo/)).toBeInTheDocument();
    // The snapshot can be stale, so the server decides.
    expect(screen.getByRole('button', { name: /Maliza Mauzo · TZS 4,000/ })).toBeEnabled();
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

describe('unpaid work and native transactions', () => {
  it('holds a named cart with customer and payment inputs, sells another cart and resumes it without posting', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: 'M-Pesa' }));
    await user.type(screen.getByLabelText('Kumbukumbu'), 'MP-HELD');
    await user.type(screen.getByPlaceholderText('Jina, simu au namba ya mteja'), 'Asha');
    await user.click(await screen.findByRole('button', { name: /Asha Duka/ }));
    await user.click(screen.getByRole('button', { name: 'Hifadhi kikapu' }));
    const form = screen.getByRole('form', { name: 'Hifadhi kikapu' });
    await user.clear(within(form).getByLabelText('Jina la kikapu'));
    await user.type(within(form).getByLabelText('Jina la kikapu'), 'Asha order');
    await user.type(within(form).getByLabelText('Maelezo (si lazima)'), 'Collect tomorrow');
    await user.click(within(form).getByRole('button', { name: 'Hifadhi kikapu' }));
    await screen.findByText('Kikapu ni tupu. Tafuta au scan bidhaa.');
    expect(salesPosts()).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Maji ya Uhai/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByText('Kikapu ni tupu. Tafuta au scan bidhaa.');
    await user.click(screen.getByRole('button', { name: /Vikapu vilivyohifadhiwa/ }));
    await screen.findByRole('heading', { name: 'Asha order' });
    expect(screen.getByText('Collect tomorrow')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Endelea' }));
    await screen.findByText(/Kikapu kimerejeshwa/);
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    expect(screen.getByLabelText('Kumbukumbu')).toHaveValue('MP-HELD');
    expect(screen.getByText('Asha Duka')).toBeInTheDocument();
    expect(salesPosts()).toHaveLength(1);
    expect((salesPosts()[0][1] as { lines: unknown[] }).lines).toEqual([
      { productId: 'p-maji', quantity: 1 },
    ]);
  });

  it('recovers the acknowledged active unpaid cart after refresh and asks for review before checkout', async () => {
    const user = userEvent.setup();
    const view = await boot();
    await user.click(screen.getByRole('button', { name: /Soda Baridi/ }));
    await waitFor(() =>
      expect(screen.getByText('Kikapu kimehifadhiwa kwenye kifaa')).toBeInTheDocument(),
    );
    view.unmount();
    await boot();
    await screen.findByText(/Kikapu kimerejeshwa/);
    expect(screen.getByLabelText('Idadi ya Soda Baridi')).toHaveTextContent('1');
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    expect(screen.getByRole('button', { name: /Maliza Mauzo/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Nimekagua kikapu hiki' }));
    expect(screen.getByRole('button', { name: /Maliza Mauzo/ })).toBeEnabled();
    expect(salesPosts()).toHaveLength(0);
  });

  it('refreshes restored default prices before review and keeps a failed lookup recoverable', async () => {
    const user = userEvent.setup();
    const view = await boot();
    await user.click(screen.getByRole('button', { name: /Soda Baridi/ }));
    await waitFor(() =>
      expect(screen.getByText('Kikapu kimehifadhiwa kwenye kifaa')).toBeInTheDocument(),
    );
    view.unmount();
    const previous = h.backendGet.getMockImplementation()!;
    let fail = true;
    h.backendGet.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path !== '/mobile-pos-lite/products') return previous(path, ...args);
      if (fail) throw new TypeError('Failed to fetch');
      return [{ ...SODA, sellingPrice: 1500 }, MAJI];
    });
    render(<MobilePosLite />);
    await user.click(
      await screen.findByRole('button', { name: 'Jaribu tena kikapu kilichohifadhiwa' }),
    );
    fail = false;
    await user.click(
      await screen.findByRole('button', { name: 'Jaribu tena kikapu kilichohifadhiwa' }),
    );
    await screen.findByText(/Kikapu kimerejeshwa/);
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    expect(within(cart).getAllByText(/TZS 1,500/).length).toBeGreaterThan(0);
    expect(salesPosts()).toHaveLength(0);
  });

  it('keeps duplicate OS window carts independent and transfers selling control explicitly', async () => {
    const user = userEvent.setup();
    function makeHost(instanceId: string): PosHost {
      return {
        instanceId,
        basePath: '/pos',
        ownsInput: () => true,
        router: h.router,
        history: {
          hash: () => '',
          replace: () => undefined,
          push: () => undefined,
          back: () => undefined,
          listen: () => () => undefined,
        },
      };
    }
    const a = render(
      <PosHostContext.Provider value={makeHost('a')}>
        <MobilePosLite />
      </PosHostContext.Provider>,
    );
    const wa = within(a.container);
    await user.click(await wa.findByRole('button', { name: /Soda Baridi/ }));
    const b = render(
      <PosHostContext.Provider value={makeHost('b')}>
        <MobilePosLite />
      </PosHostContext.Provider>,
    );
    const wb = within(b.container);
    await user.click(await wb.findByRole('button', { name: /Maji ya Uhai/ }));
    expect(wa.getByLabelText('Idadi ya Soda Baridi')).toHaveTextContent('1');
    expect(wb.queryByLabelText('Idadi ya Soda Baridi')).toBeNull();
    await user.click(wb.getAllByRole('button', { name: 'Lipa' })[0]);
    expect(wb.getByRole('button', { name: /Maliza Mauzo/ })).toBeDisabled();
    await user.click(wa.getByRole('button', { name: 'Achia kaunta' }));
    await user.click(wb.getByRole('button', { name: 'Tumia kaunta hii' }));
    await waitFor(() => expect(wb.getByRole('button', { name: /Maliza Mauzo/ })).toBeEnabled());
    expect(wa.getByRole('button', { name: 'Tumia kaunta hii' })).toBeInTheDocument();
    expect(salesPosts()).toHaveLength(0);
  });

  it('searches and filters canonical receipt details without submitting or opening the drawer', async () => {
    const previous = h.backendGet.getMockImplementation()!;
    h.backendGet.mockImplementation(async (path: string, ...args: unknown[]) =>
      path === '/mobile-pos-lite/sales'
        ? {
            days: 7,
            from: '2026-09-27',
            count: 2,
            totalAmount: 2200,
            sales: [
              {
                id: 'paid',
                salesOrderNumber: 'SO-PAID',
                status: 'PAID',
                createdAt: new Date().toISOString(),
                paymentMethod: 'CASH',
                customerName: 'Asha',
                paymentReference: null,
                totalAmount: 1200,
                lines: [
                  {
                    productId: 'p-soda',
                    name: 'Soda Baridi',
                    quantity: 1,
                    unitSymbol: 'pc',
                    unitPrice: 1200,
                    lineTotal: 1200,
                  },
                ],
              },
              {
                id: 'credit',
                salesOrderNumber: 'SO-CREDIT',
                status: 'CREDIT',
                createdAt: new Date().toISOString(),
                paymentMethod: 'CREDIT',
                customerName: 'Juma',
                paymentReference: null,
                totalAmount: 1000,
                lines: [],
              },
            ],
          }
        : previous(path, ...args),
    );
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Miamala' }));
    await user.click(await screen.findByRole('button', { name: /SO-PAID/ }));
    expect(screen.getByRole('heading', { name: 'SO-PAID' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'PDF ya risiti' })).toBeEnabled();
    let printed = '';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      printed = document.querySelector('.pos-receipt')?.textContent ?? '';
    });
    try {
      await user.click(screen.getByRole('button', { name: 'Chapisha risiti tena' }));
      await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
      expect(printed).toContain('SO-PAID');
      expect(printed).toContain('TZS 1,200');
    } finally {
      print.mockRestore();
    }
    await user.selectOptions(screen.getByLabelText('Hali'), 'credit');
    expect(screen.queryByRole('button', { name: /SO-PAID/ })).toBeNull();
    expect(screen.getByRole('button', { name: /SO-CREDIT/ })).toBeInTheDocument();
    await user.type(screen.getByLabelText('Tafuta'), 'missing');
    expect(screen.getByText('Hakuna miamala inayolingana.')).toBeInTheDocument();
    expect(salesPosts()).toHaveLength(0);
  });
});

describe('offline custody on the new POS', () => {
  it('recovers an interrupted mobile-money sale after remount without resubmitting the payment', async () => {
    const user = userEvent.setup();
    const first = await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: 'M-Pesa' }));
    await user.type(screen.getByLabelText('Kumbukumbu'), 'MP-123');
    h.backendPost.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByRole('heading', { name: 'Kagua mauzo yaliyohifadhiwa' });
    expect(h.state.outbox).toHaveLength(1);
    expect(h.state.outbox[0]).toMatchObject({
      requiresReview: true,
      payload: { paymentReference: 'MP-123' },
    });
    first.unmount();
    // A new tab or refreshed desktop host can start without the old pay hash.
    window.history.replaceState(null, '', '/');
    render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Kagua mauzo yaliyohifadhiwa' });
    expect(salesPosts()).toHaveLength(1);
    const previous = h.backendGet.getMockImplementation()!;
    h.backendGet.mockImplementation((path: string, ...args: unknown[]) =>
      path.startsWith('/mobile-pos-lite/sales/requests/')
        ? Promise.resolve({
            state: 'confirmed',
            sale: { id: 'so-paid', salesOrderNumber: 'SO-PAID', totalAmount: 1200 },
          })
        : previous(path, ...args),
    );
    await user.click(screen.getByRole('button', { name: 'Kagua matokeo' }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    expect(screen.getByText('SO-PAID')).toBeInTheDocument();
    const restoredReceipt = screen.getByRole('region', { name: 'Maelezo ya risiti' });
    expect(within(restoredReceipt).getByText(/Soda Baridi/)).toBeInTheDocument();
    expect(within(restoredReceipt).getByText('M-Pesa')).toBeInTheDocument();
    expect(within(restoredReceipt).getByText('MP-123')).toBeInTheDocument();
    expect(salesPosts()).toHaveLength(1);
    expect(h.state.outbox).toHaveLength(0);
  });

  it('requires checking before retry and preserves the original sale request', async () => {
    h.state.session = makeSession(3, {
      terminal: { ...makeSession(3).terminal, offlineCashEnabled: false },
    });
    const user = userEvent.setup();
    await boot();
    h.backendPost.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    fireEvent.keyDown(window, { key: 'F12' });
    await screen.findByRole('heading', { name: 'Kagua mauzo yaliyohifadhiwa' });
    expect(screen.queryByRole('button', { name: 'Jaribu mauzo yaliyohifadhiwa' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Kagua matokeo' }));
    await user.click(await screen.findByRole('button', { name: 'Jaribu mauzo yaliyohifadhiwa' }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    expect(salesPosts()).toHaveLength(2);
    expect(salesPosts()[1][1]).toEqual(salesPosts()[0][1]);
  });

  it('does not replay an acknowledged queued sale on boot, even if prices have since changed', async () => {
    h.state.outbox = [
      {
        id: 'lost-cash',
        terminalCode: 'T-001',
        requiresReview: false,
        createdAt: '2026-10-03',
        payload: {
          paymentMethod: 'CASH',
          idempotencyKey: 'same-sale-key-123456',
          lines: [{ productId: 'p-soda', quantity: 1 }],
        },
      },
    ];
    const previous = h.backendGet.getMockImplementation()!;
    h.backendGet.mockImplementation((path: string, ...args: unknown[]) =>
      path.startsWith('/mobile-pos-lite/sales/requests/')
        ? Promise.resolve({ state: 'confirmed', sale: { id: 'so-paid', totalAmount: 1200 } })
        : previous(path, ...args),
    );
    await boot();
    await waitFor(() => expect(h.state.outbox).toHaveLength(0));
    expect(salesPosts()).toHaveLength(0);
  });

  it.each([true, false])(
    'protects a previous cashier’s sale (review=%s) without exposing its records',
    async (requiresReview) => {
      h.state.outbox = [
        {
          id: 'private-sale',
          ownerId: 'other-rep',
          terminalCode: 'T-001',
          requiresReview,
          createdAt: '2026-10-03',
          lineSummary: 'Private customer product',
          totalAmount: 999,
          payload: {
            paymentMethod: 'MOBILE_MONEY',
            idempotencyKey: 'private-sale-key-1234',
            lines: [],
          },
        },
      ];
      render(<MobilePosLite />);
      await screen.findByRole('alert');
      expect(screen.queryByText('Private customer product')).toBeNull();
      expect(salesPosts()).toHaveLength(0);
    },
  );

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

  it('checks the outcome again before retrying a new-format queued sale', async () => {
    const user = userEvent.setup();
    h.state.outbox = [
      {
        id: 'queued-cash',
        terminalCode: 'T-001',
        requiresReview: false,
        createdAt: '2026-10-03',
        totalAmount: 1200,
        lineSummary: '1× Soda Baridi',
        payload: {
          paymentMethod: 'CASH',
          idempotencyKey: 'k'.repeat(32),
          lines: [{ productId: 'p-soda', quantity: 1 }],
        },
      },
    ];
    h.backendPost.mockRejectedValue(new Error('Insufficient stock for Soda Baridi'));
    await boot();
    await user.click(await screen.findByRole('button', { name: /1 yanasubiri kutumwa/ }));
    await screen.findByRole('button', { name: 'Jaribu tena' });
    const beforeRetry = salesPosts().length;
    const previous = h.backendGet.getMockImplementation()!;
    h.backendGet.mockImplementation((path: string, ...args: unknown[]) =>
      path.startsWith('/mobile-pos-lite/sales/requests/')
        ? Promise.resolve({ state: 'confirmed', sale: { id: 'already-paid', totalAmount: 1200 } })
        : previous(path, ...args),
    );
    await user.click(screen.getByRole('button', { name: 'Jaribu tena' }));
    await waitFor(() => expect(h.state.outbox).toHaveLength(0));
    expect(salesPosts()).toHaveLength(beforeRetry);
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

describe('price editing on the new POS', () => {
  const priceSession = () =>
    makeSession(3, { priceEditEnabled: true, priceEditUnlimited: false, maxPriceDropPct: 10 });

  async function openPriceSheet(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getByRole('button', { name: 'Badilisha bei ya Soda Baridi' }));
    return within(screen.getByRole('dialog', { name: 'Badilisha bei' }));
  }

  it('offers no price change without edit_price', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    expect(screen.queryByRole('button', { name: 'Badilisha bei ya Soda Baridi' })).toBeNull();
  });

  it('lowers a price within the limit without a reason and sends the entered price', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    const sheet = await openPriceSheet(user);
    expect(sheet.getByText('TZS 1,200')).toBeInTheDocument();

    const input = sheet.getByLabelText('Bei mpya');
    await user.clear(input);
    await user.type(input, '1100');
    expect(sheet.getByRole('status')).toHaveTextContent('Punguzo 8.3% · ndani ya kiwango cha 10%');
    expect(sheet.getByRole('button', { name: 'Hifadhi' })).toBeEnabled();
    expect(sheet.queryByRole('group')).toBeNull();
    await user.click(sheet.getByRole('button', { name: 'Hifadhi' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('bei imebadilishwa')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo · TZS 1,100/ }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    const [, payload] = salesPosts()[0];
    expect(payload.lines).toEqual([
      {
        productId: 'p-soda',
        quantity: 1,
        unitPrice: 1100,
        priceReason: undefined,
        priceNote: undefined,
      },
    ]);
  });

  it('will not save a drop past the terminal limit, and says so in percent only', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    const sheet = await openPriceSheet(user);
    const input = sheet.getByLabelText('Bei mpya');
    await user.clear(input);
    await user.type(input, '1000');
    expect(sheet.getByRole('status')).toHaveTextContent('Punguzo 16.7% · zaidi ya kiwango cha 10%');
    expect(sheet.queryByRole('button', { name: 'Mteja wa kudumu' })).toBeNull();
    expect(sheet.getByRole('button', { name: 'Hifadhi' })).toBeDisabled();
  });

  it('lets a price go up without a reason', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    const sheet = await openPriceSheet(user);
    const input = sheet.getByLabelText('Bei mpya');
    await user.clear(input);
    await user.type(input, '1500');
    expect(sheet.getByRole('status')).toHaveTextContent('Ongezeko 25%');
    expect(sheet.getByRole('button', { name: 'Hifadhi' })).toBeEnabled();
  });

  it('restoring the list price sends the line exactly as before price editing', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    let sheet = await openPriceSheet(user);
    await user.clear(sheet.getByLabelText('Bei mpya'));
    await user.type(sheet.getByLabelText('Bei mpya'), '1100');
    await user.click(sheet.getByRole('button', { name: 'Hifadhi' }));

    await user.click(screen.getByRole('button', { name: 'Badilisha bei ya Soda Baridi' }));
    sheet = within(screen.getByRole('dialog', { name: 'Badilisha bei' }));
    await user.click(sheet.getByRole('button', { name: 'Rudisha bei' }));
    expect(screen.queryByText('bei imebadilishwa')).toBeNull();

    fireEvent.keyDown(window, { key: 'F12' });
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    const [, payload] = salesPosts()[0];
    expect(Object.keys(payload.lines[0]).sort()).toEqual(['productId', 'quantity']);
  });

  it('shows the server refusal in Swahili, without any number', async () => {
    h.state.session = priceSession();
    h.backendPost.mockRejectedValue(
      Object.assign(new Error('This price is below the allowed level for this product'), {
        status: 400,
      }),
    );
    const user = userEvent.setup();
    await boot();
    const sheet = await openPriceSheet(user);
    await user.clear(sheet.getByLabelText('Bei mpya'));
    await user.type(sheet.getByLabelText('Bei mpya'), '1100');
    await user.click(sheet.getByRole('button', { name: 'Hifadhi' }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Bei hii hairuhusiwi kwa bidhaa hii.');
    expect(alert.textContent).not.toMatch(/\d/);
  });

  it('F4 opens the price of the last line, and F12 cannot pay while it is open', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    fireEvent.keyDown(window, { key: 'F4' });
    expect(screen.getByRole('dialog', { name: 'Badilisha bei' })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'F12' });
    expect(salesPosts()).toHaveLength(0);
  });

  it('keeps an edited price in an offline-held sale', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    setOnLine(false);
    fireEvent(window, new Event('offline'));
    h.backendPost.mockRejectedValue(new TypeError('Failed to fetch'));

    const sheet = await openPriceSheet(user);
    await user.clear(sheet.getByLabelText('Bei mpya'));
    await user.type(sheet.getByLabelText('Bei mpya'), '1150');
    await user.click(sheet.getByRole('button', { name: 'Hifadhi' }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));

    await screen.findByRole('heading', { name: 'Imehifadhiwa kwenye simu' });
    expect(h.state.outbox[0]).toMatchObject({
      totalAmount: 1150,
      payload: {
        lines: [{ productId: 'p-soda', quantity: 1, unitPrice: 1150 }],
      },
    });
  });
});

describe('hardware on the new POS', () => {
  function scan(code: string) {
    for (const key of code) fireEvent.keyDown(document.body, { key });
    fireEvent.keyDown(document.body, { key: 'Enter' });
  }

  it('adds the exact barcode match when a scanner fires outside a text field', async () => {
    await boot();
    await screen.findAllByRole('button', { name: /Soda Baridi/ });
    (document.activeElement as HTMLElement | null)?.blur();
    scan('6200001');
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    await waitFor(() => expect(within(cart).getByText('Soda Baridi')).toBeInTheDocument());
  });

  it('puts an unknown scan in the search box with a plain note', async () => {
    await boot();
    await screen.findAllByRole('button', { name: /Soda Baridi/ });
    (document.activeElement as HTMLElement | null)?.blur();
    scan('999000111');
    await waitFor(() =>
      expect(
        screen.getAllByRole('status').some((node) => node.textContent?.includes('999000111')),
      ).toBe(true),
    );
    expect(screen.getByLabelText('Tafuta au skani bidhaa')).toHaveValue('999000111');
  });

  it('prefers an exact barcode over the top search result on Enter', async () => {
    const user = userEvent.setup();
    await boot();
    await user.type(screen.getByLabelText('Tafuta au skani bidhaa'), 'SODA{Enter}');
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    expect(within(cart).getByText('Soda Baridi')).toBeInTheDocument();
  });

  it('prints the finished sale through the browser print dialog by default', async () => {
    // What matters is what is on the page at the moment the dialog opens.
    let printed = '';
    let pageRule = '';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      printed = document.querySelector('.pos-receipt')?.textContent ?? '';
      pageRule = document.getElementById('pos-receipt-page')?.textContent ?? '';
    });
    const user = userEvent.setup();
    const { container } = await boot();
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    fireEvent.keyDown(window, { key: 'F12' });
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    expect(container.querySelector('.pos-receipt')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Chapisha risiti' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(printed).toContain('SO-0001');
    expect(printed).toContain('TZS 2,400');
    expect(pageRule).toContain('80mm');
    await waitFor(() => expect(container.querySelector('.pos-receipt')).toBeNull());
    print.mockRestore();
  });

  it('opens the drawer once after a cash sale through a connected printer, and never for credit', async () => {
    const writes: Uint8Array[] = [];
    const port = {
      open: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      writable: {
        getWriter: () => ({
          write: vi.fn(async (bytes: Uint8Array) => {
            writes.push(bytes);
          }),
          releaseLock: vi.fn(),
        }),
      },
    };
    Object.defineProperty(window.navigator, 'serial', {
      configurable: true,
      value: { requestPort: vi.fn(async () => port), getPorts: vi.fn(async () => []) },
    });
    const kick = [0x1b, 0x70, 0x00, 0x19, 0xfa];
    const kicks = () =>
      writes.filter((bytes) =>
        kick.every((byte, i) => bytes[bytes.length - kick.length + i] === byte),
      ).length;

    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Menyu' }));
    await user.click(screen.getByRole('menuitem', { name: 'Printa na droo' }));
    await user.click(screen.getByRole('button', { name: 'Unganisha printa ya USB au serial' }));
    await user.click(await screen.findByRole('checkbox', { name: /Fungua droo ya pesa/ }));
    await user.click(screen.getByRole('button', { name: 'Funga' }));

    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    fireEvent.keyDown(window, { key: 'F12' });
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    await waitFor(() => expect(kicks()).toBe(1));

    // A different order, so only the payment method can keep the drawer shut.
    h.backendPost.mockImplementation(async () => ({
      id: 'so-2',
      salesOrderNumber: 'SO-0002',
      totalAmount: 1200,
    }));
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await user.click(await screen.findByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: 'Mkopo' }));
    await user.type(screen.getByLabelText('Jina, simu au namba ya mteja'), 'as');
    await user.click(await screen.findByRole('button', { name: /Asha Duka/ }));
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    expect(kicks()).toBe(1);

    delete (window.navigator as unknown as { serial?: unknown }).serial;
  });
});

describe('Native stock transactions', () => {
  async function openStock(user: ReturnType<typeof userEvent.setup>, tab: string) {
    localStorage.setItem('itemba-pos-lang', 'en');
    h.state.session = makeSession(3, { purchasesEnabled: true, stockCountsEnabled: true });
    const originalGet = h.backendGet.getMockImplementation()!;
    h.backendGet.mockImplementation(async (path: string, ...args: unknown[]) => {
      if (path === '/mobile-pos-lite/stock')
        return {
          asOf: new Date().toISOString(),
          branch: { id: 'b1', name: 'Kisimani Main' },
          items: [SODA, MAJI].map((p) => ({
            productId: p.id,
            name: p.name,
            code: p.code,
            barcode: p.barcode,
            unitSymbol: 'pc',
            quantityOnHand: 5,
            quantityReserved: 0,
            available: 5,
            threshold: 2,
            status: 'IN_STOCK',
          })),
        };
      if (path === '/mobile-pos-lite/suppliers')
        return [{ id: 'sup-1', name: 'Supplier One', supplierCode: 'SUP-1' }];
      return originalGet(path, ...args);
    });
    await boot();
    await user.click(screen.getByRole('button', { name: 'Stock' }));
    await user.click(screen.getAllByRole('button', { name: tab })[0]);
  }
  it('refreshes stock after returning from selling even when the saved snapshot is still fresh', async () => {
    const user = userEvent.setup();
    await openStock(user, 'Stock');
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: /Soda Baridi/ })).getByText('5'),
      ).toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Sell', exact: true }));
    const original = h.backendGet.getMockImplementation()!;
    h.backendGet.mockImplementation(async (path: string, ...args: unknown[]) => {
      const value = await original(path, ...args);
      if (path !== '/mobile-pos-lite/stock') return value;
      return {
        ...value,
        items: value.items.map((item: any) => ({ ...item, quantityOnHand: 3, available: 3 })),
      };
    });
    await user.click(
      screen
        .getByRole('navigation', { name: 'Counter workspace' })
        .querySelector('button[title="Stock"]') ??
        screen.getByRole('button', { name: 'Stock', exact: true }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole('button', { name: /Soda Baridi/ })).getByText('3'),
      ).toBeInTheDocument(),
    );
  });
  it('keeps counts blind, sends zero but not uncounted products, and shows pending approval honestly', async () => {
    const user = userEvent.setup();
    await openStock(user, 'Stock count');
    const field = await screen.findByRole('spinbutton', { name: 'Counted quantity Soda Baridi' });
    await waitFor(() => expect(field).toBeEnabled());
    expect(screen.queryByText('On hand')).toBeNull();
    await user.type(field, '0');
    h.backendPost.mockResolvedValue({
      adjustmentId: 'sa-1',
      adjustmentNumber: 'SA-1',
      status: 'PENDING_APPROVAL',
      lines: [{ productId: 'p-soda', countedQuantity: 0, systemQuantity: 5, varianceQuantity: -5 }],
    });
    await user.click(screen.getByRole('button', { name: 'REVIEW COUNT' }));
    await user.click(screen.getByRole('button', { name: 'SEND COUNT' }));
    await user.click(screen.getByRole('button', { name: 'Yes, send the count' }));
    await screen.findByRole('heading', { name: 'Waiting for office approval' });
    expect(screen.queryByRole('heading', { name: 'COUNT COMPLETE' })).toBeNull();
    expect(h.backendPost.mock.calls[0][0]).toBe('/mobile-pos-lite/stock-counts');
    expect(h.backendPost.mock.calls[0][1].lines).toEqual([
      { productId: 'p-soda', countedQuantity: 0 },
    ]);
  });
  it('does not post a count when the device refuses to keep its request identity', async () => {
    const user = userEvent.setup();
    await openStock(user, 'Stock count');
    const field = await screen.findByRole('spinbutton', { name: 'Counted quantity Soda Baridi' });
    await waitFor(() => expect(field).toBeEnabled());
    await user.type(field, '4');
    await user.click(screen.getByRole('button', { name: 'REVIEW COUNT' }));
    await user.click(screen.getByRole('button', { name: 'SEND COUNT' }));
    vi.mocked(writeCountDraft).mockRejectedValueOnce(new Error('storage full'));
    await user.click(screen.getByRole('button', { name: 'Yes, send the count' }));
    await screen.findByText(
      'This count is not saved on this phone — it cannot be sent until it is. Try again.',
    );
    expect(h.backendPost).not.toHaveBeenCalled();
  });
  it('freezes receiving inputs after a lost response and retries the same payload and identity', async () => {
    const user = userEvent.setup();
    await openStock(user, 'Receive stock');
    const supplierSearch = screen.getByRole('textbox', { name: 'Supplier name or code' });
    await waitFor(() => expect(supplierSearch).toBeEnabled());
    await user.type(supplierSearch, 'su');
    await user.click(await screen.findByRole('button', { name: /Supplier One/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Find a product' }), 'soda');
    await user.click(screen.getByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getByRole('button', { name: 'Review delivery' }));
    h.backendPost.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await user.click(screen.getByRole('button', { name: 'Confirm and receive' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Confirm and receive' })).toBeEnabled(),
    );
    expect(screen.getByRole('spinbutton', { name: 'Quantity · pc', hidden: true })).toBeDisabled();
    h.backendPost.mockResolvedValueOnce({
      id: 'po-1',
      purchaseOrderNumber: 'PO-1',
      grnNumber: 'GRN-1',
      totalAmount: 1500,
    });
    await user.click(screen.getByRole('button', { name: 'Confirm and receive' }));
    await screen.findByRole('heading', { name: 'Delivery received' });
    const calls = h.backendPost.mock.calls.filter(
      ([path]) => path === '/mobile-pos-lite/purchases',
    );
    expect(calls).toHaveLength(2);
    expect(calls[1][1]).toEqual(calls[0][1]);
    expect(h.state.drafts.has('T-001:purchase')).toBe(false);
  });
  it('blocks receiving when draft persistence fails before submission', async () => {
    const user = userEvent.setup();
    await openStock(user, 'Receive stock');
    const supplierSearch = screen.getByRole('textbox', { name: 'Supplier name or code' });
    await waitFor(() => expect(supplierSearch).toBeEnabled());
    await user.type(supplierSearch, 'su');
    await user.click(await screen.findByRole('button', { name: /Supplier One/ }));
    await user.type(screen.getByRole('searchbox', { name: 'Find a product' }), 'soda');
    await user.click(screen.getByRole('button', { name: /Soda Baridi/ }));
    await user.click(screen.getByRole('button', { name: 'Review delivery' }));
    vi.mocked(savePurchaseDraft).mockRejectedValueOnce(new Error('storage full'));
    await user.click(screen.getByRole('button', { name: 'Confirm and receive' }));
    await screen.findAllByText('The slip was not saved on this phone — try again.');
    expect(h.backendPost).not.toHaveBeenCalled();
  });
  it('restores an unsubmitted delivery as editable and keeps it while switching workspaces', async () => {
    h.state.drafts.set('T-001:purchase', {
      type: 'purchase',
      terminalCode: 'T-001',
      idempotencyKey: 'unsubmitted-delivery',
      attempted: false,
      supplierId: 'sup-1',
      supplierName: 'Supplier One',
      savedAt: Date.now(),
      lines: [{ productId: 'p-soda', name: 'Soda Baridi', unitSymbol: 'pc', quantity: 2 }],
    });
    const user = userEvent.setup();
    await openStock(user, 'Receive stock');
    const field = await screen.findByRole('spinbutton', { name: 'Quantity · pc' });
    await waitFor(() => expect(field).toBeEnabled());
    expect(field).toHaveValue(2);
    await user.clear(field);
    await user.type(field, '3');
    await user.click(screen.getByRole('button', { name: 'Sell', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Stock', exact: true }));
    await user.click(screen.getAllByRole('button', { name: 'Receive stock', exact: true })[0]);
    expect(screen.getByRole('spinbutton', { name: 'Quantity · pc' })).toHaveValue(3);
    expect(screen.getByRole('button', { name: 'Discard draft', exact: true })).toBeEnabled();
    expect(h.backendPost).not.toHaveBeenCalled();
  });
  it('prevents a second OS window from opening a writer over the controlling delivery draft', async () => {
    h.state.drafts.set('T-001:purchase', {
      type: 'purchase',
      terminalCode: 'T-001',
      idempotencyKey: 'controlling-delivery',
      attempted: false,
      supplierId: 'sup-1',
      supplierName: 'Supplier One',
      savedAt: Date.now(),
      lines: [{ productId: 'p-soda', name: 'Soda Baridi', unitSymbol: 'pc', quantity: 2 }],
    });
    const user = userEvent.setup();
    await openStock(user, 'Receive stock');
    await waitFor(() =>
      expect(screen.getByRole('spinbutton', { name: 'Quantity · pc' })).toHaveValue(2),
    );
    const saved = JSON.stringify(h.state.drafts.get('T-001:purchase'));
    const host: PosHost = {
      instanceId: 'readonly-delivery',
      basePath: '/pos',
      ownsInput: () => true,
      router: h.router,
      history: {
        hash: () => '#pos/receiving',
        replace: () => undefined,
        push: () => undefined,
        back: () => undefined,
        listen: () => () => undefined,
      },
    };
    const second = render(
      <PosHostContext.Provider value={host}>
        <MobilePosLite />
      </PosHostContext.Provider>,
    );
    const readonly = within(second.container);
    await readonly.findByText(
      'Take till control to work on the saved stock draft. Another window currently controls this till.',
    );
    expect(readonly.queryByRole('spinbutton', { name: 'Quantity · pc' })).toBeNull();
    expect(readonly.queryByRole('button', { name: 'Review delivery', exact: true })).toBeNull();
    expect(JSON.stringify(h.state.drafts.get('T-001:purchase'))).toBe(saved);
    expect(h.backendPost).not.toHaveBeenCalled();
  });
});

describe('Native operations and compatible Settings', () => {
  async function openMenuItem(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
    await user.click(screen.getByRole('button', { name: 'Menyu' }));
    await user.click(screen.getByRole('menuitem', { name }));
  }

  it('opens the native daily report and returns to Sell', async () => {
    const user = userEvent.setup();
    const { container } = await boot();
    await user.click(screen.getByRole('button', { name: 'Ripoti za siku' }));
    await screen.findByRole('heading', { name: 'Ripoti za siku' });
    expect(container.querySelector('.pos-shell')).toBeNull();
    expect(container.querySelector('.pos-app')).not.toBeNull();
    expect(window.location.hash).toBe('#pos/reports');

    await user.click(screen.getAllByRole('button', { name: /Mauzo/ })[0]);
    await waitFor(() => expect(container.querySelector('.pos-app')).not.toBeNull());
    expect(container.querySelector('.pos-shell')).toBeNull();
    expect(window.location.hash).toBe('#pos/sale');
  });

  it('offers deliveries only to a user who may receive stock', async () => {
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Menyu' }));
    expect(screen.queryByRole('menuitem', { name: 'Mizigo' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Mipangilio' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Menyu' }));
    await user.click(screen.getByRole('button', { name: 'Stoo' }));
    expect(screen.queryByRole('button', { name: 'Pokea mzigo' })).toBeNull();
  });

  it('shows deliveries when purchases are enabled', async () => {
    h.state.session = makeSession(3, { purchasesEnabled: true });
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Stoo' }));
    expect(screen.getByRole('button', { name: 'Mizigo' })).toBeInTheDocument();
  });

  it('opens a module from its link on load, not the sale screen', async () => {
    // A refresh inside a module (a stock count, settings) used to drop the
    // rep on the sale screen while the address still named the module.
    window.history.replaceState(null, '', '/mobile-pos#mipangilio');
    const { container } = await boot();

    await waitFor(() => expect(container.querySelector('.pos-shell')).not.toBeNull());
    expect(container.querySelector('.pos-app')).toBeNull();
    expect(window.location.hash).toBe('#mipangilio');
  });

  it('opens a module when its link is followed from the sale screen', async () => {
    const { container } = await boot();
    expect(container.querySelector('.pos-app')).not.toBeNull();
    // Effects (the step hook's hash write, and the shell's hashchange
    // listener) run after the header renders; follow the link only once they
    // have, or a slow runner fires hashchange before anyone listens.
    await waitFor(() => expect(window.location.hash).toBe('#pos/sale'));

    window.history.pushState(null, '', '/mobile-pos#leo');
    window.dispatchEvent(new HashChangeEvent('hashchange'));

    await screen.findByRole('heading', { name: 'Ripoti za siku' });
    expect(container.querySelector('.pos-shell')).toBeNull();
    expect(container.querySelector('.pos-app')).not.toBeNull();
  });

  it('carries the same branch and rep into the native report', async () => {
    const user = userEvent.setup();
    const { container } = await boot();
    await user.click(screen.getByRole('button', { name: 'Ripoti za siku' }));
    await screen.findByRole('heading', { name: 'Ripoti za siku' });
    expect(container.querySelector('.pos-app')).not.toBeNull();
    expect(screen.getByText('Kisimani Main · Kaunta 1 · Jofu K.')).toBeInTheDocument();
  });

  it('offers no Mchana/Usiku choice in the OS skin, which follows the OS theme', async () => {
    const user = userEvent.setup();
    await boot();
    await openMenuItem(user, /^Mipangilio/);

    await screen.findByText('Mtetemo');
    expect(screen.queryByText('Mandhari')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Mandhari' })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Mtetemo' })).toBeInTheDocument();
  });
});

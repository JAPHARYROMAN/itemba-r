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
    if (path === '/mobile-pos-lite/my-sales-today') return { count: 0, totalAmount: 0, sales: [] };
    if (path === '/mobile-pos-lite/stock')
      return {
        asOf: new Date().toISOString(),
        branch: { id: 'b1', name: 'Kisimani Main' },
        items: [],
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

  it('lowers a price within the limit only with a reason, and sends it with the line', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    const sheet = await openPriceSheet(user);
    expect(sheet.getByText('TZS 1,200')).toBeInTheDocument();

    const input = sheet.getByLabelText('Bei mpya');
    await user.clear(input);
    await user.type(input, '1100');
    expect(sheet.getByRole('status')).toHaveTextContent('Punguzo 8.3% · ndani ya kiwango cha 10%');
    expect(sheet.getByRole('button', { name: 'Hifadhi' })).toBeDisabled();
    await user.click(sheet.getByRole('button', { name: 'Mteja wa kudumu' }));
    await user.click(sheet.getByRole('button', { name: 'Hifadhi' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('bei imebadilishwa')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo · TZS 1,100/ }));
    await screen.findByRole('heading', { name: 'Mauzo yamekamilika' });
    const [, payload] = salesPosts()[0];
    expect(payload.lines).toEqual([
      { productId: 'p-soda', quantity: 1, unitPrice: 1100, priceReason: 'REGULAR_CUSTOMER' },
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

  it('lets a price go up with a reason', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    const sheet = await openPriceSheet(user);
    const input = sheet.getByLabelText('Bei mpya');
    await user.clear(input);
    await user.type(input, '1500');
    expect(sheet.getByRole('status')).toHaveTextContent('Ongezeko 25%');
    await user.click(sheet.getByRole('button', { name: 'Ofa ya jumla' }));
    expect(sheet.getByRole('button', { name: 'Hifadhi' })).toBeEnabled();
  });

  it('restoring the list price sends the line exactly as before price editing', async () => {
    h.state.session = priceSession();
    const user = userEvent.setup();
    await boot();
    let sheet = await openPriceSheet(user);
    await user.clear(sheet.getByLabelText('Bei mpya'));
    await user.type(sheet.getByLabelText('Bei mpya'), '1100');
    await user.click(sheet.getByRole('button', { name: 'Nyingine' }));
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
    await user.click(sheet.getByRole('button', { name: 'Mteja wa kudumu' }));
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
    await user.click(sheet.getByRole('button', { name: 'Mteja wa kudumu' }));
    await user.click(sheet.getByRole('button', { name: 'Hifadhi' }));
    await user.click(screen.getAllByRole('button', { name: 'Lipa' })[0]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));

    await screen.findByRole('heading', { name: 'Imehifadhiwa kwenye simu' });
    expect(h.state.outbox[0]).toMatchObject({
      totalAmount: 1150,
      payload: {
        lines: [
          { productId: 'p-soda', quantity: 1, unitPrice: 1150, priceReason: 'REGULAR_CUSTOMER' },
        ],
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
    await screen.findByRole('button', { name: /Soda Baridi/ });
    (document.activeElement as HTMLElement | null)?.blur();
    scan('6200001');
    const cart = screen.getByRole('region', { name: 'Bidhaa za mauzo' });
    await waitFor(() => expect(within(cart).getByText('Soda Baridi')).toBeInTheDocument());
  });

  it('puts an unknown scan in the search box with a plain note', async () => {
    await boot();
    await screen.findByRole('button', { name: /Soda Baridi/ });
    (document.activeElement as HTMLElement | null)?.blur();
    scan('999000111');
    expect(await screen.findByRole('status')).toHaveTextContent('999000111');
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

describe('Kaunta modules in the OS skin', () => {
  async function openMenuItem(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
    await user.click(screen.getByRole('button', { name: 'Menyu' }));
    await user.click(screen.getByRole('menuitem', { name }));
  }

  it('opens the day book in the OS skin and returns to the new sale from Mauzo', async () => {
    const user = userEvent.setup();
    const { container } = await boot();
    await openMenuItem(user, /^Leo/);

    const kaunta = await waitFor(() => {
      const root = container.querySelector('.pos-shell');
      expect(root).not.toBeNull();
      return root as HTMLElement;
    });
    expect(kaunta).toHaveAttribute('data-pos-skin', 'os');
    // The OS skin follows the OS theme, never Mchana/Usiku.
    expect(kaunta).not.toHaveAttribute('data-pos-theme');
    expect(container.querySelector('.pos-app')).toBeNull();
    expect(window.location.hash).toBe('#leo');

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
    expect(screen.getByRole('menuitem', { name: 'Stoo na hesabu' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Mipangilio' })).toBeInTheDocument();
  });

  it('shows deliveries when purchases are enabled', async () => {
    h.state.session = makeSession(3, { purchasesEnabled: true });
    const user = userEvent.setup();
    await boot();
    await user.click(screen.getByRole('button', { name: 'Menyu' }));
    expect(screen.getByRole('menuitem', { name: 'Mizigo' })).toBeInTheDocument();
  });
});

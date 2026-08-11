/**
 * Phase 0 characterization tests — Kaunta POS reform.
 * (POS_REFORM_PLAN_2026-08-11.md Phase 0; docs/pos-reform/spec-sales.md §0.1.)
 *
 * These tests freeze the CURRENT load-bearing behavior of the 1,949-line
 * mobile-pos-lite.tsx BEFORE the Phase 2 refactor splits it into hooks and
 * per-screen components. They pin behavior, not implementation: everything is
 * driven through the real screens (quick-pick tiles, Lipa / Maliza Mauzo,
 * Swahili-first strings — the app defaults to `sw`) against an in-memory fake
 * of the IndexedDB store that mirrors the real module's contract exactly
 * (binding, catalog, session cache, outbox, frequents). If any test here
 * breaks during the refactor, behavior changed — not just structure.
 *
 * CHAR-1  Cart survives into the success screen (receipt built from it);
 *         only Mauzo Mapya (`beginSale`) clears it.
 * CHAR-2  Sync loop semantics: connection failure ⇒ break (order preserved,
 *         nothing flagged); server rejection ⇒ flag + continue.
 * CHAR-3  Frequents bump counts queued offline sales too.
 * CHAR-4  Offline cold start restores the cached session/catalog/queue and
 *         refetches the session when 'online' fires.
 * CHAR-5  Queued payloads are frozen verbatim (idempotencyKey never
 *         regenerated; lines carry no price fields) and replayed as-is.
 * CHAR-6  Offline non-CASH completion is blocked: notice only, no enqueue,
 *         no POST.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MobilePosLiteProduct, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes: an in-memory store implementing the real module contract,
 * plus the api-client / auth / toast / router doubles.
 * ------------------------------------------------------------------------ */
const h = vi.hoisted(() => {
  type Binding = { terminalCode: string; deviceSecret: string; activatedAt: string };
  type Pending = {
    id: string;
    terminalCode: string;
    payload: {
      paymentMethod: string;
      customerId?: string;
      paymentReference?: string;
      idempotencyKey: string;
      lines: Array<{ productId: string; quantity: number }>;
    };
    createdAt: string;
    lastError?: string;
    totalAmount?: number;
    itemCount?: number;
    lineSummary?: string;
  };

  const state = {
    binding: null as Binding | null,
    catalogs: new Map<string, unknown[]>(),
    sessions: new Map<string, unknown>(),
    frequents: new Map<string, Record<string, number>>(),
    outbox: [] as Pending[],
  };

  /** Mirrors the real mobile-pos-lite-store signatures exactly (all async). */
  const store = {
    getMobilePosLiteBinding: vi.fn(async () => state.binding),
    clearMobilePosLiteBinding: vi.fn(async () => {
      state.binding = null;
    }),
    getMobilePosLiteCatalog: vi.fn(async (terminalCode: string) => [
      ...(state.catalogs.get(terminalCode) ?? []),
    ]),
    saveMobilePosLiteCatalog: vi.fn(async (terminalCode: string, products: unknown[]) => {
      state.catalogs.set(terminalCode, products);
    }),
    getMobilePosLiteSession: vi.fn(
      async (terminalCode: string) => state.sessions.get(terminalCode) ?? null,
    ),
    saveMobilePosLiteSession: vi.fn(async (terminalCode: string, session: unknown) => {
      state.sessions.set(terminalCode, session);
    }),
    getMobilePosLiteFrequents: vi.fn(async (terminalCode: string) => ({
      ...(state.frequents.get(terminalCode) ?? {}),
    })),
    bumpMobilePosLiteFrequents: vi.fn(async (terminalCode: string, productIds: string[]) => {
      const counts = { ...(state.frequents.get(terminalCode) ?? {}) };
      for (const id of productIds) counts[id] = (counts[id] ?? 0) + 1;
      state.frequents.set(terminalCode, counts);
      return counts;
    }),
    enqueueMobilePosLiteSale: vi.fn(async (sale: Pending) => {
      const at = state.outbox.findIndex((item) => item.id === sale.id);
      if (at >= 0) state.outbox[at] = sale;
      else state.outbox.push(sale);
    }),
    // The real store reads via the terminalCode index, so results come back
    // ordered by primary key (id) — the fake mirrors that, not insert order.
    getPendingMobilePosLiteSales: vi.fn(async (terminalCode: string) =>
      state.outbox
        .filter((item) => item.terminalCode === terminalCode)
        .sort((a, b) => a.id.localeCompare(b.id)),
    ),
    removePendingMobilePosLiteSale: vi.fn(async (id: string) => {
      state.outbox = state.outbox.filter((item) => item.id !== id);
    }),
    updatePendingMobilePosLiteSaleError: vi.fn(async (id: string, lastError: string) => {
      state.outbox = state.outbox.map((item) => (item.id === id ? { ...item, lastError } : item));
    }),
  };

  return {
    state,
    store,
    backendGet: vi.fn(),
    backendPost: vi.fn(),
    showToast: vi.fn(),
    logout: vi.fn(),
    // Stable singleton, like the real next/navigation router: the component's
    // boot effect lists `router` in its deps, so a per-render object would
    // re-run the whole boot on every render and corrupt the characterization.
    router: {
      replace: vi.fn(),
      push: vi.fn(),
      prefetch: vi.fn(),
      back: vi.fn(),
      refresh: vi.fn(),
    },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => h.router,
}));
vi.mock('@/lib/api-client', () => ({ backendGet: h.backendGet, backendPost: h.backendPost }));
vi.mock('@/lib/mobile-pos-lite-store', () => ({ ...h.store }));
vi.mock('@/hooks/use-auth', () => ({ useAuth: () => ({ logout: h.logout }) }));
vi.mock('@/components/ui', () => ({ showToast: h.showToast }));

/* ------------------------------------------------------------------------ *
 * Test data + harness.
 * ------------------------------------------------------------------------ */
const TERMINAL = 'T-001';
const BINDING = {
  terminalCode: TERMINAL,
  deviceSecret: 'secret-1',
  activatedAt: '2026-08-01T00:00:00.000Z',
};

type SalePayload = PendingMobilePosLiteSale['payload'];

type PosSession = {
  terminal: {
    id: string;
    code: string;
    name: string;
    configVersion: number;
    offlineCashEnabled: boolean;
  };
  company: { id: string; name: string; code: string };
  division: { id: string; name: string; code: string };
  branch: { id: string; name: string; code: string };
  rep: { id: string; name: string };
  paymentMethods: Array<{ code: string; label: string; requiresReference: boolean }>;
  purchasesEnabled?: boolean;
};

function makeProduct(overrides: Partial<MobilePosLiteProduct> = {}): MobilePosLiteProduct {
  return {
    id: 'p-generic',
    name: 'Bidhaa',
    code: 'GEN',
    barcode: null,
    unitId: 'u1',
    unitSymbol: 'pc',
    sellingPrice: 1000,
    availableStock: 25,
    trackInventory: true,
    imageUrl: null,
    ...overrides,
  };
}

const SODA = makeProduct({ id: 'p-soda', name: 'Soda Baridi', code: 'SODA', sellingPrice: 1200 });
const MAJI = makeProduct({ id: 'p-maji', name: 'Maji ya Uhai', code: 'MAJI', sellingPrice: 500 });

function makeSession(overrides: Partial<PosSession> = {}): PosSession {
  return {
    terminal: {
      id: 't1',
      code: TERMINAL,
      name: 'Kaunta 1',
      configVersion: 1,
      offlineCashEnabled: true,
    },
    company: { id: 'c1', name: 'Duka Ltd', code: 'DL' },
    division: { id: 'd1', name: 'Rejareja', code: 'RJ' },
    branch: { id: 'b1', name: 'Tawi la Kariakoo', code: 'KRK' },
    rep: { id: 'r1', name: 'Asha Rep' },
    paymentMethods: [
      { code: 'CASH', label: 'Taslimu', requiresReference: false },
      { code: 'MOBILE_MONEY', label: 'M-Pesa', requiresReference: true },
    ],
    purchasesEnabled: false,
    ...overrides,
  };
}

function makePendingSale(
  id: string,
  idempotencyKey: string,
  lines: Array<{ productId: string; quantity: number }>,
): PendingMobilePosLiteSale {
  return {
    id,
    terminalCode: TERMINAL,
    payload: { paymentMethod: 'CASH', idempotencyKey, lines },
    createdAt: '2026-08-10T09:00:00.000Z',
    totalAmount: 1200,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    lineSummary: lines.map((line) => `${line.quantity}× ${line.productId}`).join(', '),
  };
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

/** Drain the promise chains of any in-flight boot/sync passes (no timers involved). */
async function flushAsync() {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

async function goOffline() {
  setNavigatorOnLine(false);
  fireEvent(window, new Event('offline'));
  await flushAsync();
}

async function goOnline() {
  setNavigatorOnLine(true);
  fireEvent(window, new Event('online'));
  await flushAsync();
}

type HarnessOptions = {
  onLine?: boolean;
  catalog?: MobilePosLiteProduct[];
  cachedSession?: PosSession | null;
  outbox?: PendingMobilePosLiteSale[];
  session?: PosSession;
  /** Behavior of GET /mobile-pos-lite/session. Defaults to resolving `session`. */
  sessionGet?: () => Promise<PosSession>;
  /** Behavior of POST /mobile-pos-lite/sales. Defaults to a generic success. */
  salesPost?: (payload: SalePayload) => Promise<unknown>;
};

function buildHarness(options: HarnessOptions = {}) {
  const session = options.session ?? makeSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, options.catalog ?? [SODA, MAJI]]]);
  h.state.sessions = new Map(options.cachedSession ? [[TERMINAL, options.cachedSession]] : []);
  h.state.frequents = new Map();
  h.state.outbox = [...(options.outbox ?? [])];

  setNavigatorOnLine(options.onLine ?? true);

  let sessionGet = options.sessionGet ?? (async () => session);
  let salesPost =
    options.salesPost ??
    (async () => ({ id: 'srv-1', salesOrderNumber: 'SO-1', totalAmount: 1200 }));

  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return sessionGet();
    if (path === '/mobile-pos-lite/catalog') return [...(h.state.catalogs.get(TERMINAL) ?? [])];
    if (path === '/mobile-pos-lite/products') return [];
    if (path === '/mobile-pos-lite/customers') return [];
    if (path === '/mobile-pos-lite/suppliers') return [];
    if (path === '/mobile-pos-lite/my-sales-today') return { count: 0, totalAmount: 0, sales: [] };
    throw new Error(`Unexpected GET ${path} in characterization test`);
  });
  h.backendPost.mockImplementation(async (path: string, payload: unknown) => {
    if (path === '/mobile-pos-lite/sales') return salesPost(payload as SalePayload);
    throw new Error(`Unexpected POST ${path} in characterization test`);
  });

  return {
    session,
    setSessionGet(next: () => Promise<PosSession>) {
      sessionGet = next;
    },
    setSalesPost(next: (payload: SalePayload) => Promise<unknown>) {
      salesPost = next;
    },
    /** Every payload POSTed to /mobile-pos-lite/sales, in call order. */
    salesPosts: (): SalePayload[] =>
      h.backendPost.mock.calls
        .filter(([path]) => path === '/mobile-pos-lite/sales')
        .map(([, payload]) => payload as SalePayload),
    sessionGetCount: () =>
      h.backendGet.mock.calls.filter(([path]) => path === '/mobile-pos-lite/session').length,
    outbox: () => h.state.outbox,
    frequents: () => h.state.frequents.get(TERMINAL) ?? {},
  };
}

type User = ReturnType<typeof userEvent.setup>;

/** Render and wait until the boot lands on the home screen. */
async function mountThroughBoot() {
  render(<MobilePosLite />);
  await screen.findByRole('button', { name: 'Mauzo Mapya' });
}

/** Home → Mauzo Mapya → tap quick-pick tiles → Lipa → payment screen. */
async function buildCartAndOpenPayment(user: User, tiles: RegExp[]) {
  await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
  for (const tile of tiles) {
    await user.click(screen.getByRole('button', { name: tile }));
  }
  await user.click(screen.getByRole('button', { name: 'Lipa' }));
  await screen.findByRole('heading', { name: 'Malipo' });
}

beforeAll(() => {
  // Some jsdom builds lack crypto.randomUUID; give a deterministic UUID-shaped stand-in.
  const cryptoObj = globalThis.crypto as Crypto & { randomUUID?: () => string };
  if (typeof cryptoObj?.randomUUID !== 'function') {
    let counter = 0;
    Object.defineProperty(cryptoObj, 'randomUUID', {
      configurable: true,
      value: () => {
        counter += 1;
        return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
      },
    });
  }
});

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'onLine');
  Reflect.deleteProperty(window.navigator, 'share');
});

/* ------------------------------------------------------------------------ *
 * CHAR-1
 * ------------------------------------------------------------------------ */
describe('CHAR-1: cart survives into the success screen', () => {
  // Invariant: the receipt is built FROM the still-populated cart on the success
  // screen — clearing the cart on completion (a "tidy" refactor move) would blank
  // every shared receipt; only Mauzo Mapya (beginSale) may reset it.
  it('shares a receipt containing the sold lines after success, and resets only on Mauzo Mapya', async () => {
    buildHarness({
      salesPost: async () => ({ id: 'sale-1', salesOrderNumber: 'SO-123', totalAmount: 2900 }),
    });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });

    const user = userEvent.setup();
    await mountThroughBoot();
    // 2× Soda Baridi + 1× Maji ya Uhai = 2,400 + 500 = 2,900.
    await buildCartAndOpenPayment(user, [/^Soda Baridi/, /^Soda Baridi/, /^Maji ya Uhai/]);

    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByText('Mauzo yamekamilika');
    expect(screen.getByText('SO-123')).toBeInTheDocument();
    expect(screen.getByText('TZS 2,900')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Tuma Risiti' }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const receipt = (share.mock.calls[0]?.[0] as { text: string }).text;
    // The line items with their quantities prove the cart was NOT cleared
    // before the receipt was built.
    expect(receipt).toContain('2 x Soda Baridi = TZS 2,400');
    expect(receipt).toContain('1 x Maji ya Uhai = TZS 500');
    expect(receipt).toContain('SO-123');
    expect(receipt).toContain('JUMLA: TZS 2,900');
    expect(receipt).toContain('Duka Ltd');

    // Mauzo Mapya is the ONLY reset point: a fresh sale screen with no cart.
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(screen.queryByText('Bidhaa za mauzo')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lipa' })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * CHAR-2
 * ------------------------------------------------------------------------ */
describe('CHAR-2: sync semantics — break on connection failure, flag-and-continue on rejection', () => {
  const SALE_A = () =>
    makePendingSale('pend-a', 'idem-aaaa', [{ productId: 'p-soda', quantity: 1 }]);
  const SALE_B = () =>
    makePendingSale('pend-b', 'idem-bbbb', [{ productId: 'p-maji', quantity: 3 }]);

  // Invariant: a connection-shaped failure means the WHOLE network is gone —
  // the loop must stop (order preserved, no error flags), not spray failures
  // over every queued sale. A refactor that turns break into continue would
  // mark healthy sales as failed the moment the network blips.
  it('(a) connection failure BREAKS the loop: second item never attempted, both stay queued, nothing flagged', async () => {
    const harness = buildHarness({
      outbox: [SALE_A(), SALE_B()],
      salesPost: () => Promise.reject(new TypeError('failed to fetch')),
    });

    await mountThroughBoot();
    await waitFor(() => expect(harness.salesPosts().length).toBeGreaterThanOrEqual(1));
    await flushAsync();

    const attemptedKeys = harness.salesPosts().map((payload) => payload.idempotencyKey);
    expect(attemptedKeys).toContain('idem-aaaa');
    expect(attemptedKeys).not.toContain('idem-bbbb'); // the break: B never attempted
    expect(harness.outbox().map((item) => item.id)).toEqual(['pend-a', 'pend-b']);
    expect(harness.outbox().every((item) => item.lastError === undefined)).toBe(true);
    expect(h.store.updatePendingMobilePosLiteSaleError).not.toHaveBeenCalled();
    expect(h.store.removePendingMobilePosLiteSale).not.toHaveBeenCalled();
  });

  // Invariant: a server rejection is about THAT sale only — it must be flagged
  // (updatePendingMobilePosLiteSaleError) and the loop must continue so later
  // sales still reach the server. A refactor that breaks on any error would
  // let one bad sale dam the whole queue forever.
  it('(b) server rejection FLAGS item 1 and CONTINUES: item 2 is sent and removed', async () => {
    const harness = buildHarness({
      outbox: [SALE_A(), SALE_B()],
      salesPost: async (payload) => {
        if (payload.idempotencyKey === 'idem-aaaa') throw new Error('Insufficient stock');
        return { id: 'srv-b', salesOrderNumber: 'SO-9', totalAmount: 1500 };
      },
    });

    await mountThroughBoot();
    await waitFor(() => expect(harness.outbox().map((item) => item.id)).toEqual(['pend-a']));

    expect(h.store.updatePendingMobilePosLiteSaleError).toHaveBeenCalledWith(
      'pend-a',
      'Insufficient stock',
    );
    expect(harness.outbox()[0]?.lastError).toBe('Insufficient stock');
    expect(harness.salesPosts().map((payload) => payload.idempotencyKey)).toContain('idem-bbbb');
    expect(h.store.removePendingMobilePosLiteSale).toHaveBeenCalledWith('pend-b');
  });
});

/* ------------------------------------------------------------------------ *
 * CHAR-3
 * ------------------------------------------------------------------------ */
describe('CHAR-3: frequents count queued sales', () => {
  // Invariant: the quick-pick personalization bumps BEFORE the sale outcome is
  // known — a queued offline sale is still a real sale for frequency purposes.
  // Moving the bump into the success path would stop offline-heavy terminals
  // from ever personalizing their grid.
  it('bumps frequents for the cart productIds even though the sale only reached the queue', async () => {
    const harness = buildHarness({
      salesPost: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const user = userEvent.setup();
    await mountThroughBoot();
    await goOffline();

    await buildCartAndOpenPayment(user, [/^Soda Baridi/]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByText(/Imehifadhiwa kwenye simu hii/);

    expect(h.store.bumpMobilePosLiteFrequents).toHaveBeenCalledWith(TERMINAL, ['p-soda']);
    expect(harness.frequents()).toEqual({ 'p-soda': 1 });
    // The sale never reached the server — it is sitting in the outbox.
    expect(harness.outbox()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * CHAR-4
 * ------------------------------------------------------------------------ */
describe('CHAR-4: offline cold-start restore', () => {
  // Invariant: an offline cold start must open the POS from the CACHED session
  // (offline selling is the point), never dead-end on the error splash; and the
  // 'online' event must re-fetch the session so config changes apply.
  it('boots from the cached session offline, then re-fetches the session when online fires', async () => {
    const cached = makeSession();
    const fresh = makeSession({ branch: { id: 'b1', name: 'Tawi Jipya', code: 'JIP' } });
    const harness = buildHarness({
      onLine: false,
      cachedSession: cached,
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      outbox: [makePendingSale('pend-q', 'idem-qqqq', [{ productId: 'p-soda', quantity: 1 }])],
    });
    const user = userEvent.setup();

    render(<MobilePosLite />);
    // Home renders from the CACHE: branch visible, queue restored, no error splash.
    await screen.findByText('Tawi la Kariakoo');
    expect(screen.getByRole('button', { name: 'Mauzo Mapya' })).toBeInTheDocument();
    expect(screen.getByText('1 yanasubiri kutumwa')).toBeInTheDocument();
    expect(screen.queryByText('Sajili simu hii upya')).not.toBeInTheDocument();
    const bootSessionGets = harness.sessionGetCount();
    expect(bootSessionGets).toBeGreaterThanOrEqual(1);

    // The cached catalog serves the quick-pick grid with no network.
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(screen.getByRole('button', { name: /^Soda Baridi/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Futa mauzo' }));
    await screen.findByRole('button', { name: 'Mauzo Mapya' });

    // Network returns: the session is re-fetched (cache-refresh contract).
    harness.setSessionGet(async () => fresh);
    await goOnline();

    await screen.findByText('Tawi Jipya');
    expect(harness.sessionGetCount()).toBeGreaterThan(bootSessionGets);
    expect(h.store.saveMobilePosLiteSession).toHaveBeenCalledWith(TERMINAL, fresh);
    // Reconnecting also flushes the queued sale.
    await waitFor(() => expect(harness.outbox()).toHaveLength(0));
  });
});

/* ------------------------------------------------------------------------ *
 * CHAR-5
 * ------------------------------------------------------------------------ */
describe('CHAR-5: frozen idempotent payloads', () => {
  // Invariant: the payload (idempotencyKey included) is minted ONCE at sale
  // time, stored verbatim, and replayed with exactly those fields — never
  // regenerated, never enriched with prices. Regenerating the key on retry
  // would defeat server-side dedup and double-post sales.
  it('stores the payload verbatim at queue time and replays the exact same fields on sync', async () => {
    let failSales = true;
    const harness = buildHarness({
      salesPost: async () => {
        if (failSales) throw new TypeError('Failed to fetch');
        return { id: 'srv-1', salesOrderNumber: 'SO-77', totalAmount: 2900 };
      },
    });
    const user = userEvent.setup();
    await mountThroughBoot();
    await goOffline();

    await buildCartAndOpenPayment(user, [/^Soda Baridi/, /^Soda Baridi/, /^Maji ya Uhai/]);
    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));
    await screen.findByText(/Imehifadhiwa kwenye simu hii/);

    // Snapshot the payload exactly as it was frozen into the outbox.
    expect(harness.outbox()).toHaveLength(1);
    const frozen = structuredClone(harness.outbox()[0].payload);
    expect(frozen.idempotencyKey).toMatch(/^[0-9a-f]{32}$/);
    expect(frozen.paymentMethod).toBe('CASH');
    expect(frozen.lines).toEqual([
      { productId: 'p-soda', quantity: 2 },
      { productId: 'p-maji', quantity: 1 },
    ]);
    // Lines carry ONLY productId + quantity — no price fields (server prices).
    for (const line of frozen.lines) {
      expect(Object.keys(line).sort()).toEqual(['productId', 'quantity']);
    }

    const postsBeforeReplay = harness.salesPosts().length; // the failed live attempt(s)
    failSales = false;
    await goOnline();
    await waitFor(() => expect(harness.outbox()).toHaveLength(0));

    const replays = harness.salesPosts().slice(postsBeforeReplay);
    expect(replays).toHaveLength(1);
    // The replay posts EXACTLY the frozen payload — same idempotencyKey, same lines.
    expect(replays[0]).toEqual(frozen);
    expect(replays[0].idempotencyKey).toBe(frozen.idempotencyKey);
  });
});

/* ------------------------------------------------------------------------ *
 * CHAR-6
 * ------------------------------------------------------------------------ */
describe('CHAR-6: offline non-CASH completion is blocked', () => {
  // Invariant: only CASH may complete offline — a non-CASH attempt shows the
  // cashOnlyOffline notice and produces NO enqueue and NO POST. Queuing a
  // mobile-money sale offline would claim money the terminal never saw.
  it('shows the cash-only notice and neither queues nor posts when offline with MOBILE_MONEY', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountThroughBoot();

    await buildCartAndOpenPayment(user, [/^Soda Baridi/]);
    // Select mobile money while online (offline disables the button), THEN drop the network.
    await user.click(screen.getByRole('button', { name: 'M-Pesa' }));
    // M-Pesa requires a reference, so its label appearing proves the selection stuck.
    await screen.findByText('Kumbukumbu');
    await goOffline();
    // The offline banner is the single instance of the cash-only string so far.
    await waitFor(() =>
      expect(screen.getAllByText('Bila mtandao, mauzo ya fedha taslimu tu.')).toHaveLength(1),
    );

    await user.click(screen.getByRole('button', { name: /Maliza Mauzo/ }));

    // Blocked: the notice joins the banner (2 instances), still on the payment screen.
    await waitFor(() =>
      expect(screen.getAllByText('Bila mtandao, mauzo ya fedha taslimu tu.')).toHaveLength(2),
    );
    expect(screen.getByRole('heading', { name: 'Malipo' })).toBeInTheDocument();
    expect(harness.salesPosts()).toHaveLength(0);
    expect(h.store.enqueueMobilePosLiteSale).not.toHaveBeenCalled();
    expect(harness.outbox()).toHaveLength(0);
    // The block happens before the frequents bump — nothing is counted either.
    expect(h.store.bumpMobilePosLiteFrequents).not.toHaveBeenCalled();
  });
});

/**
 * Kaunta ritual tests — Phase 3 of the POS reform.
 * (design-direction.md §2.4/§2.5/§5/§12, spec-leo.md, spec-sales.md §4–§5.)
 *
 * Same harness discipline as kaunta-shell.test.tsx: everything drives the real
 * screens through the pilot (uiVersion=2) shell against an in-memory fake of
 * the IndexedDB store (now including the v4 daylog contract). The classic
 * shell's behavior stays pinned by the characterization suite — every surface
 * exercised here is Kaunta-only.
 *
 * RITUAL-1  MUHURI variants on the Risiti: solid IMELIPWA (+ sent haptic +
 *           tally mark) for a server-confirmed sale; hollow IMEHIFADHIWA with
 *           custody copy (+ held haptic + tally mark) for a queued sale.
 * RITUAL-2  Purchase success stamps MZIGO UMEPOKELEWA over the counter (no
 *           classic toast), with the sent haptic and a tally mark.
 * RITUAL-3  The Leo tally row carries the exact stamped-job count in aria.
 * RITUAL-4  Reconciliation math: server truth · daylog cache with staleness
 *           chip · honest "—" with no cache · the shared-phone rep guard ·
 *           Retry only when online-and-failed.
 * RITUAL-5  Rejected-sale ritual sheet: plain-Swahili mapped error, raw text
 *           behind Maelezo ya kiufundi, retry re-flags on rejection (reject
 *           haptic) and removes on success; two-step removal stays inside.
 * RITUAL-6  Status ribbon: grey offline chip; brass Inatuma… while flushing.
 * RITUAL-7  Mipangilio: haptics toggle persists + gates; catalog re-sync row
 *           re-fetches the catalog with a success toast, disabled offline.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MobilePosLiteProduct, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes — the kaunta-shell doubles plus the v4 daylog contract.
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
  type DaylogSent = { repId: string; count: number; totalAmount: number; fetchedAt: number };
  type DaylogEntry = { terminalCode: string; date: string; tallyCount: number; sent?: DaylogSent };

  const state = {
    binding: null as Binding | null,
    catalogs: new Map<string, unknown[]>(),
    sessions: new Map<string, unknown>(),
    frequents: new Map<string, Record<string, number>>(),
    outbox: [] as Pending[],
    daylog: new Map<string, DaylogEntry>(),
  };

  const posDaylogDate = (now: Date = new Date()) => {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  const store = {
    posDaylogDate,
    getDaylogEntry: vi.fn(
      async (terminalCode: string, date: string) =>
        state.daylog.get(`${terminalCode}:${date}`) ?? null,
    ),
    bumpDaylogTally: vi.fn(async (terminalCode: string) => {
      const date = posDaylogDate();
      const key = `${terminalCode}:${date}`;
      const existing = state.daylog.get(key);
      const entry: DaylogEntry = existing
        ? { ...existing, tallyCount: existing.tallyCount + 1 }
        : { terminalCode, date, tallyCount: 1 };
      state.daylog.set(key, entry);
      return entry;
    }),
    writeDaylogSent: vi.fn(async (terminalCode: string, date: string, sent: DaylogSent) => {
      const key = `${terminalCode}:${date}`;
      const existing = state.daylog.get(key);
      const entry: DaylogEntry = existing
        ? { ...existing, sent }
        : { terminalCode, date, tallyCount: 0, sent };
      state.daylog.set(key, entry);
      return entry;
    }),
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
    posDaylogDate,
    backendGet: vi.fn(),
    backendPost: vi.fn(),
    showToast: vi.fn(),
    logout: vi.fn(),
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

type PosSession = {
  terminal: {
    id: string;
    code: string;
    name: string;
    configVersion: number;
    offlineCashEnabled: boolean;
    uiVersion?: number;
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

function kauntaSession(overrides: Partial<PosSession> = {}): PosSession {
  const base: PosSession = {
    terminal: {
      id: 't1',
      code: TERMINAL,
      name: 'Kaunta 1',
      configVersion: 1,
      offlineCashEnabled: true,
      uiVersion: 2,
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
  };
  return {
    ...base,
    ...overrides,
    terminal: { ...base.terminal, ...(overrides.terminal ?? {}) },
  };
}

function makePendingSale(
  id: string,
  idempotencyKey: string,
  lines: Array<{ productId: string; quantity: number }>,
  lastError?: string,
): PendingMobilePosLiteSale {
  return {
    id,
    terminalCode: TERMINAL,
    payload: { paymentMethod: 'CASH', idempotencyKey, lines },
    createdAt: '2026-08-10T09:00:00.000Z',
    ...(lastError ? { lastError } : {}),
    totalAmount: 1200,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    lineSummary: lines.map((line) => `${line.quantity}× ${line.productId}`).join(', '),
  };
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

const vibrate = vi.fn();

type DaySummaryPayload = {
  count: number;
  totalAmount: number;
  sales: Array<{
    id: string;
    salesOrderNumber: string;
    totalAmount: number;
    paymentMethod: string;
    createdAt: string;
    customerName?: string | null;
  }>;
};

type HarnessOptions = {
  onLine?: boolean;
  catalog?: MobilePosLiteProduct[];
  cachedSession?: PosSession | null;
  outbox?: PendingMobilePosLiteSale[];
  session?: PosSession;
  sessionGet?: () => Promise<PosSession>;
};

/**
 * Mutable per-endpoint behaviors so a single test can flip a mock mid-flow
 * (retry rejection → retry success, failed day fetch → recovered fetch).
 */
function buildHarness(options: HarnessOptions = {}) {
  const session = options.session ?? kauntaSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, options.catalog ?? [SODA, MAJI]]]);
  h.state.sessions = new Map(options.cachedSession ? [[TERMINAL, options.cachedSession]] : []);
  h.state.frequents = new Map();
  h.state.outbox = [...(options.outbox ?? [])];
  h.state.daylog = new Map();

  setNavigatorOnLine(options.onLine ?? true);

  const behavior = {
    salesPost: (async () => ({
      id: 'srv-1',
      salesOrderNumber: 'SO-1',
      totalAmount: 1200,
    })) as (payload: PendingMobilePosLiteSale['payload']) => Promise<unknown>,
    purchasesPost: (async () => ({
      id: 'po-1',
      purchaseOrderNumber: 'PO-1',
    })) as () => Promise<unknown>,
    mySalesToday: (async () =>
      ({
        count: 0,
        totalAmount: 0,
        sales: [],
      }) as DaySummaryPayload) as () => Promise<DaySummaryPayload>,
    suppliers: (async () => []) as () => Promise<unknown>,
  };

  const sessionGet = options.sessionGet ?? (async () => session);

  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return sessionGet();
    if (path === '/mobile-pos-lite/catalog') return [...(h.state.catalogs.get(TERMINAL) ?? [])];
    if (path === '/mobile-pos-lite/products') return [];
    if (path === '/mobile-pos-lite/customers') return [];
    if (path === '/mobile-pos-lite/suppliers') return behavior.suppliers();
    if (path === '/mobile-pos-lite/my-sales-today') return behavior.mySalesToday();
    throw new Error(`Unexpected GET ${path} in kaunta ritual test`);
  });
  h.backendPost.mockImplementation(async (path: string, payload: unknown) => {
    if (path === '/mobile-pos-lite/sales')
      return behavior.salesPost(payload as PendingMobilePosLiteSale['payload']);
    if (path === '/mobile-pos-lite/purchases') return behavior.purchasesPost();
    throw new Error(`Unexpected POST ${path} in kaunta ritual test`);
  });

  return {
    session,
    behavior,
    outbox: () => h.state.outbox,
    catalogGets: () =>
      h.backendGet.mock.calls.filter(([path]) => path === '/mobile-pos-lite/catalog').length,
  };
}

type User = ReturnType<typeof userEvent.setup>;

async function mountKaunta() {
  render(<MobilePosLite />);
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
}

/** Complete one CASH sale end-to-end from the counter (leaves us on Risiti). */
async function sellOne(user: User, tile: RegExp) {
  await user.click(screen.getByRole('button', { name: tile }));
  await user.click(screen.getByRole('button', { name: 'LIPA' }));
  await screen.findByRole('heading', { name: 'Malipo' });
  await user.click(screen.getByRole('button', { name: 'KAMILISHA MAUZO' }));
  await screen.findByText('Mauzo yamekamilika');
}

beforeAll(() => {
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
  window.history.replaceState(null, '', '/');
  Object.defineProperty(window.navigator, 'vibrate', { configurable: true, value: vibrate });
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'onLine');
  Reflect.deleteProperty(window.navigator, 'vibrate');
});

/* ------------------------------------------------------------------------ *
 * RITUAL-1
 * ------------------------------------------------------------------------ */
describe('RITUAL-1: MUHURI stamp variants on the Risiti', () => {
  it('stamps solid IMELIPWA with the sent haptic and one tally mark on a server-confirmed sale', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await sellOne(user, /^Soda Baridi/);

    expect(screen.getByText('IMELIPWA')).toBeInTheDocument();
    expect(screen.queryByText('IMEHIFADHIWA')).not.toBeInTheDocument();
    expect(
      screen.queryByText('Imeandikwa kwenye daftari — itatumwa mtandao ukirudi'),
    ).not.toBeInTheDocument();
    // Local commit fired the stamp haptic and wrote exactly one tally mark.
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30]);
    expect(h.store.bumpDaylogTally).toHaveBeenCalledTimes(1);
    expect(h.store.bumpDaylogTally).toHaveBeenCalledWith(TERMINAL);
  });

  it('stamps hollow IMEHIFADHIWA with custody copy, the held haptic and a tally mark on a queued sale', async () => {
    const harness = buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    // Offline, the POST dies connection-shaped — the exact queue-eligibility
    // trigger (CASH + offlineCashEnabled + connection problem).
    harness.behavior.salesPost = () => Promise.reject(new TypeError('Failed to fetch'));
    const user = userEvent.setup();
    await mountKaunta();
    await sellOne(user, /^Soda Baridi/);

    expect(screen.getByText('IMEHIFADHIWA')).toBeInTheDocument();
    expect(screen.queryByText('IMELIPWA')).not.toBeInTheDocument();
    expect(
      screen.getByText('Imeandikwa kwenye daftari — itatumwa mtandao ukirudi'),
    ).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith([80]);
    expect(h.store.bumpDaylogTally).toHaveBeenCalledTimes(1);
    // The sale is genuinely in custody, not lost.
    expect(h.state.outbox).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * RITUAL-2
 * ------------------------------------------------------------------------ */
describe('RITUAL-2: purchase success stamps MZIGO UMEPOKELEWA', () => {
  it('slams the purchase seal over the counter with the sent haptic and tally mark — no classic toast', async () => {
    const harness = buildHarness({ session: kauntaSession({ purchasesEnabled: true }) });
    harness.behavior.suppliers = async () => [{ id: 's1', name: 'Muuzaji Mmoja' }];
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Manunuzi' }));
    await screen.findByRole('heading', { name: 'Pokea Mzigo' });

    await user.type(screen.getByPlaceholderText('Jina au namba ya muuzaji'), 'mu');
    await user.click(await screen.findByRole('button', { name: /Muuzaji Mmoja/ }));

    await user.type(screen.getByPlaceholderText('Tafuta au skani bidhaa'), 'soda');
    await user.click(await screen.findByRole('button', { name: /^Soda Baridi/ }));

    await user.click(screen.getByRole('button', { name: 'POKEA' }));

    // The stamp overlay appears and the shell returns to the counter.
    await screen.findByText('MZIGO UMEPOKELEWA');
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30]);
    expect(h.store.bumpDaylogTally).toHaveBeenCalledWith(TERMINAL);
    // Kaunta's completion ritual replaces the classic purchase toast.
    expect(h.showToast).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * RITUAL-3
 * ------------------------------------------------------------------------ */
describe('RITUAL-3: the Leo tally row carries the exact count in aria', () => {
  it('two stamped sales → five-stroke tally announcing "Kazi 2 zimekamilika leo"', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();

    await sellOne(user, /^Soda Baridi/);
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await sellOne(user, /^Maji ya Uhai/);
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });

    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await screen.findByRole('heading', { name: 'Daftari la Leo' });
    expect(await screen.findByRole('img', { name: 'Kazi 2 zimekamilika leo' })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * RITUAL-4
 * ------------------------------------------------------------------------ */
describe('RITUAL-4: reconciliation math — server vs cache vs offline', () => {
  it('renders the live server day: total, Zimetumwa · Mkononi, no staleness chip', async () => {
    const harness = buildHarness();
    harness.behavior.mySalesToday = async () => ({
      count: 12,
      totalAmount: 34000,
      sales: [
        {
          id: 's1',
          salesOrderNumber: 'SO-88',
          totalAmount: 34000,
          paymentMethod: 'CASH',
          createdAt: '2026-08-12T08:30:00.000Z',
        },
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await screen.findByText('Zimetumwa 12 · Mkononi 0');
    // Hero and slab both carry the live brass total.
    expect(screen.getAllByText('TZS 34,000').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Mwisho kuonekana/)).not.toBeInTheDocument();
    // Every successful fetch snapshots the day log (rep-scoped server truth).
    await waitFor(() =>
      expect(h.store.writeDaylogSent).toHaveBeenCalledWith(
        TERMINAL,
        h.posDaylogDate(),
        expect.objectContaining({ repId: 'r1', count: 12, totalAmount: 34000 }),
      ),
    );
  });

  it('offline renders the rep-guarded daylog cache with the staleness chip, live Mkononi and the calm offline note', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      outbox: [makePendingSale('pend-1', 'idem-1111', [{ productId: 'p-soda', quantity: 1 }])],
    });
    h.state.daylog.set(`${TERMINAL}:${h.posDaylogDate()}`, {
      terminalCode: TERMINAL,
      date: h.posDaylogDate(),
      tallyCount: 3,
      sent: { repId: 'r1', count: 2, totalAmount: 5000, fetchedAt: Date.now() },
    });
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await screen.findByText('Zimetumwa 2 · Mkononi 1');
    // Hero + slab from the cache — never dressed as live: the chip qualifies it.
    expect(screen.getAllByText('TZS 5,000')).toHaveLength(2);
    expect(screen.getByText(/Mwisho kuonekana/)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Kazi 3 zimekamilika leo' })).toBeInTheDocument();
    // Sent rows collapse to the calm offline line; no dead Retry offline.
    expect(
      screen.getByText('Hakuna mtandao — zilizotumwa zitaonekana mtandao ukirudi.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Jaribu tena' })).not.toBeInTheDocument();
  });

  it('never fabricates 0: no snapshot renders an em-dash day', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await screen.findByText('Zimetumwa — · Mkononi 0');
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('ignores another rep’s cached total (shared-phone guard) while keeping the terminal tally', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    h.state.daylog.set(`${TERMINAL}:${h.posDaylogDate()}`, {
      terminalCode: TERMINAL,
      date: h.posDaylogDate(),
      tallyCount: 5,
      sent: { repId: 'r-999', count: 9, totalAmount: 99000, fetchedAt: Date.now() },
    });
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await screen.findByText('Zimetumwa — · Mkononi 0');
    expect(screen.queryByText('TZS 99,000')).not.toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    // The tally is terminal property — it survives the rep guard.
    expect(screen.getByRole('img', { name: 'Kazi 5 zimekamilika leo' })).toBeInTheDocument();
  });

  it('shows Retry only online-and-failed, and Jaribu tena re-fires the fetch in place', async () => {
    const harness = buildHarness();
    harness.behavior.mySalesToday = async () => {
      throw new Error('day summary exploded');
    };
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await screen.findByText('Imeshindikana kupakua mauzo ya leo');
    const retry = screen.getByRole('button', { name: 'Jaribu tena' });

    harness.behavior.mySalesToday = async () => ({ count: 1, totalAmount: 700, sales: [] });
    await user.click(retry);
    await screen.findByText('Zimetumwa 1 · Mkononi 0');
    expect(screen.queryByText('Imeshindikana kupakua mauzo ya leo')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * RITUAL-5
 * ------------------------------------------------------------------------ */
describe('RITUAL-5: the rejected-sale ritual sheet', () => {
  const RAW_REJECTION = 'One or more products are unavailable for this terminal';

  function failedRowHarness() {
    const harness = buildHarness({
      outbox: [
        makePendingSale(
          'pend-red',
          'idem-red1',
          [{ productId: 'p-soda', quantity: 1 }],
          RAW_REJECTION,
        ),
      ],
    });
    // The boot flush retries the row and gets rejected again with the same
    // copy — the row stays red instead of draining.
    harness.behavior.salesPost = async () => {
      throw new Error(RAW_REJECTION);
    };
    return harness;
  }

  async function openSheet(user: User) {
    await user.click(screen.getByRole('button', { name: 'Leo' }));
    await screen.findByRole('heading', { name: 'Mauzo yanayosubiri kutumwa' });
    await user.click(screen.getByRole('button', { name: /Hayakukubaliwa/ }));
    return screen.findByRole('dialog');
  }

  it('maps the rejection to plain Swahili and hides the raw text behind Maelezo ya kiufundi', async () => {
    failedRowHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openSheet(user);

    // The mapped line leads; the raw English is collapsed until asked for.
    expect(screen.getByText('Bidhaa hii haipatikani kwenye kituo hiki')).toBeInTheDocument();
    expect(screen.queryByText(RAW_REJECTION)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Maelezo ya kiufundi' }));
    expect(screen.getByText(RAW_REJECTION)).toBeInTheDocument();

    // Exactly the two ritual verbs.
    expect(screen.getByRole('button', { name: /Jaribu tena/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Mwite msimamizi' })).toBeInTheDocument();
  });

  it('a retry that is rejected again re-flags the row with the fresh mapped error and the reject haptic', async () => {
    const harness = failedRowHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openSheet(user);

    harness.behavior.salesPost = async () => {
      throw new Error('Insufficient stock at branch/location b-1: requested 2, available 0');
    };
    vibrate.mockClear();
    await user.click(screen.getByRole('button', { name: /Jaribu tena/ }));

    await screen.findByText('Stoo haitoshi kwa bidhaa hii');
    expect(vibrate).toHaveBeenCalledWith([60, 40, 60]);
    expect(h.store.updatePendingMobilePosLiteSaleError).toHaveBeenCalledWith(
      'pend-red',
      'Insufficient stock at branch/location b-1: requested 2, available 0',
    );
    // Still in custody; the sheet stays open for the supervisor conversation.
    expect(h.state.outbox).toHaveLength(1);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('a successful retry removes exactly this sale and dissolves the sheet', async () => {
    const harness = failedRowHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openSheet(user);

    harness.behavior.salesPost = async (payload) => {
      // The frozen payload replays verbatim — same idempotency key.
      expect(payload.idempotencyKey).toBe('idem-red1');
      return { id: 'srv-9', salesOrderNumber: 'SO-9', totalAmount: 1200 };
    };
    await user.click(screen.getByRole('button', { name: /Jaribu tena/ }));

    await waitFor(() => expect(h.state.outbox).toHaveLength(0));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    // The pending group leaves the book entirely.
    expect(
      screen.queryByRole('heading', { name: 'Mauzo yanayosubiri kutumwa' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the honor-system two-step removal inside the sheet', async () => {
    failedRowHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openSheet(user);

    await user.click(screen.getByRole('button', { name: /Ondoa/ }));
    expect(screen.getByText('Uondoe mauzo haya?')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ndiyo, ondoa' }));

    await waitFor(() => expect(h.state.outbox).toHaveLength(0));
    expect(h.store.removePendingMobilePosLiteSale).toHaveBeenCalledWith('pend-red');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

/* ------------------------------------------------------------------------ *
 * RITUAL-6
 * ------------------------------------------------------------------------ */
describe('RITUAL-6: the status ribbon', () => {
  it('shows the calm grey offline chip only while offline', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    await mountKaunta();
    expect(screen.getByText('Hakuna mtandao — mauzo ya pesa taslimu tu')).toBeInTheDocument();
  });

  it('stays hidden when the world is clean', async () => {
    buildHarness();
    await mountKaunta();
    expect(screen.queryByText('Hakuna mtandao — mauzo ya pesa taslimu tu')).not.toBeInTheDocument();
    expect(screen.queryByText('Inatuma…')).not.toBeInTheDocument();
  });

  it('shows the brass Inatuma… chip while the outbox is flushing, then clears', async () => {
    const harness = buildHarness({
      outbox: [makePendingSale('pend-f', 'idem-ffff', [{ productId: 'p-soda', quantity: 1 }])],
    });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    harness.behavior.salesPost = async () => {
      await gate;
      return { id: 'srv-1', salesOrderNumber: 'SO-1', totalAmount: 1200 };
    };
    render(<MobilePosLite />);

    // The boot flush is in flight: the brass chip names it.
    await screen.findByText('Inatuma…');
    release();
    await waitFor(() => expect(screen.queryByText('Inatuma…')).not.toBeInTheDocument());
    await waitFor(() => expect(h.state.outbox).toHaveLength(0));
  });
});

/* ------------------------------------------------------------------------ *
 * RITUAL-7
 * ------------------------------------------------------------------------ */
describe('RITUAL-7: Mipangilio — haptics toggle and catalog re-sync', () => {
  it('haptics toggle persists to itemba-pos-haptics and gates the buzz', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await user.click(screen.getByRole('button', { name: 'Mipangilio' }));
    await screen.findByRole('heading', { name: 'Mipangilio' });

    const toggle = screen.getByRole('switch', { name: 'Mtetemo' });
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    vibrate.mockClear();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(window.localStorage.getItem('itemba-pos-haptics')).toBe('off');
    expect(vibrate).not.toHaveBeenCalled();

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(window.localStorage.getItem('itemba-pos-haptics')).toBe('on');
    // Switching ON gives the demo tick — inside the tap's gesture stack.
    expect(vibrate).toHaveBeenCalledWith(15);
  });

  it('re-sync re-fetches the catalog and confirms with a toast', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await user.click(screen.getByRole('button', { name: 'Mipangilio' }));
    await screen.findByRole('heading', { name: 'Mipangilio' });

    const before = harness.catalogGets();
    await user.click(screen.getByRole('button', { name: /Pakua bidhaa upya/ }));
    await waitFor(() => expect(harness.catalogGets()).toBe(before + 1));
    await waitFor(() =>
      expect(h.showToast).toHaveBeenCalledWith(
        'success',
        'Pakua bidhaa upya',
        'Bidhaa zimepakuliwa upya',
      ),
    );
  });

  it('re-sync is disabled offline', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await user.click(screen.getByRole('button', { name: 'Mipangilio' }));
    await screen.findByRole('heading', { name: 'Mipangilio' });
    expect(screen.getByRole('button', { name: /Pakua bidhaa upya/ })).toBeDisabled();
  });
});

/**
 * Kaunta shell tests — Phase 2b of the POS reform.
 * (docs/pos-reform/spec-sales.md §0.3 hash contract, design-direction.md §3/§5.)
 *
 * These drive the NEW shell exactly the way the characterization suite drives
 * the classic one: through the real screens, against the same in-memory fake
 * of the IndexedDB store. The pilot flag is `session.terminal.uiVersion >= 2`;
 * uiVersion-less sessions must keep rendering the classic HomeScreen flow
 * untouched (the characterization suite remains the authority on that path).
 *
 * KAUNTA-1  uiVersion=2 boots into Mauzo (SaleScreen) with rail + slab —
 *           no HomeScreen — and the address hash normalizes to #mauzo.
 * KAUNTA-2  The rail shows Manunuzi only when session.purchasesEnabled;
 *           tapping it opens the purchase screen with the POKEA slab verb.
 * KAUNTA-3  The slab verb follows the screen: LIPA → KAMILISHA MAUZO →
 *           MAUZO MAPYA (Risiti), with the rail hidden on the flow screens.
 * KAUNTA-4  The sync token is a counted brass pill when sales are held and
 *           deep-links to the Leo pending section (#leo/foleni).
 * KAUNTA-5  Back-map: popstate on Malipo returns to Mauzo with the cart intact.
 * KAUNTA-6  Back-map: popstate on Risiti returns to a FRESH Mauzo and never
 *           re-pops Malipo.
 * KAUNTA-7  Cold boot with #leo deep-links into Leo; the manufactured history
 *           stack still takes MAUZO MAPYA back to the counter.
 * KAUNTA-8  Cold boot with a flow-interior hash (#malipo) normalizes to #mauzo.
 * KAUNTA-9  Mipangilio: rail gear opens settings (identity card, language,
 *           logout) and its slab verb returns to selling.
 * KAUNTA-10 uiVersion=1 (or absent) renders the classic HomeScreen flow
 *           untouched — no rail, no slab.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MobilePosLiteProduct, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes — the same store/api/auth/toast/router doubles the
 * characterization suite uses (identical module contract).
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
    // v4 stocks store (Phase 4): the shell pre-warms the Stoo snapshot on
    // mount, so the mocked module contract must carry the accessors.
    stocks: new Map<string, unknown>(),
  };

  // Mirrors the real module's device-local YYYY-MM-DD day key.
  const posDaylogDate = (now: Date = new Date()) => {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  const store = {
    // Stocks (v4, Phase 4): same contract as the real module.
    readCachedStock: vi.fn(async (terminalCode: string) => state.stocks.get(terminalCode) ?? null),
    writeCachedStock: vi.fn(async (terminalCode: string, snapshot: unknown) => {
      state.stocks.set(terminalCode, snapshot);
    }),
    // Daylog (v4): same contract as the real module — the Kaunta shell reads
    // it on every route change and the sale/purchase paths bump it.
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

function makeSession(overrides: Partial<PosSession> = {}): PosSession {
  const base: PosSession = {
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
  };
  return {
    ...base,
    ...overrides,
    terminal: { ...base.terminal, ...(overrides.terminal ?? {}) },
  };
}

/** A pilot-terminal session: uiVersion 2 flips the Kaunta shell on. */
function kauntaSession(overrides: Partial<PosSession> = {}): PosSession {
  return makeSession({ ...overrides, terminal: { ...(overrides.terminal ?? {}), uiVersion: 2 } });
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

type HarnessOptions = {
  onLine?: boolean;
  catalog?: MobilePosLiteProduct[];
  cachedSession?: PosSession | null;
  outbox?: PendingMobilePosLiteSale[];
  session?: PosSession;
  sessionGet?: () => Promise<PosSession>;
  salesPost?: (payload: PendingMobilePosLiteSale['payload']) => Promise<unknown>;
};

function buildHarness(options: HarnessOptions = {}) {
  const session = options.session ?? kauntaSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, options.catalog ?? [SODA, MAJI]]]);
  h.state.sessions = new Map(options.cachedSession ? [[TERMINAL, options.cachedSession]] : []);
  h.state.frequents = new Map();
  h.state.outbox = [...(options.outbox ?? [])];
  h.state.daylog = new Map();
  h.state.stocks = new Map();

  setNavigatorOnLine(options.onLine ?? true);

  const sessionGet = options.sessionGet ?? (async () => session);
  const salesPost =
    options.salesPost ??
    (async () => ({ id: 'srv-1', salesOrderNumber: 'SO-1', totalAmount: 1200 }));

  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return sessionGet();
    if (path === '/mobile-pos-lite/catalog') return [...(h.state.catalogs.get(TERMINAL) ?? [])];
    if (path === '/mobile-pos-lite/products') return [];
    if (path === '/mobile-pos-lite/customers') return [];
    if (path === '/mobile-pos-lite/suppliers') return [];
    if (path === '/mobile-pos-lite/my-sales-today') return { count: 0, totalAmount: 0, sales: [] };
    // Phase 4: the shell pre-warms the Stoo snapshot on mount.
    if (path === '/mobile-pos-lite/stock')
      return { asOf: new Date().toISOString(), branch: { id: 'b1', name: 'Tawi' }, items: [] };
    throw new Error(`Unexpected GET ${path} in kaunta shell test`);
  });
  h.backendPost.mockImplementation(async (path: string, payload: unknown) => {
    if (path === '/mobile-pos-lite/sales')
      return salesPost(payload as PendingMobilePosLiteSale['payload']);
    throw new Error(`Unexpected POST ${path} in kaunta shell test`);
  });

  return {
    session,
    outbox: () => h.state.outbox,
  };
}

type User = ReturnType<typeof userEvent.setup>;

/** Render and wait until the Kaunta shell boots into Mauzo (SaleScreen). */
async function mountKaunta() {
  render(<MobilePosLite />);
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
}

/** Tap quick-pick tiles, then the slab LIPA verb → Malipo. */
async function buildCartAndOpenMalipo(user: User, tiles: RegExp[]) {
  for (const tile of tiles) {
    await user.click(screen.getByRole('button', { name: tile }));
  }
  await user.click(screen.getByRole('button', { name: 'LIPA' }));
  await screen.findByRole('heading', { name: 'Malipo' });
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
  // Each test starts at the bare mount URL — the router reads location.hash
  // at boot, so leftovers from a previous test would leak deep links.
  window.history.replaceState(null, '', '/');
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'onLine');
  Reflect.deleteProperty(window.navigator, 'share');
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-1
 * ------------------------------------------------------------------------ */
describe('KAUNTA-1: uiVersion=2 boots into Mauzo with rail + slab', () => {
  it('lands on the sale screen — no HomeScreen — with the rail, LIPA slab and #mauzo hash', async () => {
    buildHarness();
    await mountKaunta();

    // No home screen: the big classic CTA does not exist anywhere.
    expect(screen.queryByRole('button', { name: 'Mauzo Mapya' })).not.toBeInTheDocument();

    // Rail: Mauzo + Leo + Stoo tabs (Stoo shipped in Phase 4, visible to all
    // mobile_pos_lite.use holders) and the Mipangilio gear.
    expect(screen.getByRole('button', { name: 'Mauzo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stoo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mipangilio' })).toBeInTheDocument();

    // Slab: LIPA disabled while the cart is empty; sync token clean (green).
    const lipa = screen.getByRole('button', { name: 'LIPA' });
    expect(lipa).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Mauzo yote yametumwa' })).toBeInTheDocument();

    // Cold boot normalized the empty hash to the root (the canonicalization
    // runs in a passive effect, so give it a beat).
    await waitFor(() => expect(window.location.hash).toBe('#mauzo'));
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-2
 * ------------------------------------------------------------------------ */
describe('KAUNTA-2: Manunuzi rail tab is permission-gated', () => {
  it('hides Manunuzi without purchasesEnabled', async () => {
    buildHarness({ session: kauntaSession({ purchasesEnabled: false }) });
    await mountKaunta();
    expect(screen.queryByRole('button', { name: 'Manunuzi' })).not.toBeInTheDocument();
  });

  it('shows Manunuzi with purchasesEnabled and opens the purchase screen with the POKEA verb', async () => {
    buildHarness({ session: kauntaSession({ purchasesEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Manunuzi' }));
    await screen.findByRole('heading', { name: 'Pokea Mzigo' });
    expect(window.location.hash).toBe('#manunuzi');

    // Slab verb swaps to POKEA, disabled while the purchase cart is empty.
    const pokea = screen.getByRole('button', { name: 'POKEA' });
    expect(pokea).toBeDisabled();
    // The screen's own record button is hidden — the slab owns the verb.
    expect(screen.queryByRole('button', { name: /Hifadhi Manunuzi/ })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-3
 * ------------------------------------------------------------------------ */
describe('KAUNTA-3: the slab verb follows the screen', () => {
  it('LIPA on Mauzo → KAMILISHA MAUZO on Malipo → MAUZO MAPYA on Risiti', async () => {
    buildHarness({
      salesPost: async () => ({ id: 'sale-1', salesOrderNumber: 'SO-123', totalAmount: 1200 }),
    });
    const user = userEvent.setup();
    await mountKaunta();

    // Adding to the cart enables LIPA and puts the brass total on the slab
    // (1,700 appears nowhere else — tiles and cart lines carry 1,200 and 500).
    await user.click(screen.getByRole('button', { name: /^Soda Baridi/ }));
    await user.click(screen.getByRole('button', { name: /^Maji ya Uhai/ }));
    const lipa = screen.getByRole('button', { name: 'LIPA' });
    expect(lipa).toBeEnabled();
    expect(screen.getByText('TZS 1,700')).toBeInTheDocument();
    // The screen's own sticky pay bar is hidden — the slab owns the verb.
    expect(screen.queryByRole('button', { name: /^Lipa$/ })).not.toBeInTheDocument();

    await user.click(lipa);
    await screen.findByRole('heading', { name: 'Malipo' });
    expect(window.location.hash).toBe('#malipo');
    // Focused flow: the rail hides on Malipo.
    expect(screen.queryByRole('button', { name: 'Leo' })).not.toBeInTheDocument();
    // The screen's own submit button is hidden; the slab carries the verb.
    expect(screen.queryByRole('button', { name: /Maliza Mauzo/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'KAMILISHA MAUZO' }));
    await screen.findByText('Mauzo yamekamilika');
    expect(window.location.hash).toBe('#risiti');
    // Exactly one MAUZO MAPYA — the slab's (the screen's own CTA is hidden).
    expect(screen.getAllByRole('button', { name: 'Mauzo Mapya' })).toHaveLength(1);
    // SHIRIKI RISITI stays as the secondary action above the slab.
    expect(screen.getByRole('button', { name: 'Tuma Risiti' })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-4
 * ------------------------------------------------------------------------ */
describe('KAUNTA-4: the counted sync token deep-links to the Leo pending section', () => {
  it('shows the queue count as a brass pill and navigates to #leo/foleni', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      outbox: [makePendingSale('pend-q', 'idem-qqqq', [{ productId: 'p-soda', quantity: 1 }])],
    });
    const user = userEvent.setup();
    await mountKaunta();

    // Counted pill, not a dot: the token carries the number 1.
    const token = screen.getByRole('button', {
      name: 'Mauzo 1 yanasubiri kutumwa — fungua foleni',
    });
    expect(token).toHaveTextContent('1');

    await user.click(token);
    await screen.findByRole('heading', { name: 'Mauzo Yangu Leo' });
    expect(window.location.hash).toBe('#leo/foleni');

    // The pending group renders from IDB truth, fully offline.
    expect(screen.getByRole('heading', { name: 'Mauzo yanayosubiri kutumwa' })).toBeInTheDocument();
    expect(screen.getByText('Inasubiri mtandao')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tuma sasa/ })).toBeDisabled();
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-5
 * ------------------------------------------------------------------------ */
describe('KAUNTA-5: back-map — Malipo pops to Mauzo with the cart intact', () => {
  it('hardware back on Malipo returns to the sale with the built cart preserved', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await buildCartAndOpenMalipo(user, [/^Soda Baridi/, /^Maji ya Uhai/]);

    window.history.back();
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(window.location.hash).toBe('#mauzo');

    // Cart intact: the sale-items section and the slab total survive the pop.
    expect(screen.getByText('Bidhaa za mauzo')).toBeInTheDocument();
    expect(screen.getByText('TZS 1,700')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LIPA' })).toBeEnabled();
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-6
 * ------------------------------------------------------------------------ */
describe('KAUNTA-6: back-map — Risiti pops to a FRESH Mauzo, never Malipo', () => {
  it('hardware back on Risiti lands on a clean sale screen (cart cleared, LIPA disabled)', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await buildCartAndOpenMalipo(user, [/^Soda Baridi/]);

    await user.click(screen.getByRole('button', { name: 'KAMILISHA MAUZO' }));
    await screen.findByText('Mauzo yamekamilika');

    window.history.back();
    // Never re-pops Malipo: the receipt replaced the payment history entry.
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(screen.queryByRole('heading', { name: 'Malipo' })).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#mauzo');

    // Fresh counter: no cart section, LIPA disabled again.
    expect(screen.queryByText('Bidhaa za mauzo')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'LIPA' })).toBeDisabled();
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-7 / KAUNTA-8 — cold-boot hash contract
 * ------------------------------------------------------------------------ */
describe('KAUNTA-7: cold boot honors module deep links', () => {
  it('boot with #leo lands on the Leo day book, and MAUZO MAPYA still returns to the counter', async () => {
    buildHarness();
    window.history.replaceState(null, '', '/#leo');
    const user = userEvent.setup();

    render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Mauzo Yangu Leo' });
    expect(window.location.hash).toBe('#leo');
    expect(screen.getByRole('button', { name: 'Mauzo Mapya' })).toBeInTheDocument();

    // The deep-link boot manufactured a #mauzo entry beneath, so the verb's
    // back-unwind lands on the counter instead of exiting the PWA.
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(window.location.hash).toBe('#mauzo');
  });
});

describe('KAUNTA-8: cold boot normalizes flow-interior hashes', () => {
  it('boot with #malipo opens Mauzo (memory-only flow state cannot survive a cold boot)', async () => {
    buildHarness();
    window.history.replaceState(null, '', '/#malipo');

    render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(window.location.hash).toBe('#mauzo');
    expect(screen.queryByRole('heading', { name: 'Malipo' })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-9
 * ------------------------------------------------------------------------ */
describe('KAUNTA-9: Mipangilio via the rail gear', () => {
  it('shows the identity card, language toggle and logout; its slab verb returns to selling', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();

    await user.click(screen.getByRole('button', { name: 'Mipangilio' }));
    await screen.findByRole('heading', { name: 'Mipangilio' });
    expect(window.location.hash).toBe('#mipangilio');

    // Identity card from the session — terminal property, set by the office.
    expect(screen.getByText('Asha Rep')).toBeInTheDocument();
    expect(screen.getByText('Kaunta 1 · T-001')).toBeInTheDocument();
    expect(screen.getByText('Tawi la Kariakoo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Toka' })).toBeEnabled();

    // Language toggle is live (sw → en re-renders the shell copy).
    await user.click(screen.getByRole('button', { name: 'EN' }));
    await screen.findByRole('heading', { name: 'Settings' });

    // The slab verb on a verb-less screen returns to the counter.
    await user.click(screen.getByRole('button', { name: 'New Sale' }));
    await screen.findByRole('heading', { name: 'Add products' });
    expect(window.location.hash).toBe('#mauzo');
  });
});

/* ------------------------------------------------------------------------ *
 * KAUNTA-10
 * ------------------------------------------------------------------------ */
describe('KAUNTA-10: uiVersion < 2 keeps the classic shell untouched', () => {
  it('renders the classic HomeScreen flow with no rail and no slab', async () => {
    buildHarness({ session: makeSession() }); // no uiVersion at all
    const user = userEvent.setup();

    render(<MobilePosLite />);
    // Classic home: the big Mauzo Mapya CTA.
    await screen.findByRole('button', { name: 'Mauzo Mapya' });

    // No Kaunta chrome anywhere.
    expect(screen.queryByRole('button', { name: 'LIPA' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Leo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mipangilio' })).not.toBeInTheDocument();

    // The classic sale flow still carries its own sticky pay bar.
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await user.click(screen.getByRole('button', { name: /^Soda Baridi/ }));
    expect(screen.getByRole('button', { name: 'Lipa' })).toBeInTheDocument();
  });
});

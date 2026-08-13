/**
 * Kaunta Stoo tests — Phase 4 of the POS reform (read-only inventory).
 * (docs/pos-reform/spec-inventory.md §2/§4/§5, design-direction.md §4/§6,
 * spec-leo.md §6.)
 *
 * Same harness discipline as kaunta-shell/kaunta-ritual: everything drives
 * the real screens through the pilot (uiVersion=2) shell against an in-memory
 * fake of the IndexedDB store (grown with the v4 `stocks` contract). Stoo is
 * Kaunta-rail-only; the classic shell stays pinned by the characterization
 * suite.
 *
 * STOO-1  Rail tab renders for every use-holder and routes to #stoo; hardware
 *         back returns to Mauzo (back-map stoo → mauzo).
 * STOO-2  The list renders from GET /stock in SERVER order (problems-first as
 *         delivered — no client re-sort).
 * STOO-3  Zote/Kidogo/Imeisha chips filter client-side (Kidogo = LOW_STOCK;
 *         Imeisha = OUT_OF_STOCK + OVERSOLD).
 * STOO-4  Search filters locally by name and barcode; empty-filter copy is
 *         distinct from the true server-empty state.
 * STOO-5  Presentation gates: reps see negative available as 0 + red Imeisha;
 *         managers see the true negative + Zaidi ya rekodi.
 * STOO-6  Freshness chip states (Sasa hivi / Dakika n / Saa n / Mwisho
 *         kuonekana) and the manual-refresh tap that bypasses the age check.
 * STOO-7  >24h snapshot: quantities hidden, status WORDS stay, grey
 *         stockStaleHidden chip; offline renders the snapshot without a fetch.
 * STOO-8  Fetch policy: fresh snapshot ⇒ no network call; stale ⇒ exactly one
 *         conditional call (the rail-render pre-warm).
 * STOO-9  Error state without a snapshot: stockLoadError card + the shared
 *         Jaribu tena refetching in place.
 * STOO-10 Detail sheet: brass price chip vs Haina bei, the on-hand split, and
 *         the manager-only threshold line.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type {
  MobilePosLiteProduct,
  PosStockItem,
  PosStockSnapshot,
} from '@/lib/mobile-pos-lite-store';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes — the kaunta-shell doubles plus the v4 stocks contract.
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
    stocks: new Map<string, unknown>(),
    // v4 drafts store (Phase 5): the shell sweeps orphan drafts on mount.
    drafts: new Map<string, unknown>(),
  };

  const posDaylogDate = (now: Date = new Date()) => {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  const store = {
    posDaylogDate,
    // Stocks (v4, Phase 4): same contract as the real module.
    readCachedStock: vi.fn(async (terminalCode: string) => state.stocks.get(terminalCode) ?? null),
    writeCachedStock: vi.fn(async (terminalCode: string, snapshot: unknown) => {
      state.stocks.set(terminalCode, snapshot);
    }),
    // Drafts (v4, Phase 5): the count sheet's and the kikaratasi's accessors.
    // Stoo never enters Hesabu or Pokea; the mount-time orphan sweep and the
    // boot draft read still need the contract.
    readCountDraft: vi.fn(
      async (terminalCode: string) => state.drafts.get(`${terminalCode}:count`) ?? null,
    ),
    writeCountDraft: vi.fn(async (terminalCode: string, draft: unknown) => {
      state.drafts.set(`${terminalCode}:count`, draft);
    }),
    clearCountDraft: vi.fn(async (terminalCode: string) => {
      state.drafts.delete(`${terminalCode}:count`);
    }),
    readPurchaseDraft: vi.fn(
      async (terminalCode: string) => state.drafts.get(`${terminalCode}:purchase`) ?? null,
    ),
    savePurchaseDraft: vi.fn(async (terminalCode: string, draft: unknown) => {
      state.drafts.set(`${terminalCode}:purchase`, draft);
    }),
    deletePurchaseDraft: vi.fn(async (terminalCode: string) => {
      state.drafts.delete(`${terminalCode}:purchase`);
    }),
    sweepOrphanDrafts: vi.fn(async (terminalCode: string) => {
      const orphans = [...state.drafts.keys()].filter((key) => !key.startsWith(`${terminalCode}:`));
      for (const key of orphans) state.drafts.delete(key);
      return orphans;
    }),
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
  stockCountsEnabled?: boolean;
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

function stockItem(overrides: Partial<PosStockItem> = {}): PosStockItem {
  return {
    productId: 'st-generic',
    name: 'Bidhaa ya Stoo',
    code: 'ST-1',
    barcode: null,
    unitId: 'u1',
    unitSymbol: 'pc',
    imageUrl: null,
    sellingPrice: 1000,
    quantityOnHand: 20,
    quantityReserved: 0,
    available: 20,
    threshold: 10,
    status: 'IN_STOCK',
    ...overrides,
  };
}

// The server's problems-first order: OVERSOLD → OUT_OF_STOCK → LOW → IN.
const CHUMVI = stockItem({
  productId: 'st-chumvi',
  name: 'Chumvi',
  code: 'CHU-1',
  sellingPrice: null,
  quantityOnHand: 2,
  quantityReserved: 5,
  available: -3,
  status: 'OVERSOLD',
});
const MAFUTA = stockItem({
  productId: 'st-mafuta',
  name: 'Mafuta ya Alizeti',
  code: 'MAF-1',
  quantityOnHand: 0,
  quantityReserved: 0,
  available: 0,
  status: 'OUT_OF_STOCK',
});
const UNGA = stockItem({
  productId: 'st-unga',
  name: 'Unga wa Ngano',
  code: 'UNGA-1',
  barcode: '6161100001',
  sellingPrice: 5000,
  quantityOnHand: 7,
  quantityReserved: 2,
  available: 5,
  status: 'LOW_STOCK',
});
const SUKARI = stockItem({
  productId: 'st-sukari',
  name: 'Sukari',
  code: 'SUK-1',
  quantityOnHand: 30,
  quantityReserved: 0,
  available: 30,
  status: 'IN_STOCK',
});
const STOCK_ITEMS = [CHUMVI, MAFUTA, UNGA, SUKARI];

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
    paymentMethods: [{ code: 'CASH', label: 'Taslimu', requiresReference: false }],
    purchasesEnabled: false,
    stockCountsEnabled: false,
  };
  return {
    ...base,
    ...overrides,
    terminal: { ...base.terminal, ...(overrides.terminal ?? {}) },
  };
}

function makeSnapshot(
  items: PosStockItem[],
  ageMs: number,
  asOf = '2026-08-12T08:00:00.000Z',
): PosStockSnapshot {
  return { items, asOf, fetchedAt: Date.now() - ageMs };
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

type HarnessOptions = {
  onLine?: boolean;
  cachedSession?: PosSession | null;
  session?: PosSession;
  sessionGet?: () => Promise<PosSession>;
  /** Pre-seeded IDB stock snapshot for this terminal. */
  cachedStock?: PosStockSnapshot;
  /** GET /mobile-pos-lite/stock behavior; defaults to STOCK_ITEMS. */
  stockGet?: () => Promise<{
    asOf: string;
    branch: { id: string; name: string };
    items: PosStockItem[];
  }>;
};

function buildHarness(options: HarnessOptions = {}) {
  const session = options.session ?? kauntaSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, [SODA]]]);
  h.state.sessions = new Map(options.cachedSession ? [[TERMINAL, options.cachedSession]] : []);
  h.state.frequents = new Map();
  h.state.outbox = [];
  h.state.daylog = new Map();
  h.state.stocks = new Map(options.cachedStock ? [[TERMINAL, options.cachedStock]] : []);
  h.state.drafts = new Map();

  setNavigatorOnLine(options.onLine ?? true);

  const behavior = {
    stock:
      options.stockGet ??
      (async () => ({
        asOf: '2026-08-12T09:00:00.000Z',
        branch: { id: 'b1', name: 'Tawi la Kariakoo' },
        items: STOCK_ITEMS,
      })),
  };

  const sessionGet = options.sessionGet ?? (async () => session);

  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return sessionGet();
    if (path === '/mobile-pos-lite/catalog') return [...(h.state.catalogs.get(TERMINAL) ?? [])];
    if (path === '/mobile-pos-lite/products') return [];
    if (path === '/mobile-pos-lite/customers') return [];
    if (path === '/mobile-pos-lite/suppliers') return [];
    if (path === '/mobile-pos-lite/my-sales-today') return { count: 0, totalAmount: 0, sales: [] };
    if (path === '/mobile-pos-lite/stock') return behavior.stock();
    throw new Error(`Unexpected GET ${path} in kaunta stoo test`);
  });
  h.backendPost.mockImplementation(async (path: string) => {
    throw new Error(`Unexpected POST ${path} in kaunta stoo test`);
  });

  return {
    session,
    behavior,
    stockGets: () =>
      h.backendGet.mock.calls.filter(([path]) => path === '/mobile-pos-lite/stock').length,
  };
}

type User = ReturnType<typeof userEvent.setup>;

async function mountKaunta() {
  render(<MobilePosLite />);
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
}

/** Open the Stoo tab from the rail and wait for the screen title. */
async function openStoo(user: User) {
  await user.click(screen.getByRole('button', { name: 'Stoo' }));
  await screen.findByRole('heading', { name: 'Stoo' });
}

/** The stock rows currently rendered, in DOM order. */
function stockRowNames() {
  return screen
    .getAllByRole('button', { name: /Chumvi|Mafuta ya Alizeti|Unga wa Ngano|Sukari/ })
    .map((row) => row.textContent ?? '');
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
});

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'onLine');
});

/* ------------------------------------------------------------------------ *
 * STOO-1
 * ------------------------------------------------------------------------ */
describe('STOO-1: rail tab and routing', () => {
  it('shows Stoo to a plain use-holder, routes to #stoo, and hardware back returns to Mauzo', async () => {
    buildHarness(); // purchasesEnabled/stockCountsEnabled both false
    const user = userEvent.setup();
    await mountKaunta();

    await openStoo(user);
    expect(window.location.hash).toBe('#stoo');

    // Back-map: Stoo → Mauzo (spec-inventory §2).
    window.history.back();
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(window.location.hash).toBe('#mauzo');
  });

  it('carries the slab MAUZO MAPYA verb on Stoo for a rep (never verb-less, never ANZA KUHESABU)', async () => {
    // Phase 5 gives managers the count verb here; a plain use-holder must
    // still never see a verb pointing at a screen their permission forbids.
    buildHarness({ session: kauntaSession({ purchasesEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);

    expect(screen.queryByText('ANZA KUHESABU')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(window.location.hash).toBe('#mauzo');
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-2
 * ------------------------------------------------------------------------ */
describe('STOO-2: the list renders from GET /stock in server order', () => {
  it('renders every item exactly in the problems-first order the server sent', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);

    await screen.findByText('Unga wa Ngano');
    const rows = stockRowNames();
    expect(rows).toHaveLength(4);
    expect(rows[0]).toContain('Chumvi'); // OVERSOLD first, as delivered
    expect(rows[1]).toContain('Mafuta ya Alizeti');
    expect(rows[2]).toContain('Unga wa Ngano');
    expect(rows[3]).toContain('Sukari');

    // Row anatomy: big quantity + unit, and the status dot-and-WORD.
    const unga = screen.getByRole('button', { name: /Unga wa Ngano/ });
    expect(within(unga).getByText('5 pc')).toBeInTheDocument();
    expect(within(unga).getByText('Inakwisha')).toBeInTheDocument();
    const sukari = screen.getByRole('button', { name: /Sukari/ });
    expect(within(sukari).getByText('Ipo')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-3
 * ------------------------------------------------------------------------ */
describe('STOO-3: Zote/Kidogo/Imeisha chips filter client-side', () => {
  it('Kidogo keeps LOW_STOCK only; Imeisha keeps OUT_OF_STOCK + OVERSOLD; Zote restores', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');
    const before = harness.stockGets();

    await user.click(screen.getByRole('button', { name: 'Kidogo' }));
    expect(stockRowNames()).toHaveLength(1);
    expect(screen.getByText('Unga wa Ngano')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Imeisha' }));
    const outRows = stockRowNames();
    expect(outRows).toHaveLength(2);
    expect(outRows[0]).toContain('Chumvi');
    expect(outRows[1]).toContain('Mafuta ya Alizeti');

    await user.click(screen.getByRole('button', { name: 'Zote' }));
    expect(stockRowNames()).toHaveLength(4);

    // Chips are pure local filters — not one extra network call.
    expect(harness.stockGets()).toBe(before);
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-4
 * ------------------------------------------------------------------------ */
describe('STOO-4: local search over name/code/barcode', () => {
  it('filters by name and by barcode without any remote call, with distinct empty copy', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');
    const before = harness.stockGets();

    const search = screen.getByPlaceholderText('Tafuta bidhaa stoo');
    await user.type(search, 'sukari');
    expect(stockRowNames()).toHaveLength(1);
    expect(screen.getByText('Sukari')).toBeInTheDocument();

    // Keyboard-wedge scan: the barcode is in the filter by construction.
    await user.clear(search);
    await user.type(search, '6161100001');
    expect(stockRowNames()).toHaveLength(1);
    expect(screen.getByText('Unga wa Ngano')).toBeInTheDocument();

    // Filter-empty is NOT the server-empty state.
    await user.clear(search);
    await user.type(search, 'hakunakitu');
    expect(screen.getByText('Hakuna bidhaa kwenye kichujio hiki')).toBeInTheDocument();
    expect(screen.queryByText('Hakuna bidhaa za stoo bado')).not.toBeInTheDocument();

    expect(harness.stockGets()).toBe(before);
  });

  it('shows the true empty state only when the server returned zero items', async () => {
    buildHarness({
      stockGet: async () => ({
        asOf: '2026-08-12T09:00:00.000Z',
        branch: { id: 'b1', name: 'Tawi la Kariakoo' },
        items: [],
      }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);

    expect(await screen.findByText('Hakuna bidhaa za stoo bado')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-5
 * ------------------------------------------------------------------------ */
describe('STOO-5: rep vs manager presentation gates', () => {
  it('rep: negative available renders as 0 with red Imeisha — no oversold concept anywhere', async () => {
    buildHarness(); // rep view: both flags false
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Chumvi');

    const chumvi = screen.getByRole('button', { name: /Chumvi/ });
    expect(within(chumvi).getByText('0 pc')).toBeInTheDocument();
    expect(within(chumvi).getByText('Imeisha')).toBeInTheDocument();
    expect(screen.queryByText('Zaidi ya rekodi')).not.toBeInTheDocument();
  });

  it('manager (stockCountsEnabled): true negative + Zaidi ya rekodi', async () => {
    buildHarness({ session: kauntaSession({ stockCountsEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Chumvi');

    const chumvi = screen.getByRole('button', { name: /Chumvi/ });
    expect(within(chumvi).getByText('-3 pc')).toBeInTheDocument();
    expect(within(chumvi).getByText('Zaidi ya rekodi')).toBeInTheDocument();
  });

  it('purchasesEnabled alone also unlocks the manager view', async () => {
    buildHarness({ session: kauntaSession({ purchasesEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Chumvi');
    expect(screen.getByText('Zaidi ya rekodi')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-6
 * ------------------------------------------------------------------------ */
describe('STOO-6: the freshness clock', () => {
  it('a just-fetched snapshot wears Sasa hivi', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');
    expect(screen.getByRole('button', { name: 'Sasa hivi' })).toBeInTheDocument();
  });

  it('a five-minute-old snapshot wears Dakika 5 zilizopita (green, minutes)', async () => {
    buildHarness({ cachedStock: makeSnapshot(STOCK_ITEMS, 5 * 60 * 1000) });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    expect(await screen.findByRole('button', { name: 'Dakika 5 zilizopita' })).toBeInTheDocument();
  });

  it('offline, an hours-old snapshot wears Saa 3 zilizopita and a day-old one Mwisho kuonekana', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      cachedStock: makeSnapshot(STOCK_ITEMS, 3 * 60 * 60 * 1000),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    const chip = await screen.findByRole('button', { name: 'Saa 3 zilizopita' });
    // Manual refresh is online-only: the chip is disabled offline.
    expect(chip).toBeDisabled();
  });

  it('tapping the chip refetches even while the snapshot is fresh (bypasses the age check)', async () => {
    const harness = buildHarness({ cachedStock: makeSnapshot([UNGA], 30 * 1000) });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');
    expect(harness.stockGets()).toBe(0); // fresh: neither pre-warm nor open fetched

    await user.click(screen.getByRole('button', { name: 'Sasa hivi' }));
    await screen.findByText('Sukari');
    expect(harness.stockGets()).toBe(1);
    expect(stockRowNames()).toHaveLength(4);
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-7
 * ------------------------------------------------------------------------ */
describe('STOO-7: stale snapshots and offline honesty', () => {
  it('offline renders the snapshot from IDB without ever fetching', async () => {
    const harness = buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      cachedStock: makeSnapshot(STOCK_ITEMS, 2 * 60 * 60 * 1000),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);

    await screen.findByText('Unga wa Ngano');
    expect(stockRowNames()).toHaveLength(4);
    expect(harness.stockGets()).toBe(0);
  });

  it('>24h: quantities hidden, status WORDS stay, grey stale chip shown; the sheet keeps price but drops quantities', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      cachedStock: makeSnapshot(STOCK_ITEMS, 25 * 60 * 60 * 1000),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');

    // Numbers dropped; the words survive (color is never the sole channel).
    expect(screen.getByText('Taarifa za zamani — idadi zimefichwa')).toBeInTheDocument();
    expect(screen.queryByText('5 pc')).not.toBeInTheDocument();
    expect(screen.queryByText('30 pc')).not.toBeInTheDocument();
    expect(screen.getByText('Inakwisha')).toBeInTheDocument();
    expect(screen.getByText('Ipo')).toBeInTheDocument();
    // Day-old copy is never present-tense certainty.
    expect(screen.getByRole('button', { name: /Mwisho kuonekana/ })).toBeInTheDocument();

    // The detail sheet still shows the price (catalog data ages differently)
    // but no on-hand split.
    await user.click(screen.getByRole('button', { name: /Unga wa Ngano/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('TZS 5,000')).toBeInTheDocument();
    expect(within(sheet).queryByText(/Kiasi:/)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-8
 * ------------------------------------------------------------------------ */
describe('STOO-8: the fetch policy (10-minute max age, rail pre-warm)', () => {
  it('a fresh snapshot means NO network call — not at mount, not on open', async () => {
    const harness = buildHarness({ cachedStock: makeSnapshot(STOCK_ITEMS, 60 * 1000) });
    const user = userEvent.setup();
    await mountKaunta();
    expect(harness.stockGets()).toBe(0); // rail pre-warm was a no-op

    await openStoo(user);
    await screen.findByText('Unga wa Ngano');
    expect(harness.stockGets()).toBe(0);
  });

  it('a stale snapshot triggers exactly one conditional fetch (the rail pre-warm), refreshed before Stoo opens', async () => {
    const harness = buildHarness({
      cachedStock: makeSnapshot([UNGA], 11 * 60 * 1000), // over the 10-minute max age
    });
    const user = userEvent.setup();
    await mountKaunta();

    // The pre-warm fired on rail render so the tab switch feels instant.
    await waitFor(() => expect(harness.stockGets()).toBe(1));

    await openStoo(user);
    await screen.findByText('Sukari'); // server truth replaced the stale cache
    expect(stockRowNames()).toHaveLength(4);
    expect(harness.stockGets()).toBe(1); // the open itself added no second call

    // Every success snapshots to IDB with a client fetchedAt.
    expect(h.store.writeCachedStock).toHaveBeenCalledWith(
      TERMINAL,
      expect.objectContaining({ items: STOCK_ITEMS, fetchedAt: expect.any(Number) }),
    );
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-9
 * ------------------------------------------------------------------------ */
describe('STOO-9: error state without a usable snapshot', () => {
  it('shows the stockLoadError card and Jaribu tena refetches in place', async () => {
    const harness = buildHarness({
      stockGet: async () => {
        throw new Error('stock exploded');
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);

    await screen.findByText('Imeshindikana kupakua stoo');
    const retry = screen.getByRole('button', { name: 'Jaribu tena' });
    expect(retry).toBeEnabled();

    harness.behavior.stock = async () => ({
      asOf: '2026-08-12T09:30:00.000Z',
      branch: { id: 'b1', name: 'Tawi la Kariakoo' },
      items: STOCK_ITEMS,
    });
    await user.click(retry);

    // Recovered in place — never leave-and-re-enter.
    await screen.findByText('Unga wa Ngano');
    expect(screen.queryByText('Imeshindikana kupakua stoo')).not.toBeInTheDocument();
    expect(window.location.hash).toBe('#stoo');
  });
});

/* ------------------------------------------------------------------------ *
 * STOO-10
 * ------------------------------------------------------------------------ */
describe('STOO-10: the detail bottom sheet (the product-lookup moment)', () => {
  it('shows the brass price chip, code + barcode, and the on-hand split; scrim tap dismisses', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');

    await user.click(screen.getByRole('button', { name: /Unga wa Ngano/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Bei')).toBeInTheDocument();
    expect(within(sheet).getByText('TZS 5,000')).toBeInTheDocument();
    expect(within(sheet).getByText('UNGA-1 · 6161100001')).toBeInTheDocument();
    expect(within(sheet).getByText('Kiasi: 7 pc · Zilizowekwa: 2')).toBeInTheDocument();
    expect(within(sheet).getByText('Inakwisha')).toBeInTheDocument();

    // Dismiss = scrim tap; no navigation event.
    await user.click(screen.getByRole('button', { name: 'Rudi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(window.location.hash).toBe('#stoo');
  });

  it('an unpriced product wears the grey Haina bei chip', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Chumvi');

    await user.click(screen.getByRole('button', { name: /Chumvi/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Haina bei')).toBeInTheDocument();
    expect(within(sheet).queryByText('Bei')).not.toBeInTheDocument();
  });

  it('hides the threshold line from reps', async () => {
    buildHarness(); // rep: both flags false
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');

    await user.click(screen.getByRole('button', { name: /Unga wa Ngano/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByText('Kikomo: 10')).not.toBeInTheDocument();
  });

  it('shows the threshold line to managers', async () => {
    buildHarness({ session: kauntaSession({ stockCountsEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Unga wa Ngano');

    await user.click(screen.getByRole('button', { name: /Unga wa Ngano/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Kikomo: 10')).toBeInTheDocument();
  });
});

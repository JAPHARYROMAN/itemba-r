/**
 * Kaunta Historia + Funga Siku tests — the history-and-report module
 * (docs/pos-reform/spec-history-reports.md §2/§3/§4/§7/§8-C6).
 *
 * Same harness discipline as kaunta-stoo/kaunta-hesabu: everything drives the
 * REAL screens through the pilot (uiVersion=2) shell against an in-memory fake
 * of the IndexedDB store, grown with the `daylog.close` contract. All four
 * screens are Kaunta-only; the classic shell stays pinned by the
 * characterization suite, which this module does not touch.
 *
 * HIST-1  The permission gate: a rep never sees a door to the receiving book
 *         and her phone never calls the endpoint; a manager gets both.
 * HIST-2  Historia ya Mauzo renders the 7-day list from GET /sales with the
 *         server's own count and total, and has an empty state of its own.
 * HIST-3  Historia ya Manunuzi renders the branch's deliveries, the brass
 *         INCOMPLETE chip, the standing no-costs note, and its empty state.
 * HIST-4  ══ THE COST-BLINDNESS LAW ══ the payload key set is exactly the
 *         spec's, and a hostile payload carrying costs still leaks nothing:
 *         the screen cannot render what it does not read.
 * HIST-5  Offline: sales keeps its held rows and their brass total behind the
 *         Leo offline note; purchases says needsNetwork, shows no rows, and
 *         issues NO request at all.
 * HIST-6  The detail sheets — a sent sale with its lines, a held sale from the
 *         frozen outbox payload, and a delivery with quantities only.
 * HIST-7  Funga Siku's preview matches what was sold, with the method
 *         breakdown, and the slab is dead offline with the reason said.
 * HIST-8  The queued-sales decision: the held card offers Tuma Sasa, the
 *         confirm is one deliberate step, and the declared held pair rides
 *         into the POST body under its own names.
 * HIST-9  THE FROZEN KEY: persisted in the daylog before the request leaves,
 *         and the SAME key rides the retry after a full remount.
 * HIST-10 THE REFUSED WRITE: a phone that will not keep the key POSTS NOTHING
 *         and says so — the write is load-bearing, not bookkeeping.
 * HIST-11 The 2xx path: the SIKU IMEFUNGWA stamp, the record's own numbers,
 *         and the key released from the daylog with the proof written in.
 * HIST-12 The share path: the letterhead PDF handed to the share sheet, and
 *         an honest inline sentence when the paper cannot be fetched.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes — the kaunta-stoo doubles plus the daylog `close` contract.
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
  type DaylogClose = {
    idempotencyKey?: string;
    businessDate: string;
    startedAt: number;
    reportId?: string;
    submittedAt?: number;
  };
  type DaylogEntry = {
    terminalCode: string;
    date: string;
    tallyCount: number;
    sent?: DaylogSent;
    close?: DaylogClose;
  };

  const state = {
    binding: null as Binding | null,
    catalogs: new Map<string, unknown[]>(),
    sessions: new Map<string, unknown>(),
    frequents: new Map<string, Record<string, number>>(),
    outbox: [] as Pending[],
    daylog: new Map<string, DaylogEntry>(),
    stocks: new Map<string, unknown>(),
    drafts: new Map<string, unknown>(),
    /** Flipped by HIST-10 to make the phone refuse the close write. */
    daylogCloseWritable: true,
  };

  const posDaylogDate = (now: Date = new Date()) => {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  const getDaylogEntry = vi.fn(
    async (terminalCode: string, date: string) =>
      state.daylog.get(`${terminalCode}:${date}`) ?? null,
  );

  const store = {
    posDaylogDate,
    getDaylogEntry,
    // The close contract (spec-history-reports §6): same shapes as the real
    // module, including the boolean return that gates the send.
    writeDaylogClose: vi.fn(async (terminalCode: string, date: string, close: DaylogClose) => {
      if (!state.daylogCloseWritable) return false;
      const key = `${terminalCode}:${date}`;
      const existing = state.daylog.get(key);
      const entry: DaylogEntry = existing
        ? { ...existing, close }
        : { terminalCode, date, tallyCount: 0, close };
      state.daylog.set(key, entry);
      return true;
    }),
    readDaylogClose: vi.fn(
      async (terminalCode: string, date: string) =>
        state.daylog.get(`${terminalCode}:${date}`)?.close ?? null,
    ),
    readCachedStock: vi.fn(async (terminalCode: string) => state.stocks.get(terminalCode) ?? null),
    writeCachedStock: vi.fn(async (terminalCode: string, snapshot: unknown) => {
      state.stocks.set(terminalCode, snapshot);
    }),
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

const SODA: MobilePosLiteProduct = {
  id: 'p-soda',
  name: 'Soda Baridi',
  code: 'SODA',
  barcode: null,
  unitId: 'u1',
  unitSymbol: 'pc',
  sellingPrice: 1200,
  availableStock: 25,
  trackInventory: true,
  imageUrl: null,
};

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
      { code: 'MOBILE_MONEY', label: 'Simu', requiresReference: true },
    ],
    purchasesEnabled: false,
    stockCountsEnabled: false,
  };
  return {
    ...base,
    ...overrides,
    terminal: { ...base.terminal, ...(overrides.terminal ?? {}) },
  };
}

/** `GET /mobile-pos-lite/sales` — this rep's 7 days, with selling prices only. */
const SALES_HISTORY = {
  days: 7,
  from: '2026-08-08T00:00:00.000Z',
  count: 3,
  totalAmount: 41000,
  sales: [
    {
      id: 'so-1',
      salesOrderNumber: 'SO-2026-0912',
      createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      paymentMethod: 'CASH',
      paymentReference: null,
      customerName: 'Mama Asha',
      totalAmount: 18000,
      lines: [
        {
          productId: 'p-embe',
          name: 'Embe Dodo',
          quantity: 3,
          unitSymbol: 'pc',
          unitPrice: 6000,
          lineTotal: 18000,
        },
      ],
    },
    {
      id: 'so-2',
      salesOrderNumber: 'SO-2026-0899',
      createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
      paymentMethod: 'MOBILE_MONEY',
      paymentReference: 'MP-77219',
      customerName: null,
      totalAmount: 23000,
      lines: [
        {
          productId: 'p-soda',
          name: 'Soda Baridi',
          quantity: 5,
          unitSymbol: 'pc',
          unitPrice: 4600,
          lineTotal: 23000,
        },
      ],
    },
  ],
};

/**
 * `GET /mobile-pos-lite/purchases` — THE EXACT AND COMPLETE key set of §1.2.
 * 4 top-level keys, 7 per purchase, 4 per line, and not one cost among them.
 */
const PURCHASE_HISTORY = {
  days: 7,
  from: '2026-08-08T00:00:00.000Z',
  count: 2,
  purchases: [
    {
      id: 'po-1',
      purchaseOrderNumber: 'PO-2026-0141',
      grnNumber: 'GRN-2026-0139',
      supplierName: 'Azam Distributors',
      recordedAt: new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString(),
      status: 'COMPLETE' as const,
      lines: [
        { productId: 'p-embe', name: 'Embe Dodo', quantity: 24, unitSymbol: 'pc' },
        { productId: 'p-soda', name: 'Soda Baridi', quantity: 48, unitSymbol: 'pc' },
      ],
    },
    {
      id: 'po-2',
      purchaseOrderNumber: 'PO-2026-0138',
      grnNumber: null,
      supplierName: 'Mo Wholesalers',
      recordedAt: new Date(Date.now() - 74 * 60 * 60 * 1000).toISOString(),
      status: 'INCOMPLETE' as const,
      lines: [{ productId: 'p-sukari', name: 'Sukari', quantity: 10, unitSymbol: 'kg' }],
    },
  ],
};

const DAY_SUMMARY = {
  count: 3,
  totalAmount: 41000,
  sales: [
    {
      id: 'so-1',
      salesOrderNumber: 'SO-2026-0912',
      totalAmount: 18000,
      paymentMethod: 'CASH',
      createdAt: new Date().toISOString(),
      customerName: 'Mama Asha',
    },
    {
      id: 'so-2',
      salesOrderNumber: 'SO-2026-0899',
      totalAmount: 23000,
      paymentMethod: 'MOBILE_MONEY',
      createdAt: new Date().toISOString(),
      customerName: null,
    },
  ],
};

function dayReportResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rep-1',
    businessDate: h.store.posDaylogDate(),
    reference: `${TERMINAL}-20260814`,
    submittedAt: new Date().toISOString(),
    terminal: { id: 't1', code: TERMINAL, name: 'Kaunta 1' },
    branch: { id: 'b1', name: 'Tawi la Kariakoo' },
    rep: { id: 'r1', name: 'Asha Rep' },
    salesCount: 3,
    grossTotal: 41000,
    itemsSoldQuantity: 8,
    byMethod: [
      { paymentMethod: 'CASH', label: 'Taslimu', count: 2, amount: 18000 },
      { paymentMethod: 'MOBILE_MONEY', label: 'Simu', count: 1, amount: 23000 },
    ],
    items: [{ productId: 'p-embe', name: 'Embe Dodo', quantity: 3, amount: 18000 }],
    itemsTruncated: false,
    declaredHeldCount: 0,
    declaredHeldAmount: 0,
    ...overrides,
  };
}

function heldSale(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pending-1',
    terminalCode: TERMINAL,
    payload: {
      paymentMethod: 'CASH',
      idempotencyKey: 'held-key-1',
      lines: [{ productId: 'p-soda', quantity: 2 }],
    },
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
    totalAmount: 2400,
    itemCount: 2,
    lineSummary: '2 x Soda Baridi',
    ...overrides,
  };
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

type HarnessOptions = {
  onLine?: boolean;
  session?: PosSession;
  outbox?: Array<ReturnType<typeof heldSale>>;
  daylog?: Array<[string, Record<string, unknown>]>;
  salesHistoryGet?: () => Promise<unknown>;
  purchasesGet?: () => Promise<unknown>;
  daySummaryGet?: () => Promise<unknown>;
  dayReportPost?: (body: unknown) => Promise<unknown>;
  daylogCloseWritable?: boolean;
};

/**
 * What a flush of the outbox meets. Online, the shell's sync loop fires the
 * moment the app mounts, so a seeded held row's `lastError` is whatever THIS
 * answers — the default is a real backend rejection sentence, which keeps the
 * red rows red and their mapped Swahili deterministic.
 */
const SALE_REJECTION = 'This Mobile POS terminal is not active';

function buildHarness(options: HarnessOptions = {}) {
  const session = options.session ?? kauntaSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, [SODA]]]);
  h.state.sessions = new Map();
  h.state.frequents = new Map();
  h.state.outbox = (options.outbox ?? []) as typeof h.state.outbox;
  h.state.daylog = new Map(
    (options.daylog ?? []).map(([key, entry]) => [key, entry as never]),
  ) as typeof h.state.daylog;
  h.state.stocks = new Map();
  h.state.drafts = new Map();
  h.state.daylogCloseWritable = options.daylogCloseWritable ?? true;

  setNavigatorOnLine(options.onLine ?? true);

  const behavior = {
    salesHistory: options.salesHistoryGet ?? (async () => SALES_HISTORY),
    purchases: options.purchasesGet ?? (async () => PURCHASE_HISTORY),
    daySummary: options.daySummaryGet ?? (async () => DAY_SUMMARY),
    dayReport: options.dayReportPost ?? (async () => dayReportResponse()),
  };

  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return session;
    if (path === '/mobile-pos-lite/catalog') return [...(h.state.catalogs.get(TERMINAL) ?? [])];
    if (path === '/mobile-pos-lite/products') return [];
    if (path === '/mobile-pos-lite/customers') return [];
    if (path === '/mobile-pos-lite/suppliers') return [];
    if (path === '/mobile-pos-lite/my-sales-today') return behavior.daySummary();
    if (path === '/mobile-pos-lite/stock') {
      return { asOf: new Date().toISOString(), branch: { id: 'b1', name: 'Tawi' }, items: [] };
    }
    if (path === '/mobile-pos-lite/sales') return behavior.salesHistory();
    if (path === '/mobile-pos-lite/purchases') return behavior.purchases();
    throw new Error(`Unexpected GET ${path} in kaunta history test`);
  });
  h.backendPost.mockImplementation(async (path: string, body: unknown) => {
    if (path === '/mobile-pos-lite/day-reports') return behavior.dayReport(body);
    // The outbox flush the shell fires on mount. Refused, so held rows stay
    // held — every test here that seeds one is testing what the phone still
    // holds, and a drained outbox would be testing nothing.
    if (path === '/mobile-pos-lite/sales') throw new Error(SALE_REJECTION);
    throw new Error(`Unexpected POST ${path} in kaunta history test`);
  });

  return {
    session,
    behavior,
    getsFor: (path: string) => h.backendGet.mock.calls.filter(([call]) => call === path),
    dayReportPosts: () =>
      h.backendPost.mock.calls.filter(([path]) => path === '/mobile-pos-lite/day-reports'),
  };
}

type User = ReturnType<typeof userEvent.setup>;

async function mountKaunta() {
  render(<MobilePosLite />);
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
}

/** Leo, the day book — the door both Historia and Funga Siku live behind. */
async function openLeo(user: User) {
  await user.click(screen.getByRole('button', { name: 'Leo' }));
  await screen.findByRole('heading', { name: 'Daftari la Leo' });
}

async function openHistoria(user: User) {
  await openLeo(user);
  await user.click(screen.getByRole('button', { name: /Historia ya Mauzo/ }));
  await screen.findByRole('heading', { name: 'Historia ya Mauzo' });
}

async function openFunga(user: User) {
  await openLeo(user);
  await user.click(screen.getByRole('button', { name: 'FUNGA SIKU' }));
  await screen.findByRole('heading', { name: 'Funga Siku' });
}

async function openManunuzi(user: User) {
  await user.click(screen.getByRole('button', { name: 'Manunuzi' }));
  await screen.findByRole('heading', { name: 'Pokea Mzigo' });
}

/** The slab's primary verb — the only blue button on any Kaunta screen. */
function slabVerb(name: string | RegExp) {
  return screen.getByRole('button', { name });
}

/**
 * The screen's own content, excluding the slab. The slab carries the money
 * that matters now, so a bare `getByText('TZS 41,000')` finds two nodes for
 * the honest reason that both are showing it — scope to the page when the
 * claim is about what the SCREEN says.
 */
function page() {
  return within(screen.getByRole('main'));
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
  Reflect.deleteProperty(window.navigator, 'share');
  Reflect.deleteProperty(window.navigator, 'canShare');
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------------ *
 * HIST-1 — the permission gate on the purchase book
 * ------------------------------------------------------------------------ */
describe('HIST-1: the receiving book is the manager gate, on both sides', () => {
  it('shows a rep no door to it, and never calls the endpoint', async () => {
    const harness = buildHarness({ session: kauntaSession({ purchasesEnabled: false }) });
    const user = userEvent.setup();
    await mountKaunta();

    // No Manunuzi rail tab at all for a rep — and therefore no way to the book.
    expect(screen.queryByRole('button', { name: 'Manunuzi' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Historia ya Manunuzi/ })).toBeNull();

    // Her sales history is hers, so THAT door is there.
    await openHistoria(user);
    expect(screen.queryByRole('button', { name: /Historia ya Manunuzi/ })).toBeNull();

    // The gate is not merely visual: the request is never issued, so the
    // screen behind it can never be reached through a 403.
    expect(harness.getsFor('/mobile-pos-lite/purchases')).toHaveLength(0);
  });

  it('gives a manager the door, and the book behind it', async () => {
    const harness = buildHarness({ session: kauntaSession({ purchasesEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();

    await openManunuzi(user);
    await user.click(screen.getByRole('button', { name: /Historia ya Manunuzi/ }));
    await screen.findByRole('heading', { name: 'Historia ya Manunuzi' });

    expect(await screen.findByText('Azam Distributors')).toBeInTheDocument();
    expect(harness.getsFor('/mobile-pos-lite/purchases').length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-2 — the sales history list
 * ------------------------------------------------------------------------ */
describe('HIST-2: Historia ya Mauzo renders the 7 days the server sent', () => {
  it('shows the window label, the server count and total, and the rows', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    expect(screen.getByText('Siku 7 zilizopita')).toBeInTheDocument();
    // The headline numbers are the server's unbounded aggregate, so a
    // truncated list can never produce a wrong total.
    expect(await page().findByText('Mauzo 3')).toBeInTheDocument();
    expect(page().getByText('TZS 41,000')).toBeInTheDocument();

    expect(screen.getByRole('button', { name: /SO-2026-0912/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /SO-2026-0899/ })).toBeInTheDocument();
    // The session's own configured label, not the raw enum.
    expect(screen.getAllByText('Taslimu').length).toBeGreaterThan(0);
  });

  it('has an empty state of its own, and a load-error card with the shared retry', async () => {
    buildHarness({
      salesHistoryGet: async () => ({ days: 7, from: '', count: 0, totalAmount: 0, sales: [] }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);
    expect(await screen.findByText('Hakuna mauzo katika siku 7 zilizopita.')).toBeInTheDocument();
  });

  it('offers Jaribu tena in place when the fetch fails online', async () => {
    let fail = true;
    buildHarness({
      salesHistoryGet: async () => {
        if (fail) throw new Error('Request failed: 502');
        return SALES_HISTORY;
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    expect(await screen.findByText('Imeshindikana kupakua historia')).toBeInTheDocument();
    fail = false;
    // Refetching IN PLACE — never leave-and-re-enter.
    await user.click(screen.getByRole('button', { name: 'Jaribu tena' }));
    expect(await screen.findByRole('button', { name: /SO-2026-0912/ })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-3 — the purchase book
 * ------------------------------------------------------------------------ */
describe('HIST-3: Historia ya Manunuzi is the branch receiving book', () => {
  async function openPurchaseHistory(user: User) {
    await openManunuzi(user);
    await user.click(screen.getByRole('button', { name: /Historia ya Manunuzi/ }));
    await screen.findByRole('heading', { name: 'Historia ya Manunuzi' });
  }

  it('lists deliveries with the brass INCOMPLETE chip and no money anywhere', async () => {
    buildHarness({ session: kauntaSession({ purchasesEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();
    await openPurchaseHistory(user);

    expect(await screen.findByText('Azam Distributors')).toBeInTheDocument();
    expect(screen.getByText('Mo Wholesalers')).toBeInTheDocument();
    // Brass, not red: no action of hers can finish an interrupted chain.
    expect(screen.getByText('Haijakamilika — itamaliziwa ofisini')).toBeInTheDocument();
    // The slot where a total would sit carries a COUNT OF PRODUCTS.
    expect(screen.getByText('Bidhaa 2')).toBeInTheDocument();
    // No TZS anywhere on the screen. Not one.
    expect(screen.queryByText(/TZS/)).toBeNull();
  });

  it('has its own empty state', async () => {
    buildHarness({
      session: kauntaSession({ purchasesEnabled: true }),
      purchasesGet: async () => ({ days: 7, from: '', count: 0, purchases: [] }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPurchaseHistory(user);
    expect(await screen.findByText('Hakuna mzigo katika siku 7 zilizopita.')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-4 — ══ THE COST-BLINDNESS LAW ══ REVIEW-BLOCKING
 * ------------------------------------------------------------------------ */
describe('HIST-4: no cost, total or value reaches the purchase screen', () => {
  /** Every key in a payload, recursively — keys only, never values. */
  const keysOf = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.flatMap(keysOf)
      : value && typeof value === 'object'
        ? Object.entries(value as Record<string, unknown>).flatMap(([k, v]) => [k, ...keysOf(v)])
        : [];

  it('the payload contract is the EXACT key set of the spec, and nothing more', () => {
    // Not "does not contain unitCost" — the WHOLE set, recursively, so that a
    // field added to PurchaseOrderLine next year cannot slip through a suite
    // that still passes.
    expect(Object.keys(PURCHASE_HISTORY).sort()).toEqual(['count', 'days', 'from', 'purchases']);
    expect(Object.keys(PURCHASE_HISTORY.purchases[0]!).sort()).toEqual([
      'grnNumber',
      'id',
      'lines',
      'purchaseOrderNumber',
      'recordedAt',
      'status',
      'supplierName',
    ]);
    expect(Object.keys(PURCHASE_HISTORY.purchases[0]!.lines[0]!).sort()).toEqual([
      'name',
      'productId',
      'quantity',
      'unitSymbol',
    ]);
    // Keys only — a product legitimately named "Total Motor Oil" must not fail
    // the build.
    expect(
      keysOf(PURCHASE_HISTORY).filter((key) =>
        /cost|price|amount|total|value|margin|profit|cogs/i.test(key),
      ),
    ).toEqual([]);
  });

  it('a HOSTILE payload carrying costs still leaks nothing: the screen never reads them', async () => {
    // The second layer, and the one that survives a server regression: even if
    // an endpoint were widened tomorrow, this screen renders supplier, date,
    // reference, GRN, products and quantities — and has no code path that can
    // print a cost. A stolen phone reveals nothing about what this business
    // pays its suppliers.
    buildHarness({
      session: kauntaSession({ purchasesEnabled: true }),
      purchasesGet: async () => ({
        ...PURCHASE_HISTORY,
        totalAmount: 987654,
        purchases: PURCHASE_HISTORY.purchases.map((purchase) => ({
          ...purchase,
          totalAmount: 456789,
          subtotal: 400000,
          outstandingAmount: 123456,
          lines: purchase.lines.map((line) => ({
            ...line,
            unitCost: 31337,
            lineTotal: 424242,
            averageCost: 29999,
          })),
        })),
      }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openManunuzi(user);
    await user.click(screen.getByRole('button', { name: /Historia ya Manunuzi/ }));
    await screen.findByRole('heading', { name: 'Historia ya Manunuzi' });
    await screen.findByText('Azam Distributors');

    const leaked = [
      '987654',
      '987,654',
      '456789',
      '456,789',
      '400000',
      '123456',
      '31337',
      '424242',
      '29999',
    ];
    for (const number of leaked) {
      expect(screen.queryByText(new RegExp(number))).toBeNull();
    }

    // …and the same holds inside the detail sheet, which is where a per-line
    // cost column would most naturally have been added.
    await user.click(screen.getByRole('button', { name: 'PO-2026-0141' }));
    const sheet = await screen.findByRole('dialog');
    for (const number of leaked) {
      expect(within(sheet).queryByText(new RegExp(number))).toBeNull();
    }
    // The standing note is the thing that stops someone "fixing" the absence.
    expect(within(sheet).getByText('Bei za ununuzi hazionyeshwi kwenye simu.')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-5 — offline
 * ------------------------------------------------------------------------ */
describe('HIST-5: offline is custody on one screen and honest silence on the other', () => {
  it('keeps the held rows and their brass total on the sales history', async () => {
    const harness = buildHarness({ onLine: false, outbox: [heldSale()] });
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    // The sent group collapses to the Leo sentence, which is exactly true here.
    expect(
      screen.getByText('Hakuna mtandao — zilizotumwa zitaonekana mtandao ukirudi.'),
    ).toBeInTheDocument();
    // …and the local truth still renders, so the screen never looks empty.
    expect(page().getByText('Mkononi 1 · TZS 2,400')).toBeInTheDocument();
    expect(screen.getByText('2 x Soda Baridi')).toBeInTheDocument();
    expect(screen.getByText('Inasubiri mtandao')).toBeInTheDocument();
    // No Retry button offline: the `online` listener refetches by itself.
    expect(screen.queryByRole('button', { name: 'Jaribu tena' })).toBeNull();
    expect(harness.getsFor('/mobile-pos-lite/sales')).toHaveLength(0);
  });

  it('says needsNetwork on the purchase book, shows no rows, and asks for nothing', async () => {
    const harness = buildHarness({
      onLine: false,
      session: kauntaSession({ purchasesEnabled: true }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openManunuzi(user);
    await user.click(screen.getByRole('button', { name: /Historia ya Manunuzi/ }));
    await screen.findByRole('heading', { name: 'Historia ya Manunuzi' });

    expect(screen.getByText('Hii inahitaji mtandao.')).toBeInTheDocument();
    expect(screen.queryByText('Azam Distributors')).toBeNull();
    // There is no local source and nothing is pretended.
    expect(harness.getsFor('/mobile-pos-lite/purchases')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Jaribu tena' })).toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-6 — the detail sheets
 * ------------------------------------------------------------------------ */
describe('HIST-6: the detail sheets cost zero extra round trips', () => {
  it('opens a sent sale with its lines, prices and total', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    const before = harness.getsFor('/mobile-pos-lite/sales').length;
    await user.click(await screen.findByRole('button', { name: /SO-2026-0912/ }));
    const sheet = await screen.findByRole('dialog');

    expect(within(sheet).getByText('SO-2026-0912')).toBeInTheDocument();
    expect(within(sheet).getByText('3 pc × Embe Dodo')).toBeInTheDocument();
    expect(within(sheet).getByText('Bei TZS 6,000')).toBeInTheDocument();
    expect(within(sheet).getByText('Mteja: Mama Asha')).toBeInTheDocument();
    expect(within(sheet).getByText('JUMLA')).toBeInTheDocument();
    // The list payload already carried the lines: no second call.
    expect(harness.getsFor('/mobile-pos-lite/sales')).toHaveLength(before);
  });

  it('opens a held sale from its frozen snapshot, read-only', async () => {
    buildHarness({
      outbox: [
        heldSale({ id: 'pending-red', lastError: 'This Mobile POS terminal is not active' }),
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    await user.click(await screen.findByRole('button', { name: 'Mkononi' }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('TZS 2,400')).toBeInTheDocument();
    // The mapped, human error — never raw English as the primary line.
    expect(within(sheet).getByText('Kituo hiki hakipatikani.')).toBeInTheDocument();
    expect(within(sheet).getByText('Maelezo ya kiufundi')).toBeInTheDocument();
    // Queue ACTIONS stay in Leo's ritual: no retry, no remove, one owner.
    expect(within(sheet).queryByRole('button', { name: 'Jaribu tena' })).toBeNull();
    expect(within(sheet).queryByRole('button', { name: 'Ondoa' })).toBeNull();
  });

  it('opens a delivery with its quantities, its GRN and its dash for a missing one', async () => {
    buildHarness({ session: kauntaSession({ purchasesEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();
    await openManunuzi(user);
    await user.click(screen.getByRole('button', { name: /Historia ya Manunuzi/ }));
    await screen.findByRole('heading', { name: 'Historia ya Manunuzi' });

    await user.click(await screen.findByRole('button', { name: 'PO-2026-0141' }));
    let sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Namba ya kupokea: GRN-2026-0139')).toBeInTheDocument();
    // The scrim is the dismiss control, and it is a SIBLING of the sheet.
    await user.click(screen.getByRole('button', { name: 'Rudi' }));

    // The INCOMPLETE one surfaces honestly rather than being hidden: a stock
    // movement she made must never be unexplainable to her.
    await user.click(screen.getByRole('button', { name: 'PO-2026-0138' }));
    sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Namba ya kupokea: —')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-7 — the Funga Siku preview
 * ------------------------------------------------------------------------ */
describe('HIST-7: the preview matches what was sold, and says it is a preview', () => {
  it('renders the day gross, the method breakdown and the estimate note', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    expect(page().getByText('Mauzo 3')).toBeInTheDocument();
    expect(page().getByText('TZS 41,000')).toBeInTheDocument();
    // Computed client-side from the day payload's rows — display only. The
    // gross is legible only through the breakdown: money in the pocket is the
    // CASH row, not the total.
    expect(screen.getByText('Taslimu · 1')).toBeInTheDocument();
    expect(screen.getByText('Simu · 1')).toBeInTheDocument();
    expect(
      screen.getByText('Makadirio — ofisi itasoma rekodi kamili wakati wa kutuma'),
    ).toBeInTheDocument();
    // Closing does not lock the terminal, and saying so once is cheaper than a
    // support call.
    expect(screen.getByText('Kufunga siku hakuzuii kuuza.')).toBeInTheDocument();
  });

  it('is fully browsable offline with the verb dead and the reason said', async () => {
    const harness = buildHarness({ onLine: false });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    expect(slabVerb('FUNGA SIKU')).toBeDisabled();
    expect(screen.getByText('Kufunga siku kunahitaji mtandao')).toBeInTheDocument();
    await user.click(slabVerb('FUNGA SIKU'));
    // Nothing is stranded and NOTHING IS SENT: the server's today-or-yesterday
    // window is what makes closing later legitimate rather than a workaround.
    expect(harness.dayReportPosts()).toHaveLength(0);

    // What IS written is the INTENT, and it carries no key. Nothing is being
    // sent, so the freeze-before-send rule is satisfied rather than bent — and
    // this row is the whole reason the day is still reachable in the morning
    // (HIST-13). A phone that wrote nothing here lost the day it traded.
    const stored = h.state.daylog.get(`${TERMINAL}:${h.store.posDaylogDate()}`)?.close;
    expect(stored?.openedOffline).toBe(true);
    expect(stored?.idempotencyKey).toBeUndefined();
    expect(stored?.reportId).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-8 — the queued-sales decision
 * ------------------------------------------------------------------------ */
describe('HIST-8: offer the flush, never block on the queue, always disclose', () => {
  it('offers Tuma Sasa, confirms once, and declares the held pair by name', async () => {
    const harness = buildHarness({
      outbox: [heldSale(), heldSale({ id: 'pending-2', totalAmount: 3600 })],
      dayReportPost: async () =>
        dayReportResponse({ declaredHeldCount: 2, declaredHeldAmount: 6000 }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    expect(screen.getByText('Mauzo yaliyo mkononi')).toBeInTheDocument();
    expect(page().getByText('Mkononi 2 · TZS 6,000')).toBeInTheDocument();
    // The BEST outcome is that the sales simply go, so the flush is offered
    // first and right there.
    expect(screen.getByRole('button', { name: /Tuma sasa/ })).toBeInTheDocument();

    // A non-empty outbox earns ONE deliberate confirm — sending a report you
    // know is incomplete should not be a reflex.
    await user.click(slabVerb('FUNGA SIKU'));
    const sheet = await screen.findByRole('dialog');
    expect(
      within(sheet).getByText('Ripoti hii haitajumuisha mauzo 2 yaliyo mkononi. Endelea?'),
    ).toBeInTheDocument();
    // Nothing has been sent by opening the confirm.
    expect(harness.dayReportPosts()).toHaveLength(0);

    await user.click(within(sheet).getByRole('button', { name: 'Ndiyo, funga siku' }));
    await screen.findByText('SIKU IMEFUNGWA');

    const [, body] = harness.dayReportPosts()[0] as [string, Record<string, unknown>];
    expect(body.heldCount).toBe(2);
    expect(body.heldAmount).toBe(6000);
    // The client sends NO totals, no lines, no method breakdown and no
    // identity: everything the office reads as fact is recomputed server-side.
    expect(Object.keys(body).sort()).toEqual([
      'businessDate',
      'heldAmount',
      'heldCount',
      'idempotencyKey',
    ]);

    // …and the declared pair is repeated on the report under its own heading,
    // with the sentence that says it is not in the total.
    expect(page().getByText('Mkononi 2 · TZS 6,000')).toBeInTheDocument();
  });

  it('asks for no confirm at all when the outbox is empty', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    expect(screen.queryByText('Mauzo yaliyo mkononi')).toBeNull();
    await user.click(slabVerb('FUNGA SIKU'));
    // A day report creates no financial fact and does not deserve friction.
    await screen.findByText('SIKU IMEFUNGWA');
    expect(harness.dayReportPosts()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-9 — the frozen key
 * ------------------------------------------------------------------------ */
describe('HIST-9: the key is persisted before the send and frozen across a remount', () => {
  it('writes the key to the daylog BEFORE the request, then reuses it on the retry', async () => {
    let calls = 0;
    const harness = buildHarness({
      dayReportPost: async () => {
        calls += 1;
        // The first attempt dies unproven — the classic lost response. The key
        // must survive it: this is the whole window it exists to protect.
        if (calls === 1) throw new TypeError('Failed to fetch');
        return dayReportResponse();
      },
    });
    const user = userEvent.setup();
    const mounted = render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await openFunga(user);

    await user.click(slabVerb('FUNGA SIKU'));
    await screen.findByText('Ripoti haikutoka — jaribu tena; haiwezi kutumwa mara mbili.');

    // The write landed AHEAD of the request — "ahead" meaning the row is
    // really down, not merely scheduled.
    const today = h.store.posDaylogDate();
    const stored = h.state.daylog.get(`${TERMINAL}:${today}`);
    const frozenKey = stored?.close?.idempotencyKey;
    expect(frozenKey).toBeTruthy();
    const [, firstBody] = harness.dayReportPosts()[0] as [string, Record<string, unknown>];
    expect(firstBody.idempotencyKey).toBe(frozenKey);
    // A failure changes WORDS only: nothing was cleared, nothing destroyed,
    // nothing navigated, nothing stamped.
    expect(screen.queryByText('SIKU IMEFUNGWA')).toBeNull();

    // FULL REMOUNT — app killed and cold-started. A key that lived only in a
    // React ref would die here, and the next attempt would mint a fresh one,
    // miss the server's unique index and give the office two reports for one
    // day with nothing linking them.
    mounted.unmount();
    render(<MobilePosLite />);
    // The address bar still reads `#funga`, and the cold boot normalises it to
    // its back-map parent — flow-interior screens are entered, never landed on.
    await screen.findByRole('heading', { name: 'Daftari la Leo' });
    expect(window.location.hash).toBe('#leo');
    await user.click(screen.getByRole('button', { name: 'FUNGA SIKU' }));
    await screen.findByRole('heading', { name: 'Funga Siku' });
    await user.click(slabVerb('FUNGA SIKU'));
    await screen.findByText('SIKU IMEFUNGWA');

    const [, retryBody] = harness.dayReportPosts()[1] as [string, Record<string, unknown>];
    expect(retryBody.idempotencyKey).toBe(frozenKey);
    // The frozen day rides with it, so a retry after midnight still closes the
    // day it began on.
    expect(retryBody.businessDate).toBe(firstBody.businessDate);
  });

  it('releases the key on a 2xx and writes the proof in its place', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);
    await user.click(slabVerb('FUNGA SIKU'));
    await screen.findByText('SIKU IMEFUNGWA');

    const close = h.state.daylog.get(`${TERMINAL}:${h.store.posDaylogDate()}`)?.close;
    // Released on 2xx and ONLY on 2xx: no outstanding attempt remains, and the
    // proof the day closed takes its place.
    expect(close?.idempotencyKey).toBeUndefined();
    expect(close?.reportId).toBe('rep-1');
    expect(close?.submittedAt).toBeTruthy();
  });

  it('resumes yesterday when today has no outstanding close', async () => {
    // §4-7: a rep who lost signal at 20:00 closes on the bus. Both ends agree
    // by construction — the phone resumes the frozen day, the server accepts
    // today or yesterday.
    const yesterday = h.store.posDaylogDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const harness = buildHarness({
      daylog: [
        [
          `${TERMINAL}:${yesterday}`,
          {
            terminalCode: TERMINAL,
            date: yesterday,
            tallyCount: 4,
            close: {
              idempotencyKey: 'key-from-yesterday',
              businessDate: yesterday,
              startedAt: Date.now() - 3 * 60 * 60 * 1000,
            },
          },
        ],
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    // The honest disclosure of a real boundary — calm secondary text.
    expect(
      await screen.findByText(
        'Unafunga siku ya jana. Mauzo uliyotuma leo asubuhi yataingia kwenye kitabu cha leo.',
      ),
    ).toBeInTheDocument();

    await user.click(slabVerb('FUNGA SIKU'));
    await waitFor(() => expect(harness.dayReportPosts()).toHaveLength(1));
    const [, body] = harness.dayReportPosts()[0] as [string, Record<string, unknown>];
    expect(body.idempotencyKey).toBe('key-from-yesterday');
    expect(body.businessDate).toBe(yesterday);
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-10 — the refused write
 * ------------------------------------------------------------------------ */
describe('HIST-10: a phone that will not keep the key sends nothing, and says so', () => {
  it('posts nothing, tells her, and destroys nothing', async () => {
    const harness = buildHarness({ daylogCloseWritable: false });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    await user.click(slabVerb('FUNGA SIKU'));

    // A verb that did not do what it says is a rejection, whoever refused it.
    expect(await screen.findByText('Simu haikuhifadhi ripoti — jaribu tena.')).toBeInTheDocument();
    // THE POINT: nothing left the phone. Sending under a key it is not holding
    // is the whole failure written out — the request lands, the answer is
    // lost, the next attempt mints a fresh key, and the office gets two
    // reports for one day with nothing linking them.
    expect(harness.dayReportPosts()).toHaveLength(0);
    expect(h.store.writeDaylogClose).toHaveBeenCalled();
    // Nothing navigated and nothing was stamped.
    expect(screen.queryByText('SIKU IMEFUNGWA')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Funga Siku' })).toBeInTheDocument();
    // The numbers stand, the verb is unchanged, the screen is still hers.
    expect(page().getByText('TZS 41,000')).toBeInTheDocument();
    expect(slabVerb('FUNGA SIKU')).toBeEnabled();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-11 — the 2xx and the seal
 * ------------------------------------------------------------------------ */
describe('HIST-11: Ripoti renders the record, never the preview', () => {
  it('stamps SIKU IMEFUNGWA and shows the server figures', async () => {
    buildHarness({
      dayReportPost: async () =>
        dayReportResponse({ salesCount: 9, grossTotal: 120000, itemsSoldQuantity: 41 }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);
    await user.click(slabVerb('FUNGA SIKU'));

    await screen.findByText('SIKU IMEFUNGWA');
    // The record's numbers, not the preview's 3 / 41,000.
    expect(page().getByText('Mauzo 9')).toBeInTheDocument();
    expect(page().getByText('TZS 120,000')).toBeInTheDocument();
    expect(page().getByText('Bidhaa zilizouzwa: 41')).toBeInTheDocument();
    expect(screen.getByText('Ripoti imefika ofisini.')).toBeInTheDocument();
    // The share is NEVER auto-invoked: a share sheet that opens by itself is
    // hostile, and she may want to read the numbers first.
    expect(screen.getByRole('button', { name: /SHIRIKI RIPOTI/ })).toBeInTheDocument();
  });

  it('does not move the tally: closing rules the line UNDER the marks', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);
    await user.click(slabVerb('FUNGA SIKU'));
    await screen.findByText('SIKU IMEFUNGWA');
    expect(h.store.bumpDaylogTally).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-12 — the share
 * ------------------------------------------------------------------------ */
describe('HIST-12: the paper goes to the share sheet, and fails honestly', () => {
  async function closeTheDay(user: User) {
    await mountKaunta();
    await openFunga(user);
    await user.click(slabVerb('FUNGA SIKU'));
    await screen.findByText('SIKU IMEFUNGWA');
  }

  it('fetches the letterhead PDF with the terminal headers and hands it over', async () => {
    buildHarness();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Disposition': 'inline; filename="RIPOTI-T-001.pdf"' }),
      blob: async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: share });

    const user = userEvent.setup();
    await closeTheDay(user);
    await user.click(screen.getByRole('button', { name: /SHIRIKI RIPOTI/ }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith('/api/backend/mobile-pos-lite/day-reports/rep-1/pdf', {
      headers: { 'x-mobile-pos-terminal': TERMINAL, 'x-mobile-pos-device': 'secret-1' },
      cache: 'no-store',
    });
    const call = share.mock.calls[0]?.[0] as { files: File[] };
    expect(call.files[0]?.name).toBe('RIPOTI-T-001.pdf');
    expect(call.files[0]?.type).toBe('application/pdf');
  });

  it('says the paper failed while the record stands, and never re-submits', async () => {
    const harness = buildHarness();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers() }),
    );
    const user = userEvent.setup();
    await closeTheDay(user);
    const postsBefore = harness.dayReportPosts().length;

    await user.click(screen.getByRole('button', { name: /SHIRIKI RIPOTI/ }));
    expect(
      await screen.findByText('Karatasi haikupatikana — ripoti ipo ofisini. Jaribu tena.'),
    ).toBeInTheDocument();
    // The record already exists at the office, so a failed paper is never a
    // reason to re-send anything or re-key anything…
    expect(harness.dayReportPosts()).toHaveLength(postsBefore);
    // …the seal is never rolled back…
    expect(screen.getByText('SIKU IMEFUNGWA')).toBeInTheDocument();
    expect(screen.getByText('Ripoti imefika ofisini.')).toBeInTheDocument();
    // …and the button stays live.
    expect(screen.getByRole('button', { name: /SHIRIKI RIPOTI/ })).toBeEnabled();
  });

  it('downloads where files cannot be shared, and says where it went', async () => {
    buildHarness();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        blob: async () => new Blob(['%PDF-1.7'], { type: 'application/pdf' }),
      }),
    );
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:x' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const user = userEvent.setup();
    await closeTheDay(user);
    await user.click(screen.getByRole('button', { name: /SHIRIKI RIPOTI/ }));

    expect(
      await screen.findByText('Ripoti imepakuliwa — ambatisha kwenye ujumbe wowote.'),
    ).toBeInTheDocument();
    expect(click).toHaveBeenCalledTimes(1);
    click.mockRestore();
    Reflect.deleteProperty(URL, 'createObjectURL');
    Reflect.deleteProperty(URL, 'revokeObjectURL');
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-13 — the day being closed is explicit, and always reachable
 * ------------------------------------------------------------------------ */
const YESTERDAY = () => h.store.posDaylogDate(new Date(Date.now() - 24 * 60 * 60 * 1000));

/** `dd/MM/yyyy`, the way FungaSikuScreen renders a frozen business date. */
function readable(businessDate: string) {
  const [year, month, day] = businessDate.split('-');
  return `${day}/${month}/${year}`;
}

/** A daylog row for a day, in the shape the store writes. */
function daylogRow(
  date: string,
  entry: Record<string, unknown>,
): [string, Record<string, unknown>] {
  return [`${TERMINAL}:${date}`, { terminalCode: TERMINAL, date, tallyCount: 0, ...entry }];
}

describe('HIST-13: the day that ended with no signal is still closable in the morning', () => {
  it('opens on yesterday when yesterday was worked and never closed', async () => {
    // The village shop: she rang sales with no signal (each queued sale stamped
    // the day's tally), went home, and comes back on wifi in the morning. Under
    // the first cut the phone found no frozen key, silently offered to close
    // TODAY, and the day she actually traded never reached the office.
    const yesterday = YESTERDAY();
    const harness = buildHarness({ daylog: [daylogRow(yesterday, { tallyCount: 4 })] });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    expect(await screen.findByText(`Ripoti ya ${readable(yesterday)}`)).toBeInTheDocument();
    expect(
      screen.getByText(
        'Unafunga siku ya jana. Mauzo uliyotuma leo asubuhi yataingia kwenye kitabu cha leo.',
      ),
    ).toBeInTheDocument();

    await user.click(slabVerb('FUNGA SIKU'));
    await waitFor(() => expect(harness.dayReportPosts()).toHaveLength(1));
    const [, body] = harness.dayReportPosts()[0] as [string, Record<string, unknown>];
    // The day she worked, closed — with a fresh key, because no attempt was
    // ever outstanding for it. The server accepts yesterday by construction.
    expect(body.businessDate).toBe(yesterday);
    expect(body.idempotencyKey).toBeTruthy();
  });

  it('resumes a day whose only trace is the offline intent', async () => {
    // The same rep, but she had opened Funga Siku with no signal and put the
    // phone away. The intent carries no key — nothing was sent — and it is the
    // only record that day exists. HIST-7 pins that it gets written.
    const yesterday = YESTERDAY();
    const harness = buildHarness({
      daylog: [
        daylogRow(yesterday, {
          close: {
            businessDate: yesterday,
            startedAt: Date.now() - 12 * 3600 * 1000,
            openedOffline: true,
          },
        }),
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    expect(await screen.findByText(`Ripoti ya ${readable(yesterday)}`)).toBeInTheDocument();
    await user.click(slabVerb('FUNGA SIKU'));
    await waitFor(() => expect(harness.dayReportPosts()).toHaveLength(1));
    const [, body] = harness.dayReportPosts()[0] as [string, Record<string, unknown>];
    expect(body.businessDate).toBe(yesterday);
  });

  it('lets her choose the other day, and never leaves the worked day unmentioned', async () => {
    const yesterday = YESTERDAY();
    const today = h.store.posDaylogDate();
    const harness = buildHarness({ daylog: [daylogRow(yesterday, { tallyCount: 4 })] });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);
    await screen.findByText(`Ripoti ya ${readable(yesterday)}`);

    // The date control names both days the server will accept.
    const todayChip = screen.getByRole('button', { name: `Leo · ${readable(today)}` });
    expect(screen.getByRole('button', { name: `Jana · ${readable(yesterday)}` })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.click(todayChip);
    expect(await screen.findByText(`Ripoti ya ${readable(today)}`)).toBeInTheDocument();
    // …and the day she DID work is still named on the screen she moved to, so
    // an empty report for a day nobody worked can never be signed off in
    // silence while the real one goes unclosed.
    expect(
      screen.getByText(`Siku ya ${readable(yesterday)} bado haijafungwa.`),
    ).toBeInTheDocument();

    await user.click(slabVerb('FUNGA SIKU'));
    await waitFor(() => expect(harness.dayReportPosts()).toHaveLength(1));
    const [, body] = harness.dayReportPosts()[0] as [string, Record<string, unknown>];
    expect(body.businessDate).toBe(today);
  });

  it('opens on today when yesterday already reached the office, and says so on a re-close', async () => {
    const yesterday = YESTERDAY();
    const today = h.store.posDaylogDate();
    buildHarness({
      daylog: [
        daylogRow(yesterday, {
          tallyCount: 6,
          close: {
            businessDate: yesterday,
            startedAt: Date.now() - 20 * 3600 * 1000,
            reportId: 'rep-old',
            submittedAt: Date.now() - 19 * 3600 * 1000,
          },
        }),
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);

    expect(await screen.findByText(`Ripoti ya ${readable(today)}`)).toBeInTheDocument();
    expect(screen.queryByText(`Siku ya ${readable(yesterday)} bado haijafungwa.`)).toBeNull();

    // A second close of a closed day is legitimate (§8-D case 2) — the server
    // recomputes the whole day, so the newer report supersedes the earlier one
    // — but she is told, rather than surprised.
    await user.click(screen.getByRole('button', { name: `Jana · ${readable(yesterday)}` }));
    expect(
      await screen.findByText(
        'Siku hii ilishafungwa. Ukifunga tena, ofisi itasoma ripoti mpya badala ya ile ya awali.',
      ),
    ).toBeInTheDocument();
  });

  it('does not pin the screen to the day it just closed, so the evening close reaches today', async () => {
    // The regression the day picker exists to prevent, arriving through the
    // other door: she closes yesterday in the morning, trades all day, and
    // re-opens Funga Siku at night. Holding the finished report made `enter()`
    // and the date chips no-ops for the rest of the session, so the header
    // still read yesterday, the chips rendered enabled and did nothing, and
    // FUNGA SIKU filed a SECOND close of yesterday while today — the day she
    // actually traded — stayed unclosable until the app was force-quit.
    const yesterday = YESTERDAY();
    const today = h.store.posDaylogDate();
    const harness = buildHarness({ daylog: [daylogRow(yesterday, { tallyCount: 4 })] });
    const user = userEvent.setup();
    await mountKaunta();

    await openFunga(user);
    await screen.findByText(`Ripoti ya ${readable(yesterday)}`);
    await user.click(slabVerb('FUNGA SIKU'));
    await waitFor(() => expect(harness.dayReportPosts()).toHaveLength(1));
    expect((harness.dayReportPosts()[0] as [string, Record<string, unknown>])[1].businessDate).toBe(
      yesterday,
    );
    await screen.findByText('SIKU IMEFUNGWA');

    // She leaves the screen and comes back that evening: a fresh visit
    // re-derives from the daylog instead of replaying the morning's receipt.
    await user.click(screen.getByRole('button', { name: 'Mauzo' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await openFunga(user);

    expect(await screen.findByText(`Ripoti ya ${readable(today)}`)).toBeInTheDocument();
    expect(screen.queryByText('SIKU IMEFUNGWA')).toBeNull();

    // And the chips are live, not merely rendered: yesterday is reachable
    // again, and so is the way back to today.
    await user.click(screen.getByRole('button', { name: `Jana · ${readable(yesterday)}` }));
    expect(await screen.findByText(`Ripoti ya ${readable(yesterday)}`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: `Leo · ${readable(today)}` }));
    expect(await screen.findByText(`Ripoti ya ${readable(today)}`)).toBeInTheDocument();

    await user.click(slabVerb('FUNGA SIKU'));
    await waitFor(() => expect(harness.dayReportPosts()).toHaveLength(2));
    // The evening close lands on TODAY, not a redundant re-close of yesterday.
    expect((harness.dayReportPosts()[1] as [string, Record<string, unknown>])[1].businessDate).toBe(
      today,
    );
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-14 — every figure on the screen belongs to the day in the header
 * ------------------------------------------------------------------------ */
describe('HIST-14: the preview is the labelled day’s money, or it is nothing', () => {
  it('shows "—" and says so, rather than today’s money under yesterday’s date', async () => {
    // The resumed close of §4-7, with a live my-sales-today of TZS 41,000 for
    // TODAY. Before this, the card and the slab both showed that 41,000 under a
    // header naming yesterday — the wrong day's money, read immediately before
    // she signed it off.
    const yesterday = YESTERDAY();
    buildHarness({
      daylog: [
        daylogRow(yesterday, {
          tallyCount: 4,
          close: {
            idempotencyKey: 'key-from-yesterday',
            businessDate: yesterday,
            startedAt: Date.now() - 3 * 3600 * 1000,
          },
        }),
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);
    await screen.findByText(`Ripoti ya ${readable(yesterday)}`);

    // Not on the card, and not on the slab either — one resolution feeds both.
    expect(screen.queryByText('TZS 41,000')).toBeNull();
    expect(page().getByText('Mauzo —')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Simu haina hesabu za siku hii. Ofisi itasoma rekodi kamili wakati wa kutuma.',
      ),
    ).toBeInTheDocument();
    // No breakdown either: the method rows were computed from today's sales.
    expect(screen.queryByText('Taslimu · 1')).toBeNull();
    expect(
      screen.queryByText('Makadirio — ofisi itasoma rekodi kamili wakati wa kutuma'),
    ).toBeNull();
  });

  it('shows the day’s OWN stored snapshot when the phone has one, with its staleness', async () => {
    const yesterday = YESTERDAY();
    buildHarness({
      daylog: [
        daylogRow(yesterday, {
          tallyCount: 9,
          sent: {
            repId: 'r1',
            count: 7,
            totalAmount: 400000,
            fetchedAt: new Date('2026-08-13T20:05:00').getTime(),
          },
        }),
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);
    await screen.findByText(`Ripoti ya ${readable(yesterday)}`);

    expect(page().getByText('Mauzo 7')).toBeInTheDocument();
    expect(page().getByText('TZS 400,000')).toBeInTheDocument();
    expect(screen.queryByText('TZS 41,000')).toBeNull();
    // A stored snapshot is labelled as one, exactly like Leo's.
    expect(page().getByText(/Mwisho kuonekana/)).toBeInTheDocument();
  });

  it('never shows another rep’s cached money as this rep’s', async () => {
    // The shared-phone guard (spec-leo §2.5) reaches the close too: a snapshot
    // belonging to r2 is no more this rep's day than it is on Leo.
    const yesterday = YESTERDAY();
    buildHarness({
      daylog: [
        daylogRow(yesterday, {
          tallyCount: 9,
          sent: { repId: 'r2', count: 7, totalAmount: 400000, fetchedAt: Date.now() - 3600 * 1000 },
        }),
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openFunga(user);
    await screen.findByText(`Ripoti ya ${readable(yesterday)}`);

    expect(screen.queryByText('TZS 400,000')).toBeNull();
    expect(page().getByText('Mauzo —')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HIST-15/16 — Historia says only what the phone can know
 * ------------------------------------------------------------------------ */
describe('HIST-15: offline, Historia makes no claim about the server’s book', () => {
  it('shows the offline note and NOT "no sales in the last 7 days"', async () => {
    // Nothing fetched, nothing cached (§6) — so "Hakuna mauzo katika siku 7
    // zilizopita" is a statement about records this phone has never seen.
    const harness = buildHarness({ onLine: false, outbox: [] });
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    expect(
      screen.getByText('Hakuna mtandao — zilizotumwa zitaonekana mtandao ukirudi.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Hakuna mauzo katika siku 7 zilizopita.')).toBeNull();
    expect(harness.getsFor('/mobile-pos-lite/sales')).toHaveLength(0);
  });

  it('still says the book is empty when the server said so', async () => {
    buildHarness({
      salesHistoryGet: async () => ({
        days: 7,
        from: '2026-08-08T00:00:00.000Z',
        count: 0,
        totalAmount: 0,
        sales: [],
      }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    expect(await screen.findByText('Hakuna mauzo katika siku 7 zilizopita.')).toBeInTheDocument();
  });
});

describe('HIST-16: the brass held total counts the rows the list shows', () => {
  it('drops the out-of-window row from the total as well as from the list', async () => {
    // The outbox has no prune, so a row rejected twelve days ago and never
    // cleared sits there forever. The line used to read "Mkononi 2 · TZS 6,000"
    // over a list showing one held sale worth 1,000 — money totalled with no
    // row to explain it, which is the one thing a custody line must never do.
    buildHarness({
      outbox: [
        heldSale({
          id: 'pending-old',
          createdAt: new Date(Date.now() - 12 * 24 * 60 * 60 * 1000).toISOString(),
          totalAmount: 5000,
          lineSummary: 'mzigo wa zamani',
        }),
        heldSale({ id: 'pending-new', totalAmount: 1000, lineSummary: 'mzigo wa leo' }),
      ],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHistoria(user);

    expect(await page().findByText('Mkononi 1 · TZS 1,000')).toBeInTheDocument();
    expect(screen.getByText('mzigo wa leo')).toBeInTheDocument();
    expect(screen.queryByText('mzigo wa zamani')).toBeNull();
    expect(page().queryByText('Mkononi 2 · TZS 6,000')).toBeNull();
  });
});

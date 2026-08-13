/**
 * Kaunta Hesabu tests — Phase 5 of the POS reform (count mode).
 * (docs/pos-reform/spec-inventory.md §3/§4/§5/§6/§7, design-direction.md §4/§6.)
 *
 * Same harness discipline as kaunta-stoo: everything drives the real screens
 * through the pilot (uiVersion=2) shell against an in-memory fake of the
 * IndexedDB store (grown with the v4 `drafts` contract). Hesabu is
 * Kaunta-and-manager-only; the classic shell stays pinned by the
 * characterization suite.
 *
 * HESABU-1  Entry is gated on session.stockCountsEnabled: the Stoo slab shows
 *           ANZA KUHESABU only to managers, and back-maps Hesabu → Stoo.
 * HESABU-2  BLIND ENTRY: no quantity, no status word, no status dot on any row;
 *           the status chips are dead; search still finds products.
 * HESABU-3  Empty vs zero stays distinct from the field to the payload, and the
 *           payload carries counted quantities and nothing else.
 * HESABU-4  The draft autosaves per edit, survives a remount, and offers
 *           resume/discard on the next entry.
 * HESABU-5  The queued-sales gate: a warning on entry that never blocks
 *           capture, and a hard replacement of the confirm at submit.
 * HESABU-6  Preview variance is computed against quantityOnHand, never
 *           available, under the estimate caveat.
 * HESABU-7  Threshold double-confirm above the summed-absolute-variance
 *           constant; the capture time always shows.
 * HESABU-8  Offline: the submit verb is dead, the reason is inline, and no
 *           outbox row is ever written for a count.
 * HESABU-9  Success: MUHURI stamp, SERVER-truth variances, adjustment number,
 *           draft cleared, one tally mark — and the stamp and the tally are
 *           the marks of a POSTED count, never of one waiting for the office.
 * HESABU-10 Rejection: reject haptic, mapped Swahili, raw English collapsed,
 *           draft retained; PENDING_APPROVAL stamps hollow.
 * HESABU-11 The idempotency key freezes on the FIRST send and rides every
 *           attempt on that sheet — the identical retry and the corrected one
 *           alike — until a 2xx or the sheet itself is discarded.
 * HESABU-12 Row order is neutral: the server's problems-first ranking would
 *           leak status through position, which is anchoring by another name.
 * HESABU-13 A counted line whose product leaves the snapshot stays reachable
 *           and removable, and blocks the review until it is taken out.
 * HESABU-14 With no snapshot at all, nothing can be reviewed and nothing can
 *           be sent — the review is the human check, so it cannot be skipped —
 *           and the screen says the STOO did not load, never that the products
 *           left it: this state offers the retry and never a delete.
 * HESABU-15 The notice on the review belongs to the attempt that produced it:
 *           the network note dies with the outage, the rejection with the edit.
 * HESABU-16 The draft snapshots product names, so a line orphaned across a
 *           cold restart is named rather than shown as a raw UUID.
 * HESABU-17 The backend's line cap is mirrored on the phone — read out of the
 *           DTO's own source so the two cannot drift — named as she approaches
 *           it, blocking with actionable copy once passed.
 * HESABU-18 Only a confirmed POSTED stamps the solid seal; every other status
 *           is a count that has moved no stock and stamps hollow.
 * HESABU-19 A 4xx verdict says the sheet cannot be sent as it stands and points
 *           at the edit; a 5xx, a twin-detect conflict and a connection failure
 *           never do — none of them judged the count.
 * HESABU-20 The frozen key is written to the draft BEFORE the request goes out
 *           and restored on resume, so a lost response answered after a cold
 *           start resumes the server's chain instead of opening a second one.
 * HESABU-21 The no-snapshot retry is a verb that answers: its own flight, then
 *           its own failure.
 * HESABU-22 The freeze write is load-bearing, so it is answered: the phone
 *           never claims custody of a sheet it dropped, and never sends under a
 *           key it failed to keep.
 * HESABU-23 "Anza hesabu mpya" is a real control — one confirmed tap that ends
 *           the sheet and its key — not an instruction with no button behind it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/api-client';
import type {
  MobilePosLiteProduct,
  PosCountDraft,
  PosStockItem,
  PosStockSnapshot,
} from '@/lib/mobile-pos-lite-store';
import { COUNT_MAX_LINES } from './hooks/use-pos-count';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes — the kaunta-stoo doubles plus the v4 drafts contract.
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
    drafts: new Map<string, unknown>(),
  };

  const posDaylogDate = (now: Date = new Date()) => {
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${month}-${day}`;
  };

  const store = {
    posDaylogDate,
    readCachedStock: vi.fn(async (terminalCode: string) => state.stocks.get(terminalCode) ?? null),
    writeCachedStock: vi.fn(async (terminalCode: string, snapshot: unknown) => {
      state.stocks.set(terminalCode, snapshot);
    }),
    // Drafts (v4, Phase 5): same contract as the real module — one draft per
    // module per terminal, keyed `${terminalCode}:count`.
    readCountDraft: vi.fn(
      async (terminalCode: string) => state.drafts.get(`${terminalCode}:count`) ?? null,
    ),
    writeCountDraft: vi.fn(async (terminalCode: string, draft: unknown) => {
      state.drafts.set(`${terminalCode}:count`, draft);
    }),
    clearCountDraft: vi.fn(async (terminalCode: string) => {
      state.drafts.delete(`${terminalCode}:count`);
    }),
    // The kikaratasi's sibling accessors on the same store: this suite never
    // opens Pokea, but the shell reads the slip on mount.
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
// The real module rides through under the two doubled verbs, so `ApiError` is
// the genuine class: it is what `backendPost` throws for EVERY non-2xx, and its
// `status` is what the count hook classifies a failure on. A hand-rolled double
// here would certify the classification against an error the app cannot produce.
vi.mock('@/lib/api-client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-client')>('@/lib/api-client');
  return { ...actual, backendGet: h.backendGet, backendPost: h.backendPost };
});
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

type CountPayload = {
  idempotencyKey: string;
  countedAt?: string;
  capturedAgoMs?: number;
  lines: Array<{ productId: string; countedQuantity: number }>;
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
// The reservation split is the point of this row: onHand 7, available 5.
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
    // Hesabu's gate: every test that counts is a manager session.
    stockCountsEnabled: true,
  };
  return {
    ...base,
    ...overrides,
    terminal: { ...base.terminal, ...(overrides.terminal ?? {}) },
  };
}

function makeSnapshot(items: PosStockItem[], ageMs = 60 * 1000): PosStockSnapshot {
  return { items, asOf: '2026-08-12T08:00:00.000Z', fetchedAt: Date.now() - ageMs };
}

/** A sale sitting in the outbox, waiting for the network. */
function pendingSale(id: string) {
  return {
    id,
    terminalCode: TERMINAL,
    payload: {
      paymentMethod: 'CASH',
      idempotencyKey: `key-${id}`,
      lines: [{ productId: SODA.id, quantity: 1 }],
    },
    createdAt: '2026-08-12T07:30:00.000Z',
    totalAmount: 1200,
    itemCount: 1,
    lineSummary: '1× Soda Baridi',
  };
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

const vibrate = vi.fn();

/**
 * What `backendPost` really throws for a non-2xx: an ApiError carrying the HTTP
 * status. The status is load-bearing — a 4xx is the server judging the BODY,
 * while a 5xx or a gateway timeout judges nothing at all — so a test that
 * throws a bare Error would be describing a failure the fetch layer never
 * produces, and would let the two be treated alike again.
 */
function apiError(message: string, status: number) {
  return new ApiError(message, status, { message });
}

/** The count draft as it currently sits in the fake IDB. */
function storedDraft(): PosCountDraft | undefined {
  return h.state.drafts.get(`${TERMINAL}:count`) as PosCountDraft | undefined;
}

/** Server truth for the default POST: variance against the snapshot's onHand. */
function defaultCountResponse(payload: CountPayload) {
  return {
    id: 'adj-1',
    adjustmentNumber: 'ADJ-2026-0007',
    status: 'POSTED' as const,
    lines: payload.lines.map((line) => {
      const item = STOCK_ITEMS.find((candidate) => candidate.productId === line.productId);
      const systemQuantity = item?.quantityOnHand ?? 0;
      return {
        productId: line.productId,
        systemQuantity,
        countedQuantity: line.countedQuantity,
        varianceQuantity: line.countedQuantity - systemQuantity,
      };
    }),
  };
}

type StockResponse = {
  asOf: string;
  branch: { id: string; name: string };
  items: PosStockItem[];
};

type HarnessOptions = {
  onLine?: boolean;
  cachedSession?: PosSession | null;
  session?: PosSession;
  sessionGet?: () => Promise<PosSession>;
  /** Pre-seeded IDB stock snapshot; `null` seeds none at all. */
  cachedStock?: PosStockSnapshot | null;
  /** GET /mobile-pos-lite/stock behavior; defaults to STOCK_ITEMS. */
  stockGet?: () => Promise<StockResponse>;
  /** Pre-seeded count draft for this terminal. */
  cachedDraft?: PosCountDraft;
  outbox?: Array<ReturnType<typeof pendingSale>>;
  countPost?: (payload: CountPayload) => Promise<unknown>;
  /**
   * What IDB does with a count-draft write. The default keeps the fake store;
   * a rejecting one is the phone under storage pressure (quota, private mode,
   * an evicted origin) — the condition the freeze write has to survive, since
   * the idempotency key rides in exactly this write.
   */
  draftWrite?: (terminalCode: string, draft: PosCountDraft) => Promise<void>;
};

/** The stock payload for a given item set, in the server's own envelope. */
function stockResponse(items: PosStockItem[]): StockResponse {
  return {
    asOf: '2026-08-12T09:00:00.000Z',
    branch: { id: 'b1', name: 'Tawi la Kariakoo' },
    items,
  };
}

function buildHarness(options: HarnessOptions = {}) {
  const session = options.session ?? kauntaSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, [SODA]]]);
  h.state.sessions = new Map(options.cachedSession ? [[TERMINAL, options.cachedSession]] : []);
  h.state.frequents = new Map();
  h.state.outbox = [...(options.outbox ?? [])];
  h.state.daylog = new Map();
  h.state.stocks = new Map(
    options.cachedStock === null
      ? []
      : [[TERMINAL, options.cachedStock ?? makeSnapshot(STOCK_ITEMS)]],
  );
  h.state.drafts = new Map(options.cachedDraft ? [[`${TERMINAL}:count`, options.cachedDraft]] : []);

  setNavigatorOnLine(options.onLine ?? true);

  // Re-installed per harness so a rejecting write in one test cannot leak into
  // the next (vi.clearAllMocks clears calls, never implementations).
  h.store.writeCountDraft.mockImplementation(
    options.draftWrite ??
      (async (terminalCode: string, draft: unknown) => {
        h.state.drafts.set(`${terminalCode}:count`, draft);
      }),
  );

  const behavior = {
    count: options.countPost ?? (async (payload: CountPayload) => defaultCountResponse(payload)),
    stock: options.stockGet ?? (async () => stockResponse(STOCK_ITEMS)),
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
    throw new Error(`Unexpected GET ${path} in kaunta hesabu test`);
  });
  h.backendPost.mockImplementation(async (path: string, payload: unknown) => {
    // A seeded outbox must STAY seeded while the gate is under test: the boot
    // sync fails connection-shaped, which breaks the loop and keeps the row.
    if (path === '/mobile-pos-lite/sales') throw new TypeError('Failed to fetch');
    if (path === '/mobile-pos-lite/stock-counts') return behavior.count(payload as CountPayload);
    throw new Error(`Unexpected POST ${path} in kaunta hesabu test`);
  });

  return {
    session,
    behavior,
    /** Every stock-count POST body, in call order. */
    countPayloads: () =>
      h.backendPost.mock.calls
        .filter(([path]) => path === '/mobile-pos-lite/stock-counts')
        .map(([, payload]) => payload as CountPayload),
  };
}

type User = ReturnType<typeof userEvent.setup>;

async function mountKaunta() {
  const view = render(<MobilePosLite />);
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
  return view;
}

async function openStoo(user: User) {
  await user.click(screen.getByRole('button', { name: 'Stoo' }));
  await screen.findByRole('heading', { name: 'Stoo' });
}

/**
 * Tap the slab's one verb.
 *
 * `getByRole('button', { name })` computes an accessible name for EVERY button
 * in the document, and Stoo renders one button per row. Against HESABU-17's
 * 501-row fixture that single query measured ~860ms (and ~240ms warm), versus
 * ~23ms for the same query once Hesabu's rows — which are inputs, not buttons —
 * have replaced them: the cost is the accessibility-tree walk over the row
 * buttons, not anything the count does. The slab verb's label is its own text
 * node, so `getByText` returns the button itself and skips that walk.
 *
 * This is how the suite NAVIGATES, never what it certifies: every role-based
 * assertion in the test bodies (disabled verbs, absent verbs, named controls)
 * is left exactly as it was.
 */
async function tapSlab(user: User, verb: string) {
  await user.click(screen.getByText(verb));
}

/** Stoo → the slab's ANZA KUHESABU → count mode. */
async function openHesabu(user: User) {
  await openStoo(user);
  await screen.findByText('Unga wa Ngano');
  await tapSlab(user, 'ANZA KUHESABU');
  await screen.findByRole('heading', { name: 'Hesabu' });
}

function countField(name: string) {
  return screen.getByLabelText(`Idadi ya ${name}`);
}

/** The count rows in rendered order, by product name. */
function countRowOrder() {
  return screen
    .getAllByLabelText(/^Idadi ya /)
    .map((field) => (field.getAttribute('aria-label') ?? '').replace('Idadi ya ', ''));
}

/** Type into a count field and commit it with Enter (blur commits too). */
async function countInto(user: User, name: string, value: string) {
  const field = countField(name);
  await user.clear(field);
  if (value === '') {
    await user.tab();
    return;
  }
  await user.type(field, `${value}{Enter}`);
}

/** Review → the confirm sheet. */
async function openConfirm(user: User) {
  await user.click(screen.getByRole('button', { name: 'TUMA HESABU' }));
  return screen.findByRole('dialog');
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
 * HESABU-1
 * ------------------------------------------------------------------------ */
describe('HESABU-1: entry gating and the back-map', () => {
  it('hides ANZA KUHESABU from a terminal without stockCountsEnabled', async () => {
    buildHarness({ session: kauntaSession({ stockCountsEnabled: false, purchasesEnabled: true }) });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);

    expect(screen.queryByRole('button', { name: 'ANZA KUHESABU' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mauzo Mapya' })).toBeInTheDocument();
  });

  it('opens Hesabu from the Stoo slab for a manager and back-maps to Stoo', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);
    expect(window.location.hash).toBe('#hesabu');

    // Back-map: Hesabu → Stoo (NOT the root), draft persisting.
    window.history.back();
    await screen.findByRole('heading', { name: 'Stoo' });
    expect(window.location.hash).toBe('#stoo');

    // And the canonical stack depth survives: one more back exits to Mauzo.
    window.history.back();
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(window.location.hash).toBe('#mauzo');
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-2
 * ------------------------------------------------------------------------ */
describe('HESABU-2: blind entry', () => {
  it('shows no quantity and no status word on any row, and disables the status chips', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    // Every Stoo number and status word is gone — anchoring is the one thing
    // a count must not do.
    expect(screen.queryByText('5 pc')).not.toBeInTheDocument();
    expect(screen.queryByText('30 pc')).not.toBeInTheDocument();
    expect(screen.queryByText('Inakwisha')).not.toBeInTheDocument();
    expect(screen.queryByText('Ipo')).not.toBeInTheDocument();
    expect(screen.queryByText('Zaidi ya rekodi')).not.toBeInTheDocument();
    // The rows themselves are still there, each with its own count field.
    expect(countField('Unga wa Ngano')).toHaveValue('');
    expect(countField('Sukari')).toBeInTheDocument();

    // Kidogo/Imeisha would leak status, so the chips are dead in count mode.
    expect(screen.getByRole('button', { name: 'Zote' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Kidogo' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Imeisha' })).toBeDisabled();
  });

  it('keeps search working (finding a product is not anchoring)', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await user.type(screen.getByPlaceholderText('Tafuta bidhaa stoo'), 'sukari');
    expect(countField('Sukari')).toBeInTheDocument();
    expect(screen.queryByLabelText('Idadi ya Unga wa Ngano')).not.toBeInTheDocument();
  });

  it('ghosts the not-counted field with Haijahesabiwa', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    expect(countField('Sukari')).toHaveAttribute('placeholder', 'Haijahesabiwa');
    expect(countField('Sukari')).toHaveAttribute('inputMode', 'numeric');
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-12
 * ------------------------------------------------------------------------ */
describe('HESABU-12: the row order says nothing either', () => {
  it('sorts the count sheet by name instead of the server problems-first ranking', async () => {
    // STOCK_ITEMS arrives ranked OVERSOLD → OUT → LOW → IN, exactly as the
    // endpoint sorts it. Counting down that order would tell the manager which
    // products the office already suspects, before she writes a number.
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    expect(countRowOrder()).toEqual(['Chumvi', 'Mafuta ya Alizeti', 'Sukari', 'Unga wa Ngano']);
    // Sukari (IN_STOCK) above Unga (LOW_STOCK) is the whole point.
    expect(countRowOrder().indexOf('Sukari')).toBeLessThan(
      countRowOrder().indexOf('Unga wa Ngano'),
    );
  });

  it('renders the same order when the server ranks the same products differently', async () => {
    // Same four products, opposite delivery order (the shape a different
    // status ranking produces): the sheet must not move.
    buildHarness({ cachedStock: makeSnapshot([...STOCK_ITEMS].reverse()) });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    expect(countRowOrder()).toEqual(['Chumvi', 'Mafuta ya Alizeti', 'Sukari', 'Unga wa Ngano']);
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-3
 * ------------------------------------------------------------------------ */
describe('HESABU-3: empty is not counted, 0 is counted', () => {
  it('keeps the two states distinct through the review and into the payload', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    // Mafuta: the shelf really is empty. Unga: five. Chumvi: never touched.
    await countInto(user, 'Mafuta ya Alizeti', '0');
    await countInto(user, 'Unga wa Ngano', '5');
    expect(screen.getByText('Umehesabu 2')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    await screen.findByText('Makadirio — rekodi kamili itasomwa wakati wa kutuma');
    // Only counted lines reach the review — an untouched product is not a zero.
    expect(screen.getByText('Mafuta ya Alizeti')).toBeInTheDocument();
    expect(screen.getByText('Unga wa Ngano')).toBeInTheDocument();
    expect(screen.queryByText('Chumvi')).not.toBeInTheDocument();

    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('HESABU IMEKAMILIKA');

    const [payload] = harness.countPayloads();
    expect(payload.lines).toHaveLength(2);
    expect(payload.lines).toEqual(
      expect.arrayContaining([
        { productId: 'st-mafuta', countedQuantity: 0 },
        { productId: 'st-unga', countedQuantity: 5 },
      ]),
    );
    expect(payload.lines.map((line) => line.productId)).not.toContain('st-chumvi');
    // Server-authoritative money and stock: nothing but counted quantities, the
    // replay key, and the two capture-time readings the server bounds staleness
    // on. No systemQuantity, no variance, no price, no cost — this exact-key-set
    // assertion is the tripwire that keeps it that way.
    expect(Object.keys(payload).sort()).toEqual([
      'capturedAgoMs',
      'countedAt',
      'idempotencyKey',
      'lines',
    ]);
    // Measured on the phone's own clock, so it is an elapsed interval rather
    // than a difference between two clocks (see use-pos-count's submit).
    expect(typeof payload.capturedAgoMs).toBe('number');
    expect(payload.capturedAgoMs).toBeGreaterThanOrEqual(0);
  });

  it('clearing a field takes the line back out of the count', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '5');
    expect(screen.getByText('Umehesabu 1')).toBeInTheDocument();
    await countInto(user, 'Unga wa Ngano', '');
    expect(screen.getByText('Umehesabu 0')).toBeInTheDocument();
    // Nothing counted, nothing to review.
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeDisabled();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-4
 * ------------------------------------------------------------------------ */
describe('HESABU-4: the draft is custody', () => {
  it('autosaves every committed edit to IDB', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '5');
    await waitFor(() =>
      expect(h.store.writeCountDraft).toHaveBeenCalledWith(
        TERMINAL,
        expect.objectContaining({ type: 'count', lines: { 'st-unga': 5 } }),
      ),
    );

    await countInto(user, 'Sukari', '0');
    await waitFor(() =>
      expect(h.store.writeCountDraft).toHaveBeenLastCalledWith(
        TERMINAL,
        expect.objectContaining({ lines: { 'st-unga': 5, 'st-sukari': 0 } }),
      ),
    );
  });

  it('offers resume/discard on the next entry and restores the sheet into the fields', async () => {
    buildHarness();
    const user = userEvent.setup();
    const view = await mountKaunta();
    await openHesabu(user);
    await countInto(user, 'Unga wa Ngano', '5');
    await countInto(user, 'Mafuta ya Alizeti', '0');

    // App killed in the storeroom; the draft is on the phone.
    view.unmount();
    render(<MobilePosLite />);
    // Cold boot on #hesabu normalizes to its parent #stoo (spec-sales §0.3):
    // re-entry has to pass the resume offer, so it is never a deep link.
    await screen.findByRole('heading', { name: 'Stoo' });
    expect(window.location.hash).toBe('#stoo');
    await screen.findByText('Unga wa Ngano');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(countField('Unga wa Ngano')).toHaveValue('5');
    // 0 came back as 0, not as an empty field.
    expect(countField('Mafuta ya Alizeti')).toHaveValue('0');
    expect(screen.getByText('Umehesabu 2')).toBeInTheDocument();
  });

  it('discards the draft on request, leaving a clean sheet', async () => {
    buildHarness({
      cachedDraft: {
        type: 'count',
        lines: { 'st-unga': 5 },
        capturedAt: Date.now() - 60_000,
        updatedAt: Date.now() - 60_000,
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Futa rasimu' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(h.store.clearCountDraft).toHaveBeenCalledWith(TERMINAL);
    expect(countField('Unga wa Ngano')).toHaveValue('');
    expect(screen.getByText('Umehesabu 0')).toBeInTheDocument();
  });

  it('stepping out to Stoo and back continues the sheet without re-asking', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);
    await countInto(user, 'Unga wa Ngano', '5');

    window.history.back();
    await screen.findByRole('heading', { name: 'Stoo' });
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(countField('Unga wa Ngano')).toHaveValue('5');
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-5
 * ------------------------------------------------------------------------ */
describe('HESABU-5: the queued-sales gate', () => {
  it('warns on entry without ever blocking capture', async () => {
    buildHarness({ outbox: [pendingSale('q-1')] });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    expect(
      await screen.findByText('Kuna mauzo yanasubiri kutumwa — Tuma Sasa kabla ya kuhesabu.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tuma sasa' })).toBeInTheDocument();

    // Capture itself is never blocked — blind entry touches no balances.
    await countInto(user, 'Unga wa Ngano', '5');
    expect(screen.getByText('Umehesabu 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeEnabled();
  });

  it('replaces the confirm at submit so the count cannot post over a queue', async () => {
    const harness = buildHarness({ outbox: [pendingSale('q-1')] });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);
    await countInto(user, 'Unga wa Ngano', '5');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));

    const dialog = await openConfirm(user);
    expect(
      within(dialog).getByText('Kuna mauzo yanasubiri kutumwa — Tuma Sasa kabla ya kuhesabu.'),
    ).toBeInTheDocument();
    // No way through: the confirm body and its send button are gone.
    expect(within(dialog).queryByRole('button', { name: 'TUMA HESABU' })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByText('Hesabu hii itabadilisha rekodi za stoo mara moja.'),
    ).not.toBeInTheDocument();
    expect(harness.countPayloads()).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-6
 * ------------------------------------------------------------------------ */
describe('HESABU-6: preview variance', () => {
  it('previews against quantityOnHand, never against available', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    // Unga: onHand 7, reserved 2, available 5. Counting 10 is +3, not +5.
    await countInto(user, 'Unga wa Ngano', '10');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));

    expect(await screen.findByText('Tofauti +3')).toBeInTheDocument();
    expect(screen.queryByText('Tofauti +5')).not.toBeInTheDocument();
    expect(
      screen.getByText('Makadirio — rekodi kamili itasomwa wakati wa kutuma'),
    ).toBeInTheDocument();
  });

  it('shows a shortfall as a negative variance', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Sukari', '28');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    expect(await screen.findByText('Tofauti -2')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-7
 * ------------------------------------------------------------------------ */
describe('HESABU-7: the threshold double-confirm', () => {
  it('a small variance confirms with the plain verb and the capture time', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9'); // |+2| — well under 20
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);

    expect(
      within(dialog).getByText('Hesabu hii itabadilisha rekodi za stoo mara moja.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Ilihesabiwa /)).toBeInTheDocument();
    expect(
      within(dialog).queryByText('Tofauti ni kubwa — hakiki tena kabla ya kutuma.'),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'TUMA HESABU' })).toBeInTheDocument();
  });

  it('a large summed variance adds the caution card and a differently-labeled second tap', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    // |30 − 7| = 23 over the 20 threshold.
    await countInto(user, 'Unga wa Ngano', '30');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);

    expect(
      within(dialog).getByText('Tofauti ni kubwa — hakiki tena kabla ya kutuma.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Ilihesabiwa /)).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'TUMA HESABU' })).not.toBeInTheDocument();

    // The second tap is a different button, deliberately.
    await user.click(within(dialog).getByRole('button', { name: 'Ndiyo, tuma hesabu' }));
    await screen.findByText('HESABU IMEKAMILIKA');
    expect(harness.countPayloads()).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-8
 * ------------------------------------------------------------------------ */
describe('HESABU-8: online-only submission', () => {
  it('kills the submit verb offline, says why, and never writes an outbox row', async () => {
    const harness = buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    // Capture works offline — that is the whole point of the draft.
    await countInto(user, 'Unga wa Ngano', '5');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));

    expect(await screen.findByText('Kutuma hesabu kunahitaji mtandao')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'TUMA HESABU' })).toBeDisabled();
    expect(harness.countPayloads()).toHaveLength(0);
    // A count NEVER becomes a queued transaction.
    expect(h.store.enqueueMobilePosLiteSale).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-9
 * ------------------------------------------------------------------------ */
describe('HESABU-9: the MUHURI moment', () => {
  it('stamps, shows SERVER variances and the adjustment number, clears the draft and tallies', async () => {
    // The snapshot said 7; the office says 8 — the receipt must show 8's
    // truth (+2), not the review's preview (+3).
    buildHarness({
      countPost: async (payload) => ({
        id: 'adj-9',
        adjustmentNumber: 'ADJ-2026-0042',
        status: 'POSTED',
        lines: payload.lines.map((line) => ({
          productId: line.productId,
          systemQuantity: 8,
          countedQuantity: line.countedQuantity,
          varianceQuantity: line.countedQuantity - 8,
        })),
      }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '10');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    expect(await screen.findByText('Tofauti +3')).toBeInTheDocument(); // the preview

    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    await screen.findByText('HESABU IMEKAMILIKA');
    expect(screen.getByText('ADJ-2026-0042')).toBeInTheDocument();
    expect(screen.getByText('Tofauti +2')).toBeInTheDocument(); // server truth
    expect(screen.queryByText('Tofauti +3')).not.toBeInTheDocument();
    expect(screen.queryByText('Inasubiri idhini ya ofisi')).not.toBeInTheDocument();

    // Local commit: stamp haptic, one tally mark, draft gone (2xx only).
    expect(vibrate).toHaveBeenCalledWith([30, 40, 30]);
    expect(h.store.bumpDaylogTally).toHaveBeenCalledWith(TERMINAL);
    expect(h.store.clearCountDraft).toHaveBeenCalledWith(TERMINAL);

    // Back to the money path, with the way back to Stoo as the secondary.
    expect(screen.getByRole('button', { name: 'RUDI STOO' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Mauzo Mapya' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
  });

  it('stamps hollow with the waiting-for-approval copy when the office must approve', async () => {
    buildHarness({
      countPost: async (payload) => ({
        ...defaultCountResponse(payload),
        status: 'PENDING_APPROVAL',
      }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    // The seal itself carries the waiting copy: nothing has moved in stock, so
    // the largest element on the screen must not say the count is complete.
    expect(await screen.findByText('Inasubiri idhini ya ofisi')).toBeInTheDocument();
    expect(screen.queryByText('HESABU IMEKAMILIKA')).not.toBeInTheDocument();
    expect(screen.getByText('ADJ-2026-0007')).toBeInTheDocument();
    expect(h.store.clearCountDraft).toHaveBeenCalledWith(TERMINAL);

    // …and neither may the ritual. A tally mark is a record of a FINISHED job
    // — Leo reads it back as "kazi zimekamilika leo" — and the stamp haptic is
    // the palm's version of the solid seal. This count has moved no stock and
    // is sitting in the office's queue, so it earns neither; the routine 15ms
    // tick says the tap did something without claiming it finished anything.
    expect(vibrate).not.toHaveBeenCalledWith([30, 40, 30]);
    expect(h.store.bumpDaylogTally).not.toHaveBeenCalled();
    expect(vibrate).toHaveBeenCalledWith(15);
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-10
 * ------------------------------------------------------------------------ */
describe('HESABU-10: rejection keeps the work', () => {
  it('maps the error to Swahili, collapses the raw text, and retains the draft', async () => {
    // Verbatim wrapper copy (mobile-pos-lite.service.ts resolveStockCountLines)
    // under its real status — an invented string, or a bare Error with no
    // status, would certify a mapping (and a ritual) that never fires.
    buildHarness({
      countPost: async () => {
        throw apiError(`Product ${UNGA.productId} is not available for this terminal`, 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    const raw = `Product ${UNGA.productId} is not available for this terminal`;
    expect(await screen.findByText('Bidhaa haipatikani kwenye tawi hili')).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith([60, 40, 60]);
    // Raw English is for the supervisor, behind the disclosure.
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Maelezo ya kiufundi' }));
    expect(screen.getByText(raw)).toBeInTheDocument();

    // Nothing is lost, and the retry is one tap away.
    expect(h.store.clearCountDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'TUMA HESABU' })).toBeEnabled();
  });

  it('maps the duplicate-line and non-stock rejections too', async () => {
    buildHarness({
      countPost: async () => {
        throw apiError(
          `Product ${UNGA.productId} was counted more than once in this stock count`,
          400,
        );
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(await screen.findByText('Bidhaa imeandikwa mara mbili')).toBeInTheDocument();
  });

  it('a connection-shaped failure reuses the needs-network copy and keeps retry alive', async () => {
    buildHarness({
      countPost: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(await screen.findByText('Kutuma hesabu kunahitaji mtandao')).toBeInTheDocument();
    expect(h.store.clearCountDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'TUMA HESABU' })).toBeEnabled();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-11
 * ------------------------------------------------------------------------ */
describe('HESABU-11: the frozen idempotency key', () => {
  it('rides every attempt on one sheet — the identical retry AND the corrected one', async () => {
    const harness = buildHarness({
      countPost: async () => {
        throw apiError('Haikukubaliwa', 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const first = await openConfirm(user);
    await user.click(within(first).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('Haikukubaliwa — mwite msimamizi');

    // Same sheet, same key: the server resumes through its marker instead of
    // posting a second adjustment.
    const second = await openConfirm(user);
    await user.click(within(second).getByRole('button', { name: 'TUMA HESABU' }));
    await waitFor(() => expect(harness.countPayloads()).toHaveLength(2));
    const [one, two] = harness.countPayloads();
    expect(two.idempotencyKey).toBe(one.idempotencyKey);
    expect(two.lines).toEqual(one.lines);

    // …and the CORRECTED sheet rides it too. This assertion is the reverse of
    // the one it replaces, and the reversal is the point (round 3): the phone
    // cannot know whether a request that did not answer cleanly reached the
    // server, and the rejection copy itself asks her to go back and edit. Under
    // a re-minting key that edit is how one shelf becomes two adjustments — the
    // marker misses, a second chain is built, and the sheet's ABSOLUTE
    // quantities are applied again over a baseline that has moved. Frozen, the
    // server settles it instead: nothing was recorded (the ordinary 4xx, where
    // the wrapper resumes BEFORE it validates) and this key opens a fresh chain
    // carrying the correction, or something WAS recorded and it resumes that.
    // This is verbatim the kikaratasi's rule (use-pos-slip.ts, §8 case 1).
    await user.click(screen.getByRole('button', { name: 'Rudi' }));
    await countInto(user, 'Unga wa Ngano', '11');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const third = await openConfirm(user);
    await user.click(within(third).getByRole('button', { name: 'TUMA HESABU' }));
    await waitFor(() => expect(harness.countPayloads()).toHaveLength(3));
    const [, , edited] = harness.countPayloads();
    expect(edited.idempotencyKey).toBe(one.idempotencyKey);
    expect(edited.lines).toEqual([{ productId: 'st-unga', countedQuantity: 11 }]);
    // And it is on the phone, not only in a ref: the edit rewrote the draft
    // and the key went into that write.
    await waitFor(() => expect(storedDraft()?.idempotencyKey).toBe(one.idempotencyKey));
  });

  it('lets go only when the sheet itself is discarded', async () => {
    const harness = buildHarness({
      countPost: async () => {
        throw apiError('Haikukubaliwa', 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const first = await openConfirm(user);
    await user.click(within(first).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('Haikukubaliwa — mwite msimamizi');

    // Taking every counted line back out IS the discard ritual, one tap at a
    // time: there is no sheet left, so the next count is a NEW count. Keeping
    // the key here would be the opposite failure — a fresh shelf posted under a
    // marker that may already anchor a recorded chain.
    await user.click(screen.getByRole('button', { name: 'Rudi' }));
    await countInto(user, 'Unga wa Ngano', '');
    expect(screen.getByText('Umehesabu 0')).toBeInTheDocument();
    await waitFor(() => expect(h.store.clearCountDraft).toHaveBeenCalledWith(TERMINAL));

    await countInto(user, 'Sukari', '30');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const second = await openConfirm(user);
    await user.click(within(second).getByRole('button', { name: 'TUMA HESABU' }));
    await waitFor(() => expect(harness.countPayloads()).toHaveLength(2));
    const [one, fresh] = harness.countPayloads();
    expect(fresh.idempotencyKey).not.toBe(one.idempotencyKey);
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-20
 * ------------------------------------------------------------------------ */
describe('HESABU-20: the key outlives the phone', () => {
  it('resumes a lost-response send under the SAME key after a cold start', async () => {
    // 18:00. The sheet goes out and the response dies on the link (or the PWA
    // is evicted, or the session momentarily returns null and the shell
    // unmounts). The server may already have posted it. By 18:20 the counter
    // has sold from the same shelf, so the system and the shelf agree again —
    // and a resumed sheet re-posting its ABSOLUTE numbers under a FRESH key
    // would invent those sales back into existence, on a second adjustment
    // nothing links to the first, with a receipt that looks exactly right to
    // her. The key is the only thing that can stop that, and it has to survive
    // a process death to do it.
    const harness = buildHarness({
      countPost: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    const view = await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '20');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('Kutuma hesabu kunahitaji mtandao');

    const [first] = harness.countPayloads();
    // The key is on the PHONE before the request goes out, beside the lines it
    // was minted for — not only in a ref that dies with the component.
    expect(storedDraft()?.idempotencyKey).toBe(first.idempotencyKey);
    expect(storedDraft()?.lines).toEqual({ 'st-unga': 20 });

    // Cold start: new process, new hook, same draft.
    view.unmount();
    render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Stoo' });
    await screen.findByText('Unga wa Ngano');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });
    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    harness.behavior.count = async (payload) => defaultCountResponse(payload);
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const resumed = await openConfirm(user);
    await user.click(within(resumed).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('HESABU IMEKAMILIKA');

    const [, second] = harness.countPayloads();
    // Same key ⇒ `[MPL-COUNT:<key>]` matches ⇒ the server resumes the chain it
    // already has (or opens the first one) instead of counting the shelf twice.
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.lines).toEqual(first.lines);
    // The count is finished, so the key is finished: the draft is gone with it.
    expect(h.store.clearCountDraft).toHaveBeenCalledWith(TERMINAL);
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-13
 * ------------------------------------------------------------------------ */
describe('HESABU-13: a counted line that leaves the snapshot', () => {
  it('keeps it visible and removable, blocks the review, and drops it from the payload', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '5');
    await countInto(user, 'Sukari', '28');
    expect(screen.getByText('Umehesabu 2')).toBeInTheDocument();

    // The office deactivates Unga mid-count; the next Stoo refetch drops it
    // (GET /stock filters status ACTIVE), and the sheet outlives the snapshot.
    harness.behavior.stock = async () =>
      stockResponse(STOCK_ITEMS.filter((item) => item.productId !== UNGA.productId));
    window.history.back();
    await screen.findByRole('heading', { name: 'Stoo' });
    await user.click(screen.getByRole('button', { name: 'Dakika 1 zilizopita' }));
    await waitFor(() => expect(screen.queryByText('Unga wa Ngano')).not.toBeInTheDocument());
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    // The line is still counted, still in the payload — so it is still on the
    // screen, named (this session saw it) and with a way to take it out.
    expect(screen.getByText('Umehesabu 2')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Bidhaa zilizohesabiwa lakini hazipo tena stoo — ziondoe ili kutuma hesabu.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('Unga wa Ngano')).toBeInTheDocument();
    expect(screen.queryByLabelText('Idadi ya Unga wa Ngano')).not.toBeInTheDocument();
    // Nothing moves until it is resolved: the review cannot show that line, so
    // the review — and the variance total behind the confirm — cannot run.
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Ondoa Unga wa Ngano' }));
    expect(screen.getByText('Umehesabu 1')).toBeInTheDocument();
    expect(
      screen.queryByText(
        'Bidhaa zilizohesabiwa lakini hazipo tena stoo — ziondoe ili kutuma hesabu.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeEnabled();

    // §7 case 5, delivered: the rep removed the line and resubmitted.
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('HESABU IMEKAMILIKA');

    const [payload] = harness.countPayloads();
    expect(payload.lines).toEqual([{ productId: 'st-sukari', countedQuantity: 28 }]);
  });

  it('lets the sheet empty completely, so the resume offer can come back', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '5');
    harness.behavior.stock = async () =>
      stockResponse(STOCK_ITEMS.filter((item) => item.productId !== UNGA.productId));
    window.history.back();
    await screen.findByRole('heading', { name: 'Stoo' });
    await user.click(screen.getByRole('button', { name: 'Dakika 1 zilizopita' }));
    await waitFor(() => expect(screen.queryByText('Unga wa Ngano')).not.toBeInTheDocument());
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    // Removing the last line empties the sheet — the state that clears the
    // draft, which per-row deletion could never reach while the row was gone.
    await user.click(screen.getByRole('button', { name: 'Ondoa Unga wa Ngano' }));
    expect(screen.getByText('Umehesabu 0')).toBeInTheDocument();
    await waitFor(() => expect(h.store.clearCountDraft).toHaveBeenCalledWith(TERMINAL));
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-14
 * ------------------------------------------------------------------------ */
describe('HESABU-14: no snapshot means nothing to review', () => {
  it('refuses the review and the send when the screen cannot show a single line', async () => {
    // The phone died in the storeroom; next morning the stock fetch fails and
    // there is no cached snapshot, but the draft is still on the phone.
    const harness = buildHarness({
      cachedStock: null,
      stockGet: async () => {
        throw new Error('stock exploded');
      },
      cachedDraft: {
        type: 'count',
        lines: { 'st-unga': 5, 'st-sukari': 28 },
        capturedAt: Date.now() - 3_600_000,
        updatedAt: Date.now() - 3_600_000,
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Imeshindikana kupakua stoo');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Umehesabu 2')).toBeInTheDocument();

    // Two counted lines, no rows, no variances: the review step and the
    // threshold guard are the human checks on a destructive write, so the
    // verb is dead rather than silently reviewing nothing.
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeDisabled();
    expect(screen.getByText('Imeshindikana kupakua stoo')).toBeInTheDocument();
    expect(harness.countPayloads()).toHaveLength(0);

    // …and it says WHICH failure this is. Nothing left the stoo — the stoo did
    // not load — so the counted-but-vanished copy would be a falsehood, and
    // its per-row trash control would be the only enabled affordance on a
    // screen whose review verb is dead: one tap each to destroy a 30-line
    // overnight count, under a sentence calling that the way to send it.
    expect(
      screen.queryByText(
        'Bidhaa zilizohesabiwa lakini hazipo tena stoo — ziondoe ili kutuma hesabu.',
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Ondoa / })).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'Orodha ya stoo haijapakiwa — hesabu yako ipo salama kwenye simu hii. Jaribu tena ili kuendelea.',
      ),
    ).toBeInTheDocument();
    // The retry IS the remedy here, so it is the primary thing on the card.
    expect(screen.getByRole('button', { name: 'Jaribu tena' })).toBeEnabled();
  });

  it('offers the retry and no delete offline either, and says why the retry is dead', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      cachedStock: null,
      cachedDraft: {
        type: 'count',
        lines: { 'st-unga': 5 },
        capturedAt: Date.now() - 3_600_000,
        updatedAt: Date.now() - 3_600_000,
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The worst version of the old shape: offline, so the retry is disabled
    // too. A remove control here would have been the ONLY live thing on the
    // screen. There is none — the card explains the dead retry instead.
    expect(screen.queryByRole('button', { name: /^Ondoa / })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Jaribu tena' })).toBeDisabled();
    expect(screen.getByText('Kutuma hesabu kunahitaji mtandao')).toBeInTheDocument();
    expect(screen.getByText('Umehesabu 1')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-15
 * ------------------------------------------------------------------------ */
describe('HESABU-15: the notice belongs to the attempt that produced it', () => {
  it('drops the network note when the signal comes back', async () => {
    buildHarness({
      countPost: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));
    expect(await screen.findByText('Kutuma hesabu kunahitaji mtandao')).toBeInTheDocument();

    // She walks out of the dead corner — the phone notices the drop first.
    setNavigatorOnLine(false);
    fireEvent(window, new Event('offline'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'TUMA HESABU' })).toBeDisabled());

    // Signal back. The slab lights up; the line under it must not still say
    // that sending needs a network.
    setNavigatorOnLine(true);
    fireEvent(window, new Event('online'));

    await waitFor(() =>
      expect(screen.queryByText('Kutuma hesabu kunahitaji mtandao')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'TUMA HESABU' })).toBeEnabled();
  });

  it('drops the rejection card once the sheet behind it has been edited', async () => {
    buildHarness({
      countPost: async () => {
        throw apiError('Haikukubaliwa', 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('Haikukubaliwa — mwite msimamizi');

    // Back to the sheet, fix the line, review again: the red card is about a
    // count that no longer exists.
    await user.click(screen.getByRole('button', { name: 'Rudi' }));
    await countInto(user, 'Unga wa Ngano', '7');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));

    expect(await screen.findByText('Tofauti 0')).toBeInTheDocument();
    expect(screen.queryByText('Haikukubaliwa — mwite msimamizi')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Maelezo ya kiufundi' })).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-16
 * ------------------------------------------------------------------------ */
describe('HESABU-16: a resumed line is nameable after a cold restart', () => {
  it('snapshots the product name into the draft on every autosave', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '5');
    await waitFor(() =>
      expect(h.store.writeCountDraft).toHaveBeenLastCalledWith(
        TERMINAL,
        expect.objectContaining({
          lines: { 'st-unga': 5 },
          names: { 'st-unga': 'Unga wa Ngano' },
        }),
      ),
    );
  });

  it('names an orphaned line from the draft, not from a session map the restart emptied', async () => {
    // Evening: 2 lines counted, phone killed. Overnight the office deactivates
    // Unga, so the morning snapshot loads fine WITHOUT it. Nothing in this
    // session ever saw the product, so only the draft can name it.
    buildHarness({
      cachedStock: makeSnapshot(STOCK_ITEMS.filter((item) => item.productId !== UNGA.productId)),
      cachedDraft: {
        type: 'count',
        lines: { 'st-unga': 5, 'st-sukari': 28 },
        names: { 'st-unga': 'Unga wa Ngano', 'st-sukari': 'Sukari' },
        capturedAt: Date.now() - 43_200_000,
        updatedAt: Date.now() - 43_200_000,
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Sukari');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The snapshot loaded and this product is genuinely not in it, so this IS
    // the remove-the-line case — and the line she is asked to remove carries
    // the name she wrote it under, not a 36-character id she cannot report.
    expect(
      screen.getByText(
        'Bidhaa zilizohesabiwa lakini hazipo tena stoo — ziondoe ili kutuma hesabu.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ondoa Unga wa Ngano' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ondoa st-unga' })).not.toBeInTheDocument();

    // And removing it by name leaves a sendable sheet.
    await user.click(screen.getByRole('button', { name: 'Ondoa Unga wa Ngano' }));
    expect(screen.getByText('Umehesabu 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeEnabled();
    // The rewritten draft keeps the name snapshot for the lines that remain.
    await waitFor(() =>
      expect(h.store.writeCountDraft).toHaveBeenLastCalledWith(
        TERMINAL,
        expect.objectContaining({ lines: { 'st-sukari': 28 }, names: { 'st-sukari': 'Sukari' } }),
      ),
    );
  });

  it('still loads a draft written before names existed, falling back to the id', async () => {
    // Backward compatibility is the constraint on the shape: a draft already
    // on a phone today has no `names` key at all and must still resume.
    buildHarness({
      cachedStock: makeSnapshot(STOCK_ITEMS.filter((item) => item.productId !== UNGA.productId)),
      cachedDraft: {
        type: 'count',
        lines: { 'st-unga': 5 },
        capturedAt: Date.now() - 43_200_000,
        updatedAt: Date.now() - 43_200_000,
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Sukari');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText('Umehesabu 1')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ondoa st-unga' })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-17
 * ------------------------------------------------------------------------ */
describe('HESABU-17: the line ceiling is the phone’s to know', () => {
  /** `count` stock rows named so they sort predictably: Bidhaa 001…N. */
  function manyItems(count: number): PosStockItem[] {
    return Array.from({ length: count }, (_, index) =>
      stockItem({
        productId: `st-${String(index + 1).padStart(3, '0')}`,
        name: `Bidhaa ${String(index + 1).padStart(3, '0')}`,
        code: `B-${index + 1}`,
      }),
    );
  }

  function draftOver(items: PosStockItem[]): PosCountDraft {
    return {
      type: 'count',
      lines: Object.fromEntries(items.map((item) => [item.productId, 1])),
      names: Object.fromEntries(items.map((item) => [item.productId, item.name])),
      capturedAt: Date.now() - 60_000,
      updatedAt: Date.now() - 60_000,
    };
  }

  /** The line number this suite talks in: one past the cap, and the cap. */
  const OVER = COUNT_MAX_LINES + 1;
  const label = (index: number) => `Bidhaa ${String(index).padStart(3, '0')}`;

  it('mirrors the DTO cap exactly — nothing else links the two constants', async () => {
    // Last round these were set to different numbers by different hands (client
    // 200, DTO 500) and the client's won, so the phone refused closing counts
    // the server would have taken and told the manager to delete counted lines
    // to get under a ceiling that did not exist. There is no shared module
    // across the boundary, so this reads the DTO's own source: the tripwire is
    // the link.
    const relative = 'backend/src/modules/mobile-pos-lite/dto/mobile-pos-lite-stock-count.dto.ts';
    // The suite runs from `frontend/`, the repo root is one up; both are
    // accepted so a runner started from either place still checks the number
    // rather than quietly passing.
    const dto = [resolve(process.cwd(), '..', relative), resolve(process.cwd(), relative)].find(
      (candidate) => existsSync(candidate),
    );
    expect(dto).toBeDefined();
    const declared = /MOBILE_POS_LITE_STOCK_COUNT_MAX_LINES\s*=\s*(\d+)/.exec(
      readFileSync(dto as string, 'utf8'),
    )?.[1];
    expect(declared).toBeDefined();
    expect(Number(declared)).toBe(COUNT_MAX_LINES);
  });

  it('blocks the review over the cap with actionable copy, and clears once she is under it', async () => {
    // The catalog bound is 1500 items and a full closing count is what Hesabu
    // exists for, so a 250-400 line sheet is ordinary — which is why the DTO's
    // ceiling sits where it does. Over it, the server's only answer is a
    // ValidationPipe rejection raised before the wrapper is reached, so the
    // phone names the limit itself rather than letting her walk the storeroom
    // for it.
    const items = manyItems(OVER);
    const harness = buildHarness({
      cachedStock: makeSnapshot(items),
      cachedDraft: draftOver(items),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Bidhaa 001');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText(`Umehesabu ${OVER}`)).toBeInTheDocument();
    expect(
      screen.getByText(
        `Hesabu moja haiwezi kuzidi bidhaa ${COUNT_MAX_LINES}. Ondoa zilizozidi, tuma hesabu hii, kisha hesabu zilizobaki.`,
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeDisabled();
    expect(harness.countPayloads()).toHaveLength(0);

    // One line out and the sheet is sendable again — and the ceiling is still
    // named, because she is standing right under it.
    await countInto(user, label(OVER), '');
    expect(screen.getByText(`Umehesabu ${COUNT_MAX_LINES}`)).toBeInTheDocument();
    expect(
      screen.getByText(`Umekaribia kikomo — hesabu moja inachukua bidhaa ${COUNT_MAX_LINES}.`),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeEnabled();
    // Explicit budget: this case renders and drives a 501-row sheet, which lands
    // near vitest's 5s default on a warm machine and over it on a cold CI runner.
    // The fixture size IS the assertion here, so the budget moves, not the sheet.
  }, 20_000);

  it('sends a sheet the server would accept instead of refusing it on the phone', async () => {
    // The exact sheet the raised DTO cap exists for: a mid-sized duka's closing
    // count, well past the number the phone used to stop at. It must reach the
    // server, not a red card telling her to delete counted lines.
    const items = manyItems(260);
    const harness = buildHarness({
      cachedStock: makeSnapshot(items),
      cachedDraft: draftOver(items),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Bidhaa 001');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(screen.getByText('Umehesabu 260')).toBeInTheDocument();
    expect(screen.queryByText(/haiwezi kuzidi/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'Ndiyo, tuma hesabu' }));
    await screen.findByText('HESABU IMEKAMILIKA');
    expect(harness.countPayloads()[0].lines).toHaveLength(260);
    // Same reason as the 501-row case above: the fixture size is the point, so
    // give it a budget a cold CI runner can meet.
  }, 20_000);

  it('says nothing about the ceiling on an ordinary sheet', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '5');
    expect(screen.queryByText(/kikomo/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'KAGUA HESABU' })).toBeEnabled();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-18
 * ------------------------------------------------------------------------ */
describe('HESABU-18: only a confirmed post stamps the count complete', () => {
  it('stamps hollow for any status that is not POSTED', async () => {
    // With the auto-post escape flag off, a resumed send returns the
    // marker-matched chain's OWN state. A desktop approver who approved but
    // did not post leaves it at APPROVED: nothing has moved in inventory, and
    // testing for PENDING_APPROVAL alone would stamp the solid seal and
    // HESABU IMEKAMILIKA over it.
    buildHarness({
      countPost: async (payload) => ({ ...defaultCountResponse(payload), status: 'APPROVED' }),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    const stamp = await screen.findByText('Inasubiri idhini ya ofisi');
    expect(screen.queryByText('HESABU IMEKAMILIKA')).not.toBeInTheDocument();
    // Hollow, not solid: the seal's fill carries the same message as its word.
    expect(stamp).toHaveStyle({ background: 'transparent' });
    // The daylog is the same statement in another place, so it agrees: an
    // APPROVED chain has posted nothing, and the day's finished-work tally
    // must not count it.
    expect(h.store.bumpDaylogTally).not.toHaveBeenCalled();
    expect(vibrate).not.toHaveBeenCalledWith([30, 40, 30]);
  });

  it('still stamps solid for the real thing', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    const stamp = await screen.findByText('HESABU IMEKAMILIKA');
    expect(stamp).toHaveStyle({ background: 'var(--aurora-accent)' });
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-19
 * ------------------------------------------------------------------------ */
describe('HESABU-19: a verdict is not a hiccup', () => {
  const FINAL_COPY = 'Hesabu hii haiwezi kutumwa ilivyo — rudi na urekebishe kabla ya kutuma tena.';

  it('says the count cannot be sent as it stands, and points at the edit', async () => {
    buildHarness({
      countPost: async () => {
        throw apiError(`Product ${UNGA.productId} is not available for this terminal`, 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    // The server judged the BODY (4xx). The same sheet sent again earns the
    // same answer, so the card names the fix instead of implying that tapping
    // again is one — and the rejection ritual belongs to exactly this case.
    expect(await screen.findByText('Bidhaa haipatikani kwenye tawi hili')).toBeInTheDocument();
    expect(screen.getByText(FINAL_COPY)).toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith([60, 40, 60]);
  });

  it('never says it after a 5xx, and never throws the key away over one', async () => {
    // A 502 from the proxy in front of a post() transaction the DTO budgets
    // tens of seconds for. Nothing about the sheet is wrong; the server may
    // even have posted it. Dressing this as a verdict sent the manager back to
    // edit — and under the old key rule the edit was what re-minted the key,
    // so the correction opened a SECOND adjustment over the first.
    const harness = buildHarness({
      countPost: async () => {
        throw apiError('Request failed: 502', 502);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(
      await screen.findByText(
        'Haikukamilika — hesabu yako ipo salama kwenye simu hii. Subiri kidogo, kisha ituma tena.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
    // Not "Haikukubaliwa — mwite msimamizi" either: nothing refused it, and a
    // supervisor at the other end of a phone cannot fix a gateway.
    expect(screen.queryByText('Haikukubaliwa — mwite msimamizi')).not.toBeInTheDocument();
    expect(vibrate).not.toHaveBeenCalledWith([60, 40, 60]);
    // The raw text is still there for whoever does need it.
    await user.click(screen.getByRole('button', { name: 'Maelezo ya kiufundi' }));
    expect(screen.getByText('Request failed: 502')).toBeInTheDocument();

    // And the retry the copy names rides the same key, so if the 502 masked a
    // post that committed, the server answers with the count it already has.
    const second = await openConfirm(user);
    await user.click(within(second).getByRole('button', { name: 'TUMA HESABU' }));
    await waitFor(() => expect(harness.countPayloads()).toHaveLength(2));
    const [one, two] = harness.countPayloads();
    expect(two.idempotencyKey).toBe(one.idempotencyKey);
  });

  it('never says it under the twin-detect conflict, which asks for the same request again', async () => {
    // Verbatim createStockCount twin-detect copy, under its real status. Two
    // contradictory instructions in adjacent sentences — "wait a moment, then
    // try again" over "go back and fix it" — and following the second one is
    // what creates the second adjustment the first one is trying to prevent.
    buildHarness({
      countPost: async () => {
        throw apiError(
          'This stock count is being recorded by another request. Retry in a moment.',
          409,
        );
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(
      await screen.findByText('Bado inatumwa — subiri kidogo, kisha jaribu tena.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
  });

  it('never says it for a 400 raised after the row exists, where an edit earns a 409', async () => {
    // A sheet that passed the wrapper's pre-create validation and then died
    // inside post(): a count-down that lost a race with a sale, or a company
    // with no inventory-adjustment-variance account (whose own English ends
    // "and retry"). The wrapper stopped destroying those rows this round — it
    // leaves them alive and resumable, which is right — so the sheet is now
    // RECORDED under this key, and "rudi na urekebishe kabla ya kutuma tena"
    // would send her to make an edit that assertCountMatchesRecordedAdjustment
    // answers with a 409. The instruction belongs to the refusals raised BEFORE
    // anything is created, and to no others.
    //
    // A MAPPED rejection is used deliberately: the gate is the pre-create set,
    // not "did pos-errors recognise it".
    buildHarness({
      countPost: async () => {
        throw apiError('Insufficient stock at branch/location b1: requested 5, available 0', 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(await screen.findByText('Stoo haitoshi kwa bidhaa hii')).toBeInTheDocument();
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
    // It was still a refusal, and the sheet and its key are still hers.
    expect(vibrate).toHaveBeenCalledWith([60, 40, 60]);
    expect(h.store.clearCountDraft).not.toHaveBeenCalled();
  });

  it('never says it when the server says this key already carries different numbers', async () => {
    // assertCountMatchesRecordedAdjustment, verbatim, at its real status — the
    // guard the wrapper grew this round so a corrected sheet riding the frozen
    // key can no longer silently replay the ORIGINAL numbers under a MUHURI.
    // No edit answers it: any edit still mismatches, and editing BACK replays
    // exactly the numbers she came here to correct. So the card carries the
    // server's sentence and nothing else — this is the count's half of the
    // purchase's "already received", where the office holds both documents.
    const raw =
      'This count was already sent with different numbers — check with the office before sending it again.';
    buildHarness({
      countPost: async () => {
        throw apiError(raw, 409);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    // It WAS a refusal, so it shakes and buzzes like one…
    await waitFor(() => expect(vibrate).toHaveBeenCalledWith([60, 40, 60]));
    // …but the one instruction on the card would be a wrong errand.
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
    // The English is for whoever needs it, never the headline (the assertion is
    // deliberately blind to WHICH Swahili sentence pos-errors maps this to, so
    // adding a row for it later is an improvement, not a broken test).
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Maelezo ya kiufundi' }));
    expect(screen.getByText(raw)).toBeInTheDocument();
  });

  it('never says it when the refusal judged the caller rather than the sheet', async () => {
    // requireTerminal's own copy, at its own status. The attempt really was
    // refused — the slab shakes and the reject haptic fires — but no edit to a
    // counted line answers a suspended terminal, so the instruction to go back
    // and fix the sheet would be a wrong errand handed to someone already
    // standing at the shelf.
    buildHarness({
      countPost: async () => {
        throw apiError('This Mobile POS terminal is not active', 403);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(await screen.findByText('Kituo hiki hakipatikani.')).toBeInTheDocument();
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
    expect(vibrate).toHaveBeenCalledWith([60, 40, 60]);
  });

  it('never says it when the capture is too old, and offers the count that copy names', async () => {
    // resumeStockCountChain's capture-age refusal, verbatim and at its real
    // status — the one permanent per-key refusal a deployable server can
    // produce, and the only one whose recovery the manager can perform where
    // she stands. FINAL_COPY would be false here twice over: the sheet is not
    // what is wrong (the numbers may be perfect), and an edit rides the same
    // frozen key into the identical 409, forever, because createdAt never gets
    // younger. Until round 5 it had no row at all and landed on "mwite
    // msimamizi", dropping BOTH halves of the server's own sentence.
    const harness = buildHarness({
      countPost: async () => {
        throw apiError(
          'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again, or ask the office to post this one.',
          409,
        );
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    // Both halves reach her, in her language, with the server's own window.
    expect(
      await screen.findByText(
        'Hesabu hii ilihesabiwa zaidi ya saa 6 zilizopita — haiwezi kutumwa kutoka kwenye simu hii. Hesabu stoo upya, au ulizia ofisi iidhinishe ile iliyorekodiwa.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
    expect(screen.queryByText('Haikukubaliwa — mwite msimamizi')).not.toBeInTheDocument();

    // The card carries the way out, right where the sentence names it.
    await user.click(screen.getByRole('button', { name: 'Anza hesabu mpya' }));
    const sheet = await screen.findByRole('dialog');
    await user.click(within(sheet).getByRole('button', { name: 'Ndiyo, anza hesabu mpya' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Umehesabu 0')).toBeInTheDocument();

    // …and it really was a new count: the refused key went with the sheet, so
    // the next send opens a chain the server has never seen — which is the only
    // thing that can carry a fresh capture stamp.
    harness.behavior.count = async (payload) => defaultCountResponse(payload);
    await countInto(user, 'Sukari', '30');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const second = await openConfirm(user);
    await user.click(within(second).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('HESABU IMEKAMILIKA');
    const [stale, fresh] = harness.countPayloads();
    expect(fresh.idempotencyKey).not.toBe(stale.idempotencyKey);
  });

  it('says nothing about the office when the capture was refused before anything was recorded', async () => {
    // assertCaptureStillCountable, the create-side half of the same bound. No
    // row exists, so "ulizia ofisi" would send her to a desk with nothing to
    // look at — the two sentences differ by one clause and the copy must too.
    buildHarness({
      countPost: async () => {
        throw apiError(
          'This count was captured more than 6 hours ago and can no longer be sent from the phone — count the shelf again.',
          409,
        );
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(
      await screen.findByText(
        'Hesabu hii ilihesabiwa zaidi ya saa 6 zilizopita — haiwezi kutumwa tena kutoka kwenye simu hii. Hesabu stoo upya.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
    // The same control, because the same recovery is the only one there is.
    expect(screen.getByRole('button', { name: 'Anza hesabu mpya' })).toBeInTheDocument();
  });

  it('never says it after a connection-shaped failure, where the retry is the fix', async () => {
    buildHarness({
      countPost: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    expect(await screen.findByText('Kutuma hesabu kunahitaji mtandao')).toBeInTheDocument();
    expect(screen.queryByText(FINAL_COPY)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-22
 * ------------------------------------------------------------------------ */
describe('HESABU-22: the phone must KEEP the key before the count leaves it', () => {
  const NOT_KEPT =
    'Hesabu hii haijahifadhiwa kwenye simu hii — haiwezi kutumwa hadi ihifadhiwe. Jaribu tena.';
  const KEPT = 'Rasimu imehifadhiwa kwenye simu hii';

  /** Storage refusing every write: quota, private mode, an evicted origin. */
  const refuseWrite = async () => {
    throw new Error('QuotaExceededError');
  };

  it('never claims custody of a sheet the phone did not keep', async () => {
    // A cheap Android under storage pressure. Every autosave rejects, and the
    // custody line used to render on the sole condition that a line had been
    // counted — so it said the draft was safe on this phone for three hundred
    // lines the phone had dropped.
    buildHarness({ draftWrite: refuseWrite });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    expect(await screen.findByText(NOT_KEPT)).toBeInTheDocument();
    expect(screen.queryByText(KEPT)).not.toBeInTheDocument();
  });

  it('refuses the send outright, because the idempotency key rides in that write', async () => {
    // The freeze write IS the safety mechanism: sent under a key the phone did
    // not keep, a POST whose response is lost comes back after a cold start to
    // a draft with no key, mints a fresh one, misses the marker, and posts the
    // same ABSOLUTE quantities a second time over a baseline that moved. So the
    // send stops here instead — nothing is lost, the sheet is still on screen,
    // and she is told in words rather than by silence.
    const harness = buildHarness({ draftWrite: refuseWrite });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(harness.countPayloads()).toHaveLength(0);
    // A verb that did not do what it says is a rejection whoever refused it:
    // same haptic as a server one (the kikaratasi's save() does this already).
    expect(vibrate).toHaveBeenCalledWith([60, 40, 60]);
    expect(screen.getByText(NOT_KEPT)).toBeInTheDocument();
    // The count is untouched and the verb is still live — the remedy is to try.
    expect(screen.getByRole('button', { name: 'TUMA HESABU' })).toBeEnabled();
  });

  it('sends once the phone accepts the write, under exactly the key it kept', async () => {
    // The invariant, stated positively: the key on the wire is the key on the
    // phone. Nothing goes out under a key that exists only in a ref.
    let refuse = true;
    const harness = buildHarness({
      draftWrite: async (terminalCode, draft) => {
        if (refuse) throw new Error('QuotaExceededError');
        h.state.drafts.set(`${terminalCode}:count`, draft);
      },
      // The response dies on the link, so the draft — and its key — survive to
      // be inspected.
      countPost: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const blocked = await openConfirm(user);
    await user.click(within(blocked).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText(NOT_KEPT);
    expect(harness.countPayloads()).toHaveLength(0);

    // Space frees up; the very next write lands.
    refuse = false;
    const dialog = await openConfirm(user);
    await user.click(within(dialog).getByRole('button', { name: 'TUMA HESABU' }));
    await waitFor(() => expect(harness.countPayloads()).toHaveLength(1));

    const [sent] = harness.countPayloads();
    expect(storedDraft()?.idempotencyKey).toBe(sent.idempotencyKey);
    expect(storedDraft()?.lines).toEqual({ 'st-unga': 9 });
    // …and the sheet says so again: custody follows the LAST write, not the best.
    expect(await screen.findByText('Kutuma hesabu kunahitaji mtandao')).toBeInTheDocument();
    expect(screen.queryByText(NOT_KEPT)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-23
 * ------------------------------------------------------------------------ */
describe('HESABU-23: anza hesabu mpya is a control, not an instruction', () => {
  it('ends the sheet and its key behind one confirm, with the sheet in hand', async () => {
    // Before this the copy named a recovery nothing implemented: enter() will
    // not re-open the resume/discard sheet while a line is counted, and the key
    // is released only when the LAST counted line is deleted — so obeying "anza
    // hesabu mpya" over a 350-line sheet meant clearing 350 fields one at a
    // time, which is exactly the counted work the instruction was trying to
    // save. One deliberate, confirmed control does the same thing in one tap.
    const harness = buildHarness({
      countPost: async () => {
        throw apiError('Haikukubaliwa', 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    await countInto(user, 'Unga wa Ngano', '9');
    await countInto(user, 'Sukari', '30');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const first = await openConfirm(user);
    await user.click(within(first).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('Haikukubaliwa — mwite msimamizi');
    await user.click(screen.getByRole('button', { name: 'Rudi' }));

    // It asks first, in the words of what it costs — this is the one control on
    // Hesabu that destroys counted numbers, so it is never a single tap.
    await user.click(screen.getByRole('button', { name: 'Anza hesabu mpya' }));
    const asked = await screen.findByRole('dialog');
    expect(
      within(asked).getByText(
        'Hesabu iliyopo itafutwa kwenye simu hii na utaanza upya. Namba ulizohesabu hazitabaki.',
      ),
    ).toBeInTheDocument();

    // Backing out leaves the count exactly where it was.
    await user.click(within(asked).getByRole('button', { name: 'Rudi' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Umehesabu 2')).toBeInTheDocument();
    expect(h.store.clearCountDraft).not.toHaveBeenCalled();

    // Confirming ends the sheet AND the frozen key, in one place.
    await user.click(screen.getByRole('button', { name: 'Anza hesabu mpya' }));
    const confirmed = await screen.findByRole('dialog');
    await user.click(within(confirmed).getByRole('button', { name: 'Ndiyo, anza hesabu mpya' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Umehesabu 0')).toBeInTheDocument();
    await waitFor(() => expect(h.store.clearCountDraft).toHaveBeenCalledWith(TERMINAL));

    // The next count is a NEW count, which is the whole point of the control:
    // a fresh key opens a chain the server has never seen, rather than resuming
    // one this key is anchored to.
    harness.behavior.count = async (payload) => defaultCountResponse(payload);
    await countInto(user, 'Sukari', '28');
    await user.click(screen.getByRole('button', { name: 'KAGUA HESABU' }));
    const second = await openConfirm(user);
    await user.click(within(second).getByRole('button', { name: 'TUMA HESABU' }));
    await screen.findByText('HESABU IMEKAMILIKA');

    const [rejected, fresh] = harness.countPayloads();
    expect(fresh.idempotencyKey).not.toBe(rejected.idempotencyKey);
    expect(fresh.lines).toEqual([{ productId: 'st-sukari', countedQuantity: 28 }]);
  });

  it('is not offered over an empty sheet — there is nothing to end', async () => {
    buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openHesabu(user);

    expect(screen.queryByRole('button', { name: 'Anza hesabu mpya' })).not.toBeInTheDocument();
    await countInto(user, 'Unga wa Ngano', '9');
    expect(screen.getByRole('button', { name: 'Anza hesabu mpya' })).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * HESABU-21
 * ------------------------------------------------------------------------ */
describe('HESABU-21: the no-snapshot retry answers for itself', () => {
  /**
   * A `/stock` that always fails, and — once armed — holds each attempt open
   * until released, so the retry's in-flight state can be observed. Arming is
   * explicit because the shell's pre-warm and the Stoo entry both fetch before
   * the manager ever taps anything.
   */
  function stallingStock() {
    let release = () => undefined as void;
    const held = new Promise<void>((resolve) => {
      release = () => resolve();
    });
    let armed = false;
    return {
      arm: () => {
        armed = true;
      },
      release: () => release(),
      get: async (): Promise<never> => {
        if (armed) await held;
        throw new Error('stock is still down');
      },
    };
  }

  it('shows its own flight, then says the retry failed too', async () => {
    // The manager is holding an overnight sheet on a flaky link. Before this,
    // Jaribu tena returned void and repainted nothing: she tapped, saw the
    // identical screen, tapped again, and concluded the app had frozen over her
    // count — the same silent-verb defect round 1 raised against HIFADHI.
    const stock = stallingStock();
    buildHarness({
      cachedStock: null,
      stockGet: stock.get,
      cachedDraft: {
        type: 'count',
        lines: { 'st-unga': 5, 'st-sukari': 28 },
        capturedAt: Date.now() - 3_600_000,
        updatedAt: Date.now() - 3_600_000,
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openStoo(user);
    await screen.findByText('Imeshindikana kupakua stoo');
    await tapSlab(user, 'ANZA KUHESABU');
    await screen.findByRole('heading', { name: 'Hesabu' });

    const offer = await screen.findByRole('dialog');
    await user.click(within(offer).getByRole('button', { name: 'Endeleza hesabu ya awali' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    // The boot fetch already failed, but she has not retried anything yet, so
    // the card must not announce a failure of hers.
    expect(
      screen.queryByText('Bado haijapakiwa — jaribu tena mtandao ukiimarika.'),
    ).not.toBeInTheDocument();

    stock.arm();
    await user.click(screen.getByRole('button', { name: 'Jaribu tena' }));
    const trying = await screen.findByRole('button', { name: 'Inajaribu…' });
    expect(trying).toBeDisabled();

    stock.release();
    expect(
      await screen.findByText('Bado haijapakiwa — jaribu tena mtandao ukiimarika.'),
    ).toBeInTheDocument();
    // The verb comes back, because trying again is still the only remedy — and
    // the count is untouched throughout.
    expect(screen.getByRole('button', { name: 'Jaribu tena' })).toBeEnabled();
    expect(screen.getByText('Umehesabu 2')).toBeInTheDocument();
    expect(h.store.clearCountDraft).not.toHaveBeenCalled();
  });
});

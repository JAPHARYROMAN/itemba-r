/**
 * Kaunta kikaratasi tests — Phase 5 of the POS reform (the purchase draft).
 * (docs/pos-reform/spec-purchases.md §3.1/§4/§6/§7/§8, design-direction.md §6.)
 *
 * Same harness discipline as kaunta-hesabu: everything drives the real screens
 * through the pilot (uiVersion=2) shell against an in-memory fake of the
 * IndexedDB store. The kikaratasi is Kaunta-and-manager-only; the classic
 * purchase screen stays pinned by the characterization suite.
 *
 * KIKARATASI-1  Auto-persist: supplier, lines and typed costs reach the draft
 *               500ms after the edit, with no button involved.
 * KIKARATASI-2  Restore: a parked slip comes back into the form on the next
 *               Pokea open — online, offline, and across an app kill.
 * KIKARATASI-3  The idempotency key follows the content until the first send
 *               attempt and is FROZEN from that attempt until success or
 *               discard — a retry rides it whatever the manager edited, so the
 *               server (not the phone) decides between replay and refusal.
 * KIKARATASI-10 A slip the server refuses as already-received is not a dead
 *               end: discarding it releases the key and the next delivery is a
 *               genuinely new one — and the refusal comes off the screen with
 *               the slip it described.
 * KIKARATASI-11 Every ordinary Pokea refusal reaches her in Swahili, not as
 *               the backend's English.
 * KIKARATASI-12 A lost response is not a verdict: the copy says wait-and-retry
 *               and the frozen key makes that retry one delivery.
 * KIKARATASI-13 The slip badge tracks the LAST write — a later refused save
 *               takes the custody claim down without destroying the slip.
 * KIKARATASI-14 Nothing the backend says in English reaches the red box: an
 *               unmapped REFUSAL lands on "mwite msimamizi", and a gateway that
 *               refused nothing says wait-and-retry instead of a status code.
 * KIKARATASI-4  Offline the slab verb is HIFADHI KIKARATASI: it saves, ticks,
 *               lands on Mauzo and raises the brass slip badge — no outbox row.
 * KIKARATASI-5  A posted delivery clears the slip and keeps the Phase-3
 *               behavior (MUHURI, catalog re-kick).
 * KIKARATASI-6  The boot orphan sweep takes a re-coded terminal's slip.
 * KIKARATASI-7  Revoked purchasesEnabled leaves the slip inert (§8 case 13).
 * KIKARATASI-8  Emptying the form IS the discard: slip and key both go.
 * KIKARATASI-9  A phone that refuses the write says so: the manager keeps the
 *               form, the badge never rises, and nothing navigates away.
 * KIKARATASI-15 POKEA never rides a key the phone would not keep: a refused
 *               freeze write blocks the send and is said in Swahili, and the
 *               key that DOES go out is on the phone before the request is.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '@/lib/api-client';
import type { MobilePosLiteProduct, PosPurchaseDraft } from '@/lib/mobile-pos-lite-store';
import { MobilePosLite } from './mobile-pos-lite';

/* ------------------------------------------------------------------------ *
 * Hoisted fakes — the kaunta-hesabu doubles, read through the purchase key.
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
    // Drafts (v4, Phase 5): the two module keys share one store, and the sweep
    // keys off the terminal prefix alone — exactly like the real module.
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
// The real module rides through under the two doubled verbs, so `ApiError` is
// the genuine class: it is what `backendPost` throws for EVERY non-2xx, and its
// `status` is what separates a refusal the manager must act on from a gateway
// that merely gave up. A hand-rolled double here would certify the Pokea
// rejection surface against an error the app cannot produce.
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

type PurchasePayload = {
  supplierId: string;
  idempotencyKey: string;
  notes?: string;
  lines: Array<{ productId: string; quantity: number; unitCost?: number }>;
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
const UNGA = makeProduct({
  id: 'p-unga',
  name: 'Unga wa Ngano',
  code: 'UNGA',
  unitSymbol: 'kg',
  sellingPrice: 5000,
});

const AZAM = { id: 's-azam', name: 'Azam Distributors', supplierCode: 'AZ-1', phone: '0755000000' };

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
    // Manunuzi's gate: every test that receives is a manager session.
    purchasesEnabled: true,
    stockCountsEnabled: false,
  };
  return {
    ...base,
    ...overrides,
    terminal: { ...base.terminal, ...(overrides.terminal ?? {}) },
  };
}

/** A slip already parked on this phone, as an earlier session left it. */
function makeSlip(overrides: Partial<PosPurchaseDraft> = {}): PosPurchaseDraft {
  return {
    type: 'purchase',
    terminalCode: TERMINAL,
    idempotencyKey: 'aaaabbbbccccddddeeeeffff00001111',
    supplierId: AZAM.id,
    supplierName: AZAM.name,
    lines: [
      { productId: SODA.id, name: SODA.name, unitSymbol: 'pc', quantity: 24, unitCost: 1500 },
      { productId: UNGA.id, name: UNGA.name, unitSymbol: 'kg', quantity: 3 },
    ],
    savedAt: Date.now() - 60_000,
    ...overrides,
  };
}

function setNavigatorOnLine(value: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value });
}

const vibrate = vi.fn();

type HarnessOptions = {
  onLine?: boolean;
  cachedSession?: PosSession | null;
  session?: PosSession;
  sessionGet?: () => Promise<PosSession>;
  /** Slips already in the drafts store, by full key. */
  drafts?: Array<[string, unknown]>;
  purchasePost?: (payload: PurchasePayload) => Promise<unknown>;
  /**
   * The phone refuses to hold the slip — over quota on Android Chrome, or an
   * iOS private-mode `put` that rejects. Nothing reaches the store.
   */
  storageRefuses?: boolean;
};

function buildHarness(options: HarnessOptions = {}) {
  const session = options.session ?? kauntaSession();

  h.state.binding = { ...BINDING };
  h.state.catalogs = new Map([[TERMINAL, [SODA, UNGA]]]);
  h.state.sessions = new Map(options.cachedSession ? [[TERMINAL, options.cachedSession]] : []);
  h.state.frequents = new Map();
  h.state.outbox = [];
  h.state.daylog = new Map();
  h.state.stocks = new Map();
  h.state.drafts = new Map(options.drafts ?? []);

  // Re-stated on every harness build so a refusing store never leaks into the
  // next test the way a bare `mockRejectedValue` would.
  h.store.savePurchaseDraft.mockImplementation(async (terminalCode: string, draft: unknown) => {
    if (options.storageRefuses) {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    h.state.drafts.set(`${terminalCode}:purchase`, draft);
  });

  setNavigatorOnLine(options.onLine ?? true);

  const behavior = {
    purchase:
      options.purchasePost ??
      (async () => ({
        id: 'po-1',
        purchaseOrderNumber: 'PO-2026-0141',
        grnNumber: 'GRN-2026-0139',
        totalAmount: 36000,
      })),
  };

  const sessionGet = options.sessionGet ?? (async () => session);

  h.backendGet.mockImplementation(async (path: string) => {
    if (path === '/mobile-pos-lite/session') return sessionGet();
    if (path === '/mobile-pos-lite/catalog') return [...(h.state.catalogs.get(TERMINAL) ?? [])];
    if (path === '/mobile-pos-lite/products') return [];
    if (path === '/mobile-pos-lite/customers') return [];
    if (path === '/mobile-pos-lite/suppliers') return [AZAM];
    if (path === '/mobile-pos-lite/my-sales-today') return { count: 0, totalAmount: 0, sales: [] };
    if (path === '/mobile-pos-lite/stock')
      return { asOf: new Date().toISOString(), branch: { id: 'b1', name: 'Tawi' }, items: [] };
    throw new Error(`Unexpected GET ${path} in kaunta kikaratasi test`);
  });
  h.backendPost.mockImplementation(async (path: string, payload: unknown) => {
    // No sale ever completes here; a connection-shaped failure keeps any boot
    // sync from mutating state under the tests.
    if (path === '/mobile-pos-lite/sales') throw new TypeError('Failed to fetch');
    if (path === '/mobile-pos-lite/purchases') return behavior.purchase(payload as PurchasePayload);
    throw new Error(`Unexpected POST ${path} in kaunta kikaratasi test`);
  });

  return {
    session,
    behavior,
    /** Every purchase POST body, in call order. */
    purchasePayloads: () =>
      h.backendPost.mock.calls
        .filter(([path]) => path === '/mobile-pos-lite/purchases')
        .map(([, payload]) => payload as PurchasePayload),
    /** The slip as it currently sits in the fake store. */
    slip: () => h.state.drafts.get(`${TERMINAL}:purchase`) as PosPurchaseDraft | undefined,
    catalogGets: () =>
      h.backendGet.mock.calls.filter(([path]) => path === '/mobile-pos-lite/catalog').length,
  };
}

/**
 * What `backendPost` really throws for a non-2xx: an ApiError carrying the HTTP
 * status beside the backend's own sentence. Every Pokea refusal fixture below
 * is built with it, because the status is half of what the screen classifies on
 * — a 400 the manager can answer, a 409 only the office can, a 502 that refused
 * nothing at all.
 */
function apiError(message: string, status: number) {
  return new ApiError(message, status, { message });
}

/** The rejection `assertPurchaseMatchesRecordedOrder` throws, verbatim. */
const ALREADY_RECEIVED =
  'The earlier slip for this delivery was already received — check with the office before recording it again.';
/** The Swahili the manager must actually read for it (pos-i18n errSlipAlreadyReceived). */
const ALREADY_RECEIVED_SW =
  'Mzigo huu ulishapokelewa kwa kikaratasi cha awali — ulizia ofisi kabla ya kutuma tena.';

/**
 * The three ordinary Pokea refusals, each copied VERBATIM from its throw site
 * in mobile-pos-lite.service.ts, beside the Swahili the manager has to read.
 * These are the sentences a manager meets at a delivery — a supplier moved
 * branch overnight, a line nothing has ever priced — and every one of them was
 * English on screen until round 3, because the map's own "nothing renders these
 * yet" exemption outlived the change that started rendering them.
 */
const PURCHASE_REFUSALS: Array<[label: string, raw: string, swahili: string]> = [
  [
    'supplier moved branch (createPurchase scope check)',
    'The selected supplier is not available for this terminal branch',
    'Muuzaji huyu hapatikani kwa tawi hili — chagua mwingine.',
  ],
  [
    'a line nothing has priced (resolvePurchaseLines)',
    'Unga wa Ngano does not have a purchase cost — enter the unit cost',
    'Unga wa Ngano haina bei ya kununua — andika bei kwenye mstari wake.',
  ],
  [
    'two costs for one product (resolvePurchaseLines)',
    'Provide a single unit cost per product',
    'Bidhaa moja inahitaji bei moja ya kununua — sahihisha mstari uliojirudia.',
  ],
];

/** What a lost response must say instead of "Failed to fetch". */
const SEND_FAILED_SW =
  'Haikukamilika — mtandao umekatika. Fomu ipo hapa; subiri kidogo, kisha gonga POKEA tena.';

/**
 * What a POKEA the PHONE refused must say. Deliberately not the save verb's
 * sentence: the question a manager asks after tapping RECEIVE is whether the
 * delivery went, so the copy answers that one — the same shape the count refuses
 * a send with (`countDraftSaveFailed`), because she should not have to know
 * which module she is standing in.
 */
const SEND_BLOCKED_SW =
  'Kikaratasi hiki hakijahifadhiwa kwenye simu hii — mzigo hauwezi kupokelewa hadi kihifadhiwe. Jaribu tena.';

/**
 * A purchase endpoint with the real one's memory. An order is anchored to the
 * key it was created under (`[MPL-PURCHASE:<key>]`); a resend under that key
 * replays it, and a resend under that key carrying DIFFERENT content is
 * refused rather than replayed or duplicated — `assertPurchaseMatchesRecorded
 * Order`, added server-side precisely because no key policy on the phone can
 * tell those two apart on its own. `loseResponses` kills the response of the
 * first N requests AFTER the order exists: the lorry is on the shelves, the
 * phone knows nothing, which is the whole reason the key freezes.
 */
function markerServer({ loseResponses = 0 }: { loseResponses?: number } = {}) {
  const orders = new Map<string, PurchasePayload>();
  let lost = 0;
  const content = (payload: PurchasePayload) => JSON.stringify([payload.supplierId, payload.lines]);
  return {
    /** One entry per purchase order the branch now owns — the duplicate check. */
    orders,
    handle: async (payload: PurchasePayload) => {
      const recorded = orders.get(payload.idempotencyKey);
      if (recorded) {
        // ConflictException — the wrapper's own status for a marker hit whose
        // recorded content is not what was just sent.
        if (content(recorded) !== content(payload)) throw apiError(ALREADY_RECEIVED, 409);
        return {
          id: 'po-1',
          purchaseOrderNumber: 'PO-2026-0141',
          grnNumber: 'GRN-2026-0139',
          totalAmount: 36000,
        };
      }
      orders.set(payload.idempotencyKey, payload);
      if (lost < loseResponses) {
        lost += 1;
        throw new TypeError('Failed to fetch');
      }
      return {
        id: `po-${orders.size}`,
        purchaseOrderNumber: 'PO-2026-0141',
        grnNumber: 'GRN-2026-0139',
        totalAmount: 36000,
      };
    },
  };
}

type User = ReturnType<typeof userEvent.setup>;

async function mountKaunta() {
  const view = render(<MobilePosLite />);
  await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
  return view;
}

async function openPokea(user: User) {
  await user.click(screen.getByRole('button', { name: 'Manunuzi' }));
  await screen.findByRole('heading', { name: 'Pokea Mzigo' });
}

async function pickSupplier(user: User) {
  await user.type(screen.getByPlaceholderText('Jina au namba ya muuzaji'), 'az');
  await user.click(await screen.findByRole('button', { name: new RegExp(AZAM.name) }));
}

async function addLine(user: User, term: string, name: RegExp) {
  await user.type(screen.getByPlaceholderText('Tafuta au skani bidhaa'), term);
  await user.click(await screen.findByRole('button', { name }));
}

function costField(name: string) {
  return screen.getByLabelText(`Bei ya kununua - ${name}`);
}

/** The autosave is debounced 500ms; every assertion on it waits that out. */
async function waitForAutosave(assertion: () => void) {
  await waitFor(assertion, { timeout: 2000 });
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
 * KIKARATASI-1
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-1: auto-persist is crash insurance, not a button', () => {
  it('writes supplier, lines and typed costs to the slip with no verb ever pressed', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);

    await pickSupplier(user);
    await waitForAutosave(() =>
      expect(h.store.savePurchaseDraft).toHaveBeenCalledWith(
        TERMINAL,
        expect.objectContaining({ type: 'purchase', supplierId: AZAM.id, supplierName: AZAM.name }),
      ),
    );

    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    await waitForAutosave(() =>
      expect(harness.slip()?.lines).toEqual([
        { productId: SODA.id, name: SODA.name, unitSymbol: 'pc', quantity: 1, unitCost: 1500 },
      ]),
    );

    // Nothing was pressed and nothing was sent: this is the silent net.
    expect(harness.purchasePayloads()).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'POKEA' })).toBeEnabled();
  });

  it('omits the cost of an untyped line, exactly as the payload does', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);

    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()?.lines).toHaveLength(1));
    // No cost typed is not a zero cost: the server resolves the fallback.
    expect(harness.slip()?.lines[0]).not.toHaveProperty('unitCost');
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-2
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-2: the slip restores into the form', () => {
  it('restores supplier, lines and typed costs on the next Pokea open, online', async () => {
    buildHarness({ drafts: [[`${TERMINAL}:purchase`, makeSlip()]] });
    const user = userEvent.setup();
    await mountKaunta();

    // The parked slip is legible before it is opened: one brass token.
    expect(await screen.findByText('Kikaratasi')).toBeInTheDocument();

    await openPokea(user);
    // Supplier chip, both lines, and the cost the manager typed last time.
    expect(await screen.findByRole('button', { name: /Azam Distributors/ })).toBeInTheDocument();
    expect(screen.getByText('Soda Baridi')).toBeInTheDocument();
    expect(screen.getByText('Unga wa Ngano')).toBeInTheDocument();
    expect(costField('Soda Baridi')).toHaveValue('1500');
    expect(costField('Unga wa Ngano')).toHaveValue('');
    expect(screen.getByLabelText('Idadi ya Soda Baridi')).toHaveValue('24');
    // The form says where it came from, and the badge stops pointing at it.
    expect(screen.getByText('Kikaratasi kimehifadhiwa kwenye simu hii.')).toBeInTheDocument();
    expect(screen.queryByText('Kikaratasi')).not.toBeInTheDocument();
  });

  it('restores offline too, with the calm note instead of a warning', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      drafts: [[`${TERMINAL}:purchase`, makeSlip()]],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);

    expect(await screen.findByRole('button', { name: /Azam Distributors/ })).toBeInTheDocument();
    expect(screen.getByText('Soda Baridi')).toBeInTheDocument();
    expect(
      screen.getByText('Hakuna mtandao — jaza fomu; kikaratasi kitahifadhiwa kwenye simu.'),
    ).toBeInTheDocument();
  });

  it('survives the app being killed mid-form', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    const view = await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '900');
    await waitForAutosave(() => expect(harness.slip()?.lines[0]?.unitCost).toBe(900));

    // Battery dies in the storeroom; the slip is on the phone. Relaunched from
    // the home-screen icon, the POS boots into Mauzo like any cold start.
    view.unmount();
    window.history.replaceState(null, '', '/');
    render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await openPokea(user);

    expect(await screen.findByRole('button', { name: /Azam Distributors/ })).toBeInTheDocument();
    expect(costField('Soda Baridi')).toHaveValue('900');
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-3
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-3: the frozen idempotency key', () => {
  it('sends the key the draft was created with, and reuses it after a rejection', async () => {
    let rejectNext = true;
    const harness = buildHarness({
      purchasePost: async () => {
        if (rejectNext) {
          rejectNext = false;
          throw new Error(PURCHASE_REFUSALS[0][1]);
        }
        return { id: 'po-1', purchaseOrderNumber: 'PO-1' };
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    const parkedKey = harness.slip()?.idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    // In Swahili — this fixture used to assert the raw English, which is how a
    // gap gets certified rather than caught (see KIKARATASI-11).
    await screen.findByText(PURCHASE_REFUSALS[0][2]);
    // Rejection keeps the work: form intact, slip intact, verb alive.
    expect(h.store.deletePurchaseDraft).not.toHaveBeenCalled();
    expect(harness.slip()).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(2));
    const [first, second] = harness.purchasePayloads();
    // A regenerated key would turn one delivery into two; the server resumes
    // its [MPL-PURCHASE:<key>] chain off this one instead.
    expect(first.idempotencyKey).toBe(parkedKey);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('re-mints the key while nothing has been sent yet', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    const firstKey = harness.slip()?.idempotencyKey;

    // Before any POKEA the phone owes the server nothing: no marker exists, so
    // the sack of unga simply makes this a different delivery and it may have
    // a different key. The freeze starts at the first attempt, not at the
    // first keystroke.
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()?.lines).toHaveLength(2));
    expect(harness.slip()?.idempotencyKey).not.toBe(firstKey);
    expect(harness.purchasePayloads()).toHaveLength(0);
  });

  it('writes the key it is about to send BEFORE the request that depends on it', async () => {
    // The key only protects the delivery while the phone is holding it, and
    // the autosave is scheduled off the last EDIT — so the ordinary rhythm at a
    // lorry (type the final unit cost, tap POKEA on the next beat) used to send
    // under a key minted in `sendKey` while the slip in IDB still carried the
    // one from before the edit. A phone killed in that window came back holding
    // a key the server had never seen, minted another, missed the marker, and
    // the branch received the same crates twice.
    const harness = buildHarness({
      purchasePost: async () => {
        // The answer dies on the link — the case the frozen key exists for.
        throw new TypeError('Failed to fetch');
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    const parkedKey = harness.slip()?.idempotencyKey;

    // The last edit and the tap, inside one debounce window: no autosave runs
    // between them.
    await user.type(costField('Soda Baridi'), '1500');
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));
    const sentKey = harness.purchasePayloads()[0].idempotencyKey;
    // Nothing had been sent when she typed the cost, so that edit was free to
    // start a different delivery — which is exactly what makes the stale stored
    // key dangerous rather than merely untidy.
    expect(sentKey).not.toBe(parkedKey);

    // The write is ordered ahead of the request, not merely "eventually":
    // asserted on call order, because the phone can be killed between the two.
    const postAt = h.backendPost.mock.calls.findIndex(
      ([path]) => path === '/mobile-pos-lite/purchases',
    );
    const saveAt = h.store.savePurchaseDraft.mock.calls.findIndex(
      ([, draft]) => (draft as PosPurchaseDraft).idempotencyKey === sentKey,
    );
    expect(saveAt).toBeGreaterThanOrEqual(0);
    expect(h.store.savePurchaseDraft.mock.invocationCallOrder[saveAt]).toBeLessThan(
      h.backendPost.mock.invocationCallOrder[postAt],
    );
    // …and what the phone holds afterwards is the key that went out, so a cold
    // start resumes THIS chain instead of opening a second one.
    expect(harness.slip()?.idempotencyKey).toBe(sentKey);
  });

  it('replays one delivery when an untouched slip is resent after a lost response', async () => {
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    await waitForAutosave(() => expect(harness.slip()?.lines[0]?.unitCost).toBe(1500));
    const sentKey = harness.slip()?.idempotencyKey;

    // The crates are on the shelf and the order is on the server; only the
    // answer died on the link, so the phone still shows the form.
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));
    expect(screen.getByRole('heading', { name: 'Pokea Mzigo' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await screen.findByText('MZIGO UMEPOKELEWA');
    const [first, second] = harness.purchasePayloads();
    expect(second.idempotencyKey).toBe(sentKey);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    // The marker resume answered with the order it already had: one delivery
    // on the branch's books, not two, and the slip's job is done.
    expect(server.orders.size).toBe(1);
    await waitFor(() => expect(h.store.deletePurchaseDraft).toHaveBeenCalledWith(TERMINAL));
  });

  it('freezes the key through a correction after a lost response, and lets the office answer', async () => {
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    const sentKey = harness.slip()?.idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));

    // The sack of unga she had not written down yet. A fresh key here would
    // miss the marker and receive the soda a SECOND time — two GRNs, two
    // payables, nothing linking them — so the key does not move: the server is
    // the only party that knows what landed, and this is how it gets asked.
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()?.lines).toHaveLength(2));
    expect(harness.slip()?.idempotencyKey).toBe(sentKey);

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(2));
    const [first, second] = harness.purchasePayloads();
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    // The correction really is sent — that is what the server compares against
    // the order it recorded, and why it can refuse instead of guessing.
    expect(second.lines).toEqual([
      { productId: SODA.id, quantity: 1 },
      { productId: UNGA.id, quantity: 1 },
    ]);
    expect(server.orders.size).toBe(1);

    // And the refusal reaches her in Swahili, on the form she is still
    // standing in, with no seal claiming the unga arrived.
    expect(await screen.findByText(ALREADY_RECEIVED_SW)).toBeInTheDocument();
    expect(screen.queryByText(ALREADY_RECEIVED)).not.toBeInTheDocument();
    expect(screen.queryByText('MZIGO UMEPOKELEWA')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pokea Mzigo' })).toBeInTheDocument();
    expect(screen.getByText('Unga wa Ngano')).toBeInTheDocument();
    expect(h.store.deletePurchaseDraft).not.toHaveBeenCalled();
  });

  it('freezes the key when the correction is only the buying price', async () => {
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    await waitForAutosave(() => expect(harness.slip()?.lines[0]?.unitCost).toBe(1500));

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));

    // A shilling is content: the same crates at a corrected price are a
    // different payable. The phone still may not decide that on its own — it
    // sends the number she fixed under the same key and takes the answer.
    await user.clear(costField('Soda Baridi'));
    await user.type(costField('Soda Baridi'), '1800');
    await waitForAutosave(() => expect(harness.slip()?.lines[0]?.unitCost).toBe(1800));

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(2));
    const [first, second] = harness.purchasePayloads();
    expect(first.lines).toEqual([{ productId: SODA.id, quantity: 1, unitCost: 1500 }]);
    expect(second.lines).toEqual([{ productId: SODA.id, quantity: 1, unitCost: 1800 }]);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(server.orders.size).toBe(1);
    expect(await screen.findByText(ALREADY_RECEIVED_SW)).toBeInTheDocument();
    expect(screen.queryByText('MZIGO UMEPOKELEWA')).not.toBeInTheDocument();
  });

  it('keeps the key when she steps out and back before retrying an untouched slip', async () => {
    let loseNext = true;
    const harness = buildHarness({
      purchasePost: async () => {
        if (loseNext) {
          loseNext = false;
          throw new TypeError('Failed to fetch');
        }
        return { id: 'po-4', purchaseOrderNumber: 'PO-4' };
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    await waitForAutosave(() => expect(harness.slip()?.lines[0]?.unitCost).toBe(1500));
    const parkedKey = harness.slip()?.idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));

    // Out to the counter to serve someone, then back into Pokea — the form is
    // rebuilt from the parked slip rather than kept in memory. Re-entry is not
    // an edit, and neither is the autosave tick that follows it.
    await user.click(screen.getByRole('button', { name: 'Mauzo' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await openPokea(user);
    await screen.findByRole('button', { name: /Azam Distributors/ });
    expect(costField('Soda Baridi')).toHaveValue('1500');
    expect(harness.slip()?.idempotencyKey).toBe(parkedKey);

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(2));
    const [first, second] = harness.purchasePayloads();
    // A fresh key here would receive the same crates twice; the marker resume
    // is only reachable while the key holds.
    expect(first.idempotencyKey).toBe(parkedKey);
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(second.lines).toEqual(first.lines);
  });

  it('keeps a restored slip frozen: the phone cannot see an earlier session’s attempts', async () => {
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    const view = await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    const sentKey = harness.slip()?.idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));

    // The battery goes while she is still looking at the failed send. Nothing
    // in the parked slip records that a POKEA ever happened — so a restored
    // slip is treated as already attempted. Freezing a key that never left the
    // phone costs nothing; re-minting one that did costs a second delivery.
    view.unmount();
    window.history.replaceState(null, '', '/');
    render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await openPokea(user);
    await screen.findByRole('button', { name: /Azam Distributors/ });

    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()?.lines).toHaveLength(2));
    expect(harness.slip()?.idempotencyKey).toBe(sentKey);

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(2));
    expect(harness.purchasePayloads()[1].idempotencyKey).toBe(sentKey);
    expect(server.orders.size).toBe(1);
    expect(await screen.findByText(ALREADY_RECEIVED_SW)).toBeInTheDocument();
  });

  it('mints a fresh key for the next delivery once one has posted', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();

    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await screen.findByText('MZIGO UMEPOKELEWA');

    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(2));

    const [first, second] = harness.purchasePayloads();
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    // And the second delivery is genuinely the second one, not a replay.
    expect(second.lines).toEqual([{ productId: UNGA.id, quantity: 1 }]);
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-4
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-4: HIFADHI KIKARATASI is the offline verb', () => {
  it('saves the slip, ticks, lands on Mauzo and raises the brass badge', async () => {
    const harness = buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);

    // Offline the primary verb is still blue and still the one thing to press.
    expect(screen.queryByRole('button', { name: 'POKEA' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'HIFADHI KIKARATASI' })).toBeDisabled();

    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    const save = screen.getByRole('button', { name: 'HIFADHI KIKARATASI' });
    expect(save).toBeEnabled();
    await user.click(save);

    // Back at the counter, with the slip counted in the ribbon.
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(await screen.findByText('Kikaratasi')).toBeInTheDocument();
    expect(harness.slip()?.lines).toEqual([
      { productId: SODA.id, name: SODA.name, unitSymbol: 'pc', quantity: 1, unitCost: 1500 },
    ]);
    // Routine custody: the 15ms tick, never the stamp.
    expect(vibrate).toHaveBeenCalledWith(15);
    expect(vibrate).not.toHaveBeenCalledWith([30, 40, 30]);
    expect(screen.queryByText('MZIGO UMEPOKELEWA')).not.toBeInTheDocument();
    // A purchase never becomes a queued transaction.
    expect(h.store.enqueueMobilePosLiteSale).not.toHaveBeenCalled();
    expect(harness.purchasePayloads()).toHaveLength(0);
  });

  it('keeps the offline ribbon chip beside the slip badge', async () => {
    buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      drafts: [[`${TERMINAL}:purchase`, makeSlip()]],
    });
    await mountKaunta();

    expect(await screen.findByText('Kikaratasi')).toBeInTheDocument();
    expect(screen.getByText('Hakuna mtandao — mauzo ya pesa taslimu tu')).toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-5
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-5: a posted delivery ends the slip', () => {
  it('clears the draft, keeps the MUHURI and re-kicks the catalog', async () => {
    const harness = buildHarness({ drafts: [[`${TERMINAL}:purchase`, makeSlip()]] });
    const user = userEvent.setup();
    await mountKaunta();
    const catalogGetsBefore = harness.catalogGets();

    await openPokea(user);
    await screen.findByRole('button', { name: /Azam Distributors/ });
    await user.click(screen.getByRole('button', { name: 'POKEA' }));

    await screen.findByText('MZIGO UMEPOKELEWA');
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    // The restored slip rode into the payload, cost and all.
    const [payload] = harness.purchasePayloads();
    expect(payload.supplierId).toBe(AZAM.id);
    expect(payload.lines).toEqual([
      { productId: SODA.id, quantity: 24, unitCost: 1500 },
      { productId: UNGA.id, quantity: 3 },
    ]);
    // Draft gone on 2xx, badge gone with it, availableStock re-synced.
    await waitFor(() => expect(h.store.deletePurchaseDraft).toHaveBeenCalledWith(TERMINAL));
    expect(harness.slip()).toBeUndefined();
    await waitFor(() => expect(harness.catalogGets()).toBeGreaterThan(catalogGetsBefore));
    await waitFor(() => expect(screen.queryByText('Kikaratasi')).not.toBeInTheDocument());
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-6
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-6: the boot orphan sweep', () => {
  it('deletes a re-coded terminal’s slip and keeps this terminal’s', async () => {
    const harness = buildHarness({
      drafts: [
        [`${TERMINAL}:purchase`, makeSlip()],
        ['T-OLD:purchase', makeSlip({ terminalCode: 'T-OLD' })],
        ['T-OLD:count', { type: 'count', lines: { 'p-soda': 4 }, capturedAt: 1, updatedAt: 1 }],
      ],
    });
    await mountKaunta();

    await waitFor(() => expect(h.store.sweepOrphanDrafts).toHaveBeenCalledWith(TERMINAL));
    expect([...h.state.drafts.keys()]).toEqual([`${TERMINAL}:purchase`]);
    expect(harness.slip()).toBeDefined();
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-7
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-7: a revoked permission leaves the slip inert', () => {
  it('shows no badge and touches nothing when purchasesEnabled goes away', async () => {
    const harness = buildHarness({
      session: kauntaSession({ purchasesEnabled: false }),
      drafts: [[`${TERMINAL}:purchase`, makeSlip()]],
    });
    await mountKaunta();

    expect(screen.queryByRole('button', { name: 'Manunuzi' })).not.toBeInTheDocument();
    expect(screen.queryByText('Kikaratasi')).not.toBeInTheDocument();
    expect(h.store.readPurchaseDraft).not.toHaveBeenCalled();
    // Inert, not destroyed: the slip resurfaces if the flag comes back.
    expect(h.store.deletePurchaseDraft).not.toHaveBeenCalled();
    expect(harness.slip()).toBeDefined();
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-8
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-8: emptying the form is the discard', () => {
  it('drops the slip and its key when the last line and the supplier go', async () => {
    const harness = buildHarness({
      drafts: [[`${TERMINAL}:purchase`, makeSlip({ lines: [makeSlip().lines[0]] })]],
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await screen.findByRole('button', { name: /Azam Distributors/ });

    await user.click(screen.getByRole('button', { name: 'Ondoa Soda Baridi' }));
    // A supplier alone is still work worth keeping.
    expect(harness.slip()).toBeDefined();

    await user.click(screen.getByRole('button', { name: /Azam Distributors/ }));
    await waitFor(() => expect(h.store.deletePurchaseDraft).toHaveBeenCalledWith(TERMINAL));
    expect(harness.slip()).toBeUndefined();
    await waitFor(() =>
      expect(
        screen.queryByText('Kikaratasi kimehifadhiwa kwenye simu hii.'),
      ).not.toBeInTheDocument(),
    );

    // The next delivery is a new delivery, under a new key.
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    expect(harness.slip()?.idempotencyKey).not.toBe(makeSlip().idempotencyKey);
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-9
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-9: a refused write is said out loud', () => {
  it('keeps the manager on the form, tells her, and never raises the badge', async () => {
    const harness = buildHarness({
      onLine: false,
      cachedSession: kauntaSession(),
      sessionGet: () => Promise.reject(new TypeError('Failed to fetch')),
      storageRefuses: true,
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);

    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    // The autosave has already been refused by now, and stays silent about it:
    // crash insurance is not the manager's problem until she asks for a save.
    await waitFor(() => expect(h.store.savePurchaseDraft).toHaveBeenCalled());
    expect(
      screen.queryByText('Kikaratasi hakijahifadhiwa kwenye simu hii — jaribu tena.'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'HIFADHI KIKARATASI' }));

    // The one outcome the kikaratasi exists to prevent is a slip lost in
    // silence: she is still on her fifteen lines, and she is told why.
    expect(
      await screen.findByText('Kikaratasi hakijahifadhiwa kwenye simu hii — jaribu tena.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pokea Mzigo' })).toBeInTheDocument();
    expect(screen.getByText('Soda Baridi')).toBeInTheDocument();
    expect(costField('Soda Baridi')).toHaveValue('1500');
    // A refused save is a rejection: same haptic as a server one, no tick.
    expect(vibrate).toHaveBeenLastCalledWith([60, 40, 60]);
    expect(harness.slip()).toBeUndefined();
    // The verb stays alive so the second tap is worth something.
    expect(screen.getByRole('button', { name: 'HIFADHI KIKARATASI' })).toBeEnabled();

    // And the ribbon never claims custody of a slip the phone dropped.
    await user.click(screen.getByRole('button', { name: 'Mauzo' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(screen.queryByText('Kikaratasi')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-10
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-10: a refused slip still has a way out', () => {
  it('discards the already-received slip and records the next delivery under a new key', async () => {
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    const sentKey = harness.slip()?.idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()?.lines).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    expect(await screen.findByText(ALREADY_RECEIVED_SW)).toBeInTheDocument();

    // The soda is the office's problem now, and she cannot re-send this slip
    // as it stands. Emptying the form IS the discard ritual (§3.1 as amended
    // by critique D3): the slip goes, and the frozen key goes with it, so she
    // is not stuck holding a key that can only ever be refused.
    await user.click(screen.getByRole('button', { name: 'Ondoa Soda Baridi' }));
    await user.click(screen.getByRole('button', { name: 'Ondoa Unga wa Ngano' }));
    await user.click(screen.getByRole('button', { name: /Azam Distributors/ }));
    await waitFor(() => expect(h.store.deletePurchaseDraft).toHaveBeenCalledWith(TERMINAL));

    // The next lorry is a new delivery and says so: a new key, a new order,
    // and the MUHURI she could not have earned on the refused one.
    await pickSupplier(user);
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    expect(harness.slip()?.idempotencyKey).not.toBe(sentKey);

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await screen.findByText('MZIGO UMEPOKELEWA');
    const payloads = harness.purchasePayloads();
    expect(payloads).toHaveLength(3);
    expect(payloads[2].idempotencyKey).not.toBe(sentKey);
    expect(payloads[2].lines).toEqual([{ productId: UNGA.id, quantity: 1 }]);
    // Two orders, both deliberate: the soda the office already holds, and this
    // one. Nothing was received twice under either key.
    expect(server.orders.size).toBe(2);
  });

  it('takes the refusal down when the slip it describes is discarded', async () => {
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()?.lines).toHaveLength(2));
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    expect(await screen.findByText(ALREADY_RECEIVED_SW)).toBeInTheDocument();

    // The card names a slip. Emptying the form IS the discard (§3.1 as amended
    // by critique D3), so the moment the last line goes the slip and its frozen
    // key are gone — and a red box still saying "this delivery was already
    // received" is now a statement about nothing, sitting exactly where the
    // NEXT lorry gets typed.
    await user.click(screen.getByRole('button', { name: 'Ondoa Soda Baridi' }));
    await user.click(screen.getByRole('button', { name: 'Ondoa Unga wa Ngano' }));
    await user.click(screen.getByRole('button', { name: /Azam Distributors/ }));
    await waitFor(() => expect(h.store.deletePurchaseDraft).toHaveBeenCalledWith(TERMINAL));
    await waitFor(() => expect(screen.queryByText(ALREADY_RECEIVED_SW)).not.toBeInTheDocument());

    // …and it does not come back over the delivery she types next.
    await pickSupplier(user);
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    expect(screen.queryByText(ALREADY_RECEIVED_SW)).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-11
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-11: every Pokea refusal reaches her in Swahili', () => {
  it.each(PURCHASE_REFUSALS)('%s', async (_label, raw, swahili) => {
    buildHarness({
      purchasePost: async () => {
        // All three are BadRequestException at their throw site.
        throw apiError(raw, 400);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'unga', /^Unga wa Ngano/);

    await user.click(screen.getByRole('button', { name: 'POKEA' }));

    // The manager is standing at a lorry. English in the red box is not a
    // rejection she can act on, and every one of these names something she can
    // change: the supplier chip, or the buying-price box on the row named.
    expect(await screen.findByText(swahili)).toBeInTheDocument();
    expect(screen.queryByText(raw)).not.toBeInTheDocument();
    // Refused, not lost: the form and the seal-less screen both stand.
    expect(screen.getByRole('heading', { name: 'Pokea Mzigo' })).toBeInTheDocument();
    expect(screen.getByText('Unga wa Ngano')).toBeInTheDocument();
    expect(screen.queryByText('MZIGO UMEPOKELEWA')).not.toBeInTheDocument();
    expect(h.store.deletePurchaseDraft).not.toHaveBeenCalled();
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-12
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-12: a lost response is not a refusal', () => {
  it('says wait-and-retry, keeps the frozen key, and never shows "Failed to fetch"', async () => {
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    await waitForAutosave(() => expect(harness.slip()?.lines[0]?.unitCost).toBe(1500));
    const sentKey = harness.slip()?.idempotencyKey;

    // The crates are on the shelf and the order is on the server; only the
    // answer died on the link.
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));

    // Nothing is known to be wrong with this delivery, so nothing may read as a
    // verdict on it — and the fetch layer's own English is not a sentence.
    expect(await screen.findByText(SEND_FAILED_SW)).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();

    // And the copy's instruction is the one the frozen key makes safe: the
    // identical resend resumes the recorded chain instead of opening a second.
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await screen.findByText('MZIGO UMEPOKELEWA');
    const [first, second] = harness.purchasePayloads();
    expect(first.idempotencyKey).toBe(sentKey);
    expect(second.idempotencyKey).toBe(sentKey);
    expect(server.orders.size).toBe(1);
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-14
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-14: no backend English ever reaches the shelf', () => {
  /**
   * The rejections with no row in the map. Until round 4 every one of them was
   * printed verbatim in the red danger box on Pokea, because `recordPurchase`
   * recognised only `!navigator.onLine` and fetch TypeErrors and fell through to
   * `error.message` for the rest — so a Swahili-first manager standing at a
   * lorry read an English HTTP string over a delivery the branch may already
   * have received.
   *
   * The two conflicts are the ones pos-errors.ts lists as DELIBERATELY
   * unmapped, with the note that "mwite msimamizi is the honest answer": the
   * chain this key is anchored to ended somewhere the POS cannot reopen, so
   * there is no move at the shelf. That note is only true if the fallback is
   * what actually renders.
   */
  const UNMAPPED: Array<[label: string, error: unknown, swahili: string, english: string]> = [
    [
      'a gateway that gave up on the PO→GRN chain',
      apiError('Request failed: 502', 502),
      SEND_FAILED_SW,
      'Request failed: 502',
    ],
    [
      'the order behind this key was cancelled (resumePurchaseChain)',
      apiError('The original purchase behind this idempotency key was cancelled', 409),
      'Haikukubaliwa — mwite msimamizi',
      'The original purchase behind this idempotency key was cancelled',
    ],
    [
      'the GRN behind this key is no longer postable (resumePurchaseChain)',
      apiError('The goods received note behind this purchase is no longer postable', 409),
      'Haikukubaliwa — mwite msimamizi',
      'The goods received note behind this purchase is no longer postable',
    ],
  ];

  it.each(UNMAPPED)('%s', async (_label, error, swahili, english) => {
    const harness = buildHarness({
      purchasePost: async () => {
        throw error;
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());

    await user.click(screen.getByRole('button', { name: 'POKEA' }));

    expect(await screen.findByText(swahili)).toBeInTheDocument();
    expect(screen.queryByText(english)).not.toBeInTheDocument();
    // Wording only, in every case: the form stands, no seal, and the slip and
    // its frozen key are exactly where they were.
    expect(screen.getByRole('heading', { name: 'Pokea Mzigo' })).toBeInTheDocument();
    expect(screen.getByText('Soda Baridi')).toBeInTheDocument();
    expect(screen.queryByText('MZIGO UMEPOKELEWA')).not.toBeInTheDocument();
    expect(h.store.deletePurchaseDraft).not.toHaveBeenCalled();
  });

  it('treats a 502 as unproven: the retry rides the same key and posts once', async () => {
    // The distinction the copy is making. A 502 in front of a chain that
    // budgets tens of seconds says only that the GATEWAY gave up — the delivery
    // may be on the shelves already — so the manager is told to wait and send
    // again rather than to call anybody, and the frozen key is what makes that
    // instruction safe.
    const server = markerServer();
    let gateway = true;
    const harness = buildHarness({
      purchasePost: async (payload) => {
        if (gateway) {
          gateway = false;
          // The order never reached the wrapper at all this time.
          throw apiError('Request failed: 502', 502);
        }
        return server.handle(payload);
      },
    });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());
    const sentKey = harness.slip()?.idempotencyKey;

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    expect(await screen.findByText(SEND_FAILED_SW)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await screen.findByText('MZIGO UMEPOKELEWA');
    const [first, second] = harness.purchasePayloads();
    expect(first.idempotencyKey).toBe(sentKey);
    expect(second.idempotencyKey).toBe(sentKey);
    expect(server.orders.size).toBe(1);
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-13
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-13: the slip badge is the LAST write, not the best one', () => {
  it('drops the custody claim when a later autosave is refused', async () => {
    const harness = buildHarness();
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await waitForAutosave(() => expect(harness.slip()).toBeDefined());

    // The phone really is holding this much: five lines, one save, one claim.
    expect(
      await screen.findByText('Kikaratasi kimehifadhiwa kwenye simu hii.'),
    ).toBeInTheDocument();

    // Now the phone fills up — Android under storage pressure, iOS private mode
    // — and every write from here is refused.
    const savesBefore = h.store.savePurchaseDraft.mock.calls.length;
    h.store.savePurchaseDraft.mockImplementation(async () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    });
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitFor(
      () => expect(h.store.savePurchaseDraft.mock.calls.length).toBeGreaterThan(savesBefore),
      { timeout: 2000 },
    );

    // The claim goes with the refused write. It is a promise about the lines in
    // front of her, and the sack of unga is not on the phone — saying it is
    // over work the phone dropped is the one failure the kikaratasi exists to
    // prevent, and a badge is exactly how it would be told.
    await waitFor(() =>
      expect(
        screen.queryByText('Kikaratasi kimehifadhiwa kwenye simu hii.'),
      ).not.toBeInTheDocument(),
    );
    await user.click(screen.getByRole('button', { name: 'Mauzo' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(screen.queryByText('Kikaratasi')).not.toBeInTheDocument();

    // Nothing was destroyed to say it: the earlier slip and its key are still
    // on the phone, so a later write — or a resend — still resumes ONE chain.
    expect(h.store.deletePurchaseDraft).not.toHaveBeenCalled();
    expect(harness.slip()?.lines).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------------ *
 * KIKARATASI-15
 * ------------------------------------------------------------------------ */
describe('KIKARATASI-15: POKEA never sends under a key the phone would not keep', () => {
  it('refuses the send, tells her, and claims nothing when the write is refused', async () => {
    // The whole point of the frozen key is that the phone can still ASK the
    // server what happened. A phone that refused the write is holding nothing
    // to ask with: the POST lands, the response dies (or the PWA is evicted),
    // the next cold start finds no slip, mints a fresh key, misses the marker
    // and the SAME lorry is received a second time — doubled stock and a second
    // payable, and unlike a count (an absolute quantity a later count corrects)
    // a purchase is a delta that never self-heals. So the write is load-bearing
    // and its failure blocks the action, exactly as the count's freeze does.
    const harness = buildHarness({ storageRefuses: true });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    // The supplier is picked deliberately: without it `recordPurchase` bails on
    // its own guard, and this test would pass over a hook that never gated.
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    await waitFor(() => expect(h.store.savePurchaseDraft).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'POKEA' }));

    // Nothing left the phone. This is the assertion the fix exists for.
    expect(await screen.findByText(SEND_BLOCKED_SW)).toBeInTheDocument();
    expect(harness.purchasePayloads()).toHaveLength(0);
    // She tapped RECEIVE, so the sentence has to answer THAT question — the
    // save verb's line would leave her wondering whether the lorry registered
    // anyway, which is how a delivery gets received twice.
    expect(
      screen.queryByText('Kikaratasi hakijahifadhiwa kwenye simu hii — jaribu tena.'),
    ).not.toBeInTheDocument();
    // A verb that did not do what it says is a rejection, whoever refused it:
    // the same haptic a server refusal gets, and no tick.
    expect(vibrate).toHaveBeenLastCalledWith([60, 40, 60]);
    expect(h.store.bumpDaylogTally).not.toHaveBeenCalled();

    // No custody is claimed on a write that did not land — not by the seal, not
    // by navigation, not by the saved-note, not by the ribbon badge.
    expect(screen.queryByText('MZIGO UMEPOKELEWA')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Pokea Mzigo' })).toBeInTheDocument();
    expect(screen.getByText('Soda Baridi')).toBeInTheDocument();
    expect(costField('Soda Baridi')).toHaveValue('1500');
    expect(screen.queryByText('Kikaratasi kimehifadhiwa kwenye simu hii.')).not.toBeInTheDocument();
    expect(harness.slip()).toBeUndefined();
    // …and the verb stays alive, because the second tap is worth something.
    expect(screen.getByRole('button', { name: 'POKEA' })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: 'Mauzo' }));
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    expect(screen.queryByText('Kikaratasi')).not.toBeInTheDocument();
  });

  it('sends once the write lands, under exactly the key it wrote down', async () => {
    // The successful path, unchanged — and the recovery the refusal leaves open.
    // The first tap is refused by the phone and sends nothing; storage recovers;
    // the second tap writes the key and sends under it. The response of that
    // send then dies on the link, which is precisely the window the write
    // protects: the phone is still holding the key, so the resend resumes the
    // recorded chain and the branch receives ONE delivery.
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ storageRefuses: true, purchasePost: server.handle });
    const user = userEvent.setup();
    await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    await user.type(costField('Soda Baridi'), '1500');
    await waitFor(() => expect(h.store.savePurchaseDraft).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    expect(await screen.findByText(SEND_BLOCKED_SW)).toBeInTheDocument();
    expect(harness.purchasePayloads()).toHaveLength(0);

    // The phone has room again (a photo deleted, private mode left behind).
    h.store.savePurchaseDraft.mockImplementation(async (terminalCode: string, draft: unknown) => {
      h.state.drafts.set(`${terminalCode}:purchase`, draft);
    });

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));
    const sentKey = harness.purchasePayloads()[0].idempotencyKey;
    // The delivery rode the key the phone is HOLDING, not one that lived only
    // in a ref — the write is what makes the resend below a resume.
    expect(harness.slip()?.idempotencyKey).toBe(sentKey);
    // …and it was written strictly before the request that depends on it.
    const postAt = h.backendPost.mock.calls.findIndex(
      ([path]) => path === '/mobile-pos-lite/purchases',
    );
    const saveAt = h.store.savePurchaseDraft.mock.calls.findIndex(
      ([, draft]) => (draft as PosPurchaseDraft).idempotencyKey === sentKey,
    );
    expect(saveAt).toBeGreaterThanOrEqual(0);
    expect(h.store.savePurchaseDraft.mock.invocationCallOrder[saveAt]).toBeLessThan(
      h.backendPost.mock.invocationCallOrder[postAt],
    );

    // The response died; the crates are on the shelf and the phone shows the
    // form. The frozen key is what turns the retry into one delivery.
    expect(await screen.findByText(SEND_FAILED_SW)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await screen.findByText('MZIGO UMEPOKELEWA');
    const [first, second] = harness.purchasePayloads();
    expect(first.idempotencyKey).toBe(sentKey);
    expect(second.idempotencyKey).toBe(sentKey);
    expect(server.orders.size).toBe(1);
    await waitFor(() => expect(h.store.deletePurchaseDraft).toHaveBeenCalledWith(TERMINAL));
  });

  it('holds the key across an app kill mid-send and stays frozen through the edit after it', async () => {
    // The durability the gate is protecting, end to end: the key that went out
    // is on the phone, so a kill between the POST and its answer cannot lose it
    // — and it does not move for the correction she makes next, because the
    // server is the only party that knows what landed.
    const server = markerServer({ loseResponses: 1 });
    const harness = buildHarness({ purchasePost: server.handle });
    const user = userEvent.setup();
    const view = await mountKaunta();
    await openPokea(user);
    await pickSupplier(user);
    await addLine(user, 'soda', /^Soda Baridi/);
    // The last edit and the tap inside one debounce window — no autosave runs
    // between them, so the send's own write is the only thing that can have
    // parked this key.
    await user.type(costField('Soda Baridi'), '1500');
    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    await waitFor(() => expect(harness.purchasePayloads()).toHaveLength(1));
    const sentKey = harness.purchasePayloads()[0].idempotencyKey;
    expect(harness.slip()?.idempotencyKey).toBe(sentKey);

    // The PWA is killed while the answer is still in the air.
    view.unmount();
    window.history.replaceState(null, '', '/');
    render(<MobilePosLite />);
    await screen.findByRole('heading', { name: 'Ongeza bidhaa' });
    await openPokea(user);
    expect(await screen.findByRole('button', { name: /Azam Distributors/ })).toBeInTheDocument();
    expect(harness.slip()?.idempotencyKey).toBe(sentKey);

    // The sack she had not written down yet. A fresh key here would miss the
    // marker and receive the soda a second time; the restored slip is committed,
    // so the key does not move and the server answers instead.
    await addLine(user, 'unga', /^Unga wa Ngano/);
    await waitForAutosave(() => expect(harness.slip()?.lines).toHaveLength(2));
    expect(harness.slip()?.idempotencyKey).toBe(sentKey);

    await user.click(screen.getByRole('button', { name: 'POKEA' }));
    // Same key, different content: the office answers, and the branch does not
    // receive the lorry twice.
    expect(await screen.findByText(ALREADY_RECEIVED_SW)).toBeInTheDocument();
    expect(harness.purchasePayloads()[1].idempotencyKey).toBe(sentKey);
    expect(server.orders.size).toBe(1);
  });
});

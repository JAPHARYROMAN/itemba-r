import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bumpDaylogTally,
  clearCountDraft,
  deletePurchaseDraft,
  getDaylogEntry,
  missingRequiredStores,
  openDatabase,
  posDaylogDate,
  readCachedStock,
  readCountDraft,
  readPurchaseDraft,
  savePurchaseDraft,
  sweepOrphanDrafts,
  writeCachedStock,
  writeCountDraft,
  writeDaylogSent,
  type PosCountDraft,
  type PosPurchaseDraft,
  type PosStockSnapshot,
} from './mobile-pos-lite-store';

// v4 schema (the single Kaunta migration): stocks/drafts/daylog join the
// original five. Order mirrors REQUIRED_STORES in the module.
const ALL_STORES = [
  'bindings',
  'catalogs',
  'outbox',
  'sessions',
  'frequents',
  'stocks',
  'drafts',
  'daylog',
];

/** DOMStringList-shaped fake for the pure store-completeness check. */
function nameList(present: string[]) {
  return { contains: (name: string) => present.includes(name) };
}

/**
 * Scripted stand-in for IndexedDB's open flow. The repo has no IndexedDB shim
 * (and adding npm deps is off-policy), so this fake implements exactly the
 * surface `openDatabase()` touches: async request settlement via microtasks,
 * version adoption on version-less opens, `onupgradeneeded` on version bumps,
 * and VersionError when a pinned open requests less than the current version.
 * For the v4 daylog helpers it additionally fakes the ONE-request-per-
 * transaction store surface the module uses (get/put/delete/getAllKeys) over
 * a harness-level data map that survives reopen cycles, mirroring how the
 * real module opens a fresh short-lived connection per operation.
 */
type FakeState = { version: number; stores: string[] };

type FakeConnection = {
  version: number;
  objectStoreNames: { contains: (name: string) => boolean };
  close: ReturnType<typeof vi.fn>;
  onversionchange: null | (() => void);
  createObjectStore: (name: string) => { createIndex: ReturnType<typeof vi.fn> };
  transaction: (name: string, mode: IDBTransactionMode) => { objectStore: (n: string) => unknown };
};

class FakeOpenRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  result: unknown = undefined;
  error: unknown = null;
}

class FakeRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  result: unknown = undefined;
  error: unknown = null;
}

/** Settle a store-level request through a microtask, like the open flow. */
function makeRequest(action: () => unknown): FakeRequest {
  const request = new FakeRequest();
  queueMicrotask(() => {
    try {
      request.result = action();
      request.onsuccess?.();
    } catch (error) {
      request.error = error;
      request.onerror?.();
    }
  });
  return request;
}

function makeFactory(
  initial: FakeState | null,
  options: {
    /** Another (newer) shell wins the upgrade race: state jumps here whenever a versioned open arrives. */
    simulateExternalUpgrade?: FakeState;
    /** Versioned opens fail outright with this error object. */
    versionedError?: { name: string; message: string };
    /** `createObjectStore` silently creates nothing (storage genuinely broken). */
    brokenCreate?: boolean;
  } = {},
) {
  let state = initial;
  const opens: Array<number | undefined> = [];
  const connections: FakeConnection[] = [];
  // Store contents live OUTSIDE `state` so they survive the upgrade dance's
  // state swaps — like real IndexedDB data surviving a version bump.
  const data = new Map<string, Map<IDBValidKey, unknown>>();
  const tableFor = (name: string) => {
    const existing = data.get(name);
    if (existing) return existing;
    const created = new Map<IDBValidKey, unknown>();
    data.set(name, created);
    return created;
  };

  const makeConnection = (current: FakeState): FakeConnection => {
    const connection: FakeConnection = {
      version: current.version,
      objectStoreNames: { contains: (name) => current.stores.includes(name) },
      close: vi.fn(),
      onversionchange: null,
      createObjectStore: (name) => {
        if (!options.brokenCreate) current.stores.push(name);
        return { createIndex: vi.fn() };
      },
      transaction: (name) => ({
        objectStore: (storeName: string) => ({
          get: (key: IDBValidKey) => makeRequest(() => tableFor(storeName).get(key)),
          put: (value: unknown, key: IDBValidKey) =>
            makeRequest(() => {
              tableFor(storeName).set(key, value);
              return key;
            }),
          delete: (key: IDBValidKey) =>
            makeRequest(() => {
              tableFor(storeName).delete(key);
            }),
          getAllKeys: () => makeRequest(() => [...tableFor(storeName).keys()]),
        }),
      }),
    };
    connections.push(connection);
    return connection;
  };

  const factory = {
    open: (_name: string, version?: number) => {
      opens.push(version);
      const request = new FakeOpenRequest();
      queueMicrotask(() => {
        if (version === undefined) {
          // Version-less open adopts whatever exists, creating an EMPTY v1
          // database when nothing does (per spec, without an upgrade handler
          // no stores are created).
          if (!state) state = { version: 1, stores: [] };
          request.result = makeConnection(state);
          request.onsuccess?.();
          return;
        }
        if (options.versionedError) {
          request.error = options.versionedError;
          request.onerror?.();
          return;
        }
        if (options.simulateExternalUpgrade) state = options.simulateExternalUpgrade;
        if (state && version < state.version) {
          request.error = { name: 'VersionError', message: `${version} < ${state.version}` };
          request.onerror?.();
          return;
        }
        if (!state || version > state.version) {
          state = { version, stores: [...(state?.stores ?? [])] };
          request.result = makeConnection(state);
          request.onupgradeneeded?.();
          request.onsuccess?.();
          return;
        }
        request.result = makeConnection(state);
        request.onsuccess?.();
      });
      return request as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;

  return {
    factory,
    opens,
    connections,
    data,
    get state() {
      return state;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('missingRequiredStores', () => {
  it('returns empty when every required store exists', () => {
    expect(missingRequiredStores(nameList(ALL_STORES))).toEqual([]);
  });

  it('lists every required store for an empty database', () => {
    expect(missingRequiredStores(nameList([]))).toEqual(ALL_STORES);
  });

  it('lists only the absent stores', () => {
    expect(missingRequiredStores(nameList(['bindings', 'outbox']))).toEqual([
      'catalogs',
      'sessions',
      'frequents',
      'stocks',
      'drafts',
      'daylog',
    ]);
  });

  it('ignores extra stores from a newer schema', () => {
    expect(missingRequiredStores(nameList([...ALL_STORES, 'v5-future-store']))).toEqual([]);
  });
});

describe('openDatabase', () => {
  it('adopts a complete same-version database with a single version-less open', async () => {
    const harness = makeFactory({ version: 4, stores: [...ALL_STORES] });
    const database = await openDatabase(harness.factory);
    expect(harness.opens).toEqual([undefined]);
    expect(database.objectStoreNames.contains('outbox')).toBe(true);
  });

  it('adopts a NEWER database without any versioned open (old shell after upgrade or rollback)', async () => {
    const harness = makeFactory({ version: 5, stores: [...ALL_STORES, 'v5-future-store'] });
    const database = await openDatabase(harness.factory);
    // The old code (DB_VERSION 4) must never pin a version against the v5
    // database — that would throw VersionError and dead-end the POS.
    expect(harness.opens).toEqual([undefined]);
    expect(database.version).toBe(5);
  });

  it('creates the schema on a fresh install via probe, versioned reopen, re-probe', async () => {
    const harness = makeFactory(null);
    const database = await openDatabase(harness.factory);
    expect(harness.opens).toEqual([undefined, 4, undefined]);
    expect(harness.state).toMatchObject({ version: 4 });
    expect(harness.state?.stores).toEqual(ALL_STORES);
    // The incomplete probe connection was closed before the upgrade.
    expect(harness.connections[0].close).toHaveBeenCalled();
    expect(database.objectStoreNames.contains('frequents')).toBe(true);
    expect(database.objectStoreNames.contains('daylog')).toBe(true);
  });

  it('upgrades a database created by an older shell, adding only the missing stores', async () => {
    const harness = makeFactory({ version: 3, stores: ['bindings', 'catalogs', 'outbox'] });
    await openDatabase(harness.factory);
    expect(harness.opens).toEqual([undefined, 4, undefined]);
    expect(harness.state?.stores).toEqual([
      'bindings',
      'catalogs',
      'outbox',
      'sessions',
      'frequents',
      'stocks',
      'drafts',
      'daylog',
    ]);
  });

  it('recovers when a newer shell wins the upgrade race (VersionError, then re-adopt)', async () => {
    const harness = makeFactory(
      { version: 2, stores: ['bindings'] },
      { simulateExternalUpgrade: { version: 5, stores: [...ALL_STORES, 'v5-future-store'] } },
    );
    const database = await openDatabase(harness.factory);
    expect(database.version).toBe(5);
    expect(database.objectStoreNames.contains('sessions')).toBe(true);
  });

  it('propagates non-VersionError upgrade failures', async () => {
    const harness = makeFactory(
      { version: 2, stores: [] },
      { versionedError: { name: 'QuotaExceededError', message: 'disk full' } },
    );
    await expect(openDatabase(harness.factory)).rejects.toMatchObject({
      name: 'QuotaExceededError',
    });
  });

  it('rejects naming the stores when the upgrade cannot create them', async () => {
    const harness = makeFactory({ version: 2, stores: ['bindings'] }, { brokenCreate: true });
    await expect(openDatabase(harness.factory)).rejects.toThrow(
      /missing required store\(s\) after upgrade: catalogs, outbox, sessions, frequents, stocks, drafts, daylog/,
    );
  });

  it('shares one upgrade between concurrent opens (memoized in-flight dance)', async () => {
    const harness = makeFactory(null);
    const [first, second] = await Promise.all([
      openDatabase(harness.factory),
      openDatabase(harness.factory),
    ]);
    const versionedOpens = harness.opens.filter((version) => version !== undefined);
    expect(versionedOpens).toEqual([4]);
    expect(first.objectStoreNames.contains('outbox')).toBe(true);
    expect(second.objectStoreNames.contains('outbox')).toBe(true);
  });

  it('self-closes the connection when a newer shell signals versionchange', async () => {
    const harness = makeFactory({ version: 4, stores: [...ALL_STORES] });
    const database = await openDatabase(harness.factory);
    // openDatabase must install the handler that keeps future upgrades from
    // hanging on connections this shell still holds.
    expect(typeof database.onversionchange).toBe('function');
    (database.onversionchange as () => void)();
    const connection = harness.connections[0];
    expect(connection.close).toHaveBeenCalled();
  });

  it('rejects clearly when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expect(openDatabase()).rejects.toThrow('IndexedDB is not available in this environment');
  });
});

/* ------------------------------------------------------------------------ *
 * Daylog (v4): round-trip, create-if-missing, tally/sent independence,
 * shared-phone snapshot shape, and the 7-day per-terminal prune.
 * ------------------------------------------------------------------------ */
describe('daylog', () => {
  const TERMINAL = 'T-001';
  const TODAY = new Date('2026-08-12T12:00:00');

  /** Fresh v4 database + fake clock; helpers use the global indexedDB. */
  function daylogHarness() {
    const harness = makeFactory({ version: 4, stores: [...ALL_STORES] });
    vi.stubGlobal('indexedDB', harness.factory);
    vi.useFakeTimers({ toFake: ['Date'], now: TODAY });
    return harness;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats the device-local day key as YYYY-MM-DD', () => {
    expect(posDaylogDate(new Date('2026-08-12T23:59:00'))).toBe('2026-08-12');
    expect(posDaylogDate(new Date('2026-01-05T00:00:01'))).toBe('2026-01-05');
  });

  it('returns null for a day with no entry', async () => {
    daylogHarness();
    expect(await getDaylogEntry(TERMINAL, '2026-08-12')).toBeNull();
  });

  it('bumpDaylogTally creates today with tally 1, then increments — full round-trip', async () => {
    daylogHarness();
    await bumpDaylogTally(TERMINAL);
    await bumpDaylogTally(TERMINAL);
    const entry = await getDaylogEntry(TERMINAL, '2026-08-12');
    expect(entry).toEqual({ terminalCode: TERMINAL, date: '2026-08-12', tallyCount: 2 });
  });

  it('writeDaylogSent upserts the snapshot without touching the tally', async () => {
    daylogHarness();
    await bumpDaylogTally(TERMINAL);
    const sent = { repId: 'r1', count: 4, totalAmount: 9500, fetchedAt: TODAY.getTime() };
    await writeDaylogSent(TERMINAL, '2026-08-12', sent);
    expect(await getDaylogEntry(TERMINAL, '2026-08-12')).toEqual({
      terminalCode: TERMINAL,
      date: '2026-08-12',
      tallyCount: 1,
      sent,
    });

    // A later fetch replaces the snapshot wholesale (server truth wins).
    const fresher = { repId: 'r1', count: 5, totalAmount: 11000, fetchedAt: TODAY.getTime() + 60 };
    await writeDaylogSent(TERMINAL, '2026-08-12', fresher);
    expect((await getDaylogEntry(TERMINAL, '2026-08-12'))?.sent).toEqual(fresher);
  });

  it('writeDaylogSent creates the row (tally 0) when no stamp happened yet today', async () => {
    daylogHarness();
    const sent = { repId: 'r2', count: 1, totalAmount: 500, fetchedAt: TODAY.getTime() };
    await writeDaylogSent(TERMINAL, '2026-08-12', sent);
    expect(await getDaylogEntry(TERMINAL, '2026-08-12')).toEqual({
      terminalCode: TERMINAL,
      date: '2026-08-12',
      tallyCount: 0,
      sent,
    });
  });

  it('prunes THIS terminal’s rows older than 7 days on tally writes, keeping the boundary day and other terminals', async () => {
    const harness = daylogHarness();
    const sent = { repId: 'r1', count: 1, totalAmount: 100, fetchedAt: TODAY.getTime() };
    // Today is 2026-08-12, so the cutoff day is 2026-08-05 (kept) and anything
    // strictly older goes.
    await writeDaylogSent(TERMINAL, '2026-08-01', sent);
    await writeDaylogSent(TERMINAL, '2026-08-04', sent);
    await writeDaylogSent(TERMINAL, '2026-08-05', sent);
    await writeDaylogSent('T-OTHER', '2026-08-01', sent);

    await bumpDaylogTally(TERMINAL);

    const keys = [...(harness.data.get('daylog')?.keys() ?? [])];
    expect(keys).not.toContain(`${TERMINAL}:2026-08-01`);
    expect(keys).not.toContain(`${TERMINAL}:2026-08-04`);
    expect(keys).toContain(`${TERMINAL}:2026-08-05`);
    expect(keys).toContain(`${TERMINAL}:2026-08-12`);
    // Another terminal's rows age out through its OWN writes, never ours.
    expect(keys).toContain('T-OTHER:2026-08-01');
  });
});

/* ------------------------------------------------------------------------ *
 * Stocks (v4, Phase 4): the Stoo branch-stock snapshot — keyed by
 * terminalCode (out-of-line), one snapshot per terminal, overwrite wholesale.
 * ------------------------------------------------------------------------ */
describe('stocks', () => {
  /** Fresh v4 database over the same scripted IndexedDB fake. */
  function stocksHarness() {
    const harness = makeFactory({ version: 4, stores: [...ALL_STORES] });
    vi.stubGlobal('indexedDB', harness.factory);
    return harness;
  }

  function makeSnapshot(overrides: Partial<PosStockSnapshot> = {}): PosStockSnapshot {
    return {
      asOf: '2026-08-12T09:00:00.000Z',
      fetchedAt: 1_786_500_000_000,
      items: [
        {
          productId: 'p1',
          name: 'Maize Flour',
          code: 'MF-1',
          barcode: null,
          unitId: 'u1',
          unitSymbol: 'pc',
          imageUrl: null,
          sellingPrice: 5000,
          quantityOnHand: 7,
          quantityReserved: 2,
          available: 5,
          threshold: 10,
          status: 'LOW_STOCK',
        },
      ],
      ...overrides,
    };
  }

  it('returns null for a terminal with no cached snapshot (honest miss, never a fabricated empty)', async () => {
    stocksHarness();
    expect(await readCachedStock('T-001')).toBeNull();
  });

  it('round-trips a snapshot per terminalCode', async () => {
    stocksHarness();
    const snapshot = makeSnapshot();
    await writeCachedStock('T-001', snapshot);
    expect(await readCachedStock('T-001')).toEqual(snapshot);
    // Keys are per-terminal: another terminal still misses.
    expect(await readCachedStock('T-OTHER')).toBeNull();
  });

  it('overwrites the previous snapshot wholesale on every write', async () => {
    stocksHarness();
    await writeCachedStock('T-001', makeSnapshot());
    const fresher = makeSnapshot({
      asOf: '2026-08-12T10:00:00.000Z',
      fetchedAt: 1_786_500_060_000,
      items: [],
    });
    await writeCachedStock('T-001', fresher);
    expect(await readCachedStock('T-001')).toEqual(fresher);
  });
});

/* ------------------------------------------------------------------------ *
 * Drafts (v4, Phase 5): the Hesabu count sheet — keyed `${terminalCode}:count`
 * (out-of-line), one draft per module per terminal, plus the boot-time orphan
 * sweep for drafts a re-coded terminal left behind.
 * ------------------------------------------------------------------------ */
describe('count drafts', () => {
  /** Fresh v4 database over the same scripted IndexedDB fake. */
  function draftsHarness() {
    const harness = makeFactory({ version: 4, stores: [...ALL_STORES] });
    vi.stubGlobal('indexedDB', harness.factory);
    return harness;
  }

  function makeDraft(overrides: Partial<PosCountDraft> = {}): PosCountDraft {
    return {
      type: 'count',
      lines: { 'p-soda': 12, 'p-unga': 0 },
      capturedAt: 1_786_500_000_000,
      updatedAt: 1_786_500_060_000,
      ...overrides,
    };
  }

  it('returns null for a terminal with no draft', async () => {
    draftsHarness();
    expect(await readCountDraft('T-001')).toBeNull();
  });

  it('round-trips under the terminal-scoped count key, keeping 0 distinct from absent', async () => {
    const harness = draftsHarness();
    await writeCountDraft('T-001', makeDraft());
    const stored = await readCountDraft('T-001');
    // 0 is a counted line ("the shelf was empty"); a not-counted product has
    // no key at all. Collapsing the two would post a phantom variance.
    expect(stored?.lines).toEqual({ 'p-soda': 12, 'p-unga': 0 });
    expect(stored?.lines).not.toHaveProperty('p-chumvi');
    expect([...(harness.data.get('drafts')?.keys() ?? [])]).toEqual(['T-001:count']);
    // The key is per-terminal: another terminal still misses.
    expect(await readCountDraft('T-OTHER')).toBeNull();
  });

  it('overwrites the sheet wholesale on every autosave', async () => {
    draftsHarness();
    await writeCountDraft('T-001', makeDraft());
    const later = makeDraft({ lines: { 'p-soda': 3 }, updatedAt: 1_786_500_120_000 });
    await writeCountDraft('T-001', later);
    expect(await readCountDraft('T-001')).toEqual(later);
  });

  it('carries the product names beside the quantities, the way the kikaratasi does', async () => {
    // A resumed sheet outlives the snapshot it was typed against. Without a
    // name of its own, a line whose product has since left the stoo can only
    // be shown as a raw productId — and removing it (§7 case 5) is the one
    // thing the manager must be able to do, on a line she cannot recognise.
    draftsHarness();
    await writeCountDraft(
      'T-001',
      makeDraft({ names: { 'p-soda': 'Soda Baridi', 'p-unga': 'Unga wa Ngano' } }),
    );
    expect((await readCountDraft('T-001'))?.names).toEqual({
      'p-soda': 'Soda Baridi',
      'p-unga': 'Unga wa Ngano',
    });
  });

  it('carries the frozen idempotency key, the way the kikaratasi does', async () => {
    // The load-bearing field. It is written by the FIRST send attempt and must
    // survive app kill, eviction and cold start, because that is exactly the
    // window in which a lost response has to be answered: the same key resumes
    // the server's `[MPL-COUNT:<key>]` chain, while a fresh one re-posts the
    // sheet's ABSOLUTE quantities over a baseline that has moved since —
    // inventing stock that was sold in between, on a second adjustment nothing
    // links to the first.
    draftsHarness();
    await writeCountDraft('T-001', makeDraft({ idempotencyKey: 'abcdef0123456789' }));
    expect((await readCountDraft('T-001'))?.idempotencyKey).toBe('abcdef0123456789');
  });

  it('still loads a draft written before the name snapshot or the key existed', async () => {
    // Both fields are additive by contract: every phone in the field already
    // holds sheets without them, and a resume that threw those away would cost
    // exactly the overnight count the draft exists to protect. A draft with no
    // key simply carries no send attempt to resume, which is the truth about it.
    draftsHarness();
    // Byte-identical to what the pre-change autosave wrote: no `names` key and
    // no `idempotencyKey`. It must type-check (both are optional) and read back
    // whole.
    const legacy = {
      type: 'count',
      lines: { 'p-soda': 12 },
      capturedAt: 1_786_500_000_000,
      updatedAt: 1_786_500_000_000,
    } satisfies PosCountDraft;
    await writeCountDraft('T-001', legacy);

    const stored = await readCountDraft('T-001');
    expect(stored).toEqual(legacy);
    expect(stored?.names).toBeUndefined();
    expect(stored?.idempotencyKey).toBeUndefined();
  });

  it('clearCountDraft removes only that terminal’s count draft', async () => {
    draftsHarness();
    await writeCountDraft('T-001', makeDraft());
    await writeCountDraft('T-OTHER', makeDraft());
    await clearCountDraft('T-001');
    expect(await readCountDraft('T-001')).toBeNull();
    expect(await readCountDraft('T-OTHER')).not.toBeNull();
  });

  it('sweeps drafts belonging to any other terminal code, keeping every draft of the active one', async () => {
    const harness = draftsHarness();
    await writeCountDraft('T-001', makeDraft());
    await writeCountDraft('T-OLD', makeDraft());
    // The kikaratasi's reserved key shares the store; the sweep is by
    // terminal prefix, never by module.
    harness.data.get('drafts')?.set('T-001:purchase', { type: 'purchase' });
    harness.data.get('drafts')?.set('T-OLD:purchase', { type: 'purchase' });

    expect(await sweepOrphanDrafts('T-001')).toEqual(['T-OLD:count', 'T-OLD:purchase']);
    expect([...(harness.data.get('drafts')?.keys() ?? [])]).toEqual([
      'T-001:count',
      'T-001:purchase',
    ]);
  });

  it('sweeps nothing when every draft belongs to the active terminal', async () => {
    draftsHarness();
    await writeCountDraft('T-001', makeDraft());
    expect(await sweepOrphanDrafts('T-001')).toEqual([]);
    expect(await readCountDraft('T-001')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------------ *
 * Drafts (v4, Phase 5): the Manunuzi kikaratasi — the count sheet's sibling
 * on the same store under `${terminalCode}:purchase`, carrying the frozen
 * idempotency key that keeps one lost response from becoming two deliveries.
 * ------------------------------------------------------------------------ */
describe('purchase drafts', () => {
  /** Fresh v4 database over the same scripted IndexedDB fake. */
  function draftsHarness() {
    const harness = makeFactory({ version: 4, stores: [...ALL_STORES] });
    vi.stubGlobal('indexedDB', harness.factory);
    return harness;
  }

  function makeSlip(overrides: Partial<PosPurchaseDraft> = {}): PosPurchaseDraft {
    return {
      type: 'purchase',
      terminalCode: 'T-001',
      idempotencyKey: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
      supplierId: 's-1',
      supplierName: 'Azam Distributors',
      lines: [
        {
          productId: 'p-soda',
          name: 'Soda Baridi',
          unitSymbol: 'pc',
          quantity: 24,
          unitCost: 1500,
        },
        { productId: 'p-unga', name: 'Unga wa Ngano', unitSymbol: 'kg', quantity: 3 },
      ],
      savedAt: 1_786_500_000_000,
      ...overrides,
    };
  }

  it('returns null for a terminal with no slip', async () => {
    draftsHarness();
    expect(await readPurchaseDraft('T-001')).toBeNull();
  });

  it('round-trips under the terminal-scoped purchase key, beside the count sheet', async () => {
    const harness = draftsHarness();
    await writeCountDraft('T-001', { type: 'count', lines: {}, capturedAt: 1, updatedAt: 1 });
    await savePurchaseDraft('T-001', makeSlip());

    const stored = await readPurchaseDraft('T-001');
    expect(stored).toEqual(makeSlip());
    // A line with no typed cost carries no unitCost at all — the server
    // resolves the fallback, and a 0 must never be sent (§8 case 5).
    expect(stored?.lines[1]).not.toHaveProperty('unitCost');
    // One draft per module per terminal, enforced by the two fixed keys.
    expect([...(harness.data.get('drafts')?.keys() ?? [])]).toEqual([
      'T-001:count',
      'T-001:purchase',
    ]);
    expect(await readPurchaseDraft('T-OTHER')).toBeNull();
  });

  it('overwrites the slip wholesale on every autosave, key included', async () => {
    draftsHarness();
    await savePurchaseDraft('T-001', makeSlip());
    const later = makeSlip({ lines: [], supplierId: null, supplierName: null, savedAt: 2 });
    await savePurchaseDraft('T-001', later);
    expect(await readPurchaseDraft('T-001')).toEqual(later);
  });

  it('deletePurchaseDraft removes only that terminal’s slip, never its count sheet', async () => {
    draftsHarness();
    await savePurchaseDraft('T-001', makeSlip());
    await savePurchaseDraft('T-OTHER', makeSlip({ terminalCode: 'T-OTHER' }));
    await writeCountDraft('T-001', {
      type: 'count',
      lines: { 'p-soda': 2 },
      capturedAt: 1,
      updatedAt: 1,
    });

    await deletePurchaseDraft('T-001');
    expect(await readPurchaseDraft('T-001')).toBeNull();
    expect(await readCountDraft('T-001')).not.toBeNull();
    expect(await readPurchaseDraft('T-OTHER')).not.toBeNull();
  });

  it('the orphan sweep takes a re-coded terminal’s slip with it (§8 case 7)', async () => {
    draftsHarness();
    await savePurchaseDraft('T-001', makeSlip());
    await savePurchaseDraft('T-OLD', makeSlip({ terminalCode: 'T-OLD' }));

    expect(await sweepOrphanDrafts('T-001')).toEqual(['T-OLD:purchase']);
    expect(await readPurchaseDraft('T-OLD')).toBeNull();
    // The active terminal's slip survives a binding reset by design.
    expect(await readPurchaseDraft('T-001')).not.toBeNull();
  });
});

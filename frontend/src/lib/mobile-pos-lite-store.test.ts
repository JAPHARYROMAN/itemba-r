import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  bumpDaylogTally,
  getDaylogEntry,
  missingRequiredStores,
  openDatabase,
  posDaylogDate,
  writeDaylogSent,
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

import { afterEach, describe, expect, it, vi } from 'vitest';
import { missingRequiredStores, openDatabase } from './mobile-pos-lite-store';

const ALL_STORES = ['bindings', 'catalogs', 'outbox', 'sessions', 'frequents'];

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
 * `transaction()` itself is NOT faked — real transaction semantics need a
 * browser — so those paths stay covered by defensive code + comments only.
 */
type FakeState = { version: number; stores: string[] };

type FakeConnection = {
  version: number;
  objectStoreNames: { contains: (name: string) => boolean };
  close: ReturnType<typeof vi.fn>;
  onversionchange: null | (() => void);
  createObjectStore: (name: string) => { createIndex: ReturnType<typeof vi.fn> };
};

class FakeOpenRequest {
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
  result: unknown = undefined;
  error: unknown = null;
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
    ]);
  });

  it('ignores extra stores from a newer schema', () => {
    expect(missingRequiredStores(nameList([...ALL_STORES, 'stocks', 'drafts', 'daylog']))).toEqual(
      [],
    );
  });
});

describe('openDatabase', () => {
  it('adopts a complete same-version database with a single version-less open', async () => {
    const harness = makeFactory({ version: 3, stores: [...ALL_STORES] });
    const database = await openDatabase(harness.factory);
    expect(harness.opens).toEqual([undefined]);
    expect(database.objectStoreNames.contains('outbox')).toBe(true);
  });

  it('adopts a NEWER database without any versioned open (old shell after upgrade or rollback)', async () => {
    const harness = makeFactory({ version: 4, stores: [...ALL_STORES, 'stocks'] });
    const database = await openDatabase(harness.factory);
    // The old code (DB_VERSION 3) must never pin a version against the v4
    // database — that would throw VersionError and dead-end the POS.
    expect(harness.opens).toEqual([undefined]);
    expect(database.version).toBe(4);
  });

  it('creates the schema on a fresh install via probe, versioned reopen, re-probe', async () => {
    const harness = makeFactory(null);
    const database = await openDatabase(harness.factory);
    expect(harness.opens).toEqual([undefined, 3, undefined]);
    expect(harness.state).toMatchObject({ version: 3 });
    expect(harness.state?.stores).toEqual(ALL_STORES);
    // The incomplete probe connection was closed before the upgrade.
    expect(harness.connections[0].close).toHaveBeenCalled();
    expect(database.objectStoreNames.contains('frequents')).toBe(true);
  });

  it('upgrades a database created by an older shell, adding only the missing stores', async () => {
    const harness = makeFactory({ version: 2, stores: ['bindings', 'catalogs', 'outbox'] });
    await openDatabase(harness.factory);
    expect(harness.opens).toEqual([undefined, 3, undefined]);
    expect(harness.state?.stores).toEqual([
      'bindings',
      'catalogs',
      'outbox',
      'sessions',
      'frequents',
    ]);
  });

  it('recovers when a newer shell wins the upgrade race (VersionError, then re-adopt)', async () => {
    const harness = makeFactory(
      { version: 2, stores: ['bindings'] },
      { simulateExternalUpgrade: { version: 4, stores: [...ALL_STORES, 'stocks'] } },
    );
    const database = await openDatabase(harness.factory);
    expect(database.version).toBe(4);
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
      /missing required store\(s\) after upgrade: catalogs, outbox, sessions, frequents/,
    );
  });

  it('shares one upgrade between concurrent opens (memoized in-flight dance)', async () => {
    const harness = makeFactory(null);
    const [first, second] = await Promise.all([
      openDatabase(harness.factory),
      openDatabase(harness.factory),
    ]);
    const versionedOpens = harness.opens.filter((version) => version !== undefined);
    expect(versionedOpens).toEqual([3]);
    expect(first.objectStoreNames.contains('outbox')).toBe(true);
    expect(second.objectStoreNames.contains('outbox')).toBe(true);
  });

  it('self-closes the connection when a newer shell signals versionchange', async () => {
    const harness = makeFactory({ version: 3, stores: [...ALL_STORES] });
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

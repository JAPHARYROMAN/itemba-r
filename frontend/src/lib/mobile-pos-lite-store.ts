export type MobilePosLiteBinding = {
  terminalCode: string;
  deviceSecret: string;
  activatedAt: string;
};

export type MobilePosLiteProduct = {
  id: string;
  name: string;
  code: string;
  barcode: string | null;
  unitId: string;
  unitSymbol: string;
  sellingPrice: number;
  availableStock: number | null;
  trackInventory: boolean;
  /** Backend-relative image path (`/products/:id/image`) — null when no photo. */
  imageUrl?: string | null;
};

export type PendingMobilePosLiteSale = {
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
  /** Display-only snapshot so the queue screen can describe the sale offline. */
  totalAmount?: number;
  itemCount?: number;
  lineSummary?: string;
};

/** Snapshot of the terminal session so the POS can open after an offline cold start. */
export type MobilePosLiteCachedSession = {
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
};

const DB_NAME = 'itemba-mobile-pos-lite';
/**
 * CURRENT schema level for this code. v4 — which adds the planned `stocks`,
 * `drafts`, and `daylog` stores — lands in a later phase as ONE migration for
 * that release (one-migration rule: each release bumps the version at most
 * once and only ADDS stores/indexes, never renames or removes them, so any
 * older cached shell still finds every store it knows about in a newer
 * database).
 */
const DB_VERSION = 3;
const BINDINGS = 'bindings';
const CATALOGS = 'catalogs';
const OUTBOX = 'outbox';
const SESSIONS = 'sessions';
const FREQUENTS = 'frequents';
const ACTIVE_BINDING = 'active';

/** Object stores this code level requires before it can serve any request. */
const REQUIRED_STORES = [BINDINGS, CATALOGS, OUTBOX, SESSIONS, FREQUENTS] as const;

/** Minimal structural view of DOMStringList so the check is unit-testable. */
type StoreNameList = { contains(name: string): boolean };

/**
 * Which of the stores this code level needs are absent from the database.
 * Pure (takes any DOMStringList-shaped input) so it is testable without a
 * real IndexedDB implementation.
 */
export function missingRequiredStores(names: StoreNameList): string[] {
  return REQUIRED_STORES.filter((store) => !names.contains(store));
}

/**
 * Additive-only schema. Every creation is `contains()`-guarded so replaying
 * it against a database of ANY older version is idempotent.
 */
function applySchema(database: IDBDatabase) {
  if (!database.objectStoreNames.contains(BINDINGS)) database.createObjectStore(BINDINGS);
  if (!database.objectStoreNames.contains(CATALOGS)) database.createObjectStore(CATALOGS);
  if (!database.objectStoreNames.contains(OUTBOX)) {
    const store = database.createObjectStore(OUTBOX, { keyPath: 'id' });
    store.createIndex('terminalCode', 'terminalCode', { unique: false });
  }
  if (!database.objectStoreNames.contains(SESSIONS)) database.createObjectStore(SESSIONS);
  if (!database.objectStoreNames.contains(FREQUENTS)) database.createObjectStore(FREQUENTS);
}

/** Wrap an open request, wiring the handlers that keep upgrades from hanging. */
function settleOpen(request: IDBOpenDBRequest, upgrade: boolean): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('Could not open Mobile POS storage'));
    request.onsuccess = () => {
      const database = request.result;
      // If a newer shell (another tab, or this tab after an update) bumps the
      // schema version while we hold this connection, close ours immediately
      // so its upgrade never hangs waiting on us.
      database.onversionchange = () => database.close();
      resolve(database);
    };
    if (upgrade) {
      request.onupgradeneeded = () => applySchema(request.result);
      // Connections in OTHER tabs block the upgrade until they close. Every
      // connection we create self-closes on versionchange (above) and each
      // `transaction()` closes its connection in `finally`, so a block always
      // drains on its own; there is nothing of ours left to force-close here.
      request.onblocked = () => undefined;
    }
  });
}

/**
 * The one in-flight schema upgrade, shared across concurrent `openDatabase()`
 * calls so parallel opens never race the close-and-reopen dance. Cleared on
 * settle (not cached forever) so a database evicted by the browser later can
 * still be healed by a fresh dance.
 */
let schemaUpgradeInFlight: Promise<void> | null = null;

function runSchemaUpgrade(factory: IDBFactory): Promise<void> {
  if (!schemaUpgradeInFlight) {
    schemaUpgradeInFlight = settleOpen(factory.open(DB_NAME, DB_VERSION), true)
      .then((database) => database.close())
      .catch((error: unknown) => {
        // VersionError: the database is ALREADY past DB_VERSION — a newer
        // shell upgraded it under us, or this is a rolled-back deploy. Under
        // the additive-only rule the newer database contains every store this
        // code level needs, so the error is benign: the caller re-adopts the
        // database version-lessly and feature-detects the stores.
        if ((error as { name?: string } | null)?.name !== 'VersionError') throw error;
      })
      .finally(() => {
        schemaUpgradeInFlight = null;
      });
  }
  return schemaUpgradeInFlight;
}

/**
 * Open the Mobile POS database, adopting WHATEVER version already exists.
 *
 * Never opens with a pinned version first: the POS shell is service-worker
 * cached with update lag, so an old shell (or a rolled-back deploy) routinely
 * runs against a database a newer shell already upgraded. A pinned
 * `open(name, olderVersion)` throws VersionError there and dead-ends the POS
 * with its data intact but unreachable. Instead:
 *
 *   1. `open(DB_NAME)` (version-less) adopts the existing version, whatever
 *      it is. Feature-detect via `objectStoreNames`; all required stores
 *      present means we are done — the steady state is exactly one open with
 *      no version pinning.
 *   2. Something missing (fresh install, or a database created by an older
 *      shell): close, run ONE shared versioned open at `DB_VERSION` whose
 *      `onupgradeneeded` applies the additive idempotent schema. A
 *      VersionError there means someone newer upgraded first — equally fine.
 *   3. Re-adopt version-lessly and re-check; if stores are STILL missing the
 *      storage is genuinely broken, so fail loudly naming the stores.
 *
 * Outwardly this preserves the original per-call semantics: every caller gets
 * its own short-lived connection and `transaction()` still closes it in
 * `finally`. Only the upgrade dance is shared (memoized while in flight).
 *
 * @param factory injectable for tests only; production uses the global.
 */
export async function openDatabase(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): Promise<IDBDatabase> {
  if (!factory) throw new Error('IndexedDB is not available in this environment');

  const adopted = await settleOpen(factory.open(DB_NAME), false);
  if (missingRequiredStores(adopted.objectStoreNames).length === 0) return adopted;
  adopted.close();

  await runSchemaUpgrade(factory);

  const upgraded = await settleOpen(factory.open(DB_NAME), false);
  const stillMissing = missingRequiredStores(upgraded.objectStoreNames);
  if (stillMissing.length === 0) return upgraded;
  upgraded.close();
  throw new Error(
    `Mobile POS storage is missing required store(s) after upgrade: ${stillMissing.join(', ')}`,
  );
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () =>
      reject(request.error ?? new Error('Mobile POS storage operation failed'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction<T>(
  storeName: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    if (!database.objectStoreNames.contains(storeName)) {
      // openDatabase() guarantees REQUIRED_STORES exist, so this only fires
      // for a store outside that list — e.g. code that shipped ahead of its
      // migration. Fail with the store's name instead of an opaque
      // NotFoundError from the transaction call.
      throw new Error(
        `Mobile POS storage has no "${storeName}" store (database is at v${database.version}); ` +
          'this build expects a newer schema than the one on this device.',
      );
    }
    const store = database.transaction(storeName, mode).objectStore(storeName);
    return await requestResult(action(store));
  } finally {
    database.close();
  }
}

export async function getMobilePosLiteBinding(): Promise<MobilePosLiteBinding | null> {
  return (
    (await transaction<MobilePosLiteBinding | undefined>(BINDINGS, 'readonly', (store) =>
      store.get(ACTIVE_BINDING),
    )) ?? null
  );
}

export async function saveMobilePosLiteBinding(binding: MobilePosLiteBinding) {
  await transaction(BINDINGS, 'readwrite', (store) => store.put(binding, ACTIVE_BINDING));
}

export async function clearMobilePosLiteBinding() {
  await transaction(BINDINGS, 'readwrite', (store) => store.delete(ACTIVE_BINDING));
}

export async function getMobilePosLiteCatalog(
  terminalCode: string,
): Promise<MobilePosLiteProduct[]> {
  const value = await transaction<{ products?: MobilePosLiteProduct[] } | undefined>(
    CATALOGS,
    'readonly',
    (store) => store.get(terminalCode),
  );
  return value?.products ?? [];
}

export async function saveMobilePosLiteCatalog(
  terminalCode: string,
  products: MobilePosLiteProduct[],
) {
  await transaction(CATALOGS, 'readwrite', (store) =>
    store.put({ products, updatedAt: new Date().toISOString() }, terminalCode),
  );
}

export async function getMobilePosLiteSession(
  terminalCode: string,
): Promise<MobilePosLiteCachedSession | null> {
  const value = await transaction<{ session?: MobilePosLiteCachedSession } | undefined>(
    SESSIONS,
    'readonly',
    (store) => store.get(terminalCode),
  );
  return value?.session ?? null;
}

export async function saveMobilePosLiteSession(
  terminalCode: string,
  session: MobilePosLiteCachedSession,
) {
  await transaction(SESSIONS, 'readwrite', (store) =>
    store.put({ session, updatedAt: new Date().toISOString() }, terminalCode),
  );
}

/**
 * Per-terminal sale counts per product, powering the quick-pick grid. The grid
 * personalizes itself to what THIS phone actually sells and works offline; no
 * backend involvement.
 */
export async function getMobilePosLiteFrequents(
  terminalCode: string,
): Promise<Record<string, number>> {
  const value = await transaction<{ counts?: Record<string, number> } | undefined>(
    FREQUENTS,
    'readonly',
    (store) => store.get(terminalCode),
  );
  return value?.counts ?? {};
}

export async function bumpMobilePosLiteFrequents(terminalCode: string, productIds: string[]) {
  const counts = await getMobilePosLiteFrequents(terminalCode);
  for (const id of productIds) counts[id] = (counts[id] ?? 0) + 1;
  await transaction(FREQUENTS, 'readwrite', (store) =>
    store.put({ counts, updatedAt: new Date().toISOString() }, terminalCode),
  );
  return counts;
}

export async function enqueueMobilePosLiteSale(sale: PendingMobilePosLiteSale) {
  await transaction(OUTBOX, 'readwrite', (store) => store.put(sale));
}

export async function getPendingMobilePosLiteSales(terminalCode: string) {
  return transaction<PendingMobilePosLiteSale[]>(OUTBOX, 'readonly', (store) =>
    store.index('terminalCode').getAll(terminalCode),
  );
}

export async function removePendingMobilePosLiteSale(id: string) {
  await transaction(OUTBOX, 'readwrite', (store) => store.delete(id));
}

export async function updatePendingMobilePosLiteSaleError(id: string, lastError: string) {
  const existing = await transaction<PendingMobilePosLiteSale | undefined>(
    OUTBOX,
    'readonly',
    (store) => store.get(id),
  );
  if (!existing) return;
  await transaction(OUTBOX, 'readwrite', (store) => store.put({ ...existing, lastError }));
}

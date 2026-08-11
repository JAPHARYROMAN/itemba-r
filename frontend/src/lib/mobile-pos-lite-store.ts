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
const DB_VERSION = 3;
const BINDINGS = 'bindings';
const CATALOGS = 'catalogs';
const OUTBOX = 'outbox';
const SESSIONS = 'sessions';
const FREQUENTS = 'frequents';
const ACTIVE_BINDING = 'active';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open Mobile POS storage'));
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(BINDINGS)) database.createObjectStore(BINDINGS);
      if (!database.objectStoreNames.contains(CATALOGS)) database.createObjectStore(CATALOGS);
      if (!database.objectStoreNames.contains(OUTBOX)) {
        const store = database.createObjectStore(OUTBOX, { keyPath: 'id' });
        store.createIndex('terminalCode', 'terminalCode', { unique: false });
      }
      if (!database.objectStoreNames.contains(SESSIONS)) database.createObjectStore(SESSIONS);
      if (!database.objectStoreNames.contains(FREQUENTS)) database.createObjectStore(FREQUENTS);
    };
  });
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

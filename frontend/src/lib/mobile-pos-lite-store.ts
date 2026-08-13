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
  /**
   * Permission-derived flags (spec-inventory §1.3): the runtime session object
   * is structured-cloned into IDB wholesale, so these survive offline
   * cold-start automatically — typing them here just makes that honest.
   */
  purchasesEnabled?: boolean;
  stockCountsEnabled?: boolean;
};

const DB_NAME = 'itemba-mobile-pos-lite';
/**
 * CURRENT schema level for this code. v4 is the ONE migration for the Kaunta
 * reform (design-direction §12.3): it creates `stocks`, `drafts` and `daylog`
 * together. `daylog` is used from Phase 3 (Leo day book); `stocks` and
 * `drafts` stay empty until Phases 4–5 — pre-created empty stores are
 * harmless, and the one-migration rule holds (each release bumps the version
 * at most once and only ADDS stores/indexes, never renames or removes them,
 * so any older cached shell still finds every store it knows about in a
 * newer database).
 */
const DB_VERSION = 4;
const BINDINGS = 'bindings';
const CATALOGS = 'catalogs';
const OUTBOX = 'outbox';
const SESSIONS = 'sessions';
const FREQUENTS = 'frequents';
const STOCKS = 'stocks';
const DRAFTS = 'drafts';
const DAYLOG = 'daylog';
const ACTIVE_BINDING = 'active';

/** Object stores this code level requires before it can serve any request. */
const REQUIRED_STORES = [
  BINDINGS,
  CATALOGS,
  OUTBOX,
  SESSIONS,
  FREQUENTS,
  STOCKS,
  DRAFTS,
  DAYLOG,
] as const;

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
  // v4 (the single Kaunta migration): stocks/drafts land unused until
  // Phases 4–5; daylog backs the Leo day book from Phase 3.
  if (!database.objectStoreNames.contains(STOCKS)) database.createObjectStore(STOCKS);
  if (!database.objectStoreNames.contains(DRAFTS)) database.createObjectStore(DRAFTS);
  if (!database.objectStoreNames.contains(DAYLOG)) database.createObjectStore(DAYLOG);
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

/* ─── Stocks (spec-inventory §5): the Stoo branch-stock snapshot ─────────── */

/** One row of `GET /mobile-pos-lite/stock` — mirrors the endpoint item shape exactly. */
export type PosStockItem = {
  productId: string;
  name: string;
  code: string;
  barcode: string | null;
  unitId: string;
  unitSymbol: string;
  /** Backend-relative image path (`/products/:id/image`) — null when no photo. */
  imageUrl: string | null;
  /** Nullable: Stoo includes unpriced products (they never reach the sale flow). */
  sellingPrice: number | null;
  quantityOnHand: number;
  quantityReserved: number;
  /** onHand − reserved, UNCLAMPED — the client gates the rep presentation. */
  available: number;
  threshold: number;
  status: 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK' | 'OVERSOLD';
};

/**
 * The cached `/stock` response. `fetchedAt` is CLIENT time (Date.now() at the
 * moment the response landed) — the freshness clock keys off it, never off
 * the server `asOf`, so device clock skew degrades chrome, not truth.
 */
export type PosStockSnapshot = {
  items: PosStockItem[];
  asOf: string;
  fetchedAt: number;
};

export async function readCachedStock(terminalCode: string): Promise<PosStockSnapshot | null> {
  return (
    (await transaction<PosStockSnapshot | undefined>(STOCKS, 'readonly', (store) =>
      store.get(terminalCode),
    )) ?? null
  );
}

/** One snapshot per terminal; every successful fetch overwrites wholesale. */
export async function writeCachedStock(terminalCode: string, snapshot: PosStockSnapshot) {
  await transaction(STOCKS, 'readwrite', (store) => store.put(snapshot, terminalCode));
}

/* ─── Drafts (spec-inventory §5): the Hesabu count sheet ─────────────────── */

/**
 * The count draft, keyed `` `${terminalCode}:count` `` — one draft per module
 * per terminal, enforced by the fixed key (`` :purchase `` is the kikaratasi's
 * reserved key in the same store).
 *
 * `lines` maps productId → counted quantity, and the ABSENCE of a key is the
 * load-bearing state: absent means "not counted", 0 means "counted, the shelf
 * was empty". The two must stay distinct from the input through the draft, the
 * review and the payload — collapsing them would post a phantom variance.
 * `capturedAt` is the first edit (the confirm screen shows it because a
 * variance can be surprising even when correct); `updatedAt` moves on every
 * autosave.
 *
 * `names` snapshots productId → product name for the same reason
 * `PosPurchaseDraft.lines` carries `name`: a resumed sheet outlives the stock
 * snapshot it was typed against, and a counted line whose product has since
 * left that snapshot must still be NAMEABLE to be removable (spec-inventory §7
 * case 5). Without it a cold restart asks the manager to delete a 36-character
 * UUID she can neither recognise nor report to the office. The field is
 * OPTIONAL and purely additive: a draft written before it existed still loads,
 * and a line it does not cover falls back to its productId.
 *
 * `idempotencyKey` is the load-bearing field, exactly as it is on
 * `PosPurchaseDraft`. It is ABSENT until the first TUMA HESABU (nothing has
 * been attempted, so there is nothing to resume) and frozen from that attempt
 * until the count posts or the manager discards the sheet — surviving app
 * kill, eviction and cold start, because that is the only window in which a
 * lost response can be answered. A count re-sent under a FRESH key misses the
 * server's `[MPL-COUNT:<key>]` marker and posts a second adjustment carrying
 * the sheet's ABSOLUTE quantities against a baseline that has moved since —
 * inventing stock that was sold in between, with two unlinked adjustments and
 * a receipt that looks exactly right. Also optional, also additive: a draft
 * written before this field existed loads and resumes unchanged (it simply
 * carries no attempt to resume).
 */
export type PosCountDraft = {
  type: 'count';
  lines: Record<string, number>;
  names?: Record<string, string>;
  idempotencyKey?: string;
  capturedAt: number;
  updatedAt: number;
};

function countDraftKey(terminalCode: string) {
  return `${terminalCode}:count`;
}

export async function readCountDraft(terminalCode: string): Promise<PosCountDraft | null> {
  return (
    (await transaction<PosCountDraft | undefined>(DRAFTS, 'readonly', (store) =>
      store.get(countDraftKey(terminalCode)),
    )) ?? null
  );
}

/** Autosaved on every committed edit — counting happens where signal dies. */
export async function writeCountDraft(terminalCode: string, draft: PosCountDraft) {
  await transaction(DRAFTS, 'readwrite', (store) => store.put(draft, countDraftKey(terminalCode)));
}

export async function clearCountDraft(terminalCode: string) {
  await transaction(DRAFTS, 'readwrite', (store) => store.delete(countDraftKey(terminalCode)));
}

/* ─── Drafts (spec-purchases §6): the Manunuzi kikaratasi ────────────────── */

/**
 * The purchase draft, keyed `` `${terminalCode}:purchase` `` — the count
 * sheet's sibling in the same store, one draft per module per terminal.
 *
 * `idempotencyKey` is the load-bearing field: it is minted when the draft is
 * created and frozen until the delivery posts or the manager empties the form.
 * A key regenerated on retry turns one lost response into two deliveries —
 * the frozen one lets the server resume its `[MPL-PURCHASE:<key>]` chain.
 *
 * `lines` carries its own name/unitSymbol snapshot so a restored slip renders
 * without the catalog (a re-sync between save and restore must not blank the
 * form); the server re-resolves every productId at post time regardless.
 * `notes` mirrors the POST body's optional field — no Pokea input writes it
 * yet, and the draft must not be the reason it cannot. `savedAt` is display
 * only: nothing gates on a slip's age (the 48h expiry is CUT per critique D3).
 */
export type PosPurchaseDraft = {
  type: 'purchase';
  terminalCode: string;
  idempotencyKey: string;
  supplierId: string | null;
  supplierName: string | null;
  lines: Array<{
    productId: string;
    name: string;
    unitSymbol: string;
    quantity: number;
    unitCost?: number;
  }>;
  notes?: string;
  savedAt: number;
};

function purchaseDraftKey(terminalCode: string) {
  return `${terminalCode}:purchase`;
}

export async function readPurchaseDraft(terminalCode: string): Promise<PosPurchaseDraft | null> {
  return (
    (await transaction<PosPurchaseDraft | undefined>(DRAFTS, 'readonly', (store) =>
      store.get(purchaseDraftKey(terminalCode)),
    )) ?? null
  );
}

/** Autosaved 500ms after any edit — a dead battery must not cost twenty lines. */
export async function savePurchaseDraft(terminalCode: string, draft: PosPurchaseDraft) {
  await transaction(DRAFTS, 'readwrite', (store) =>
    store.put(draft, purchaseDraftKey(terminalCode)),
  );
}

export async function deletePurchaseDraft(terminalCode: string) {
  await transaction(DRAFTS, 'readwrite', (store) => store.delete(purchaseDraftKey(terminalCode)));
}

/**
 * Orphan sweep (spec-purchases §8 case 7): drafts survive a binding reset by
 * design, but a terminal revoked and replaced under a NEW code strands the old
 * rows — this device can never submit them, and no screen can reach them. Boot
 * deletes every draft outside the active terminal's prefix, count sheets and
 * kikaratasi alike: the sweep is keyed by terminal, never by module, so every
 * draft type added to this store is covered the day it ships. Returns the
 * removed keys (tests read them; no caller needs the value).
 */
export async function sweepOrphanDrafts(activeTerminalCode: string): Promise<string[]> {
  const keys = await transaction<IDBValidKey[]>(DRAFTS, 'readonly', (store) => store.getAllKeys());
  const orphans = keys.filter(
    (key): key is string => typeof key === 'string' && !key.startsWith(`${activeTerminalCode}:`),
  );
  for (const key of orphans) {
    await transaction(DRAFTS, 'readwrite', (store) => store.delete(key));
  }
  return orphans;
}

/* ─── Daylog (spec-leo §3): the persisted day log behind the Leo day book ─── */

/** Last successful `my-sales-today` snapshot — server truth, never client math. */
export type PosDaylogSent = {
  /** Shared-phone guard (spec-leo §2.5): another rep's total is never shown. */
  repId: string;
  count: number;
  totalAmount: number;
  /** Epoch ms — the staleness stamp ("mwisho kuonekana {time}"). */
  fetchedAt: number;
};

export type PosDaylogEntry = {
  terminalCode: string;
  /** Device-local YYYY-MM-DD (single-timezone EAT fleet — spec-leo §7.3). */
  date: string;
  /** Finished jobs stamped on THIS phone this day — accrues on local commit. */
  tallyCount: number;
  /** Absent until the first successful my-sales-today fetch of the day. */
  sent?: PosDaylogSent;
};

/** Device-local calendar date as YYYY-MM-DD — the daylog's day key. */
export function posDaylogDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function daylogKey(terminalCode: string, date: string) {
  return `${terminalCode}:${date}`;
}

/**
 * Retention (spec-leo §3): every tally write prunes this terminal's rows older
 * than seven days — the daylog is a glance cache, never a shadow ledger.
 */
const DAYLOG_RETENTION_DAYS = 7;

async function pruneDaylog(terminalCode: string) {
  const cutoff = daylogKey(
    terminalCode,
    posDaylogDate(new Date(Date.now() - DAYLOG_RETENTION_DAYS * 24 * 60 * 60 * 1000)),
  );
  const keys = await transaction<IDBValidKey[]>(DAYLOG, 'readonly', (store) => store.getAllKeys());
  // Keys are `${terminalCode}:YYYY-MM-DD`, so a plain string compare inside
  // one terminal's prefix IS a date compare. Other terminals' rows are left
  // alone (they age out through their own writes).
  const stale = keys.filter(
    (key): key is string =>
      typeof key === 'string' && key.startsWith(`${terminalCode}:`) && key < cutoff,
  );
  for (const key of stale) {
    await transaction(DAYLOG, 'readwrite', (store) => store.delete(key));
  }
}

export async function getDaylogEntry(
  terminalCode: string,
  date: string,
): Promise<PosDaylogEntry | null> {
  return (
    (await transaction<PosDaylogEntry | undefined>(DAYLOG, 'readonly', (store) =>
      store.get(daylogKey(terminalCode, date)),
    )) ?? null
  );
}

/**
 * One stamp, one mark (design-direction §5): fired at the MUHURI local-commit
 * moment — sale sent AND sale queued AND purchase. Failures must never block
 * a sale: callers fire-and-forget with `.catch(() => undefined)`.
 */
export async function bumpDaylogTally(terminalCode: string): Promise<PosDaylogEntry> {
  const date = posDaylogDate();
  const existing = await getDaylogEntry(terminalCode, date);
  const entry: PosDaylogEntry = existing
    ? { ...existing, tallyCount: existing.tallyCount + 1 }
    : { terminalCode, date, tallyCount: 1 };
  await transaction(DAYLOG, 'readwrite', (store) =>
    store.put(entry, daylogKey(terminalCode, date)),
  );
  await pruneDaylog(terminalCode);
  return entry;
}

/**
 * Upsert the day's `sent` snapshot. Fired ONLY from a successful
 * `my-sales-today` fetch handler — totals are server-authoritative and a
 * client-summed total would drift from server pricing (spec-leo §3).
 */
export async function writeDaylogSent(
  terminalCode: string,
  date: string,
  sent: PosDaylogSent,
): Promise<PosDaylogEntry> {
  const existing = await getDaylogEntry(terminalCode, date);
  const entry: PosDaylogEntry = existing
    ? { ...existing, sent }
    : { terminalCode, date, tallyCount: 0, sent };
  await transaction(DAYLOG, 'readwrite', (store) =>
    store.put(entry, daylogKey(terminalCode, date)),
  );
  return entry;
}

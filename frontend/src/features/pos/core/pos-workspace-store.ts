import { openDatabase } from '@/lib/mobile-pos-lite-store';
import type { CartLine, Customer } from './pos-types';

/** Device-private unpaid work. Kept separate from the money already in the outbox. */
export type PosCartDraft = {
  schemaVersion: 1;
  id: string;
  requestId: string;
  revision: number;
  scope: string;
  instance: string;
  state: 'active' | 'held' | 'submitted';
  name: string;
  note: string;
  updatedAt: string;
  cart: CartLine[];
  customer: Customer | null;
  paymentMethod: string;
  paymentReference: string;
  receivedValue: string;
};

const prefix = 'pos-cart-v1:';
const key = (scope: string, id: string) =>
  `${prefix}${encodeURIComponent(scope)}:${encodeURIComponent(id)}`;
export const activeCartKey = (instance: string) => `active:${instance}`;

export class PosCartConflict extends Error {
  constructor() {
    super('This cart has changed in another window. Reload its saved copy.');
  }
}

// Every read/check/write runs in one IndexedDB transaction, including held-cart
// claims. Never put an await between the read and its conditional write.
async function transact<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore, result: (value: T) => void, fail: (error: Error) => void) => void,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('drafts', mode);
      let value: T;
      let failure: Error | undefined;
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () =>
        reject(failure ?? tx.error ?? new Error('Cannot save this cart on the device.'));
      run(
        tx.objectStore('drafts'),
        (next) => {
          value = next;
        },
        (error) => {
          failure = error;
          tx.abort();
        },
      );
    });
  } finally {
    db.close();
  }
}

export function readActiveCart(scope: string, instance: string) {
  return transact<PosCartDraft | null>('readonly', (store, result, fail) => {
    const request = store.get(key(scope, activeCartKey(instance)));
    request.onsuccess = () => {
      const saved = request.result as PosCartDraft | undefined;
      if (
        saved &&
        (saved.schemaVersion !== 1 ||
          saved.scope !== scope ||
          saved.instance !== instance ||
          !Array.isArray(saved.cart))
      )
        return fail(new Error('The saved cart format is unsupported. Keep it for recovery.'));
      result(saved ?? null);
    };
  });
}

export function listHeldCarts(scope: string) {
  return transact<PosCartDraft[]>('readonly', (store, result) => {
    const request = store.getAll();
    request.onsuccess = () =>
      result(
        (request.result as PosCartDraft[])
          .filter((row) => row?.schemaVersion === 1 && row.scope === scope && row.state === 'held')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      );
  });
}

export function saveActiveCart(draft: PosCartDraft, expectedRevision: number) {
  return transact<PosCartDraft>('readwrite', (store, result, fail) => {
    const address = key(draft.scope, activeCartKey(draft.instance));
    const request = store.get(address);
    request.onsuccess = () => {
      const old = request.result as PosCartDraft | undefined;
      if ((old?.revision ?? 0) !== expectedRevision || (old && old.id !== draft.id))
        return fail(new PosCartConflict());
      const next = {
        ...draft,
        revision: expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      };
      store.put(next, address);
      result(next);
    };
  });
}

export function holdActiveCart(draft: PosCartDraft, expectedRevision: number) {
  return transact<PosCartDraft>('readwrite', (store, result, fail) => {
    const address = key(draft.scope, activeCartKey(draft.instance));
    const request = store.get(address);
    request.onsuccess = () => {
      const old = request.result as PosCartDraft | undefined;
      if (
        (old?.revision ?? 0) !== expectedRevision ||
        (old && old.id !== draft.id) ||
        draft.state !== 'active'
      )
        return fail(new PosCartConflict());
      const next: PosCartDraft = {
        ...draft,
        state: 'held',
        revision: expectedRevision + 1,
        updatedAt: new Date().toISOString(),
      };
      store.put(next, key(draft.scope, draft.id));
      store.delete(address);
      result(next);
    };
  });
}

export function resumeHeldCart(scope: string, instance: string, id: string, revision: number) {
  return transact<PosCartDraft>('readwrite', (store, result, fail) => {
    const address = key(scope, activeCartKey(instance));
    const active = store.get(address);
    active.onsuccess = () => {
      // Do not replace another active/submitted cart, even if a stale UI says empty.
      if (active.result) return fail(new PosCartConflict());
      const request = store.get(key(scope, id));
      request.onsuccess = () => {
        const old = request.result as PosCartDraft | undefined;
        if (!old || old.state !== 'held' || old.revision !== revision)
          return fail(new PosCartConflict());
        const next: PosCartDraft = {
          ...old,
          instance,
          state: 'active',
          revision: old.revision + 1,
          updatedAt: new Date().toISOString(),
        };
        store.put(next, address);
        store.delete(key(scope, id));
        result(next);
      };
    };
  });
}

export function updateHeldCart(draft: PosCartDraft, discard = false) {
  return transact<void>('readwrite', (store, result, fail) => {
    const address = key(draft.scope, draft.id);
    const request = store.get(address);
    request.onsuccess = () => {
      const old = request.result as PosCartDraft | undefined;
      if (!old || old.state !== 'held' || old.revision !== draft.revision)
        return fail(new PosCartConflict());
      if (discard) store.delete(address);
      else
        store.put(
          {
            ...old,
            name: draft.name.slice(0, 80),
            note: draft.note.slice(0, 500),
            revision: old.revision + 1,
            updatedAt: new Date().toISOString(),
          },
          address,
        );
      result(undefined);
    };
  });
}

export function clearActiveCart(scope: string, instance: string, id: string, revision: number) {
  return transact<void>('readwrite', (store, result, fail) => {
    const address = key(scope, activeCartKey(instance));
    const request = store.get(address);
    request.onsuccess = () => {
      const old = request.result as PosCartDraft | undefined;
      if (old && (old.id !== id || old.revision !== revision)) return fail(new PosCartConflict());
      store.delete(address);
      result(undefined);
    };
  });
}

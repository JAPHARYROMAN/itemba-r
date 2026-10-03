import { openDatabase } from '@/lib/mobile-pos-lite-store';
export type PosAction = {
  requestId: string;
  saleId: string;
  kind: 'collections' | 'returns';
  body: Record<string, unknown>;
  rejected?: boolean;
};
async function transaction<T>(
  key: string,
  change: ((old: PosAction | null) => PosAction | null) | null,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('drafts', change ? 'readwrite' : 'readonly');
      const store = tx.objectStore('drafts');
      let result: PosAction | null = null;
      let error: unknown;
      const read = store.get(key);
      read.onsuccess = () => {
        try {
          result = read.result ?? null;
          if (change) {
            result = change(result);
            if (result) store.put(result, key);
            else store.delete(key);
          }
        } catch (e) {
          error = e;
          tx.abort();
        }
      };
      tx.oncomplete = () => resolve(result as T);
      tx.onerror = tx.onabort = () =>
        reject(error ?? tx.error ?? new Error('Cannot save the transaction request'));
    });
  } finally {
    db.close();
  }
}
export const readPosAction = (key: string) => transaction<PosAction | null>(key, null);
export const savePosAction = (key: string, next: PosAction) =>
  transaction<PosAction>(key, (old) => {
    if (old && old.requestId !== next.requestId)
      throw new Error('Resolve the existing transaction before recording another');
    if (
      old &&
      (old.saleId !== next.saleId ||
        old.kind !== next.kind ||
        JSON.stringify(old.body) !== JSON.stringify(next.body))
    )
      throw new Error('Keep the original transaction inputs until its outcome is resolved');
    return next;
  });
export const clearPosAction = (key: string, requestId: string) =>
  transaction(key, (old) => {
    if (old && old.requestId !== requestId)
      throw new Error('The transaction changed in another window');
    return null;
  });

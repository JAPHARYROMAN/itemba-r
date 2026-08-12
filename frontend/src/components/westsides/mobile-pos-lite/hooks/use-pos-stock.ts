'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { backendGet } from '@/lib/api-client';
import {
  readCachedStock,
  writeCachedStock,
  type MobilePosLiteBinding,
  type PosStockItem,
  type PosStockSnapshot,
} from '@/lib/mobile-pos-lite-store';
import { terminalHeaders } from '../pos-utils';

/**
 * Fetch policy (spec-inventory §2, DB-storage discipline): `GET /stock` fires
 * only when the cached snapshot is missing or older than this — on Stoo open,
 * and pre-warmed once when the Kaunta rail renders. NOT on every catalog sync.
 */
export const STOCK_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000;

type StockResponse = {
  asOf: string;
  branch: { id: string; name: string };
  items: PosStockItem[];
};

/**
 * The Stoo branch-stock snapshot (Kaunta-shell-only; the classic shell never
 * calls this). Owns the IDB cache read, the throttled fetch, and the manual
 * refresh; every successful response snapshots to the `stocks` store with a
 * CLIENT `fetchedAt` (the freshness clock's source — never server `asOf`).
 */
export function usePosStock({ binding }: { binding: MobilePosLiteBinding }): {
  snapshot: PosStockSnapshot | null;
  loading: boolean;
  /** True after an online fetch failed; only meaningful without a snapshot. */
  loadFailed: boolean;
  /** Conditional fetch: no-op offline or while the snapshot is fresh. */
  ensureFresh: () => void;
  /** Manual refresh (freshness chip / tryAgain): bypasses the age check. */
  refresh: () => void;
} {
  const [snapshot, setSnapshot] = useState<PosStockSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  // Mirror for the fetch decision (state reads would be stale mid-flight).
  const snapshotRef = useRef<PosStockSnapshot | null>(null);
  const cacheReadRef = useRef<Promise<void> | null>(null);
  const inFlightRef = useRef(false);

  // One cache read per mount, shared by every caller: offline renders it,
  // online decides against it.
  const readCache = useCallback(() => {
    if (!cacheReadRef.current) {
      cacheReadRef.current = readCachedStock(binding.terminalCode)
        .then((cached) => {
          if (cached && !snapshotRef.current) {
            snapshotRef.current = cached;
            setSnapshot(cached);
          }
        })
        // Storage failure reads as "no snapshot" — the fetch path still runs.
        .catch(() => undefined);
    }
    return cacheReadRef.current;
  }, [binding.terminalCode]);

  const fetchStock = useCallback(
    async (force: boolean) => {
      await readCache();
      // Offline never fetches: the snapshot (however old) is the truth here.
      if (!navigator.onLine) return;
      if (inFlightRef.current) return;
      const current = snapshotRef.current;
      if (!force && current && Date.now() - current.fetchedAt < STOCK_SNAPSHOT_MAX_AGE_MS) {
        return;
      }
      inFlightRef.current = true;
      setLoading(true);
      setLoadFailed(false);
      try {
        const response = await backendGet<StockResponse>('/mobile-pos-lite/stock', {
          headers: terminalHeaders(binding),
        });
        const fresh: PosStockSnapshot = {
          items: response.items,
          asOf: response.asOf,
          fetchedAt: Date.now(),
        };
        snapshotRef.current = fresh;
        setSnapshot(fresh);
        // The write must never block the screen; a failed write just means
        // the next cold start refetches.
        void writeCachedStock(binding.terminalCode, fresh).catch(() => undefined);
      } catch {
        // Screen-level policy (spec-inventory §2): with a snapshot the screen
        // keeps showing it behind the stale header; without one it shows the
        // stockLoadError card + tryAgain.
        setLoadFailed(true);
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    },
    [binding, readCache],
  );

  const ensureFresh = useCallback(() => {
    void fetchStock(false);
  }, [fetchStock]);
  const refresh = useCallback(() => {
    void fetchStock(true);
  }, [fetchStock]);

  // Pre-warm on rail render (= shell mount): load the cache so offline has a
  // snapshot ready, and fire the conditional fetch — a no-op when fresh.
  useEffect(() => {
    void fetchStock(false);
  }, [fetchStock]);

  return { snapshot, loading, loadFailed, ensureFresh, refresh };
}

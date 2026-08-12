'use client';

import { useCallback, useRef, useState } from 'react';
import { backendPost } from '@/lib/api-client';
import {
  getPendingMobilePosLiteSales,
  removePendingMobilePosLiteSale,
  updatePendingMobilePosLiteSaleError,
  type MobilePosLiteBinding,
  type PendingMobilePosLiteSale,
} from '@/lib/mobile-pos-lite-store';
import { isConnectionProblem, terminalHeaders } from '../pos-utils';

/**
 * The offline-sale outbox: the pending list plus the sync engine.
 *
 * Sync semantics are load-bearing (characterization CHAR-2/CHAR-5):
 * - single-flight via `syncingRef` — a second call while posting is a no-op;
 * - a connection-shaped failure BREAKS the loop (the whole network is gone;
 *   nothing gets flagged, order is preserved);
 * - a server rejection FLAGS that sale and CONTINUES to the next one;
 * - payloads are replayed verbatim from the store — never regenerated;
 * - drain order comes from the store read (primary-key/UUID order via the
 *   terminalCode index) — do not "fix" this to FIFO.
 */
export function usePosOutbox(): {
  pendingSales: PendingMobilePosLiteSale[];
  syncing: boolean;
  refreshPendingSales: (current: MobilePosLiteBinding) => Promise<PendingMobilePosLiteSale[]>;
  syncPendingSales: (current: MobilePosLiteBinding) => Promise<void>;
} {
  const [pendingSales, setPendingSales] = useState<PendingMobilePosLiteSale[]>([]);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);

  const refreshPendingSales = useCallback(async (current: MobilePosLiteBinding) => {
    const items = await getPendingMobilePosLiteSales(current.terminalCode);
    setPendingSales(items);
    return items;
  }, []);

  const syncPendingSales = useCallback(
    async (current: MobilePosLiteBinding) => {
      if (!navigator.onLine || syncingRef.current) return;
      syncingRef.current = true;
      setSyncing(true);
      try {
        const pending = await getPendingMobilePosLiteSales(current.terminalCode);
        for (const item of pending) {
          try {
            await backendPost('/mobile-pos-lite/sales', item.payload, {
              headers: terminalHeaders(current),
            });
            await removePendingMobilePosLiteSale(item.id);
          } catch (error) {
            if (isConnectionProblem(error)) break;
            await updatePendingMobilePosLiteSaleError(
              item.id,
              error instanceof Error ? error.message : 'This sale still needs attention.',
            );
          }
        }
        await refreshPendingSales(current);
      } finally {
        syncingRef.current = false;
        setSyncing(false);
      }
    },
    [refreshPendingSales],
  );

  return { pendingSales, syncing, refreshPendingSales, syncPendingSales };
}

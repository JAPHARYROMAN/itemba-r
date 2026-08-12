'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { backendGet } from '@/lib/api-client';
import {
  getMobilePosLiteBinding,
  getMobilePosLiteCatalog,
  getMobilePosLiteFrequents,
  getMobilePosLiteSession,
  saveMobilePosLiteCatalog,
  saveMobilePosLiteSession,
  type MobilePosLiteBinding,
  type MobilePosLiteProduct,
  type PendingMobilePosLiteSale,
} from '@/lib/mobile-pos-lite-store';
import type { PosTranslate, Session } from '../pos-types';
import { isConnectionProblem, mergeProducts, terminalHeaders } from '../pos-utils';

type UsePosBootstrapArgs = {
  refreshPendingSales: (current: MobilePosLiteBinding) => Promise<PendingMobilePosLiteSale[]>;
  syncPendingSales: (current: MobilePosLiteBinding) => Promise<void>;
  /**
   * Orchestrator-owned state written during boot. These MUST be identity-stable
   * (raw `useState` setters) — the callbacks below capture them under dep
   * arrays preserved verbatim from the pre-split monolith.
   */
  setFrequents: (counts: Record<string, number>) => void;
  setPaymentMethod: (code: string) => void;
  setNotice: (notice: string) => void;
  t: PosTranslate;
};

/**
 * Terminal bootstrap: binding read, session fetch (network, with the
 * IndexedDB-cache offline cold-start fallback tracked by
 * `sessionFromCacheRef`), catalog load/sync, online/offline listeners, service
 * worker registration, and the online-return refetch.
 */
export function usePosBootstrap({
  refreshPendingSales,
  syncPendingSales,
  setFrequents,
  setPaymentMethod,
  setNotice,
  t,
}: UsePosBootstrapArgs): {
  binding: MobilePosLiteBinding | null;
  session: Session | null;
  catalog: MobilePosLiteProduct[];
  online: boolean;
  updateCatalog: (terminalCode: string, products: MobilePosLiteProduct[]) => void;
  syncCatalog: (current: MobilePosLiteBinding) => Promise<void>;
} {
  const router = useRouter();
  const [binding, setBinding] = useState<MobilePosLiteBinding | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<MobilePosLiteProduct[]>([]);
  const [online, setOnline] = useState(true);
  // When the session came from the offline cache, refresh it as soon as the
  // network returns so config changes (payment methods, suspension) apply.
  const sessionFromCacheRef = useRef(false);

  const updateCatalog = useCallback((terminalCode: string, products: MobilePosLiteProduct[]) => {
    setCatalog((current) => {
      const merged = mergeProducts(current, products);
      void saveMobilePosLiteCatalog(terminalCode, merged);
      return merged;
    });
  }, []);

  // Dep array preserved verbatim from the monolith ([]): `setPaymentMethod` is
  // stable by the args contract above, so the closure never goes stale.
  const loadSession = useCallback(async (current: MobilePosLiteBinding) => {
    const currentSession = await backendGet<Session>('/mobile-pos-lite/session', {
      headers: terminalHeaders(current),
    });
    sessionFromCacheRef.current = false;
    setSession(currentSession);
    setPaymentMethod(currentSession.paymentMethods[0]?.code ?? 'CASH');
    void saveMobilePosLiteSession(current.terminalCode, currentSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncCatalog = useCallback(
    async (current: MobilePosLiteBinding) => {
      if (!navigator.onLine) return;
      const products = await backendGet<MobilePosLiteProduct[]>('/mobile-pos-lite/catalog', {
        headers: terminalHeaders(current),
      });
      updateCatalog(current.terminalCode, products);
    },
    [updateCatalog],
  );

  useEffect(() => {
    setOnline(navigator.onLine);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/mobile-pos-sw.js').catch(() => undefined);
    }
    const setConnected = () => setOnline(true);
    const setDisconnected = () => setOnline(false);
    window.addEventListener('online', setConnected);
    window.addEventListener('offline', setDisconnected);
    return () => {
      window.removeEventListener('online', setConnected);
      window.removeEventListener('offline', setDisconnected);
    };
  }, []);

  // WARNING (characterization report, known hazard): `router` is in this dep
  // array, so the whole boot — binding read, session fetch, catalog load,
  // outbox sync — re-runs if the router identity ever changes. next/navigation
  // returns a stable singleton today, which is what keeps this a one-shot
  // boot; these dependency semantics are preserved verbatim from the monolith.
  useEffect(() => {
    let cancelled = false;
    getMobilePosLiteBinding()
      .then(async (stored) => {
        if (cancelled) return;
        if (!stored) {
          router.replace('/mobile-pos/activate');
          return;
        }
        setBinding(stored);
        const savedCatalog = await getMobilePosLiteCatalog(stored.terminalCode);
        if (!cancelled) setCatalog(savedCatalog);
        void getMobilePosLiteFrequents(stored.terminalCode).then((counts) => {
          if (!cancelled) setFrequents(counts);
        });
        try {
          await loadSession(stored);
          await refreshPendingSales(stored);
          void syncCatalog(stored);
          void syncPendingSales(stored);
        } catch (error) {
          if (cancelled) return;
          // Offline cold start: sell from the cached session rather than
          // dead-ending on the splash screen — offline selling is the point.
          if (isConnectionProblem(error)) {
            const cached = await getMobilePosLiteSession(stored.terminalCode);
            if (cancelled) return;
            if (cached) {
              sessionFromCacheRef.current = true;
              setSession(cached);
              setPaymentMethod(cached.paymentMethods[0]?.code ?? 'CASH');
              await refreshPendingSales(stored);
              return;
            }
          }
          setNotice(error instanceof Error ? error.message : t('terminalUnavailable'));
        }
      })
      .catch(() => router.replace('/mobile-pos/activate'));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSession, refreshPendingSales, router, syncCatalog, syncPendingSales]);

  useEffect(() => {
    if (!binding || !online) return;
    void syncPendingSales(binding);
    if (sessionFromCacheRef.current) {
      void loadSession(binding).catch(() => undefined);
      void syncCatalog(binding).catch(() => undefined);
    }
  }, [binding, loadSession, online, syncCatalog, syncPendingSales]);

  return { binding, session, catalog, online, updateCatalog, syncCatalog };
}

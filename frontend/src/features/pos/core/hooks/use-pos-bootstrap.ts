'use client';
import { usePosHost } from '@/features/pos/core/pos-host-context';

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
  /** When false, skip binding/session/catalog network reads (auth loading or no permission). */
  enabled?: boolean;
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
  enabled = true,
}: UsePosBootstrapArgs): {
  binding: MobilePosLiteBinding | null;
  session: Session | null;
  catalog: MobilePosLiteProduct[];
  online: boolean;
  updateCatalog: (terminalCode: string, products: MobilePosLiteProduct[]) => void;
  syncCatalog: (current: MobilePosLiteBinding) => Promise<void>;
  retryBoot: () => void;
} {
  const nativeRouter = useRouter();
  const host = usePosHost();
  const router = host?.router ?? nativeRouter;
  const posBase = host?.basePath ?? '/mobile-pos';
  const [binding, setBinding] = useState<MobilePosLiteBinding | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<MobilePosLiteProduct[]>([]);
  const [online, setOnline] = useState(true);
  const [bootAttempt, setBootAttempt] = useState(0);
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
  const loadSession = useCallback(
    async (current: MobilePosLiteBinding, isCurrent: () => boolean = () => true) => {
      const currentSession = await backendGet<Session>('/mobile-pos-lite/session', {
        headers: terminalHeaders(current),
      });
      if (!isCurrent()) return;
      sessionFromCacheRef.current = false;
      setSession(currentSession);
      setPaymentMethod(currentSession.paymentMethods[0]?.code ?? 'CASH');
      void saveMobilePosLiteSession(current.terminalCode, currentSession);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const syncCatalog = useCallback(
    async (current: MobilePosLiteBinding, isCurrent: () => boolean = () => true) => {
      if (!navigator.onLine) return;
      const products = await backendGet<MobilePosLiteProduct[]>('/mobile-pos-lite/catalog', {
        headers: terminalHeaders(current),
      });
      if (!isCurrent()) return;
      updateCatalog(current.terminalCode, products);
    },
    [updateCatalog],
  );

  const retryBoot = useCallback(() => {
    setNotice('');
    setBootAttempt((n) => n + 1);
  }, [setNotice]);

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
    if (!enabled) return;
    let cancelled = false;
    const isCurrent = () => !cancelled;
    getMobilePosLiteBinding()
      .then(async (stored) => {
        if (!isCurrent()) return;
        if (!stored) {
          router.replace(`${posBase}/activate`);
          return;
        }
        setBinding(stored);
        const savedCatalog = await getMobilePosLiteCatalog(stored.terminalCode);
        if (!isCurrent()) return;
        setCatalog(savedCatalog);
        void getMobilePosLiteFrequents(stored.terminalCode).then((counts) => {
          if (isCurrent()) setFrequents(counts);
        });
        try {
          await loadSession(stored, isCurrent);
          if (!isCurrent()) return;
          await refreshPendingSales(stored);
          if (!isCurrent()) return;
          void syncCatalog(stored, isCurrent).catch((error) => {
            if (!isCurrent()) return;
            setNotice(error instanceof Error ? error.message : t('terminalUnavailable'));
          });
          void syncPendingSales(stored);
        } catch (error) {
          if (!isCurrent()) return;
          // Offline cold start: sell from the cached session rather than
          // dead-ending on the splash screen — offline selling is the point.
          if (isConnectionProblem(error)) {
            const cached = await getMobilePosLiteSession(stored.terminalCode);
            if (!isCurrent()) return;
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
      .catch(() => {
        if (isCurrent()) router.replace(`${posBase}/activate`);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    bootAttempt,
    enabled,
    loadSession,
    refreshPendingSales,
    router,
    posBase,
    syncCatalog,
    syncPendingSales,
  ]);

  useEffect(() => {
    if (!enabled || !binding || !online) return;
    let cancelled = false;
    const isCurrent = () => !cancelled;
    void syncPendingSales(binding);
    if (sessionFromCacheRef.current) {
      void loadSession(binding, isCurrent).catch(() => undefined);
      void syncCatalog(binding, isCurrent).catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
  }, [binding, enabled, loadSession, online, syncCatalog, syncPendingSales]);

  return { binding, session, catalog, online, updateCatalog, syncCatalog, retryBoot };
}

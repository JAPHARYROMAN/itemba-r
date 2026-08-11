'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock,
  CloudOff,
  LogOut,
  Minus,
  Plus,
  RotateCw,
  Search,
  Share2,
  ShoppingCart,
  Trash2,
  Wifi,
} from 'lucide-react';
import { showToast } from '@/components/ui';
import { backendGet, backendPost } from '@/lib/api-client';
import {
  bumpMobilePosLiteFrequents,
  clearMobilePosLiteBinding,
  enqueueMobilePosLiteSale,
  getMobilePosLiteBinding,
  getMobilePosLiteCatalog,
  getMobilePosLiteFrequents,
  getMobilePosLiteSession,
  getPendingMobilePosLiteSales,
  removePendingMobilePosLiteSale,
  saveMobilePosLiteCatalog,
  saveMobilePosLiteSession,
  type MobilePosLiteBinding,
  type MobilePosLiteProduct,
  type PendingMobilePosLiteSale,
  updatePendingMobilePosLiteSaleError,
} from '@/lib/mobile-pos-lite-store';
import { useAuth } from '@/hooks/use-auth';
import { usePosLang, type PosLang, type PosStringKey } from './pos-i18n';

type Session = {
  terminal: {
    id: string;
    code: string;
    name: string;
    configVersion: number;
    offlineCashEnabled: boolean;
    /** Kaunta rollout pilot flag: 1 = classic shell, 2 = Kaunta shell (Phase 2+). */
    uiVersion?: number;
  };
  company: { id: string; name: string; code: string };
  division: { id: string; name: string; code: string };
  branch: { id: string; name: string; code: string };
  rep: { id: string; name: string };
  paymentMethods: Array<{ code: string; label: string; requiresReference: boolean }>;
  purchasesEnabled?: boolean;
};

type Customer = { id: string; name: string; customerCode?: string | null; phone?: string | null };
type Supplier = { id: string; name: string; supplierCode?: string | null; phone?: string | null };
type CartLine = { product: MobilePosLiteProduct; quantity: number };
type PurchaseLine = { product: MobilePosLiteProduct; quantity: number; unitCost: string };
type DaySummary = {
  count: number;
  totalAmount: number;
  sales: Array<{
    id: string;
    salesOrderNumber: string;
    totalAmount: number;
    paymentMethod: string;
    createdAt: string;
    customerName?: string | null;
  }>;
};
type SaleResult = {
  id: string;
  salesOrderNumber?: string;
  totalAmount?: number;
  receiptNumber?: string;
};

function money(value: number) {
  return `TZS ${new Intl.NumberFormat('en-TZ', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value)}`;
}

function newIdempotencyKey() {
  return crypto.randomUUID().replace(/-/g, '');
}

function terminalHeaders(binding: MobilePosLiteBinding) {
  return {
    'x-mobile-pos-terminal': binding.terminalCode,
    'x-mobile-pos-device': binding.deviceSecret,
  };
}

function isConnectionProblem(error: unknown) {
  return !navigator.onLine || (error instanceof TypeError && /fetch|network/i.test(error.message));
}

function mergeProducts(existing: MobilePosLiteProduct[], incoming: MobilePosLiteProduct[]) {
  const merged = new Map(existing.map((product) => [product.id, product]));
  incoming.forEach((product) => merged.set(product.id, product));
  return Array.from(merged.values());
}

function pendingTime(createdAt: string) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function MobilePosLite() {
  const router = useRouter();
  const { logout } = useAuth();
  const { lang, setLang, t } = usePosLang();
  const [binding, setBinding] = useState<MobilePosLiteBinding | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<MobilePosLiteProduct[]>([]);
  const [online, setOnline] = useState(true);
  const [pendingSales, setPendingSales] = useState<PendingMobilePosLiteSale[]>([]);
  const [screen, setScreen] = useState<
    'home' | 'sale' | 'payment' | 'success' | 'queue' | 'purchase' | 'mySales'
  >('home');
  const [query, setQuery] = useState('');
  const [remoteProducts, setRemoteProducts] = useState<MobilePosLiteProduct[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  // When the session came from the offline cache, refresh it as soon as the
  // network returns so config changes (payment methods, suspension) apply.
  const sessionFromCacheRef = useRef(false);
  const [notice, setNotice] = useState('');
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [frequents, setFrequents] = useState<Record<string, number>>({});
  const [receivedValue, setReceivedValue] = useState('');
  const [supplierQuery, setSupplierQuery] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchaseCart, setPurchaseCart] = useState<PurchaseLine[]>([]);
  const [purchaseQuery, setPurchaseQuery] = useState('');
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  const pendingCount = pendingSales.length;

  const refreshPendingSales = useCallback(async (current: MobilePosLiteBinding) => {
    const items = await getPendingMobilePosLiteSales(current.terminalCode);
    setPendingSales(items);
    return items;
  }, []);

  const updateCatalog = useCallback((terminalCode: string, products: MobilePosLiteProduct[]) => {
    setCatalog((current) => {
      const merged = mergeProducts(current, products);
      void saveMobilePosLiteCatalog(terminalCode, merged);
      return merged;
    });
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

  const loadSession = useCallback(async (current: MobilePosLiteBinding) => {
    const currentSession = await backendGet<Session>('/mobile-pos-lite/session', {
      headers: terminalHeaders(current),
    });
    sessionFromCacheRef.current = false;
    setSession(currentSession);
    setPaymentMethod(currentSession.paymentMethods[0]?.code ?? 'CASH');
    void saveMobilePosLiteSession(current.terminalCode, currentSession);
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

  useEffect(() => {
    if (!binding || !online || query.trim().length < 2) {
      setRemoteProducts([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      backendGet<MobilePosLiteProduct[]>('/mobile-pos-lite/products', {
        headers: terminalHeaders(binding),
        query: { search: query.trim() },
      })
        .then((products) => {
          if (cancelled) return;
          setRemoteProducts(products);
          updateCatalog(binding.terminalCode, products);
        })
        .catch(() => {
          if (!cancelled) setRemoteProducts([]);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [binding, online, query, updateCatalog]);

  useEffect(() => {
    if (!binding || !online || paymentMethod !== 'CREDIT' || customerQuery.trim().length < 2) {
      setCustomers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      backendGet<Customer[]>('/mobile-pos-lite/customers', {
        headers: terminalHeaders(binding),
        query: { search: customerQuery.trim() },
      })
        .then((results) => !cancelled && setCustomers(results))
        .catch(() => !cancelled && setCustomers([]));
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [binding, customerQuery, online, paymentMethod]);

  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const local =
      term.length < 2
        ? []
        : catalog
            .filter((product) =>
              [product.name, product.code, product.barcode ?? ''].some((value) =>
                value.toLocaleLowerCase().includes(term),
              ),
            )
            .slice(0, 12);
    return mergeProducts(local, remoteProducts).slice(0, 12);
  }, [catalog, query, remoteProducts]);

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.sellingPrice * line.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const selectedPayment = session?.paymentMethods.find((method) => method.code === paymentMethod);

  // Quick-pick grid: this terminal's most-sold products, personalized locally
  // and available offline. Falls back to the first catalog items so a fresh
  // terminal still gets tappable tiles instead of an empty search box.
  const quickPicks = useMemo(() => {
    const ranked = [...catalog].sort(
      (a, b) => (frequents[b.id] ?? 0) - (frequents[a.id] ?? 0) || a.name.localeCompare(b.name),
    );
    return ranked.slice(0, 12);
  }, [catalog, frequents]);

  const receivedAmount = useMemo(() => {
    const digits = receivedValue.replace(/\D/g, '');
    return digits ? Number(digits) : null;
  }, [receivedValue]);

  function addProduct(product: MobilePosLiteProduct) {
    setCart((current) => {
      const match = current.find((line) => line.product.id === product.id);
      if (match)
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      return [...current, { product, quantity: 1 }];
    });
    setQuery('');
    setRemoteProducts([]);
  }

  function setQuantity(productId: string, next: number) {
    setCart((current) =>
      next <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) =>
            line.product.id === productId ? { ...line, quantity: next } : line,
          ),
    );
  }

  function beginSale() {
    setNotice('');
    setCart([]);
    setQuery('');
    setCustomer(null);
    setCustomerQuery('');
    setPaymentReference('');
    setReceivedValue('');
    setPaymentMethod(session?.paymentMethods[0]?.code ?? 'CASH');
    setScreen('sale');
  }

  async function completeSale() {
    if (!binding || !session || cart.length === 0) return;
    if (paymentMethod === 'CREDIT' && !customer) {
      setNotice(t('selectCreditCustomer'));
      return;
    }
    if (!online && paymentMethod !== 'CASH') {
      setNotice(t('cashOnlyOffline'));
      return;
    }
    setBusy(true);
    setNotice('');
    const payload = {
      paymentMethod,
      ...(customer ? { customerId: customer.id } : {}),
      ...(paymentReference.trim() ? { paymentReference: paymentReference.trim() } : {}),
      idempotencyKey: newIdempotencyKey(),
      lines: cart.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
    };
    // Personalize the quick-pick grid regardless of how the sale completes —
    // a queued offline sale is still a real sale for frequency purposes.
    void bumpMobilePosLiteFrequents(
      binding.terminalCode,
      cart.map((line) => line.product.id),
    ).then((counts) => setFrequents(counts));
    try {
      const result = await backendPost<SaleResult>('/mobile-pos-lite/sales', payload, {
        headers: terminalHeaders(binding),
      });
      setSaleResult(result);
      setScreen('success');
    } catch (error) {
      const canQueue =
        paymentMethod === 'CASH' &&
        session.terminal.offlineCashEnabled &&
        isConnectionProblem(error);
      if (!canQueue) {
        setNotice(error instanceof Error ? error.message : t('couldNotComplete'));
        return;
      }
      const pending: PendingMobilePosLiteSale = {
        id: crypto.randomUUID(),
        terminalCode: binding.terminalCode,
        payload,
        createdAt: new Date().toISOString(),
        totalAmount: total,
        itemCount: cartCount,
        lineSummary: cart
          .map((line) => `${line.quantity}× ${line.product.name}`)
          .join(', ')
          .slice(0, 160),
      };
      await enqueueMobilePosLiteSale(pending);
      await refreshPendingSales(binding);
      setSaleResult({ id: pending.id, totalAmount: total });
      setNotice(t('savedOffline'));
      setScreen('success');
    } finally {
      setBusy(false);
    }
  }

  // Supplier live-search for the purchase flow (min 2 chars, like customers).
  useEffect(() => {
    if (!binding || !online || screen !== 'purchase' || supplierQuery.trim().length < 2) {
      setSuppliers([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      backendGet<Supplier[]>('/mobile-pos-lite/suppliers', {
        headers: terminalHeaders(binding),
        query: { search: supplierQuery.trim() },
      })
        .then((results) => !cancelled && setSuppliers(results))
        .catch(() => !cancelled && setSuppliers([]));
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [binding, online, screen, supplierQuery]);

  const purchaseMatches = useMemo(() => {
    const term = purchaseQuery.trim().toLocaleLowerCase();
    if (term.length < 2) return [];
    return catalog
      .filter((product) =>
        [product.name, product.code, product.barcode ?? ''].some((value) =>
          value.toLocaleLowerCase().includes(term),
        ),
      )
      .slice(0, 8);
  }, [catalog, purchaseQuery]);

  const purchaseTotal = useMemo(
    () =>
      purchaseCart.reduce((sum, line) => {
        const cost = Number(line.unitCost.replace(/\D/g, ''));
        return sum + (Number.isFinite(cost) ? cost : 0) * line.quantity;
      }, 0),
    [purchaseCart],
  );

  function addPurchaseProduct(product: MobilePosLiteProduct) {
    setPurchaseCart((current) => {
      const match = current.find((line) => line.product.id === product.id);
      if (match)
        return current.map((line) =>
          line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line,
        );
      return [...current, { product, quantity: 1, unitCost: '' }];
    });
    setPurchaseQuery('');
  }

  function setPurchaseQuantity(productId: string, next: number) {
    setPurchaseCart((current) =>
      next <= 0
        ? current.filter((line) => line.product.id !== productId)
        : current.map((line) =>
            line.product.id === productId ? { ...line, quantity: next } : line,
          ),
    );
  }

  function beginPurchase() {
    setNotice('');
    setSupplier(null);
    setSupplierQuery('');
    setPurchaseCart([]);
    setPurchaseQuery('');
    setScreen('purchase');
  }

  async function recordPurchase() {
    if (!binding || purchaseCart.length === 0 || busy) return;
    if (!supplier) {
      setNotice(t('selectSupplierFirst'));
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      await backendPost(
        '/mobile-pos-lite/purchases',
        {
          supplierId: supplier.id,
          idempotencyKey: newIdempotencyKey(),
          lines: purchaseCart.map((line) => {
            const cost = Number(line.unitCost.replace(/\D/g, ''));
            return {
              productId: line.product.id,
              quantity: line.quantity,
              ...(cost > 0 ? { unitCost: cost } : {}),
            };
          }),
        },
        { headers: terminalHeaders(binding) },
      );
      showToast('success', t('purchaseComplete'), t('purchaseStockNote'));
      if (binding) void syncCatalog(binding).catch(() => undefined);
      setScreen('home');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t('couldNotComplete'));
    } finally {
      setBusy(false);
    }
  }

  async function openMySales() {
    if (!binding) return;
    setScreen('mySales');
    if (!online) {
      setDaySummary(null);
      return;
    }
    setDayLoading(true);
    try {
      const summary = await backendGet<DaySummary>('/mobile-pos-lite/my-sales-today', {
        headers: terminalHeaders(binding),
      });
      setDaySummary(summary);
    } catch {
      setDaySummary(null);
    } finally {
      setDayLoading(false);
    }
  }

  /**
   * Plain-text receipt shared via the phone's own share sheet (WhatsApp/SMS is
   * how TZ customers expect proof of purchase) — clipboard fallback elsewhere.
   * The cart is still populated on the success screen; it clears on New Sale.
   */
  async function shareReceipt() {
    if (!session) return;
    const text = [
      session.company.name,
      session.branch.name,
      new Date().toLocaleString('en-GB'),
      saleResult?.salesOrderNumber ?? saleResult?.receiptNumber ?? '',
      '--------------------',
      ...cart.map(
        (line) =>
          `${line.quantity} x ${line.product.name} = ${money(line.product.sellingPrice * line.quantity)}`,
      ),
      '--------------------',
      `${t('totalLabel')}: ${money(Number(saleResult?.totalAmount ?? total))}`,
      selectedPayment?.label ?? paymentMethod,
      '',
      t('receiptThanks'),
    ]
      .filter((line) => line !== '')
      .join('\n');
    if (typeof navigator.share === 'function') {
      // A rejected share is the user closing the sheet — nothing to surface.
      await navigator.share({ text }).catch(() => undefined);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      showToast('success', t('shareReceipt'), t('receiptCopied'));
    } catch {
      showToast('error', t('shareReceipt'), t('couldNotComplete'));
    }
  }

  async function leaveTerminal() {
    await logout();
  }

  async function resetTerminal() {
    await clearMobilePosLiteBinding();
    router.replace('/mobile-pos/activate');
  }

  async function removePending(id: string) {
    if (!binding) return;
    await removePendingMobilePosLiteSale(id);
    setConfirmRemoveId(null);
    await refreshPendingSales(binding);
  }

  if (!binding || !session) {
    return (
      <main
        className="grid min-h-screen place-items-center px-5"
        style={{ background: 'var(--aurora-bg)' }}
      >
        <div className="text-center">
          <RotateCw
            className="mx-auto h-7 w-7 animate-spin"
            style={{ color: 'var(--aurora-primary)' }}
            aria-hidden="true"
          />
          <p className="mt-3 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
            {notice || t('opening')}
          </p>
          {notice && (
            <button
              type="button"
              onClick={resetTerminal}
              className="mt-4 text-sm font-semibold text-brand-700 underline"
            >
              {t('setupAgain')}
            </button>
          )}
        </div>
      </main>
    );
  }

  if (screen === 'home') {
    return (
      <main className="min-h-screen px-4 py-4" style={{ background: 'var(--aurora-bg)' }}>
        <MobilePosHeader
          session={session}
          online={online}
          pendingCount={pendingCount}
          syncing={syncing}
          onLogout={leaveTerminal}
          lang={lang}
          setLang={setLang}
          t={t}
        />
        <section className="mx-auto mt-8 max-w-md">
          {!online && (
            <p
              className="mb-4 flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-semibold"
              style={{
                borderColor: 'var(--aurora-warning)',
                background: 'var(--aurora-warning-subtle)',
                color: 'var(--aurora-warning-text)',
              }}
            >
              <CloudOff size={17} aria-hidden="true" />{' '}
              {session.terminal.offlineCashEnabled ? t('offlineCanSell') : t('offline')}
            </p>
          )}
          <button
            type="button"
            onClick={beginSale}
            className="flex min-h-52 w-full flex-col items-center justify-center rounded-lg bg-brand-600 px-6 text-white shadow-lg transition active:scale-[0.98] hover:bg-brand-700"
          >
            <ShoppingCart size={44} strokeWidth={2.2} aria-hidden="true" />
            <span className="mt-4 text-2xl font-bold">{t('newSale')}</span>
          </button>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => setScreen('queue')}
              className="mt-4 flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left"
              style={{
                borderColor: 'var(--aurora-warning)',
                background: 'var(--aurora-warning-subtle)',
                color: 'var(--aurora-warning-text)',
              }}
            >
              <span className="font-semibold">{t('waitingCount', { count: pendingCount })}</span>
              <ChevronRight size={19} aria-hidden="true" />
            </button>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => void openMySales()}
              className="min-h-16 rounded-lg border px-4 text-base font-bold"
              style={{
                borderColor: 'var(--aurora-border)',
                background: 'var(--aurora-card)',
                color: 'var(--aurora-text)',
              }}
            >
              {t('mySalesToday')}
            </button>
            {session.purchasesEnabled && (
              <button
                type="button"
                onClick={beginPurchase}
                className="min-h-16 rounded-lg border px-4 text-base font-bold"
                style={{
                  borderColor: 'var(--aurora-border)',
                  background: 'var(--aurora-card)',
                  color: 'var(--aurora-text)',
                }}
              >
                {t('purchases')}
              </button>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (screen === 'mySales') {
    return (
      <main className="min-h-screen px-4 py-4" style={{ background: 'var(--aurora-bg)' }}>
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={() => setScreen('home')}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--aurora-primary-text)' }}
          >
            <ArrowLeft size={18} /> {t('back')}
          </button>
          <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('mySalesToday')}
          </h1>
          {!online ? (
            <p
              className="mt-4 rounded-lg px-4 py-3 text-sm font-semibold"
              style={{
                background: 'var(--aurora-warning-subtle)',
                color: 'var(--aurora-warning-text)',
              }}
            >
              {t('needsNetwork')}
            </p>
          ) : dayLoading ? (
            <div className="mt-8 text-center">
              <RotateCw
                className="mx-auto h-6 w-6 animate-spin"
                style={{ color: 'var(--aurora-primary)' }}
                aria-hidden="true"
              />
            </div>
          ) : daySummary ? (
            <>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div
                  className="rounded-lg border p-4"
                  style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
                >
                  <p
                    className="text-xs font-semibold uppercase"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {t('salesCountLabel')}
                  </p>
                  <p className="mt-1 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                    {daySummary.count}
                  </p>
                </div>
                <div
                  className="rounded-lg border p-4"
                  style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
                >
                  <p
                    className="text-xs font-semibold uppercase"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    {t('totalLabel')}
                  </p>
                  <p className="mt-1 text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                    {money(daySummary.totalAmount)}
                  </p>
                </div>
              </div>
              <section className="mt-4 space-y-2">
                {daySummary.sales.length === 0 && (
                  <p
                    className="rounded-lg border px-4 py-6 text-center text-sm font-medium"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      color: 'var(--aurora-text-secondary)',
                    }}
                  >
                    {t('noSalesToday')}
                  </p>
                )}
                {daySummary.sales.map((sale) => (
                  <div
                    key={sale.id}
                    className="flex items-center justify-between rounded-lg border p-3"
                    style={{
                      background: 'var(--aurora-card)',
                      borderColor: 'var(--aurora-border)',
                    }}
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-semibold"
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        {sale.salesOrderNumber}
                        {sale.customerName ? ` - ${sale.customerName}` : ''}
                      </p>
                      <p className="mt-0.5 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {pendingTime(sale.createdAt)} - {sale.paymentMethod}
                      </p>
                    </div>
                    <p
                      className="ml-3 flex-shrink-0 text-sm font-bold"
                      style={{ color: 'var(--aurora-text)' }}
                    >
                      {money(Number(sale.totalAmount))}
                    </p>
                  </div>
                ))}
              </section>
            </>
          ) : (
            <p
              className="mt-4 rounded-lg px-4 py-3 text-sm"
              style={{
                background: 'var(--aurora-danger-subtle)',
                color: 'var(--aurora-danger-text)',
              }}
            >
              {t('couldNotComplete')}
            </p>
          )}
        </div>
      </main>
    );
  }

  if (screen === 'purchase') {
    return (
      <main className="min-h-screen px-4 py-4 pb-32" style={{ background: 'var(--aurora-bg)' }}>
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={() => setScreen('home')}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--aurora-primary-text)' }}
          >
            <ArrowLeft size={18} /> {t('back')}
          </button>
          <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('purchases')}
          </h1>
          {!online && (
            <p
              className="mt-3 rounded-lg px-4 py-3 text-sm font-semibold"
              style={{
                background: 'var(--aurora-warning-subtle)',
                color: 'var(--aurora-warning-text)',
              }}
            >
              {t('needsNetwork')}
            </p>
          )}
          <div className="mt-4">
            <label className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {t('supplier')}
            </label>
            {supplier ? (
              <button
                type="button"
                onClick={() => {
                  setSupplier(null);
                  setSupplierQuery('');
                }}
                className="mt-2 flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left"
                style={{
                  borderColor: 'var(--aurora-success)',
                  background: 'var(--aurora-success-subtle)',
                  color: 'var(--aurora-success-text)',
                }}
              >
                <span className="font-semibold">{supplier.name}</span>
                <span className="text-sm">{t('change')}</span>
              </button>
            ) : (
              <>
                <div className="relative mt-2">
                  <Search
                    size={19}
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  />
                  <input
                    value={supplierQuery}
                    onChange={(event) => setSupplierQuery(event.target.value)}
                    className="aurora-input min-h-14 w-full rounded-lg py-3 pl-11 pr-4 text-base"
                    placeholder={t('supplierSearchPlaceholder')}
                  />
                </div>
                <div className="mt-2 space-y-2">
                  {suppliers.map((result) => (
                    <button
                      key={result.id}
                      type="button"
                      onClick={() => {
                        setSupplier(result);
                        setSuppliers([]);
                      }}
                      className="min-h-14 w-full rounded-lg border px-4 text-left"
                      style={{
                        borderColor: 'var(--aurora-border)',
                        background: 'var(--aurora-card)',
                      }}
                    >
                      <span className="block font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {result.name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {[result.supplierCode, result.phone].filter(Boolean).join(' - ')}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="relative mt-5">
            <Search
              size={19}
              className="absolute left-4 top-1/2 -translate-y-1/2"
              style={{ color: 'var(--aurora-text-muted)' }}
            />
            <input
              value={purchaseQuery}
              onChange={(event) => setPurchaseQuery(event.target.value)}
              className="aurora-input min-h-14 w-full rounded-lg py-3 pl-11 pr-4 text-base"
              placeholder={t('productSearchPlaceholder')}
            />
          </div>
          <section className="mt-3 space-y-2">
            {purchaseMatches.map((product) => (
              <button
                key={product.id}
                type="button"
                onClick={() => addPurchaseProduct(product)}
                className="flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left"
                style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
              >
                <span className="truncate font-semibold" style={{ color: 'var(--aurora-text)' }}>
                  {product.name}
                </span>
                <Plus size={18} style={{ color: 'var(--aurora-primary)' }} aria-hidden="true" />
              </button>
            ))}
          </section>
          {purchaseCart.length > 0 && (
            <section className="mt-6">
              <h2
                className="text-sm font-bold uppercase"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                {t('purchaseItems')}
              </h2>
              <div className="mt-2 space-y-2">
                {purchaseCart.map((line) => (
                  <div
                    key={line.product.id}
                    className="rounded-lg border p-3"
                    style={{
                      background: 'var(--aurora-card)',
                      borderColor: 'var(--aurora-border)',
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className="min-w-0 truncate font-semibold"
                        style={{ color: 'var(--aurora-text)' }}
                      >
                        {line.product.name}
                      </p>
                      <button
                        type="button"
                        onClick={() => setPurchaseQuantity(line.product.id, 0)}
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                        style={{ color: 'var(--aurora-danger)' }}
                        aria-label={t('removeItem', { name: line.product.name })}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPurchaseQuantity(line.product.id, line.quantity - 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg border"
                        style={{ borderColor: 'var(--aurora-border)' }}
                        aria-label={t('reduceItem', { name: line.product.name })}
                      >
                        <Minus size={18} />
                      </button>
                      <QuantityInput
                        key={line.product.id + '-' + line.quantity}
                        value={line.quantity}
                        label={t('quantityOf', { name: line.product.name })}
                        onCommit={(next) => setPurchaseQuantity(line.product.id, next)}
                      />
                      <button
                        type="button"
                        onClick={() => setPurchaseQuantity(line.product.id, line.quantity + 1)}
                        className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white"
                        aria-label={t('addItem', { name: line.product.name })}
                      >
                        <Plus size={18} />
                      </button>
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={line.unitCost}
                        onChange={(event) =>
                          setPurchaseCart((current) =>
                            current.map((item) =>
                              item.product.id === line.product.id
                                ? {
                                    ...item,
                                    unitCost: event.target.value
                                      .replace(/[^0-9]/g, '')
                                      .slice(0, 10),
                                  }
                                : item,
                            ),
                          )
                        }
                        className="aurora-input ml-2 min-h-10 w-full rounded-lg px-3 text-sm"
                        placeholder={t('buyingPrice') + ' ' + t('optional')}
                        aria-label={t('buyingPrice') + ' - ' + line.product.name}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
          {notice && (
            <p
              className="mt-4 rounded-lg px-4 py-3 text-sm"
              style={{ background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger)' }}
            >
              {notice}
            </p>
          )}
          <p className="mt-4 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            {t('purchaseStockNote')}
          </p>
          <button
            type="button"
            onClick={() => void recordPurchase()}
            disabled={busy || !online || purchaseCart.length === 0}
            className="mt-4 min-h-16 w-full rounded-lg bg-brand-600 px-5 text-lg font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy
              ? t('recording')
              : t('recordPurchase') + (purchaseTotal > 0 ? ' - ' + money(purchaseTotal) : '')}
          </button>
        </div>
      </main>
    );
  }

  if (screen === 'queue') {
    return (
      <main className="min-h-screen px-4 py-4" style={{ background: 'var(--aurora-bg)' }}>
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={() => {
              setConfirmRemoveId(null);
              setScreen('home');
            }}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--aurora-primary-text)' }}
          >
            <ArrowLeft size={18} /> {t('back')}
          </button>
          <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('queueTitle')}
          </h1>
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={() => void syncPendingSales(binding)}
              disabled={!online || syncing}
              className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-brand-600 px-4 text-base font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RotateCw size={18} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
              {syncing ? t('sending') : t('sendNow')}
            </button>
          )}
          <section className="mt-4 space-y-3" aria-live="polite">
            {pendingSales.length === 0 && (
              <p
                className="rounded-lg border px-4 py-6 text-center text-sm font-medium"
                style={{
                  borderColor: 'var(--aurora-border)',
                  color: 'var(--aurora-text-secondary)',
                }}
              >
                {t('queueEmpty')}
              </p>
            )}
            {pendingSales.map((item) => {
              const failed = Boolean(item.lastError);
              return (
                <article
                  key={item.id}
                  className="rounded-lg border p-4"
                  style={{
                    background: 'var(--aurora-card)',
                    borderColor: failed ? 'var(--aurora-danger)' : 'var(--aurora-border)',
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold" style={{ color: 'var(--aurora-text)' }}>
                        {money(Number(item.totalAmount ?? 0))}
                      </p>
                      {item.lineSummary && (
                        <p
                          className="mt-0.5 truncate text-sm"
                          style={{ color: 'var(--aurora-text-secondary)' }}
                        >
                          {item.lineSummary}
                        </p>
                      )}
                      <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {pendingTime(item.createdAt)}
                      </p>
                    </div>
                    <span
                      className="inline-flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-bold"
                      style={
                        failed
                          ? {
                              background: 'var(--aurora-danger-subtle)',
                              color: 'var(--aurora-danger-text)',
                            }
                          : {
                              background: 'var(--aurora-warning-subtle)',
                              color: 'var(--aurora-warning-text)',
                            }
                      }
                    >
                      {failed ? (
                        <AlertTriangle size={13} aria-hidden="true" />
                      ) : (
                        <Clock size={13} aria-hidden="true" />
                      )}
                      {failed ? t('queueFailed') : t('queueWaiting')}
                    </span>
                  </div>
                  {failed && (
                    <>
                      <p
                        className="mt-2 rounded-md px-3 py-2 text-xs"
                        style={{
                          background: 'var(--aurora-danger-subtle)',
                          color: 'var(--aurora-danger-text)',
                        }}
                      >
                        {item.lastError}
                      </p>
                      {confirmRemoveId === item.id ? (
                        <div
                          className="mt-3 rounded-md border p-3"
                          style={{ borderColor: 'var(--aurora-danger)' }}
                        >
                          <p className="text-sm font-bold" style={{ color: 'var(--aurora-text)' }}>
                            {t('removeConfirmTitle')}
                          </p>
                          <p
                            className="mt-1 text-xs"
                            style={{ color: 'var(--aurora-text-secondary)' }}
                          >
                            {t('removeConfirmBody')}
                          </p>
                          <div className="mt-3 flex gap-2">
                            <button
                              type="button"
                              onClick={() => void removePending(item.id)}
                              className="min-h-11 flex-1 rounded-lg px-3 text-sm font-bold text-white"
                              style={{ background: 'var(--aurora-danger)' }}
                            >
                              {t('confirmRemove')}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemoveId(null)}
                              className="min-h-11 flex-1 rounded-lg border px-3 text-sm font-semibold"
                              style={{
                                borderColor: 'var(--aurora-border)',
                                color: 'var(--aurora-text)',
                              }}
                            >
                              {t('keepIt')}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(item.id)}
                          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border px-4 text-sm font-semibold"
                          style={{
                            borderColor: 'var(--aurora-border)',
                            color: 'var(--aurora-danger)',
                          }}
                        >
                          <Trash2 size={15} aria-hidden="true" /> {t('remove')}
                        </button>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </section>
        </div>
      </main>
    );
  }

  if (screen === 'success') {
    return (
      <main className="min-h-screen px-4 py-4" style={{ background: 'var(--aurora-bg)' }}>
        <MobilePosHeader
          session={session}
          online={online}
          pendingCount={pendingCount}
          syncing={syncing}
          onLogout={leaveTerminal}
          lang={lang}
          setLang={setLang}
          t={t}
        />
        <section className="mx-auto mt-12 max-w-md text-center">
          <div
            className="mx-auto flex h-20 w-20 items-center justify-center rounded-full"
            style={{ background: 'var(--aurora-success-subtle)', color: 'var(--aurora-success)' }}
          >
            <CheckCircle2 size={48} aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {notice || t('saleComplete')}
          </h1>
          <p
            className="mt-2 text-lg font-semibold"
            style={{ color: 'var(--aurora-text-secondary)' }}
          >
            {money(Number(saleResult?.totalAmount ?? total))}
          </p>
          {saleResult?.salesOrderNumber && (
            <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              {saleResult.salesOrderNumber}
            </p>
          )}
          <button
            type="button"
            onClick={() => void shareReceipt()}
            className="mt-6 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border px-5 text-base font-bold"
            style={{
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
              color: 'var(--aurora-text)',
            }}
          >
            <Share2 size={19} aria-hidden="true" /> {t('shareReceipt')}
          </button>
          <button
            type="button"
            onClick={beginSale}
            className="mt-3 min-h-16 w-full rounded-lg bg-brand-600 px-5 text-lg font-bold text-white transition hover:bg-brand-700"
          >
            {t('newSale')}
          </button>
          <button
            type="button"
            onClick={() => setScreen('home')}
            className="mt-3 min-h-12 w-full rounded-lg text-base font-semibold"
            style={{ color: 'var(--aurora-primary-text)' }}
          >
            {t('home')}
          </button>
        </section>
      </main>
    );
  }

  if (screen === 'payment') {
    return (
      <main className="min-h-screen px-4 py-4 pb-28" style={{ background: 'var(--aurora-bg)' }}>
        <div className="mx-auto max-w-md">
          <button
            type="button"
            onClick={() => setScreen('sale')}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--aurora-primary-text)' }}
          >
            <ArrowLeft size={18} /> {t('backToSale')}
          </button>
          <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
            {t('payment')}
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('items', { count: cartCount })} · {money(total)}
          </p>
          {!online && (
            <p
              className="mt-3 rounded-lg px-4 py-3 text-sm font-semibold"
              style={{
                background: 'var(--aurora-warning-subtle)',
                color: 'var(--aurora-warning-text)',
              }}
            >
              {t('cashOnlyOffline')}
            </p>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3">
            {session.paymentMethods.map((method) => {
              const offlineBlocked = !online && method.code !== 'CASH';
              return (
                <button
                  key={method.code}
                  type="button"
                  disabled={offlineBlocked}
                  onClick={() => {
                    setPaymentMethod(method.code);
                    setCustomer(null);
                    setCustomerQuery('');
                  }}
                  className="min-h-20 rounded-lg border px-3 text-left text-base font-bold transition disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    borderColor:
                      paymentMethod === method.code
                        ? 'var(--aurora-primary)'
                        : 'var(--aurora-border)',
                    background:
                      paymentMethod === method.code
                        ? 'var(--aurora-primary-subtle)'
                        : 'var(--aurora-card)',
                    color:
                      paymentMethod === method.code
                        ? 'var(--aurora-primary-text)'
                        : 'var(--aurora-text)',
                  }}
                >
                  {method.label}
                </button>
              );
            })}
          </div>
          {paymentMethod === 'CREDIT' && (
            <div className="mt-6">
              <label className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
                {t('customer')}
              </label>
              {customer ? (
                <button
                  type="button"
                  onClick={() => {
                    setCustomer(null);
                    setCustomerQuery('');
                  }}
                  className="mt-2 flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left"
                  style={{
                    borderColor: 'var(--aurora-success)',
                    background: 'var(--aurora-success-subtle)',
                    color: 'var(--aurora-success-text)',
                  }}
                >
                  <span className="font-semibold">{customer.name}</span>
                  <span className="text-sm">{t('change')}</span>
                </button>
              ) : (
                <>
                  <div className="relative mt-2">
                    <Search
                      size={19}
                      className="absolute left-4 top-1/2 -translate-y-1/2"
                      style={{ color: 'var(--aurora-text-muted)' }}
                    />
                    <input
                      value={customerQuery}
                      onChange={(event) => setCustomerQuery(event.target.value)}
                      className="aurora-input min-h-14 w-full rounded-lg py-3 pl-11 pr-4 text-base"
                      placeholder={t('customerSearchPlaceholder')}
                      autoFocus
                    />
                  </div>
                  {customerQuery.trim().length > 0 && customerQuery.trim().length < 2 && (
                    <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                      {t('typeTwoLetters')}
                    </p>
                  )}
                  <div className="mt-2 space-y-2">
                    {customers.map((result) => (
                      <button
                        key={result.id}
                        type="button"
                        onClick={() => {
                          setCustomer(result);
                          setCustomers([]);
                        }}
                        className="min-h-14 w-full rounded-lg border px-4 text-left"
                        style={{
                          borderColor: 'var(--aurora-border)',
                          background: 'var(--aurora-card)',
                        }}
                      >
                        <span
                          className="block font-semibold"
                          style={{ color: 'var(--aurora-text)' }}
                        >
                          {result.name}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {[result.customerCode, result.phone].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {paymentMethod === 'CASH' && (
            <div className="mt-6">
              <label
                className="block text-sm font-semibold"
                style={{ color: 'var(--aurora-text)' }}
              >
                {t('received')}{' '}
                <span className="font-normal" style={{ color: 'var(--aurora-text-muted)' }}>
                  {t('optional')}
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={receivedValue}
                  onChange={(event) =>
                    setReceivedValue(event.target.value.replace(/\D/g, '').slice(0, 10))
                  }
                  className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-lg font-bold"
                  placeholder="0"
                />
              </label>
              <div className="mt-2 flex flex-wrap gap-2">
                {[
                  { label: t('exactAmount'), amount: Math.ceil(total) },
                  ...[5000, 10000, 20000, 50000]
                    .filter((amount) => amount >= total)
                    .slice(0, 3)
                    .map((amount) => ({ label: money(amount), amount })),
                ].map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => setReceivedValue(String(option.amount))}
                    className="min-h-11 rounded-lg border px-3 text-sm font-semibold"
                    style={{
                      borderColor: 'var(--aurora-border)',
                      background: 'var(--aurora-card)',
                      color: 'var(--aurora-text)',
                    }}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              {receivedAmount !== null &&
                (receivedAmount >= total ? (
                  <p
                    className="mt-3 rounded-lg px-4 py-3 text-xl font-bold"
                    style={{
                      background: 'var(--aurora-success-subtle)',
                      color: 'var(--aurora-success-text)',
                    }}
                  >
                    {t('changeDue')}: {money(receivedAmount - total)}
                  </p>
                ) : (
                  <p
                    className="mt-3 rounded-lg px-4 py-3 text-base font-semibold"
                    style={{
                      background: 'var(--aurora-warning-subtle)',
                      color: 'var(--aurora-warning-text)',
                    }}
                  >
                    {t('stillOwed')}: {money(total - receivedAmount)}
                  </p>
                ))}
            </div>
          )}
          {selectedPayment?.requiresReference && (
            <label
              className="mt-6 block text-sm font-semibold"
              style={{ color: 'var(--aurora-text)' }}
            >
              {t('reference')}{' '}
              <span className="font-normal" style={{ color: 'var(--aurora-text-muted)' }}>
                {t('optional')}
              </span>
              <input
                value={paymentReference}
                onChange={(event) => setPaymentReference(event.target.value)}
                className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-base"
                placeholder={t('referencePlaceholder')}
              />
            </label>
          )}
          {notice && (
            <p
              className="mt-5 rounded-lg px-4 py-3 text-sm"
              style={{ background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger)' }}
            >
              {notice}
            </p>
          )}
          <button
            type="button"
            onClick={() => void completeSale()}
            disabled={busy}
            className="mt-8 min-h-16 w-full rounded-lg bg-brand-600 px-5 text-lg font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? t('completing') : `${t('completeSale')} · ${money(total)}`}
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-4 pb-32" style={{ background: 'var(--aurora-bg)' }}>
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setScreen('home')}
            className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold"
            style={{ color: 'var(--aurora-primary-text)' }}
          >
            <ArrowLeft size={18} /> {t('cancelSale')}
          </button>
          <span
            className="text-sm font-semibold"
            style={{ color: online ? 'var(--aurora-success)' : 'var(--aurora-warning)' }}
          >
            {online ? t('online') : t('offline')}
          </span>
        </div>
        <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>
          {t('addProducts')}
        </h1>
        <div className="relative mt-4">
          <Search
            size={21}
            className="absolute left-4 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--aurora-text-muted)' }}
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="aurora-input min-h-16 w-full rounded-lg py-3 pl-12 pr-4 text-lg"
            placeholder={t('productSearchPlaceholder')}
            autoFocus
          />
        </div>
        {query.trim().length > 0 && query.trim().length < 2 && (
          <p className="mt-3 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            {t('typeTwoOrScan')}
          </p>
        )}
        {query.trim().length === 0 && quickPicks.length > 0 && (
          <section className="mt-4">
            <h2
              className="text-sm font-bold uppercase"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('bestSellers')}
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {quickPicks.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => addProduct(product)}
                  className="flex min-h-24 flex-col items-start justify-between rounded-lg border p-3 text-left transition active:scale-[0.98]"
                  style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
                >
                  {product.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- authenticated proxy image; next/image optimization would strip the cookie path
                    <img
                      src={`/api/backend${product.imageUrl}`}
                      alt=""
                      loading="lazy"
                      className="mb-2 h-16 w-full rounded-md object-cover"
                      onError={(event) => {
                        // Offline or missing file: collapse to the text-only tile.
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  )}
                  <span
                    className="block w-full text-sm font-bold leading-snug"
                    style={{
                      color: 'var(--aurora-text)',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {product.name}
                  </span>
                  <span
                    className="mt-2 block text-sm font-bold"
                    style={{ color: 'var(--aurora-primary-text)' }}
                  >
                    {money(product.sellingPrice)}
                  </span>
                </button>
              ))}
            </div>
            <p className="mt-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              {t('allProducts')}
            </p>
          </section>
        )}
        <section className="mt-4 space-y-2" aria-live="polite">
          {matches.map((product) => (
            <button
              key={product.id}
              type="button"
              onClick={() => addProduct(product)}
              className="flex min-h-20 w-full items-center justify-between rounded-lg border px-4 text-left transition active:scale-[0.99]"
              style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
            >
              <span className="min-w-0">
                <span
                  className="block truncate text-base font-bold"
                  style={{ color: 'var(--aurora-text)' }}
                >
                  {product.name}
                </span>
                <span
                  className="mt-1 block text-sm"
                  style={{ color: 'var(--aurora-text-secondary)' }}
                >
                  {product.code}{' '}
                  {product.availableStock !== null
                    ? `· ${t('stock', { count: product.availableStock })}`
                    : ''}
                </span>
              </span>
              <span
                className="ml-3 flex-shrink-0 text-base font-bold"
                style={{ color: 'var(--aurora-primary-text)' }}
              >
                {money(product.sellingPrice)}
              </span>
            </button>
          ))}
          {query.trim().length >= 2 && matches.length === 0 && (
            <p
              className="rounded-lg border px-4 py-5 text-center text-sm"
              style={{ color: 'var(--aurora-text-muted)', borderColor: 'var(--aurora-border)' }}
            >
              {t('noMatch')}
            </p>
          )}
        </section>
        {cart.length > 0 && (
          <section className="mt-7">
            <h2
              className="text-sm font-bold uppercase"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              {t('saleItems')}
            </h2>
            <div className="mt-2 space-y-2">
              {cart.map((line) => (
                <div
                  key={line.product.id}
                  className="flex items-center gap-3 rounded-lg border p-3"
                  style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" style={{ color: 'var(--aurora-text)' }}>
                      {line.product.name}
                    </p>
                    <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                      {money(line.product.sellingPrice * line.quantity)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQuantity(line.product.id, line.quantity - 1)}
                      className="flex h-10 w-10 items-center justify-center rounded-lg border"
                      style={{ borderColor: 'var(--aurora-border)' }}
                      aria-label={t('reduceItem', { name: line.product.name })}
                    >
                      <Minus size={18} />
                    </button>
                    <QuantityInput
                      key={`${line.product.id}-${line.quantity}`}
                      value={line.quantity}
                      label={t('quantityOf', { name: line.product.name })}
                      onCommit={(next) => setQuantity(line.product.id, next)}
                    />
                    <button
                      type="button"
                      onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                      className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white"
                      aria-label={t('addItem', { name: line.product.name })}
                    >
                      <Plus size={18} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuantity(line.product.id, 0)}
                      className="ml-1 flex h-10 w-10 items-center justify-center rounded-lg"
                      style={{ color: 'var(--aurora-danger)' }}
                      aria-label={t('removeItem', { name: line.product.name })}
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      {cart.length > 0 && (
        <div
          className="fixed inset-x-0 bottom-0 border-t p-4"
          style={{
            background: 'var(--aurora-card)',
            borderColor: 'var(--aurora-border)',
            boxShadow: 'var(--aurora-shadow-lg)',
          }}
        >
          <div className="mx-auto flex max-w-md items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                {t('items', { count: cartCount })}
              </p>
              <p className="text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>
                {money(total)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setNotice('');
                setScreen('payment');
              }}
              className="inline-flex min-h-14 items-center gap-2 rounded-lg bg-brand-600 px-5 text-base font-bold text-white"
            >
              {t('pay')} <ChevronRight size={19} />
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

/**
 * Direct quantity entry: tap the number, type with the phone's numeric
 * keyboard, blur/Enter commits. Selling 40 crates must not take 40 taps.
 * Remounted via `key` when +/- change the quantity, so the draft never fights
 * external updates. An emptied or zeroed field restores the previous value —
 * removal stays an explicit action on the trash button.
 */
function QuantityInput({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  function commit() {
    const parsed = Number.parseInt(draft, 10);
    if (!Number.isFinite(parsed) || parsed < 1) {
      setDraft(String(value));
      return;
    }
    if (parsed !== value) onCommit(Math.min(parsed, 9999));
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      value={draft}
      aria-label={label}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 4))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className="h-10 w-14 rounded-lg border text-center text-base font-bold"
      style={{
        borderColor: 'var(--aurora-border)',
        background: 'var(--aurora-card)',
        color: 'var(--aurora-text)',
      }}
    />
  );
}

function MobilePosHeader({
  session,
  online,
  pendingCount,
  syncing,
  onLogout,
  lang,
  setLang,
  t,
}: {
  session: Session;
  online: boolean;
  pendingCount: number;
  syncing: boolean;
  onLogout: () => void;
  lang: PosLang;
  setLang: (lang: PosLang) => void;
  t: (key: PosStringKey, vars?: Record<string, string | number>) => string;
}) {
  return (
    <header className="mx-auto flex max-w-md items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-base font-bold" style={{ color: 'var(--aurora-text)' }}>
          {session.branch.name}
        </p>
        <p className="mt-0.5 truncate text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
          {session.rep.name}
        </p>
        <p
          className="mt-1 inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: online ? 'var(--aurora-success)' : 'var(--aurora-warning)' }}
        >
          {online ? <Wifi size={13} /> : <CloudOff size={13} />}
          {online
            ? pendingCount
              ? t('waitingCount', { count: pendingCount })
              : syncing
                ? t('sending')
                : t('ready')
            : t('offline')}
        </p>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => setLang(lang === 'sw' ? 'en' : 'sw')}
          className="flex h-11 min-w-11 items-center justify-center rounded-lg border px-2 text-xs font-bold"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
          aria-label={lang === 'sw' ? 'Switch to English' : 'Badili kwenda Kiswahili'}
        >
          {lang === 'sw' ? 'EN' : 'SW'}
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="flex h-11 w-11 items-center justify-center rounded-lg border"
          style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}
          aria-label={t('logOut')}
          title={t('logOut')}
        >
          <LogOut size={19} />
        </button>
      </div>
    </header>
  );
}

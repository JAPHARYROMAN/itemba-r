'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  CloudOff,
  LogOut,
  Minus,
  Plus,
  RotateCw,
  Search,
  ShoppingCart,
  Trash2,
  Wifi,
} from 'lucide-react';
import { backendGet, backendPost } from '@/lib/api-client';
import {
  clearMobilePosLiteBinding,
  enqueueMobilePosLiteSale,
  getMobilePosLiteBinding,
  getMobilePosLiteCatalog,
  getPendingMobilePosLiteSales,
  removePendingMobilePosLiteSale,
  saveMobilePosLiteCatalog,
  type MobilePosLiteBinding,
  type MobilePosLiteProduct,
  type PendingMobilePosLiteSale,
  updatePendingMobilePosLiteSaleError,
} from '@/lib/mobile-pos-lite-store';
import { useAuth } from '@/hooks/use-auth';

type Session = {
  terminal: { id: string; code: string; name: string; configVersion: number; offlineCashEnabled: boolean };
  company: { id: string; name: string; code: string };
  division: { id: string; name: string; code: string };
  branch: { id: string; name: string; code: string };
  rep: { id: string; name: string };
  paymentMethods: Array<{ code: string; label: string; requiresReference: boolean }>;
};

type Customer = { id: string; name: string; customerCode?: string | null; phone?: string | null };
type CartLine = { product: MobilePosLiteProduct; quantity: number };
type SaleResult = { id: string; salesOrderNumber?: string; totalAmount?: number; receiptNumber?: string };

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

export function MobilePosLite() {
  const router = useRouter();
  const { logout } = useAuth();
  const [binding, setBinding] = useState<MobilePosLiteBinding | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [catalog, setCatalog] = useState<MobilePosLiteProduct[]>([]);
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [screen, setScreen] = useState<'home' | 'sale' | 'payment' | 'success'>('home');
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
  const [notice, setNotice] = useState('');
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);

  const refreshPendingCount = useCallback(async (current: MobilePosLiteBinding) => {
    const items = await getPendingMobilePosLiteSales(current.terminalCode);
    setPendingCount(items.length);
    return items;
  }, []);

  const updateCatalog = useCallback((terminalCode: string, products: MobilePosLiteProduct[]) => {
    setCatalog((current) => {
      const merged = mergeProducts(current, products);
      void saveMobilePosLiteCatalog(terminalCode, merged);
      return merged;
    });
  }, []);

  const syncPendingSales = useCallback(async (current: MobilePosLiteBinding) => {
    if (!navigator.onLine || syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const pending = await getPendingMobilePosLiteSales(current.terminalCode);
      for (const item of pending) {
        try {
          await backendPost('/mobile-pos-lite/sales', item.payload, { headers: terminalHeaders(current) });
          await removePendingMobilePosLiteSale(item.id);
        } catch (error) {
          if (isConnectionProblem(error)) break;
          await updatePendingMobilePosLiteSaleError(
            item.id,
            error instanceof Error ? error.message : 'This sale still needs attention.',
          );
        }
      }
      await refreshPendingCount(current);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  }, [refreshPendingCount]);

  const loadSession = useCallback(async (current: MobilePosLiteBinding) => {
    const currentSession = await backendGet<Session>('/mobile-pos-lite/session', {
      headers: terminalHeaders(current),
    });
    setSession(currentSession);
    setPaymentMethod(currentSession.paymentMethods[0]?.code ?? 'CASH');
  }, []);

  const syncCatalog = useCallback(async (current: MobilePosLiteBinding) => {
    if (!navigator.onLine) return;
    const products = await backendGet<MobilePosLiteProduct[]>('/mobile-pos-lite/catalog', {
      headers: terminalHeaders(current),
    });
    updateCatalog(current.terminalCode, products);
  }, [updateCatalog]);

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
        try {
          await loadSession(stored);
          await refreshPendingCount(stored);
          void syncCatalog(stored);
          void syncPendingSales(stored);
        } catch (error) {
          if (cancelled) return;
          setNotice(error instanceof Error ? error.message : 'This terminal is not available.');
        }
      })
      .catch(() => router.replace('/mobile-pos/activate'));
    return () => {
      cancelled = true;
    };
  }, [loadSession, refreshPendingCount, router, syncCatalog, syncPendingSales]);

  useEffect(() => {
    if (!binding || !online) return;
    void syncPendingSales(binding);
  }, [binding, online, syncPendingSales]);

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
    const local = term.length < 2
      ? []
      : catalog.filter((product) => [product.name, product.code, product.barcode ?? ''].some((value) => value.toLocaleLowerCase().includes(term))).slice(0, 12);
    return mergeProducts(local, remoteProducts).slice(0, 12);
  }, [catalog, query, remoteProducts]);

  const total = useMemo(
    () => cart.reduce((sum, line) => sum + line.product.sellingPrice * line.quantity, 0),
    [cart],
  );
  const cartCount = useMemo(() => cart.reduce((sum, line) => sum + line.quantity, 0), [cart]);
  const selectedPayment = session?.paymentMethods.find((method) => method.code === paymentMethod);

  function addProduct(product: MobilePosLiteProduct) {
    setCart((current) => {
      const match = current.find((line) => line.product.id === product.id);
      if (match) return current.map((line) => line.product.id === product.id ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { product, quantity: 1 }];
    });
    setQuery('');
    setRemoteProducts([]);
  }

  function setQuantity(productId: string, next: number) {
    setCart((current) => next <= 0 ? current.filter((line) => line.product.id !== productId) : current.map((line) => line.product.id === productId ? { ...line, quantity: next } : line));
  }

  function beginSale() {
    setNotice('');
    setCart([]);
    setQuery('');
    setCustomer(null);
    setCustomerQuery('');
    setPaymentReference('');
    setPaymentMethod(session?.paymentMethods[0]?.code ?? 'CASH');
    setScreen('sale');
  }

  async function completeSale() {
    if (!binding || !session || cart.length === 0) return;
    if (paymentMethod === 'CREDIT' && !customer) {
      setNotice('Select the customer for this credit sale.');
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
    try {
      const result = await backendPost<SaleResult>('/mobile-pos-lite/sales', payload, {
        headers: terminalHeaders(binding),
      });
      setSaleResult(result);
      setScreen('success');
    } catch (error) {
      const canQueue = paymentMethod === 'CASH' && session.terminal.offlineCashEnabled && isConnectionProblem(error);
      if (!canQueue) {
        setNotice(error instanceof Error ? error.message : 'The sale could not be completed.');
        return;
      }
      const pending: PendingMobilePosLiteSale = {
        id: crypto.randomUUID(),
        terminalCode: binding.terminalCode,
        payload,
        createdAt: new Date().toISOString(),
      };
      await enqueueMobilePosLiteSale(pending);
      await refreshPendingCount(binding);
      setSaleResult({ id: pending.id, totalAmount: total });
      setNotice('Saved on this phone. It will complete when the connection returns.');
      setScreen('success');
    } finally {
      setBusy(false);
    }
  }

  async function leaveTerminal() {
    await logout();
  }

  async function resetTerminal() {
    await clearMobilePosLiteBinding();
    router.replace('/mobile-pos/activate');
  }

  if (!binding || !session) {
    return (
      <main className="grid min-h-screen place-items-center px-5" style={{ background: 'var(--aurora-bg)' }}>
        <div className="text-center">
          <RotateCw className="mx-auto h-7 w-7 animate-spin" style={{ color: 'var(--aurora-primary)' }} aria-hidden="true" />
          <p className="mt-3 text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>{notice || 'Opening Mobile POS...'}</p>
          {notice && <button type="button" onClick={resetTerminal} className="mt-4 text-sm font-semibold text-brand-700 underline">Set up this phone again</button>}
        </div>
      </main>
    );
  }

  if (screen === 'home') {
    return (
      <main className="min-h-screen px-4 py-4" style={{ background: 'var(--aurora-bg)' }}>
        <MobilePosHeader session={session} online={online} pendingCount={pendingCount} syncing={syncing} onLogout={leaveTerminal} />
        <section className="mx-auto mt-8 max-w-md">
          <button type="button" onClick={beginSale} className="flex min-h-52 w-full flex-col items-center justify-center rounded-lg bg-brand-600 px-6 text-white shadow-lg transition active:scale-[0.98] hover:bg-brand-700">
            <ShoppingCart size={44} strokeWidth={2.2} aria-hidden="true" />
            <span className="mt-4 text-2xl font-bold">New Sale</span>
          </button>
          {pendingCount > 0 && (
            <button type="button" onClick={() => void syncPendingSales(binding)} disabled={!online || syncing} className="mt-4 flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left disabled:opacity-60" style={{ borderColor: 'var(--aurora-warning)', background: 'var(--aurora-warning-subtle)', color: 'var(--aurora-warning-text)' }}>
              <span className="font-semibold">{pendingCount} sale{pendingCount === 1 ? '' : 's'} waiting to sync</span>
              <RotateCw size={19} className={syncing ? 'animate-spin' : ''} aria-hidden="true" />
            </button>
          )}
        </section>
      </main>
    );
  }

  if (screen === 'success') {
    return (
      <main className="min-h-screen px-4 py-4" style={{ background: 'var(--aurora-bg)' }}>
        <MobilePosHeader session={session} online={online} pendingCount={pendingCount} syncing={syncing} onLogout={leaveTerminal} />
        <section className="mx-auto mt-12 max-w-md text-center">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full" style={{ background: 'var(--aurora-success-subtle)', color: 'var(--aurora-success)' }}><CheckCircle2 size={48} aria-hidden="true" /></div>
          <h1 className="mt-5 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>{notice || 'Sale complete'}</h1>
          <p className="mt-2 text-lg font-semibold" style={{ color: 'var(--aurora-text-secondary)' }}>{money(Number(saleResult?.totalAmount ?? total))}</p>
          {saleResult?.salesOrderNumber && <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>{saleResult.salesOrderNumber}</p>}
          <button type="button" onClick={beginSale} className="mt-8 min-h-16 w-full rounded-lg bg-brand-600 px-5 text-lg font-bold text-white transition hover:bg-brand-700">New Sale</button>
          <button type="button" onClick={() => setScreen('home')} className="mt-3 min-h-12 w-full rounded-lg text-base font-semibold" style={{ color: 'var(--aurora-primary-text)' }}>Home</button>
        </section>
      </main>
    );
  }

  if (screen === 'payment') {
    return (
      <main className="min-h-screen px-4 py-4 pb-28" style={{ background: 'var(--aurora-bg)' }}>
        <div className="mx-auto max-w-md">
          <button type="button" onClick={() => setScreen('sale')} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold" style={{ color: 'var(--aurora-primary-text)' }}><ArrowLeft size={18} /> Back to sale</button>
          <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>Payment</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>{cartCount} item{cartCount === 1 ? '' : 's'} · {money(total)}</p>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {session.paymentMethods.map((method) => (
              <button key={method.code} type="button" onClick={() => { setPaymentMethod(method.code); setCustomer(null); setCustomerQuery(''); }} className="min-h-20 rounded-lg border px-3 text-left text-base font-bold transition" style={{ borderColor: paymentMethod === method.code ? 'var(--aurora-primary)' : 'var(--aurora-border)', background: paymentMethod === method.code ? 'var(--aurora-primary-subtle)' : 'var(--aurora-card)', color: paymentMethod === method.code ? 'var(--aurora-primary-text)' : 'var(--aurora-text)' }}>
                {method.label}
              </button>
            ))}
          </div>
          {paymentMethod === 'CREDIT' && (
            <div className="mt-6">
              <label className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Customer</label>
              {customer ? (
                <button type="button" onClick={() => { setCustomer(null); setCustomerQuery(''); }} className="mt-2 flex min-h-14 w-full items-center justify-between rounded-lg border px-4 text-left" style={{ borderColor: 'var(--aurora-success)', background: 'var(--aurora-success-subtle)', color: 'var(--aurora-success-text)' }}><span className="font-semibold">{customer.name}</span><span className="text-sm">Change</span></button>
              ) : (
                <>
                  <div className="relative mt-2"><Search size={19} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--aurora-text-muted)' }} /><input value={customerQuery} onChange={(event) => setCustomerQuery(event.target.value)} className="aurora-input min-h-14 w-full rounded-lg py-3 pl-11 pr-4 text-base" placeholder="Name, phone or customer code" autoFocus /></div>
                  {customerQuery.trim().length > 0 && customerQuery.trim().length < 2 && <p className="mt-2 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Type two letters to search.</p>}
                  <div className="mt-2 space-y-2">
                    {customers.map((result) => <button key={result.id} type="button" onClick={() => { setCustomer(result); setCustomers([]); }} className="min-h-14 w-full rounded-lg border px-4 text-left" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)' }}><span className="block font-semibold" style={{ color: 'var(--aurora-text)' }}>{result.name}</span><span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{[result.customerCode, result.phone].filter(Boolean).join(' · ')}</span></button>)}
                  </div>
                </>
              )}
            </div>
          )}
          {selectedPayment?.requiresReference && <label className="mt-6 block text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>Reference <span className="font-normal" style={{ color: 'var(--aurora-text-muted)' }}>(optional)</span><input value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} className="aurora-input mt-2 min-h-14 w-full rounded-lg px-4 text-base" placeholder="Reference number" /></label>}
          {notice && <p className="mt-5 rounded-lg px-4 py-3 text-sm" style={{ background: 'var(--aurora-danger-subtle)', color: 'var(--aurora-danger)' }}>{notice}</p>}
          <button type="button" onClick={() => void completeSale()} disabled={busy} className="mt-8 min-h-16 w-full rounded-lg bg-brand-600 px-5 text-lg font-bold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Completing Sale...' : `Complete Sale · ${money(total)}`}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-4 py-4 pb-32" style={{ background: 'var(--aurora-bg)' }}>
      <div className="mx-auto max-w-md">
        <div className="flex items-center justify-between"><button type="button" onClick={() => setScreen('home')} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold" style={{ color: 'var(--aurora-primary-text)' }}><ArrowLeft size={18} /> Cancel sale</button><span className="text-sm font-semibold" style={{ color: online ? 'var(--aurora-success)' : 'var(--aurora-warning)' }}>{online ? 'Online' : 'Offline'}</span></div>
        <h1 className="mt-4 text-2xl font-bold" style={{ color: 'var(--aurora-text)' }}>Add products</h1>
        <div className="relative mt-4"><Search size={21} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--aurora-text-muted)' }} /><input value={query} onChange={(event) => setQuery(event.target.value)} className="aurora-input min-h-16 w-full rounded-lg py-3 pl-12 pr-4 text-lg" placeholder="Search or scan product" autoFocus /></div>
        {query.trim().length > 0 && query.trim().length < 2 && <p className="mt-3 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>Type two letters or scan a barcode.</p>}
        <section className="mt-4 space-y-2" aria-live="polite">
          {matches.map((product) => <button key={product.id} type="button" onClick={() => addProduct(product)} className="flex min-h-20 w-full items-center justify-between rounded-lg border px-4 text-left transition active:scale-[0.99]" style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}><span className="min-w-0"><span className="block truncate text-base font-bold" style={{ color: 'var(--aurora-text)' }}>{product.name}</span><span className="mt-1 block text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>{product.code} {product.availableStock !== null ? `· Stock ${product.availableStock}` : ''}</span></span><span className="ml-3 flex-shrink-0 text-base font-bold" style={{ color: 'var(--aurora-primary-text)' }}>{money(product.sellingPrice)}</span></button>)}
          {query.trim().length >= 2 && matches.length === 0 && <p className="rounded-lg border px-4 py-5 text-center text-sm" style={{ color: 'var(--aurora-text-muted)', borderColor: 'var(--aurora-border)' }}>No matching product.</p>}
        </section>
        {cart.length > 0 && <section className="mt-7"><h2 className="text-sm font-bold uppercase" style={{ color: 'var(--aurora-text-secondary)' }}>Sale items</h2><div className="mt-2 space-y-2">{cart.map((line) => <div key={line.product.id} className="flex items-center gap-3 rounded-lg border p-3" style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}><div className="min-w-0 flex-1"><p className="truncate font-semibold" style={{ color: 'var(--aurora-text)' }}>{line.product.name}</p><p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>{money(line.product.sellingPrice * line.quantity)}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setQuantity(line.product.id, line.quantity - 1)} className="flex h-10 w-10 items-center justify-center rounded-lg border" style={{ borderColor: 'var(--aurora-border)' }} aria-label={`Reduce ${line.product.name}`}><Minus size={18} /></button><span className="w-7 text-center text-base font-bold" style={{ color: 'var(--aurora-text)' }}>{line.quantity}</span><button type="button" onClick={() => setQuantity(line.product.id, line.quantity + 1)} className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-600 text-white" aria-label={`Add ${line.product.name}`}><Plus size={18} /></button><button type="button" onClick={() => setQuantity(line.product.id, 0)} className="ml-1 flex h-10 w-10 items-center justify-center rounded-lg" style={{ color: 'var(--aurora-danger)' }} aria-label={`Remove ${line.product.name}`}><Trash2 size={18} /></button></div></div>)}</div></section>}
      </div>
      {cart.length > 0 && <div className="fixed inset-x-0 bottom-0 border-t p-4" style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-lg)' }}><div className="mx-auto flex max-w-md items-center gap-4"><div className="min-w-0 flex-1"><p className="text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>{cartCount} item{cartCount === 1 ? '' : 's'}</p><p className="text-xl font-bold" style={{ color: 'var(--aurora-text)' }}>{money(total)}</p></div><button type="button" onClick={() => { setNotice(''); setScreen('payment'); }} className="inline-flex min-h-14 items-center gap-2 rounded-lg bg-brand-600 px-5 text-base font-bold text-white">Pay <ChevronRight size={19} /></button></div></div>}
    </main>
  );
}

function MobilePosHeader({ session, online, pendingCount, syncing, onLogout }: { session: Session; online: boolean; pendingCount: number; syncing: boolean; onLogout: () => void }) {
  return <header className="mx-auto flex max-w-md items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-base font-bold" style={{ color: 'var(--aurora-text)' }}>{session.branch.name}</p><p className="mt-0.5 truncate text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>{session.rep.name}</p><p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold" style={{ color: online ? 'var(--aurora-success)' : 'var(--aurora-warning)' }}>{online ? <Wifi size={13} /> : <CloudOff size={13} />}{online ? (pendingCount ? `${pendingCount} waiting` : syncing ? 'Syncing' : 'Ready') : 'Offline'}</p></div><button type="button" onClick={onLogout} className="flex h-11 w-11 items-center justify-center rounded-lg border" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }} aria-label="Log out" title="Log out"><LogOut size={19} /></button></header>;
}

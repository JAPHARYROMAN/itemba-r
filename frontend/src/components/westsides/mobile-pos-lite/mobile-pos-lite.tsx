'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCw } from 'lucide-react';
import { showToast } from '@/components/ui';
import { backendGet, backendPost } from '@/lib/api-client';
import {
  bumpDaylogTally,
  bumpMobilePosLiteFrequents,
  clearMobilePosLiteBinding,
  enqueueMobilePosLiteSale,
  posDaylogDate,
  removePendingMobilePosLiteSale,
  updatePendingMobilePosLiteSaleError,
  writeDaylogSent,
  type MobilePosLiteProduct,
  type PendingMobilePosLiteSale,
} from '@/lib/mobile-pos-lite-store';
import { useAuth } from '@/hooks/use-auth';
import { KauntaShell } from './KauntaShell';
import { usePosBootstrap } from './hooks/use-pos-bootstrap';
import { usePosCart } from './hooks/use-pos-cart';
import { usePosOutbox } from './hooks/use-pos-outbox';
import { reject, stampHeld, stampSent } from './pos-haptics';
import { usePosLang } from './pos-i18n';
import { sharePdfReceipt } from './pos-receipt';
import type {
  Customer,
  DaySummary,
  PosScreen,
  PurchaseLine,
  SaleResult,
  Supplier,
} from './pos-types';
import { isConnectionProblem, money, newIdempotencyKey, terminalHeaders } from './pos-utils';
import { HomeScreen } from './screens/HomeScreen';
import { MySalesScreen } from './screens/MySalesScreen';
import { PaymentScreen } from './screens/PaymentScreen';
import { PurchaseScreen } from './screens/PurchaseScreen';
import { QueueScreen } from './screens/QueueScreen';
import { SaleScreen } from './screens/SaleScreen';
import { SuccessScreen } from './screens/SuccessScreen';

export function MobilePosLite() {
  const router = useRouter();
  const { logout } = useAuth();
  const { lang, setLang, t } = usePosLang();
  const [screen, setScreen] = useState<PosScreen>('home');
  const [paymentMethod, setPaymentMethod] = useState('CASH');
  const [paymentReference, setPaymentReference] = useState('');
  const [customerQuery, setCustomerQuery] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [saleResult, setSaleResult] = useState<SaleResult | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  // Owned here, not by a hook: the bootstrap boot effect writes these three
  // cells (initial frequents, session-default payment method, boot errors)
  // while their consumers run after bootstrap — hook-owning any of them would
  // be a circular hook dependency. Raw setters go in as stable args.
  const [frequents, setFrequents] = useState<Record<string, number>>({});
  const { pendingSales, syncing, refreshPendingSales, syncPendingSales } = usePosOutbox();
  const { binding, session, catalog, online, updateCatalog, syncCatalog } = usePosBootstrap({
    refreshPendingSales,
    syncPendingSales,
    setFrequents,
    setPaymentMethod,
    setNotice,
    t,
  });
  const {
    cart,
    setCart,
    query,
    setQuery,
    matches,
    total,
    cartCount,
    quickPicks,
    addProduct,
    setQuantity,
  } = usePosCart({ binding, online, catalog, updateCatalog, frequents });
  const [receivedValue, setReceivedValue] = useState('');
  const [supplierQuery, setSupplierQuery] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [purchaseCart, setPurchaseCart] = useState<PurchaseLine[]>([]);
  const [purchaseQuery, setPurchaseQuery] = useState('');
  const [daySummary, setDaySummary] = useState<DaySummary | null>(null);
  const [dayLoading, setDayLoading] = useState(false);

  // Kaunta pilot (design-direction §2.1/§3): uiVersion >= 2 terminals mount
  // the KauntaShell below (which scopes .pos-shell itself), so the classic
  // dispatch only ever runs with an empty shellClass. Pre-session screens
  // (boot splash) render classic; pilot terminals flip once the session
  // (network or IndexedDB cache) arrives — an accepted one-beat flash.
  const kauntaEnabled = (session?.terminal.uiVersion ?? 1) >= 2;
  const shellClass = kauntaEnabled ? ' pos-shell' : '';

  const pendingCount = pendingSales.length;

  // Customer live-search for every payment method (owner request, 2026-08-12):
  // CREDIT still requires a pick at completion; CASH/MOBILE_MONEY attach one
  // optionally so the sale lands on the customer's account instead of the
  // terminal's walk-in customer.
  useEffect(() => {
    if (!binding || !online || customerQuery.trim().length < 2) {
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
  }, [binding, customerQuery, online]);

  const selectedPayment = session?.paymentMethods.find((method) => method.code === paymentMethod);

  const receivedAmount = useMemo(() => {
    const digits = receivedValue.replace(/\D/g, '');
    return digits ? Number(digits) : null;
  }, [receivedValue]);

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
      // Kaunta MUHURI local commit (design direction §5): stamp haptic + one
      // tally mark. Still inside the slab tap's user-gesture continuation, so
      // vibrate is permitted; the daylog write must never block the sale.
      if (kauntaEnabled) {
        stampSent();
        void bumpDaylogTally(binding.terminalCode).catch(() => undefined);
      }
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
      // The queued sale is a finished job too: distinct held haptic, same
      // tally mark (the documented decision — the tally counts ALL stamps).
      if (kauntaEnabled) {
        stampHeld();
        void bumpDaylogTally(binding.terminalCode).catch(() => undefined);
      }
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
      // Kaunta gets the MUHURI (MZIGO UMEPOKELEWA overlay in the shell) with
      // the sent haptic + tally mark instead of the classic toast — one
      // completion ritual, not two.
      if (kauntaEnabled) {
        stampSent();
        void bumpDaylogTally(binding.terminalCode).catch(() => undefined);
      } else {
        showToast('success', t('purchaseComplete'), t('purchaseStockNote'));
      }
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
      // Kaunta day log (spec-leo §3): EVERY successful my-sales-today fetch
      // snapshots the server truth so Leo can render the day total offline.
      // repId is the shared-phone guard; failure never surfaces to the rep.
      if (kauntaEnabled && session) {
        void writeDaylogSent(binding.terminalCode, posDaylogDate(), {
          repId: session.rep.id,
          count: summary.count,
          totalAmount: summary.totalAmount,
          fetchedAt: Date.now(),
        }).catch(() => undefined);
      }
    } catch {
      setDaySummary(null);
    } finally {
      setDayLoading(false);
    }
  }

  /**
   * Retry ONE rejected sale from the ritual sheet (spec-sales §5.3): re-post
   * the frozen payload verbatim (same idempotency key — a server that already
   * has it replays, never double-posts). Kaunta-shell-only caller; classic
   * queue semantics are untouched.
   */
  async function retryPendingSale(
    item: PendingMobilePosLiteSale,
  ): Promise<'sent' | 'rejected' | 'connection'> {
    if (!binding) return 'connection';
    try {
      await backendPost('/mobile-pos-lite/sales', item.payload, {
        headers: terminalHeaders(binding),
      });
    } catch (error) {
      // Connection-shaped failure: the network died, not the sale — leave the
      // row exactly as it was; the normal sync loop owns it from here.
      if (isConnectionProblem(error)) return 'connection';
      await updatePendingMobilePosLiteSaleError(
        item.id,
        error instanceof Error ? error.message : t('couldNotComplete'),
      );
      await refreshPendingSales(binding);
      // Rejected again: the reject haptic — still inside the ritual button's
      // user-gesture continuation.
      reject();
      return 'rejected';
    }
    await removePendingMobilePosLiteSale(item.id);
    await refreshPendingSales(binding);
    return 'sent';
  }

  /**
   * Receipt sharing, PDF-first: server-confirmed sales fetch the letterhead
   * PDF and hand it to the phone's share sheet (download where files can't be
   * shared). Held/offline sales — and any PDF failure — fall back to the
   * plain-text share below (WhatsApp/SMS is how TZ customers expect proof of
   * purchase; clipboard fallback elsewhere). The cart is still populated on
   * the success screen; it clears on New Sale.
   */
  async function shareReceipt() {
    if (!session || receiptBusy) return;
    if (binding && online && saleResult?.id) {
      setReceiptBusy(true);
      // A connection or share-sheet failure resolves null — the plain-text
      // share below still delivers a receipt, so nothing is surfaced here.
      const delivered = await sharePdfReceipt(binding, saleResult).catch(() => null);
      setReceiptBusy(false);
      if (delivered === 'downloaded') {
        showToast('success', t('shareReceipt'), t('receiptDownloaded'));
      }
      if (delivered) return;
    }
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

  // Kaunta shell pilot: uiVersion >= 2 replaces the classic screen dispatch
  // entirely — hash router, top module rail, bottom slab, boot-into-Mauzo.
  // Both shells consume the same hooks/handlers above; the classic flow below
  // stays byte-identical for every other terminal.
  if (kauntaEnabled) {
    return (
      <KauntaShell
        session={session}
        binding={binding}
        online={online}
        screen={screen}
        lang={lang}
        setLang={setLang}
        t={t}
        leaveTerminal={leaveTerminal}
        notice={notice}
        setNotice={setNotice}
        busy={busy}
        cart={cart}
        query={query}
        setQuery={setQuery}
        quickPicks={quickPicks}
        matches={matches}
        addProduct={addProduct}
        setQuantity={setQuantity}
        cartCount={cartCount}
        total={total}
        beginSale={beginSale}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        customer={customer}
        setCustomer={setCustomer}
        customers={customers}
        setCustomers={setCustomers}
        customerQuery={customerQuery}
        setCustomerQuery={setCustomerQuery}
        receivedValue={receivedValue}
        setReceivedValue={setReceivedValue}
        receivedAmount={receivedAmount}
        selectedPayment={selectedPayment}
        paymentReference={paymentReference}
        setPaymentReference={setPaymentReference}
        completeSale={completeSale}
        saleResult={saleResult}
        shareReceipt={shareReceipt}
        receiptBusy={receiptBusy}
        supplier={supplier}
        setSupplier={setSupplier}
        supplierQuery={supplierQuery}
        setSupplierQuery={setSupplierQuery}
        suppliers={suppliers}
        setSuppliers={setSuppliers}
        purchaseQuery={purchaseQuery}
        setPurchaseQuery={setPurchaseQuery}
        purchaseMatches={purchaseMatches}
        addPurchaseProduct={addPurchaseProduct}
        purchaseCart={purchaseCart}
        setPurchaseCart={setPurchaseCart}
        setPurchaseQuantity={setPurchaseQuantity}
        purchaseTotal={purchaseTotal}
        recordPurchase={recordPurchase}
        beginPurchase={beginPurchase}
        daySummary={daySummary}
        dayLoading={dayLoading}
        openMySales={openMySales}
        pendingSales={pendingSales}
        pendingCount={pendingCount}
        syncing={syncing}
        syncPendingSales={syncPendingSales}
        removePending={removePending}
        retryPendingSale={retryPendingSale}
        confirmRemoveId={confirmRemoveId}
        setConfirmRemoveId={setConfirmRemoveId}
        syncCatalog={syncCatalog}
      />
    );
  }

  if (screen === 'home') {
    return (
      <HomeScreen
        shellClass={shellClass}
        session={session}
        online={online}
        pendingCount={pendingCount}
        syncing={syncing}
        lang={lang}
        setLang={setLang}
        t={t}
        leaveTerminal={leaveTerminal}
        beginSale={beginSale}
        beginPurchase={beginPurchase}
        openMySales={openMySales}
        setScreen={setScreen}
      />
    );
  }

  if (screen === 'mySales') {
    return (
      <MySalesScreen
        shellClass={shellClass}
        online={online}
        dayLoading={dayLoading}
        daySummary={daySummary}
        t={t}
        setScreen={setScreen}
      />
    );
  }

  if (screen === 'purchase') {
    return (
      <PurchaseScreen
        shellClass={shellClass}
        online={online}
        notice={notice}
        busy={busy}
        supplier={supplier}
        setSupplier={setSupplier}
        supplierQuery={supplierQuery}
        setSupplierQuery={setSupplierQuery}
        suppliers={suppliers}
        setSuppliers={setSuppliers}
        purchaseQuery={purchaseQuery}
        setPurchaseQuery={setPurchaseQuery}
        purchaseMatches={purchaseMatches}
        addPurchaseProduct={addPurchaseProduct}
        purchaseCart={purchaseCart}
        setPurchaseCart={setPurchaseCart}
        setPurchaseQuantity={setPurchaseQuantity}
        purchaseTotal={purchaseTotal}
        recordPurchase={recordPurchase}
        t={t}
        setScreen={setScreen}
      />
    );
  }

  if (screen === 'queue') {
    return (
      <QueueScreen
        shellClass={shellClass}
        binding={binding}
        online={online}
        syncing={syncing}
        pendingSales={pendingSales}
        pendingCount={pendingCount}
        confirmRemoveId={confirmRemoveId}
        setConfirmRemoveId={setConfirmRemoveId}
        syncPendingSales={syncPendingSales}
        removePending={removePending}
        t={t}
        setScreen={setScreen}
      />
    );
  }

  if (screen === 'success') {
    return (
      <SuccessScreen
        shellClass={shellClass}
        session={session}
        online={online}
        pendingCount={pendingCount}
        syncing={syncing}
        lang={lang}
        setLang={setLang}
        t={t}
        leaveTerminal={leaveTerminal}
        notice={notice}
        saleResult={saleResult}
        total={total}
        shareReceipt={shareReceipt}
        receiptBusy={receiptBusy}
        beginSale={beginSale}
        setScreen={setScreen}
      />
    );
  }

  if (screen === 'payment') {
    return (
      <PaymentScreen
        shellClass={shellClass}
        session={session}
        online={online}
        cartCount={cartCount}
        total={total}
        paymentMethod={paymentMethod}
        setPaymentMethod={setPaymentMethod}
        customer={customer}
        setCustomer={setCustomer}
        customers={customers}
        setCustomers={setCustomers}
        customerQuery={customerQuery}
        setCustomerQuery={setCustomerQuery}
        receivedValue={receivedValue}
        setReceivedValue={setReceivedValue}
        receivedAmount={receivedAmount}
        selectedPayment={selectedPayment}
        paymentReference={paymentReference}
        setPaymentReference={setPaymentReference}
        notice={notice}
        busy={busy}
        completeSale={completeSale}
        t={t}
        setScreen={setScreen}
      />
    );
  }

  return (
    <SaleScreen
      shellClass={shellClass}
      online={online}
      query={query}
      setQuery={setQuery}
      quickPicks={quickPicks}
      matches={matches}
      addProduct={addProduct}
      cart={cart}
      setQuantity={setQuantity}
      cartCount={cartCount}
      total={total}
      setNotice={setNotice}
      t={t}
      setScreen={setScreen}
    />
  );
}

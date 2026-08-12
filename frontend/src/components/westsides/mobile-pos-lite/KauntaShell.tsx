'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  BookOpen,
  Check,
  Package,
  RotateCw,
  Settings,
  ShoppingCart,
  Truck,
  WifiOff,
} from 'lucide-react';
import {
  getDaylogEntry,
  posDaylogDate,
  type MobilePosLiteBinding,
  type MobilePosLiteProduct,
  type PendingMobilePosLiteSale,
  type PosDaylogEntry,
  type PosDaylogSent,
} from '@/lib/mobile-pos-lite-store';
import { usePosStock } from './hooks/use-pos-stock';
import { tick } from './pos-haptics';
import { type PosLang } from './pos-i18n';
import { useKauntaRouter, type KauntaRoute } from './pos-router';
import type {
  CartLine,
  Customer,
  DaySummary,
  PosScreen,
  PosTranslate,
  PurchaseLine,
  SaleResult,
  Session,
  Supplier,
} from './pos-types';
import { money } from './pos-utils';
import { MuhuriStamp } from './pos-ui';
import { LeoScreen, LEO_FOLENI_ANCHOR_ID } from './screens/LeoScreen';
import { MipangilioScreen } from './screens/MipangilioScreen';
import { PaymentScreen } from './screens/PaymentScreen';
import { PurchaseScreen } from './screens/PurchaseScreen';
import { SaleScreen } from './screens/SaleScreen';
import { StooScreen } from './screens/StooScreen';
import { SuccessScreen } from './screens/SuccessScreen';

/**
 * The Kaunta shell (design direction §3/§5) — mounted by MobilePosLite only
 * when `session.terminal.uiVersion >= 2` (the rollout pilot flag). Owns the
 * hash router, the 44px top module rail, and the bottom Kaunta Slab; the
 * content area renders the SAME extracted screens the classic shell uses,
 * passed `slabMode` so the slab owns their primary verbs. There is no home
 * screen here: boot lands on `#mauzo` (the counter is already selling).
 *
 * The shell bridges the classic orchestrator state instead of forking it:
 * handlers like `completeSale` still drive the `screen` state machine, and the
 * shell mirrors those transitions into routes (screen `success` → `#risiti`,
 * purchase-done `home` → `#mauzo`), so sale/queue semantics stay one code path
 * for both shells.
 */

/** Extra bottom padding so screen content clears the fixed 64px slab. */
const SCREEN_PAD = ' pb-36';

type KauntaShellProps = {
  session: Session;
  binding: MobilePosLiteBinding;
  online: boolean;
  /** Classic screen-state cell — observed to mirror handler-driven moves. */
  screen: PosScreen;
  lang: PosLang;
  setLang: (lang: PosLang) => void;
  t: PosTranslate;
  leaveTerminal: () => Promise<void>;
  notice: string;
  setNotice: (notice: string) => void;
  busy: boolean;
  // Sale flow
  cart: CartLine[];
  query: string;
  setQuery: (query: string) => void;
  quickPicks: MobilePosLiteProduct[];
  matches: MobilePosLiteProduct[];
  addProduct: (product: MobilePosLiteProduct) => void;
  setQuantity: (productId: string, next: number) => void;
  cartCount: number;
  total: number;
  beginSale: () => void;
  // Payment
  paymentMethod: string;
  setPaymentMethod: (code: string) => void;
  customer: Customer | null;
  setCustomer: (customer: Customer | null) => void;
  customers: Customer[];
  setCustomers: (customers: Customer[]) => void;
  customerQuery: string;
  setCustomerQuery: (query: string) => void;
  receivedValue: string;
  setReceivedValue: (value: string) => void;
  receivedAmount: number | null;
  selectedPayment: Session['paymentMethods'][number] | undefined;
  paymentReference: string;
  setPaymentReference: (reference: string) => void;
  completeSale: () => Promise<void>;
  // Receipt
  saleResult: SaleResult | null;
  shareReceipt: () => Promise<void>;
  receiptBusy: boolean;
  // Purchases
  supplier: Supplier | null;
  setSupplier: (supplier: Supplier | null) => void;
  supplierQuery: string;
  setSupplierQuery: (query: string) => void;
  suppliers: Supplier[];
  setSuppliers: (suppliers: Supplier[]) => void;
  purchaseQuery: string;
  setPurchaseQuery: (query: string) => void;
  purchaseMatches: MobilePosLiteProduct[];
  addPurchaseProduct: (product: MobilePosLiteProduct) => void;
  purchaseCart: PurchaseLine[];
  setPurchaseCart: Dispatch<SetStateAction<PurchaseLine[]>>;
  setPurchaseQuantity: (productId: string, next: number) => void;
  purchaseTotal: number;
  recordPurchase: () => Promise<void>;
  beginPurchase: () => void;
  // Leo (day book)
  daySummary: DaySummary | null;
  dayLoading: boolean;
  openMySales: () => Promise<void>;
  // Outbox
  pendingSales: PendingMobilePosLiteSale[];
  pendingCount: number;
  syncing: boolean;
  syncPendingSales: (current: MobilePosLiteBinding) => Promise<void>;
  removePending: (id: string) => Promise<void>;
  retryPendingSale: (item: PendingMobilePosLiteSale) => Promise<'sent' | 'rejected' | 'connection'>;
  confirmRemoveId: string | null;
  setConfirmRemoveId: (id: string | null) => void;
  // Catalog (Mipangilio re-sync row)
  syncCatalog: (current: MobilePosLiteBinding) => Promise<void>;
};

export function KauntaShell(props: KauntaShellProps) {
  const {
    session,
    binding,
    online,
    screen,
    t,
    setNotice,
    busy,
    cart,
    total,
    beginSale,
    receivedAmount,
    completeSale,
    saleResult,
    purchaseCart,
    purchaseTotal,
    recordPurchase,
    beginPurchase,
    daySummary,
    openMySales,
    pendingCount,
    syncing,
    addProduct,
    setQuantity,
  } = props;
  const purchasesEnabled = Boolean(session.purchasesEnabled);

  // The Stoo branch-stock snapshot (spec-inventory §2). Mounting the hook
  // here IS the pre-warm: the rail renders → the conditional fetch fires once
  // (a no-op while the cached snapshot is under the 10-minute max age).
  const stock = usePosStock({ binding });

  // Handler mirrors, refreshed after every render: read from router callbacks
  // and the route-entry effect below (declaration order keeps this mirror
  // running first in each commit).
  const beginSaleRef = useRef(beginSale);
  const beginPurchaseRef = useRef(beginPurchase);
  const openMySalesRef = useRef(openMySales);
  const ensureStockRef = useRef(stock.ensureFresh);
  useEffect(() => {
    beginSaleRef.current = beginSale;
    beginPurchaseRef.current = beginPurchase;
    openMySalesRef.current = openMySales;
    ensureStockRef.current = stock.ensureFresh;
  });

  // Leaving Risiti by ANY exit — slab verb, sync token, hardware back — begins
  // a fresh sale. The cart backs the receipt only while Risiti is showing
  // (CHAR-1 invariant); it must never ride back into Mauzo where a second LIPA
  // would mint a new idempotency key and double-post the sale.
  const onExit = useCallback((from: KauntaRoute) => {
    if (from === 'risiti') beginSaleRef.current();
  }, []);

  const { route, navigate } = useKauntaRouter({ purchasesEnabled, onExit });

  // The Kaunta purchase success moment (design direction §5.2): recordPurchase
  // has no receipt screen, so the MZIGO UMEPOKELEWA seal slams onto a floating
  // card over the counter for a beat. Haptic + tally already fired at local
  // commit inside recordPurchase itself.
  const [purchaseStamped, setPurchaseStamped] = useState(false);
  useEffect(() => {
    if (!purchaseStamped) return;
    const timer = window.setTimeout(() => setPurchaseStamped(false), 2600);
    return () => window.clearTimeout(timer);
  }, [purchaseStamped]);

  // Bridge: handler-driven classic screen transitions become route moves.
  const prevScreenRef = useRef(screen);
  useEffect(() => {
    const prev = prevScreenRef.current;
    if (prev === screen) return;
    prevScreenRef.current = screen;
    // completeSale landed (sent or queued): forward to the receipt. The router
    // REPLACES #malipo, so hardware back can never re-open the payment screen.
    if (screen === 'success') navigate('risiti');
    // recordPurchase landed: classic goes home; Kaunta's home is the counter,
    // and this transition only ever means a completed purchase (the shell's
    // own back paths bypass the classic screen cell) — stamp it.
    else if (screen === 'home' && prev === 'purchase') {
      setPurchaseStamped(true);
      navigate('mauzo');
    }
  }, [screen, navigate]);

  // The day log behind the slab total and Leo (spec-leo §3/§6): reload today's
  // entry whenever anything that writes it may have fired — route moves (a
  // stamp precedes every route change), a fresh day summary (writeDaylogSent),
  // or an outbox change (queued-sale stamps). Failures render as "no data".
  const [daylogEntry, setDaylogEntry] = useState<PosDaylogEntry | null>(null);
  useEffect(() => {
    let cancelled = false;
    getDaylogEntry(binding.terminalCode, posDaylogDate())
      .then((entry) => {
        if (!cancelled) setDaylogEntry(entry);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [binding.terminalCode, route, daySummary, pendingCount]);
  const tallyCount = daylogEntry?.tallyCount ?? 0;
  // Shared-phone guard (spec-leo §2.5): another rep's cached money is never
  // shown as this rep's — a guarded snapshot renders like no snapshot at all.
  const cachedSent: PosDaylogSent | null =
    daylogEntry?.sent && daylogEntry.sent.repId === session.rep.id ? daylogEntry.sent : null;

  // Re-fetch the day summary when a flush finishes while the book is open, so
  // "Zimetumwa" moves the moment the queue drains (spec-leo §1 data flow).
  const prevSyncingRef = useRef(syncing);
  useEffect(() => {
    const wasSyncing = prevSyncingRef.current;
    prevSyncingRef.current = syncing;
    if (wasSyncing && !syncing && (route === 'leo' || route === 'leo/foleni')) {
      void openMySalesRef.current();
    }
  }, [syncing, route]);

  // Kaunta-only counter haptics (design direction §2.5): tick on add-to-cart
  // and on quantity commits (the +/− steppers and QuantityInput both land in
  // setQuantity). Removal (qty 0) is not a tick — nothing was counted.
  const addProductWithTick = useCallback(
    (product: MobilePosLiteProduct) => {
      tick();
      addProduct(product);
    },
    [addProduct],
  );
  const setQuantityWithTick = useCallback(
    (productId: string, next: number) => {
      if (next > 0) tick();
      setQuantity(productId, next);
    },
    [setQuantity],
  );

  // Route-entry effects: fresh purchase form per Manunuzi entry (mirrors the
  // classic home→purchases path), day fetch per Leo entry, foleni anchoring.
  const prevRouteRef = useRef<KauntaRoute | null>(null);
  useEffect(() => {
    const prev = prevRouteRef.current;
    prevRouteRef.current = route;
    const inLeo = route === 'leo' || route === 'leo/foleni';
    const wasLeo = prev === 'leo' || prev === 'leo/foleni';
    if (route === 'manunuzi' && prev !== 'manunuzi') beginPurchaseRef.current();
    if (inLeo && !wasLeo) void openMySalesRef.current();
    // Stoo open: the conditional fetch (missing-or-stale only, §2 fetch
    // policy) — usually a no-op because the rail-render pre-warm already ran.
    if (route === 'stoo' && prev !== 'stoo') ensureStockRef.current();
    if (route === 'leo/foleni') {
      const anchor = document.getElementById(LEO_FOLENI_ANCHOR_ID);
      // jsdom has no scrollIntoView; a missing anchor (empty queue) is fine.
      if (anchor && typeof anchor.scrollIntoView === 'function') {
        anchor.scrollIntoView({ block: 'start' });
      }
    }
  }, [route]);

  // Keyboard rule (direction §3): a focused text input collapses the slab to a
  // 28px strip. Primary signal is the visualViewport shrinking under the soft
  // keyboard; focusin/focusout is the fallback where visualViewport is absent.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport) {
      const onResize = () => setKeyboardOpen(viewport.height < window.innerHeight * 0.75);
      viewport.addEventListener('resize', onResize);
      return () => viewport.removeEventListener('resize', onResize);
    }
    const isTextInput = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target instanceof HTMLInputElement &&
          !/^(button|checkbox|radio|submit|range|file)$/.test(target.type)));
    const onFocusIn = (event: FocusEvent) => {
      if (isTextInput(event.target)) setKeyboardOpen(true);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (isTextInput(event.target)) setKeyboardOpen(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  // Per-screen setScreen shims: the extracted screens still speak the classic
  // PosScreen vocabulary; each shim translates it to the back-map without the
  // screens knowing the router exists.
  const saleSetScreen = useCallback(
    (next: PosScreen) => {
      if (next === 'payment') {
        setNotice('');
        navigate('malipo');
      } else if (next === 'home') {
        // "Futa mauzo": Kaunta has no home — cancel clears the counter in place.
        beginSaleRef.current();
      }
    },
    [navigate, setNotice],
  );
  const backToMauzo = useCallback(
    (next: PosScreen) => {
      if (next === 'home' || next === 'sale') navigate('mauzo');
    },
    [navigate],
  );

  // The slab contract (direction §5, spec-leo §6): exactly one primary verb
  // per screen — disabled, never hidden — plus the money that matters now.
  const slab = ((): {
    verb: string;
    busyLabel?: string;
    disabled: boolean;
    inFlight: boolean;
    amount: number | null;
    onPress: () => void;
  } => {
    switch (route) {
      case 'malipo': {
        const change =
          receivedAmount !== null && receivedAmount >= total ? receivedAmount - total : null;
        return {
          verb: t('slabKamilisha'),
          busyLabel: t('completing'),
          disabled: busy,
          inFlight: busy,
          amount: change ?? total,
          onPress: () => void completeSale(),
        };
      }
      case 'risiti':
        return {
          verb: t('newSale'),
          disabled: false,
          inFlight: false,
          amount: Number(saleResult?.totalAmount ?? total),
          onPress: () => navigate('mauzo'),
        };
      case 'manunuzi':
        return {
          verb: t('slabPokea'),
          busyLabel: t('recording'),
          disabled: busy || !online || purchaseCart.length === 0,
          inFlight: busy,
          amount: purchaseTotal > 0 ? purchaseTotal : null,
          onPress: () => void recordPurchase(),
        };
      case 'leo':
      case 'leo/foleni':
        return {
          verb: t('newSale'),
          disabled: false,
          inFlight: false,
          // Day total only when known (spec-leo §6): live fetch, else the
          // rep-guarded daylog cache — never a fabricated number. Staleness
          // context renders on the Leo screen, never on the slab.
          amount: daySummary ? daySummary.totalAmount : (cachedSent?.totalAmount ?? null),
          onPress: () => navigate('mauzo'),
        };
      case 'stoo':
        // The slab law holds on Stoo (spec-leo §6): never verb-less — MAUZO
        // MAPYA back to the money path, day total only when known. ANZA
        // KUHESABU deliberately does NOT ship until Hesabu exists (Phase 5);
        // the slab must never point at a dead screen.
        return {
          verb: t('newSale'),
          disabled: false,
          inFlight: false,
          amount: daySummary ? daySummary.totalAmount : (cachedSent?.totalAmount ?? null),
          onPress: () => navigate('mauzo'),
        };
      case 'mipangilio':
        return {
          verb: t('newSale'),
          disabled: false,
          inFlight: false,
          amount: null,
          onPress: () => navigate('mauzo'),
        };
      case 'mauzo':
      default:
        return {
          verb: t('slabLipa'),
          disabled: cart.length === 0,
          inFlight: false,
          amount: total > 0 ? total : null,
          onPress: () => {
            setNotice('');
            navigate('malipo');
          },
        };
    }
  })();

  // The rail rides module screens only; Malipo/Risiti are focused flow.
  const showRail = route !== 'malipo' && route !== 'risiti';

  let content: ReactNode;
  if (route === 'malipo') {
    content = (
      <PaymentScreen
        slabMode
        shellClass={SCREEN_PAD}
        session={props.session}
        online={props.online}
        cartCount={props.cartCount}
        total={props.total}
        paymentMethod={props.paymentMethod}
        setPaymentMethod={props.setPaymentMethod}
        customer={props.customer}
        setCustomer={props.setCustomer}
        customers={props.customers}
        setCustomers={props.setCustomers}
        customerQuery={props.customerQuery}
        setCustomerQuery={props.setCustomerQuery}
        receivedValue={props.receivedValue}
        setReceivedValue={props.setReceivedValue}
        receivedAmount={props.receivedAmount}
        selectedPayment={props.selectedPayment}
        paymentReference={props.paymentReference}
        setPaymentReference={props.setPaymentReference}
        notice={props.notice}
        busy={props.busy}
        completeSale={props.completeSale}
        t={t}
        setScreen={backToMauzo}
      />
    );
  } else if (route === 'risiti') {
    content = (
      <SuccessScreen
        slabMode
        shellClass={SCREEN_PAD}
        session={props.session}
        online={props.online}
        pendingCount={props.pendingCount}
        syncing={props.syncing}
        lang={props.lang}
        setLang={props.setLang}
        t={t}
        leaveTerminal={props.leaveTerminal}
        notice={props.notice}
        saleResult={props.saleResult}
        total={props.total}
        shareReceipt={props.shareReceipt}
        receiptBusy={props.receiptBusy}
        beginSale={props.beginSale}
        setScreen={backToMauzo}
      />
    );
  } else if (route === 'manunuzi') {
    content = (
      <PurchaseScreen
        slabMode
        shellClass={SCREEN_PAD}
        online={props.online}
        notice={props.notice}
        busy={props.busy}
        supplier={props.supplier}
        setSupplier={props.setSupplier}
        supplierQuery={props.supplierQuery}
        setSupplierQuery={props.setSupplierQuery}
        suppliers={props.suppliers}
        setSuppliers={props.setSuppliers}
        purchaseQuery={props.purchaseQuery}
        setPurchaseQuery={props.setPurchaseQuery}
        purchaseMatches={props.purchaseMatches}
        addPurchaseProduct={props.addPurchaseProduct}
        purchaseCart={props.purchaseCart}
        setPurchaseCart={props.setPurchaseCart}
        setPurchaseQuantity={props.setPurchaseQuantity}
        purchaseTotal={props.purchaseTotal}
        recordPurchase={props.recordPurchase}
        t={t}
        setScreen={backToMauzo}
      />
    );
  } else if (route === 'leo' || route === 'leo/foleni') {
    content = (
      <LeoScreen
        shellClass={SCREEN_PAD}
        binding={props.binding}
        online={props.online}
        dayLoading={props.dayLoading}
        daySummary={props.daySummary}
        syncing={props.syncing}
        pendingSales={props.pendingSales}
        pendingCount={props.pendingCount}
        tallyCount={tallyCount}
        cachedSent={cachedSent}
        confirmRemoveId={props.confirmRemoveId}
        setConfirmRemoveId={props.setConfirmRemoveId}
        syncPendingSales={props.syncPendingSales}
        removePending={props.removePending}
        retryPendingSale={props.retryPendingSale}
        retryDay={() => void openMySalesRef.current()}
        t={t}
      />
    );
  } else if (route === 'stoo') {
    content = (
      <StooScreen
        shellClass={SCREEN_PAD}
        session={props.session}
        online={props.online}
        snapshot={stock.snapshot}
        loading={stock.loading}
        refresh={stock.refresh}
        t={t}
      />
    );
  } else if (route === 'mipangilio') {
    content = (
      <MipangilioScreen
        shellClass={SCREEN_PAD}
        session={props.session}
        binding={props.binding}
        online={props.online}
        lang={props.lang}
        setLang={props.setLang}
        leaveTerminal={props.leaveTerminal}
        syncCatalog={props.syncCatalog}
        t={t}
      />
    );
  } else {
    content = (
      <SaleScreen
        slabMode
        shellClass={SCREEN_PAD}
        online={props.online}
        query={props.query}
        setQuery={props.setQuery}
        quickPicks={props.quickPicks}
        matches={props.matches}
        addProduct={addProductWithTick}
        cart={props.cart}
        setQuantity={setQuantityWithTick}
        cartCount={props.cartCount}
        total={props.total}
        setNotice={props.setNotice}
        t={t}
        setScreen={saleSetScreen}
      />
    );
  }

  return (
    <div className="pos-shell min-h-screen" style={{ background: 'var(--aurora-bg)' }}>
      {showRail && (
        <KauntaRail route={route} purchasesEnabled={purchasesEnabled} onNavigate={navigate} t={t} />
      )}
      <KauntaRibbon online={online} syncing={syncing} railShown={showRail} t={t} />
      {purchaseStamped && (
        <div
          className="pointer-events-none fixed inset-x-0 top-16 z-50 flex justify-center px-4"
          role="status"
        >
          <div
            className="rounded-xl border px-5 py-4"
            style={{
              background: 'var(--aurora-card)',
              borderColor: 'var(--aurora-border)',
              boxShadow: 'var(--aurora-shadow-lg)',
            }}
          >
            <MuhuriStamp variant="solid" label={t('stampMzigo')} />
          </div>
        </div>
      )}
      {content}
      <KauntaSlab
        collapsed={keyboardOpen}
        online={online}
        pendingCount={pendingCount}
        amount={slab.amount}
        verb={slab.verb}
        busyLabel={slab.busyLabel}
        disabled={slab.disabled}
        inFlight={slab.inFlight}
        onVerb={slab.onPress}
        onSyncTap={() => navigate('leo/foleni')}
        t={t}
      />
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────── */

/**
 * Status ribbon (direction §5, spec-sales §1.3): rendered only when the world
 * is non-clean — a calm grey chip offline ("offline is weather", never amber
 * or red), a brass chip while the outbox is flushing. Offline wins when both
 * hold (nothing can be flushing without a network anyway).
 */
function KauntaRibbon({
  online,
  syncing,
  railShown,
  t,
}: {
  online: boolean;
  syncing: boolean;
  railShown: boolean;
  t: PosTranslate;
}) {
  if (online && !syncing) return null;
  return (
    <div
      className={`sticky ${railShown ? 'top-11' : 'top-0'} z-30 flex justify-center px-3 py-1.5`}
      role="status"
      style={{ background: 'var(--aurora-bg)' }}
    >
      {!online ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
        >
          <WifiOff size={13} aria-hidden="true" />
          {t('ribbonOffline')}
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-accent-text)' }}
        >
          <RotateCw size={13} className="animate-spin" aria-hidden="true" />
          {t('ribbonSending')}
        </span>
      )}
    </div>
  );
}

/** Top module rail (direction §3): 44px, duotone icon chip + one Swahili word. */
function KauntaRail({
  route,
  purchasesEnabled,
  onNavigate,
  t,
}: {
  route: KauntaRoute;
  purchasesEnabled: boolean;
  onNavigate: (to: KauntaRoute) => void;
  t: PosTranslate;
}) {
  const tabs: Array<{ to: KauntaRoute; label: string; icon: typeof ShoppingCart }> = [
    { to: 'mauzo', label: t('railMauzo'), icon: ShoppingCart },
    // Stoo (Phase 4): every `mobile_pos_lite.use` holder — no gate. The rail
    // must never show a dead tab, which is also why Hesabu has no tab here.
    // Order is the design-direction §3 contract: Mauzo · Stoo · Leo (· Manunuzi).
    { to: 'stoo', label: t('stockTab'), icon: Package },
    { to: 'leo', label: t('railLeo'), icon: BookOpen },
    ...(purchasesEnabled
      ? [{ to: 'manunuzi' as KauntaRoute, label: t('railManunuzi'), icon: Truck }]
      : []),
  ];
  const isActive = (to: KauntaRoute) => to === route || (to === 'leo' && route === 'leo/foleni');

  return (
    <nav
      className="sticky top-0 z-40 border-b"
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
    >
      <div className="mx-auto flex h-11 max-w-md items-stretch gap-1 px-2">
        {tabs.map((tab) => {
          const active = isActive(tab.to);
          const Icon = tab.icon;
          return (
            <button
              key={tab.to}
              type="button"
              onClick={() => onNavigate(tab.to)}
              aria-current={active ? 'page' : undefined}
              className="flex min-w-16 items-center justify-center gap-1.5 px-2 text-sm font-semibold"
              style={{
                color: active ? 'var(--aurora-primary-text)' : 'var(--aurora-text-secondary)',
              }}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-md"
                style={{
                  background: active ? 'var(--aurora-primary-subtle)' : 'var(--aurora-bg-subtle)',
                  color: active ? 'var(--aurora-primary)' : 'var(--aurora-text-secondary)',
                }}
              >
                <Icon size={15} aria-hidden="true" />
              </span>
              {tab.label}
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => onNavigate('mipangilio')}
          aria-label={t('mipangilio')}
          aria-current={route === 'mipangilio' ? 'page' : undefined}
          className="flex w-11 items-center justify-center"
          style={{
            color:
              route === 'mipangilio' ? 'var(--aurora-primary)' : 'var(--aurora-text-secondary)',
          }}
        >
          <Settings size={19} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

/**
 * The counted sync token (direction §5): never a bare dot. Brass pill with the
 * queue COUNT when sales are held (custody, not warning), grey wifi-slash when
 * offline and clean, green check when everything has arrived. Tap → #leo/foleni.
 */
function SyncToken({
  online,
  pendingCount,
  collapsed,
  onTap,
  t,
}: {
  online: boolean;
  pendingCount: number;
  collapsed: boolean;
  onTap: () => void;
  t: PosTranslate;
}) {
  const label =
    pendingCount > 0
      ? t('syncQueuedAria', { count: pendingCount })
      : online
        ? t('syncCleanAria')
        : t('syncOfflineAria');
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={label}
      className={
        collapsed
          ? 'flex h-6 min-w-6 flex-shrink-0 items-center justify-center'
          : 'flex h-11 min-w-11 flex-shrink-0 items-center justify-center rounded-lg'
      }
    >
      {pendingCount > 0 ? (
        <span
          className={`animate-pulse-subtle inline-flex items-center justify-center rounded-full font-bold ${
            collapsed ? 'h-5 min-w-5 px-1 text-xs' : 'h-7 min-w-7 px-2 text-sm'
          }`}
          style={{
            background: 'var(--aurora-accent-subtle)',
            color: 'var(--aurora-accent-text)',
            boxShadow: 'inset 0 0 0 1px var(--aurora-accent)',
          }}
        >
          {pendingCount}
        </span>
      ) : online ? (
        <Check
          size={collapsed ? 15 : 21}
          style={{ color: 'var(--aurora-success)' }}
          aria-hidden="true"
        />
      ) : (
        <WifiOff
          size={collapsed ? 15 : 21}
          style={{ color: 'var(--aurora-text-muted)' }}
          aria-hidden="true"
        />
      )}
    </button>
  );
}

/**
 * The Kaunta Slab (direction §5): fixed bottom, 64px + safe-area, one blue
 * primary verb, brass money, the sync token on the left edge. Collapses to a
 * 28px strip (token + verb text, no money) while a text input is focused.
 */
function KauntaSlab({
  collapsed,
  online,
  pendingCount,
  amount,
  verb,
  busyLabel,
  disabled,
  inFlight,
  onVerb,
  onSyncTap,
  t,
}: {
  collapsed: boolean;
  online: boolean;
  pendingCount: number;
  amount: number | null;
  verb: string;
  busyLabel?: string;
  disabled: boolean;
  inFlight: boolean;
  onVerb: () => void;
  onSyncTap: () => void;
  t: PosTranslate;
}) {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-40 border-t"
      style={{
        background: 'var(--aurora-card)',
        borderColor: 'var(--aurora-border)',
        boxShadow: inFlight ? 'var(--aurora-glow-primary)' : 'var(--aurora-shadow-lg)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div
        className={`mx-auto flex max-w-md items-center gap-3 px-3 ${collapsed ? 'h-7' : 'h-16'}`}
      >
        <SyncToken
          online={online}
          pendingCount={pendingCount}
          collapsed={collapsed}
          onTap={onSyncTap}
          t={t}
        />
        {!collapsed && amount !== null && (
          <span
            className="aurora-display aurora-money flex-shrink-0 text-2xl"
            style={{ color: 'var(--aurora-accent)' }}
          >
            {money(amount)}
          </span>
        )}
        <button
          type="button"
          onClick={onVerb}
          disabled={disabled}
          className={
            collapsed
              ? 'min-w-0 flex-1 truncate text-sm font-extrabold uppercase tracking-wide text-brand-600 disabled:opacity-50'
              : 'inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 truncate rounded-lg bg-brand-600 px-4 text-base font-extrabold uppercase tracking-wide text-white transition hover:bg-brand-700 disabled:cursor-not-allowed'
          }
          style={
            !collapsed && disabled
              ? { background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-muted)' }
              : undefined
          }
        >
          {inFlight ? (
            <>
              <RotateCw size={17} className="animate-spin" aria-hidden="true" />
              {busyLabel ?? t('completing')}
            </>
          ) : (
            verb
          )}
        </button>
      </div>
    </div>
  );
}

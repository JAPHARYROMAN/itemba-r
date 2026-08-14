'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import {
  BookOpen,
  Check,
  FileText,
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
import { usePosCount } from './hooks/use-pos-count';
import { usePosSlip } from './hooks/use-pos-slip';
import { usePosStock } from './hooks/use-pos-stock';
import { tick } from './pos-haptics';
import { type PosLang } from './pos-i18n';
import { applyPosThemeChrome, usePosTheme } from './pos-theme';
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
import { HesabuScreen } from './screens/HesabuScreen';
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
  /**
   * Kaunta passes the kikaratasi's frozen key so every attempt on one slip
   * rides the same `[MPL-PURCHASE:<key>]` marker — the server resumes or
   * refuses, and the delivery is never received twice; classic passes nothing
   * and mints per attempt, unchanged.
   */
  recordPurchase: (idempotencyKey?: string) => Promise<void>;
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
  // Hesabu is manager-gated (spec-inventory §6): no verb, no screen, no route
  // without it — and a session refresh that revokes it lands the manager back
  // on Stoo, exactly like a revoked Manunuzi tab disappearing.
  const stockCountsEnabled = Boolean(session.stockCountsEnabled);

  // The Stoo branch-stock snapshot (spec-inventory §2). Mounting the hook
  // here IS the pre-warm: the rail renders → the conditional fetch fires once
  // (a no-op while the cached snapshot is under the 10-minute max age).
  const stock = usePosStock({ binding });
  // The products Hesabu can render right now (null = no snapshot at all). The
  // count sheet outlives the snapshot it was typed against, so the hook needs
  // this to know which counted lines the manager can still see — and refuse to
  // review or send the ones she cannot (spec-inventory §7 case 5). Names ride
  // along because a vanished line still has to be nameable.
  const countableProducts = useMemo(
    () =>
      stock.snapshot
        ? new Map(stock.snapshot.items.map((item) => [item.productId, item.name]))
        : null,
    [stock.snapshot],
  );
  // The Hesabu count sheet (spec-inventory §3): mounted at shell level because
  // the slab owns its verbs. Mount is also the drafts orphan sweep — one sweep
  // covers both draft modules, since it keys off the terminal prefix alone.
  const count = usePosCount({ binding, online, visibleProducts: countableProducts });
  // The Manunuzi kikaratasi (spec-purchases §3.1/§6): same reason, plus the
  // ribbon badge and the frozen key both live above the Pokea screen.
  const slip = usePosSlip({
    binding,
    purchasesEnabled,
    supplier: props.supplier,
    setSupplier: props.setSupplier,
    purchaseCart,
    setPurchaseCart: props.setPurchaseCart,
  });

  // Handler mirrors, refreshed after every render: read from router callbacks
  // and the route-entry effect below (declaration order keeps this mirror
  // running first in each commit).
  const beginSaleRef = useRef(beginSale);
  const beginPurchaseRef = useRef(beginPurchase);
  const openMySalesRef = useRef(openMySales);
  const ensureStockRef = useRef(stock.ensureFresh);
  const enterCountRef = useRef(count.enter);
  const enterSlipRef = useRef(slip.enter);
  const slipCompletedRef = useRef(slip.completed);
  const slipSendKeyRef = useRef(slip.sendKey);
  useEffect(() => {
    beginSaleRef.current = beginSale;
    beginPurchaseRef.current = beginPurchase;
    openMySalesRef.current = openMySales;
    ensureStockRef.current = stock.ensureFresh;
    enterCountRef.current = count.enter;
    enterSlipRef.current = slip.enter;
    slipCompletedRef.current = slip.completed;
    slipSendKeyRef.current = slip.sendKey;
  });

  // Leaving Risiti by ANY exit — slab verb, sync token, hardware back — begins
  // a fresh sale. The cart backs the receipt only while Risiti is showing
  // (CHAR-1 invariant); it must never ride back into Mauzo where a second LIPA
  // would mint a new idempotency key and double-post the sale.
  const onExit = useCallback((from: KauntaRoute) => {
    if (from === 'risiti') beginSaleRef.current();
  }, []);

  const { route, navigate } = useKauntaRouter({ purchasesEnabled, stockCountsEnabled, onExit });

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
      // Success clears the slip and only success does (§3.1): a rejected or
      // timed-out delivery keeps both the draft and its frozen key.
      slipCompletedRef.current();
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
    // Pokea open: a fresh form (mirroring the classic home→purchases path),
    // then the parked kikaratasi restored into it — online or offline, with no
    // prompt and no expiry gate (§3.1 as amended by critique D3).
    if (route === 'manunuzi' && prev !== 'manunuzi') {
      beginPurchaseRef.current();
      enterSlipRef.current();
    }
    if (inLeo && !wasLeo) void openMySalesRef.current();
    // Stoo open: the conditional fetch (missing-or-stale only, §2 fetch
    // policy) — usually a no-op because the rail-render pre-warm already ran.
    if (route === 'stoo' && prev !== 'stoo') ensureStockRef.current();
    // Hesabu open: read the saved sheet and offer resume/discard.
    if (route === 'hesabu' && prev !== 'hesabu') enterCountRef.current();
    if (route === 'leo/foleni') {
      const anchor = document.getElementById(LEO_FOLENI_ANCHOR_ID);
      // jsdom has no scrollIntoView; a missing anchor (empty queue) is fine.
      if (anchor && typeof anchor.scrollIntoView === 'function') {
        anchor.scrollIntoView({ block: 'start' });
      }
    }
  }, [route]);

  // Mchana or Usiku (direction §2.1). The value rides one attribute on the
  // wrapper that already carries `.pos-shell`, so the CSS variable overrides
  // re-paint every surface below — no screen component takes a theme prop, no
  // screen code re-renders differently, and the classic shell (which never
  // carries `.pos-shell` at all) never sees the attribute. Only pilot
  // terminals reach this component, so only they can be in Usiku.
  const theme = usePosTheme();
  // The address bar / status bar follows the POS's chosen theme, not the
  // phone's — see pos-theme.ts. Undone on unmount, so logout hands the chrome
  // back to the page's static Mchana `themeColor`.
  useEffect(() => applyPosThemeChrome(theme), [theme]);

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

  /**
   * POKEA, in two steps that must stay in this order: park the key, then send
   * the delivery under it. `slip.sendKey()` resolves null when the phone
   * refused the write, and a delivery must never leave under a key the phone is
   * not holding — the response can die, the PWA can be evicted, and the next
   * entry would mint a fresh key, miss the marker and receive the same lorry a
   * second time. So the refusal blocks the send and is SAID: the hook has
   * already shaken the slab and fired the reject haptic (as it does for the
   * offline save verb), and the words go in the notice cell the same way,
   * because a badge quietly failing to appear is not telling her anything.
   * This mirrors the count's freeze gate — the same refusal, the same ritual.
   *
   * The ref is the double-tap guard the await now needs: `busy` cannot rise
   * until `recordPurchase` starts, so without it a second tap during the write
   * would put two requests on the wire under one key.
   */
  const sendingSlipRef = useRef(false);
  const sendSlip = useCallback(async () => {
    if (sendingSlipRef.current) return;
    sendingSlipRef.current = true;
    try {
      const key = await slipSendKeyRef.current();
      if (key === null) {
        // Not the save verb's sentence: she tapped POKEA, so the thing she has
        // to be told is that the DELIVERY did not go — same words the count
        // refuses a send with.
        setNotice(t('slipSendBlocked'));
        return;
      }
      await recordPurchase(key);
    } finally {
      sendingSlipRef.current = false;
    }
  }, [recordPurchase, setNotice, t]);

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
        // Offline the verb becomes HIFADHI KIKARATASI — still blue, still the
        // one thing to press (§3.1): offline is custody, not an error, so the
        // slab never goes dead here. Posting stays online-only by design.
        if (!online) {
          return {
            verb: t('slabSaveSlip'),
            disabled: !slip.hasContent,
            inFlight: false,
            amount: purchaseTotal > 0 ? purchaseTotal : null,
            onPress: () =>
              void slip.save().then((saved) => {
                // Navigation is the acknowledgement that the slip is on the
                // phone; an unsaved form must stay in front of the manager —
                // and be TOLD. A refused write that looks exactly like a
                // successful one sends her away from work the phone dropped,
                // which is the one thing the kikaratasi is built to prevent.
                if (saved) {
                  setNotice('');
                  navigate('mauzo');
                } else {
                  setNotice(t('slipSaveFailed'));
                }
              }),
          };
        }
        return {
          verb: t('slabPokea'),
          busyLabel: t('recording'),
          disabled: busy || purchaseCart.length === 0,
          inFlight: busy,
          amount: purchaseTotal > 0 ? purchaseTotal : null,
          // Taking the key here is what freezes it (see usePosSlip): every
          // later attempt on this slip rides the same one, edited or not, so a
          // lost response is answered by the server — replayed when the slip
          // is unchanged, refused as already-received when it is not — instead
          // of being guessed at on the phone and posted twice.
          //
          // …which is only true while the phone is HOLDING that key, so the
          // send waits on the write and a refused write refuses the send —
          // the same gate the count's freeze carries, said in the same place:
          // the manager should not have to know which module she is in. The
          // delivery leaves only after the key is durably down.
          onPress: () => void sendSlip(),
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
        // The slab law holds on Stoo (spec-leo §6): never verb-less. Managers
        // get ANZA KUHESABU (spec-inventory §2.6); everyone else gets MAUZO
        // MAPYA back to the money path, with the day total only when known.
        return stockCountsEnabled
          ? {
              verb: t('countStart'),
              disabled: false,
              inFlight: false,
              amount: null,
              onPress: () => navigate('hesabu'),
            }
          : {
              verb: t('newSale'),
              disabled: false,
              inFlight: false,
              amount: daySummary ? daySummary.totalAmount : (cachedSent?.totalAmount ?? null),
              onPress: () => navigate('mauzo'),
            };
      case 'hesabu':
        // Count mode carries no money on the slab — a count is quantities, and
        // brass is for shillings. KAGUA HESABU unlocks with the first counted
        // line; TUMA HESABU is the online moment (offline the verb is dead and
        // the screen says why — a count never enters the outbox).
        if (!stockCountsEnabled) {
          // Permission revoked mid-count: Stoo renders below, so the slab
          // carries Stoo's rep verb for the one commit before the router
          // settles the route onto #stoo.
          return {
            verb: t('newSale'),
            disabled: false,
            inFlight: false,
            amount: daySummary ? daySummary.totalAmount : (cachedSent?.totalAmount ?? null),
            onPress: () => navigate('mauzo'),
          };
        }
        if (count.step === 'done') {
          return {
            verb: t('newSale'),
            disabled: false,
            inFlight: false,
            amount: null,
            onPress: () => navigate('mauzo'),
          };
        }
        // Both verbs die while the sheet cannot be sent as it stands
        // (`count.blocked`): a counted line is off-screen, so the review it
        // would open cannot show the whole sheet and the confirm's variance
        // total would be summed over fewer lines than the payload carries; or
        // no snapshot loaded at all; or the sheet is longer than one count may
        // carry. The screen names whichever it is, and names the remedy.
        if (count.step === 'review') {
          return {
            verb: t('countSubmit'),
            busyLabel: t('countSubmitting'),
            disabled: count.submitting || !online || count.blocked,
            inFlight: count.submitting,
            amount: null,
            onPress: count.openConfirm,
          };
        }
        return {
          verb: t('countReview'),
          disabled: count.countedCount === 0 || count.blocked,
          inFlight: false,
          amount: null,
          onPress: count.openReview,
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
  // The sync-legibility law (direction §5): every piece of unsent local data is
  // exactly one counted token in one fixed place. On Pokea the form IS that
  // place — a badge there would only point at what is already on screen — so
  // the ribbon carries the slip everywhere else, a restart included.
  const slipBadge = slip.parked && route !== 'manunuzi';

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
        slipParked={slip.parked}
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
  } else if (route === 'hesabu' && stockCountsEnabled) {
    content = (
      <HesabuScreen
        shellClass={SCREEN_PAD}
        online={props.online}
        snapshot={stock.snapshot}
        refresh={stock.refresh}
        // The no-snapshot card's retry is a verb: it needs the hook's flight
        // and its answer, or a failed second attempt repaints nothing at all.
        stockLoading={stock.loading}
        stockLoadFailed={stock.loadFailed}
        pendingCount={props.pendingCount}
        syncing={props.syncing}
        sendQueue={() => void props.syncPendingSales(props.binding)}
        count={count}
        onBackToStoo={() => navigate('stoo')}
        t={t}
      />
    );
  } else if (route === 'stoo' || route === 'hesabu') {
    // The `hesabu` fall-through is the revoked-permission path: the flag went
    // away under a manager standing in count mode, so the screen behind it
    // renders instead of an error (the missing verb is the message). The
    // router settles the route onto `stoo` on the same flag change, so this
    // bridges one commit — but it bridges it, rather than blanking the screen.
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
    <div
      className="pos-shell min-h-screen"
      data-pos-theme={theme}
      style={{ background: 'var(--aurora-bg)' }}
    >
      {showRail && (
        <KauntaRail route={route} purchasesEnabled={purchasesEnabled} onNavigate={navigate} t={t} />
      )}
      <KauntaRibbon
        online={online}
        syncing={syncing}
        slipBadge={slipBadge}
        railShown={showRail}
        t={t}
      />
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
        shake={count.shake || slip.shake}
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
 * or red), a brass chip while the outbox is flushing. Offline wins between
 * those two when both hold (nothing can be flushing without a network anyway).
 * The parked kikaratasi rides alongside either of them as its own brass chip:
 * a slip is custody, and custody is always brass, never a warning.
 */
function KauntaRibbon({
  online,
  syncing,
  slipBadge,
  railShown,
  t,
}: {
  online: boolean;
  syncing: boolean;
  slipBadge: boolean;
  railShown: boolean;
  t: PosTranslate;
}) {
  if (online && !syncing && !slipBadge) return null;
  return (
    <div
      className={`sticky ${railShown ? 'top-11' : 'top-0'} z-30 flex justify-center gap-2 px-3 py-1.5`}
      role="status"
      style={{ background: 'var(--aurora-bg)' }}
    >
      {!online && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: 'var(--aurora-bg-subtle)', color: 'var(--aurora-text-secondary)' }}
        >
          <WifiOff size={13} aria-hidden="true" />
          {t('ribbonOffline')}
        </span>
      )}
      {online && syncing && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{ background: 'var(--aurora-accent-subtle)', color: 'var(--aurora-accent-text)' }}
        >
          <RotateCw size={13} className="animate-spin" aria-hidden="true" />
          {t('ribbonSending')}
        </span>
      )}
      {slipBadge && (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
          style={{
            background: 'var(--aurora-accent-subtle)',
            color: 'var(--aurora-accent-text)',
            boxShadow: 'inset 0 0 0 1px var(--aurora-accent)',
          }}
        >
          <FileText size={13} aria-hidden="true" />
          {t('slipBadge')}
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
  // Count mode keeps Stoo lit: Hesabu is that module's second face, not a
  // fourth tab (the rail must never grow a tab the back-map has no room for).
  const isActive = (to: KauntaRoute) =>
    to === route ||
    (to === 'leo' && route === 'leo/foleni') ||
    (to === 'stoo' && route === 'hesabu');

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
  shake,
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
  /** A server rejection just landed: the offending control shakes, never a toast. */
  shake: boolean;
  onVerb: () => void;
  onSyncTap: () => void;
  t: PosTranslate;
}) {
  return (
    <div
      className={`fixed inset-x-0 bottom-0 z-40 border-t${shake ? ' animate-shake' : ''}`}
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

'use client';

import { SplitPayments } from './SplitPayments';
import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  Clock3,
  ReceiptText,
  ShoppingBag,
  RefreshCw,
  Search,
  Package,
  BarChart3,
} from 'lucide-react';
import { usePosHost } from '../core/pos-host-context';
import type { MobilePosLiteProduct, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import {
  KauntaShell,
  type KauntaShellProps,
} from '@/components/westsides/mobile-pos-lite/KauntaShell';
import { posErrorMessage } from '../core/pos-errors';
import { lineUnitPrice } from '../core/pos-price';
import { buildReceipt, type ReceiptModel } from '../hardware/receipt';
import { productForCode, useScanner } from '../hardware/scanner';
import { usePosPrinter } from '../hardware/use-pos-printer';
import { money, pendingTime } from '../core/pos-utils';
import type { PosStringKey } from '../core/pos-i18n';
import type { PosTranslate } from '../core/pos-types';
import { PriceSheet } from './PriceSheet';
import { PrinterPanel } from './PrinterPanel';
import { ReceiptPrint } from './ReceiptPrint';
import { usePosStep } from './use-pos-step';
import { HeldCarts, type HeldCartActions } from './HeldCarts';
import { Transactions } from './Transactions';
import { OperationsWorkspace } from './OperationsWorkspace';
import './pos-app.css';

/**
 * The new POS on ITEMBA OS (terminal uiVersion 3; POS_REMAKE_PLAN_2026-09-23.md).
 *
 * It receives exactly the props the orchestrator gives Kaunta, so every money
 * path (sale completion, offline queue, frozen idempotency keys, customer
 * search, receipts) is the same proven code; this file only draws it. The
 * layout is chosen by container width in pos-app.css, not here.
 *
 * Stock, receiving, counts and daily reports have native interiors. Settings
 * retains its compatible Kaunta host until hardware acceptance is complete.
 */
export type PosShellProps = KauntaShellProps & {
  payments?: import('../core/pos-types').PosPayment[];
  setPayments?: (payments: import('../core/pos-types').PosPayment[]) => void;
  heldCarts?: HeldCartActions;
  control?: { owned: boolean; request: () => void; release: () => void };
  onHold?: (name: string, note: string) => Promise<void>;
};

const LOW_STOCK = 5;
const EMPTY_PAYMENTS: import('../core/pos-types').PosPayment[] = [];

function stockState(product: MobilePosLiteProduct): 'out' | 'low' | 'ok' | 'none' {
  if (product.availableStock === null || !product.trackInventory) return 'none';
  if (product.availableStock <= 0) return 'out';
  if (product.availableStock <= LOW_STOCK) return 'low';
  return 'ok';
}

/**
 * What the stock snapshot says is left when a cart line asks for more, or null.
 * A warning only, never a block: the snapshot can be stale (a delivery since),
 * and the server has the final word ("Insufficient stock", errInsufficientStock).
 */
function stockShortfall(line: { product: MobilePosLiteProduct; quantity: number }): number | null {
  const { availableStock } = line.product;
  if (!line.product.trackInventory || availableStock === null) return null;
  return line.quantity > availableStock ? Math.max(availableStock, 0) : null;
}

function stockLabel(product: MobilePosLiteProduct, t: PosTranslate): string {
  const state = stockState(product);
  if (state === 'out') return t('posOutOfStock');
  if (state === 'low') return t('posLowStock', { count: product.availableStock ?? 0 });
  if (state === 'ok') return t('stock', { count: product.availableStock ?? 0 });
  return '';
}

/** A Kaunta module the new POS opens in the OS skin, by its deep-link hash. */
export type PosModule = 'leo' | 'stoo' | 'manunuzi' | 'mipangilio';

/** Only Settings retains the compatibility host; business routes use native screens. */
const MODULE_LINK = /^#mipangilio(\/|$)/;

function isModuleLink(hash: string): boolean {
  return MODULE_LINK.test(hash);
}

export function PosShell(props: PosShellProps) {
  const host = usePosHost();
  // Read before the sale screen mounts: its step hook rewrites the hash to
  // #pos/sale on mount, which would swallow the link.
  const [module, setModule] = useState<boolean>(
    () =>
      typeof window !== 'undefined' && isModuleLink(host?.history.hash() ?? window.location.hash),
  );

  useEffect(() => {
    const onHashChange = () => {
      setModule(isModuleLink(host?.history.hash() ?? window.location.hash));
    };
    if (host) return host.history.listen(onHashChange);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [host]);

  if (module) {
    // Existing terminal settings remain compatible while business workflows
    // use the native OS workspace. Reaching Sell returns here.
    return <KauntaShell {...props} skin="os" onReturnToSale={() => setModule(false)} />;
  }

  return (
    <PosApp
      {...props}
      openModule={(next) => {
        // Kaunta's router honours a module deep link on boot (KAUNTA-7).
        if (host) host.history.replace(`#${next}`);
        else window.history.replaceState(window.history.state, '', `#${next}`);
        setModule(true);
      }}
    />
  );
}

function PosApp(props: PosShellProps & { openModule: (module: PosModule) => void }) {
  const instanceId = useId();
  const host = usePosHost();
  const {
    session,
    online,
    screen,
    lang,
    setLang,
    t,
    leaveTerminal,
    notice,
    setNotice,
    busy,
    cart,
    query,
    setQuery,
    quickPicks,
    matches,
    addProduct,
    setQuantity,
    setLinePrice,
    catalog,
    cartCount,
    total,
    beginSale,
    paymentMethod,
    setPaymentMethod,
    customer,
    setCustomer,
    customers,
    setCustomers,
    customerQuery,
    setCustomerQuery,
    receivedValue,
    setReceivedValue,
    receivedAmount,
    selectedPayment,
    paymentReference,
    setPaymentReference,
    completeSale,
    saleResult,
    shareReceipt,
    receiptBusy,
    pendingSales,
    pendingCount,
    syncing,
    syncPendingSales,
    binding,
    removePending,
    retryPendingSale,
    confirmRemoveId,
    setConfirmRemoveId,
    openModule,
    heldCarts,
    control,
    onHold,
  } = props;
  const { step, go } = usePosStep();
  const [menuOpen, setMenuOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [holdName, setHoldName] = useState('');
  const [holdNote, setHoldNote] = useState('');
  const [holdBusy, setHoldBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [operationsBusy, setOperationsBusy] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    function dismiss(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    window.addEventListener('pointerdown', dismiss);
    return () => window.removeEventListener('pointerdown', dismiss);
  }, [menuOpen]);
  const [priceFor, setPriceFor] = useState<string | null>(null);
  const canEditPrice = Boolean(session.priceEditEnabled && setLinePrice);
  const pricedLine = priceFor ? cart.find((line) => line.product.id === priceFor) : undefined;
  const [scanMiss, setScanMiss] = useState<string | null>(null);
  const completionHeading = useRef<HTMLHeadingElement>(null);
  const printer = usePosPrinter(t);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [doneAt, setDoneAt] = useState<Date>(() => new Date());
  const kickedFor = useRef<string | null>(null);
  // Browser printing needs the receipt on the page when the print dialog
  // opens, so a print is a short-lived job: render it, print, remove it.
  const [printJob, setPrintJob] = useState<ReceiptModel | null>(null);
  useEffect(() => {
    if (!printJob) return;
    void printer.print(printJob).finally(() => setPrintJob(null));
  }, [printer, printJob]);

  // A scan anywhere on the sale (focus outside a text field) adds the exact
  // barcode match; an unknown code goes to the search box so the rep sees
  // what the server finds, with a plain note instead of a silent miss.
  useScanner(
    (code) => {
      if (
        priceFor ||
        holding ||
        clearing ||
        menuOpen ||
        printerOpen ||
        (step !== 'sale' && step !== 'pay')
      )
        return;
      const product = productForCode(catalog ?? [], code);
      if (product) {
        setScanMiss(null);
        addProduct(product);
      } else {
        setScanMiss(code);
        setQuery(code);
        searchRef.current?.focus();
      }
    },
    { enabled: step === 'sale' || step === 'pay', acceptEvent: host?.ownsInput },
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  // Recovery may mount this shell already at success; treat that as a new
  // completion so a stale #pos/pay route cannot reopen a paid cart.
  const previousScreen = useRef<typeof screen | null>(null);

  // The orchestrator moves to 'success' when a sale is sent or held; done
  // replaces pay in history so back cannot return to a paid sale.
  useEffect(() => {
    const newCompletion = screen === 'success' && previousScreen.current !== 'success';
    previousScreen.current = screen;
    // On a recovered completion the shell can mount at the default sale step.
    // Move to done before considering a return to Sell; otherwise the same
    // commit would clear the restored receipt cart and payment method.
    if (newCompletion) {
      go('done', { replace: true });
      return;
    }
    // A later return to Sell must start a fresh cart, never charge the paid one.
    if (step === 'sale' && screen === 'success') beginSale();
  }, [beginSale, go, screen, step]);

  const cashOnly = !online;
  const payments = props.payments ?? EMPTY_PAYMENTS;
  const split = paymentMethod === 'MIXED';
  const allocated = payments.reduce((n, p) => n + p.amount, 0);
  const invalidSplit =
    split &&
    (!online ||
      allocated <= 0 ||
      allocated > total ||
      payments.some(
        (p) =>
          p.amount < 0 ||
          !Number.isFinite(p.amount) ||
          (p.amount > 0 && p.method !== 'CASH' && !p.reference?.trim()),
      ) ||
      (allocated < total &&
        (!customer || !session.paymentMethods.some((m) => m.code === 'CREDIT'))));
  const cashAllocated = split
    ? payments.filter((p) => p.method === 'CASH').reduce((n, p) => n + p.amount, 0)
    : total;
  const shortCash =
    (paymentMethod === 'CASH' || (split && cashAllocated > 0)) &&
    receivedAmount !== null &&
    receivedAmount < cashAllocated;
  const missingReference = !!selectedPayment?.requiresReference && !paymentReference.trim();
  const canPay =
    cart.length > 0 &&
    !busy &&
    !holding &&
    !clearing &&
    !shortCash &&
    !invalidSplit &&
    !missingReference &&
    (control?.owned ?? true) &&
    (heldCarts?.ready ?? true) &&
    !heldCarts?.restored &&
    heldCarts?.status !== 'attention';
  const creditNeedsCustomer =
    (paymentMethod === 'CREDIT' || (split && allocated < total)) && !customer;
  const held = saleResult?.pending ?? (Boolean(notice) && screen === 'success');

  // The receipt describes the finished sale: its cart survives into done.
  const receipt =
    step === 'done'
      ? buildReceipt({
          session,
          cart,
          total,
          saleResult,
          held,
          paymentLabel: selectedPayment?.label ?? paymentMethod,
          paymentMethod,
          receivedAmount,
          payments: split ? payments.filter((p) => p.amount > 0) : undefined,
          customer,
          issuedAt: doneAt,
        })
      : null;

  useEffect(() => {
    if (step === 'done') {
      setDoneAt(new Date());
      if (!host || host.ownsInput(completionHeading.current)) completionHeading.current?.focus();
    }
  }, [step, host]);

  // Cash was taken, whether the office has the sale yet or it is held on the
  // phone, so the drawer opens once per finished cash sale, and only through
  // a directly connected printer the rep switched the drawer on for.
  useEffect(() => {
    if (
      step !== 'done' ||
      (paymentMethod !== 'CASH' &&
        !(
          paymentMethod === 'MIXED' && payments.some((p) => p.method === 'CASH' && p.amount > 0)
        )) ||
      !saleResult
    )
      return;
    if (!printer.settings.drawer || !printer.connection) return;
    if (kickedFor.current === saleResult.id) return;
    kickedFor.current = saleResult.id;
    void printer.kickDrawer();
  }, [paymentMethod, payments, printer, saleResult, step]);

  function openPay() {
    if (!cart.length) return;
    setNotice('');
    if (cashOnly && paymentMethod !== 'CASH') setPaymentMethod('CASH');
    go('pay');
  }

  function finishSale() {
    if (!canPay || creditNeedsCustomer) return;
    void completeSale();
  }

  function newSale() {
    if (cart.length && screen !== 'success') {
      setClearing(true);
      return;
    }
    clearSale();
  }
  function clearSale() {
    setClearing(false);
    beginSale();
    go('sale', { replace: true });
    searchRef.current?.focus();
  }

  // Till keyboard: F12 pays, F8 jumps to the customer, F4 changes the price
  // of the last line. Enter in search adds the top result (and is what a
  // keyboard-wedge scanner sends). Nothing pays while the price sheet is open.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (host && !host.ownsInput(event.target)) return;
      if (priceFor || holding || clearing || menuOpen || printerOpen) return;
      if (event.key === 'F4') {
        event.preventDefault();
        const last = cart[cart.length - 1];
        if (canEditPrice && last && (step === 'sale' || step === 'pay'))
          setPriceFor(last.product.id);
      } else if (event.key === 'F12') {
        event.preventDefault();
        if (step === 'sale' || step === 'pay') finishSale();
      } else if (event.key === 'F8') {
        event.preventDefault();
        customerRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const products = query.trim().length >= 2 ? matches : quickPicks;
  const mode = query.trim().length >= 2 ? 'results' : 'picks';
  const restoredNotice = heldCarts?.restored && (
    <div className="pos-field">
      <p className="pos-note" data-tone="warn">
        {t('posRestoredCart')}
        {!online && ` ${t('posRestoredOffline')}`}
      </p>
      <button type="button" className="pos-btn" onClick={heldCarts.review}>
        {t('posReviewCart')}
      </button>
    </div>
  );

  return (
    <div className="pos-app" data-step={step} lang={lang}>
      <header className="pos-header">
        <div className="pos-app-mark">
          <ShoppingBag size={23} aria-hidden="true" />
        </div>
        <div className="pos-brand">
          <strong>Itemba POS</strong>
          <span>
            {session.branch.name} · {session.rep.name}
          </span>
        </div>
        <button
          type="button"
          className="pos-chip"
          data-tone={online && pendingCount === 0 ? 'ok' : 'warn'}
          onClick={() => go('queue')}
        >
          <i aria-hidden="true" />
          {online ? t('online') : t('offline')}
          {pendingCount > 0 ? ` · ${t('waitingCount', { count: pendingCount })}` : ''}
        </button>
        <div
          className="pos-menu"
          ref={menuRef}
          onKeyDown={(event) => {
            if (!menuOpen) return;
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(false);
              menuTrigger.current?.focus();
            } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              event.preventDefault();
              const items = Array.from(
                menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [],
              );
              const current = items.indexOf(document.activeElement as HTMLButtonElement);
              const index =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? items.length - 1
                    : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) %
                      items.length;
              items[index]?.focus();
            } else if (event.key === 'Tab') setMenuOpen(false);
          }}
        >
          <button
            ref={menuTrigger}
            type="button"
            className="pos-btn"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-controls={menuOpen ? instanceId + '-pos-menu' : undefined}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setMenuOpen(true);
              }
            }}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t('posMenu')}
          </button>
          {menuOpen && (
            <div className="pos-menu-list" id={instanceId + '-pos-menu'} role="menu">
              {([['mipangilio', 'posModuleMipangilio']] as Array<[PosModule, PosStringKey]>).map(
                ([module, label]) => (
                  <button
                    key={module}
                    type="button"
                    role="menuitem"
                    disabled={operationsBusy}
                    onClick={() => {
                      setMenuOpen(false);
                      openModule(module);
                    }}
                  >
                    {t(label)}
                  </button>
                ),
              )}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setPrinterOpen(true);
                }}
              >
                {t('posPrinter')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setLang(lang === 'sw' ? 'en' : 'sw');
                  setMenuOpen(false);
                }}
              >
                {lang === 'sw' ? 'English' : 'Kiswahili'}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  void leaveTerminal();
                }}
              >
                {t('logOut')}
              </button>
            </div>
          )}
        </div>
      </header>

      <nav className="pos-workspace-tabs" aria-label={t('posWorkspace')}>
        <button
          type="button"
          aria-current={step === 'sale' || step === 'pay' ? 'page' : undefined}
          onClick={() => (step === 'done' ? newSale() : go('sale'))}
        >
          <ShoppingBag size={17} aria-hidden="true" />
          {t('posSellTab')}
        </button>
        {step === 'done' && (
          <span className="pos-tab-current" aria-current="page">
            <ReceiptText size={17} aria-hidden="true" />
            {t('posReceiptTab')}
          </span>
        )}
        <button
          type="button"
          aria-current={step === 'queue' ? 'page' : undefined}
          onClick={() => go('queue')}
        >
          <RefreshCw size={17} aria-hidden="true" />
          {t('posSyncTab')}
          {pendingCount > 0 && <span className="pos-tab-count">{pendingCount}</span>}
        </button>
        <button
          type="button"
          aria-current={step === 'transactions' ? 'page' : undefined}
          onClick={() => go('transactions')}
        >
          <ReceiptText size={17} aria-hidden="true" />
          {t('posTransactions')}
        </button>
        {heldCarts && (
          <button
            type="button"
            aria-current={step === 'held' ? 'page' : undefined}
            onClick={() => go('held')}
          >
            <ShoppingBag size={17} aria-hidden="true" />
            {t('posHeldCarts')}
            {heldCarts.held.length > 0 && (
              <span className="pos-tab-count">{heldCarts.held.length}</span>
            )}
          </button>
        )}
        <button
          type="button"
          aria-current={
            ['stock', 'counts', 'receiving', 'deliveries'].includes(step) ? 'page' : undefined
          }
          onClick={() => go('stock')}
        >
          <Package size={17} aria-hidden="true" />
          {t('posStockTab')}
        </button>
        <button
          type="button"
          aria-current={step === 'reports' ? 'page' : undefined}
          onClick={() => go('reports')}
        >
          <BarChart3 size={17} aria-hidden="true" />
          {t('posReportsTab')}
        </button>
        <span className="pos-terminal-label">{session.terminal.name}</span>
      </nav>

      {control && (
        <div className="pos-control-strip" role="status">
          <span>{control.owned ? t('posControlOwned') : t('posControlOther')}</span>
          <button
            type="button"
            className="pos-btn"
            disabled={busy || holdBusy || operationsBusy}
            onClick={control.owned ? control.release : control.request}
          >
            {t(control.owned ? 'posReleaseControl' : 'posTakeControl')}
          </button>
          {heldCarts && (
            <span>
              {t(
                heldCarts.status === 'saving'
                  ? 'posSavingCart'
                  : heldCarts.status === 'saved'
                    ? 'posSavedCart'
                    : 'posNeedsAttention',
              )}
            </span>
          )}
        </div>
      )}
      <OperationsWorkspace props={props} step={step} go={go} onBusy={setOperationsBusy} />
      {heldCarts && !heldCarts.ready && (
        <p className="pos-note" data-tone="warn" role="status">
          {t(heldCarts.status === 'attention' ? 'posCartAttention' : 'posCartOpening')}
        </p>
      )}
      {heldCarts?.status === 'attention' && (
        <div className="pos-actions">
          <button
            type="button"
            className="pos-btn"
            onClick={() => void heldCarts.retry().catch(() => setNotice(t('posCartAttention')))}
          >
            {t('posRetryCart')}
          </button>
        </div>
      )}
      {step === 'transactions' && (
        <Transactions
          binding={binding}
          session={session}
          online={online}
          pending={pendingSales}
          t={t}
          owned={control?.owned ?? true}
          openSync={() => go('queue')}
        />
      )}
      {step === 'held' && heldCarts && (
        <HeldCarts
          actions={heldCarts}
          empty={cart.length === 0}
          t={t}
          onResume={() => go('sale')}
        />
      )}

      {step === 'done' && (
        <main className="pos-full">
          <section className="pos-done" data-held={held} aria-live="polite">
            <div className="pos-done-mark" aria-hidden="true">
              {held ? <Clock3 size={30} /> : <Check size={30} />}
            </div>
            <h2 ref={completionHeading} tabIndex={-1}>
              {held ? t('posHeldTitle') : t('saleComplete')}
            </h2>
            {held && <p>{t('custodyNote')}</p>}
            <span className="pos-done-total pos-num">
              {money(Number(saleResult?.totalAmount ?? total))}
            </span>
            {saleResult?.salesOrderNumber && <p>{saleResult.salesOrderNumber}</p>}
          </section>
          <section className="pos-receipt-preview" aria-label={t('posReceiptDetails')}>
            <div className="pos-receipt-heading">
              <ReceiptText size={19} aria-hidden="true" />
              <strong>{t('posReceiptDetails')}</strong>
            </div>
            {cart.map((line) => (
              <div className="pos-receipt-line" key={line.product.id}>
                <span>
                  {line.quantity} × {line.product.name}
                </span>
                <strong className="pos-num">{money(line.quantity * lineUnitPrice(line))}</strong>
              </div>
            ))}
            <div className="pos-receipt-line">
              <span>{t('payment')}</span>
              <strong>{selectedPayment?.label ?? paymentMethod}</strong>
            </div>
            {receipt?.payments?.map((p) => (
              <div className="pos-receipt-line" key={p.method}>
                <span>
                  {session.paymentMethods.find((m) => m.code === p.method)?.label ?? p.method}
                </span>
                <strong>
                  {money(p.amount)}
                  {p.reference ? ` · ${p.reference}` : ''}
                </strong>
              </div>
            ))}
            {receipt?.outstanding != null && (
              <div className="pos-receipt-line">
                <span>{t('stillOwed')}</span>
                <strong>{money(receipt.outstanding)}</strong>
              </div>
            )}
            {paymentReference && (
              <div className="pos-receipt-line">
                <span>{t('reference')}</span>
                <strong>{paymentReference}</strong>
              </div>
            )}
            {customer && (
              <div className="pos-receipt-line">
                <span>{t('customer')}</span>
                <strong>{customer.name}</strong>
              </div>
            )}
            {paymentMethod === 'CASH' && receivedAmount !== null && receivedAmount >= total && (
              <div className="pos-receipt-line">
                <span>{t('changeDue')}</span>
                <strong className="pos-num">{money(receivedAmount - total)}</strong>
              </div>
            )}
          </section>
          <div className="pos-actions">
            <button
              type="button"
              className="pos-btn"
              disabled={printer.busy || !receipt}
              onClick={() => receipt && setPrintJob(receipt)}
            >
              {printer.busy ? t('posPrinting') : t('posPrintReceipt')}
            </button>
            <button
              type="button"
              className="pos-btn"
              disabled={receiptBusy}
              onClick={() => void shareReceipt()}
            >
              {receiptBusy ? t('preparingReceipt') : t('shareReceipt')}
            </button>
            <button type="button" className="pos-btn" onClick={() => go('queue')}>
              {t('queueTitle')}
            </button>
          </div>
          {printer.error && (
            <p className="pos-note" data-tone="bad" role="alert">
              {printer.error}
            </p>
          )}
          <button type="button" className="pos-btn pos-btn-primary" onClick={newSale}>
            {t('newSale')}
          </button>
        </main>
      )}

      {printerOpen && (
        <PrinterPanel
          printer={printer}
          t={t}
          onClose={() => setPrinterOpen(false)}
          onTestPrint={() =>
            setPrintJob(
              buildReceipt({
                session,
                cart: [],
                total: 0,
                saleResult: null,
                held: false,
                paymentLabel: t('posTestPrint'),
                paymentMethod: 'TEST',
                receivedAmount: null,
                customer: null,
                issuedAt: new Date(),
              }),
            )
          }
        />
      )}

      {printJob && <ReceiptPrint model={printJob} paper={printer.settings.paper} t={t} />}

      {step === 'queue' && (
        <main className="pos-full">
          <button type="button" className="pos-back" onClick={() => go('sale')}>
            ← {t('backToSale')}
          </button>
          <section className="pos-panel" aria-labelledby={instanceId + '-pos-queue-title'}>
            <div className="pos-panel-head">
              <h2 id={instanceId + '-pos-queue-title'}>{t('queueTitle')}</h2>
              <div className="pos-spacer" />
              <button
                type="button"
                className="pos-btn"
                disabled={!online || syncing || pendingCount === 0}
                onClick={() => void syncPendingSales(binding)}
              >
                {syncing ? t('sending') : t('sendNow')}
              </button>
            </div>
            <p className="pos-hint">{t('posSyncExplanation')}</p>
            {pendingSales.length === 0 ? (
              <p className="pos-empty">{t('queueEmpty')}</p>
            ) : (
              <div aria-live="polite">
                {pendingSales.map((item) => (
                  <QueueItem
                    key={item.id}
                    item={item}
                    t={t}
                    online={online}
                    confirming={confirmRemoveId === item.id}
                    setConfirmRemoveId={setConfirmRemoveId}
                    removePending={removePending}
                    retryPendingSale={retryPendingSale}
                  />
                ))}
              </div>
            )}
          </section>
        </main>
      )}

      {(step === 'sale' || step === 'pay') && (heldCarts?.ready ?? true) && (
        <>
          <div className="pos-body" data-step={step}>
            <section className="pos-panel pos-find" aria-label={t('addProducts')}>
              <label htmlFor={instanceId + '-pos-search'} className="pos-sr">
                {t('productSearchPlaceholder')}
              </label>
              <div className="pos-search">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input
                  id={instanceId + '-pos-search'}
                  ref={searchRef}
                  value={query}
                  autoComplete="off"
                  placeholder={t('productSearchPlaceholder')}
                  onChange={(event) => {
                    setScanMiss(null);
                    setQuery(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && query.trim().length >= 2) {
                      // An exact barcode or code wins over the top fuzzy
                      // match: a scan into this box must add that product.
                      const exact =
                        productForCode(catalog ?? [], query) ?? productForCode(matches, query);
                      const pick = exact ?? matches[0];
                      if (pick) {
                        event.preventDefault();
                        setScanMiss(null);
                        addProduct(pick);
                      }
                    } else if (event.key === 'Escape') {
                      setQuery('');
                    }
                  }}
                />
              </div>
              {scanMiss && (
                <p className="pos-note" data-tone="warn" role="status">
                  {t('posScanNotFound', { code: scanMiss })}
                </p>
              )}
              {query.trim().length > 0 && query.trim().length < 2 && (
                <p className="pos-hint">{t('typeTwoOrScan')}</p>
              )}
              {mode === 'results' && matches.length === 0 && (
                <p className="pos-hint">{t('noMatch')}</p>
              )}
              {mode === 'picks' && quickPicks.length > 0 && (
                <p className="pos-hint">{t('bestSellers')}</p>
              )}
              <div className="pos-products" data-mode={mode}>
                {products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    className="pos-product"
                    data-stock={stockState(product)}
                    onClick={() => addProduct(product)}
                  >
                    <span className="pos-product-text">
                      <span className="pos-product-name">{product.name}</span>
                      <span className="pos-product-meta">
                        {[product.code, stockLabel(product, t)].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="pos-product-price pos-num">{money(product.sellingPrice)}</span>
                  </button>
                ))}
              </div>
              <p className="pos-keys">
                {t('posScannerReady')} · {t('posKeyHints')}
              </p>
            </section>

            <section
              className="pos-panel pos-cart"
              aria-labelledby={instanceId + '-pos-cart-title'}
            >
              <div className="pos-panel-head">
                <h2 id={instanceId + '-pos-cart-title'}>{t('saleItems')}</h2>
                <span>{t('items', { count: cartCount })}</span>
                <div className="pos-spacer" />
                {onHold && (
                  <button
                    type="button"
                    className="pos-btn"
                    disabled={!cart.length || busy || holdBusy}
                    onClick={() => {
                      setHolding(true);
                      setHoldName(customer?.name ?? '');
                      setHoldNote('');
                    }}
                  >
                    {t('posHold')}
                  </button>
                )}
                {cart.length > 0 && (
                  <button type="button" className="pos-btn" onClick={newSale}>
                    {t('posClearCart')}
                  </button>
                )}
              </div>
              {step !== 'pay' && restoredNotice}
              {holding && (
                <form
                  className="pos-hold-form"
                  aria-label={t('posHold')}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!onHold || holdBusy) return;
                    setHoldBusy(true);
                    setNotice('');
                    void onHold(holdName, holdNote)
                      .then(() => {
                        setHolding(false);
                        go('sale');
                      })
                      .catch(() => setNotice(t('posCartAttention')))
                      .finally(() => setHoldBusy(false));
                  }}
                >
                  <label className="pos-field">
                    {t('posCartName')}
                    <input
                      autoFocus
                      className="pos-input"
                      maxLength={80}
                      value={holdName}
                      onChange={(e) => setHoldName(e.target.value)}
                    />
                  </label>
                  <label className="pos-field">
                    {t('posCartNote')}
                    <textarea
                      className="pos-input"
                      maxLength={500}
                      value={holdNote}
                      onChange={(e) => setHoldNote(e.target.value)}
                    />
                  </label>
                  <p className="pos-hint">{t('posHoldNote')}</p>
                  <div className="pos-actions">
                    <button type="submit" className="pos-btn pos-btn-primary" disabled={holdBusy}>
                      {t('posHold')}
                    </button>
                    <button
                      type="button"
                      className="pos-btn"
                      disabled={holdBusy}
                      onClick={() => setHolding(false)}
                    >
                      {t('posCancel')}
                    </button>
                  </div>
                </form>
              )}
              {clearing && (
                <div role="group" aria-label={t('posDiscardCart')}>
                  <p className="pos-note" data-tone="warn">
                    {t('posDiscardConfirm')}
                  </p>
                  <div className="pos-actions">
                    <button type="button" className="pos-btn" onClick={() => setClearing(false)}>
                      {t('keepIt')}
                    </button>
                    <button type="button" className="pos-btn" onClick={clearSale}>
                      {t('posDiscardCart')}
                    </button>
                  </div>
                </div>
              )}
              {cart.length === 0 ? (
                <p className="pos-empty">{t('posCartEmpty')}</p>
              ) : (
                <div className="pos-lines">
                  {cart.map((line) => (
                    <div key={line.product.id} className="pos-line">
                      <div className="pos-line-text">
                        <strong>{line.product.name}</strong>
                        {canEditPrice ? (
                          <button
                            type="button"
                            className="pos-line-price pos-num"
                            data-edited={Boolean(line.price)}
                            aria-label={t('posEditPriceOf', { name: line.product.name })}
                            onClick={() => setPriceFor(line.product.id)}
                          >
                            {line.price && <s>{money(line.product.sellingPrice)}</s>}
                            {t('posEachPrice', { price: money(lineUnitPrice(line)) })}
                            {line.price && <span className="pos-tag">{t('posPriceChanged')}</span>}
                          </button>
                        ) : (
                          <span className="pos-num">
                            {t('posEachPrice', { price: money(line.product.sellingPrice) })}
                          </span>
                        )}
                        {stockShortfall(line) !== null && (
                          <span className="pos-line-stock">
                            {stockShortfall(line) === 0
                              ? t('posLineOutOfStock')
                              : t('posLineStockShort', { count: stockShortfall(line) ?? 0 })}
                          </span>
                        )}
                      </div>
                      <div className="pos-qty">
                        <button
                          type="button"
                          aria-label={
                            line.quantity === 1
                              ? t('removeItem', { name: line.product.name })
                              : t('reduceItem', { name: line.product.name })
                          }
                          onClick={() => setQuantity(line.product.id, line.quantity - 1)}
                        >
                          −
                        </button>
                        <span
                          className="pos-num"
                          aria-label={t('quantityOf', { name: line.product.name })}
                        >
                          {line.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={t('addItem', { name: line.product.name })}
                          onClick={() => setQuantity(line.product.id, line.quantity + 1)}
                        >
                          +
                        </button>
                      </div>
                      <span className="pos-line-total pos-num">
                        {money(lineUnitPrice(line) * line.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="pos-spacer" />
              <div className="pos-cart-foot">
                <div className="pos-total-row">
                  <span>{t('totalLabel')}</span>
                  <strong className="pos-num">{money(total)}</strong>
                </div>
                <button
                  type="button"
                  className="pos-btn pos-btn-primary"
                  disabled={!cart.length}
                  onClick={openPay}
                >
                  {t('pay')}
                </button>
              </div>
            </section>

            <section className="pos-panel pos-pay" aria-labelledby={instanceId + '-pos-pay-title'}>
              {step === 'pay' && restoredNotice}
              <button
                type="button"
                className="pos-back"
                onClick={() => (host ? host.history.back() : window.history.back())}
              >
                ← {t('backToSale')}
              </button>
              <div className="pos-pay-total">
                <span id={instanceId + '-pos-pay-title'}>{t('posTotalDue')}</span>
                <strong className="pos-num">{money(total)}</strong>
                <span>{t('posVatIncluded')}</span>
              </div>
              {cashOnly && (
                <p className="pos-note" data-tone="warn">
                  {t('cashOnlyOffline')}
                </p>
              )}
              <div className="pos-methods" role="group" aria-label={t('payment')}>
                {session.paymentMethods.map((method) => (
                  <button
                    key={method.code}
                    type="button"
                    className="pos-method"
                    aria-pressed={paymentMethod === method.code}
                    disabled={cashOnly && method.code !== 'CASH'}
                    onClick={() => {
                      setPaymentMethod(method.code);
                      setCustomer(null);
                      setCustomerQuery('');
                    }}
                  >
                    {method.label}
                  </button>
                ))}
              </div>

              {online && props.setPayments && (
                <button
                  type="button"
                  className="pos-btn"
                  aria-pressed={split}
                  onClick={() => {
                    setPaymentMethod('MIXED');
                    if (!payments.length)
                      props.setPayments!([
                        {
                          method:
                            session.paymentMethods.find((m) => m.code !== 'CREDIT')?.code ?? 'CASH',
                          amount: total,
                        },
                      ]);
                  }}
                >
                  {t('posSplitPayments')}
                </button>
              )}
              {split && props.setPayments && (
                <SplitPayments
                  session={session}
                  payments={payments}
                  onChange={props.setPayments}
                  total={total}
                  t={t}
                />
              )}

              {(paymentMethod === 'CREDIT' || online) && (
                <div className="pos-field">
                  <span className="pos-field-label">
                    {paymentMethod === 'CREDIT' || (split && allocated < total)
                      ? t('customer')
                      : t('customerOptional')}
                  </span>
                  {customer ? (
                    <button
                      type="button"
                      className="pos-customer"
                      data-picked="true"
                      onClick={() => {
                        setCustomer(null);
                        setCustomerQuery('');
                      }}
                    >
                      <strong>{customer.name}</strong>
                      <span>{t('change')}</span>
                    </button>
                  ) : (
                    <>
                      <label htmlFor={instanceId + '-pos-customer'} className="pos-sr">
                        {t('customerSearchPlaceholder')}
                      </label>
                      <input
                        id={instanceId + '-pos-customer'}
                        ref={customerRef}
                        className="pos-input"
                        value={customerQuery}
                        placeholder={t('customerSearchPlaceholder')}
                        onChange={(event) => setCustomerQuery(event.target.value)}
                      />
                      {customerQuery.trim().length > 0 && customerQuery.trim().length < 2 && (
                        <p className="pos-hint">{t('typeTwoLetters')}</p>
                      )}
                      {customers.length > 0 && (
                        <div className="pos-customer-results">
                          {customers.map((result) => (
                            <button
                              key={result.id}
                              type="button"
                              className="pos-customer"
                              onClick={() => {
                                setCustomer(result);
                                setCustomers([]);
                              }}
                            >
                              <strong>{result.name}</strong>
                              <span>
                                {[result.customerCode, result.phone].filter(Boolean).join(' · ')}
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {(paymentMethod === 'CASH' || (split && cashAllocated > 0)) && (
                <div className="pos-field">
                  <label htmlFor={instanceId + '-pos-received'}>
                    {t('received')} {t('optional')}
                  </label>
                  <input
                    id={instanceId + '-pos-received'}
                    className="pos-input pos-input-money pos-num"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="0"
                    value={receivedValue}
                    onChange={(event) =>
                      setReceivedValue(event.target.value.replace(/\D/g, '').slice(0, 10))
                    }
                  />
                  <div className="pos-quick">
                    {[
                      { label: t('exactAmount'), amount: Math.ceil(cashAllocated) },
                      ...[5000, 10000, 20000, 50000]
                        .filter((amount) => amount >= cashAllocated)
                        .slice(0, 3)
                        .map((amount) => ({ label: money(amount), amount })),
                    ].map((option) => (
                      <button
                        key={option.label}
                        type="button"
                        className="pos-btn"
                        onClick={() => setReceivedValue(String(option.amount))}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {receivedAmount !== null &&
                    (receivedAmount >= cashAllocated ? (
                      <p className="pos-note pos-num" data-tone="ok">
                        {t('changeDue')}:{' '}
                        <span className="pos-note-strong">
                          {money(receivedAmount - cashAllocated)}
                        </span>
                      </p>
                    ) : (
                      <p className="pos-note pos-num" data-tone="warn">
                        {t('stillOwed')}: {money(cashAllocated - receivedAmount)}
                      </p>
                    ))}
                </div>
              )}

              {selectedPayment?.requiresReference && (
                <div className="pos-field">
                  <label htmlFor={instanceId + '-pos-reference'}>{t('reference')}</label>
                  <input
                    id={instanceId + '-pos-reference'}
                    className="pos-input"
                    required
                    aria-describedby={
                      missingReference ? instanceId + '-pos-reference-note' : undefined
                    }
                    value={paymentReference}
                    placeholder={t('referencePlaceholder')}
                    onChange={(event) => setPaymentReference(event.target.value)}
                  />
                  {missingReference && (
                    <p className="pos-hint" id={instanceId + '-pos-reference-note'}>
                      {t('posReferenceRequired')}
                    </p>
                  )}
                </div>
              )}

              {creditNeedsCustomer && cart.length > 0 && (
                <p className="pos-hint">{t('selectCreditCustomer')}</p>
              )}
              {cart.some((line) => stockShortfall(line) !== null) && (
                <p className="pos-note" data-tone="warn">
                  {t('posStockWarning')}
                </p>
              )}
              {notice && (
                <p className="pos-note" data-tone="bad" role="alert">
                  {notice}
                </p>
              )}
              <div className="pos-spacer" />
              <button
                type="button"
                className="pos-btn pos-btn-primary"
                disabled={!canPay || creditNeedsCustomer}
                onClick={finishSale}
              >
                {busy ? t('completing') : `${t('completeSale')} · ${money(total)}`}
                <kbd>F12</kbd>
              </button>
            </section>
          </div>

          {pricedLine && setLinePrice && (
            <PriceSheet
              line={pricedLine}
              session={session}
              t={t}
              onClose={() => setPriceFor(null)}
              onSave={(price) => {
                setLinePrice(pricedLine.product.id, price);
                setPriceFor(null);
              }}
            />
          )}

          <div className="pos-bar">
            <div className="pos-total-row">
              <span>{t('items', { count: cartCount })}</span>
              <strong className="pos-num">{money(total)}</strong>
            </div>
            <button
              type="button"
              className="pos-btn pos-btn-primary"
              disabled={!cart.length}
              onClick={openPay}
            >
              {t('pay')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function QueueItem({
  item,
  t,
  online,
  confirming,
  setConfirmRemoveId,
  removePending,
  retryPendingSale,
}: {
  item: PendingMobilePosLiteSale;
  t: PosTranslate;
  online: boolean;
  confirming: boolean;
  setConfirmRemoveId: (id: string | null) => void;
  removePending: (id: string) => Promise<void>;
  retryPendingSale: (item: PendingMobilePosLiteSale) => Promise<'sent' | 'rejected' | 'connection'>;
}) {
  const [retrying, setRetrying] = useState(false);
  const failed = Boolean(item.lastError);
  return (
    <div className="pos-queue-item">
      <div className="pos-queue-row">
        <div className="pos-line-text">
          <strong>{t('posSaleAt', { time: pendingTime(item.createdAt) })}</strong>
          {item.lineSummary && <span>{item.lineSummary}</span>}
        </div>
        <strong className="pos-num">{money(Number(item.totalAmount ?? 0))}</strong>
      </div>
      <span className="pos-chip" data-tone="warn" style={{ alignSelf: 'flex-start' }}>
        <i aria-hidden="true" />
        {failed ? t('queueFailed') : t('queueWaiting')}
      </span>
      {failed && (
        <>
          <p className="pos-note" data-tone="bad">
            {posErrorMessage(item.lastError ?? '', t)}
          </p>
          <p className="pos-hint">{t('posSyncRejectedNote')}</p>
          {item.requiresReview !== undefined ? (
            <p className="pos-hint">{t('posSyncRemoveBlocked')}</p>
          ) : null}
          {confirming ? (
            <div className="pos-field">
              <strong>{t('removeConfirmTitle')}</strong>
              <p className="pos-hint">{t('removeConfirmBody')}</p>
              <div className="pos-actions">
                <button type="button" className="pos-btn" onClick={() => setConfirmRemoveId(null)}>
                  {t('keepIt')}
                </button>
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => void removePending(item.id)}
                >
                  {t('confirmRemove')}
                </button>
              </div>
            </div>
          ) : (
            <div className="pos-actions">
              <button
                type="button"
                className="pos-btn"
                disabled={!online || retrying}
                onClick={() => {
                  setRetrying(true);
                  void retryPendingSale(item).finally(() => setRetrying(false));
                }}
              >
                {retrying ? t('sending') : t('retryThisSale')}
              </button>
              <button
                type="button"
                className="pos-btn"
                disabled={item.requiresReview !== undefined}
                onClick={() => setConfirmRemoveId(item.id)}
              >
                {t('remove')}
              </button>
            </div>
          )}
        </>
      )}
      {!failed && <p className="pos-hint">{t('posSyncWaitingNote')}</p>}
    </div>
  );
}

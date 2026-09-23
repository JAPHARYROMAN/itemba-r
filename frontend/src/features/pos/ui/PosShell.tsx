'use client';

import { useEffect, useRef, useState } from 'react';
import type { MobilePosLiteProduct, PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';
import {
  KauntaShell,
  type KauntaShellProps,
} from '@/components/westsides/mobile-pos-lite/KauntaShell';
import { posErrorMessage } from '../core/pos-errors';
import { lineUnitPrice } from '../core/pos-price';
import { money, pendingTime } from '../core/pos-utils';
import type { PosTranslate } from '../core/pos-types';
import { PriceSheet } from './PriceSheet';
import { usePosStep } from './use-pos-step';
import './pos-app.css';

/**
 * The new POS on ITEMBA OS (terminal uiVersion 3; POS_REMAKE_PLAN_2026-09-23.md).
 *
 * It receives exactly the props the orchestrator gives Kaunta, so every money
 * path (sale completion, offline queue, frozen idempotency keys, customer
 * search, receipts) is the same proven code; this file only draws it. The
 * layout is chosen by container width in pos-app.css, not here.
 *
 * Day book, stock, counts, purchases, history and day close are ported in
 * phase 5. Until then "More" opens them in the Kaunta shell, so a v3 terminal
 * loses nothing.
 */
export type PosShellProps = KauntaShellProps;

const LOW_STOCK = 5;

function stockState(product: MobilePosLiteProduct): 'out' | 'low' | 'ok' | 'none' {
  if (product.availableStock === null || !product.trackInventory) return 'none';
  if (product.availableStock <= 0) return 'out';
  if (product.availableStock <= LOW_STOCK) return 'low';
  return 'ok';
}

function stockLabel(product: MobilePosLiteProduct, t: PosTranslate): string {
  const state = stockState(product);
  if (state === 'out') return t('posOutOfStock');
  if (state === 'low') return t('posLowStock', { count: product.availableStock ?? 0 });
  if (state === 'ok') return t('stock', { count: product.availableStock ?? 0 });
  return '';
}

export function PosShell(props: PosShellProps) {
  const [bridgeOpen, setBridgeOpen] = useState(false);

  if (bridgeOpen) {
    return (
      <>
        <KauntaShell {...props} />
        <button
          type="button"
          className="pos-bridge-return"
          onClick={() => setBridgeOpen(false)}
          style={{
            position: 'fixed',
            left: 12,
            bottom: 'calc(96px + env(safe-area-inset-bottom))',
            zIndex: 50,
            minHeight: 44,
            padding: '0 16px',
            borderRadius: 999,
            border: 0,
            background: '#3268ca',
            color: '#ffffff',
            fontWeight: 600,
            boxShadow: '0 8px 24px rgb(23 36 59 / 25%)',
          }}
        >
          {props.t('posBackToNew')}
        </button>
      </>
    );
  }

  return <PosApp {...props} openBridge={() => setBridgeOpen(true)} />;
}

function PosApp(props: PosShellProps & { openBridge: () => void }) {
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
    openBridge,
  } = props;
  const { step, go } = usePosStep();
  const [menuOpen, setMenuOpen] = useState(false);
  const [priceFor, setPriceFor] = useState<string | null>(null);
  const canEditPrice = Boolean(session.priceEditEnabled && setLinePrice);
  const pricedLine = priceFor ? cart.find((line) => line.product.id === priceFor) : undefined;
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const previousScreen = useRef(screen);

  // The orchestrator moves to 'success' when a sale is sent or held; done
  // replaces pay in history so back cannot return to a paid sale.
  useEffect(() => {
    if (screen === 'success' && previousScreen.current !== 'success') go('done', { replace: true });
    previousScreen.current = screen;
  }, [go, screen]);

  // A finished sale's cart survives into done (the receipt is built from it)
  // and must never reach the sale step again, whatever the route back (button,
  // hardware back, or done -> queue -> sale): charging it again would be a
  // second sale under a new key. Landing on sale while the orchestrator still
  // says 'success' therefore always starts a fresh sale.
  useEffect(() => {
    if (step === 'sale' && screen === 'success') beginSale();
  }, [beginSale, screen, step]);

  const cashOnly = !online;
  const canPay = cart.length > 0 && !busy;
  const creditNeedsCustomer = paymentMethod === 'CREDIT' && !customer;
  const held = Boolean(notice) && screen === 'success';

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
    beginSale();
    go('sale', { replace: true });
    searchRef.current?.focus();
  }

  // Till keyboard: F12 pays, F8 jumps to the customer, F4 changes the price
  // of the last line. Enter in search adds the top result (and is what a
  // keyboard-wedge scanner sends). Nothing pays while the price sheet is open.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (priceFor) return;
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

  return (
    <div className="pos-app" data-step={step} lang={lang}>
      <header className="pos-header">
        <div className="pos-brand">
          <strong>Kaunta</strong>
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
        <div className="pos-menu">
          <button
            type="button"
            className="pos-btn"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((open) => !open)}
          >
            {t('posMenu')}
          </button>
          {menuOpen && (
            <div className="pos-menu-list" role="menu">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  openBridge();
                }}
              >
                {t('posMore')}
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

      {step === 'done' && (
        <main className="pos-full">
          <section className="pos-done" data-held={held} aria-live="polite">
            <div className="pos-done-mark" aria-hidden="true">
              <svg
                width="30"
                height="30"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {held ? (
                  <>
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 8v4l3 2" />
                  </>
                ) : (
                  <path d="m5 12 5 5 9-10" />
                )}
              </svg>
            </div>
            <h2>{held ? t('posHeldTitle') : t('saleComplete')}</h2>
            {held && <p>{t('custodyNote')}</p>}
            <span className="pos-done-total pos-num">
              {money(Number(saleResult?.totalAmount ?? total))}
            </span>
            {saleResult?.salesOrderNumber && <p>{saleResult.salesOrderNumber}</p>}
          </section>
          <div className="pos-actions">
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
          <button type="button" className="pos-btn pos-btn-primary" onClick={newSale}>
            {t('newSale')}
          </button>
        </main>
      )}

      {step === 'queue' && (
        <main className="pos-full">
          <button type="button" className="pos-back" onClick={() => go('sale')}>
            ← {t('backToSale')}
          </button>
          <section className="pos-panel" aria-labelledby="pos-queue-title">
            <div className="pos-panel-head">
              <h2 id="pos-queue-title">{t('queueTitle')}</h2>
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

      {(step === 'sale' || step === 'pay') && (
        <>
          <div className="pos-body" data-step={step}>
            <section className="pos-panel pos-find" aria-label={t('addProducts')}>
              <label htmlFor="pos-search" className="pos-sr">
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
                  id="pos-search"
                  ref={searchRef}
                  value={query}
                  autoComplete="off"
                  placeholder={t('productSearchPlaceholder')}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && query.trim().length >= 2 && matches[0]) {
                      event.preventDefault();
                      addProduct(matches[0]);
                    } else if (event.key === 'Escape') {
                      setQuery('');
                    }
                  }}
                />
              </div>
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
              <p className="pos-keys">{t('posKeyHints')}</p>
            </section>

            <section className="pos-panel pos-cart" aria-labelledby="pos-cart-title">
              <div className="pos-panel-head">
                <h2 id="pos-cart-title">{t('saleItems')}</h2>
                <span>{t('items', { count: cartCount })}</span>
                <div className="pos-spacer" />
                {cart.length > 0 && (
                  <button type="button" className="pos-btn" onClick={newSale}>
                    {t('posClearCart')}
                  </button>
                )}
              </div>
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

            <section className="pos-panel pos-pay" aria-labelledby="pos-pay-title">
              <button type="button" className="pos-back" onClick={() => window.history.back()}>
                ← {t('backToSale')}
              </button>
              <div className="pos-pay-total">
                <span id="pos-pay-title">{t('posTotalDue')}</span>
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

              {(paymentMethod === 'CREDIT' || online) && (
                <div className="pos-field">
                  <span className="pos-field-label">
                    {paymentMethod === 'CREDIT' ? t('customer') : t('customerOptional')}
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
                      <label htmlFor="pos-customer" className="pos-sr">
                        {t('customerSearchPlaceholder')}
                      </label>
                      <input
                        id="pos-customer"
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

              {paymentMethod === 'CASH' && (
                <div className="pos-field">
                  <label htmlFor="pos-received">
                    {t('received')} {t('optional')}
                  </label>
                  <input
                    id="pos-received"
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
                      { label: t('exactAmount'), amount: Math.ceil(total) },
                      ...[5000, 10000, 20000, 50000]
                        .filter((amount) => amount >= total)
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
                    (receivedAmount >= total ? (
                      <p className="pos-note pos-num" data-tone="ok">
                        {t('changeDue')}:{' '}
                        <span className="pos-note-strong">{money(receivedAmount - total)}</span>
                      </p>
                    ) : (
                      <p className="pos-note pos-num" data-tone="warn">
                        {t('stillOwed')}: {money(total - receivedAmount)}
                      </p>
                    ))}
                </div>
              )}

              {selectedPayment?.requiresReference && (
                <div className="pos-field">
                  <label htmlFor="pos-reference">
                    {t('reference')} {t('optional')}
                  </label>
                  <input
                    id="pos-reference"
                    className="pos-input"
                    value={paymentReference}
                    placeholder={t('referencePlaceholder')}
                    onChange={(event) => setPaymentReference(event.target.value)}
                  />
                </div>
              )}

              {creditNeedsCustomer && cart.length > 0 && (
                <p className="pos-hint">{t('selectCreditCustomer')}</p>
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
              <button type="button" className="pos-btn" onClick={() => setConfirmRemoveId(item.id)}>
                {t('remove')}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

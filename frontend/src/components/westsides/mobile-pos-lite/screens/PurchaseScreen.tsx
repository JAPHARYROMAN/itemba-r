'use client';

import type { Dispatch, SetStateAction } from 'react';
import { ArrowLeft, ChevronRight, Minus, Plus, Search, Trash2 } from 'lucide-react';
import type { MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';
import type { PosScreen, PosTranslate, PurchaseLine, Supplier } from '../pos-types';
import { money } from '../pos-utils';
import { QuantityInput } from '../pos-ui';

export function PurchaseScreen({
  shellClass,
  online,
  notice,
  busy,
  supplier,
  setSupplier,
  supplierQuery,
  setSupplierQuery,
  suppliers,
  setSuppliers,
  purchaseQuery,
  setPurchaseQuery,
  purchaseMatches,
  addPurchaseProduct,
  purchaseCart,
  setPurchaseCart,
  setPurchaseQuantity,
  purchaseTotal,
  recordPurchase,
  t,
  setScreen,
  slabMode = false,
  slipParked = false,
  openHistory,
}: {
  shellClass: string;
  online: boolean;
  notice: string;
  busy: boolean;
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
  t: PosTranslate;
  setScreen: (screen: PosScreen) => void;
  /**
   * Kaunta shell mode: the bottom slab owns the POKEA verb, so the screen's
   * own record button is hidden. Classic passes nothing — byte-identical.
   */
  slabMode?: boolean;
  /**
   * Kaunta only: a kikaratasi for this terminal is on the phone, so the lines
   * on screen are backed by a saved slip. Says so calmly — this is the copy
   * that explains a form the manager did not just type.
   */
  slipParked?: boolean;
  /**
   * Kaunta only: → `#manunuzi/historia`, the branch's 7-day receiving book.
   * OPT-IN AND DEFAULTING OFF — classic (uiVersion 1) passes nothing, so the
   * row is not rendered there and the classic shell is untouched. This is also
   * the permission gate in practice: the shell only passes it on a session
   * that carries `mobile_pos_lite.purchase`, so a rep can never be shown a
   * control leading to an endpoint that would refuse her.
   */
  openHistory?: () => void;
}) {
  return (
    <main
      className={`min-h-screen px-4 py-4 pb-32${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
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
        {!online &&
          (slabMode ? (
            // Kaunta: offline is weather, not a warning (§3.1) — a calm note
            // that the form still works and the slip lands on the phone.
            <p
              className="mt-3 rounded-lg px-4 py-3 text-sm"
              style={{
                background: 'var(--aurora-bg-subtle)',
                color: 'var(--aurora-text-secondary)',
              }}
            >
              {t('purchaseOfflineNote')}
            </p>
          ) : (
            <p
              className="mt-3 rounded-lg px-4 py-3 text-sm font-semibold"
              style={{
                background: 'var(--aurora-warning-subtle)',
                color: 'var(--aurora-warning-text)',
              }}
            >
              {t('needsNetwork')}
            </p>
          ))}
        {slabMode && slipParked && (
          <p className="mt-3 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
            {t('slipSaved')}
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
              {slabMode && !online && (
                // Supplier search is the one part of Pokea that genuinely needs
                // the network (§3.1); saying so beats an input that answers
                // nothing. A supplier already chosen survives in the chip above.
                <p className="mt-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                  {t('needsNetwork')}
                </p>
              )}
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
                                  unitCost: event.target.value.replace(/[^0-9]/g, '').slice(0, 10),
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
        {/*
          The notice cell arrives ready to read and is printed verbatim. Round 3
          mapped it here instead, which could only ever be half a fix: this
          component is handed a STRING, so it cannot tell a 502 from a refusal,
          and anything the map did not recognise fell through as the backend's
          English in a red danger box. It also had to pass its OWN Swahili
          through untouched (`selectSupplierFirst`, `slipSaveFailed`), which is
          exactly why a screen-side "map or fall back" is impossible. The
          decision moved to `recordPurchase`, which still holds the error —
          see `posPurchaseFailureMessage`. Classic (uiVersion 1) is unchanged:
          it always printed this cell exactly as it came.
        */}
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
        {/* Historia ya Manunuzi — the same full-width secondary row Leo carries
         * for the sales book (spec-history-reports §2.1). Rendered only when
         * the shell hands the callback down, which it does only for a session
         * holding `mobile_pos_lite.purchase`: no dead control ever appears. */}
        {openHistory && (
          <button
            type="button"
            onClick={openHistory}
            className="mt-4 flex min-h-14 w-full items-center justify-between gap-3 rounded-lg border px-4 text-left"
            style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-base font-semibold" style={{ color: 'var(--aurora-text)' }}>
              {t('purchaseHistoryTitle')}
            </span>
            <ChevronRight
              size={19}
              style={{ color: 'var(--aurora-text-secondary)' }}
              aria-hidden="true"
            />
          </button>
        )}
        {!slabMode && (
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
        )}
      </div>
    </main>
  );
}

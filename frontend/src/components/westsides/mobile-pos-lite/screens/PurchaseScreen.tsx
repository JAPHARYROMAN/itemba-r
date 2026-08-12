'use client';

import type { Dispatch, SetStateAction } from 'react';
import { ArrowLeft, Minus, Plus, Search, Trash2 } from 'lucide-react';
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

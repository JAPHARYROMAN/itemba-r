'use client';

import { ArrowLeft, ChevronRight, Minus, Plus, Search, Trash2 } from 'lucide-react';
import type { MobilePosLiteProduct } from '@/lib/mobile-pos-lite-store';
import type { CartLine, PosScreen, PosTranslate } from '../pos-types';
import { money } from '../pos-utils';
import { QuantityInput } from '../pos-ui';

export function SaleScreen({
  shellClass,
  online,
  query,
  setQuery,
  quickPicks,
  matches,
  addProduct,
  cart,
  setQuantity,
  cartCount,
  total,
  setNotice,
  t,
  setScreen,
}: {
  shellClass: string;
  online: boolean;
  query: string;
  setQuery: (query: string) => void;
  quickPicks: MobilePosLiteProduct[];
  matches: MobilePosLiteProduct[];
  addProduct: (product: MobilePosLiteProduct) => void;
  cart: CartLine[];
  setQuantity: (productId: string, next: number) => void;
  cartCount: number;
  total: number;
  setNotice: (notice: string) => void;
  t: PosTranslate;
  setScreen: (screen: PosScreen) => void;
}) {
  return (
    <main
      className={`min-h-screen px-4 py-4 pb-32${shellClass}`}
      style={{ background: 'var(--aurora-bg)' }}
    >
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

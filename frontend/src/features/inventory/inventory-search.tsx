'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { AppIcon } from '@/components/ui';
import type { ScopeValue } from '@/components/ui';
import { backendPage } from '@/lib/api-client';

interface InventorySearchProduct {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  status?: string | null;
  availableQuantity?: number | string | null;
  inventoryBalance?: {
    availableQuantity?: number | string | null;
  } | null;
  category?: { name?: string | null } | null;
  productFamily?: { name?: string | null; brand?: string | null } | null;
  baseUnit?: { symbol?: string | null } | null;
  unitSymbol?: string | null;
}

export interface InventorySearchPermissions {
  balances: boolean;
  movements: boolean;
  batches: boolean;
  catalog: boolean;
}

interface InventorySearchProps {
  scope: ScopeValue;
  query: string;
  permissions: InventorySearchPermissions;
  onQueryChange: (query: string) => void;
  onNavigate: (href: string) => void;
}

type SearchExtras = Record<string, string | undefined>;

function appendScope(params: URLSearchParams, scope: ScopeValue) {
  if (scope.companyId) params.set('companyId', scope.companyId);
  if (scope.divisionId) params.set('divisionId', scope.divisionId);
  if (scope.branchId) params.set('branchId', scope.branchId);
}

export function inventoryViewHref(
  scope: ScopeValue,
  tab: string,
  view: string,
  extras: SearchExtras = {},
) {
  const params = new URLSearchParams({ tab, view });
  appendScope(params, scope);
  Object.entries(extras).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/inventory?${params.toString()}`;
}

export function inventoryProductHref(scope: ScopeValue, productId: string, query = '') {
  const params = new URLSearchParams();
  appendScope(params, scope);
  if (query.trim()) params.set('q', query.trim());
  const suffix = params.toString();
  return `/inventory/products/${encodeURIComponent(productId)}${suffix ? `?${suffix}` : ''}`;
}

function productIdentifier(product: InventorySearchProduct) {
  return product.productCode || product.sku || product.barcode || product.name;
}

function secondaryLabel(product: InventorySearchProduct) {
  const family = product.productFamily?.name
    ? [product.productFamily.brand, product.productFamily.name].filter(Boolean).join(' ')
    : '';
  return [product.category?.name, family].filter(Boolean).join(' · ');
}

function availableLabel(product: InventorySearchProduct, branchSelected: boolean) {
  if (!branchSelected) return '';
  const value = product.inventoryBalance?.availableQuantity ?? product.availableQuantity;
  const quantity = Number(value);
  if (!Number.isFinite(quantity)) return '';
  const unit = product.unitSymbol || product.baseUnit?.symbol;
  return `${new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 2 }).format(quantity)}${
    unit ? ` ${unit}` : ''
  } available`;
}

export default function InventorySearch({
  scope,
  query,
  permissions,
  onQueryChange,
  onNavigate,
}: InventorySearchProps) {
  const resultsId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(query);
  const [results, setResults] = useState<InventorySearchProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  useEffect(() => {
    setValue(query);
  }, [query]);

  useEffect(() => {
    const trimmed = value.trim();
    const controller = new AbortController();
    const timer = window.setTimeout(() => onQueryChange(trimmed), 250);

    if (trimmed.length < 2) {
      setResults([]);
      setTotal(0);
      setLoading(false);
      setFailed(false);
      return () => {
        window.clearTimeout(timer);
        controller.abort();
      };
    }

    setLoading(true);
    setFailed(false);
    const searchTimer = window.setTimeout(() => {
      backendPage<InventorySearchProduct>('/products', {
        query: {
          search: trimmed,
          companyId: scope.companyId || undefined,
          divisionId: scope.divisionId || undefined,
          branchId: scope.branchId || undefined,
          page: 1,
          limit: 8,
        },
        signal: controller.signal,
      })
        .then((page) => {
          setResults(page.data);
          setTotal(page.total);
          setHighlighted(0);
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setResults([]);
          setTotal(0);
          setFailed(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(searchTimer);
      controller.abort();
    };
  }, [onQueryChange, scope.branchId, scope.companyId, scope.divisionId, value]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open]);

  const navigate = (href: string) => {
    setOpen(false);
    onNavigate(href);
  };

  const openProduct = (product: InventorySearchProduct) => {
    navigate(inventoryProductHref(scope, product.id, value));
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && results[highlighted]) {
      event.preventDefault();
      openProduct(results[highlighted]);
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  };

  const showResults = open && value.trim().length >= 2;

  return (
    <div ref={rootRef} className="relative">
      <div
        className="flex h-11 items-center gap-2 rounded-md border px-3 transition-colors focus-within:ring-2"
        style={{
          borderColor: 'var(--aurora-border)',
          background: 'var(--aurora-card)',
          color: 'var(--aurora-text)',
        }}
      >
        <AppIcon name="search" size={18} className="shrink-0 text-[var(--aurora-text-muted)]" />
        <input
          type="search"
          role="combobox"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-label="Search inventory"
          aria-controls={showResults ? resultsId : undefined}
          aria-expanded={showResults}
          placeholder="Search products, codes, SKUs, barcodes, categories…"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--aurora-text-muted)]"
        />
        {value && (
          <button
            type="button"
            onClick={() => {
              setValue('');
              setResults([]);
              setTotal(0);
              setOpen(false);
              onQueryChange('');
            }}
            aria-label="Clear inventory search"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-[var(--aurora-bg-subtle)]"
          >
            <AppIcon name="close" size={16} />
          </button>
        )}
      </div>

      {showResults && (
        <div
          id={resultsId}
          className="absolute left-0 right-0 z-40 mt-1 max-h-[min(70vh,32rem)] overflow-y-auto rounded-lg border shadow-[var(--aurora-shadow-lg)]"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
          aria-live="polite"
        >
          {loading ? (
            <div
              className="flex items-center gap-2 px-4 py-5 text-sm"
              style={{ color: 'var(--aurora-text-secondary)' }}
            >
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--aurora-border)] border-t-[var(--aurora-primary)]" />
              Searching inventory…
            </div>
          ) : failed ? (
            <div className="px-4 py-5 text-sm" style={{ color: 'var(--aurora-danger)' }}>
              Inventory search is temporarily unavailable.
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-5 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
              No matching products found.
            </div>
          ) : (
            <>
              <ul className="divide-y divide-[var(--aurora-border)]">
                {results.map((product, index) => {
                  const identifier = productIdentifier(product);
                  const meta = secondaryLabel(product);
                  const available = availableLabel(product, Boolean(scope.branchId));
                  return (
                    <li
                      key={product.id}
                      className={index === highlighted ? 'bg-[var(--aurora-bg-subtle)]' : ''}
                      onMouseEnter={() => setHighlighted(index)}
                    >
                      <button
                        type="button"
                        onClick={() => openProduct(product)}
                        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
                      >
                        <span className="min-w-0">
                          <span
                            className="block truncate text-sm font-semibold"
                            style={{ color: 'var(--aurora-text)' }}
                          >
                            {product.name}
                          </span>
                          <span
                            className="mt-0.5 block truncate text-xs"
                            style={{ color: 'var(--aurora-text-secondary)' }}
                          >
                            {[identifier !== product.name ? identifier : '', meta]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {available && (
                            <span
                              className="block text-xs font-semibold"
                              style={{ color: 'var(--aurora-success)' }}
                            >
                              {available}
                            </span>
                          )}
                          {product.status && product.status !== 'ACTIVE' && (
                            <span
                              className="block text-[11px]"
                              style={{ color: 'var(--aurora-text-muted)' }}
                            >
                              {product.status.replaceAll('_', ' ')}
                            </span>
                          )}
                        </span>
                      </button>
                      {(permissions.balances || permissions.movements || permissions.batches) && (
                        <div className="flex flex-wrap gap-3 px-4 pb-3 text-xs font-medium">
                          {permissions.balances && (
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  inventoryViewHref(scope, 'stock', 'balances', {
                                    q: identifier,
                                  }),
                                )
                              }
                              className="text-[var(--aurora-primary)] hover:underline"
                            >
                              Balances
                            </button>
                          )}
                          {permissions.movements && (
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  inventoryViewHref(scope, 'stock', 'movements', {
                                    productId: product.id,
                                    q: value.trim(),
                                  }),
                                )
                              }
                              className="text-[var(--aurora-primary)] hover:underline"
                            >
                              Movements
                            </button>
                          )}
                          {permissions.batches && (
                            <button
                              type="button"
                              onClick={() =>
                                navigate(
                                  inventoryViewHref(scope, 'stock', 'batches', {
                                    productId: product.id,
                                    q: value.trim(),
                                  }),
                                )
                              }
                              className="text-[var(--aurora-primary)] hover:underline"
                            >
                              Batches
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
              {permissions.catalog && (
                <button
                  type="button"
                  onClick={() =>
                    navigate(inventoryViewHref(scope, 'catalog', 'products', { q: value.trim() }))
                  }
                  className="flex w-full items-center justify-between border-t px-4 py-3 text-left text-sm font-semibold text-[var(--aurora-primary)] hover:bg-[var(--aurora-bg-subtle)]"
                  style={{ borderColor: 'var(--aurora-border)' }}
                >
                  <span>View all matching products</span>
                  <span className="text-xs font-normal text-[var(--aurora-text-muted)]">
                    {total.toLocaleString('en-TZ')} found
                  </span>
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

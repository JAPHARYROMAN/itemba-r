'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { backendGet, backendList } from '@/lib/api-client';
import { AppIcon } from './icon-set';

export interface ProductPickerOption {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
  barcode?: string | null;
  status?: string | null;
  defaultUnitId?: string | null;
  effectivePurchasePrice?: number | string | null;
  availableQuantity?: number | string | null;
  inventoryBalance?: {
    availableQuantity?: number | string | null;
    quantityOnHand?: number | string | null;
  } | null;
  category?: { name?: string | null } | null;
  productFamily?: { name?: string | null; brand?: string | null } | null;
  baseUnit?: { name?: string | null; symbol?: string | null } | null;
  unitName?: string | null;
  unitSymbol?: string | null;
}

interface ProductPickerProps {
  value: string;
  onChange: (productId: string, product?: ProductPickerOption) => void;
  companyId?: string;
  divisionId?: string;
  branchId?: string;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  allowClear?: boolean;
  initialLabel?: string;
  className?: string;
}

interface PopupPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

function productIdentifier(product: ProductPickerOption) {
  return product.productCode || product.sku || product.barcode || '';
}

function labelFor(product: ProductPickerOption) {
  const identifier = productIdentifier(product);
  return identifier ? `${product.name} - ${identifier}` : product.name;
}

function productMeta(product: ProductPickerOption) {
  const family = [product.productFamily?.brand, product.productFamily?.name]
    .filter(Boolean)
    .join(' ');
  return [product.category?.name, family].filter(Boolean).join(' / ');
}

function availabilityFor(product: ProductPickerOption, branchSelected: boolean) {
  if (!branchSelected) return '';
  const raw =
    product.inventoryBalance?.availableQuantity ??
    product.availableQuantity ??
    product.inventoryBalance?.quantityOnHand;
  const quantity = Number(raw);
  if (!Number.isFinite(quantity)) return '';
  const unit = product.unitSymbol || product.baseUnit?.symbol;
  return `${new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 2 }).format(quantity)}${
    unit ? ` ${unit}` : ''
  } available`;
}

const FIELD_STYLE = {
  borderColor: 'var(--aurora-border)',
  background: 'var(--aurora-card)',
  color: 'var(--aurora-text)',
} as const;

/**
 * Company-scoped product search that can safely open inside modals, tables and
 * overflow containers. Results are portalled to the viewport so they remain
 * visible and include enough product context to make a reliable selection.
 */
export function ProductPicker({
  value,
  onChange,
  companyId,
  divisionId,
  branchId,
  placeholder = 'Search by product name, code, SKU or barcode',
  ariaLabel = 'Search products',
  disabled,
  allowClear = true,
  initialLabel,
  className,
}: ProductPickerProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const resolvedForRef = useRef<string>(value && initialLabel ? value : '');
  const [query, setQuery] = useState(initialLabel ?? '');
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ProductPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      if (!open) setQuery('');
      resolvedForRef.current = '';
      return;
    }
    if (resolvedForRef.current === value) return;

    let cancelled = false;
    backendGet<ProductPickerOption>(`/products/${value}`)
      .then((product) => {
        if (cancelled || !product) return;
        const label = labelFor(product);
        setSelectedLabel(label);
        setQuery(label);
        resolvedForRef.current = value;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, value]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const search = value && query === selectedLabel ? '' : query.trim();
    setLoading(true);
    setFailed(false);

    const timer = window.setTimeout(() => {
      backendList<ProductPickerOption>('/products', {
        query: {
          search: search || undefined,
          companyId: companyId || undefined,
          divisionId: divisionId || undefined,
          branchId: branchId || undefined,
          limit: 20,
        },
      })
        .then((rows) => {
          if (cancelled) return;
          setResults(rows);
          setHighlight(0);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setFailed(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [branchId, companyId, divisionId, open, query, selectedLabel, value]);

  const updatePopupPosition = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const rect = root.getBoundingClientRect();
    const viewportPadding = 8;
    const availableBelow = window.innerHeight - rect.bottom;
    const availableAbove = rect.top;
    const openAbove = availableBelow < 260 && availableAbove > availableBelow;
    const width = Math.min(
      Math.max(rect.width, 420),
      Math.max(240, window.innerWidth - viewportPadding * 2),
    );
    const left = Math.min(
      Math.max(viewportPadding, rect.left),
      Math.max(viewportPadding, window.innerWidth - width - viewportPadding),
    );
    const availableHeight = openAbove ? availableAbove : availableBelow;

    setPopupPosition({
      left,
      width,
      maxHeight: Math.max(160, Math.min(384, availableHeight - 12)),
      ...(openAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePopupPosition();
    window.addEventListener('resize', updatePopupPosition);
    window.addEventListener('scroll', updatePopupPosition, true);
    return () => {
      window.removeEventListener('resize', updatePopupPosition);
      window.removeEventListener('scroll', updatePopupPosition, true);
    };
  }, [open, updatePopupPosition]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) {
        setOpen(false);
        setQuery(selectedLabel);
      }
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeOnOutsideClick);
  }, [open, selectedLabel]);

  const selectProduct = (product: ProductPickerOption) => {
    const label = labelFor(product);
    setSelectedLabel(label);
    setQuery(label);
    setOpen(false);
    resolvedForRef.current = product.id;
    onChange(product.id, product);
  };

  const clear = () => {
    setSelectedLabel('');
    setQuery('');
    setResults([]);
    setOpen(false);
    resolvedForRef.current = '';
    onChange('');
    inputRef.current?.focus();
  };

  const onInputChange = (nextQuery: string) => {
    if (value && nextQuery !== selectedLabel) {
      setSelectedLabel('');
      resolvedForRef.current = '';
      onChange('');
    }
    setQuery(nextQuery);
    setOpen(true);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(current + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter' && open && results[highlight]) {
      event.preventDefault();
      selectProduct(results[highlight]);
    } else if (event.key === 'Escape') {
      setOpen(false);
      setQuery(selectedLabel);
    }
  };

  const popupStyle: CSSProperties | undefined = popupPosition
    ? {
        position: 'fixed',
        left: popupPosition.left,
        width: popupPosition.width,
        maxHeight: popupPosition.maxHeight,
        top: popupPosition.top,
        bottom: popupPosition.bottom,
        zIndex: 120,
      }
    : undefined;

  const popup =
    open && popupStyle
      ? createPortal(
          <div
            ref={popupRef}
            id={listId}
            role="listbox"
            aria-label="Products"
            style={{
              ...popupStyle,
              background: 'var(--aurora-card)',
              borderColor: 'var(--aurora-border)',
            }}
            className="overflow-y-auto rounded-lg border shadow-[var(--aurora-shadow-lg)]"
          >
            {loading ? (
              <div
                className="flex items-center gap-2 px-4 py-5 text-sm"
                style={{ color: 'var(--aurora-text-secondary)' }}
              >
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--aurora-border)] border-t-[var(--aurora-primary)]" />
                Searching products...
              </div>
            ) : failed ? (
              <div className="px-4 py-5 text-sm" style={{ color: 'var(--aurora-danger)' }}>
                Product search is temporarily unavailable.
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-5 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                No matching products found.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--aurora-border)]">
                {results.map((product, index) => {
                  const identifier = productIdentifier(product);
                  const meta = productMeta(product);
                  const availability = availabilityFor(product, Boolean(branchId));
                  const unit = product.unitSymbol || product.baseUnit?.symbol || product.unitName;
                  return (
                    <li
                      key={product.id}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={product.id === value}
                      className={index === highlight ? 'bg-[var(--aurora-bg-subtle)]' : ''}
                      onMouseEnter={() => setHighlight(index)}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectProduct(product)}
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
                            {[identifier, meta].filter(Boolean).join(' / ')}
                          </span>
                        </span>
                        <span className="shrink-0 text-right">
                          {availability && (
                            <span
                              className="block text-xs font-semibold"
                              style={{ color: 'var(--aurora-success)' }}
                            >
                              {availability}
                            </span>
                          )}
                          {unit && (
                            <span
                              className="block text-[11px]"
                              style={{ color: 'var(--aurora-text-muted)' }}
                            >
                              Unit: {unit}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className ?? ''}`}>
      <div
        className="flex h-10 items-center rounded-md border transition-colors focus-within:ring-2 focus-within:ring-[var(--aurora-primary)]"
        style={FIELD_STYLE}
      >
        <AppIcon
          name="search"
          size={16}
          className="ml-3 shrink-0 text-[var(--aurora-text-muted)]"
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && results[highlight] ? `${listId}-${highlight}` : undefined}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(event) => onInputChange(event.target.value)}
          onFocus={(event) => {
            setOpen(true);
            if (value) event.currentTarget.select();
          }}
          onKeyDown={onKeyDown}
          className="min-w-0 flex-1 bg-transparent px-2 text-sm outline-none placeholder:text-[var(--aurora-text-muted)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        {allowClear && value && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear product"
            title="Clear product"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--aurora-text-muted)] hover:bg-[var(--aurora-bg-subtle)] hover:text-[var(--aurora-text)]"
          >
            <AppIcon name="close" size={15} />
          </button>
        )}
        <button
          type="button"
          disabled={disabled}
          aria-label={open ? 'Close product list' : 'Show products'}
          title={open ? 'Close product list' : 'Show products'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const nextOpen = !open;
            inputRef.current?.focus();
            setOpen(nextOpen);
          }}
          className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--aurora-text-muted)] hover:bg-[var(--aurora-bg-subtle)] hover:text-[var(--aurora-text)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <AppIcon
            name="chevronDown"
            size={16}
            className={`transition-transform ${open ? 'rotate-180' : ''}`}
          />
        </button>
      </div>
      {popup}
    </div>
  );
}

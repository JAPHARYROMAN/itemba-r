'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { backendGet, backendList } from '@/lib/api-client';

export interface ProductPickerOption {
  id: string;
  name: string;
  productCode?: string | null;
  sku?: string | null;
}

interface ProductPickerProps {
  value: string;
  onChange: (productId: string, product?: ProductPickerOption) => void;
  /** Company scope for the search (and the backend availability join). */
  companyId?: string;
  branchId?: string;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  /** Pre-known label for the current value, to skip the lookup-by-id. */
  initialLabel?: string;
  className?: string;
}

function labelFor(p: ProductPickerOption) {
  const code = p.productCode || p.sku;
  return code ? `${code} — ${p.name}` : p.name;
}

const INPUT_STYLE = {
  borderColor: 'var(--aurora-border)',
  background: 'var(--aurora-card)',
  color: 'var(--aurora-text)',
} as const;

/**
 * Server-side, company-scoped product search combobox. Replaces the capped
 * native `<select>`s (which rendered hundreds of options) with a debounced
 * `/products?search=` lookup. Keyboard-operable (Arrow/Enter/Escape) with
 * combobox/listbox ARIA roles.
 */
export function ProductPicker({
  value,
  onChange,
  companyId,
  branchId,
  placeholder = 'Search products…',
  disabled,
  allowClear = true,
  initialLabel,
  className,
}: ProductPickerProps) {
  const listId = useId();
  const [query, setQuery] = useState(initialLabel ?? '');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<ProductPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [selectedLabel, setSelectedLabel] = useState(initialLabel ?? '');
  const rootRef = useRef<HTMLDivElement>(null);

  // Resolve a label for an externally-set value we don't already know.
  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      setQuery('');
      return;
    }
    if (selectedLabel) return;
    let cancelled = false;
    backendGet<ProductPickerOption>(`/products/${value}`)
      .then((p) => {
        if (cancelled || !p) return;
        const label = labelFor(p);
        setSelectedLabel(label);
        setQuery(label);
      })
      .catch(() => {
        /* leave the field blank if the product can't be resolved */
      });
    return () => {
      cancelled = true;
    };
    // selectedLabel intentionally omitted: only resolve when value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Debounced search while the dropdown is open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      backendList<ProductPickerOption>('/products', {
        query: {
          search: query.trim() || undefined,
          companyId: companyId || undefined,
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
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query, open, companyId, branchId]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery(selectedLabel);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open, selectedLabel]);

  const select = (p: ProductPickerOption) => {
    const label = labelFor(p);
    setSelectedLabel(label);
    setQuery(label);
    setOpen(false);
    onChange(p.id, p);
  };

  const clear = () => {
    setSelectedLabel('');
    setQuery('');
    setResults([]);
    onChange('');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      if (open && results[highlight]) {
        e.preventDefault();
        select(results[highlight]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery(selectedLabel);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className ?? ''}`}>
      <div className="flex items-center">
        <input
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && results[highlight] ? `${listId}-${highlight}` : undefined}
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full text-sm border rounded-md px-3 py-1.5 focus:outline-none disabled:opacity-50"
          style={INPUT_STYLE}
        />
        {allowClear && value && !disabled && (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear product"
            className="-ml-6 text-slate-400 hover:text-slate-600"
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border shadow-lg"
          style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)' }}
        >
          {loading ? (
            <li className="px-3 py-2 text-xs text-slate-400">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-xs text-slate-400">No products found</li>
          ) : (
            results.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={p.id === value}
                // preventDefault keeps the input focused so the click registers
                // before blur; selection itself happens on click (keyboard uses Enter).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(p)}
                onMouseEnter={() => setHighlight(i)}
                className={`cursor-pointer px-3 py-1.5 text-sm ${
                  i === highlight ? 'bg-[var(--aurora-bg-subtle)]' : ''
                }`}
              >
                {p.productCode || p.sku ? (
                  <>
                    <span className="font-mono text-xs text-slate-500">{p.productCode || p.sku}</span>{' '}
                    {p.name}
                  </>
                ) : (
                  p.name
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

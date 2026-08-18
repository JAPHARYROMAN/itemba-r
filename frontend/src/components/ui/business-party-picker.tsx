'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { backendGet, backendList } from '@/lib/api-client';
import { AppIcon } from './icon-set';

export interface BusinessPartyPickerOption {
  id: string;
  name: string;
  customerCode?: string | null;
  supplierCode?: string | null;
  customerType?: string | null;
  supplierType?: string | null;
  phone?: string | null;
  email?: string | null;
  tin?: string | null;
  vrn?: string | null;
  status?: string | null;
  divisionId?: string | null;
  branchId?: string | null;
  creditLimit?: number | string | null;
  currentBalance?: number | string | null;
  paymentTerms?: string | null;
}

type PartyKind = 'customer' | 'supplier';

interface BusinessPartyPickerProps {
  kind: PartyKind;
  value: string;
  onChange: (partyId: string, party?: BusinessPartyPickerOption) => void;
  onResolved?: (party: BusinessPartyPickerOption | null) => void;
  companyId?: string;
  divisionId?: string;
  branchId?: string;
  label?: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}

interface PopupPosition {
  left: number;
  width: number;
  maxHeight: number;
  top?: number;
  bottom?: number;
}

const partyCollator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

function identifierFor(party: BusinessPartyPickerOption, kind: PartyKind) {
  return kind === 'customer' ? party.customerCode : party.supplierCode;
}

function labelFor(party: BusinessPartyPickerOption, kind: PartyKind) {
  const identifier = identifierFor(party, kind);
  return identifier ? `${party.name} - ${identifier}` : party.name;
}

function sortParties(rows: BusinessPartyPickerOption[]) {
  return [...rows].sort(
    (left, right) =>
      partyCollator.compare(left.name, right.name) || partyCollator.compare(left.id, right.id),
  );
}

const FIELD_STYLE = {
  borderColor: 'var(--aurora-border)',
  background: 'var(--aurora-card)',
  color: 'var(--aurora-text)',
} as const;

/**
 * Server-backed customer/supplier combobox. The result list is portalled so it
 * remains usable inside order modals and other overflow containers.
 */
export function BusinessPartyPicker({
  kind,
  value,
  onChange,
  onResolved,
  companyId,
  divisionId,
  branchId,
  label,
  required,
  placeholder,
  disabled,
  allowClear = true,
  className,
}: BusinessPartyPickerProps) {
  const inputId = useId();
  const listId = `${inputId}-list`;
  const singular = kind === 'customer' ? 'customer' : 'supplier';
  const plural = kind === 'customer' ? 'customers' : 'suppliers';
  const endpoint = `/${plural}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const resolvedForRef = useRef('');
  const onResolvedRef = useRef(onResolved);
  onResolvedRef.current = onResolved;
  const [query, setQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<BusinessPartyPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [popupPosition, setPopupPosition] = useState<PopupPosition | null>(null);

  useEffect(() => {
    if (!value) {
      setSelectedLabel('');
      if (!open) setQuery('');
      resolvedForRef.current = '';
      onResolvedRef.current?.(null);
      return;
    }
    if (resolvedForRef.current === value) return;

    let cancelled = false;
    backendGet<BusinessPartyPickerOption>(`${endpoint}/${value}`)
      .then((party) => {
        if (cancelled || !party) return;
        const nextLabel = labelFor(party, kind);
        setSelectedLabel(nextLabel);
        setQuery(nextLabel);
        resolvedForRef.current = value;
        onResolvedRef.current?.(party);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [endpoint, kind, open, value]);

  useEffect(() => {
    if (!open || disabled || !companyId) return;
    let cancelled = false;
    const search = value && query === selectedLabel ? '' : query.trim();
    setLoading(true);
    setFailed(false);

    const timer = window.setTimeout(() => {
      backendList<BusinessPartyPickerOption>(endpoint, {
        query: {
          search: search || undefined,
          companyId,
          divisionId: divisionId || undefined,
          branchId: branchId || undefined,
          status: 'ACTIVE',
          limit: 50,
        },
      })
        .then((rows) => {
          if (cancelled) return;
          setResults(sortParties(rows));
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
  }, [branchId, companyId, disabled, divisionId, endpoint, open, query, selectedLabel, value]);

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

  const selectParty = (party: BusinessPartyPickerOption) => {
    const nextLabel = labelFor(party, kind);
    setSelectedLabel(nextLabel);
    setQuery(nextLabel);
    setOpen(false);
    resolvedForRef.current = party.id;
    onResolvedRef.current?.(party);
    onChange(party.id, party);
  };

  const clear = () => {
    setSelectedLabel('');
    setQuery('');
    setResults([]);
    setOpen(false);
    resolvedForRef.current = '';
    onResolvedRef.current?.(null);
    onChange('');
    inputRef.current?.focus();
  };

  const onInputChange = (nextQuery: string) => {
    if (value && nextQuery !== selectedLabel) {
      setSelectedLabel('');
      resolvedForRef.current = '';
      onResolvedRef.current?.(null);
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
      selectParty(results[highlight]);
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
        zIndex: 1600,
      }
    : undefined;

  const popup =
    open && popupStyle
      ? createPortal(
          <div
            ref={popupRef}
            id={listId}
            role="listbox"
            aria-label={`${kind === 'customer' ? 'Customers' : 'Suppliers'}`}
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
                Searching {plural}...
              </div>
            ) : failed ? (
              <div className="px-4 py-5 text-sm" style={{ color: 'var(--aurora-danger)' }}>
                {kind === 'customer' ? 'Customer' : 'Supplier'} search is temporarily unavailable.
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-5 text-sm" style={{ color: 'var(--aurora-text-secondary)' }}>
                No matching {plural} found.
              </div>
            ) : (
              <ul className="divide-y divide-[var(--aurora-border)]">
                {results.map((party, index) => {
                  const identifier = identifierFor(party, kind);
                  const contact = party.phone || party.email;
                  const registration = party.tin
                    ? `TIN ${party.tin}`
                    : party.vrn
                      ? `VRN ${party.vrn}`
                      : '';
                  return (
                    <li
                      key={party.id}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={party.id === value}
                      className={index === highlight ? 'bg-[var(--aurora-bg-subtle)]' : ''}
                      onMouseEnter={() => setHighlight(index)}
                    >
                      <button
                        type="button"
                        tabIndex={-1}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => selectParty(party)}
                        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left"
                      >
                        <span className="min-w-0">
                          <span
                            className="block truncate text-sm font-semibold"
                            style={{ color: 'var(--aurora-text)' }}
                          >
                            {party.name}
                          </span>
                          <span
                            className="mt-0.5 block truncate text-xs"
                            style={{ color: 'var(--aurora-text-secondary)' }}
                          >
                            {[identifier, contact].filter(Boolean).join(' / ') ||
                              'No contact details'}
                          </span>
                        </span>
                        {registration && (
                          <span
                            className="shrink-0 text-xs"
                            style={{ color: 'var(--aurora-text-muted)' }}
                          >
                            {registration}
                          </span>
                        )}
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
    <div className={className}>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-[12px] font-medium"
          style={{ color: 'var(--aurora-text-secondary)' }}
        >
          {label}
          {required && (
            <span className="ml-0.5" style={{ color: 'var(--aurora-danger)' }}>
              *
            </span>
          )}
        </label>
      )}
      <div ref={rootRef} className="relative min-w-0">
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
            id={inputId}
            type="search"
            role="combobox"
            aria-label={!label ? `Search ${plural}` : undefined}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={
              open && results[highlight] ? `${listId}-${highlight}` : undefined
            }
            value={query}
            disabled={disabled}
            required={required}
            placeholder={placeholder ?? `Search ${plural} by name, code, phone, email or TIN`}
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
              aria-label={`Clear ${singular}`}
              title={`Clear ${singular}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--aurora-text-muted)] hover:bg-[var(--aurora-bg-subtle)] hover:text-[var(--aurora-text)]"
            >
              <AppIcon name="close" size={15} />
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            aria-label={open ? `Close ${singular} list` : `Show ${plural}`}
            title={open ? `Close ${singular} list` : `Show ${plural}`}
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
      </div>
      {popup}
    </div>
  );
}

type TypedPartyPickerProps = Omit<BusinessPartyPickerProps, 'kind'>;

export function CustomerPicker(props: TypedPartyPickerProps) {
  return <BusinessPartyPicker {...props} kind="customer" />;
}

export function SupplierPicker(props: TypedPartyPickerProps) {
  return <BusinessPartyPicker {...props} kind="supplier" />;
}

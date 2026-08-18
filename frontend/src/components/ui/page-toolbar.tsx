'use client';
import { Search, X } from 'lucide-react';
import React from 'react';

interface PageToolbarProps {
  /** Search input value */
  search?: string;
  onSearch?: (v: string) => void;
  /** Placeholder text */
  searchPlaceholder?: string;
  /** Extra filter controls (selects, date pickers, etc.) placed inline */
  filters?: React.ReactNode;
  /** Action buttons placed on the right side */
  actions?: React.ReactNode;
  /** Additional className for the wrapper */
  className?: string;
}

export function PageToolbar({
  search,
  onSearch,
  searchPlaceholder = 'Search…',
  filters,
  actions,
  className = '',
}: PageToolbarProps) {
  return (
    <div data-page-toolbar className={`flex flex-wrap items-center gap-2 mb-4 ${className}`}>
      {/* Search */}
      {onSearch !== undefined && (
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
            style={{ color: 'var(--aurora-text-muted)' }}
          />
          <input
            type="search"
            aria-label={searchPlaceholder}
            value={search ?? ''}
            onChange={(e) => onSearch(e.target.value)}
            placeholder={searchPlaceholder}
            className="
              w-full rounded-lg border py-1.5 pl-8 pr-8 text-[13px] transition-colors
              [&::-webkit-search-cancel-button]:hidden
              focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500
            "
            style={{
              color: 'var(--aurora-text)',
              borderColor: 'var(--aurora-border)',
              background: 'var(--aurora-card)',
            }}
          />
          {search ? (
            <button
              type="button"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => onSearch('')}
              className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md transition-colors hover:bg-[var(--aurora-bg-subtle)] focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{ color: 'var(--aurora-text-muted)' }}
            >
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      )}

      {/* Extra filters */}
      {filters && <div className="flex items-center gap-2 flex-wrap">{filters}</div>}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

// ── Section header inside a card ──────────────────────────────────────────
interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}

export function SectionHeader({ title, subtitle, action, className = '' }: SectionHeaderProps) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-3 ${className}`}>
      <div>
        <h3 className="text-[13px] font-semibold" style={{ color: 'var(--aurora-text)' }}>{title}</h3>
        {subtitle && (
          <p className="text-[11px] mt-0.5" style={{ color: 'var(--aurora-text-muted)' }}>{subtitle}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}

'use client';
import React, { useState } from 'react';
import { DataTable, Column as BaseColumn } from './DataTable';
import { ErrorState } from '../feedback/ErrorState';

/**
 * ResponsiveDataTable — drop-in wrapper over Aurora's DataTable that adds:
 *
 *  1. **Per-column responsive priority.** Each column gets a `priority`
 *     (1 = always visible, 2 = hidden on small phones, 3 = hidden on tablets
 *     and below). On narrow viewports, low-priority columns are hidden.
 *  2. **Mobile card mode.** When `cardMode="auto"` (default) and the viewport
 *     is narrow, rows render as stacked cards instead of a horizontally
 *     scrolling table — easier to read on phones.
 *
 * Adoption guide for existing pages (audit F-031, F-032):
 *
 *   1. Replace `<DataTable ... />` with `<ResponsiveDataTable ... />`.
 *   2. Add `priority` to each column:
 *      - `1` for the row identifier and the most important amount/status.
 *      - `2` for fields that matter on tablets but not phones.
 *      - `3` for everything else (timestamps, metadata).
 *   3. No other changes needed; the table degrades gracefully.
 *
 * The wrapper is purely additive — pages that don't migrate keep working,
 * they just don't benefit from mobile layout. New pages should use
 * ResponsiveDataTable from the start.
 */

export interface ResponsiveColumn<T> extends BaseColumn<T> {
  /**
   * Visibility priority on narrow viewports.
   *  - 1 (default): always visible.
   *  - 2: hidden below 640px (sm breakpoint).
   *  - 3: hidden below 768px (md breakpoint).
   */
  priority?: 1 | 2 | 3;
}

interface ResponsiveDataTableProps<T> {
  columns: ResponsiveColumn<T>[];
  data: T[];
  keyField?: string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  onSearch?: (query: string) => void;
  searchValue?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    onPageChange: (page: number) => void;
    onLimitChange?: (limit: number) => void;
  };
  actions?: React.ReactNode;
  filters?: React.ReactNode;
  onRowClick?: (row: T) => void;
  compact?: boolean;
  className?: string;
  /**
   * When set (truthy), render an ErrorState with an optional retry button
   * instead of the rows (both in table and card layouts).
   */
  error?: boolean | string | Error | null;
  /** Retry handler shown as a button inside the error state. */
  onRetry?: () => void;
  /** Optional title for the error state. */
  errorTitle?: string;
  /** Show an "Export CSV" button in the toolbar. */
  exportable?: boolean;
  /** Custom export handler receiving the displayed rows. */
  onExport?: (rows: T[]) => void;
  /** Base filename (no extension) for the auto CSV export. */
  exportFileName?: string;
  /** Render CSV + PDF export buttons (see DataTable.exportPdf). */
  exportPdf?: boolean | { title?: string; subtitle?: string; companyId?: string };
  /** Custom PDF export handler receiving the displayed rows. */
  onExportPdf?: (rows: T[]) => void;
  /** Make the header stick to the top on scroll (default true). */
  stickyHeader?: boolean;
  /**
   * - `'auto'` (default): card layout on viewports < 640px, table otherwise.
   * - `'never'`: always render as a table (use the underlying DataTable directly if
   *   you need this — the wrapper exists primarily for the auto behavior).
   */
  cardMode?: 'auto' | 'never';
}

export function ResponsiveDataTable<T extends Record<string, unknown>>(
  props: ResponsiveDataTableProps<T>,
) {
  const { columns, data, cardMode = 'auto', onRowClick, keyField = 'id', ...rest } = props;
  const isNarrow = useIsNarrowViewport();

  // Filter columns by responsive priority.
  const visibleColumns: BaseColumn<T>[] = columns.map((c) => ({ ...c })).filter((c) => {
    const priority = (c as ResponsiveColumn<T>).priority ?? 1;
    if (!isNarrow) return true;
    if (isNarrow.breakpoint === 'sm') return priority <= 2;
    return priority === 1;
  });

  if (cardMode === 'auto' && isNarrow && isNarrow.breakpoint === 'xs') {
    return (
      <CardList
        columns={columns}
        data={data}
        keyField={keyField}
        onRowClick={onRowClick}
        loading={rest.loading}
        error={rest.error}
        onRetry={rest.onRetry}
        errorTitle={rest.errorTitle}
        emptyTitle={rest.emptyTitle ?? 'No records found'}
        emptyDescription={rest.emptyDescription ?? 'There are no records to display.'}
      />
    );
  }

  return <DataTable columns={visibleColumns} data={data} keyField={keyField} onRowClick={onRowClick} {...rest} />;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

interface NarrowState {
  breakpoint: 'xs' | 'sm';
}

function useIsNarrowViewport(): NarrowState | null {
  const [state, setState] = useState<NarrowState | null>(() =>
    typeof window === 'undefined' ? null : computeBreakpoint(window.innerWidth),
  );

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onResize = () => setState(computeBreakpoint(window.innerWidth));
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return state;
}

function computeBreakpoint(width: number): NarrowState | null {
  if (width < 640) return { breakpoint: 'xs' };
  if (width < 768) return { breakpoint: 'sm' };
  return null;
}

function CardList<T extends Record<string, unknown>>({
  columns,
  data,
  keyField,
  onRowClick,
  loading,
  error,
  onRetry,
  errorTitle,
  emptyTitle,
  emptyDescription,
}: {
  columns: ResponsiveColumn<T>[];
  data: T[];
  keyField: string;
  onRowClick?: (row: T) => void;
  loading?: boolean;
  error?: boolean | string | Error | null;
  onRetry?: () => void;
  errorTitle?: string;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (error) {
    const description = typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : undefined;
    return (
      <div
        className="rounded-lg border"
        style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-card)' }}
        role="status"
      >
        <ErrorState title={errorTitle} description={description} onRetry={onRetry} />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="space-y-3" role="list">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-24 rounded-lg aurora-skeleton"
            style={{ background: 'var(--aurora-bg-muted)' }}
            aria-hidden="true"
          />
        ))}
      </div>
    );
  }

  if (!data.length) {
    return (
      <div
        className="rounded-lg border p-6 text-center"
        style={{ borderColor: 'var(--aurora-border)' }}
        role="status"
      >
        <p className="font-semibold" style={{ color: 'var(--aurora-text)' }}>{emptyTitle}</p>
        <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>{emptyDescription}</p>
      </div>
    );
  }

  return (
    <ul className="space-y-3" role="list">
      {data.map((row) => {
        const id = (row as any)[keyField];
        const interactive = !!onRowClick;
        return (
          <li
            key={id ?? Math.random()}
            className={`rounded-lg border p-4 ${interactive ? 'cursor-pointer hover:bg-[var(--aurora-bg-hover)]' : ''}`}
            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-card)' }}
            onClick={interactive ? () => onRowClick!(row) : undefined}
            role={interactive ? 'button' : undefined}
            tabIndex={interactive ? 0 : undefined}
            onKeyDown={
              interactive
                ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onRowClick!(row);
                    }
                  }
                : undefined
            }
          >
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-sm">
              {columns.map((c) => {
                const value = c.accessor ? c.accessor(row) : ((row as any)[c.key] as React.ReactNode);
                return (
                  <React.Fragment key={c.key}>
                    <dt className="font-medium" style={{ color: 'var(--aurora-text-muted)' }}>
                      {c.header}
                    </dt>
                    <dd style={{ color: 'var(--aurora-text)' }}>{value ?? '—'}</dd>
                  </React.Fragment>
                );
              })}
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

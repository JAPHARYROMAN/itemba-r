'use client';
import React, { useState } from 'react';
import { LoadingState } from './loading-state';
import { EmptyState }   from './empty-state';

export interface Column<T = Record<string, unknown>> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'right' | 'center';
}

interface PaginationProps {
  page: number;
  totalPages: number;
  total: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
}

interface DataTableProps<T = Record<string, unknown>> {
  columns: Column<T>[];
  data: T[];
  keyField: keyof T;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  pagination?: PaginationProps;
  onRowClick?: (row: T) => void;
  className?: string;
  compact?: boolean;
}

export function DataTable<T = Record<string, unknown>>({
  columns, data, keyField, loading, emptyTitle, emptyDescription,
  pagination, onRowClick, className = '', compact = false,
}: DataTableProps<T>) {
  const [sortKey, setSortKey]     = useState<string | null>(null);
  const [sortDir, setSortDir]     = useState<'asc' | 'desc'>('asc');

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = React.useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = (a as Record<string, unknown>)[sortKey];
      const bv = (b as Record<string, unknown>)[sortKey];
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir]);

  const rowPad = compact ? 'px-4 py-2' : 'px-4 py-3';

  return (
    <div className={`flex flex-col ${className}`}>
      <div
        className="overflow-auto rounded-xl"
        style={{
          border: '1px solid var(--aurora-border)',
          background: 'var(--aurora-card)',
          color: 'var(--aurora-text)',
          boxShadow: 'var(--aurora-shadow-sm)',
        }}
      >
        <table className="w-full text-[13px] text-left">
          <thead>
            <tr
              style={{
                background: 'var(--aurora-bg-subtle)',
                borderBottom: '1px solid var(--aurora-border)',
              }}
            >
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{ width: col.width, color: 'var(--aurora-text-muted)' }}
                  className={`${rowPad} font-medium text-[11px] uppercase tracking-wide whitespace-nowrap select-none
                    ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}
                    ${col.sortable ? 'cursor-pointer' : ''}`}
                  onClick={col.sortable ? () => handleSort(col.key) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.header}
                    {col.sortable && sortKey === col.key && (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={sortDir === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
                      </svg>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!loading && sorted.map((row) => (
              <tr
                key={String(row[keyField])}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={`transition-colors ${onRowClick ? 'cursor-pointer' : ''}`}
                style={{ borderTop: '1px solid var(--aurora-border)' }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`${rowPad} ${col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : ''}`}
                    style={{ color: 'var(--aurora-text-secondary)' }}
                  >
                    {col.render
                      ? col.render(row)
                      : String((row as Record<string, unknown>)[col.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {loading && <LoadingState rows={5} />}
        {!loading && sorted.length === 0 && (
          <EmptyState title={emptyTitle} description={emptyDescription} />
        )}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div
          className="flex items-center justify-between mt-3 text-[12px]"
          style={{ color: 'var(--aurora-text-muted)' }}
        >
          <span>{pagination.total} total</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-2.5 py-1 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ border: '1px solid var(--aurora-border)', color: 'var(--aurora-text)' }}
            >
              ‹
            </button>
            {Array.from({ length: Math.min(pagination.totalPages, 7) }, (_, i) => {
              const p = i + 1;
              const active = p === pagination.page;
              return (
                <button
                  key={p}
                  onClick={() => pagination.onPageChange(p)}
                  className="px-2.5 py-1 rounded-md transition-colors"
                  style={{
                    border: `1px solid ${active ? 'var(--aurora-primary)' : 'var(--aurora-border)'}`,
                    background: active ? 'var(--aurora-primary-subtle)' : 'transparent',
                    color: active ? 'var(--aurora-primary-text)' : 'var(--aurora-text)',
                    fontWeight: active ? 500 : 400,
                  }}
                >
                  {p}
                </button>
              );
            })}
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
              className="px-2.5 py-1 rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ border: '1px solid var(--aurora-border)', color: 'var(--aurora-text)' }}
            >
              ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

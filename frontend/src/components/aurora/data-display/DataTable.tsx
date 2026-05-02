'use client';
import React, { useState, useMemo } from 'react';

export interface Column<T> {
  key: string;
  header: string;
  accessor?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
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
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded aurora-skeleton" style={{ width: `${60 + (i * 7) % 30}%`, background: 'var(--aurora-bg-muted)' }} />
        </td>
      ))}
    </tr>
  );
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  keyField = 'id',
  loading = false,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no records to display.',
  searchable = false,
  searchPlaceholder = 'Search...',
  onSearch,
  searchValue = '',
  pagination,
  actions,
  filters,
  onRowClick,
  compact = false,
  className = '',
}: DataTableProps<T>) {
  const [localSearch, setLocalSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const query = onSearch ? searchValue : localSearch;

  function handleSearch(val: string) {
    if (onSearch) {
      onSearch(val);
    } else {
      setLocalSearch(val);
    }
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sortedData = useMemo(() => {
    if (!sortKey || onSearch) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, onSearch]);

  const filteredData = useMemo(() => {
    if (onSearch || !query) return sortedData;
    const q = query.toLowerCase();
    return sortedData.filter(row =>
      Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q))
    );
  }, [sortedData, query, onSearch]);

  const rowPad = compact ? 'px-4 py-2.5' : 'px-4 py-3.5';
  const thPad = compact ? 'px-4 py-2' : 'px-4 py-3';

  return (
    <div className={`rounded-aurora border overflow-hidden ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}>

      {/* Toolbar */}
      {(searchable || actions || filters) && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--aurora-border)' }}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            {searchable && (
              <div className="relative flex-1 max-w-xs">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" fill="none" viewBox="0 0 24 24"
                  stroke="currentColor" strokeWidth={2} style={{ color: 'var(--aurora-text-muted)' }}>
                  <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  type="search"
                  placeholder={searchPlaceholder}
                  value={query}
                  onChange={e => handleSearch(e.target.value)}
                  className="aurora-input pl-9 text-sm"
                  style={{ height: '36px' }}
                />
              </div>
            )}
            {filters}
          </div>
          {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="aurora-table" style={{ width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--aurora-bg-subtle)' }}>
              {columns.map(col => (
                <th key={col.key} className={`${thPad} text-left`} style={{ width: col.width }}>
                  {col.sortable ? (
                    <button
                      onClick={() => toggleSort(col.key)}
                      className="flex items-center gap-1 group"
                      style={{ color: 'var(--aurora-text-muted)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 'inherit', fontWeight: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit' }}
                    >
                      {col.header}
                      <span style={{ color: sortKey === col.key ? 'var(--aurora-primary)' : 'var(--aurora-text-muted)', opacity: sortKey === col.key ? 1 : 0.4 }}>
                        {sortKey === col.key && sortDir === 'desc' ? '↓' : '↑'}
                      </span>
                    </button>
                  ) : (
                    <span style={{ fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--aurora-text-muted)' }}>
                      {col.header}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => <SkeletonRow key={i} cols={columns.length} />)
            ) : filteredData.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}
                      style={{ color: 'var(--aurora-text-muted)' }}>
                      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 01-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 011-.01l7-2.5 7 2.5a1 1 0 011 1z"/>
                    </svg>
                    <div>
                      <p className="text-sm font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>{emptyTitle}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--aurora-text-muted)' }}>{emptyDescription}</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : (
              filteredData.map((row, rowIndex) => (
                <tr
                  key={String(row[keyField] ?? rowIndex)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={onRowClick ? 'cursor-pointer' : ''}
                  style={{ transition: 'background-color 100ms ease' }}
                  onMouseEnter={e => { if (onRowClick) (e.currentTarget as HTMLTableRowElement).style.background = 'var(--aurora-bg-subtle)'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLTableRowElement).style.background = ''; }}
                >
                  {columns.map(col => (
                    <td key={col.key} className={`${rowPad} ${col.className ?? ''}`}
                      style={{ textAlign: col.align ?? 'left', fontSize: '0.875rem', color: 'var(--aurora-text)' }}>
                      {col.accessor ? col.accessor(row) : String(row[col.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="flex items-center justify-between px-4 py-3 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
          <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
            Showing {Math.min((pagination.page - 1) * pagination.limit + 1, pagination.total)}–
            {Math.min(pagination.page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()} records
          </p>
          <div className="flex items-center gap-2">
            {pagination.onLimitChange && (
              <select
                value={pagination.limit}
                onChange={e => pagination.onLimitChange!(Number(e.target.value))}
                className="aurora-input text-xs"
                style={{ width: '70px', height: '32px', padding: '0 0.5rem' }}
              >
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}/page</option>)}
              </select>
            )}
            <div className="flex items-center gap-1">
              <button
                onClick={() => pagination.onPageChange(pagination.page - 1)}
                disabled={pagination.page <= 1}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-sm disabled:opacity-40 transition-colors"
                style={{ border: '1px solid var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text-secondary)' }}
                aria-label="Previous page"
              >‹</button>
              <span className="px-3 text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
                {pagination.page} / {Math.ceil(pagination.total / pagination.limit)}
              </span>
              <button
                onClick={() => pagination.onPageChange(pagination.page + 1)}
                disabled={pagination.page >= Math.ceil(pagination.total / pagination.limit)}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-sm disabled:opacity-40 transition-colors"
                style={{ border: '1px solid var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text-secondary)' }}
                aria-label="Next page"
              >›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

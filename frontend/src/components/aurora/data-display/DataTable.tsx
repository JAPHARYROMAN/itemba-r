'use client';
import React, { useState, useMemo } from 'react';
import { ErrorState } from '../feedback/ErrorState';
import { showToast } from '../feedback/Toast';
import { rowsToCsv, downloadTextFile, cellToString } from '@/lib/report-export';
import { downloadTablePdf } from '@/lib/export-download';

export interface Column<T> {
  key: string;
  header: string;
  accessor?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
  align?: 'left' | 'center' | 'right';
  className?: string;
  /** Exclude this column when generating CSV exports (e.g. action buttons). */
  exportExclude?: boolean;
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
  /**
   * When set (truthy), the table body is replaced with an ErrorState instead of
   * rendering rows. Accepts a boolean, a string (used as the description), or an
   * Error. Toolbar and pagination still render so the user can retry/adjust.
   */
  error?: boolean | string | Error | null;
  /** Retry handler shown as a button inside the error state. */
  onRetry?: () => void;
  /** Optional title for the error state (defaults to the ErrorState default). */
  errorTitle?: string;
  /**
   * When true, render an "Export CSV" button in the toolbar. By default it
   * exports the current (filtered/sorted) rows using each column's `key` as the
   * CSV header. Provide `onExport` to fully override the export behavior.
   */
  exportable?: boolean;
  /**
   * Custom export handler. Receives the rows currently displayed (after local
   * search/sort). When omitted and `exportable` is true, a CSV of those rows is
   * downloaded automatically.
   */
  onExport?: (rows: T[]) => void;
  /** Base filename (no extension) for the auto CSV export. */
  exportFileName?: string;
  /**
   * When set (truthy), the toolbar renders compact "CSV" and "PDF" buttons in
   * place of the single "Export" button. The PDF button posts the current
   * (filtered/sorted) rows to the generic table-PDF endpoint. Pass an object to
   * customize the PDF document title/subtitle or brand it with a company's
   * letterhead. When absent, rendering is unchanged.
   */
  exportPdf?: boolean | { title?: string; subtitle?: string; companyId?: string };
  /**
   * Custom PDF export handler. Receives the rows currently displayed (after
   * local search/sort). When omitted and `exportPdf` is set, the rows are sent
   * to the generic table-PDF endpoint automatically.
   */
  onExportPdf?: (rows: T[]) => void;
  /** Make the header stick to the top of the scroll container (default false; opt-in). */
  stickyHeader?: boolean;
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
  error = null,
  onRetry,
  errorTitle,
  exportable = false,
  onExport,
  exportFileName = 'export',
  exportPdf,
  onExportPdf,
  stickyHeader = false,
}: DataTableProps<T>) {
  const [localSearch, setLocalSearch] = useState('');
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [pdfExporting, setPdfExporting] = useState(false);

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

  const hasError = Boolean(error);
  const hasPdfExport = Boolean(exportPdf);
  const exportDisabled = hasError || loading || filteredData.length === 0;
  const errorDescription = typeof error === 'string'
    ? error
    : error instanceof Error
      ? error.message
      : undefined;

  /** Build the export matrix from the displayed rows, skipping exportExclude columns. */
  function buildExportMatrix() {
    const exportColumns = columns.filter(c => !c.exportExclude);
    const records: Record<string, unknown>[] = filteredData.map(row => {
      const rec: Record<string, unknown> = {};
      for (const col of exportColumns) {
        const value = row[col.key];
        rec[col.header] = value === undefined ? '' : value;
      }
      return rec;
    });
    const headers = exportColumns.map(c => c.header);
    return { exportColumns, headers, records };
  }

  function handleExport() {
    if (onExport) {
      onExport(filteredData);
      return;
    }
    const { headers, records } = buildExportMatrix();
    const csv = rowsToCsv(records, headers);
    if (csv) {
      const stamp = new Date().toISOString().slice(0, 10);
      downloadTextFile(`${exportFileName}-${stamp}.csv`, 'text/csv;charset=utf-8', csv);
    }
  }

  async function handleExportPdf() {
    if (onExportPdf) {
      onExportPdf(filteredData);
      return;
    }
    const cfg = typeof exportPdf === 'object' && exportPdf !== null ? exportPdf : {};
    const { exportColumns, headers, records } = buildExportMatrix();
    const rows = records.map(rec => headers.map(h => cellToString(rec[h])));
    const numericColumns = exportColumns
      .map((c, i) => (c.align === 'right' ? i : -1))
      .filter(i => i >= 0);
    setPdfExporting(true);
    try {
      await downloadTablePdf({
        title: cfg.title ?? exportFileName,
        subtitle: cfg.subtitle,
        companyId: cfg.companyId,
        columns: headers,
        rows,
        numericColumns: numericColumns.length ? numericColumns : undefined,
        baseName: exportFileName,
      });
    } catch (err) {
      showToast(
        'error',
        'Could not export PDF',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setPdfExporting(false);
    }
  }

  const rowPad = compact ? 'px-4 py-2.5' : 'px-4 py-3.5';
  const thPad = compact ? 'px-4 py-2' : 'px-4 py-3';
  const stickyThStyle: React.CSSProperties = stickyHeader
    ? { position: 'sticky', top: 0, zIndex: 1, background: 'var(--aurora-bg-subtle)' }
    : {};

  return (
    <div className={`rounded-aurora border overflow-hidden ${className}`}
      style={{ background: 'var(--aurora-card)', borderColor: 'var(--aurora-border)', boxShadow: 'var(--aurora-shadow-sm)' }}>

      {/* Toolbar */}
      {(searchable || actions || filters || exportable || hasPdfExport) && (
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
          {(actions || exportable || hasPdfExport) && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {actions}
              {hasPdfExport ? (
                <>
                  <button
                    type="button"
                    onClick={handleExport}
                    disabled={exportDisabled}
                    className="flex items-center gap-1.5 text-sm font-medium px-3 rounded-lg transition-colors disabled:opacity-40"
                    style={{ height: '36px', border: '1px solid var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text-secondary)' }}
                    aria-label="Export to CSV"
                    title="Export to CSV"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdf}
                    disabled={exportDisabled || pdfExporting}
                    className="flex items-center gap-1.5 text-sm font-medium px-3 rounded-lg transition-colors disabled:opacity-40"
                    style={{ height: '36px', border: '1px solid var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text-secondary)' }}
                    aria-label="Export to PDF"
                    title="Export to PDF"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                    </svg>
                    {pdfExporting ? 'PDF…' : 'PDF'}
                  </button>
                </>
              ) : exportable ? (
                <button
                  type="button"
                  onClick={handleExport}
                  disabled={hasError || loading || filteredData.length === 0}
                  className="flex items-center gap-1.5 text-sm font-medium px-3 rounded-lg transition-colors disabled:opacity-40"
                  style={{ height: '36px', border: '1px solid var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text-secondary)' }}
                  aria-label="Export to CSV"
                  title="Export to CSV"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
                  </svg>
                  Export
                </button>
              ) : null}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="aurora-table" style={{ width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--aurora-bg-subtle)' }}>
              {columns.map(col => (
                <th key={col.key} className={`${thPad} text-left`} style={{ width: col.width, ...stickyThStyle }}>
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
            {hasError ? (
              <tr>
                <td colSpan={columns.length} className="p-0">
                  <ErrorState title={errorTitle} description={errorDescription} onRetry={onRetry} />
                </td>
              </tr>
            ) : loading ? (
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

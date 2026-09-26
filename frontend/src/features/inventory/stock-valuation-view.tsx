'use client';
import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { Btn, FormInput, FormSelect } from '@/components/ui';
import { WorkspaceTable } from '@/components/ui/workspace-table';
import { DocumentShell } from '@/components/documents/DocumentShell';
import { useDocumentLetterhead } from '@/hooks/use-document-letterhead';
import { reportReview, reportValue, type ReportRow } from './inventory-report-data';
import {
  DEFAULT_VALUATION,
  STOCK_LEVELS,
  VALUATION_COLUMNS,
  VALUATION_NOTE,
  VALUATION_PRESETS,
  valuationFilterLabel,
  valuationRows,
  valuationSummary,
  type ValuationOptions,
} from './stock-valuation-format';
import './stock-valuation.css';

export function StockValuationControls({
  rows,
  options,
  onChange,
}: {
  rows: ReportRow[];
  options: ValuationOptions;
  onChange: (next: ValuationOptions) => void;
}) {
  const set = (next: Partial<ValuationOptions>) => onChange({ ...options, ...next });
  const choices = (key: 'category' | 'branch' | 'stockStatus', selected: string) =>
    [
      ...new Set([
        ...rows.map((row) => String(row[key] ?? '')).filter(Boolean),
        ...(selected ? [selected] : []),
      ]),
    ]
      .sort()
      .map((value) => ({ value, label: reportValue(key, value) }));
  const preset =
    Object.entries(VALUATION_PRESETS).find(
      ([, columns]) => JSON.stringify(columns) === JSON.stringify(options.columns),
    )?.[0] || 'custom';
  return (
    <section className="valuation-controls report-no-print" aria-label="Stock valuation format">
      <header>
        <div>
          <h3>Report format</h3>
          <p>Choose your stock and columns. The preview, printout and exports use these choices.</p>
        </div>
        <Btn
          variant="ghost"
          onClick={() => onChange({ ...DEFAULT_VALUATION, columns: options.columns })}
        >
          Clear stock filters
        </Btn>
      </header>
      <div className="valuation-filters">
        <FormInput
          label="Find product"
          placeholder="Name, code or SKU"
          value={options.search}
          maxLength={256}
          onChange={(event) => set({ search: event.target.value })}
        />
        <FormSelect
          label="Category filter"
          value={options.category}
          options={[
            { value: '', label: 'All categories' },
            ...choices('category', options.category),
          ]}
          onChange={(event) => set({ category: event.target.value })}
        />
        <FormSelect
          label="Location filter"
          value={options.branch}
          options={[
            { value: '', label: 'All permitted locations' },
            ...choices('branch', options.branch),
          ]}
          onChange={(event) => set({ branch: event.target.value })}
        />
        <FormSelect
          label="Stock status"
          value={options.status}
          options={[
            { value: '', label: 'All statuses' },
            ...choices('stockStatus', options.status),
          ]}
          onChange={(event) => set({ status: event.target.value })}
        />
        <FormSelect
          label="Stock quantity"
          value={options.stock}
          options={[...STOCK_LEVELS]}
          onChange={(event) => set({ stock: event.target.value })}
        />
      </div>
      <div className="valuation-layout">
        <FormSelect
          label="Column layout"
          value={preset}
          options={[
            { value: 'standard', label: 'Standard' },
            { value: 'compact', label: 'Compact — no category' },
            { value: 'detailed', label: 'Detailed — all columns' },
            ...(preset === 'custom' ? [{ value: 'custom', label: 'Custom' }] : []),
          ]}
          onChange={(event) =>
            set({
              columns:
                VALUATION_PRESETS[event.target.value as keyof typeof VALUATION_PRESETS] ||
                options.columns,
            })
          }
        />
        <details className="valuation-column-picker">
          <summary>Columns · {options.columns.length} selected</summary>
          <p>Untick any column to remove it, or tick one to add it. Keep at least one selected.</p>
          <fieldset>
            <legend className="sr-only">Visible valuation columns</legend>
            {VALUATION_COLUMNS.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={options.columns.includes(column.key)}
                  disabled={options.columns.length === 1 && options.columns.includes(column.key)}
                  onChange={(event) =>
                    set({
                      columns: VALUATION_COLUMNS.filter((item) =>
                        item.key === column.key
                          ? event.target.checked
                          : options.columns.includes(item.key),
                      ).map((item) => item.key),
                    })
                  }
                />
                {column.label}
              </label>
            ))}
          </fieldset>
          <Btn variant="ghost" onClick={() => set({ columns: VALUATION_PRESETS.standard })}>
            Reset standard columns
          </Btn>
        </details>
      </div>
    </section>
  );
}

export function StockValuationView({
  rows,
  options,
  onChange,
  companyId,
  companyName,
  scopeLabel,
}: {
  rows: ReportRow[];
  options: ValuationOptions;
  onChange: (next: ValuationOptions) => void;
  companyId?: string;
  companyName?: string;
  scopeLabel?: string;
}) {
  const letterhead = useDocumentLetterhead(companyId, !!companyId);
  // Render every matching row only while printing, keeping large reports responsive on screen.
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  const filtered = useMemo(() => valuationRows(rows, options), [rows, options]);
  const selected = VALUATION_COLUMNS.filter((column) => options.columns.includes(column.key));
  const [paging, setPaging] = useState({ key: '', page: 1 });
  const key = JSON.stringify(options);
  const pages = Math.max(1, Math.ceil(filtered.length / 20));
  const page = paging.key === key ? Math.min(paging.page, pages) : 1;
  const review = filtered.some((row) => reportReview(row) !== '—');
  const table = (items: ReportRow[]) => (
    <WorkspaceTable label="Stock valuation preview" mobile="scroll">
      <thead>
        <tr>
          {selected.map((column) => (
            <th key={column.key} className={'numeric' in column ? 'valuation-number' : ''}>
              {column.label}
            </th>
          ))}
          {review && <th>Review note</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((row, index) => (
          <tr key={index}>
            {selected.map((column) => (
              <td key={column.key} className={'numeric' in column ? 'valuation-number' : ''}>
                {reportValue(column.key, row[column.key])}
              </td>
            ))}
            {review && <td>{reportReview(row)}</td>}
          </tr>
        ))}
        {!items.length && (
          <tr>
            <td colSpan={selected.length + Number(review)}>No stock matches these filters.</td>
          </tr>
        )}
      </tbody>
    </WorkspaceTable>
  );
  return (
    <div className="stock-valuation-view">
      <StockValuationControls rows={rows} options={options} onChange={onChange} />
      <div className="valuation-summary">
        <div>
          <span>Stock positions</span>
          <strong>
            {filtered.length.toLocaleString()} <small>of {rows.length.toLocaleString()}</small>
          </strong>
        </div>
        {valuationSummary(filtered, options).map((item) => (
          <div key={item.label}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </div>
        ))}
      </div>
      <p className="valuation-note">
        {valuationFilterLabel(options)}. {VALUATION_NOTE}
      </p>
      <div className="valuation-screen-table">
        {table(filtered.slice((page - 1) * 20, page * 20))}
      </div>
      {printing && (
        <div className="valuation-print-table">
          <DocumentShell
            title="Stock valuation"
            subtitle={scopeLabel}
            organization={{ ...letterhead, name: companyName || letterhead.groupName }}
            meta={[
              { label: 'Filters', value: valuationFilterLabel(options) },
              { label: 'Stock positions', value: String(filtered.length) },
              ...valuationSummary(filtered, options),
            ]}
            footerNote={VALUATION_NOTE}
          >
            {table(filtered)}
          </DocumentShell>
        </div>
      )}
      <nav className="valuation-pagination report-no-print" aria-label="Stock valuation pages">
        <Btn
          variant="secondary"
          disabled={page === 1}
          onClick={() => setPaging({ key, page: page - 1 })}
        >
          Previous
        </Btn>
        <span>
          Page {page} of {pages} · {filtered.length} matching positions
        </span>
        <Btn
          variant="secondary"
          disabled={page === pages}
          onClick={() => setPaging({ key, page: page + 1 })}
        >
          Next
        </Btn>
      </nav>
    </div>
  );
}

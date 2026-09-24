'use client';

import { useMemo, useState } from 'react';
import { Btn, FormInput, FormSelect, Modal } from '@/components/ui';
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import { downloadBinaryExport, downloadTablePdf, TABLE_PDF_MAX_ROWS } from '@/lib/export-download';
import { downloadTextFile, toCsv } from '@/lib/report-export';
import {
  DEFAULT_STOCK_EXPORT,
  STANDARD_STOCK_COLUMNS,
  STOCK_EXPORT_COLUMNS,
  STOCK_SORTS,
  STOCK_STATUSES,
  buildStockTable,
  describeStockExport,
  filterStockRows,
  invalidNumber,
  sortStockRows,
  stockValueTotal,
  type ExportStockRow,
  type StockExportFormat,
  type StockExportOptions,
} from './stock-export';

/** Per-viewer convenience: the last choices come back next time. */
const STORAGE_KEY = 'itemba.inventory.stock-export.v1';

function loadOptions(): StockExportOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
    if (!saved || typeof saved !== 'object') return DEFAULT_STOCK_EXPORT;
    const known = new Set(STOCK_EXPORT_COLUMNS.map((c) => c.key));
    const columns = Array.isArray(saved.columns)
      ? saved.columns.filter((c: unknown) => known.has(c as never))
      : [];
    // Locations and categories belong to one company's stock; start those fresh.
    return {
      ...DEFAULT_STOCK_EXPORT,
      statuses: Array.isArray(saved.statuses) ? saved.statuses : [],
      availableOnly: saved.availableOnly === true,
      minAvailable: typeof saved.minAvailable === 'string' ? saved.minAvailable : '',
      unmovedDays: typeof saved.unmovedDays === 'string' ? saved.unmovedDays : '',
      columns: columns.length ? columns : STANDARD_STOCK_COLUMNS,
      sort: STOCK_SORTS.some((s) => s.key === saved.sort) ? saved.sort : 'product',
      format: ['xlsx', 'pdf', 'csv'].includes(saved.format) ? saved.format : 'xlsx',
    };
  } catch {
    return DEFAULT_STOCK_EXPORT;
  }
}

function saveOptions(options: StockExportOptions) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options));
  } catch {
    // Safe to ignore: private windows and blocked storage just forget the
    // choices; the export itself does not depend on them.
    return;
  }
}

const FORMATS: { key: StockExportFormat; label: string; hint: string }[] = [
  { key: 'xlsx', label: 'Excel', hint: 'Spreadsheet (.xlsx)' },
  { key: 'pdf', label: 'PDF', hint: 'Printable, with your letterhead' },
  { key: 'csv', label: 'CSV', hint: 'For other systems' },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function StockExportDialog({
  open,
  onClose,
  rows,
  companyId,
  search,
  loadedAt,
}: {
  open: boolean;
  onClose: () => void;
  /** Every stock position the live view loaded for the current scope and search. */
  rows: ExportStockRow[];
  companyId?: string;
  search: string;
  loadedAt: number | null;
}) {
  const [options, setOptions] = useState<StockExportOptions>(loadOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (changes: Partial<StockExportOptions>) => {
    setError('');
    setOptions((current) => ({ ...current, ...changes }));
  };

  const locations = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => map.set(r.locationId, r.locationName));
    return map;
  }, [rows]);
  const categories = useMemo(() => {
    const map = new Map<string, string>();
    rows.forEach((r) => map.set(r.product.category?.id ?? '', r.product.category?.name ?? ''));
    return new Map([...map].sort((a, b) => a[1].localeCompare(b[1])));
  }, [rows]);
  // Drop picks that are not in this company's stock (e.g. after a scope change).
  const locationIds = options.locationIds.filter((id) => locations.has(id));
  const categoryIds = options.categoryIds.filter((id) => categories.has(id));
  const effective = { ...options, locationIds, categoryIds };

  const badMin = invalidNumber(options.minAvailable);
  const badDays = invalidNumber(options.unmovedDays);
  const chosen =
    badMin || badDays ? [] : sortStockRows(filterStockRows(rows, effective), options.sort);
  const noColumns = options.columns.length === 0;
  const tooManyForDocument = options.format !== 'csv' && chosen.length > TABLE_PDF_MAX_ROWS;
  const blocked =
    busy || badMin || badDays || noColumns || chosen.length === 0 || tooManyForDocument;

  async function runExport() {
    if (blocked) return;
    setBusy(true);
    setError('');
    saveOptions(options);
    const table = buildStockTable(chosen, options.columns);
    const stamp = new Date().toISOString().slice(0, 10);
    const baseName = `stock-available-${stamp}`;
    const filters = describeStockExport(effective, { locations, categories }, search);
    try {
      if (options.format === 'csv') {
        downloadTextFile(
          `${baseName}.csv`,
          'text/csv;charset=utf-8',
          toCsv(table.columns, table.rows),
        );
      } else {
        const request = {
          title: 'Stock available',
          subtitle: filters,
          companyId: companyId || undefined,
          orientation: table.columns.length > 7 ? ('landscape' as const) : ('portrait' as const),
          columns: table.columns,
          rows: table.rows,
          numericColumns: table.numericColumns,
          columnWeights: table.columnWeights,
          stripedRows: true,
          meta: [
            {
              label: 'Stock as of',
              value: loadedAt ? new Date(loadedAt).toLocaleString('en-GB') : 'Not refreshed',
            },
            { label: 'Stock positions', value: chosen.length.toLocaleString('en-GB') },
          ],
          summary: [{ label: 'Stock value', value: catalogueMoney(stockValueTotal(chosen)) }],
          note: 'Quantities are in each product’s own unit and are not added across products.',
          baseName: 'stock-available',
        };
        if (options.format === 'pdf') await downloadTablePdf(request);
        else
          await downloadBinaryExport(
            '/generated-documents/table-export',
            { ...request, format: 'xlsx' },
            `${baseName}.xlsx`,
          );
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Export stock available"
      subtitle="Choose what goes in, then export."
      size="2xl"
      footer={
        <div className="stock-export-footer">
          <p aria-live="polite">
            {badMin || badDays
              ? 'Fix the highlighted number to see what will be exported.'
              : `${chosen.length.toLocaleString('en-GB')} of ${rows.length.toLocaleString('en-GB')} stock positions · ${catalogueMoney(stockValueTotal(chosen))}`}
          </p>
          <Btn variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Btn>
          <Btn onClick={runExport} disabled={blocked}>
            {busy ? 'Exporting…' : `Export ${FORMATS.find((f) => f.key === options.format)?.label}`}
          </Btn>
        </div>
      }
    >
      <div className="stock-export">
        <section aria-labelledby="stock-export-rows">
          <h3 id="stock-export-rows">Stock to include</h3>
          <fieldset>
            <legend>Status</legend>
            <div className="stock-export-chips">
              {STOCK_STATUSES.map((status) => (
                <label key={status.key}>
                  <input
                    type="checkbox"
                    checked={options.statuses.includes(status.key)}
                    onChange={() => set({ statuses: toggle(options.statuses, status.key) })}
                  />
                  {status.label}
                </label>
              ))}
            </div>
            <p className="stock-export-hint">None ticked means every status.</p>
          </fieldset>
          {locations.size > 0 && (
            <fieldset>
              <legend>Locations</legend>
              <div className="stock-export-chips">
                {[...locations].map(([id, name]) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={locationIds.includes(id)}
                      onChange={() => set({ locationIds: toggle(locationIds, id) })}
                    />
                    {name}
                  </label>
                ))}
              </div>
              <p className="stock-export-hint">None ticked means every location.</p>
            </fieldset>
          )}
          {categories.size > 0 && (
            <fieldset>
              <legend>Categories</legend>
              <div className="stock-export-chips">
                {[...categories].map(([id, name]) => (
                  <label key={id || 'none'}>
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(id)}
                      onChange={() => set({ categoryIds: toggle(categoryIds, id) })}
                    />
                    {name || 'No category'}
                  </label>
                ))}
              </div>
              <p className="stock-export-hint">None ticked means every category.</p>
            </fieldset>
          )}
          <div className="stock-export-grid">
            <label className="stock-export-check">
              <input
                type="checkbox"
                checked={options.availableOnly}
                onChange={(e) => set({ availableOnly: e.target.checked })}
              />
              Only stock that is available (above zero)
            </label>
            <FormInput
              label="Available at least"
              type="number"
              min="0"
              step="any"
              value={options.minAvailable}
              onChange={(e) => set({ minAvailable: e.target.value })}
              error={badMin ? 'Enter zero or more, or leave it empty.' : undefined}
              placeholder="No minimum"
            />
            <FormInput
              label="No movement for at least (days)"
              type="number"
              min="0"
              step="1"
              value={options.unmovedDays}
              onChange={(e) => set({ unmovedDays: e.target.value })}
              error={badDays ? 'Enter zero or more, or leave it empty.' : undefined}
              placeholder="Any"
            />
          </div>
          {search.trim() && (
            <p className="stock-export-hint">
              The search in the view applies too: “{search.trim()}”.
            </p>
          )}
        </section>

        <section aria-labelledby="stock-export-columns">
          <div className="stock-export-heading">
            <h3 id="stock-export-columns">Columns</h3>
            <Btn variant="ghost" size="sm" onClick={() => set({ columns: STANDARD_STOCK_COLUMNS })}>
              Standard
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => set({ columns: STOCK_EXPORT_COLUMNS.map((c) => c.key) })}
            >
              All
            </Btn>
          </div>
          <div className="stock-export-chips">
            {STOCK_EXPORT_COLUMNS.map((column) => (
              <label key={column.key}>
                <input
                  type="checkbox"
                  checked={options.columns.includes(column.key)}
                  onChange={() => set({ columns: toggle(options.columns, column.key) })}
                />
                {column.label}
              </label>
            ))}
          </div>
          {noColumns && (
            <p className="stock-export-error" role="alert">
              Choose at least one column.
            </p>
          )}
        </section>

        <section aria-labelledby="stock-export-output" className="stock-export-output">
          <h3 id="stock-export-output">Order and format</h3>
          <FormSelect
            label="Sort by"
            value={options.sort}
            onChange={(e) => set({ sort: e.target.value as StockExportOptions['sort'] })}
          >
            {STOCK_SORTS.map((sort) => (
              <option key={sort.key} value={sort.key}>
                {sort.label}
              </option>
            ))}
          </FormSelect>
          <fieldset>
            <legend>Format</legend>
            <div className="stock-export-formats">
              {FORMATS.map((format) => (
                <label key={format.key}>
                  <input
                    type="radio"
                    name="stock-export-format"
                    checked={options.format === format.key}
                    onChange={() => set({ format: format.key })}
                  />
                  <strong>{format.label}</strong>
                  <span>{format.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        {tooManyForDocument && (
          <p className="stock-export-error" role="alert">
            Excel and PDF take up to {TABLE_PDF_MAX_ROWS.toLocaleString('en-GB')} stock positions.
            Narrow the choices above, or use CSV for all of them.
          </p>
        )}
        {!badMin && !badDays && chosen.length === 0 && (
          <p className="stock-export-error" role="alert">
            Nothing matches these choices.
          </p>
        )}
        {error && (
          <p className="stock-export-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

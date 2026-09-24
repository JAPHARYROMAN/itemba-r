/**
 * "Choose what goes in, then export" for the live stock view: which stock
 * positions (location, category, status, stock level, movement), which
 * columns, in what order, and in which format. Pure functions over the rows
 * the view already loaded, so the export is exactly what the view knows.
 */
import { catalogueMoney } from '@/components/workspace/catalogue-types';
import type { LiveStockItem } from './inventory-live';

export type ExportStockRow = LiveStockItem & {
  locationId: string;
  locationName: string;
  locationCode: string;
};

export type StockStatusKey = 'in' | 'low' | 'out' | 'overReserved' | 'negative';
export const STOCK_STATUSES: { key: StockStatusKey; label: string }[] = [
  { key: 'in', label: 'In stock' },
  { key: 'low', label: 'Low stock' },
  { key: 'out', label: 'Out of stock' },
  { key: 'overReserved', label: 'Over-reserved' },
  { key: 'negative', label: 'Negative on hand' },
];

export type StockColumnKey =
  | 'product'
  | 'code'
  | 'sku'
  | 'barcode'
  | 'category'
  | 'unit'
  | 'location'
  | 'onHand'
  | 'reserved'
  | 'available'
  | 'averageCost'
  | 'stockValue'
  | 'status'
  | 'lowThreshold'
  | 'lastMovement'
  | 'daysSinceMovement';

export type StockSort = 'product' | 'location' | 'category' | 'available' | 'value' | 'risk';
export type StockExportFormat = 'xlsx' | 'pdf' | 'csv';

export interface StockExportOptions {
  /** Empty means every location. */
  locationIds: string[];
  /** Empty means every category; '' inside means "no category". */
  categoryIds: string[];
  /** Empty means every status. */
  statuses: StockStatusKey[];
  /** Only positions with something available to sell or issue. */
  availableOnly: boolean;
  /** Only positions with at least this much available ('' = no minimum). */
  minAvailable: string;
  /** Only positions with no movement for at least this many days ('' = any). */
  unmovedDays: string;
  columns: StockColumnKey[];
  sort: StockSort;
  format: StockExportFormat;
}

const num = (value: unknown): number | null =>
  value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const qty = (value: unknown): string => {
  const n = num(value);
  return n == null ? '' : n.toLocaleString('en-GB', { maximumFractionDigits: 4 });
};
const money = (value: unknown): string => {
  const n = num(value);
  return n == null ? '' : catalogueMoney(n);
};

export function stockStatusKey(row: LiveStockItem): StockStatusKey {
  if ((num(row.quantityOnHand) ?? 0) < 0) return 'negative';
  if ((num(row.quantityAvailable) ?? 0) < 0) return 'overReserved';
  if (row.status === 'OUT') return 'out';
  if (row.status === 'LOW') return 'low';
  return 'in';
}
const statusLabel = (row: LiveStockItem) =>
  STOCK_STATUSES.find((s) => s.key === stockStatusKey(row))?.label ?? '';

const date = (value?: string | null) =>
  value && Number.isFinite(Date.parse(value))
    ? new Date(value).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : 'No movement recorded';

export interface StockColumn {
  key: StockColumnKey;
  label: string;
  numeric?: boolean;
  /** Relative width in the PDF. */
  weight: number;
  /** Chosen by default. */
  standard?: boolean;
  value: (row: ExportStockRow) => string;
}

export const STOCK_EXPORT_COLUMNS: StockColumn[] = [
  { key: 'product', label: 'Product', weight: 3, standard: true, value: (r) => r.product.name },
  {
    key: 'code',
    label: 'Code',
    weight: 1.4,
    standard: true,
    value: (r) => r.product.productCode ?? '',
  },
  { key: 'sku', label: 'SKU', weight: 1.4, value: (r) => r.product.sku ?? '' },
  { key: 'barcode', label: 'Barcode', weight: 1.6, value: (r) => r.product.barcode ?? '' },
  {
    key: 'category',
    label: 'Category',
    weight: 1.6,
    standard: true,
    value: (r) => r.product.category?.name ?? '',
  },
  {
    key: 'unit',
    label: 'Unit',
    weight: 0.9,
    standard: true,
    value: (r) => r.product.baseUnit?.symbol || r.product.baseUnit?.name || '',
  },
  { key: 'location', label: 'Location', weight: 1.8, standard: true, value: (r) => r.locationName },
  {
    key: 'onHand',
    label: 'On hand',
    numeric: true,
    weight: 1.1,
    value: (r) => qty(r.quantityOnHand),
  },
  {
    key: 'reserved',
    label: 'Reserved',
    numeric: true,
    weight: 1.1,
    value: (r) => qty(r.quantityReserved),
  },
  {
    key: 'available',
    label: 'Available',
    numeric: true,
    weight: 1.1,
    standard: true,
    value: (r) => qty(r.quantityAvailable),
  },
  {
    key: 'averageCost',
    label: 'Average cost',
    numeric: true,
    weight: 1.4,
    value: (r) => money(r.averageCost),
  },
  {
    key: 'stockValue',
    label: 'Stock value',
    numeric: true,
    weight: 1.6,
    standard: true,
    value: (r) => money(r.totalValue),
  },
  { key: 'status', label: 'Status', weight: 1.3, standard: true, value: statusLabel },
  {
    key: 'lowThreshold',
    label: 'Low threshold',
    numeric: true,
    weight: 1.1,
    value: (r) => qty(r.lowThreshold),
  },
  {
    key: 'lastMovement',
    label: 'Last movement',
    weight: 1.4,
    value: (r) => date(r.lastMovementAt),
  },
  {
    key: 'daysSinceMovement',
    label: 'Days since movement',
    numeric: true,
    weight: 1.1,
    value: (r) => (r.daysSinceMovement == null ? '' : String(r.daysSinceMovement)),
  },
];

export const STANDARD_STOCK_COLUMNS = STOCK_EXPORT_COLUMNS.filter((c) => c.standard).map(
  (c) => c.key,
);

export const DEFAULT_STOCK_EXPORT: StockExportOptions = {
  locationIds: [],
  categoryIds: [],
  statuses: [],
  availableOnly: false,
  minAvailable: '',
  unmovedDays: '',
  columns: STANDARD_STOCK_COLUMNS,
  sort: 'product',
  format: 'xlsx',
};

export const STOCK_SORTS: { key: StockSort; label: string }[] = [
  { key: 'product', label: 'Product name' },
  { key: 'location', label: 'Location, then product' },
  { key: 'category', label: 'Category, then product' },
  { key: 'available', label: 'Available, lowest first' },
  { key: 'value', label: 'Stock value, highest first' },
  { key: 'risk', label: 'Needs attention first' },
];

/** A '' minimum/days means "no limit"; anything else must be a non-negative number. */
export function invalidNumber(value: string): boolean {
  return value.trim() !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0);
}

export function filterStockRows(
  rows: ExportStockRow[],
  options: StockExportOptions,
): ExportStockRow[] {
  const minAvailable = options.minAvailable.trim() === '' ? null : Number(options.minAvailable);
  const unmovedDays = options.unmovedDays.trim() === '' ? null : Number(options.unmovedDays);
  return rows.filter((row) => {
    const available = num(row.quantityAvailable) ?? 0;
    if (options.locationIds.length && !options.locationIds.includes(row.locationId)) return false;
    if (options.categoryIds.length && !options.categoryIds.includes(row.product.category?.id ?? ''))
      return false;
    if (options.statuses.length && !options.statuses.includes(stockStatusKey(row))) return false;
    if (options.availableOnly && available <= 0) return false;
    if (minAvailable != null && Number.isFinite(minAvailable) && available < minAvailable)
      return false;
    if (unmovedDays != null && Number.isFinite(unmovedDays)) {
      // Never moved counts as "not moved for at least N days".
      if (row.daysSinceMovement != null && row.daysSinceMovement < unmovedDays) return false;
    }
    return true;
  });
}

export function sortStockRows(rows: ExportStockRow[], sort: StockSort): ExportStockRow[] {
  const byName = (a: ExportStockRow, b: ExportStockRow) =>
    a.product.name.localeCompare(b.product.name);
  const compare: Record<StockSort, (a: ExportStockRow, b: ExportStockRow) => number> = {
    product: byName,
    location: (a, b) => a.locationName.localeCompare(b.locationName) || byName(a, b),
    category: (a, b) =>
      (a.product.category?.name ?? '').localeCompare(b.product.category?.name ?? '') ||
      byName(a, b),
    available: (a, b) =>
      (num(a.quantityAvailable) ?? 0) - (num(b.quantityAvailable) ?? 0) || byName(a, b),
    value: (a, b) => (num(b.totalValue) ?? 0) - (num(a.totalValue) ?? 0) || byName(a, b),
    risk: (a, b) => (b.riskScore ?? 0) - (a.riskScore ?? 0) || byName(a, b),
  };
  return [...rows].sort(compare[sort]);
}

export interface StockTable {
  columns: string[];
  rows: string[][];
  numericColumns: number[];
  columnWeights: number[];
}

/** The chosen columns in their canonical order, as strings ready for any format. */
export function buildStockTable(rows: ExportStockRow[], columnKeys: StockColumnKey[]): StockTable {
  const columns = STOCK_EXPORT_COLUMNS.filter((c) => columnKeys.includes(c.key));
  return {
    columns: columns.map((c) => c.label),
    rows: rows.map((row) => columns.map((c) => c.value(row))),
    numericColumns: columns.flatMap((c, i) => (c.numeric ? [i] : [])),
    columnWeights: columns.map((c) => c.weight),
  };
}

export function stockValueTotal(rows: ExportStockRow[]): number {
  return rows.reduce((sum, row) => sum + (num(row.totalValue) ?? 0), 0);
}

/** One line naming the filters, for the export heading ("All stock" when none). */
export function describeStockExport(
  options: StockExportOptions,
  names: { locations: Map<string, string>; categories: Map<string, string> },
  search: string,
): string {
  const list = (ids: string[], lookup: Map<string, string>, none: string) =>
    ids.map((id) => lookup.get(id) ?? (id === '' ? none : id)).join(', ');
  const parts = [
    options.locationIds.length && `Locations: ${list(options.locationIds, names.locations, '—')}`,
    options.categoryIds.length &&
      `Categories: ${list(options.categoryIds, names.categories, 'No category')}`,
    options.statuses.length &&
      `Status: ${options.statuses
        .map((key) => STOCK_STATUSES.find((s) => s.key === key)?.label)
        .join(', ')}`,
    options.availableOnly && 'Available stock only',
    options.minAvailable.trim() && `Available at least ${options.minAvailable.trim()}`,
    options.unmovedDays.trim() && `No movement for ${options.unmovedDays.trim()}+ days`,
    search.trim() && `Search: "${search.trim()}"`,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'All stock positions';
}

import { cellToString } from '@/lib/report-export';
import { reportReview, reportValue, type ReportRow } from './inventory-report-data';

export const VALUATION_COLUMNS = [
  { key: 'productCode', label: 'Product code', weight: 1.4 },
  { key: 'sku', label: 'SKU', weight: 1.3 },
  { key: 'product', label: 'Product', weight: 2.8 },
  { key: 'category', label: 'Category', weight: 1.6 },
  { key: 'branch', label: 'Branch / location', weight: 1.8 },
  { key: 'quantityOnHand', label: 'On hand', weight: 1.1, numeric: true },
  { key: 'quantityReserved', label: 'Reserved', weight: 1.1, numeric: true },
  { key: 'availableQuantity', label: 'Available', weight: 1.1, numeric: true },
  { key: 'unit', label: 'Unit', weight: 0.8 },
  { key: 'averageCost', label: 'Average cost (TZS)', weight: 1.5, numeric: true },
  { key: 'totalValue', label: 'Stock value (TZS)', weight: 1.6, numeric: true },
  { key: 'reorderLevel', label: 'Reorder level', weight: 1.1, numeric: true },
  { key: 'minimumStockLevel', label: 'Minimum stock', weight: 1.1, numeric: true },
  { key: 'maximumStockLevel', label: 'Maximum stock', weight: 1.1, numeric: true },
  { key: 'stockStatus', label: 'Stock status', weight: 1.3 },
  { key: 'lastMovementAt', label: 'Last movement', weight: 1.8 },
] as const;
export type ValuationColumn = (typeof VALUATION_COLUMNS)[number]['key'];
export const VALUATION_PRESETS: Record<'standard' | 'compact' | 'detailed', ValuationColumn[]> = {
  standard: [
    'productCode',
    'product',
    'category',
    'branch',
    'quantityOnHand',
    'unit',
    'averageCost',
    'totalValue',
    'stockStatus',
  ],
  compact: [
    'productCode',
    'product',
    'branch',
    'quantityOnHand',
    'unit',
    'averageCost',
    'totalValue',
  ],
  detailed: VALUATION_COLUMNS.map((column) => column.key),
};
export const STOCK_LEVELS = [
  { value: '', label: 'Any quantity' },
  { value: 'positive', label: 'Positive on hand' },
  { value: 'zero', label: 'Zero on hand' },
  { value: 'negative', label: 'Negative on hand' },
  { value: 'available', label: 'Available to sell / issue' },
] as const;
export type ValuationOptions = {
  version: 1;
  columns: ValuationColumn[];
  search: string;
  category: string;
  branch: string;
  status: string;
  stock: string;
};
export const DEFAULT_VALUATION: ValuationOptions = {
  version: 1,
  columns: VALUATION_PRESETS.standard,
  search: '',
  category: '',
  branch: '',
  status: '',
  stock: '',
};

/** Saved views may predate this format; accept only supported fields and columns. */
export function normalizeValuationOptions(input: unknown): ValuationOptions {
  const value = input && typeof input === 'object' ? (input as Partial<ValuationOptions>) : {};
  const columns = VALUATION_COLUMNS.filter(
    (column) => Array.isArray(value.columns) && value.columns.includes(column.key),
  ).map((column) => column.key);
  const text = (key: 'search' | 'category' | 'branch' | 'status') =>
    typeof value[key] === 'string' ? value[key].slice(0, 256) : '';
  return {
    version: 1,
    columns: columns.length ? columns : VALUATION_PRESETS.standard,
    search: text('search'),
    category: text('category'),
    branch: text('branch'),
    status: text('status'),
    stock: STOCK_LEVELS.some((level) => level.value === value.stock) ? value.stock! : '',
  };
}
const number = (value: unknown): number | null =>
  value == null || value === '' || typeof value === 'boolean' || !Number.isFinite(Number(value))
    ? null
    : Number(value);

export function valuationRows(rows: ReportRow[], options: ValuationOptions) {
  const words = options.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return rows.filter((row) => {
    const search = [row.productCode, row.product, row.sku].join(' ').toLocaleLowerCase();
    if (!words.every((word) => search.includes(word))) return false;
    if (options.category && String(row.category ?? '') !== options.category) return false;
    if (options.branch && String(row.branch ?? '') !== options.branch) return false;
    if (options.status && String(row.stockStatus ?? '') !== options.status) return false;
    const quantity = number(row.quantityOnHand);
    if (options.stock === 'positive' && (quantity == null || quantity <= 0)) return false;
    if (options.stock === 'zero' && quantity !== 0) return false;
    if (options.stock === 'negative' && (quantity == null || quantity >= 0)) return false;
    if (options.stock === 'available' && (number(row.availableQuantity) ?? 0) <= 0) return false;
    return true;
  });
}

export function valuationFilterLabel(options: ValuationOptions) {
  return (
    [
      options.search && `Product: ${options.search}`,
      options.category && `Category: ${options.category}`,
      options.branch && `Location: ${options.branch}`,
      options.status && `Status: ${reportValue('stockStatus', options.status)}`,
      options.stock && STOCK_LEVELS.find((level) => level.value === options.stock)?.label,
    ]
      .filter(Boolean)
      .join(' · ') || 'All stock in the selected scope'
  );
}

/** One projection for the preview, every file format, and the export audit. */
export function valuationTable(rows: ReportRow[], options: ValuationOptions) {
  const selected = VALUATION_COLUMNS.filter((column) => options.columns.includes(column.key));
  const review = rows.some((row) => reportReview(row) !== '—');
  return {
    columns: [...selected.map((column) => column.label), ...(review ? ['Review note'] : [])],
    rows: rows.map((row) => [
      ...selected.map((column) => cellToString(row[column.key])),
      ...(review ? [reportReview(row)] : []),
    ]),
    numericColumns: selected.flatMap((column, index) => ('numeric' in column ? [index] : [])),
    columnWeights: [...selected.map((column) => column.weight), ...(review ? [2] : [])],
  };
}
export function valuationSummary(rows: ReportRow[], options: ValuationOptions) {
  if (!options.columns.includes('totalValue')) return [];
  const values = rows.map((row) => number(row.totalValue));
  const missing = values.filter((value) => value === null).length;
  return [
    {
      label: missing ? 'Known stock value (TZS)' : 'Total stock value (TZS)',
      value: reportValue(
        'totalValue',
        values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      ),
    },
    ...(missing ? [{ label: 'Unvalued positions', value: String(missing) }] : []),
  ];
}
export const VALUATION_NOTE =
  'Current stock balances at retrieval time; not a historical valuation. Quantities use each product’s own unit and are not added across products.';

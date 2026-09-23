export type ReportDefinition = {
  key: string;
  title: string;
  description: string;
  endpoint: string;
  source: 'operations' | 'westsides';
  columns: string[];
};

export const INVENTORY_REPORTS: ReportDefinition[] = [
  {
    key: 'stock-valuation',
    title: 'Stock valuation',
    description: 'Stock on hand, availability, average cost, and total stock value.',
    endpoint: '/operations-reports/stock-valuation',
    source: 'operations',
    columns: [
      'productCode',
      'product',
      'category',
      'branch',
      'quantityOnHand',
      'availableQuantity',
      'averageCost',
      'totalValue',
      'stockStatus',
    ],
  },
  {
    key: 'low-stock',
    title: 'Low stock',
    description: 'Products at or below their reorder or minimum stock level.',
    endpoint: '/operations-reports/low-stock',
    source: 'operations',
    columns: [
      'productCode',
      'product',
      'category',
      'branch',
      'quantityOnHand',
      'availableQuantity',
      'reorderLevel',
      'shortageQuantity',
      'totalValue',
    ],
  },
  {
    key: 'stock-ageing',
    title: 'Stock ageing',
    description: 'Slow-moving stock and value exposure by product and branch.',
    endpoint: '/operations-reports/stock-ageing',
    source: 'operations',
    columns: [
      'productCode',
      'product',
      'category',
      'branch',
      'quantityOnHand',
      'totalValue',
      'daysSinceLastMovement',
    ],
  },
  {
    key: 'inventory-movements',
    title: 'Inventory movements',
    description: 'Stock receipts, issues, transfers, adjustments, costs, and references.',
    endpoint: '/operations-reports/inventory-movements',
    source: 'operations',
    columns: [
      'movementNumber',
      'movementDate',
      'movementType',
      'branch',
      'productCode',
      'product',
      'quantity',
      'unit',
      'unitCost',
      'totalCost',
      'referenceType',
    ],
  },
  {
    key: 'stock-adjustments',
    title: 'Stock adjustments',
    description: 'Count evidence showing system, counted, and variance quantities.',
    endpoint: '/operations-reports/stock-adjustments',
    source: 'operations',
    columns: [
      'adjustmentNumber',
      'date',
      'branch',
      'status',
      'productCode',
      'product',
      'systemQuantity',
      'countedQuantity',
      'varianceQuantity',
      'unit',
    ],
  },
  {
    key: 'batch-status',
    title: 'Batch status',
    description: 'Batch quantity, cost, expiry exposure, and current status.',
    endpoint: '/westsides/reports/batch-status',
    source: 'westsides',
    columns: [
      'batchNumber',
      'productName',
      'sku',
      'remainingQuantity',
      'unitCost',
      'expiryDate',
      'status',
    ],
  },
  {
    key: 'stock-damage',
    title: 'Stock damage',
    description:
      'Damage by product, unit, type and status. Estimates are separate from posted inventory value.',
    endpoint: '/westsides/reports/stock-damage-report',
    source: 'westsides',
    columns: [
      'productCode',
      'product',
      'unit',
      'damageType',
      'status',
      'reportCount',
      'quantity',
      'estimatedValue',
    ],
  },
];

export type ReportRow = Record<string, unknown>;
export type ReportResult = {
  rows: ReportRow[];
  total: number;
  generatedAt?: string;
  notice?: string;
};
export const reportIsPaged = (key: string) =>
  key === 'inventory-movements' || key === 'stock-adjustments';
export function normalizeInventoryReport(payload: unknown): ReportResult {
  const validRows = (rows: unknown[]): rows is ReportRow[] =>
    rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row));
  if (Array.isArray(payload)) {
    if (!validRows(payload)) throw new Error('The report returned invalid rows.');
    return { rows: payload, total: payload.length };
  }
  if (!payload || typeof payload !== 'object')
    throw new Error('The report returned an invalid response.');
  const data = payload as Record<string, unknown>;
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.items) ? data.items : null;
  if (
    !rows ||
    typeof data.total !== 'number' ||
    !Number.isInteger(data.total) ||
    data.total < 0 ||
    !validRows(rows) ||
    rows.length > data.total
  )
    throw new Error('The report returned an invalid row count.');
  return {
    rows,
    total: data.total,
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : undefined,
    notice: typeof data.notice === 'string' ? data.notice : undefined,
  };
}
export function reportHeading(key: string) {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .trim()
    .replace(/\b\w/g, (s) => s.toUpperCase());
}
export function reportColumns(rows: ReportRow[], report: ReportDefinition) {
  const keys = new Set(
    rows.flatMap((row) =>
      Object.keys(row).filter((key) => key !== 'id' && !key.endsWith('Id') && !key.startsWith('_')),
    ),
  );
  return [
    ...report.columns.filter((key) => keys.has(key)),
    ...[...keys].filter((key) => !report.columns.includes(key)),
  ];
}
export function reportValue(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  if (typeof value === 'number')
    return Number.isFinite(value)
      ? new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 4 }).format(value)
      : '—';
  if (/(date|At)$/i.test(key) && /^\d{4}-\d{2}-\d{2}/.test(String(value))) {
    const date = new Date(String(value));
    if (!Number.isNaN(date.getTime()))
      return date.toLocaleString('en-GB', { timeZone: 'UTC' }) + ' UTC';
  }
  return /(status|type)$/i.test(key) ? String(value).replace(/_/g, ' ') : String(value);
}
export function reportReview(row: ReportRow): string {
  const meta = row._reportMeta as { readiness?: { message?: string } } | undefined;
  return meta?.readiness?.message || '—';
}
export function reportName(row: ReportRow): string {
  return String(
    row.movementNumber ||
      row.adjustmentNumber ||
      row.batchNumber ||
      row.product ||
      row.productName ||
      row.productCode ||
      row.damageType ||
      'Report row',
  );
}
export function reportMeasures(key: string): [string, string] {
  if (key === 'inventory-movements') return ['quantity', 'totalCost'];
  if (key === 'stock-adjustments') return ['countedQuantity', 'varianceQuantity'];
  if (key === 'stock-damage') return ['quantity', 'estimatedValue'];
  if (key === 'batch-status') return ['remainingQuantity', 'expiryDate'];
  if (key === 'low-stock') return ['availableQuantity', 'shortageQuantity'];
  if (key === 'stock-ageing') return ['quantityOnHand', 'daysSinceLastMovement'];
  return ['quantityOnHand', 'totalValue'];
}

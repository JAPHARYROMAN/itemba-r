import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_STOCK_EXPORT,
  buildStockTable,
  describeStockExport,
  filterStockRows,
  sortStockRows,
  stockStatusKey,
  type ExportStockRow,
} from './stock-export';

const h = vi.hoisted(() => ({
  downloadBinaryExport: vi.fn(async () => undefined),
  downloadTablePdf: vi.fn(async () => undefined),
  downloadTextFile: vi.fn(),
}));
vi.mock('@/lib/export-download', () => ({
  TABLE_PDF_MAX_ROWS: 5000,
  downloadBinaryExport: h.downloadBinaryExport,
  downloadTablePdf: h.downloadTablePdf,
}));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: h.downloadTextFile,
}));

import { StockExportDialog } from './stock-export-dialog';

function row(over: Partial<ExportStockRow> & { name: string; category?: string }): ExportStockRow {
  return {
    id: over.name,
    productId: over.name,
    product: {
      id: over.name,
      name: over.name,
      productCode: over.name.toUpperCase().slice(0, 4),
      sku: null,
      barcode: null,
      category: over.category ? { id: `cat-${over.category}`, name: over.category } : null,
      baseUnit: { id: 'u', name: 'Piece', symbol: 'pcs' },
    },
    locationId: over.locationId ?? 'loc-a',
    locationName: over.locationName ?? 'Main store',
    locationCode: 'A',
    quantityOnHand: over.quantityOnHand ?? 10,
    quantityReserved: over.quantityReserved ?? 0,
    quantityAvailable: over.quantityAvailable ?? 10,
    averageCost: 100,
    totalValue: over.totalValue ?? 1000,
    lastMovementAt: over.lastMovementAt ?? '2026-09-01T00:00:00.000Z',
    daysSinceMovement: over.daysSinceMovement ?? 5,
    lowThreshold: 3,
    riskScore: over.riskScore ?? 0,
    status: over.status ?? 'OK',
  };
}

const ROWS = [
  row({ name: 'Cement', category: 'Building', quantityAvailable: 40, totalValue: 900000 }),
  row({
    name: 'Beer',
    category: 'Drinks',
    locationId: 'loc-b',
    locationName: 'Bar',
    quantityAvailable: 2,
    status: 'LOW',
    riskScore: 60,
  }),
  row({
    name: 'Paint',
    category: 'Building',
    quantityOnHand: 0,
    quantityAvailable: 0,
    status: 'OUT',
    daysSinceMovement: 90,
    riskScore: 100,
  }),
  row({ name: 'Nails', quantityAvailable: -3, quantityReserved: 5, quantityOnHand: 2 }),
];

describe('choosing the stock to export', () => {
  it('names each position’s status the way the view does', () => {
    expect(ROWS.map(stockStatusKey)).toEqual(['in', 'low', 'out', 'overReserved']);
  });

  it('keeps everything when nothing is chosen', () => {
    expect(filterStockRows(ROWS, DEFAULT_STOCK_EXPORT)).toHaveLength(4);
  });

  it('filters by location, category (including none), status and stock level together', () => {
    const pick = (changes: Partial<typeof DEFAULT_STOCK_EXPORT>) =>
      filterStockRows(ROWS, { ...DEFAULT_STOCK_EXPORT, ...changes }).map((r) => r.product.name);
    expect(pick({ locationIds: ['loc-b'] })).toEqual(['Beer']);
    expect(pick({ categoryIds: ['cat-Building'] })).toEqual(['Cement', 'Paint']);
    expect(pick({ categoryIds: [''] })).toEqual(['Nails']);
    expect(pick({ statuses: ['low', 'out'] })).toEqual(['Beer', 'Paint']);
    expect(pick({ availableOnly: true })).toEqual(['Cement', 'Beer']);
    expect(pick({ minAvailable: '10' })).toEqual(['Cement']);
    expect(pick({ unmovedDays: '30' })).toEqual(['Paint']);
    expect(pick({ categoryIds: ['cat-Building'], availableOnly: true })).toEqual(['Cement']);
  });

  it('sorts by the chosen order', () => {
    const names = (sort: typeof DEFAULT_STOCK_EXPORT.sort) =>
      sortStockRows(ROWS, sort).map((r) => r.product.name);
    expect(names('product')).toEqual(['Beer', 'Cement', 'Nails', 'Paint']);
    expect(names('available')).toEqual(['Nails', 'Paint', 'Beer', 'Cement']);
    expect(names('value')[0]).toBe('Cement');
    expect(names('risk').slice(0, 2)).toEqual(['Paint', 'Beer']);
  });

  it('builds only the chosen columns, in a fixed order, with numbers marked', () => {
    const table = buildStockTable([ROWS[0]], ['stockValue', 'product', 'available', 'unit']);
    expect(table.columns).toEqual(['Product', 'Unit', 'Available', 'Stock value']);
    expect(table.rows[0].slice(0, 3)).toEqual(['Cement', 'pcs', '40']);
    expect(table.numericColumns).toEqual([2, 3]);
    expect(table.columnWeights).toHaveLength(4);
  });

  it('describes the choices for the export heading', () => {
    expect(
      describeStockExport(
        DEFAULT_STOCK_EXPORT,
        { locations: new Map(), categories: new Map() },
        '',
      ),
    ).toBe('All stock positions');
    expect(
      describeStockExport(
        { ...DEFAULT_STOCK_EXPORT, categoryIds: ['cat-Drinks'], statuses: ['low'] },
        { locations: new Map(), categories: new Map([['cat-Drinks', 'Drinks']]) },
        'beer',
      ),
    ).toBe('Categories: Drinks · Status: Low stock · Search: "beer"');
  });
});

describe('the export dialog', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.clearAllMocks());

  function open() {
    return render(
      <StockExportDialog
        open
        onClose={vi.fn()}
        rows={ROWS}
        companyId="company-1"
        search=""
        loadedAt={Date.parse('2026-09-24T08:00:00Z')}
      />,
    );
  }

  it('counts what will go out as choices change', async () => {
    open();
    expect(await screen.findByText(/4 of 4 stock positions/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Drinks'));
    expect(screen.getByText(/1 of 4 stock positions/)).toBeInTheDocument();
  });

  it('exports Excel through the table export with only the chosen rows and columns', async () => {
    open();
    fireEvent.click(await screen.findByLabelText('Building'));
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));

    await waitFor(() => expect(h.downloadBinaryExport).toHaveBeenCalledTimes(1));
    const [path, body] = h.downloadBinaryExport.mock.calls[0] as unknown as [
      string,
      { format: string; rows: string[][]; columns: string[]; subtitle: string; companyId: string },
    ];
    expect(path).toBe('/generated-documents/table-export');
    expect(body.format).toBe('xlsx');
    expect(body.companyId).toBe('company-1');
    expect(body.rows.map((r) => r[0])).toEqual(['Cement', 'Paint']);
    expect(body.columns[0]).toBe('Product');
    expect(body.subtitle).toBe('Categories: Building');
  });

  it('exports CSV with the chosen columns and remembers the choices', async () => {
    open();
    fireEvent.click(await screen.findByLabelText(/CSV/));
    fireEvent.click(screen.getByRole('button', { name: 'Standard' }));
    const columns = screen.getByRole('region', { name: 'Columns' });
    for (const label of ['Code', 'Category', 'Unit', 'Location', 'Stock value', 'Status']) {
      fireEvent.click(within(columns).getByLabelText(label));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() => expect(h.downloadTextFile).toHaveBeenCalledTimes(1));
    const [name, , csv] = h.downloadTextFile.mock.calls[0] as unknown as [string, string, string];
    expect(name).toMatch(/^stock-available-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(csv.split(/\r?\n/)[0]).toBe('Product,Available');
    expect(
      JSON.parse(localStorage.getItem('itemba.inventory.stock-export.v1') ?? '{}'),
    ).toMatchObject({ format: 'csv', columns: ['product', 'available'] });
  });

  it('will not export with no columns or nothing matching', async () => {
    open();
    const columns = await screen.findByRole('region', { name: 'Columns' });
    for (const box of within(columns).getAllByRole('checkbox')) {
      if ((box as HTMLInputElement).checked) fireEvent.click(box);
    }
    expect(screen.getByText('Choose at least one column.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Export / })).toBeDisabled();
  });
});

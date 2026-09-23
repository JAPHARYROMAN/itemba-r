import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryReports from './inventory-reports';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { INVENTORY_REPORTS, normalizeInventoryReport, reportValue } from './inventory-report-data';
import { loadInventoryReport } from './inventory-report-loader';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  csv: vi.fn(),
  pdf: vi.fn(),
  permissions: new Set<string>(),
  loading: false,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => api.permissions.has(p), loading: api.loading }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get, backendPage: api.page }));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: api.csv,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: api.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const stock = {
  productCode: 'WATER_01',
  product: 'Bottled water',
  branch: 'Central warehouse',
  unit: 'btl',
  quantityOnHand: 12.0001,
  availableQuantity: 10.0001,
  totalValue: 18000.25,
  averageCost: 1500,
  stockStatus: 'LOW_STOCK',
  category: 'Beverages',
};
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const tree = (companyId = 'company') => (
  <InventoryWorkspaceProvider scope={{ ...scope, companyId }} searchQuery="">
    <InventoryReports />
  </InventoryWorkspaceProvider>
);
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  document
    .querySelectorAll('select')
    .forEach((select) =>
      Array.from(select.options).forEach((option) =>
        option.toggleAttribute('selected', option.selected),
      ),
    );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
}
beforeEach(() => {
  vi.resetAllMocks();
  api.loading = false;
  api.permissions = new Set([
    'operations.reports.view',
    'westsides.reports.view',
    'companies.read',
    'divisions.read',
    'branches.read',
  ]);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  api.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [{ id: 'company', name: 'Westsides' }]
        : path === '/divisions'
          ? [{ id: 'division', name: 'Beverages' }]
          : [{ id: 'branch', name: 'Central warehouse' }],
    total: 1,
  }));
  api.get.mockResolvedValue([stock]);
  api.pdf.mockResolvedValue(undefined);
});
describe('Inventory reports workspace', () => {
  it('offers all seven reports, keeps precise values and complete details in the OS inspector', async () => {
    render(tree());
    const inspect = await screen.findByRole('button', { name: 'Inspect Bottled water' });
    expect(screen.getAllByRole('option')).toHaveLength(7);
    expect(screen.getByText('12.0001 btl')).toBeInTheDocument();
    capture('inventory-reports');
    fireEvent.click(inspect);
    expect(screen.getByLabelText('Record details')).toHaveTextContent('WATER_01');
    expect(screen.getByLabelText('Record details')).toHaveTextContent('18,000.25');
    capture('inventory-reports-details');
    for (const report of INVENTORY_REPORTS) {
      api.get.mockResolvedValue(
        report.key === 'inventory-movements' || report.key === 'stock-adjustments'
          ? { rows: [stock], total: 1 }
          : [stock],
      );
      fireEvent.change(screen.getByLabelText('Inventory report'), {
        target: { value: report.key },
      });
      await waitFor(() =>
        expect(api.get).toHaveBeenCalledWith(
          report.endpoint,
          expect.objectContaining({ query: expect.objectContaining(scope) }),
        ),
      );
      const call = api.get.mock.calls.find(([path]) => path === report.endpoint)!;
      expect(call[1].query).not.toHaveProperty('locationId');
    }
  });
  it('reads no reports before authentication or company selection and respects each report permission', async () => {
    api.loading = true;
    const view = render(tree());
    expect(api.get).not.toHaveBeenCalled();
    api.loading = false;
    api.permissions = new Set(['westsides.reports.view']);
    view.rerender(tree(''));
    expect(screen.getByText('Select a company to run reports')).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    view.rerender(tree());
    await screen.findByRole('button', { name: 'Inspect Bottled water' });
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(api.page).not.toHaveBeenCalled();
    expect(api.get).toHaveBeenCalledWith('/westsides/reports/batch-status', expect.anything());
    api.permissions.clear();
    view.rerender(tree());
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
  });
  it('cancels obsolete scope reads and never exports their rows', async () => {
    let resolve!: (value: unknown) => void;
    api.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = render(tree());
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
    const oldSignal = api.get.mock.calls[0][1].signal;
    api.get.mockResolvedValue([{ ...stock, product: 'New scope stock' }]);
    view.rerender(tree('other'));
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    await screen.findByRole('button', { name: 'Inspect New scope stock' });
    await act(async () => resolve([stock]));
    expect(oldSignal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Inspect Bottled water' })).not.toBeInTheDocument();
  });
  it('clears stale rows on refresh errors and recovers through retry', async () => {
    render(tree());
    await screen.findByRole('button', { name: 'Inspect Bottled water' });
    api.get.mockRejectedValueOnce(new Error('Report temporarily unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh report' }));
    await screen.findByText('Report temporarily unavailable');
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Inspect Bottled water' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Inspect Bottled water' });
  });
  it('paginates complete snapshot arrays and requests the next movement page', async () => {
    api.get.mockResolvedValue(
      Array.from({ length: 21 }, (_, i) => ({ ...stock, product: 'Product ' + i })),
    );
    render(tree());
    await screen.findByRole('button', { name: 'Inspect Product 0' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('button', { name: 'Inspect Product 20' });
    expect(api.get).toHaveBeenCalledTimes(1);
    api.get.mockResolvedValue({ rows: [stock], total: 41 });
    fireEvent.change(screen.getByLabelText('Inventory report'), {
      target: { value: 'inventory-movements' },
    });
    await screen.findByRole('button', { name: 'Inspect Bottled water' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/operations-reports/inventory-movements',
        expect.objectContaining({ query: { ...scope, page: 2, pageSize: 20 } }),
      ),
    );
  });
  it('exports raw precision, scope and readiness disclosures instead of only the visible page', async () => {
    const rows = Array.from({ length: 21 }, (_, i) => ({
      ...stock,
      product: 'Product ' + i,
      _reportMeta: { readiness: { message: 'Review low balance' } },
    }));
    api.get.mockResolvedValue(rows);
    render(tree());
    await screen.findByRole('button', { name: 'Inspect Product 0' });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.csv).toHaveBeenCalled());
    const csv = api.csv.mock.calls[0][2];
    expect(csv).toContain('Product 20');
    expect(csv).toContain('12.0001');
    expect(csv).toContain('WATER_01');
    expect(csv).toContain('Review low balance');
    expect(csv).toContain('Westsides');
  });
  it('shows failed exports and suppresses files when scope changes during collection', async () => {
    render(tree());
    await screen.findByRole('button', { name: 'Inspect Bottled water' });
    api.get.mockRejectedValueOnce(new Error('Export read failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByText('Export read failed');
    expect(api.csv).not.toHaveBeenCalled();
    let resolve!: (value: unknown) => void;
    api.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByRole('status');
    fireEvent.change(screen.getByLabelText('Inventory report'), { target: { value: 'low-stock' } });
    await act(async () => resolve([stock]));
    expect(api.csv).not.toHaveBeenCalled();
  });
  it('passes a cancellation signal to PDF and keeps zero distinct from unknown', async () => {
    api.get.mockResolvedValue([{ ...stock, quantityOnHand: 0, totalValue: null }]);
    render(tree());
    await screen.findByText('0 btl');
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(api.pdf).toHaveBeenCalled());
    expect(api.pdf.mock.calls[0][0].rows[0]).toContain('0');
    expect(api.pdf.mock.calls[0][1]).toBeInstanceOf(AbortSignal);
  });
});
describe('Complete report collection', () => {
  const report = INVENTORY_REPORTS.find((r) => r.key === 'inventory-movements')!;
  it('collects all movement pages and rejects incomplete or changing totals', async () => {
    api.get
      .mockResolvedValueOnce({ rows: [stock], total: 2 })
      .mockResolvedValueOnce({ rows: [stock], total: 2 });
    expect(
      (await loadInventoryReport(report, scope, new AbortController().signal)).rows,
    ).toHaveLength(2);
    expect(api.get.mock.calls[1][1].query.page).toBe(2);
    for (const response of [
      { rows: [], total: 2 },
      { rows: [stock], total: 3 },
    ]) {
      api.get.mockResolvedValueOnce({ rows: [stock], total: 2 }).mockResolvedValueOnce(response);
      await expect(
        loadInventoryReport(report, scope, new AbortController().signal),
      ).rejects.toThrow();
    }
  });
  it('rejects oversized PDFs, aborted reads and malformed responses', async () => {
    api.get.mockResolvedValueOnce({ rows: [stock], total: 5001 });
    await expect(
      loadInventoryReport(report, scope, new AbortController().signal, 5000),
    ).rejects.toThrow('5,000');
    const controller = new AbortController();
    controller.abort();
    await expect(loadInventoryReport(report, scope, controller.signal)).rejects.toThrow();
    expect(() => normalizeInventoryReport({ rows: [], total: 'unknown' })).toThrow();
    expect(reportValue('quantity', 12.0001)).toBe('12.0001');
    expect(reportValue('quantity', null)).toBe('—');
    expect(reportValue('productCode', 'A_B')).toBe('A_B');
  });
});

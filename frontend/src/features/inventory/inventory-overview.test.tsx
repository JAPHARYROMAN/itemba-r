import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryOverview, { movementQuantity } from './inventory-overview';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    user: {},
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPage: state.page }));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: state.pdf }));
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const totals = { totalValue: 4800000, totalSkus: 84, low: 6, out: 2, negative: 1 };
const movements = [
  {
    id: 'receipt',
    movementNumber: 'MOV-001',
    movementDate: '2026-09-17',
    movementType: 'PURCHASE_RECEIPT',
    quantity: 40,
    product: { name: 'Twiga Cement 50kg', productCode: 'CEM-01' },
    branch: { name: 'Central warehouse' },
    referenceNumber: 'GRN-010',
    notes: 'Delivery received',
  },
  {
    id: 'issue',
    movementNumber: 'MOV-002',
    movementDate: '2026-09-16',
    movementType: 'SALE_ISSUE',
    quantity: 5,
    product: { name: 'Coral white', productCode: 'P-01' },
    branch: { name: 'Central warehouse' },
    referenceNumber: 'SO-009',
  },
  {
    id: 'other',
    movementNumber: 'MOV-003',
    movementDate: '2026-09-16',
    movementType: 'OTHER',
    quantity: 2,
    product: { name: 'Delivery service', productCode: 'DEL-01' },
  },
];
const embedded = (companyId = 'company') => (
  <InventoryWorkspaceProvider scope={{ ...scope, companyId }} searchQuery="">
    <InventoryOverview />
  </InventoryWorkspaceProvider>
);
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
}
beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  state.permissions = new Set([
    'inventory.view',
    'inventory.movements.view',
    'products.view',
    'product_categories.view',
    'units.view',
  ]);
  state.get.mockImplementation(async (path: string) =>
    path.endsWith('/live')
      ? { totals }
      : path === '/stock-adjustments'
        ? { total: 3 }
        : { data: movements, total: 3 },
  );
  state.page.mockResolvedValue({ data: [], total: 0 });
  state.pdf.mockResolvedValue(undefined);
});
describe('inventory overview', () => {
  it('gates all reads and keeps movement access independent from inventory access', async () => {
    state.permissions.clear();
    const view = render(embedded());
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    state.permissions.add('inventory.view');
    view.rerender(embedded());
    await screen.findByText('TZS 4,800,000.00');
    expect(state.get.mock.calls.map(([p]) => p)).toEqual([
      '/inventory-balances/live',
      '/stock-adjustments',
    ]);
    expect(
      screen.queryByRole('region', { name: 'Recent inventory activity' }),
    ).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('shows actual stock position counts, named movement details and scope-preserving destinations', async () => {
    render(embedded());
    await screen.findByText('TZS 4,800,000.00');
    expect(screen.getByText('84')).toBeInTheDocument();
    expect(screen.getByText('3 awaiting approval in this scope.')).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Twiga Cement 50kg' }));
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(detail).getByText('GRN-010')).toBeVisible();
    expect(within(detail).getByText('Delivery received')).toBeVisible();
    expect(screen.getByRole('link', { name: 'View all movements →' })).toHaveAttribute(
      'href',
      '/inventory?tab=stock&view=movements&companyId=company&divisionId=division&branchId=branch',
    );
    for (const [, options] of state.get.mock.calls) expect(options.query).toMatchObject(scope);
    capture('inventory-overview');
  });
  it('surfaces independent summary and pending failures without turning them into zero', async () => {
    let failed = true;
    state.get.mockImplementation(async (path: string) => {
      if (failed && path !== '/inventory-movements')
        throw new Error(
          path.endsWith('/live') ? 'Stock service unavailable' : 'Adjustments unavailable',
        );
      return path.endsWith('/live')
        ? { totals }
        : path === '/stock-adjustments'
          ? { total: 0 }
          : { data: movements, total: 3 };
    });
    render(embedded());
    await screen.findByText('Stock service unavailable');
    await screen.findByText('Adjustments unavailable');
    expect(screen.queryByText('TZS 0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('0 awaiting approval in this scope.')).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Inspect Coral white' })).toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry adjustments' }));
    await screen.findByText('TZS 4,800,000.00');
    await screen.findByText('0 awaiting approval in this scope.');
  });
  it('aborts old scope requests and hides stale movements, metrics and exports', async () => {
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const view = render(embedded());
    await screen.findByRole('button', { name: 'Inspect Coral white' });
    const signal = state.get.mock.calls[0][1].signal;
    state.get.mockImplementation(() => new Promise(() => {}));
    view.rerender(embedded('second'));
    expect(signal.aborted).toBe(true);
    expect(screen.queryByRole('button', { name: 'Inspect Coral white' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export recent CSV' })).toBeDisabled();
    await act(async () => resolve({ totals }));
    expect(screen.queryByText('TZS 4,800,000.00')).not.toBeInTheDocument();
  });
  it('exports only the labelled preview with correct signed and unknown quantities, and retains PDF failures', async () => {
    render(embedded());
    await screen.findByRole('button', { name: 'Inspect Coral white' });
    fireEvent.click(screen.getByRole('button', { name: 'Export recent CSV' }));
    expect(state.download.mock.calls[0][2]).toContain('-5');
    expect(state.download.mock.calls[0][2]).toContain('MOV-003');
    state.pdf.mockRejectedValueOnce(new Error('PDF unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Export recent PDF' }));
    await screen.findByText('PDF unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Export recent PDF' }));
    await waitFor(() => expect(state.pdf).toHaveBeenCalledTimes(2));
    expect(state.pdf).toHaveBeenLastCalledWith(
      expect.objectContaining({
        subtitle: 'Latest 3 movements in the selected scope',
        rows: expect.arrayContaining([expect.arrayContaining(['-5'])]),
      }),
    );
    expect(movementQuantity({ ...movements[0], quantity: null })).toBeNull();
    expect(movementQuantity({ ...movements[0], quantity: 0 })).toBe(0);
    expect(movementQuantity(movements[2])).toBe(2);
    expect(movementQuantity({ ...movements[1], quantity: -5 })).toBe(-5);
  });
  it('keeps movement failures separate from empty results and refreshes all permitted sources', async () => {
    state.get.mockImplementation(async (path: string) => {
      if (path === '/inventory-movements') throw new Error('Movements unavailable');
      return path.endsWith('/live') ? { totals } : { total: 0 };
    });
    render(embedded());
    await screen.findByText('Movements unavailable');
    expect(screen.queryByText(/No recent movements/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export recent PDF' })).toBeDisabled();
    state.get.mockImplementation(async (path: string) =>
      path === '/inventory-movements'
        ? { data: [], total: 0 }
        : path.endsWith('/live')
          ? { totals }
          : { total: 0 },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh inventory' }));
    await screen.findByText(
      'No recent movements. Stock movements for this scope will appear here.',
    );
    expect(state.get).toHaveBeenCalledTimes(6);
  });
  it('requires a company and reads complete standalone directory choices only with permission', async () => {
    state.permissions.add('companies.read');
    state.page.mockImplementation(
      async (_path: string, { query }: { query: { page: number } }) => ({
        data: [
          {
            id: query.page === 1 ? 'company' : 'second',
            name: query.page === 1 ? 'First company' : 'Second company',
          },
        ],
        total: 2,
      }),
    );
    render(<InventoryOverview />);
    await screen.findByRole('option', { name: 'Second company' });
    expect(state.get).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'second' } });
    await screen.findByText('TZS 4,800,000.00');
    expect(state.get).toHaveBeenCalledWith(
      '/inventory-balances/live',
      expect.objectContaining({ query: { companyId: 'second', divisionId: '', branchId: '' } }),
    );
  });
});

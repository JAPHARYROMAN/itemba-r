import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryBalances, { balanceAvailable, type InventoryBalance } from './inventory-balances';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
  params: '',
  loading: false,
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(state.params) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: {},
    loading: state.loading,
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPage: state.page }));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: state.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const balance: InventoryBalance = {
  id: 'balance',
  companyId: 'company',
  divisionId: 'division',
  branchId: 'branch',
  productId: 'product',
  quantityOnHand: 40,
  quantityReserved: 5,
  quantityAvailable: 35,
  averageCost: 16000,
  totalValue: 640000,
  reorderLevel: 10,
  stockStatus: 'IN_STOCK',
  costStatus: 'HAS_COST',
  lastMovementAt: '2026-09-17',
  daysSinceMovement: 1,
  product: {
    id: 'product',
    name: 'Twiga Cement 50kg',
    productCode: 'CEM-01',
    sku: 'C50',
    barcode: '12345678',
    category: { id: 'cement', name: 'Cement' },
    productFamily: { id: 'family', name: '50 kg', brand: 'Twiga' },
  },
  company: { id: 'company', name: 'Example Company' },
  division: { id: 'division', name: 'Building supplies' },
  branch: { id: 'branch', name: 'Central warehouse', code: 'HQ' },
};
const oversold: InventoryBalance = {
  ...balance,
  id: 'oversold',
  productId: 'paint',
  quantityOnHand: 2,
  quantityReserved: 7,
  quantityAvailable: -5,
  averageCost: 0,
  totalValue: 0,
  stockStatus: 'OVERSOLD',
  costStatus: 'MISSING_COST',
  lastMovementAt: null,
  daysSinceMovement: null,
  product: { id: 'paint', name: 'Coral white', productCode: 'P-01' },
};
const summary = {
  totalSkus: 2,
  totalValue: 640000,
  outOfStock: 0,
  lowStock: 0,
  oversold: 1,
  missingCost: 1,
  staleStock: 0,
};
const embed = (companyId = 'company', q = '') => (
  <InventoryWorkspaceProvider
    scope={{ companyId, divisionId: 'division', branchId: 'branch' }}
    searchQuery={q}
  >
    <InventoryBalances />
  </InventoryWorkspaceProvider>
);
const loaded = () => screen.findByRole('button', { name: 'Inspect Twiga Cement 50kg' });
const filters = () => fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  state.params = '';
  state.loading = false;
  state.permissions = new Set([
    'inventory.view',
    'inventory.movements.view',
    'products.view',
    'product_categories.view',
  ]);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  state.get.mockImplementation(async (path: string) =>
    path.endsWith('/summary') ? summary : { data: [balance, oversold], total: 2 },
  );
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/inventory-balances'
        ? [balance, oversold]
        : path === '/product-categories'
          ? [{ id: 'cement', name: 'Cement' }]
          : [{ id: 'family', name: '50 kg', brand: 'Twiga' }],
    total: path === '/inventory-balances' ? 2 : 1,
  }));
  state.pdf.mockResolvedValue(undefined);
});
describe('Inventory balances workspace', () => {
  it('gates record and directory reads before auth and exposes only permitted destinations', async () => {
    state.loading = true;
    const view = render(embed());
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    state.loading = false;
    state.permissions.clear();
    view.rerender(embed());
    await screen.findByText('Permission required');
    expect(state.get).not.toHaveBeenCalled();
    state.permissions.add('inventory.view');
    view.rerender(embed());
    fireEvent.click(await loaded());
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.queryByRole('link', { name: 'Open product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View movements' })).not.toBeInTheDocument();
  });
  it('preserves all stock facts and exact row scope in product and movement destinations', async () => {
    render(embed());
    fireEvent.click(await loaded());
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    for (const text of [
      '40',
      '5',
      '35',
      '10',
      'TZS 16,000.00',
      'TZS 640,000.00',
      'Has cost',
      'Cement',
      '50 kg',
      'C50',
      '12345678',
      'Example Company',
      'Building supplies',
      'HQ · Central warehouse',
      '1 day',
    ])
      expect(within(detail).getByText(text)).toBeVisible();
    expect(screen.getByRole('link', { name: 'View movements' })).toHaveAttribute(
      'href',
      '/inventory?tab=stock&view=movements&companyId=company&divisionId=division&branchId=branch&productId=product',
    );
    expect(screen.getByRole('link', { name: 'Open product' })).toHaveAttribute(
      'href',
      '/inventory/products/product?companyId=company&divisionId=division&branchId=branch',
    );
    capture('inventory-balances');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Coral white' }));
    expect(within(detail).getByText('-5')).toBeVisible();
    expect(within(detail).getByText('Missing cost')).toBeVisible();
    expect(within(detail).getAllByText('TZS 0.00')).toHaveLength(2);
    expect(
      balanceAvailable({ ...balance, quantityOnHand: null, quantityAvailable: null }),
    ).toBeNull();
  });
  it('combines scope, search, category, family, cost, stock and age with server pagination', async () => {
    state.get.mockImplementation(async (path: string) =>
      path.endsWith('/summary')
        ? { ...summary, totalSkus: 30 }
        : { data: [balance, oversold], total: 30 },
    );
    render(embed());
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/inventory-balances',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 25 }) }),
      ),
    );
    filters();
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'cement' } });
    await waitFor(() => expect(screen.getByLabelText('Product family')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Product family'), { target: { value: 'family' } });
    fireEvent.change(screen.getByLabelText('Cost status'), { target: { value: 'MISSING_COST' } });
    fireEvent.change(screen.getByLabelText('Stock status'), { target: { value: 'OVERSOLD' } });
    fireEvent.change(screen.getByLabelText('Movement age'), { target: { value: '60' } });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'cement' } });
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/inventory-balances',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'company',
            divisionId: 'division',
            branchId: 'branch',
            categoryId: 'cement',
            productFamilyId: 'family',
            search: 'cement',
            costStatus: 'MISSING_COST',
            stockStatus: 'OVERSOLD',
            staleDays: '60',
            page: 1,
          }),
        }),
      ),
    );
    expect(state.get).toHaveBeenCalledWith(
      '/inventory-balances/summary',
      expect.objectContaining({
        query: expect.objectContaining({
          search: 'cement',
          stockStatus: 'OVERSOLD',
          staleDays: '60',
        }),
      }),
    );
  });
  it('resets dependent filters on scope changes and cancels stale reads', async () => {
    const view = render(embed());
    fireEvent.click(await loaded());
    fireEvent.click(screen.getByRole('button', { name: 'Same family' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/inventory-balances',
        expect.objectContaining({
          query: expect.objectContaining({ categoryId: 'cement', productFamilyId: 'family' }),
        }),
      ),
    );
    let resolve!: (v: unknown) => void;
    state.get.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    view.rerender(embed('second'));
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/inventory-balances',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'second',
            categoryId: '',
            productFamilyId: '',
          }),
        }),
      ),
    );
    expect(
      screen.queryByRole('button', { name: 'Inspect Twiga Cement 50kg' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    const signal = state.get.mock.calls.at(-1)![1].signal;
    const staleResolve = resolve;
    view.rerender(embed('third'));
    expect(signal.aborted).toBe(true);
    await act(async () => staleResolve(summary));
    expect(
      screen.queryByRole('button', { name: 'Inspect Twiga Cement 50kg' }),
    ).not.toBeInTheDocument();
  });
  it('shows independent summary failures without replacing successful balances with an empty register', async () => {
    state.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/summary')) throw new Error('Valuation unavailable');
      return { data: [balance], total: 1 };
    });
    render(embed());
    await loaded();
    await screen.findByText('Valuation unavailable');
    expect(screen.queryByText('TZS 0.00')).not.toBeInTheDocument();
    state.get.mockResolvedValue(summary);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Filtered balance summary');
    await waitFor(() =>
      expect(screen.queryByText('Valuation unavailable')).not.toBeInTheDocument(),
    );
  });
  it('reads every export page, retains later-page failures, and refuses oversized PDFs', async () => {
    render(embed());
    await loaded();
    state.page.mockImplementation(async (path: string, { query }: { query: { page: number } }) => {
      if (path !== '/inventory-balances') return { data: [], total: 0 };
      if (query.page === 2) throw new Error('Second export page unavailable');
      return { data: [balance], total: 2 };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByText('Second export page unavailable');
    expect(state.download).not.toHaveBeenCalled();
    state.page.mockImplementation(
      async (_path: string, { query }: { query: { page: number } }) => ({
        data: query.page === 1 ? [balance] : [oversold],
        total: 2,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(state.download).toHaveBeenCalledTimes(1));
    expect(state.download.mock.calls[0][2]).toContain('Coral white');
    expect(state.download.mock.calls[0][2]).toContain('-5');
    state.page.mockResolvedValue({
      data: Array.from({ length: 5001 }, (_, i) => ({ ...balance, id: String(i) })),
      total: 5001,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByText(/PDF supports up to 5,000 records. Narrow/);
    expect(state.pdf).not.toHaveBeenCalled();
  });
  it('aborts an in-flight export when filters change and never downloads obsolete data', async () => {
    render(embed());
    await loaded();
    let resolve!: (v: unknown) => void;
    state.page.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const signal = state.page.mock.calls.at(-1)![1].signal;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'paint' } });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: [balance], total: 1 }));
    expect(state.download).not.toHaveBeenCalled();
  });
  it('loads complete directory choices, exposes failures and clears family when category changes', async () => {
    state.page.mockImplementation(async (path: string, { query }: { query: { page: number } }) => {
      if (path === '/product-categories')
        return {
          data: [
            {
              id: query.page === 1 ? 'cement' : 'paint',
              name: query.page === 1 ? 'Cement' : 'Paint',
            },
          ],
          total: 2,
        };
      throw new Error('Families unavailable');
    });
    render(embed());
    await loaded();
    filters();
    await screen.findByRole('option', { name: 'Paint' });
    await screen.findByText(/Families unavailable/);
    state.page.mockResolvedValue({ data: [{ id: 'family', name: '50 kg' }], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: /Retry Family choices/i }));
    await screen.findByRole('option', { name: '50 kg' });
    fireEvent.change(screen.getByLabelText('Product family'), { target: { value: 'family' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'paint' } });
    expect(screen.getByLabelText('Product family')).toHaveValue('');
  });
  it('honours standalone legacy scope and low-stock links on the first read', async () => {
    state.params =
      'companyId=company&divisionId=division&locationId=branch&lowStock=1&productId=product';
    render(<InventoryBalances />);
    await loaded();
    expect(state.get.mock.calls[0][1].query).toMatchObject({
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      productId: 'product',
      stockStatus: 'LOW_STOCK',
    });
    expect(screen.getByLabelText('Branch')).toHaveValue('branch');
  });
  it('keeps register failures separate from empty results and retries the failed read', async () => {
    state.get.mockImplementation(async (path: string) => {
      if (path === '/inventory-balances') throw new Error('Balances unavailable');
      return summary;
    });
    render(embed());
    await screen.findByText('Balances unavailable');
    expect(screen.queryByText(/No balances match/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    state.get.mockResolvedValue({ data: [balance], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
    expect(screen.queryByText('Balances unavailable')).not.toBeInTheDocument();
  });
  it('retains a PDF failure and exports all stock facts on retry', async () => {
    render(embed());
    await loaded();
    state.pdf.mockRejectedValueOnce(new Error('PDF unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByText('PDF unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(state.pdf).toHaveBeenCalledTimes(2));
    expect(state.pdf).toHaveBeenLastCalledWith(
      expect.objectContaining({
        companyId: 'company',
        columns: expect.arrayContaining([
          'Reserved',
          'Available',
          'Reorder level',
          'Average cost',
          'Stock value',
          'Days since movement',
        ]),
        rows: expect.arrayContaining([
          expect.arrayContaining(['Coral white', '-5', 'Missing cost']),
        ]),
      }),
    );
  });
});

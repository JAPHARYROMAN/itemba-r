import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProductProfile } from './product-profile';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import type { Product } from './product-types';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    user: { companyId: 'company' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
  backendUpload: state.upload,
}));
const product: Product = {
  id: 'product',
  companyId: 'company',
  company: { name: 'Example Company' },
  divisionId: 'division',
  division: { id: 'division', name: 'Building supplies', code: 'BS' },
  name: 'Coral white',
  productCode: 'P-01',
  sku: 'COR-W',
  barcode: '12345678',
  categoryId: 'paint',
  category: { name: 'Paints' },
  productFamilyId: 'family',
  productFamily: {
    id: 'family',
    brand: 'Coral',
    name: '4 litre',
    defaultPurchasePrice: 12000,
    defaultSellingPrice: 18000,
  },
  variantColor: 'Ivory',
  variantFinish: 'Matt',
  productType: 'STOCK_ITEM',
  baseUnitId: 'unit',
  baseUnit: { name: 'Litre', symbol: 'L' },
  status: 'ACTIVE',
  trackInventory: true,
  trackBatch: true,
  trackExpiry: false,
  defaultPurchasePrice: 12000,
  defaultSellingPrice: null,
  effectiveSellingPrice: 18000,
  effectivePurchasePrice: 12000,
  effectiveWholesalePrice: 16000,
  effectiveRetailPrice: 20000,
  priceSource: 'FAMILY_DEFAULT',
  minimumStockLevel: 0,
  maximumStockLevel: 150,
  reorderLevel: 20,
  description: 'Washable interior finish',
  isTaxable: true,
  taxRate: 18,
};
const balance = {
  id: 'balance',
  branch: { name: 'Central warehouse' },
  quantityOnHand: 30,
  quantityReserved: 5,
  averageCost: 12000,
  totalValue: 360000,
  lastMovementAt: '2026-09-17',
};
const movement = {
  id: 'movement',
  movementNumber: 'MOV-01',
  movementDate: '2026-09-17',
  movementType: 'SALE_ISSUE',
  quantity: 2,
  unitCost: 12000,
  totalCost: 24000,
  referenceNumber: 'SO-001',
  referenceType: 'SalesOrder',
  referenceId: 'order',
  notes: 'Collected from warehouse',
  branch: { name: 'Central warehouse' },
  createdBy: { fullName: 'Example User' },
};
const ledger = {
  salesOrderId: 'order',
  salesOrderNumber: 'SO-001',
  orderDate: '2026-09-17',
  customerName: 'Example Customer',
  quantity: 2,
  unitPrice: 18000,
  unitCostAtSale: 12000,
  cogsAmount: 24000,
  grossProfitAmount: 12000,
  grossMarginPct: 33.333,
  profitCostSource: 'AVERAGE_COST',
};
const backHref =
  '/inventory?tab=catalog&view=products&companyId=company&divisionId=division&branchId=branch&q=coral';
const component = (id = 'product') => (
  <UnsavedWorkProvider>
    <ProductProfile key={id} productId={id} backHref={backHref} />
  </UnsavedWorkProvider>
);
const mount = () => render(component());
async function section(name: string) {
  fireEvent.click(await screen.findByRole('button', { name, exact: true }));
}
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
}
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'products.view',
    'products.update',
    'inventory.view',
    'inventory.movements.view',
    'profit.view',
    'sales.view',
    'grn.list',
    'purchases.view',
  ]);
  state.get.mockImplementation(async (path: string) =>
    path === '/inventory-movements'
      ? { data: [movement], total: 1 }
      : path.includes('/ledger')
        ? [ledger]
        : product,
  );
  state.page.mockImplementation(async (path: string) => ({
    data: path === '/inventory-balances' ? [balance] : [],
    total: path === '/inventory-balances' ? 1 : 0,
  }));
  state.patch.mockResolvedValue(product);
});
describe('product profile', () => {
  it('retries a failed product read and loads each history only when selected', async () => {
    state.get.mockRejectedValueOnce(new Error('Product unavailable'));
    mount();
    await screen.findByText('Product unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('heading', { name: product.name });
    expect(state.page).not.toHaveBeenCalled();
    await section('Movement history');
    await screen.findByText('MOV-01');
    expect(screen.getByRole('link', { name: 'Open inventory movements →' })).toHaveAttribute(
      'href',
      '/inventory?tab=stock&view=movements&companyId=company',
    );
    capture('product-profile-movements');
    expect(state.get.mock.calls.filter(([path]) => path.includes('/ledger'))).toHaveLength(0);
  });
  it('separates product access, history permissions and editing', async () => {
    state.permissions.clear();
    const view = mount();
    expect(state.get).not.toHaveBeenCalled();
    expect(screen.getByText('Permission required')).toBeInTheDocument();
    state.permissions.add('pos.create');
    view.rerender(component());
    await screen.findByRole('heading', { name: product.name });
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stock by branch' })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Back to products' })).toHaveAttribute(
      'href',
      backHref,
    );
    state.permissions.add('operations.reports.view');
    view.rerender(component());
    await section('Profitability');
    await screen.findByText('Example Customer');
    expect(screen.queryByRole('link', { name: 'SO-001' })).not.toBeInTheDocument();
  });
  it('preserves all identity, pricing, stock and related-workspace details', async () => {
    mount();
    await screen.findByRole('heading', { name: product.name });
    for (const value of [
      'COR-W',
      '12345678',
      'Building supplies',
      'Example Company',
      'Ivory · Matt',
      'Litre (L)',
      'Taxable · 18%',
      'Inventory · Batch',
      'Washable interior finish',
      '33.33%',
      'TZS 16,000.00',
      'TZS 20,000.00',
    ])
      expect(screen.getByText(value)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Goods received →' })).toHaveAttribute(
      'href',
      '/procurement/grns',
    );
    expect(screen.getByRole('link', { name: 'Purchase orders →' })).toHaveAttribute(
      'href',
      '/operations/purchase-orders',
    );
    expect(state.get).toHaveBeenCalledTimes(1);
    capture('product-profile');
  });
  it('keeps unknown effective prices and costs distinct from zero', async () => {
    state.get.mockResolvedValue({
      ...product,
      effectiveSellingPrice: null,
      effectivePurchasePrice: null,
      defaultSellingPrice: 500,
      defaultPurchasePrice: 100,
      division: null,
      taxRate: null,
    });
    const { container } = mount();
    await screen.findByRole('heading', { name: product.name });
    const summary = container.querySelector('.workspace-summary')!;
    expect(summary.textContent).not.toContain('500');
    expect(summary.textContent).not.toContain('100');
    expect(summary.textContent).not.toContain('%');
    expect(screen.getByText('division')).toBeInTheDocument();
    expect(screen.getByText('Taxable · rate not set')).toBeInTheDocument();
  });
  it('reads every balance page for totals, paginates display and retries failed later pages', async () => {
    let failed = true;
    state.page.mockImplementation(async (_path: string, options: { query: { page: number } }) => {
      if (options.query.page === 2 && failed) throw new Error('Later balance page failed');
      return {
        data:
          options.query.page === 1
            ? Array.from({ length: 100 }, (_, i) => ({
                ...balance,
                id: `b${i}`,
                branch: { name: `Branch ${i}` },
                quantityOnHand: 1,
                quantityReserved: 0,
                totalValue: 1,
              }))
            : [
                {
                  ...balance,
                  id: 'last',
                  branch: { name: 'Last branch' },
                  quantityOnHand: 7,
                  quantityReserved: 2,
                  totalValue: 7,
                },
              ],
        total: 101,
      };
    });
    mount();
    await section('Stock by branch');
    await screen.findByText('Later balance page failed');
    expect(screen.queryByText('Branch 0')).not.toBeInTheDocument();
    expect(screen.queryByText('No stock balances')).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Branch 0');
    expect(screen.getByText('107')).toBeInTheDocument();
    expect(screen.getByText('105')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 6 · 101 records')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Branch 20')).toBeInTheDocument();
    expect(screen.queryByText('Branch 0')).not.toBeInTheDocument();
    expect(state.page).toHaveBeenCalledWith(
      '/inventory-balances',
      expect.objectContaining({
        query: { companyId: 'company', productId: 'product', page: 2, limit: 100 },
      }),
    );
  });
  it('shows known zero and negative availability and does not invent totals for unknown balances', async () => {
    state.page.mockResolvedValue({
      data: [{ ...balance, quantityOnHand: 0, quantityReserved: 2, totalValue: null }],
      total: 1,
    });
    mount();
    await section('Stock by branch');
    await screen.findByText('Central warehouse');
    expect(screen.getAllByText('-2').length).toBe(2);
    expect(screen.getAllByText('0').length).toBe(2);
    expect(screen.getAllByText('—').length).toBeGreaterThan(1);
    capture('product-profile-stock');
  });
  it('shows movement failures, retries and server pages, retaining the section on refresh', async () => {
    let failed = true;
    state.get.mockImplementation(async (path: string, options: { query: { page?: number } }) => {
      if (path !== '/inventory-movements') return product;
      if (failed) throw new Error('Movements unavailable');
      return {
        data: [{ ...movement, movementNumber: options.query.page === 2 ? 'MOV-02' : 'MOV-01' }],
        total: 21,
      };
    });
    mount();
    await section('Movement history');
    await screen.findByText('Movements unavailable');
    expect(screen.queryByText('No movements')).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('MOV-01');
    expect(screen.getByText('−2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SO-001' })).toHaveAttribute(
      'href',
      '/operations/sales-orders/order',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('MOV-02');
    expect(state.get).toHaveBeenCalledWith(
      '/inventory-movements',
      expect.objectContaining({
        query: { companyId: 'company', productId: 'product', page: 2, limit: 20 },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByText('MOV-01');
    expect(screen.getByRole('button', { name: 'Movement history' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
  it('labels the limited profit history, preserves line costs and paginates repeated order lines', async () => {
    state.get.mockImplementation(async (path: string) =>
      path.includes('/ledger')
        ? Array.from({ length: 21 }, (_, i) => ({
            ...ledger,
            customerName: `Customer ${i}`,
            unitCostAtSale: i === 0 ? null : 12000,
          }))
        : product,
    );
    mount();
    await section('Profitability');
    await screen.findByText('Customer 0');
    expect(screen.getByText(/latest 250 sales lines/)).toBeInTheDocument();
    const row = screen.getByText('Customer 0').closest('tr')!;
    expect(within(row).getByText('—')).toBeInTheDocument();
    expect(within(row).getByText('TZS 24,000.00')).toBeInTheDocument();
    expect(within(row).getByText('33.33%')).toBeInTheDocument();
    capture('product-profile-profit');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('Customer 20')).toBeInTheDocument();
    expect(screen.queryByText('Customer 0')).not.toBeInTheDocument();
  });
  it('cancels obsolete reads and keeps failures distinct from empty history', async () => {
    let resolve!: (p: Product) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise<Product>((r) => {
          resolve = r;
        }),
    );
    const view = mount();
    const signal = state.get.mock.calls[0][1].signal;
    view.rerender(component('second'));
    await screen.findByRole('heading', { name: product.name });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ...product, name: 'Obsolete product' }));
    expect(screen.queryByText('Obsolete product')).not.toBeInTheDocument();
    state.get.mockRejectedValue(new Error('Profit unavailable'));
    await section('Profitability');
    await screen.findByText('Profit unavailable');
    expect(screen.queryByText('No confirmed sales')).not.toBeInTheDocument();
    state.get.mockResolvedValue([]);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No confirmed sales');
  });
  it('supports keyboard section navigation and product edits with retained failure input', async () => {
    mount();
    await screen.findByRole('heading', { name: product.name });
    const overview = screen.getByRole('button', { name: 'Overview' });
    overview.focus();
    fireEvent.keyDown(overview, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Stock by branch' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Edit product' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByRole('textbox', { name: /Product name/ });
    fireEvent.change(name, { target: { value: 'Coral revised' } });
    state.patch.mockRejectedValueOnce(new Error('Update unavailable'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    await screen.findByText('Update unavailable');
    expect(name).toHaveValue('Coral revised');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    await screen.findByText('“Coral white” updated.');
    expect(state.patch).toHaveBeenLastCalledWith('/products/product', { name: 'Coral revised' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

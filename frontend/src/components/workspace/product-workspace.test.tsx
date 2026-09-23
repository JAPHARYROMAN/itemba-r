import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProductWorkspace, productExportRows, productLowStock } from './product-workspace';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { InventoryWorkspaceProvider } from '@/features/inventory/inventory-workspace-context';
import type { Product } from './product-types';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    loading: false,
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
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: state.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const family = {
  id: 'family',
  name: '4 litre',
  brand: 'Coral',
  categoryId: 'paint',
  defaultPurchasePrice: 12000,
  defaultSellingPrice: 18000,
};
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
  productFamily: family,
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
  availableQuantity: 0,
  inventoryBalance: { quantityOnHand: 4, availableQuantity: 0 },
  description: 'Washable interior finish',
  isTaxable: true,
  taxRate: 18,
};
const other: Product = {
  ...product,
  id: 'other',
  name: 'Coral blue',
  status: 'INACTIVE',
  productCode: 'P-02',
  priceSource: 'MISSING',
  effectiveSellingPrice: null,
  effectivePurchasePrice: null,
  effectiveWholesalePrice: null,
  effectiveRetailPrice: null,
  availableQuantity: null,
  inventoryBalance: null,
};
const mount = (content: React.ReactNode = <ProductWorkspace />) =>
  render(<UnsavedWorkProvider>{content}</UnsavedWorkProvider>);
const embedded = (companyId = 'company', searchQuery = '') => (
  <InventoryWorkspaceProvider
    scope={{ companyId, divisionId: 'division', branchId: 'branch' }}
    searchQuery={searchQuery}
  >
    <ProductWorkspace />
  </InventoryWorkspaceProvider>
);
const inspect = async () =>
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect Coral white' }));
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const clone = document.body.cloneNode(true) as HTMLElement;
  document.querySelectorAll('select').forEach((select, i) =>
    Array.from(clone.querySelectorAll('select')[i].options).forEach((option) => {
      if (option.value === select.value) option.setAttribute('selected', '');
      else option.removeAttribute('selected');
    }),
  );
  writeFileSync(join(dir, name + '.html'), clone.innerHTML);
}
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'products.view',
    'products.create',
    'products.update',
    'products.delete',
    'companies.read',
    'divisions.read',
    'branches.read',
    'product_categories.view',
    'units.view',
  ]);
  state.get.mockResolvedValue({ data: [product, other], total: 2 });
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [
            { id: 'company', name: 'Example Company' },
            { id: 'second', name: 'Second Company' },
          ]
        : path === '/divisions'
          ? [{ id: 'division', name: 'Building supplies' }]
          : path === '/branches'
            ? [{ id: 'branch', name: 'Central warehouse' }]
            : path === '/product-categories'
              ? [{ id: 'paint', name: 'Paints' }]
              : path === '/products/families'
                ? [family]
                : path === '/units'
                  ? [{ id: 'unit', name: 'Litre', symbol: 'L' }]
                  : [product, other],
    total: path === '/companies' || path === '/products' ? 2 : 1,
  }));
  state.post.mockResolvedValue(product);
  state.patch.mockResolvedValue(product);
  state.remove.mockResolvedValue({});
  state.pdf.mockResolvedValue(undefined);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('product register', () => {
  it('gates reads and actions independently and avoids unrelated directory calls', async () => {
    state.permissions.clear();
    const ui = mount();
    expect(await screen.findByText('Your role cannot view products.')).toBeVisible();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    state.permissions.add('products.view');
    ui.rerender(
      <UnsavedWorkProvider>
        <ProductWorkspace />
      </UnsavedWorkProvider>,
    );
    await inspect();
    expect(screen.queryByRole('button', { name: 'New product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete product' })).not.toBeInTheDocument();
    expect(state.page.mock.calls.every(([path]) => path === '/products/families')).toBe(true);
  });
  it('combines every filter with search and keeps server pagination in scope', async () => {
    state.get.mockResolvedValue({
      data: Array.from({ length: 20 }, (_, i) => ({ ...product, id: `p${i}`, name: `Paint ${i}` })),
      total: 21,
    });
    mount();
    await screen.findByRole('button', { name: 'Inspect Paint 0' });
    await waitFor(() => expect(screen.getByLabelText('Company filter')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Company filter'), { target: { value: 'company' } });
    await waitFor(() => expect(screen.getByLabelText('Division filter')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Division filter'), { target: { value: 'division' } });
    await waitFor(() => expect(screen.getByLabelText('Branch filter')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Branch filter'), { target: { value: 'branch' } });
    await waitFor(() => expect(screen.getByLabelText('Category filter')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Category filter'), { target: { value: 'paint' } });
    await waitFor(() => expect(screen.getByLabelText('Family filter')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Family filter'), { target: { value: 'family' } });
    fireEvent.change(screen.getByLabelText('Type filter'), { target: { value: 'STOCK_ITEM' } });
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'ACTIVE' } });
    fireEvent.change(screen.getByLabelText('Price source filter'), {
      target: { value: 'FAMILY_DEFAULT' },
    });
    fireEvent.change(screen.getByPlaceholderText('Search products…'), {
      target: { value: 'coral' },
    });
    const expected = {
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      categoryId: 'paint',
      productFamilyId: 'family',
      productType: 'STOCK_ITEM',
      status: 'ACTIVE',
      priceSource: 'FAMILY_DEFAULT',
      search: 'coral',
      page: 1,
      limit: 20,
    };
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/products',
        expect.objectContaining({ query: expected }),
      ),
    );
    await screen.findByRole('button', { name: 'Inspect Paint 0' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/products',
        expect.objectContaining({ query: { ...expected, page: 2 } }),
      ),
    );
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'INACTIVE' } });
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/products',
        expect.objectContaining({ query: { ...expected, status: 'INACTIVE' } }),
      ),
    );
  });
  it('preserves embedded scope in stock, search and profile links, clearing dependent filters on scope changes', async () => {
    const ui = mount(embedded());
    await inspect();
    expect(screen.queryByLabelText('Company filter')).not.toBeInTheDocument();
    const details = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(details).getByText('At or below reorder level')).toBeVisible();
    const href = screen.getByRole('link', { name: 'Full product profile' }).getAttribute('href');
    expect(href).toBe(
      '/inventory/products/product?companyId=company&divisionId=division&branchId=branch',
    );
    fireEvent.change(screen.getByLabelText('Category filter'), { target: { value: 'paint' } });
    ui.rerender(<UnsavedWorkProvider>{embedded('second', 'blue')}</UnsavedWorkProvider>);
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/products',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'second',
            divisionId: 'division',
            branchId: 'branch',
            categoryId: '',
            productFamilyId: '',
            search: 'blue',
            page: 1,
          }),
        }),
      ),
    );
  });
  it('cancels stale reads and gives failures their own retry instead of showing an empty catalogue', async () => {
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mount();
    const signal = state.get.mock.calls[0][1].signal as AbortSignal;
    state.get.mockRejectedValueOnce(new Error('Products unavailable'));
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'INACTIVE' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Products unavailable');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: [product], total: 1 }));
    expect(screen.queryByRole('button', { name: 'Inspect Coral white' })).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing here yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await inspect();
  });
  it('reads every selector page and exposes later-page choice failures with retry', async () => {
    const normal = state.page.getMockImplementation()!;
    let failed = true;
    state.page.mockImplementation(async (path, opts) => {
      if (path !== '/companies') return normal(path, opts);
      if (opts.query.page === 1)
        return { data: [{ id: 'company', name: 'Example Company' }], total: 2 };
      if (failed) throw new Error('Directory page failed');
      return { data: [{ id: 'second', name: 'Second Company' }], total: 2 };
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Directory page failed');
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    expect(screen.getByLabelText('Company filter')).toBeDisabled();
    expect(screen.queryByRole('option', { name: 'Example Company' })).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry company choices' }));
    expect(await screen.findByRole('option', { name: 'Second Company' })).toBeInTheDocument();
  });
  it('exports every filtered page with explicit unknown values and refuses oversized PDF', async () => {
    const normal = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (path, opts) =>
      path !== '/products'
        ? normal(path, opts)
        : {
            data: [opts.query.page === 1 ? product : { ...other, name: 'Last export page' }],
            total: 2,
          },
    );
    mount(embedded());
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(state.download).toHaveBeenCalledWith(
        'products.csv',
        'text/csv;charset=utf-8',
        expect.stringContaining('Last export page'),
      ),
    );
    const exports = state.page.mock.calls.filter(([path]) => path === '/products');
    expect(exports.map(([, opts]) => opts.query.page)).toEqual([1, 2]);
    expect(exports[1][1].query).toMatchObject({
      companyId: 'company',
      branchId: 'branch',
      divisionId: 'division',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() =>
      expect(state.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          rows: expect.arrayContaining([expect.arrayContaining(['Last export page'])]),
        }),
      ),
    );
    expect(productExportRows([other], 'branch')[0]).toMatchObject({
      Selling: null,
      Purchase: null,
      'On hand': null,
      Available: null,
    });
    state.page.mockResolvedValue({
      data: Array.from({ length: 5001 }, (_, i) => ({ ...product, id: String(i) })),
      total: 5001,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF supports up to 5,000');
    expect(state.pdf).toHaveBeenCalledTimes(1);
  });
  it('never downloads partial exports after a later-page failure or changed filters', async () => {
    const normal = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (path, opts) => {
      if (path !== '/products') return normal(path, opts);
      if (opts.query.page === 1) return { data: [product], total: 2 };
      throw new Error('Export page failed');
    });
    mount();
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Export page failed');
    expect(state.download).not.toHaveBeenCalled();
    let finish!: (value: unknown) => void;
    let signal!: AbortSignal;
    state.page.mockImplementation((path, opts) =>
      path === '/products'
        ? new Promise((resolve) => {
            finish = resolve;
            signal = opts.signal;
          })
        : normal(path, opts),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'INACTIVE' } });
    expect(signal.aborted).toBe(true);
    await act(async () => finish({ data: [product], total: 1 }));
    expect(state.download).not.toHaveBeenCalled();
  });
  it('keeps named delete failures open and only refreshes after successful retry', async () => {
    mount();
    await inspect();
    state.remove.mockRejectedValueOnce(new Error('Product has history'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete product' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete Coral white?' });
    const before = state.get.mock.calls.length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete product' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Product has history');
    expect(state.get).toHaveBeenCalledTimes(before);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete product' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.remove).toHaveBeenLastCalledWith('/products/product');
    await waitFor(() => expect(state.get.mock.calls.length).toBeGreaterThan(before));
  });
  it('opens the shared editor, reports its save and preserves generated/skipped family results', async () => {
    mount();
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Edit product' }));
    await waitFor(() => expect(screen.getByLabelText('Product family')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: 'Updated description' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('“Coral white” updated.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New product' }));
    await waitFor(() => expect(screen.getByLabelText('Category*')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Product name', { exact: false }), {
      target: { value: 'Coral ivory' },
    });
    fireEvent.change(screen.getByLabelText('Category*'), { target: { value: 'paint' } });
    await waitFor(() => expect(screen.getByLabelText('Product family')).toBeEnabled());
    fireEvent.change(screen.getByLabelText('Product family'), { target: { value: 'family' } });
    fireEvent.change(screen.getByLabelText('Base unit*'), { target: { value: 'unit' } });
    state.post.mockResolvedValue({
      ...product,
      name: 'Coral ivory',
      generatedFamilyProducts: [{ ...product, id: 'generated' }],
      skippedFamilyProducts: [
        { productFamilyId: 'missing', familyName: '10 litre', reason: 'No family selling price' },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('“Coral ivory” created.')).toBeVisible();
    expect(
      screen.getByText('Coral ivory: 1 additional family-size products created.'),
    ).toBeVisible();
    expect(screen.getByText('10 litre: No family selling price')).toBeVisible();
  });
  it('retains full product detail fields and distinguishes missing stock from zero', async () => {
    mount(embedded());
    await screen.findByRole('button', { name: 'Inspect Coral white' });
    capture('product-register-list');
    await inspect();
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    for (const value of [
      'COR-W',
      '12345678',
      'Washable interior finish',
      'Coral · 4 litre',
      'Inventory · Batches',
      'Taxable · 18%',
    ])
      expect(within(detail).getByText(value)).toBeVisible();
    expect(productLowStock(product)).toBe(true);
    expect(productLowStock(other)).toBe(false);
    expect(productLowStock({ ...product, availableQuantity: undefined })).toBe(false);
    expect(
      productExportRows([{ ...product, effectiveSellingPrice: 0 }], 'branch')[0],
    ).toMatchObject({ Selling: 0, Available: 0, 'On hand': 4 });
    capture('product-register');
  });
  it('returns keyboard focus from the phone inspector to the selected product', async () => {
    window.matchMedia = vi
      .fn()
      .mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    mount();
    await inspect();
    const details = screen.getByRole('complementary', { name: 'Record details' });
    expect(details).toHaveFocus();
    fireEvent.keyDown(details, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Inspect Coral white' })).toHaveFocus(),
    );
  });
});

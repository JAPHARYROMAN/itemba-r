import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryBatches, { batchConsumed, batchDate, type ProductBatch } from './inventory-batches';
import { BatchEditor, validBatchQuantity } from './inventory-batch-editor';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  params: '',
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  loading: false,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(state.params),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/inventory',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    loading: state.loading,
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
  backendList: async (...args: unknown[]) => (await state.page(...args)).data,
}));
const batch: ProductBatch = {
  id: 'batch',
  batchNumber: 'BATCH-2026-00124',
  companyId: 'company',
  branchId: 'branch',
  productId: 'milk',
  supplierId: 'supplier',
  purchaseOrderId: 'po',
  unitId: 'unit',
  status: 'ACTIVE',
  initialQuantity: '120.125',
  remainingQuantity: '70.0001',
  unitCost: 0,
  manufactureDate: '2026-09-01',
  expiryDate: '2026-10-01',
  receivedDate: '2026-09-15',
  createdAt: '2026-09-15',
  notes: 'Keep chilled at the receiving warehouse.',
  company: { id: 'company', name: 'Westsides' },
  product: { id: 'milk', name: 'Fresh milk', productCode: 'MLK-01', sku: 'M1', barcode: '987654' },
  supplier: { id: 'supplier', name: 'Dairy supply' },
  unit: { id: 'unit', name: 'Litre', symbol: 'L' },
  branch: {
    id: 'branch',
    name: 'Central warehouse',
    divisionId: 'division',
    division: { id: 'division', name: 'Trading' },
  },
};
const rows = [
  batch,
  {
    ...batch,
    id: 'unknown',
    batchNumber: 'BATCH-2026-00125',
    status: 'QUARANTINED',
    expiryDate: null,
    remainingQuantity: null,
    initialQuantity: null,
    branchId: null,
    branch: null,
  },
  {
    ...batch,
    id: 'zero',
    batchNumber: 'BATCH-2026-00126',
    status: 'SOLD_OUT',
    remainingQuantity: 0,
  },
];
const embed = (companyId = 'company') => (
  <InventoryWorkspaceProvider
    scope={{ companyId, divisionId: 'division', branchId: 'branch' }}
    searchQuery=""
  >
    <InventoryBatches />
  </InventoryWorkspaceProvider>
);
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  document.querySelectorAll('input').forEach((input) => input.setAttribute('value', input.value));
  document
    .querySelectorAll('select')
    .forEach((select) =>
      Array.from(select.options).forEach((option) =>
        option.toggleAttribute('selected', option.selected),
      ),
    );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), document.body.innerHTML);
}
const loaded = () => screen.findByRole('button', { name: `Inspect ${batch.batchNumber}` });
beforeEach(() => {
  vi.resetAllMocks();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.params = '';
  state.loading = false;
  state.permissions = new Set([
    'product_batches.view',
    'product_batches.manage',
    'products.view',
    'units.view',
    'companies.read',
    'branches.read',
    'divisions.read',
    'suppliers.view',
    'purchases.view',
    'inventory.movements.view',
    'stock_damage.view',
  ]);
  state.get.mockImplementation(async (path) =>
    path === '/westsides/product-batches'
      ? { data: rows, total: 121 }
      : { id: 'milk', name: 'Fresh milk', defaultUnitId: 'unit' },
  );
  state.page.mockImplementation(async (path) => ({
    data:
      path === '/units'
        ? [{ id: 'unit', name: 'Litre', symbol: 'L' }]
        : path === '/branches'
          ? [{ id: 'branch', name: 'Central warehouse' }]
          : path === '/suppliers'
            ? [{ id: 'supplier', name: 'Dairy supply' }]
            : path === '/companies'
              ? [
                  { id: 'company', name: 'Westsides' },
                  { id: 'other', name: 'Other company' },
                ]
              : [],
    total: path === '/companies' ? 2 : 1,
    page: 1,
    limit: 100,
  }));
  state.post.mockResolvedValue({ id: 'new-batch' });
});
describe('Batches workspace', () => {
  it('restores expiry review and selection after remount, and clears them for another company', async () => {
    const tree = (shown: boolean, company = 'company') => (
      <WorkspaceSessionProvider>{shown && embed(company)}</WorkspaceSessionProvider>
    );
    const view = render(tree(true));
    await screen.findByRole('button', { name: 'Inspect BATCH-2026-00124' });
    fireEvent.click(screen.getByRole('button', { name: 'Expiring within 30 days' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect BATCH-2026-00124' }));
    view.rerender(tree(false));
    view.rerender(tree(true));
    await screen.findByRole('button', { name: 'Close details' });
    expect(screen.getByRole('button', { name: 'Expiring within 30 days' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    view.rerender(tree(true, 'otherco'));
    await screen.findByRole('button', { name: 'Inspect BATCH-2026-00124' });
    expect(screen.getByRole('button', { name: 'All batches' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument();
  });
  it('waits for authorization and never reads or offers creation without batch view access', () => {
    state.loading = true;
    const view = render(embed());
    expect(state.get).not.toHaveBeenCalled();
    state.loading = false;
    state.permissions.delete('product_batches.view');
    view.rerender(embed());
    expect(state.get).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New batch' })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('renders complete detail fields and scopes links to the batch rather than the outer filters', async () => {
    render(embed());
    await loaded();
    capture('inventory-batches');
    fireEvent.click(await loaded());
    const detail = screen.getByLabelText('Record details');
    expect(within(detail).getByText('70.0001 L')).toBeInTheDocument();
    expect(within(detail).getByText('50.1249 L')).toBeInTheDocument();
    expect(within(detail).getByText('TZS 0.00')).toBeInTheDocument();
    expect(within(detail).getByText(batch.notes!)).toBeInTheDocument();
    expect(within(detail).getByRole('link', { name: 'Open product' })).toHaveAttribute(
      'href',
      '/inventory/products/milk?companyId=company&divisionId=division&branchId=branch',
    );
    expect(within(detail).getByRole('link', { name: 'Product movements' })).toHaveAttribute(
      'href',
      expect.stringContaining('productId=milk'),
    );
    expect(within(detail).getByRole('link', { name: 'Purchase order' })).toHaveAttribute(
      'href',
      '/operations/purchase-orders/po',
    );
    capture('inventory-batches-details');
  });
  it('distinguishes missing quantities/dates from zero and restricts destinations independently', async () => {
    state.permissions = new Set(['product_batches.view']);
    render(embed());
    fireEvent.click(await loaded());
    expect(screen.queryByRole('link', { name: 'Open product' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Purchase order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New batch' })).not.toBeInTheDocument();
    expect(batchConsumed(rows[1])).toBeNull();
    expect(batchConsumed(rows[2])).toBe(120.125);
    expect(batchDate(null)).toBe('—');
    expect(batchDate('invalid')).toBe('—');
    expect(batchDate('2026-10-01T00:00:00Z')).toBe('01 Oct 2026');
    const table = screen.getByRole('table');
    expect(within(table).getByText('0 L')).toBeInTheDocument();
    expect(within(table).getAllByText('—')).toHaveLength(2);
  });
  it('keeps product and organization filters in both expiry reviews with server pagination and search', async () => {
    state.params = 'productId=milk';
    render(embed());
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/westsides/product-batches',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expiring within 30 days', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/westsides/product-batches',
        expect.objectContaining({
          query: expect.objectContaining({
            page: 1,
            review: 'expiring',
            productId: 'milk',
            companyId: 'company',
            branchId: 'branch',
            divisionId: 'division',
          }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));
    fireEvent.change(screen.getByLabelText('Batch status'), { target: { value: 'ACTIVE' } });
    fireEvent.change(screen.getByPlaceholderText('Search batch, product or supplier…'), {
      target: { value: ' dairy ' },
    });
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/westsides/product-batches',
        expect.objectContaining({
          query: expect.objectContaining({
            search: 'dairy',
            review: 'expiring',
            status: 'ACTIVE',
            productId: 'milk',
          }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expired', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/westsides/product-batches',
        expect.objectContaining({
          query: expect.objectContaining({
            review: 'expired',
            productId: 'milk',
            branchId: 'branch',
            search: 'dairy',
          }),
        }),
      ),
    );
  });
  it('takes same-view URL changes and cancels obsolete reads', async () => {
    let resolve!: (value: unknown) => void;
    state.get.mockImplementation(async (path, options) => {
      if (path !== '/westsides/product-batches') return { id: 'milk', name: 'Fresh milk' };
      if (options.query.productId === 'old')
        return new Promise((r) => {
          resolve = r;
        });
      return { data: rows, total: 121 };
    });
    state.params = 'productId=old';
    const view = render(embed());
    await waitFor(() => expect(state.get).toHaveBeenCalled());
    const first = state.get.mock.calls.find(([path]) => path === '/westsides/product-batches')![1];
    state.params = 'productId=new';
    view.rerender(embed('other'));
    await loaded();
    expect(first.signal.aborted).toBe(true);
    expect(state.get).toHaveBeenLastCalledWith(
      '/westsides/product-batches',
      expect.objectContaining({
        query: expect.objectContaining({ companyId: 'other', productId: 'new' }),
      }),
    );
    await act(async () => resolve({ data: [{ ...batch, batchNumber: 'OBSOLETE' }], total: 1 }));
    expect(screen.queryByText('OBSOLETE')).not.toBeInTheDocument();
  });
  it('clears failed refresh data and retries, then clamps a page when the matching collection shrinks', async () => {
    render(embed());
    await loaded();
    state.get.mockRejectedValueOnce(new Error('Batch service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh batches' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Batch service unavailable');
    expect(screen.queryByText(batch.batchNumber)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
    state.get.mockResolvedValue({ data: rows, total: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/westsides/product-batches',
        expect.objectContaining({ query: expect.objectContaining({ page: 1 }) }),
      ),
    );
  });
});
function editor(saved = vi.fn(), close = vi.fn()) {
  return render(
    <UnsavedWorkProvider>
      <BatchEditor
        scope={{ companyId: 'company', branchId: 'branch', divisionId: 'division' }}
        productId="milk"
        onSaved={saved}
        onClose={close}
      />
    </UnsavedWorkProvider>,
  );
}
async function fillEditor() {
  await screen.findByRole('option', { name: 'Litre (L)' });
  fireEvent.change(screen.getByLabelText(/Batch unit/), { target: { value: 'unit' } });
  fireEvent.change(screen.getByLabelText(/Initial quantity/), { target: { value: '12.3456' } });
}
describe('Batch creation', () => {
  it('retains drafts through Stay and a failed save, then retries the exact payload', async () => {
    const saved = vi.fn(),
      close = vi.fn();
    editor(saved, close);
    await fillEditor();
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'supplier' } });
    await setDateField('Manufacture date', '2026-09-01');
    await setDateField('Expiry date', '2026-10-01');
    capture('inventory-batch-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Initial quantity/)).toHaveValue(12.3456);
    state.post.mockRejectedValueOnce(new Error('Batch creation failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Create batch', exact: true }));
    expect(await screen.findByText('Batch creation failed')).toBeInTheDocument();
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create batch', exact: true }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(state.post).toHaveBeenLastCalledWith('/westsides/product-batches', {
      companyId: 'company',
      branchId: 'branch',
      productId: 'milk',
      supplierId: 'supplier',
      unitId: 'unit',
      initialQuantity: 12.3456,
      manufactureDate: '2026-09-01',
      expiryDate: '2026-10-01',
    });
    expect(state.post.mock.calls[0]).toEqual(state.post.mock.calls[1]);
  });
  it('validates quantity precision and date order without posting', async () => {
    editor();
    await fillEditor();
    for (const value of ['', '0', '-1', 'Infinity', '1.00001', '100000000000000'])
      expect(validBatchQuantity(value)).toBe(false);
    expect(validBatchQuantity('0.0001')).toBe(true);
    await setDateField('Manufacture date', '2026-10-01');
    await setDateField('Expiry date', '2026-09-01');
    fireEvent.click(screen.getByRole('button', { name: 'Create batch', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Expiry date must be on or after manufacture date.',
    );
    expect(state.post).not.toHaveBeenCalled();
  });
  it('uses complete directory pages, retries a later-page failure and never offers partial units', async () => {
    const base = state.page.getMockImplementation()!;
    let failed = true;
    state.page.mockImplementation(async (path, options) => {
      if (path !== '/units') return base(path, options);
      if (options.query.page === 1)
        return {
          data: Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, name: `Unit ${i}` })),
          total: 101,
          page: 1,
          limit: 100,
        };
      if (failed) throw new Error('Second page unavailable');
      return {
        data: [{ id: 'unit', name: 'Litre', symbol: 'L' }],
        total: 101,
        page: 2,
        limit: 100,
      };
    });
    editor();
    expect(await screen.findByRole('alert')).toHaveTextContent('Second page unavailable');
    expect(screen.queryByRole('option', { name: 'Unit 0' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create batch', exact: true })).toBeDisabled();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry unit choices' }));
    await screen.findByRole('option', { name: 'Litre (L)' });
    expect(screen.getByRole('option', { name: 'Unit 99' })).toBeInTheDocument();
  });
  it('clears dependent references when company changes and guards optional directory permissions', async () => {
    editor();
    await fillEditor();
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'supplier' } });
    fireEvent.change(screen.getByLabelText(/Batch company/), { target: { value: 'other' } });
    expect(screen.getByLabelText('Supplier')).toHaveValue('');
    expect(screen.getByLabelText('Batch branch')).toHaveValue('');
    expect(screen.getByLabelText(/Batch unit/)).toHaveValue('');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/units',
        expect.objectContaining({ query: expect.objectContaining({ companyId: 'other' }) }),
      ),
    );
  });
  it('requires manage and lookup permissions without unauthorized reads', async () => {
    state.permissions = new Set(['product_batches.manage']);
    editor();
    expect(screen.getByRole('button', { name: 'Create batch', exact: true })).toBeDisabled();
    expect(state.page).not.toHaveBeenCalled();
    expect(state.get).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Product and unit read access');
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryDamage from './inventory-damage';
import { DamageEditor, validDamageEstimate, validDamageQuantity } from './inventory-damage-editor';
import { DamageActionDialog } from './inventory-damage-action';
import type { StockDamage } from './inventory-damage-types';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
const api = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
  permissions: new Set<string>(),
  params: '',
  loading: false,
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(api.params),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/inventory',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    loading: api.loading,
    hasPermission: (p: string) => api.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: api.get,
  backendPage: api.page,
  backendPost: api.post,
  backendPatch: api.patch,
  backendList: async (...args: unknown[]) => (await api.page(...args)).data,
}));
vi.mock('@/lib/report-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/report-export')>()),
  downloadTextFile: api.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: api.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const row: StockDamage = {
  id: 'damage',
  damageNumber: 'DMG-2026-00024',
  companyId: 'company',
  branchId: 'branch',
  productId: 'water',
  unitId: 'unit',
  batchId: 'batch',
  quantity: '12.0001',
  estimatedValue: '18000.25',
  status: 'APPROVED',
  damageType: 'DAMAGED_PACKAGING',
  notes: 'Cases damaged during unloading. Count verified at receiving.',
  createdAt: '2026-09-17T08:00:00Z',
  updatedAt: '2026-09-18T07:00:00Z',
  approvedAt: '2026-09-18T07:00:00Z',
  company: { id: 'company', name: 'Westsides' },
  branch: {
    id: 'branch',
    name: 'Central warehouse',
    divisionId: 'division',
    division: { id: 'division', name: 'Beverages' },
  },
  product: {
    id: 'water',
    name: 'Bottled water',
    productCode: 'WATER-01',
    sku: 'W1',
    barcode: '12345678',
  },
  unit: { id: 'unit', name: 'Bottle', symbol: 'btl' },
  batch: { id: 'batch', batchNumber: 'BATCH-2026-00031' },
  reportedBy: { id: 'reporter', fullName: 'Receiving operator' },
  approvedBy: { id: 'approver', fullName: 'Stock reviewer' },
};
const rows = [
  row,
  {
    ...row,
    id: 'draft',
    damageNumber: 'DMG-2026-00025',
    status: 'DRAFT',
    estimatedValue: 0,
    quantity: 0,
    batchId: null,
    batch: null,
  },
  {
    ...row,
    id: 'unknown',
    damageNumber: 'DMG-2026-00026',
    status: 'SUBMITTED',
    estimatedValue: null,
    quantity: null,
  },
];
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const embed = () => (
  <UnsavedWorkProvider>
    <InventoryWorkspaceProvider scope={scope} searchQuery="">
      <InventoryDamage />
    </InventoryWorkspaceProvider>
  </UnsavedWorkProvider>
);
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  document.querySelectorAll('input').forEach((e) => e.setAttribute('value', e.value));
  document.querySelectorAll('textarea').forEach((e) => (e.textContent = e.value));
  document
    .querySelectorAll('select')
    .forEach((e) =>
      Array.from(e.options).forEach((o) => o.toggleAttribute('selected', o.selected)),
    );
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), document.body.innerHTML);
}
const loaded = () => screen.findByRole('button', { name: 'Inspect DMG-2026-00024' });
beforeEach(() => {
  vi.resetAllMocks();
  api.params = '';
  api.loading = false;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  api.permissions = new Set([
    'stock_damage.view',
    'stock_damage.create',
    'stock_damage.approve',
    'stock_damage.post',
    'companies.read',
    'divisions.read',
    'branches.read',
    'products.view',
    'units.view',
    'product_batches.view',
    'inventory.movements.view',
  ]);
  api.get.mockImplementation(async (path) =>
    path === '/westsides/stock-damage'
      ? { data: rows, total: 121 }
      : path === '/westsides/stock-damage/damage'
        ? row
        : { id: 'water', name: 'Bottled water', defaultUnitId: 'unit' },
  );
  api.page.mockImplementation(async (path) => ({
    data:
      path === '/companies'
        ? [
            { id: 'company', name: 'Westsides' },
            { id: 'other', name: 'Other company' },
          ]
        : path === '/divisions'
          ? [{ id: 'division', name: 'Beverages' }]
          : path === '/branches'
            ? [
                { id: 'branch', name: 'Central warehouse', divisionId: 'division' },
                { id: 'otherbranch', name: 'Other branch', divisionId: 'division' },
              ]
            : path === '/units'
              ? [{ id: 'unit', name: 'Bottle', symbol: 'btl' }]
              : path === '/products'
                ? [{ id: 'water', name: 'Bottled water', defaultUnitId: 'unit' }]
                : path === '/westsides/product-batches'
                  ? [
                      {
                        id: 'batch',
                        batchNumber: 'BATCH-2026-00031',
                        unitId: 'unit',
                        status: 'ACTIVE',
                        remainingQuantity: 80,
                        unit: { symbol: 'btl' },
                      },
                    ]
                  : [row],
    total: path === '/companies' || path === '/branches' ? 2 : 1,
    page: 1,
    limit: 100,
  }));
});
describe('Damage register', () => {
  it('restores damage filters and selected record after app switching', async () => {
    const tree = (shown: boolean) => (
      <WorkspaceSessionProvider>{shown && embed()}</WorkspaceSessionProvider>
    );
    const view = render(tree(true));
    await screen.findByRole('button', { name: 'Inspect DMG-2026-00024' });
    fireEvent.change(screen.getByLabelText('Damage status'), { target: { value: 'APPROVED' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect DMG-2026-00024' }));
    view.rerender(tree(false));
    view.rerender(tree(true));
    await screen.findByRole('button', { name: 'Close details' });
    expect(screen.getByLabelText('Damage status')).toHaveValue('APPROVED');
    expect(api.get).toHaveBeenLastCalledWith(
      '/westsides/stock-damage',
      expect.objectContaining({ query: expect.objectContaining({ ...scope, status: 'APPROVED' }) }),
    );
  });
  it('preserves precise quantities and relation fields without confusing unknown and zero', async () => {
    render(embed());
    await loaded();
    capture('inventory-damage');
    expect(screen.getByText('12.0001 btl')).toBeInTheDocument();
    expect(screen.getByText('0 btl')).toBeInTheDocument();
    expect(screen.getByText('TZS 0.00')).toBeInTheDocument();
    fireEvent.click(await loaded());
    const detail = screen.getByLabelText('Record details');
    expect(detail).toHaveTextContent('Receiving operator');
    expect(detail).toHaveTextContent('Stock reviewer');
    expect(detail).toHaveTextContent(row.notes!);
    expect(detail).toHaveTextContent('Beverages');
    capture('inventory-damage-details');
    expect(within(detail).getByRole('link', { name: 'Open product' })).toHaveAttribute(
      'href',
      expect.stringContaining('branchId=branch'),
    );
    expect(within(detail).getByRole('link', { name: 'Find linked batch' })).toHaveAttribute(
      'href',
      expect.stringContaining('q=BATCH-2026-00031'),
    );
  });
  it('combines scope, search, type, product and status with server pagination', async () => {
    render(embed());
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/westsides/stock-damage',
        expect.objectContaining({
          query: expect.objectContaining({ ...scope, page: 2, limit: 20 }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText('Damage status'), { target: { value: 'APPROVED' } });
    fireEvent.change(screen.getByLabelText('Damage type filter'), {
      target: { value: 'BREAKAGE' },
    });
    fireEvent.focus(screen.getByRole('combobox', { name: 'Filter damage by product' }));
    await screen.findByRole('option', { name: /Bottled water/ });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Filter damage by product' }), {
      key: 'Enter',
    });
    fireEvent.change(screen.getByPlaceholderText('Search damage, product or batch…'), {
      target: { value: '  receiving  ' },
    });
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/westsides/stock-damage',
        expect.objectContaining({
          query: expect.objectContaining({
            ...scope,
            productId: 'water',
            status: 'APPROVED',
            damageType: 'BREAKAGE',
            search: 'receiving',
            page: 1,
          }),
        }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await loaded();
  });
  it('waits for authorization and permits creation without unauthorized register reads', async () => {
    api.loading = true;
    const view = render(embed());
    expect(api.get).not.toHaveBeenCalled();
    api.loading = false;
    api.permissions = new Set(['stock_damage.create']);
    view.rerender(embed());
    expect(screen.getByText(/Viewing existing reports requires/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report damage' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.page).not.toHaveBeenCalled();
    api.permissions.clear();
    view.rerender(embed());
    expect(screen.queryByRole('button', { name: 'Report damage' })).not.toBeInTheDocument();
  });
  it('clears stale rows on read failure and clamps pagination after collection shrinkage', async () => {
    render(embed());
    await loaded();
    api.get.mockRejectedValueOnce(new Error('Damage service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh damage' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Damage service unavailable');
    expect(screen.queryByText(row.damageNumber)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
    api.get.mockResolvedValue({ data: rows, total: 3 });
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/westsides/stock-damage',
        expect.objectContaining({ query: expect.objectContaining({ page: 1 }) }),
      ),
    );
  });
  it('aborts obsolete reads and exports when a same-view URL changes', async () => {
    api.params = 'companyId=company&productId=water';
    const view = render(<InventoryDamage />);
    await loaded();
    const base = api.page.getMockImplementation()!;
    let resolve!: (data: unknown) => void;
    api.page.mockImplementation((path, options) =>
      path === '/westsides/stock-damage'
        ? new Promise((r) => {
            resolve = r;
          })
        : base(path, options),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(resolve).toBeDefined());
    api.params = 'companyId=other&productId=oil&status=DRAFT';
    view.rerender(<InventoryDamage />);
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/westsides/stock-damage',
        expect.objectContaining({
          query: expect.objectContaining({ companyId: 'other', productId: 'oil', status: 'DRAFT' }),
        }),
      ),
    );
    await act(async () => resolve({ data: [row], total: 1 }));
    expect(api.download).not.toHaveBeenCalled();
  });
  it('exports every page, retains later-page errors and applies the PDF limit', async () => {
    render(embed());
    await loaded();
    let fail = true;
    api.page.mockImplementation(async (_path, options) => {
      if (options.query.page === 1)
        return { data: Array.from({ length: 100 }, () => row), total: 101 };
      if (fail) throw new Error('Last page failed');
      return { data: [{ ...row, damageNumber: 'LAST-101' }], total: 101 };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Last page failed');
    expect(api.download).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.download).toHaveBeenCalledOnce());
    expect(api.download.mock.calls[0][2]).toContain('LAST-101');
    api.pdf.mockRejectedValueOnce(new Error('PDF service failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('PDF service failed');
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(api.pdf).toHaveBeenCalledTimes(2));
    expect(api.pdf.mock.calls[1][0].rows).toHaveLength(101);
    api.page.mockResolvedValue({ data: Array.from({ length: 5001 }, () => row), total: 5001 });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('5,000 reports');
    expect(api.pdf).toHaveBeenCalledTimes(2);
  });
  it.each([
    ['DRAFT', ['Submit for review']],
    ['SUBMITTED', ['Approve report', 'Reject report']],
    ['APPROVED', ['Post write-off']],
    ['REJECTED', []],
    ['POSTED', []],
    ['CANCELLED', []],
  ] as [string, string[]][])('offers only permitted actions for %s', async (status, labels) => {
    api.get.mockResolvedValue({ data: [{ ...row, status }], total: 1 });
    const view = render(embed());
    fireEvent.click(await loaded());
    const detail = screen.getByLabelText('Record details');
    for (const label of ['Submit for review', 'Approve report', 'Reject report', 'Post write-off'])
      expect(within(detail).queryByRole('button', { name: label }) !== null).toBe(
        labels.includes(label),
      );
    if (status === 'POSTED')
      expect(within(detail).getByRole('link', { name: 'Posted movements' })).toHaveAttribute(
        'href',
        expect.stringContaining('referenceType=StockDamage'),
      );
    api.permissions = new Set(['stock_damage.view']);
    view.rerender(embed());
    for (const label of labels)
      expect(within(detail).queryByRole('button', { name: label })).not.toBeInTheDocument();
    expect(within(detail).queryByRole('link')).not.toBeInTheDocument();
  });
});
describe('Damage action confirmation', () => {
  it('reads the current report, retries failures and distinguishes estimate from posted value', async () => {
    api.get.mockRejectedValueOnce(new Error('Report unavailable'));
    const saved = vi.fn();
    render(<DamageActionDialog id="damage" action="post" onClose={vi.fn()} onSaved={saved} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Report unavailable');
    expect(screen.getByRole('button', { name: 'Post write-off' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry report' }));
    await screen.findByText('12.0001 btl');
    expect(screen.getByText(/estimate below is not the posting amount/)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    capture('inventory-damage-post');
    api.patch.mockRejectedValueOnce(new Error('Insufficient batch quantity'));
    fireEvent.click(screen.getByRole('button', { name: 'Post write-off' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient batch quantity');
    expect(saved).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Post write-off' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.patch).toHaveBeenLastCalledWith('/westsides/stock-damage/damage/post');
  });
  it('blocks a stale status and does not fetch or mutate without permission', async () => {
    api.get.mockResolvedValue({ ...row, status: 'POSTED' });
    const view = render(
      <DamageActionDialog id="damage" action="post" onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('now Posted');
    expect(screen.getByRole('button', { name: 'Post write-off' })).toBeDisabled();
    api.permissions.delete('stock_damage.post');
    const count = api.get.mock.calls.length;
    view.rerender(
      <DamageActionDialog id="damage" action="post" onClose={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('does not permit');
    expect(api.get).toHaveBeenCalledTimes(count);
    expect(api.patch).not.toHaveBeenCalled();
  });
});
function editor(productId = 'water') {
  const saved = vi.fn(),
    close = vi.fn();
  render(
    <UnsavedWorkProvider>
      <DamageEditor scope={scope} productId={productId} onClose={close} onSaved={saved} />
    </UnsavedWorkProvider>,
  );
  return { saved, close };
}
async function fill() {
  await screen.findByRole('option', { name: 'Bottle (btl)' });
  fireEvent.change(screen.getByLabelText(/Damage unit/), { target: { value: 'unit' } });
  fireEvent.change(screen.getByLabelText(/Damaged quantity/), { target: { value: '2.0001' } });
}
describe('Damage reporting', () => {
  it('protects drafts and preserves a failed save with the exact batch, quantity and zero estimate', async () => {
    const { saved, close } = editor();
    await fill();
    await screen.findByRole('option', { name: /BATCH-2026-00031/ });
    fireEvent.change(screen.getByLabelText('Linked batch'), { target: { value: 'batch' } });
    fireEvent.change(screen.getByLabelText('Estimated total value (TZS)'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('Damage notes'), {
      target: { value: 'Verified breakage at receiving.' },
    });
    capture('inventory-damage-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Damaged quantity/)).toHaveValue(2.0001);
    api.post.mockRejectedValueOnce(new Error('Damage save failed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save damage draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Damage save failed');
    fireEvent.click(screen.getByRole('button', { name: 'Save damage draft' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1]);
    expect(api.post).toHaveBeenLastCalledWith('/westsides/stock-damage', {
      companyId: 'company',
      branchId: 'branch',
      productId: 'water',
      unitId: 'unit',
      batchId: 'batch',
      quantity: 2.0001,
      damageType: 'BREAKAGE',
      estimatedValue: 0,
      notes: 'Verified breakage at receiving.',
    });
  });
  it('retains optional unknown estimate and validates quantity and money precision', async () => {
    editor();
    await fill();
    fireEvent.click(screen.getByRole('button', { name: 'Save damage draft' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(api.post.mock.calls[0][1]).not.toHaveProperty('estimatedValue');
    for (const value of ['', '0', '-1', 'Infinity', '1.00001', '100000000000000'])
      expect(validDamageQuantity(value)).toBe(false);
    for (const value of ['-1', 'Infinity', '1.001', '10000000000000000'])
      expect(validDamageEstimate(value)).toBe(false);
    expect(validDamageQuantity('0.0001')).toBe(true);
    expect(validDamageEstimate('')).toBe(true);
    expect(validDamageEstimate('0')).toBe(true);
  });
  it('loads all directory pages and retries failed pages without offering incomplete choices', async () => {
    const base = api.page.getMockImplementation()!;
    let fail = true;
    api.page.mockImplementation(async (path, options) => {
      if (path !== '/units') return base(path, options);
      if (options.query.page === 1)
        return {
          data: Array.from({ length: 100 }, (_, i) => ({ id: `u${i}`, name: `Unit ${i}` })),
          total: 101,
        };
      if (fail) throw new Error('Later unit page unavailable');
      return { data: [{ id: 'unit', name: 'Bottle', symbol: 'btl' }], total: 101 };
    });
    editor();
    expect(await screen.findByRole('alert')).toHaveTextContent('Later unit page unavailable');
    expect(screen.queryByRole('option', { name: 'Unit 0' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save damage draft' })).toBeDisabled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry unit choices' }));
    await screen.findByRole('option', { name: 'Bottle (btl)' });
    expect(screen.getByRole('option', { name: 'Unit 99' })).toBeInTheDocument();
  });
  it('clears dependent references after scope changes and obeys optional directory permissions', async () => {
    editor();
    await fill();
    await screen.findByRole('option', { name: /BATCH-2026-00031/ });
    fireEvent.change(screen.getByLabelText('Linked batch'), { target: { value: 'batch' } });
    fireEvent.change(screen.getByLabelText(/Damage branch/), { target: { value: 'otherbranch' } });
    expect(screen.getByLabelText('Linked batch')).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Damage company/), { target: { value: 'other' } });
    expect(screen.getByLabelText(/Damage branch/)).toHaveValue('');
    expect(screen.getByLabelText(/Damage unit/)).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Damaged product' })).toHaveValue('');
    await waitFor(() =>
      expect(api.page).toHaveBeenCalledWith(
        '/units',
        expect.objectContaining({ query: expect.objectContaining({ companyId: 'other' }) }),
      ),
    );
  });
  it('does not issue lookup requests without their permissions', () => {
    api.permissions = new Set(['stock_damage.create']);
    editor('');
    expect(api.page).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Save damage draft' })).toBeDisabled();
    expect(screen.queryByLabelText('Linked batch')).not.toBeInTheDocument();
  });
});

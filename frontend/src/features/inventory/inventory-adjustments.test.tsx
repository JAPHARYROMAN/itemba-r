import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryAdjustments from './inventory-adjustments';
import { AdjustmentEditor, validAdjustmentQuantity } from './inventory-adjustment-editor';
import { AdjustmentReview } from './inventory-adjustment-review';
import type { StockAdjustment } from './inventory-adjustment-types';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { setDateField } from '@/test/date-field';
const api = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
  permissions: new Set<string>(),
  params: '',
}));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(api.params),
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/inventory',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    loading: false,
    hasPermission: (p: string) => api.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: api.get,
  backendPage: api.page,
  backendPost: api.post,
  backendPatch: api.patch,
  backendDelete: api.remove,
  backendList: async (...args: unknown[]) => (await api.page(...args)).data,
}));
vi.mock('@/lib/report-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/report-export')>()),
  downloadTextFile: api.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: api.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const row: StockAdjustment = {
  id: 'adjustment',
  adjustmentNumber: 'SA-2026-0042',
  companyId: 'company',
  divisionId: 'division',
  branchId: 'branch',
  company: { name: 'Westsides' },
  division: { name: 'Retail' },
  branch: { name: 'Central warehouse' },
  reason: 'Monthly stock count',
  notes: 'Count checked with the receiving team.',
  status: 'APPROVED',
  createdAt: '2026-09-16T09:30:00Z',
  approvedAt: '2026-09-17T10:00:00Z',
  createdBy: { fullName: 'Count operator' },
  approvedBy: { fullName: 'Stock reviewer' },
  _count: { lines: 2 },
  lines: [
    {
      id: 'line1',
      productId: 'milk',
      product: { name: 'Fresh milk', sku: 'MILK-01' },
      unit: { name: 'Litre', symbol: 'L' },
      systemQuantity: '80.1234',
      countedQuantity: '78.0001',
      varianceQuantity: '-2.1233',
      unitCost: 0,
      reason: 'Counted in the cold room.',
    },
    {
      id: 'line2',
      productId: 'oil',
      product: { name: 'Sunflower oil' },
      unit: { name: 'Litre', symbol: 'L' },
      systemQuantity: null,
      countedQuantity: 0,
      varianceQuantity: null,
      unitCost: null,
    },
  ],
};
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const embed = () => (
  <UnsavedWorkProvider>
    <InventoryWorkspaceProvider scope={scope} searchQuery="">
      <InventoryAdjustments />
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
beforeEach(() => {
  vi.resetAllMocks();
  api.params = '';
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  api.permissions = new Set([
    'inventory.view',
    'inventory.adjustments.create',
    'inventory.adjustments.approve',
    'inventory.adjustments.post',
    'products.view',
    'units.view',
    'companies.read',
    'branches.read',
    'divisions.read',
    'inventory.movements.view',
  ]);
  api.get.mockImplementation(async (path) =>
    path === '/stock-adjustments'
      ? {
          data: [row, { ...row, id: 'draft', adjustmentNumber: 'SA-2026-0043', status: 'DRAFT' }],
          total: 121,
        }
      : path === '/stock-adjustments/adjustment'
        ? row
        : { id: 'milk', name: 'Fresh milk', defaultUnitId: 'unit', effectivePurchasePrice: 1200 },
  );
  api.page.mockImplementation(async (path) => ({
    data:
      path === '/inventory-balances'
        ? [{ quantityOnHand: '10.1234' }]
        : path === '/products'
          ? [
              {
                id: 'milk',
                name: 'Fresh milk',
                defaultUnitId: 'unit',
                effectivePurchasePrice: 1200,
              },
            ]
          : path === '/units'
            ? [{ id: 'unit', name: 'Litre', symbol: 'L' }]
            : path === '/branches'
              ? [
                  { id: 'branch', name: 'Central warehouse', divisionId: 'division' },
                  { id: 'other', name: 'Other branch', divisionId: 'division' },
                ]
              : path === '/divisions'
                ? [{ id: 'division', name: 'Retail' }]
                : path === '/companies'
                  ? [
                      { id: 'company', name: 'Westsides' },
                      { id: 'otherco', name: 'Other company' },
                    ]
                  : [row],
    total: 1,
    page: 1,
    limit: 100,
  }));
});
describe('Adjustment register', () => {
  it('restores filters, page and selected ID after app switching while reloading records', async () => {
    const tree = (shown: boolean) => (
      <WorkspaceSessionProvider>{shown && embed()}</WorkspaceSessionProvider>
    );
    const view = render(tree(true));
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    fireEvent.change(screen.getByLabelText('Adjustment status'), { target: { value: 'APPROVED' } });
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect SA-2026-0042' }));
    view.rerender(tree(false));
    api.get.mockResolvedValue({
      data: [{ ...row, notes: 'Freshly updated after app switch' }],
      total: 121,
    });
    view.rerender(tree(true));
    await waitFor(() =>
      expect(screen.getByLabelText('Record details')).toHaveTextContent(
        'Freshly updated after app switch',
      ),
    );
    expect(screen.getByLabelText('Adjustment status')).toHaveValue('APPROVED');
    expect(api.get).toHaveBeenLastCalledWith(
      '/stock-adjustments',
      expect.objectContaining({
        query: expect.objectContaining({ ...scope, page: 2, status: 'APPROVED' }),
      }),
    );
    api.params = 'companyId=otherco&branchId=other&status=DRAFT';
    view.rerender(tree(true));
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    expect(screen.queryByRole('button', { name: 'Close details' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Adjustment status')).toHaveValue('DRAFT');
  });
  it('cancels an obsolete export and applies same-view URL changes', async () => {
    const view = render(<InventoryAdjustments />);
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    const base = api.page.getMockImplementation()!;
    let resolve!: (data: unknown) => void;
    api.page.mockImplementation((path, options) =>
      path === '/stock-adjustments'
        ? new Promise((r) => {
            resolve = r;
          })
        : base(path, options),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(resolve).toBeDefined());
    api.params = 'companyId=otherco&branchId=other&status=DRAFT';
    view.rerender(<InventoryAdjustments />);
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/stock-adjustments',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'otherco',
            branchId: 'other',
            status: 'DRAFT',
            page: 1,
          }),
        }),
      ),
    );
    await act(async () => resolve({ data: [row], total: 1 }));
    expect(api.download).not.toHaveBeenCalled();
  });
  it('fails closed without read permission and enforces the complete PDF limit', async () => {
    api.permissions.clear();
    const view = render(embed());
    expect(api.get).not.toHaveBeenCalled();
    expect(api.page).not.toHaveBeenCalled();
    api.permissions.add('inventory.view');
    view.rerender(embed());
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    api.page.mockResolvedValue({ data: Array.from({ length: 5001 }, () => row), total: 5001 });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('5,000 records');
    expect(api.pdf).not.toHaveBeenCalled();
  });
  it('uses scoped pagination and full date boundaries, suppresses reversed dates and restores filters', async () => {
    render(embed());
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    capture('inventory-adjustments-list');
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect SA-2026-0042' }));
    expect(screen.getByLabelText('Record details')).toHaveTextContent('Retail');
    capture('inventory-adjustments');
    expect(api.get).toHaveBeenCalledWith(
      '/stock-adjustments',
      expect.objectContaining({ query: expect.objectContaining({ ...scope, page: 1, limit: 20 }) }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/stock-adjustments',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    fireEvent.change(screen.getByLabelText('Adjustment status'), { target: { value: 'APPROVED' } });
    await setDateField('Created from (UTC)', '2026-09-01');
    await setDateField('Created through (UTC)', '2026-09-18');
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        '/stock-adjustments',
        expect.objectContaining({
          query: expect.objectContaining({
            page: 1,
            status: 'APPROVED',
            dateFrom: '2026-09-01T00:00:00.000Z',
            dateTo: '2026-09-18T23:59:59.999Z',
          }),
        }),
      ),
    );
    await setDateField('Created from (UTC)', '2026-10-01');
    expect(screen.getByRole('alert')).toHaveTextContent('end date');
    expect(screen.queryByText(row.adjustmentNumber!)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
  });
  it('allows create-only readers and denies unsupported reads and actions', async () => {
    api.permissions = new Set(['inventory.adjustments.create']);
    render(embed());
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    expect(screen.getByRole('button', { name: 'New adjustment' })).toBeInTheDocument();
    expect(api.page).not.toHaveBeenCalled();
  });
  it('removes stale rows on refresh failures and retries the register', async () => {
    render(embed());
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    api.get.mockRejectedValueOnce(new Error('Adjustment service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Adjustment service unavailable');
    expect(screen.queryByText(row.adjustmentNumber!)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
  });
  it('exports all pages and never downloads a partial CSV after a later-page failure', async () => {
    render(embed());
    await screen.findByRole('button', { name: 'Inspect SA-2026-0042' });
    let fail = true;
    api.page.mockImplementation(async (_path, options) => {
      if (options.query.page === 1)
        return {
          data: Array.from({ length: 100 }, (_, i) => ({ ...row, id: `a${i}` })),
          total: 101,
        };
      if (fail) throw new Error('Last page unavailable');
      return { data: [{ ...row, adjustmentNumber: 'LAST-101' }], total: 101 };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Last page unavailable');
    expect(api.download).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(api.download).toHaveBeenCalledOnce());
    expect(api.download.mock.calls[0][2]).toContain('LAST-101');
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(api.pdf).toHaveBeenCalledOnce());
    expect(api.pdf.mock.calls[0][0].rows).toHaveLength(101);
  });
});
describe('Adjustment review', () => {
  it.each([
    ['DRAFT', ['Submit for approval', 'Delete adjustment']],
    ['PENDING_APPROVAL', ['Approve adjustment', 'Reject adjustment']],
    ['APPROVED', ['Post adjustment', 'Revert to draft']],
    ['REJECTED', ['Delete adjustment']],
    ['POSTED', []],
    ['CANCELLED', []],
  ] as [string, string[]][])(
    'matches backend actions for %s and removes them when permission is absent',
    async (status, expected) => {
      api.get.mockResolvedValue({ ...row, status });
      const view = render(
        <AdjustmentReview id="adjustment" onClose={vi.fn()} onChanged={vi.fn()} />,
      );
      await screen.findByText('80.1234');
      const actions = screen.getByLabelText('Adjustment actions');
      expect(
        within(actions)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual([...expected, 'Refresh record']);
      api.permissions = new Set(['inventory.view']);
      view.rerender(<AdjustmentReview id="adjustment" onClose={vi.fn()} onChanged={vi.fn()} />);
      expect(
        within(actions)
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Refresh record']);
    },
  );
  it('recovers failed details and keeps precision, unknown values, units and approval history', async () => {
    api.get.mockRejectedValueOnce(new Error('Detail unavailable'));
    render(
      <UnsavedWorkProvider>
        <AdjustmentReview id="adjustment" onClose={vi.fn()} onChanged={vi.fn()} />
      </UnsavedWorkProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Detail unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry adjustment' }));
    await screen.findByText('80.1234');
    expect(screen.getByText('-2.1233')).toBeInTheDocument();
    expect(screen.getByText(/Stock reviewer/)).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Adjustment lines' })).getAllByText('—'),
    ).toHaveLength(3);
    capture('inventory-adjustment-review');
    expect(screen.queryByRole('button', { name: 'Delete adjustment' })).not.toBeInTheDocument();
  });
  it('requires explicit posting confirmation and retains failed actions for retry', async () => {
    const changed = vi.fn();
    render(
      <UnsavedWorkProvider>
        <AdjustmentReview id="adjustment" onClose={vi.fn()} onChanged={changed} />
      </UnsavedWorkProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Post adjustment' }));
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByText(/create the accounting entries/)).toBeInTheDocument();
    await waitFor(() =>
      expect(
        within(screen.getByRole('dialog', { name: 'Post adjustment' })).getByRole('button', {
          name: 'Post adjustment',
        }),
      ).toBeEnabled(),
    );
    api.patch.mockRejectedValueOnce(new Error('Posting failed'));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Post adjustment' })).getByRole('button', {
        name: 'Post adjustment',
      }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Posting failed');
    expect(changed).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Post adjustment' })).getByRole('button', {
        name: 'Post adjustment',
      }),
    );
    await waitFor(() => expect(changed).toHaveBeenCalledOnce());
    expect(api.patch).toHaveBeenLastCalledWith('/stock-adjustments/adjustment/post', undefined);
  });
  it('retains rejection reason through Stay and sends it only after confirmation', async () => {
    api.get.mockResolvedValue({ ...row, status: 'PENDING_APPROVAL' });
    render(
      <UnsavedWorkProvider>
        <AdjustmentReview id="adjustment" onClose={vi.fn()} onChanged={vi.fn()} />
      </UnsavedWorkProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Reject adjustment' }));
    await waitFor(() => expect(screen.getByLabelText(/Rejection reason/)).toBeEnabled());
    fireEvent.change(screen.getByLabelText(/Rejection reason/), {
      target: { value: 'Please recount the cold room.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Back to review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(screen.getByLabelText(/Rejection reason/)).toHaveValue('Please recount the cold room.');
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Reject adjustment' })).getByRole('button', {
        name: 'Reject adjustment',
      }),
    );
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith('/stock-adjustments/adjustment/reject', {
        reason: 'Please recount the cold room.',
      }),
    );
  });
  it('offers posted movements only with their permission and preserves the record scope', async () => {
    api.get.mockResolvedValue({ ...row, status: 'POSTED' });
    const view = render(<AdjustmentReview id="adjustment" onClose={vi.fn()} onChanged={vi.fn()} />);
    const link = await screen.findByRole('link', { name: 'View stock movements' });
    expect(link).toHaveAttribute('href', expect.stringContaining('branchId=branch'));
    expect(link).toHaveAttribute('href', expect.stringContaining('referenceId=adjustment'));
    api.permissions.delete('inventory.movements.view');
    view.rerender(<AdjustmentReview id="adjustment" onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'View stock movements' })).not.toBeInTheDocument();
  });
});
function editor() {
  const saved = vi.fn(),
    close = vi.fn();
  render(
    <UnsavedWorkProvider>
      <AdjustmentEditor scope={scope} onSaved={saved} onClose={close} />
    </UnsavedWorkProvider>,
  );
  return { saved, close };
}
async function selectProduct(line = 1) {
  await screen.findByRole('option', { name: 'Litre (L)' });
  fireEvent.focus(screen.getByRole('combobox', { name: `Product, line ${line}` }));
  fireEvent.click(
    within(await screen.findByRole('option', { name: /Fresh milk/ })).getByRole('button'),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(new RegExp(`System quantity, line ${line}`))).toHaveValue(10.1234),
  );
}
describe('Adjustment entry', () => {
  it('supports verified manual counts for create-only users without requesting balances', async () => {
    api.permissions.delete('inventory.view');
    editor();
    await screen.findByRole('option', { name: 'Litre (L)' });
    fireEvent.focus(screen.getByRole('combobox', { name: 'Product, line 1' }));
    fireEvent.click(
      within(await screen.findByRole('option', { name: /Fresh milk/ })).getByRole('button'),
    );
    fireEvent.change(screen.getByLabelText(/Adjustment reason/), {
      target: { value: 'Verified count' },
    });
    fireEvent.change(screen.getByLabelText(/System quantity, line 1/), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText(/Counted quantity, line 1/), { target: { value: '0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
    expect(api.page.mock.calls.some(([path]) => path === '/inventory-balances')).toBe(false);
    expect(api.post.mock.calls[0][1].lines[0]).toEqual({
      productId: 'milk',
      unitId: 'unit',
      systemQuantity: 5,
      countedQuantity: 0,
      reason: undefined,
    });
  });
  it('preserves a draft and failed save, then submits precise canonical quantities', async () => {
    const { saved, close } = editor();
    await selectProduct();
    fireEvent.change(screen.getByLabelText(/Adjustment reason/), {
      target: { value: 'Monthly count' },
    });
    fireEvent.change(screen.getByLabelText(/Counted quantity, line 1/), {
      target: { value: '11.0001' },
    });
    capture('inventory-adjustment-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(close).not.toHaveBeenCalled();
    api.post.mockRejectedValueOnce(new Error('Unable to save draft'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(api.post.mock.calls[0]).toEqual(api.post.mock.calls[1]);
    expect(api.post).toHaveBeenLastCalledWith(
      '/stock-adjustments',
      expect.objectContaining({
        ...scope,
        lines: [
          {
            productId: 'milk',
            unitId: 'unit',
            systemQuantity: 10.1234,
            countedQuantity: 11.0001,
            unitCost: 1200,
            reason: undefined,
          },
        ],
      }),
    );
  });
  it('clears counted values and ignores obsolete balances when branch changes', async () => {
    editor();
    await selectProduct();
    const base = api.page.getMockImplementation()!;
    let resolve!: (data: unknown) => void;
    api.page.mockImplementation((path, options) =>
      path === '/inventory-balances'
        ? new Promise((r) => {
            resolve = r;
          })
        : base(path, options),
    );
    fireEvent.change(screen.getByLabelText(/Counted quantity, line 1/), {
      target: { value: '12' },
    });
    fireEvent.change(screen.getByLabelText(/Adjustment branch/), { target: { value: 'other' } });
    expect(screen.getByLabelText(/Counted quantity, line 1/)).toHaveValue(null);
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.change(screen.getByLabelText(/Adjustment company/), { target: { value: 'otherco' } });
    await act(async () => resolve({ data: [{ quantityOnHand: 900 }], total: 1 }));
    expect(screen.getByLabelText(/System quantity, line 1/)).toHaveValue(null);
  });
  it('recovers balance failures without silently treating missing stock as zero', async () => {
    const base = api.page.getMockImplementation()!;
    let fail = true;
    api.page.mockImplementation(async (path, options) => {
      if (path === '/inventory-balances') {
        if (fail) throw new Error('Balance unavailable');
        return { data: [], total: 0 };
      }
      return base(path, options);
    });
    editor();
    await screen.findByRole('option', { name: 'Litre (L)' });
    fireEvent.focus(screen.getByRole('combobox', { name: 'Product, line 1' }));
    fireEvent.click(
      within(await screen.findByRole('option', { name: /Fresh milk/ })).getByRole('button'),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Balance unavailable');
    expect(screen.getByLabelText(/System quantity, line 1/)).toBeDisabled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry balances' }));
    await screen.findByText(/No balance was found/);
    expect(screen.getByLabelText(/System quantity, line 1/)).toHaveValue(null);
    expect(screen.getByLabelText(/System quantity, line 1/)).toBeEnabled();
    for (const value of ['', '-1', 'Infinity', '1.12345', '100000000000000'])
      expect(validAdjustmentQuantity(value)).toBe(false);
    expect(validAdjustmentQuantity('0')).toBe(true);
    expect(validAdjustmentQuantity('-0.0001', true)).toBe(true);
  });
});

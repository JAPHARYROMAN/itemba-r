import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import InventoryMovements, {
  signedMovementQuantity,
  type InventoryMovement,
} from './inventory-movements';
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  list: vi.fn(),
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
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendList: state.list,
}));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: state.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const receipt: InventoryMovement = {
  id: 'receipt',
  movementNumber: 'MOV-00041',
  movementDate: '2026-09-17T23:20:00Z',
  movementType: 'PURCHASE_RECEIPT',
  quantity: 40,
  unitCost: 16000,
  totalCost: 640000,
  productId: 'cement',
  companyId: 'company',
  divisionId: 'division',
  branchId: 'branch',
  unitId: 'bag',
  unit: { name: 'Bag', symbol: 'bag' },
  division: { name: 'Building supplies', code: 'BLD' },
  product: { name: 'Twiga Cement 50kg', productCode: 'CEM-01', sku: 'C50' },
  company: { name: 'Example Company' },
  branch: { name: 'Central warehouse', code: 'HQ' },
  referenceType: 'GoodsReceivedNote',
  referenceId: 'goods-receipt-001',
  referenceNumber: 'GRN-001',
  createdBy: { fullName: 'Amina Salim' },
  notes: 'Received and checked at the central warehouse.',
  batchNumber: 'SEP-26',
  expiryDate: '2027-09-01',
};
const issue: InventoryMovement = {
  ...receipt,
  id: 'issue',
  movementNumber: 'MOV-00042',
  movementType: 'SALE_ISSUE',
  quantity: 5,
  unitCost: 0,
  totalCost: 0,
  product: { name: 'Coral white', productCode: 'P-01' },
  referenceType: 'SalesOrder',
  referenceId: 'sales-001',
  referenceNumber: 'SO-001',
};
const totals = {
  totalMovements: 31,
  totalCost: 1200000,
  byType: [
    { movementType: 'PURCHASE_RECEIPT', count: 19 },
    { movementType: 'SALE_ISSUE', count: 12 },
  ],
};
const embed = (companyId = 'company') => (
  <InventoryWorkspaceProvider
    scope={{ companyId, divisionId: 'division', branchId: 'branch' }}
    searchQuery=""
  >
    <InventoryMovements />
  </InventoryWorkspaceProvider>
);
const loaded = () => screen.findByRole('button', { name: 'Inspect Twiga Cement 50kg' });
const filters = () => fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    document.querySelectorAll('input').forEach((input) => input.setAttribute('value', input.value));
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
}
beforeEach(() => {
  vi.resetAllMocks();
  state.params = '';
  state.loading = false;
  state.permissions = new Set(['inventory.movements.view', 'products.view', 'sales.view']);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  state.get.mockImplementation(async (path: string) =>
    path.endsWith('/summary')
      ? totals
      : path.startsWith('/products/')
        ? { id: 'cement', ...receipt.product }
        : { data: [receipt, issue], total: 31 },
  );
  state.page.mockResolvedValue({ data: [receipt, issue], total: 2 });
  state.list.mockResolvedValue([{ id: 'cement', ...receipt.product }]);
  state.pdf.mockResolvedValue(undefined);
});
describe('Stock movements workspace', () => {
  it('waits for auth and requires movement permission independently of product and source access', async () => {
    state.loading = true;
    const view = render(embed());
    expect(state.get).not.toHaveBeenCalled();
    state.loading = false;
    state.permissions.clear();
    view.rerender(embed());
    await screen.findByText('Permission required');
    expect(state.get).not.toHaveBeenCalled();
    state.permissions.add('inventory.movements.view');
    view.rerender(embed());
    fireEvent.click(await loaded());
    expect(screen.queryByRole('link', { name: 'Open product' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Coral white' }));
    expect(screen.queryByRole('link', { name: 'Open sales order' })).not.toBeInTheDocument();
    filters();
    expect(screen.queryByRole('combobox', { name: 'Filter by product' })).not.toBeInTheDocument();
    expect(state.list).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('shows complete filtered totals and preserves costs, direction, source, dates and inspector details', async () => {
    render(embed());
    fireEvent.click(await loaded());
    const summary = screen.getByLabelText('Filtered movement summary');
    for (const text of ['31', '19', '12', 'TZS 1,200,000.00'])
      expect(within(summary).getByText(text)).toBeVisible();
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    for (const text of [
      '+40',
      'Inbound',
      'Bag (bag)',
      'BLD · Building supplies',
      'TZS 16,000.00',
      'HQ · Central warehouse',
      'GRN-001',
      'goods-receipt-001',
      'Goods Received Note',
      'Amina Salim',
      'SEP-26',
      '01 Sept 2027',
      receipt.notes!,
    ])
      expect(within(detail).getByText(text)).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open product' })).toHaveAttribute(
      'href',
      '/inventory/products/cement?companyId=company&divisionId=division&branchId=branch',
    );
    capture('inventory-movements-details');
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    capture('inventory-movements');
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Coral white' }));
    expect(within(detail).getByText('−5')).toBeVisible();
    expect(within(detail).getAllByText('TZS 0.00')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open sales order' })).toHaveAttribute(
      'href',
      '/operations/sales-orders/sales-001',
    );
    expect(signedMovementQuantity({ quantity: null, movementType: 'SALE_ISSUE' })).toBe('—');
    expect(signedMovementQuantity({ quantity: 0, movementType: 'OTHER' })).toBe('0');
    expect(signedMovementQuantity({ quantity: 5, movementType: 'OTHER' })).toBe('5');
    fireEvent.click(screen.getByRole('button', { name: 'Same source' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/inventory-movements',
        expect.objectContaining({
          query: expect.objectContaining({
            referenceType: 'SalesOrder',
            referenceId: 'sales-001',
            page: 1,
          }),
        }),
      ),
    );
  });
  it('combines product, source, type, dates and scope; pagination leaves totals unpaged', async () => {
    render(embed());
    await loaded();
    filters();
    fireEvent.focus(screen.getByRole('combobox', { name: 'Filter by product' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by product' }), {
      target: { value: 'Twiga' },
    });
    await screen.findByRole('option', { name: /Twiga Cement/ });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Filter by product' }), {
      key: 'Enter',
    });
    fireEvent.change(screen.getByLabelText('Movement type'), {
      target: { value: 'PURCHASE_RECEIPT' },
    });
    await setDateField('From date', '2026-09-01');
    await setDateField('To date', '2026-09-18');
    fireEvent.change(screen.getByLabelText('Source type'), {
      target: { value: 'GoodsReceivedNote' },
    });
    fireEvent.change(screen.getByLabelText('Source ID'), {
      target: { value: 'goods-receipt-001' },
    });
    await loaded();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/inventory-movements',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'company',
            divisionId: 'division',
            branchId: 'branch',
            productId: 'cement',
            movementType: 'PURCHASE_RECEIPT',
            referenceType: 'GoodsReceivedNote',
            referenceId: 'goods-receipt-001',
            dateFrom: '2026-09-01',
            dateTo: '2026-09-18',
            page: 2,
            limit: 20,
          }),
        }),
      ),
    );
    expect(
      state.get.mock.calls.filter(([path]) => path.endsWith('/summary')).at(-1)![1].query,
    ).not.toHaveProperty('page');
    capture('inventory-movements-filters');
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    await loaded();
    expect(dateFieldValue(getDateField('From date'))).toBe('');
    expect(screen.getByLabelText('Source ID')).toHaveValue('');
  });
  it('honours initial legacy URLs and subsequent same-view deep links without unscoped reads', async () => {
    state.params =
      'companyId=company&divisionId=division&locationId=branch&productId=cement&referenceType=SalesOrder&referenceId=sales-001';
    const view = render(<InventoryMovements />);
    await loaded();
    expect(
      state.get.mock.calls.find(([path]) => path === '/inventory-movements')![1].query,
    ).toMatchObject({
      companyId: 'company',
      divisionId: 'division',
      branchId: 'branch',
      productId: 'cement',
      referenceType: 'SalesOrder',
      referenceId: 'sales-001',
    });
    state.params = 'companyId=second&productId=paint';
    view.rerender(<InventoryMovements />);
    await loaded();
    expect(
      state.get.mock.calls.filter(([path]) => path === '/inventory-movements').at(-1)![1].query,
    ).toMatchObject({
      companyId: 'second',
      productId: 'paint',
      branchId: '',
      referenceId: '',
      page: 1,
    });
  });
  it('rejects reversed dates and recovers without displaying obsolete totals', async () => {
    render(embed());
    await loaded();
    filters();
    await setDateField('From date', '2026-09-18');
    await loaded();
    const before = state.get.mock.calls.length;
    await setDateField('To date', '2026-09-01');
    await screen.findByText('From date must be on or before To date.');
    expect(state.get).toHaveBeenCalledTimes(before);
    expect(screen.queryByLabelText('Filtered movement summary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    await setDateField('To date', '2026-09-18');
    await loaded();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('retries summary and register failures independently, never disguising them as zero or empty', async () => {
    state.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/summary')) throw new Error('Totals unavailable');
      return { data: [receipt], total: 1 };
    });
    render(embed());
    await loaded();
    await screen.findByText('Totals unavailable');
    expect(screen.queryByLabelText('Filtered movement summary')).not.toBeInTheDocument();
    state.get.mockResolvedValue(totals);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('Filtered movement summary');
    state.get.mockImplementation(async (path: string) => {
      if (path === '/inventory-movements') throw new Error('Ledger unavailable');
      return totals;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh movements' }));
    await screen.findByText('Ledger unavailable');
    expect(screen.queryByText(/No movements match/)).not.toBeInTheDocument();
    state.get.mockResolvedValue({ data: [receipt], total: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
  });
  it('ignores obsolete records and clears local product filters when the workspace scope changes', async () => {
    const view = render(embed());
    await loaded();
    filters();
    let resolve!: (value: unknown) => void;
    state.get.mockImplementation((path: string) =>
      path.endsWith('/summary')
        ? Promise.resolve(totals)
        : new Promise((r) => {
            resolve = r;
          }),
    );
    fireEvent.change(screen.getByLabelText('Movement type'), { target: { value: 'SALE_ISSUE' } });
    const signal = state.get.mock.calls
      .filter(([path]) => path === '/inventory-movements')
      .at(-1)![1].signal;
    state.get.mockImplementation(async (path: string) =>
      path.endsWith('/summary') ? totals : { data: [], total: 0 },
    );
    view.rerender(embed('second'));
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: [receipt], total: 1 }));
    await screen.findByText(/No movements match/);
    expect(screen.queryByRole('button', { name: /Inspect Twiga/ })).not.toBeInTheDocument();
  });
  it('exports every matching page with all facts and never downloads a partial failed export', async () => {
    render(embed());
    await loaded();
    state.page.mockImplementation(async (_path: string, { query }: { query: { page: number } }) => {
      if (query.page === 2) throw new Error('Later page unavailable');
      return { data: [receipt], total: 2 };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await screen.findByText('Later page unavailable');
    expect(state.download).not.toHaveBeenCalled();
    state.page.mockImplementation(
      async (_path: string, { query }: { query: { page: number } }) => ({
        data: query.page === 1 ? [receipt] : [issue],
        total: 2,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(state.download).toHaveBeenCalledTimes(1));
    for (const value of [
      'Twiga Cement',
      'Coral white',
      'Inbound',
      'Outbound',
      'goods-receipt-001',
      'SEP-26',
      'Amina Salim',
    ])
      expect(state.download.mock.calls[0][2]).toContain(value);
    state.pdf.mockRejectedValueOnce(new Error('PDF unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByText('PDF unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() => expect(state.pdf).toHaveBeenCalledTimes(2));
    expect(state.pdf.mock.calls[1][0].rows).toHaveLength(2);
    expect(state.pdf.mock.calls[1][0].columns).toContain('Unit cost');
  });
  it('cancels exports when filters change and explicitly refuses more than 5,000 PDF records', async () => {
    render(embed());
    await loaded();
    filters();
    let resolve!: (value: unknown) => void;
    state.page.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const signal = state.page.mock.calls.at(-1)![1].signal;
    fireEvent.change(screen.getByLabelText('Movement type'), { target: { value: 'OTHER' } });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: [receipt], total: 1 }));
    expect(state.download).not.toHaveBeenCalled();
    await loaded();
    state.page.mockResolvedValue({
      data: Array.from({ length: 5001 }, (_, i) => ({ ...receipt, id: String(i) })),
      total: 5001,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByText(/PDF supports up to 5,000 records. Narrow/);
    expect(state.pdf).not.toHaveBeenCalled();
  });
});

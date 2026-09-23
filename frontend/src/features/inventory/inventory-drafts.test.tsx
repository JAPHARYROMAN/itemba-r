import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InventoryDraftWorkspace, useInventoryDraftEditor } from './inventory-drafts';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
  useUnsavedWork,
} from '@/components/workspace/unsaved-work-provider';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';

const api = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  saved: vi.fn(),
  balance: '10',
  denied: new Set<string>(),
  params: '',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(api.params),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company', permissions: ['inventory'] },
    loading: false,
    hasPermission: (permission: string) => !api.denied.has(permission),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: api.get,
  backendPage: api.page,
  backendPost: api.post,
  backendList: async (...args: unknown[]) => (await api.page(...args)).data,
}));
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const product = {
  id: 'milk',
  name: 'Fresh milk',
  defaultUnitId: 'unit',
  effectivePurchasePrice: 12,
};
function Controls({ kind }: { kind: 'adjustment' | 'batch' | 'damage' }) {
  const editor = useInventoryDraftEditor(kind, scope, 'milk', api.saved);
  return (
    <>
      <button onClick={editor.open}>Start {kind}</button>
      {editor.drafts}
    </>
  );
}
function Workspace() {
  const [shown, setShown] = useState(true);
  const { request } = useUnsavedWork();
  return (
    <>
      <button
        onClick={() => request(() => setShown(!shown), undefined, 'close', { scope: 'inventory' })}
      >
        Switch app
      </button>
      <UnsavedWorkScope id="inventory">
        {shown ? (
          <InventoryDraftWorkspace onSaved={api.saved}>
            <Controls kind="adjustment" />
            <Controls kind="batch" />
            <Controls kind="damage" />
          </InventoryDraftWorkspace>
        ) : (
          <p>Other app</p>
        )}
      </UnsavedWorkScope>
    </>
  );
}
function App({ legacy = false }: { legacy?: boolean }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          {legacy ? <Controls kind="damage" /> : <Workspace />}
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  api.balance = '10';
  api.denied = new Set();
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  api.get.mockResolvedValue(product);
  api.post.mockResolvedValue({ id: 'saved' });
  api.page.mockImplementation(async (path: string) => {
    const rows: Record<string, unknown[]> = {
      '/companies': [
        { id: 'company', name: 'Westsides' },
        { id: 'other', name: 'Other company' },
      ],
      '/divisions': [{ id: 'division', name: 'Retail' }],
      '/branches': [{ id: 'branch', name: 'Central warehouse', divisionId: 'division' }],
      '/units': [{ id: 'unit', name: 'Litre', symbol: 'L' }],
      '/suppliers': [{ id: 'supplier', name: 'Dairy' }],
      '/products': [product],
      '/westsides/product-batches': [
        {
          id: 'batch',
          batchNumber: 'BATCH-2026-31',
          unitId: 'unit',
          status: 'ACTIVE',
          remainingQuantity: '10',
        },
      ],
      '/inventory-balances': [{ quantityOnHand: api.balance }],
    };
    const data = rows[path] ?? [];
    return { data, total: data.length, page: 1, limit: 100 };
  });
});
async function beginCount() {
  fireEvent.click(screen.getByRole('button', { name: 'Start adjustment' }));
  await screen.findByRole('option', { name: 'Litre (L)' });
  fireEvent.focus(screen.getByRole('combobox', { name: 'Product, line 1' }));
  fireEvent.click(
    within(await screen.findByRole('option', { name: /Fresh milk/ })).getByRole('button'),
  );
  await waitFor(() => expect(screen.getByLabelText(/System quantity, line 1/)).toHaveValue(10));
  fireEvent.change(screen.getByLabelText(/Adjustment reason/), {
    target: { value: 'Branch stock count' },
  });
  fireEvent.change(screen.getByLabelText(/Counted quantity, line 1/), { target: { value: '8' } });
}
async function returnToDraft(title: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Switch app' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Keep draft and continue' }));
  expect(screen.getByText('Other app')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Switch app' }));
  fireEvent.click(await screen.findByRole('button', { name: `Resume ${title}` }));
}

describe('Inventory session drafts', () => {
  it('shares one kept count between Inventory and the legacy ERP register without duplicate editors', async () => {
    render(
      <WorkspaceSessionProvider>
        <UnsavedWorkProvider>
          <WorkspaceDraftsProvider>
            <UnsavedWorkScope id="inventory">
              <section aria-label="Inventory app">
                <InventoryDraftWorkspace onSaved={api.saved}>
                  <Controls kind="adjustment" />
                </InventoryDraftWorkspace>
              </section>
            </UnsavedWorkScope>
            <UnsavedWorkScope id="erp">
              <section aria-label="ERP register">
                <Controls kind="adjustment" />
              </section>
            </UnsavedWorkScope>
          </WorkspaceDraftsProvider>
        </UnsavedWorkProvider>
      </WorkspaceSessionProvider>,
    );
    const inventory = within(screen.getByLabelText('Inventory app'));
    const erp = within(screen.getByLabelText('ERP register'));
    fireEvent.click(inventory.getByRole('button', { name: 'Start adjustment' }));
    await screen.findByRole('option', { name: 'Litre (L)' });
    fireEvent.change(screen.getByLabelText(/Adjustment reason/), {
      target: { value: 'Shared stock count' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    fireEvent.click(inventory.getByRole('button', { name: 'Resume Stock count' }));
    await screen.findByLabelText(/Adjustment reason/);
    expect(erp.getByRole('button', { name: 'Resume Stock count' })).toBeDisabled();
    expect(erp.getByRole('button', { name: 'Discard Stock count' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Adjustment reason/), {
      target: { value: 'Updated count notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    fireEvent.click(erp.getByRole('button', { name: 'Resume Stock count' }));
    expect(await screen.findByLabelText(/Adjustment reason/)).toHaveValue('Updated count notes');
    expect(screen.getAllByRole('dialog', { name: 'New stock adjustment' })).toHaveLength(1);
    expect(api.post).not.toHaveBeenCalled();
  });
  it('reloads a changed balance, preserves the count and requires explicit review before saving', async () => {
    render(<App />);
    await beginCount();
    api.balance = '12';
    await returnToDraft('Stock count');
    await waitFor(() => expect(screen.getByLabelText(/System quantity, line 1/)).toHaveValue(12));
    expect(screen.getByLabelText(/Counted quantity, line 1/)).toHaveValue(8);
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review the latest record');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox'));
    api.post.mockRejectedValueOnce(new Error('Stock service unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Stock service unavailable');
    expect(screen.getByLabelText(/Counted quantity, line 1/)).toHaveValue(8);
    fireEvent.click(screen.getByRole('button', { name: 'Save draft', exact: true }));
    await waitFor(() => expect(api.saved).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenLastCalledWith(
      '/stock-adjustments',
      expect.objectContaining({
        ...scope,
        lines: [
          expect.objectContaining({ productId: 'milk', systemQuantity: 12, countedQuantity: 8 }),
        ],
      }),
    );
    expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument();
  });
  it('keeps an outstanding balance review across a second keep and lets resumed lines be edited independently', async () => {
    render(<App />);
    await beginCount();
    fireEvent.click(screen.getByRole('button', { name: 'Add product line' }));
    fireEvent.change(screen.getByLabelText(/Line reason, line 2/), {
      target: { value: 'Second item' },
    });
    api.balance = '15';
    await returnToDraft('Stock count');
    await screen.findByRole('checkbox');
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume Stock count' }));
    await screen.findByRole('checkbox');
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Add product line' }));
    fireEvent.change(screen.getByLabelText(/Line reason, line 3/), {
      target: { value: 'Third item' },
    });
    expect(screen.getByLabelText(/Line reason, line 2/)).toHaveValue('Second item');
    expect(screen.getByLabelText(/Line reason, line 3/)).toHaveValue('Third item');
    expect(api.post).not.toHaveBeenCalled();
  });
  it('resumes batch quantities, supplier and dates after app unmount without creating a batch', async () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Start batch' }));
    await screen.findByRole('option', { name: 'Litre (L)' });
    fireEvent.change(screen.getByLabelText(/Batch unit/), { target: { value: 'unit' } });
    fireEvent.change(screen.getByLabelText(/Initial quantity/), { target: { value: '12.3456' } });
    fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'supplier' } });
    await setDateField('Expiry date', '2026-12-01');
    await returnToDraft('Stock batch');
    await screen.findByRole('option', { name: 'Litre (L)' });
    expect(screen.getByLabelText(/Initial quantity/)).toHaveValue(12.3456);
    expect(screen.getByLabelText('Supplier')).toHaveValue('supplier');
    expect(dateFieldValue(getDateField('Expiry date'))).toBe('2026-12-01');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create batch', exact: true }));
    await waitFor(() => expect(api.saved).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenLastCalledWith(
      '/westsides/product-batches',
      expect.objectContaining({
        companyId: 'company',
        branchId: 'branch',
        initialQuantity: 12.3456,
        supplierId: 'supplier',
        expiryDate: '2026-12-01',
      }),
    );
    expect(screen.queryByLabelText('Unfinished drafts')).not.toBeInTheDocument();
  });
  it('retains a damage report on legacy routes and requires a currently available batch to save', async () => {
    render(<App legacy />);
    fireEvent.click(screen.getByRole('button', { name: 'Start damage' }));
    await screen.findByRole('option', { name: /BATCH-2026-31/ });
    fireEvent.change(screen.getByLabelText(/Damage unit/), { target: { value: 'unit' } });
    fireEvent.change(screen.getByLabelText(/Damaged quantity/), { target: { value: '2.0001' } });
    fireEvent.change(screen.getByLabelText('Linked batch'), { target: { value: 'batch' } });
    fireEvent.change(screen.getByLabelText('Estimated total value (TZS)'), {
      target: { value: '0' },
    });
    fireEvent.change(screen.getByLabelText('Damage notes'), {
      target: { value: 'Broken in transit' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    const base = api.page.getMockImplementation()!;
    api.page.mockImplementation((path, options) =>
      path === '/westsides/product-batches'
        ? Promise.resolve({ data: [], total: 0 })
        : base(path, options),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Resume Stock damage' }));
    await screen.findByRole('option', { name: 'Litre (L)' });
    expect(screen.getByLabelText('Damage notes')).toHaveValue('Broken in transit');
    expect(screen.getByLabelText('Estimated total value (TZS)')).toHaveValue(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save damage draft' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Load and select a batch');
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Linked batch'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save damage draft' }));
    await waitFor(() => expect(api.saved).toHaveBeenCalledOnce());
    expect(api.post).toHaveBeenLastCalledWith(
      '/westsides/stock-damage',
      expect.objectContaining({ quantity: 2.0001, estimatedValue: 0, notes: 'Broken in transit' }),
    );
  });
  it('checks current create access before resuming a kept draft', async () => {
    render(<App />);
    await beginCount();
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    api.denied.add('inventory.adjustments.create');
    fireEvent.click(screen.getByRole('button', { name: 'Resume Stock count' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current role cannot open');
    expect(screen.queryByRole('dialog', { name: 'New stock adjustment' })).not.toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('requires review if the draft was kept while the original stock balance was still loading', async () => {
    render(<App />);
    await beginCount();
    const base = api.page.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    api.page.mockImplementation((path, options) =>
      path === '/inventory-balances'
        ? new Promise((done) => {
            resolve = done;
          })
        : base(path, options),
    );
    // Adding a line refreshes the selected products' stock data.
    fireEvent.click(screen.getByRole('button', { name: 'Add product line' }));
    await waitFor(() => expect(resolve).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    api.page.mockImplementation(base);
    fireEvent.click(screen.getByRole('button', { name: 'Resume Stock count' }));
    expect(await screen.findByRole('checkbox')).not.toBeChecked();
    await act(async () => resolve({ data: [{ quantityOnHand: 500 }], total: 1 }));
    expect(screen.getByLabelText(/System quantity, line 1/)).toHaveValue(10);
    expect(api.post).not.toHaveBeenCalled();
  });
});

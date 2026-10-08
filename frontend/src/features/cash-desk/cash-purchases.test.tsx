import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chooseSelectOption,
  findSelectField,
  getSelectField,
  selectFieldOptions,
  selectFieldValue,
} from '@/test/select-field';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { CashEditor } from './cash-editor';
import { CashDesk } from './cash-desk';
import {
  exactAmount,
  type Account,
  type Movement,
  type PurchaseOption,
  type PurchaseOptions,
} from './types';
const h = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  list: vi.fn(),
  saved: vi.fn(),
  permissions: new Set<string>(),
  rows: [] as PurchaseOption[],
  current: null as PurchaseOption | null,
  orderMatches: [] as NonNullable<PurchaseOptions['orderMatches']>,
  navigation: { push: vi.fn(), replace: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => h.navigation,
  usePathname: () => '/cash-desk',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (...keys: string[]) => keys.every((key) => h.permissions.has(key)),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: h.get,
  backendPost: h.post,
  backendList: h.list,
  buildQuery: (query: Record<string, unknown>) =>
    `?${new URLSearchParams(Object.entries(query).map(([key, value]) => [key, String(value)]))}`,
}));
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const directory = {
  companies: [{ id: 'company', name: 'Company' }],
  divisions: [{ id: 'division', name: 'Division', companyId: 'company' }],
  branches: [{ id: 'branch', name: 'Branch', divisionId: 'division', companyId: 'company' }],
};
const account: Account = {
  ...scope,
  id: 'till',
  name: 'Main till',
  kind: 'CASH',
  currency: 'TZS',
  balance: '9999999999999999.99',
  openingDate: '2026-01-01',
  company: { name: 'Company' },
  division: { name: 'Division' },
  branch: { name: 'Branch' },
};
const otherAccount: Account = {
  ...account,
  id: 'usd',
  name: 'USD bank',
  currency: 'USD',
  companyId: 'other',
};
const supplier = { id: 'supplier', name: 'Supplier A' };
const purchase: PurchaseOption = {
  source: 'PAYABLE',
  id: 'payable',
  number: 'PUR-001',
  supplierId: supplier.id,
  supplierName: supplier.name,
  currency: 'TZS',
  outstanding: '9999999999999999.99',
  status: 'OPEN',
  canPay: true,
  businessDate: '2026-01-02',
  payableNumber: 'PAY-001',
  purchaseInvoiceId: 'invoice-business',
  purchaseInvoiceNumber: 'PUR-001',
  purchaseOrderId: 'order',
  purchaseOrderNumber: 'PO-001',
  goodsReceivedNoteId: 'receipt',
  goodsReceivedNoteNumber: 'GRN-001',
};
const desk: PurchaseOption = {
  ...purchase,
  source: 'INVOICE_DESK',
  id: 'desk-invoice',
  number: 'DIRECT-001',
  version: 8,
  purchaseInvoiceId: undefined,
  purchaseInvoiceNumber: undefined,
};
beforeEach(() => {
  vi.clearAllMocks();
  h.permissions = new Set([
    'cash_desk.view',
    'cash_desk.record',
    'cash_desk.reverse',
    'suppliers.view',
    'supplier-payments.view',
    'supplier-payments.manage',
    'payables.view',
    'invoice_desk.view',
    'invoice_desk.payments',
    'supplier_invoices.view',
    'purchases.view',
    'grn.list',
  ]);
  h.rows = [purchase, desk];
  h.current = null;
  h.orderMatches = [];
  h.post.mockReset();
  h.post.mockResolvedValue({ id: 'saved' });
  h.list.mockResolvedValue([supplier, { id: 'supplier-b', name: 'Supplier B' }]);
  h.get.mockReset();
  h.get.mockImplementation(
    async (path: string, options?: { query?: Record<string, string | number> }) => {
      if (path === '/cash-desk/purchase-options') {
        const q = options?.query ?? {};
        const rows = q.id
          ? ([h.current ?? h.rows.find((row) => row.id === q.id && row.source === q.source)].filter(
              Boolean,
            ) as PurchaseOption[])
          : h.rows.filter(
              (row) =>
                row.supplierId === q.supplierId &&
                row.canPay &&
                (!q.search ||
                  [
                    row.number,
                    row.purchaseOrderNumber,
                    row.internalInvoiceNumber,
                    row.supplierInvoiceNumber,
                  ].some((number) =>
                    number?.toLowerCase().includes(String(q.search).trim().toLowerCase()),
                  )),
            );
        const page = Number(q.page ?? 1),
          pageSize = 20;
        return {
          rows: q.id ? rows : rows.slice((page - 1) * pageSize, page * pageSize),
          total: rows.length,
          page,
          pageSize,
          totalPages: Math.ceil(rows.length / pageSize),
          orderMatches: q.search ? h.orderMatches : [],
        };
      }
      if (path.startsWith('/suppliers/'))
        return path.endsWith('supplier-b') ? { id: 'supplier-b', name: 'Supplier B' } : supplier;
      if (path.endsWith('/directory')) return directory;
      if (path.endsWith('/accounts')) return [account, otherAccount];
      if (path === '/cash-desk/overview') return { currencies: [] };
      if (path === '/invoice-desk/overview') return { currencies: [], suppliers: [] };
      return { rows: [], total: 0, page: 1, pageSize: 25 };
    },
  );
});
function Editor() {
  return (
    <CashEditor
      editor={{ kind: 'movement', movementKind: 'SUPPLIER_PAYMENT' }}
      accounts={[account, otherAccount]}
      directory={directory}
      scope={scope}
      onClose={vi.fn()}
      onSaved={h.saved}
    />
  );
}
async function pickSupplier(name = 'Supplier A') {
  const input = screen.getByRole('combobox', { name: /Supplier/ });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: name } });
  const option = await screen.findByText(name);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}
async function selectPurchase(row = purchase) {
  await chooseSelectOption('Paying account', 'till');
  await pickSupplier();
  await findSelectField('Purchase or invoice');
  await chooseSelectOption('Purchase or invoice', `${row.source}:${row.id}`);
  await waitFor(() =>
    expect(screen.queryByText('Checking the selected purchase…')).not.toBeInTheDocument(),
  );
}
function submit() {
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
}

it('offers a received legacy cash PO as an unrecorded payment and explains that its stock is already received', async () => {
  const legacy: PurchaseOption = {
    ...purchase,
    source: 'PURCHASE_ORDER',
    id: 'cash-order',
    purpose: 'CASH_PURCHASE_SETTLEMENT',
    status: 'RECEIVED',
    outstanding: '9880000.00',
    number: 'ITEMBA-INV-005',
  };
  h.permissions.add('purchases.view');
  h.rows = [legacy];
  h.current = legacy;
  render(<Editor />);
  await selectPurchase(legacy);
  expect(
    screen.getByText(/Goods are already received. Record the actual cash payment here/),
  ).toBeInTheDocument();
  expect(
    selectFieldOptions(getSelectField('Purchase or invoice')).some((label) =>
      label.includes('Cash payment not recorded'),
    ),
  ).toBe(true);
  expect(h.post).not.toHaveBeenCalled();
});
function App() {
  return (
    <UnsavedWorkProvider>
      <WorkspaceDraftsProvider>
        <CashDesk />
      </WorkspaceDraftsProvider>
    </UnsavedWorkProvider>
  );
}
async function start() {
  await screen.findByRole('button', { name: 'Movements', exact: true });
  fireEvent.click(screen.getByRole('button', { name: 'Movements', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: 'Record movement', exact: true }));
  await chooseSelectOption(
    getSelectField('Movement type', screen.getByRole('dialog')),
    'SUPPLIER_PAYMENT',
  );
}
describe('Cash Desk purchase payments', () => {
  it.each(['PINV-2026-000001', 'PO-001', 'SUP-123'])(
    'finds an existing purchase by %s and pays its linked payable',
    async (search) => {
      h.rows = [
        {
          ...purchase,
          internalInvoiceNumber: 'PINV-2026-000001',
          supplierInvoiceNumber: 'SUP-123',
        },
      ];
      render(<Editor />);
      await chooseSelectOption('Paying account', 'till');
      await pickSupplier();
      fireEvent.change(screen.getByLabelText('Invoice number or PO number'), {
        target: { value: search },
      });
      await waitFor(() =>
        expect(h.get).toHaveBeenCalledWith(
          '/cash-desk/purchase-options',
          expect.objectContaining({ query: expect.objectContaining({ search }) }),
        ),
      );
      await findSelectField('Purchase or invoice');
      expect(selectFieldOptions(getSelectField('Purchase or invoice')).join(' ')).toContain(
        'PINV-2026-000001',
      );
      await chooseSelectOption('Purchase or invoice', 'PAYABLE:payable');
      await waitFor(() =>
        expect(screen.queryByText('Checking the selected purchase…')).not.toBeInTheDocument(),
      );
      submit();
      await waitFor(() => expect(h.post).toHaveBeenCalledOnce());
      expect(h.post.mock.calls[0][1]).toMatchObject({
        payableId: 'payable',
        supplierId: 'supplier',
      });
    },
  );
  it('finds a draft PO and explains confirmation without posting payment', async () => {
    h.rows = [];
    h.orderMatches = [
      {
        id: 'pending-order',
        purchaseOrderNumber: 'PO-58',
        internalInvoiceNumber: 'PINV-2026-000001',
        status: 'DRAFT',
        paymentStatus: 'UNPAID',
        purchaseType: 'STOCK_PURCHASE',
      },
    ];
    render(<Editor />);
    await chooseSelectOption('Paying account', 'till');
    await pickSupplier();
    fireEvent.change(screen.getByLabelText('Invoice number or PO number'), {
      target: { value: 'PINV-2026-000001' },
    });
    expect(
      await screen.findByText(/Confirm this purchase order before recording a supplier advance/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /PO-58/ })).toHaveAttribute(
      'href',
      '/operations/purchase-orders/pending-order',
    );
    expect(screen.queryByText(/No open purchases or invoices match/)).not.toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });
  it('records a confirmed PO as an advance without creating an invoice or payable target', async () => {
    const advance: PurchaseOption = {
      ...purchase,
      source: 'PURCHASE_ORDER',
      id: 'pending-order',
      number: 'PINV-2026-000001',
      purchaseOrderId: 'pending-order',
      status: 'CONFIRMED',
      outstanding: '1000.00',
    };
    h.rows = [advance];
    render(<Editor />);
    await selectPurchase(advance);
    expect(screen.getByText(/Supplier advance: cash is paid now/)).toBeInTheDocument();
    submit();
    await waitFor(() => expect(h.saved).toHaveBeenCalledOnce());
    expect(h.post.mock.calls[0][1]).toMatchObject({
      purchaseOrderId: 'pending-order',
      supplierId: 'supplier',
      amount: '1000.00',
    });
    expect(h.post.mock.calls[0][1]).not.toHaveProperty('payableId');
    expect(h.post.mock.calls[0][1]).not.toHaveProperty('invoiceId');
  });
  it.each([purchase, desk])(
    'pays existing $source from the chosen desk account with exact decimal strings',
    async (row) => {
      render(<Editor />);
      await selectPurchase(row);
      submit();
      await waitFor(() => expect(h.saved).toHaveBeenCalledOnce());
      expect(h.post).toHaveBeenCalledOnce();
      expect(h.post).toHaveBeenCalledWith(
        '/cash-desk/movements',
        expect.objectContaining({
          kind: 'SUPPLIER_PAYMENT',
          accountId: 'till',
          supplierId: 'supplier',
          amount: '9999999999999999.99',
          ...(row.source === 'PAYABLE'
            ? { payableId: 'payable' }
            : { invoiceId: 'desk-invoice', invoiceVersion: 8 }),
        }),
      );
      expect(h.post.mock.calls[0][1]).not.toHaveProperty(
        row.source === 'PAYABLE' ? 'invoiceId' : 'payableId',
      );
      expect(h.post.mock.calls[0][1]).not.toHaveProperty('cashAccountId');
    },
  );
  it('offers Purchases only with supplier and document payment access', async () => {
    h.permissions.delete('suppliers.view');
    render(<Editor />);
    expect(selectFieldOptions(getSelectField('Movement type'))).not.toContain('Purchases');
    expect(h.get).not.toHaveBeenCalledWith('/cash-desk/purchase-options', expect.anything());
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('Purchase payment access');
    expect(h.post).not.toHaveBeenCalled();
  });
  it('rejects overpayment before creating a request and leaves the purchase editable', async () => {
    h.rows = [{ ...purchase, outstanding: '100.01' }];
    render(<Editor />);
    await selectPurchase();
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '100.02' } });
    submit();
    expect(await screen.findByRole('alert')).toHaveTextContent('outstanding balance');
    expect(h.post).not.toHaveBeenCalled();
    expect(getSelectField('Paying account')).toBeEnabled();
    expect(screen.getByLabelText(/Amount/)).not.toHaveAttribute('readonly');
  });
  it.each([
    { ...desk, version: undefined },
    { ...desk, canPay: false, status: 'PAID', outstanding: '0.00' },
  ])(
    'rejects a first invoice payment without a payable current version/state ($status, version=$version)',
    async (current) => {
      h.current = current;
      render(<Editor />);
      await selectPurchase(desk);
      submit();
      await waitFor(() =>
        expect(
          screen
            .getAllByRole('alert')
            .some((alert) =>
              /invoice version is unavailable|no longer available for payment/.test(
                alert.textContent ?? '',
              ),
            ),
        ).toBe(true),
      );
      expect(h.post).not.toHaveBeenCalled();
      expect(getSelectField('Paying account')).toBeEnabled();
    },
  );
  it('clears the supplier and document when the account scope or currency changes', async () => {
    render(<Editor />);
    await selectPurchase();
    await chooseSelectOption('Paying account', 'usd');
    expect(screen.getByRole('combobox', { name: /Supplier/ })).toHaveValue('');
    expect(screen.queryByRole('link', { name: 'View payable' })).not.toBeInTheDocument();
    submit();
    expect(h.post).not.toHaveBeenCalled();
  });
  it('paginates scoped candidates and resets the page on search', async () => {
    h.rows = Array.from({ length: 21 }, (_, i) => ({
      ...purchase,
      id: `payable-${i + 1}`,
      number: `PUR-${i + 1}`,
    }));
    render(<Editor />);
    await chooseSelectOption('Paying account', 'till');
    await pickSupplier();
    await findSelectField('Purchase or invoice');
    fireEvent.click(screen.getByRole('button', { name: 'Next purchases' }));
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/cash-desk/purchase-options',
        expect.objectContaining({
          query: expect.objectContaining({
            accountId: 'till',
            supplierId: 'supplier',
            page: 2,
            pageSize: 20,
          }),
        }),
      ),
    );
    await findSelectField('Purchase or invoice');
    expect(selectFieldOptions(getSelectField('Purchase or invoice'))).toContain(
      'PUR-21 · PO-001 · Purchase payable · TZS 9,999,999,999,999,999.99 outstanding',
    );
    fireEvent.change(screen.getByLabelText('Invoice number or PO number'), {
      target: { value: 'PUR' },
    });
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/cash-desk/purchase-options',
        expect.objectContaining({ query: expect.objectContaining({ search: 'PUR', page: 1 }) }),
      ),
    );
  });
  it('ignores a late candidate response after changing supplier', async () => {
    const fallback = h.get.getMockImplementation()!;
    let resolve!: (value: unknown) => void;
    const late = new Promise((r) => {
      resolve = r;
    });
    h.get.mockImplementation((path, ...args) =>
      path === '/cash-desk/purchase-options' && args[0]?.query?.supplierId === 'supplier'
        ? late
        : fallback(path, ...args),
    );
    h.rows = [
      {
        ...purchase,
        id: 'b',
        number: 'B-001',
        supplierId: 'supplier-b',
        supplierName: 'Supplier B',
      },
    ];
    render(<Editor />);
    await chooseSelectOption('Paying account', 'till');
    await pickSupplier();
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/cash-desk/purchase-options',
        expect.objectContaining({ query: expect.objectContaining({ supplierId: 'supplier' }) }),
      ),
    );
    await pickSupplier('Supplier B');
    await findSelectField('Purchase or invoice');
    await act(async () => {
      resolve({ rows: [purchase], total: 1, page: 1, pageSize: 20, totalPages: 1 });
      await late;
    });
    expect(selectFieldOptions(getSelectField('Purchase or invoice'))).toContain(
      'B-001 · PO-001 · Purchase payable · TZS 9,999,999,999,999,999.99 outstanding',
    );
    expect(selectFieldOptions(getSelectField('Purchase or invoice'))).not.toContain(
      'PUR-001 · PO-001 · Purchase payable · TZS 9,999,999,999,999,999.99 outstanding',
    );
  });
  it('keeps a selected invoice, re-reads its balance on actual Cash Desk resume, and reviews its current version before a first payment', async () => {
    h.rows = [{ ...desk, outstanding: '80.00' }];
    render(<App />);
    await start();
    await selectPurchase(desk);
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    h.current = { ...desk, outstanding: '60.00', version: 9 };
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Cash movement' }));
    await screen.findByText('The source record has changed.');
    expect(screen.getByLabelText(/Amount/)).toHaveValue('80.00');
    expect(h.post).not.toHaveBeenCalled();
    expect(h.get.mock.calls.some(([path]) => path === '/invoice-desk/invoices/desk-invoice')).toBe(
      false,
    );
    fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: '50.00' } });
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'I have reviewed the latest record and my draft values.',
      }),
    );
    submit();
    await waitFor(() => expect(h.post).toHaveBeenCalledOnce());
    expect(h.post.mock.calls[0][1]).toMatchObject({
      invoiceId: 'desk-invoice',
      invoiceVersion: 9,
      supplierId: 'supplier',
      accountId: 'till',
      amount: '50.00',
    });
  });
  it('retains the original request and document version after a lost response, even when the selected invoice is now paid', async () => {
    h.rows = [{ ...desk, outstanding: '80.00' }];
    h.post.mockRejectedValueOnce(new Error('Response lost'));
    render(<App />);
    await start();
    await selectPurchase(desk);
    submit();
    await screen.findByText('Response lost');
    const original = h.post.mock.calls[0][1];
    expect(getSelectField('Paying account')).toBeDisabled();
    expect(screen.getByLabelText(/Amount/)).toHaveAttribute('readonly');
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    h.current = { ...desk, outstanding: '0.00', version: 9, status: 'PAID', canPay: false };
    fireEvent.click(await screen.findByRole('button', { name: 'Resume Cash movement' }));
    await screen.findByText('The source record has changed.');
    submit();
    await waitFor(() => expect(h.post).toHaveBeenCalledTimes(2));
    expect(h.post.mock.calls[1][1]).toEqual(original);
    expect(original.invoiceVersion).toBe(8);
  });
  it('does not promote a mismatched selected-document response into a payment', async () => {
    h.current = { ...purchase, id: 'different' };
    render(<Editor />);
    await selectPurchase();
    submit();
    expect(
      await screen.findByText(
        'The selected purchase is unavailable for this account and supplier.',
      ),
    ).toBeInTheDocument();
    expect(h.post).not.toHaveBeenCalled();
  });
  it('shows permission-gated links to the actual supplier, payable, invoice and purchase order', async () => {
    render(<Editor />);
    await selectPurchase();
    expect(screen.getByRole('link', { name: 'View supplier' })).toHaveAttribute(
      'href',
      '/invoice-desk/suppliers/supplier',
    );
    expect(screen.getByRole('link', { name: 'View payable' })).toHaveAttribute(
      'href',
      '/cash-desk/payables?search=PAY-001',
    );
    expect(screen.getByRole('link', { name: 'View supplier invoice' })).toHaveAttribute(
      'href',
      '/invoice-desk?view=invoices&businessRecord=invoice-business',
    );
    expect(screen.getByRole('link', { name: 'View purchase order' })).toHaveAttribute(
      'href',
      '/operations/purchase-orders/order',
    );
  });
  it('retains the selection during a failed current-record read and retries without posting', async () => {
    const fallback = h.get.getMockImplementation()!;
    let fail = true;
    h.get.mockImplementation((path, ...args) =>
      path === '/cash-desk/purchase-options' && args[0]?.query?.id && fail
        ? Promise.reject(new Error('Purchase read interrupted'))
        : fallback(path, ...args),
    );
    render(<Editor />);
    await selectPurchase();
    expect(await screen.findByRole('alert')).toHaveTextContent('Purchase read interrupted');
    submit();
    expect(h.post).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry selected purchase' }));
    await screen.findByRole('link', { name: 'View payable' });
    expect(screen.getByLabelText(/Amount/)).toHaveValue(purchase.outstanding);
    expect(h.post).not.toHaveBeenCalled();
  });
  it('compares large financial strings exactly rather than rounding through a floating point number', () => {
    expect(exactAmount('9999999999999999.99')).toBe(999999999999999999n);
    expect(exactAmount('9999999999999999.98')).toBe(999999999999999998n);
    expect(exactAmount('1.001')).toBeNull();
  });
  it('keeps the existing supplier-payment history filter under the Purchases label', async () => {
    h.permissions = new Set(['cash_desk.view']);
    render(<CashDesk />);
    fireEvent.click(await screen.findByRole('button', { name: 'Movements', exact: true }));
    await chooseSelectOption('Movement type', 'Purchases');
    await waitFor(() =>
      expect(h.get).toHaveBeenCalledWith(
        '/cash-desk/movements',
        expect.objectContaining({ query: expect.objectContaining({ kind: 'SUPPLIER_PAYMENT' }) }),
      ),
    );
    expect(screen.queryByRole('button', { name: 'Record movement' })).not.toBeInTheDocument();
  });
  it('filters out canonical purchases without their specific payment permissions', async () => {
    h.permissions.delete('supplier-payments.manage');
    render(<Editor />);
    await chooseSelectOption('Paying account', 'till');
    await pickSupplier();
    const choices = selectFieldOptions(await findSelectField('Purchase or invoice'));
    expect(choices.some((label) => label.includes('DIRECT-001'))).toBe(true);
    expect(choices.some((label) => label.includes('PUR-001'))).toBe(false);
    expect(h.post).not.toHaveBeenCalled();
  });
  it.each([
    { sourceType: 'CashDesk', sourceId: 'payment', canManage: true, canReverse: true },
    { sourceType: 'CashDesk', sourceId: 'payment', canManage: false, canReverse: false },
    {
      sourceType: 'SupplierInvoice',
      sourceId: 'invoice-business',
      canManage: true,
      canReverse: false,
    },
  ])(
    'links the posted purchase records and restricts reversal to its owned payment ($sourceType, manage=$canManage)',
    async ({ sourceType, sourceId, canManage, canReverse }) => {
      h.permissions.add('journal_entries.view');
      if (!canManage) h.permissions.delete('supplier-payments.manage');
      const movement: Movement = {
        id: 'payment',
        kind: 'SUPPLIER_PAYMENT',
        description: 'Purchase settlement',
        businessDate: '2026-01-02',
        amount: '100.00',
        currency: 'TZS',
        reference: 'PAYMENT-001',
        actorName: 'Office',
        entries: [],
        journalEntryId: 'journal',
        journalEntry: { id: 'journal', journalNumber: 'JRN-001' },
        supplier,
        payable: {
          id: 'payable',
          payableNumber: 'PAY-001',
          supplierInvoices: [
            {
              id: 'invoice-business',
              supplierInvoiceNumber: 'PUR-001',
              purchaseOrder: { id: 'order', purchaseOrderNumber: 'PO-001' },
              goodsReceivedNote: { id: 'receipt', grnNumber: 'GRN-001' },
            },
          ],
          purchaseOrders: [{ id: 'order', purchaseOrderNumber: 'PO-001' }],
        },
        supplierPayment: { id: 'erp-payment', paymentNumber: 'SP-001', sourceType, sourceId },
      };
      const fallback = h.get.getMockImplementation()!;
      h.get.mockImplementation((path, ...args) =>
        path === '/cash-desk/movements/payment'
          ? Promise.resolve(movement)
          : fallback(path, ...args),
      );
      render(<CashDesk targetRecordId="payment" />);
      await screen.findByRole('dialog', { name: 'Purchases' });
      expect(screen.getByRole('link', { name: 'JRN-001 →' })).toHaveAttribute(
        'href',
        '/finance/journal-entries',
      );
      expect(screen.getByRole('link', { name: 'PUR-001 →' })).toHaveAttribute(
        'href',
        '/invoice-desk?view=invoices&businessRecord=invoice-business',
      );
      expect(screen.getByRole('link', { name: 'GRN-001 →' })).toHaveAttribute(
        'href',
        '/invoice-desk?view=receiving',
      );
      expect(screen.getAllByRole('link', { name: 'PO-001 →' })).toHaveLength(1);
      expect(!!screen.queryByRole('button', { name: 'Reverse movement' })).toBe(canReverse);
      expect(h.post).not.toHaveBeenCalled();
    },
  );
});

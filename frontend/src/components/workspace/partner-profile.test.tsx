import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import CustomerProfile from '@/app/(dashboard)/operations/customers/[id]/page';
import SupplierProfile from '@/app/(dashboard)/operations/suppliers/[id]/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  id: 'partner',
  permissions: new Set<string>(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  page: vi.fn(),
  push: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: state.id }),
  useRouter: () => ({ push: state.push }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
  backendPage: state.page,
}));
const partner = {
  id: 'partner',
  name: 'Acacia Trading',
  companyId: 'company',
  company: { id: 'company', name: 'Example Company' },
  customerCode: 'CUS-0042',
  supplierCode: 'SUP-0042',
  customerType: 'COMPANY',
  supplierType: 'GENERAL_SUPPLIER',
  divisionId: 'division',
  branchId: 'branch',
  division: { id: 'division', name: 'Central operations' },
  branch: { id: 'branch', name: 'Dar es Salaam' },
  legalName: 'Acacia Trading Limited',
  phone: '+255 700 000 000',
  email: 'accounts@example.test',
  contactPerson: 'Alex Morgan',
  address: 'Example address',
  creditLimit: 5000000,
  currentBalance: 1250000,
  paymentTerms: 'Net 30',
  status: 'ACTIVE',
  notes: 'Contact accounts before delivery.',
  productCategories: [
    { productCategory: { id: 'category', name: 'Building materials', categoryType: 'HARDWARE' } },
  ],
};
const product = {
  id: 'product',
  name: 'Construction cement',
  productCode: 'PR-0021',
  category: { name: 'Building materials' },
};
const order = {
  id: 'order',
  salesOrderNumber: 'SO-0042',
  purchaseOrderNumber: 'PO-0042',
  orderDate: '2026-09-10',
  status: 'CONFIRMED',
  paymentStatus: 'PARTIALLY_PAID',
  salesType: 'CREDIT',
  totalAmount: 1500000,
  paidAmount: 250000,
  outstandingAmount: 1250000,
  currency: 'TZS',
  lines: [
    {
      id: 'line',
      product,
      quantity: 100,
      unitPrice: 15000,
      unitCost: 15000,
      lineTotal: 1500000,
      unit: { name: 'Bag', symbol: 'bag' },
    },
  ],
};
const invoice = {
  id: 'invoice',
  receivableNumber: 'AR-0042',
  payableNumber: 'AP-0042',
  issueDate: '2026-09-10',
  dueDate: '2026-09-20',
  status: 'OPEN',
  amount: 1500000,
  paidAmount: 250000,
  outstandingAmount: 1250000,
  currency: 'TZS',
};
const common = {
  summary: {
    lifetimeSalesTotal: 20000000,
    ytdSalesTotal: 15000000,
    paidSalesTotal: 10000000,
    salesOrderCount: 42,
    openReceivableBalance: 1250000,
    overdueReceivableBalance: 250000,
    paidReceivableTotal: 10000000,
    receivableCount: 11,
    creditLimit: 5000000,
    creditAvailable: 3750000,
    creditUtilizationPct: 25,
    lifetimePurchaseTotal: 20000000,
    ytdPurchaseTotal: 15000000,
    receivedPurchaseTotal: 15000000,
    purchaseOrderCount: 42,
    openPayableBalance: 1250000,
    overduePayableBalance: 250000,
    paidPayableTotal: 10000000,
    payableCount: 11,
  },
  latestStatements: [
    {
      id: 'statement',
      statementRunNumber: 'ST-0042',
      periodStart: '2026-08-01',
      periodEnd: '2026-08-31',
      totalDebits: 1500000,
      totalCredits: 250000,
      closingBalance: 1250000,
      status: 'GENERATED',
    },
  ],
  ledger: [
    {
      id: 'event',
      type: 'INVOICE',
      sourceId: 'invoice',
      reference: 'INV-0042',
      date: '2026-09-10',
      status: 'POSTED',
      debit: 1500000,
      credit: 250000,
      balanceImpact: 1250000,
      currency: 'TZS',
    },
  ],
  audit: {
    createdAt: '2026-01-01',
    updatedAt: '2026-09-10',
    createdBy: { fullName: 'Alex Morgan' },
    updatedBy: { fullName: 'Sam Taylor' },
  },
};
const history = [
  {
    product,
    unit: { name: 'Bag', symbol: 'bag' },
    quantity: 100,
    totalAmount: 1500000,
    lastPurchasedAt: '2026-09-10',
  },
];
const customer = {
  ...common,
  customer: partner,
  recentSalesOrders: [order],
  openReceivables: [invoice],
  recentReceivables: [invoice],
  priceAgreements: [
    {
      id: 'agreement',
      agreedPrice: 0,
      discountPercent: 0,
      startDate: '2026-09-01',
      status: 'ACTIVE',
      notes: 'Recorded zero-rate agreement',
    },
  ],
  productHistory: history,
};
const supplier = {
  ...common,
  supplier: partner,
  recentPurchaseOrders: [order],
  openPayables: [invoice],
  recentPayables: [invoice],
  performance: {
    rating: 'GOOD',
    onTimeDeliveryRate: 0,
    qualityScore: 95,
    priceCompetitivenessScore: null,
    totalReturns: 0,
    disputeCount: 0,
    totalPurchases: 20000000,
    lastReviewedAt: '2026-09-10',
    reviewedBy: { fullName: 'Sam Taylor' },
    notes: 'Reviewed this month.',
  },
  productCoverage: history,
};
const aging = {
  companyId: 'company',
  customerId: 'partner',
  customerName: partner.name,
  asOf: '2026-09-17',
  current: 1000000,
  days1_30: 250000,
  days31_60: 0,
  days61_90: 0,
  over90: 0,
  total: 1250000,
  oldestDaysOverdue: 10,
  receivableCount: 11,
  receivables: [
    ...Array.from({ length: 10 }, (_, index) => ({
      ...invoice,
      id: `current-${index}`,
      outstandingAmount: 100_000,
      bucket: 'current',
    })),
    { ...invoice, outstandingAmount: 250_000, bucket: 'days1_30' },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.id = 'partner';
  state.permissions = new Set([
    'customers.view',
    'customers.update',
    'suppliers.view',
    'suppliers.update',
    'suppliers.delete',
    'customer_statements.generate',
    'supplier_statements.generate',
    'finance.reports.view',
    'sales.view',
    'purchases.view',
    'operations.reports.view',
    'receivables.view',
  ]);
  state.get.mockImplementation(async (path: string) =>
    path.startsWith('/financial-reports/')
      ? aging
      : path.startsWith('/customers/')
        ? customer
        : supplier,
  );
  state.page.mockResolvedValue({ data: [], total: 0 });
  state.post.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
function mount(kind: 'customer' | 'supplier') {
  return render(
    <UnsavedWorkProvider>
      {kind === 'customer' ? <CustomerProfile /> : <SupplierProfile />}
    </UnsavedWorkProvider>,
  );
}
const ready = () => screen.findByRole('heading', { name: 'Acacia Trading', exact: true });
const section = (name: string) =>
  userEvent.click(
    within(screen.getByRole('navigation', { name: 'Profile sections' })).getByRole('button', {
      name,
      exact: true,
    }),
  );
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
}
describe.each(['customer', 'supplier'] as const)('%s profile', (kind) => {
  it('gates reads and destination actions by exact permissions', async () => {
    state.permissions.clear();
    const view = mount(kind);
    expect(screen.getByText('Access restricted.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add(`${kind}s.view`);
    mount(kind);
    await ready();
    expect(
      screen.queryByRole('button', { name: /Edit|Delete|Block Credit|Reports/ }),
    ).not.toBeInTheDocument();
    expect(state.get).toHaveBeenCalledTimes(1);
    await section(kind === 'customer' ? 'Sales' : 'Purchases');
    expect(screen.queryByRole('button', { name: 'View / Print' })).not.toBeInTheDocument();
    await section('Statements');
    expect(screen.queryByRole('button', { name: 'Generate statement' })).not.toBeInTheDocument();
  });
  it('preserves every existing section, zero values and responsive table labels', async () => {
    mount(kind);
    await ready();
    if (kind === 'customer')
      await waitFor(() => expect(screen.getByText('Aging (11 invoices)')).toBeInTheDocument());
    capture(`partner-${kind}-profile`);
    await section(kind === 'customer' ? 'Sales' : 'Purchases');
    expect(screen.getByText(kind === 'customer' ? 'SO-0042' : 'PO-0042')).toBeInTheDocument();
    expect(screen.getByText('Construction cement')).toBeInTheDocument();
    expect(screen.getByText('100 bag').closest('td')).toHaveAttribute('data-label', 'Qty');
    capture(`partner-${kind}-orders`);
    await section(kind === 'customer' ? 'Receivables' : 'Payables');
    expect(screen.getByText(kind === 'customer' ? 'AR-0042' : 'AP-0042')).toBeInTheDocument();
    await section('Products');
    expect(screen.getByText('Construction cement')).toBeInTheDocument();
    expect(screen.getByText('PR-0021')).toBeInTheDocument();
    capture(`partner-${kind}-products`);
    await section('Statements');
    expect(screen.getByText('ST-0042')).toBeInTheDocument();
    capture(`partner-${kind}-statements`);
    if (kind === 'customer') {
      await section('Pricing');
      expect(screen.getByText('TZS 0.00')).toBeInTheDocument();
      expect(screen.getByText('0%')).toBeInTheDocument();
      await section('Credit');
      expect(screen.getByText('25.0%')).toBeInTheDocument();
    } else {
      await section('Performance');
      expect(screen.getByText('0.00%')).toBeInTheDocument();
      expect(screen.getByText('0')).toBeInTheDocument();
      expect(screen.getByText('Sam Taylor')).toBeInTheDocument();
    }
    await section('Audit');
    expect(screen.getByText('INV-0042')).toBeInTheDocument();
    expect(screen.getByText('Sam Taylor')).toBeInTheDocument();
  });
  it('validates statement dates, protects drafts across sections, retries generation with exact identity', async () => {
    mount(kind);
    await ready();
    await section('Statements');
    await setDateField(/Period start/, '2026-09-30');
    await setDateField(/Period end/, '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: 'Generate statement', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose valid dates');
    expect(state.post).not.toHaveBeenCalled();
    await section('Overview');
    await userEvent.click(await screen.findByRole('button', { name: 'Stay here' }));
    expect(dateFieldValue(getDateField(/Period start/))).toBe('2026-09-30');
    await setDateField(/Period start/, '2026-09-01');
    await setDateField(/Period end/, '2026-09-30');
    state.post.mockRejectedValueOnce(new Error('Generation unavailable'));
    await userEvent.click(screen.getByRole('button', { name: 'Generate statement', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Generation unavailable');
    expect(dateFieldValue(getDateField(/Period end/))).toBe('2026-09-30');
    await userEvent.click(screen.getByRole('button', { name: 'Generate statement', exact: true }));
    await screen.findByText(
      `${kind === 'customer' ? 'Customer' : 'Supplier'} statement generated.`,
    );
    expect(state.post).toHaveBeenLastCalledWith(`/${kind}-statements/generate`, {
      companyId: 'company',
      [`${kind}Id`]: 'partner',
      periodStart: '2026-09-01',
      periodEnd: '2026-09-30',
    });
  });
  it('hides obsolete profile data on route changes and retries errors', async () => {
    const view = mount(kind);
    await ready();
    let signal!: AbortSignal;
    let finish!: (v: unknown) => void;
    state.get.mockImplementation(
      (_p: string, options: { signal: AbortSignal }) =>
        new Promise((resolve) => {
          signal = options.signal;
          finish = resolve;
        }),
    );
    state.id = 'next';
    view.rerender(
      <UnsavedWorkProvider>
        {kind === 'customer' ? <CustomerProfile /> : <SupplierProfile />}
      </UnsavedWorkProvider>,
    );
    expect(screen.queryByRole('heading', { name: 'Acacia Trading' })).not.toBeInTheDocument();
    state.get.mockRejectedValue(new Error('Profile unavailable'));
    state.id = 'last';
    view.rerender(
      <UnsavedWorkProvider>
        {kind === 'customer' ? <CustomerProfile /> : <SupplierProfile />}
      </UnsavedWorkProvider>,
    );
    await screen.findByRole('alert');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(kind === 'customer' ? customer : supplier));
    expect(screen.queryByRole('heading', { name: 'Acacia Trading' })).not.toBeInTheDocument();
    state.get.mockImplementation(async (path: string) =>
      path.startsWith('/financial-reports/') ? aging : kind === 'customer' ? customer : supplier,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await ready();
  });
  it('supports keyboard section selection and guarded return navigation', async () => {
    mount(kind);
    await ready();
    const nav = screen.getByRole('navigation', { name: 'Profile sections' });
    within(nav).getByRole('button', { name: 'Overview', exact: true }).focus();
    await userEvent.keyboard('{ArrowRight}{Enter}');
    expect(
      within(nav).getByRole('button', {
        name: kind === 'customer' ? 'Sales' : 'Purchases',
        exact: true,
      }),
    ).toHaveAttribute('aria-pressed', 'true');
    await section('Statements');
    await setDateField(/Period start/, '2026-01-01');
    await userEvent.click(
      screen.getByRole('button', {
        name: kind === 'customer' ? 'Back to Customers' : 'Back to Suppliers',
      }),
    );
    expect(state.push).not.toHaveBeenCalled();
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(state.push).toHaveBeenCalledWith(`/operations/${kind}s`);
  });
});
describe('Customer aging and profile mutations', () => {
  it('retries full aging separately while keeping the actual total and clearly partial breakdown', async () => {
    state.get.mockImplementation(async (path: string) => {
      if (path.startsWith('/financial-reports/')) throw new Error('Aging unavailable');
      return { ...customer, summary: { ...common.summary, openReceivableBalance: 2000000 } };
    });
    mount('customer');
    await ready();
    expect(await screen.findByText(/Complete aging unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/older invoices not shown/)).toHaveTextContent('750,000.00');
    state.get.mockResolvedValue(aging);
    await userEvent.click(screen.getByRole('button', { name: 'Retry aging' }));
    await screen.findByText('Aging (11 invoices)');
    expect(screen.queryByText(/Complete aging unavailable/)).not.toBeInTheDocument();
  });
  it('opens the customer editor directly and uses named block confirmation with recoverable failure', async () => {
    mount('customer');
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Edit customer', exact: true }));
    expect(screen.getByRole('dialog', { name: 'Edit customer' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Block Credit' }));
    const dialog = screen.getByRole('dialog', { name: 'Block customer' });
    expect(within(dialog).getByText('Acacia Trading')).toBeInTheDocument();
    state.patch.mockRejectedValueOnce(new Error('Update unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Block customer' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Update unavailable');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep customer' }));
    expect(state.patch).toHaveBeenCalledTimes(1);
  });
  it('retains failed supplier deletion and navigates only after success', async () => {
    mount('supplier');
    await ready();
    await userEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    const dialog = screen.getByRole('dialog', { name: 'Delete supplier' });
    state.remove.mockRejectedValueOnce(new Error('Delete unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete supplier' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Delete unavailable');
    expect(state.push).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete supplier' }));
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/operations/suppliers'));
  });
});

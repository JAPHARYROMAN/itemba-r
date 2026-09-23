import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountingReadiness } from './accounting-readiness';
import { ReportsApp } from './reports-app';
import { AccountingDraftBoundary } from './accounting-drafts';
import type {
  CashReview,
  Connections,
  Desk,
  InvoiceReview,
  UnlinkedPayment,
} from './accounting-types';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceNavigationProvider,
  WorkspaceLink,
  useWorkspaceSearchParams,
} from '@/components/workspace/workspace-navigation';

const state = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  permissions: new Set<string>(),
  invoice: {} as InvoiceReview,
  cash: {} as CashReview,
  connections: {} as Connections,
  payments: [] as UnlinkedPayment[],
  accounts: [] as Desk[],
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendGet: state.get,
  backendPost: state.post,
}));

const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
function response(path: string) {
  if (path.includes('directory')) return { companies: [], divisions: [], branches: [] };
  if (path === '/desk-posting/sales' || path === '/desk-posting/purchases')
    return [state.invoice.source];
  if (path.startsWith('/desk-posting/')) return state.invoice;
  if (path === '/cash-connections/movements') return [state.cash.source];
  if (path === '/cash-connections/movements/movement') return state.cash;
  if (path === '/cash-connections/accounts') return state.connections;
  if (path === '/cash-connections/unlinked-payments') return state.payments;
  if (path === '/cash-desk/accounts') return state.accounts;
  throw new Error(`Unexpected read ${path}`);
}
const initialRead = async (path: string) => structuredClone(response(path));
function Pages() {
  const params = useWorkspaceSearchParams();
  return (
    <AccountingDraftBoundary>
      <nav>
        <WorkspaceLink href="/reports">Reports home</WorkspaceLink>
        <WorkspaceLink href="/reports?view=accounting&tab=sales">Open invoices</WorkspaceLink>
        <WorkspaceLink href="/reports?view=accounting&tab=cash">Open cash</WorkspaceLink>
      </nav>
      {params.get('view') === 'accounting' ? <AccountingReadiness /> : <h1>All reports</h1>}
    </AccountingDraftBoundary>
  );
}
function Pane({ tab = 'sales', id = 'main' }: { tab?: string; id?: string }) {
  return (
    <section aria-label={`${id} window`}>
      <UnsavedWorkScope id={id}>
        <WorkspaceNavigationProvider
          appId={`reports-${id}`}
          initialHref={`/reports?view=accounting&tab=${tab}`}
          ownsPath={(path) => path === '/reports'}
        >
          <Pages />
        </WorkspaceNavigationProvider>
      </UnsavedWorkScope>
    </section>
  );
}
function Providers({ children }: { children: React.ReactNode }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>{children}</WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
function App({ tab = 'sales' }: { tab?: string }) {
  return (
    <Providers>
      <Pane tab={tab} />
    </Providers>
  );
}
type Case = {
  name: string;
  tab: string;
  opener: string;
  title: string;
  action: string;
  endpoint: string;
  fields: [string, string][];
};
const cases: Case[] = [
  {
    name: 'sales invoice',
    tab: 'sales',
    opener: 'Review',
    title: 'Invoice journal review',
    action: 'Post balanced journal',
    endpoint: '/desk-posting/sales/invoice',
    fields: [
      ['Debit · Customer receivables', 'asset'],
      ['Credit · Sales income', 'income'],
    ],
  },
  {
    name: 'purchase invoice',
    tab: 'purchases',
    opener: 'Review',
    title: 'Invoice journal review',
    action: 'Post balanced journal',
    endpoint: '/desk-posting/purchases/invoice',
    fields: [
      ['Debit · Expense or asset', 'expense'],
      ['Credit · Supplier payables', 'liability'],
    ],
  },
  {
    name: 'cash posting',
    tab: 'cash',
    opener: 'Review',
    title: 'Cash journal review',
    action: 'Post cash movement',
    endpoint: '/cash-connections/movements/movement',
    fields: [['Offset account', 'income']],
  },
  {
    name: 'desk connection',
    tab: 'connections',
    opener: 'Connect Till',
    title: 'Account connection',
    action: 'Save connection',
    endpoint: '/cash-connections/accounts',
    fields: [
      ['Cash / bank account', 'bank'],
      ['Dedicated asset ledger account', 'asset'],
    ],
  },
  {
    name: 'bank connection',
    tab: 'connections',
    opener: 'Map Bank',
    title: 'Account connection',
    action: 'Save connection',
    endpoint: '/cash-connections/accounts',
    fields: [['Dedicated asset ledger account', 'asset']],
  },
  {
    name: 'supplier payment',
    tab: 'cash',
    opener: 'Link cash account',
    title: 'Supplier payment link',
    action: 'Link payment and record cash outflow',
    endpoint: '/cash-desk/movements',
    fields: [['Account that paid', 'desk']],
  },
];
const primary = [cases[0], cases[2], cases[3], cases[5]];
async function open(c: Case) {
  fireEvent.click(await screen.findByRole('button', { name: c.opener }));
  for (const [label, value] of c.fields) {
    const field = await screen.findByRole('combobox', { name: label });
    await waitFor(() =>
      expect([...field.querySelectorAll('option')].some((o) => o.value === value)).toBe(true),
    );
    fireEvent.change(field, { target: { value } });
  }
  return screen.getByRole('dialog');
}
function ack() {
  for (const box of within(screen.getByRole('dialog')).getAllByRole('checkbox'))
    if (!(box as HTMLInputElement).checked) fireEvent.click(box);
}
function changeSource(c: Case) {
  if (c.tab === 'sales') {
    state.invoice.fingerprint = 'new-invoice-version';
    state.invoice.source.amount = '125.00';
  } else if (c.name === 'cash posting') {
    state.cash.fingerprint = 'new-cash-version';
    state.cash.source.amount = '125.00';
  } else if (c.tab === 'connections') state.connections.bank[0].recordedBalance = '125.00';
  else state.payments[0].reference = 'Corrected reference';
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  state.get.mockReset().mockImplementation(initialRead);
  state.post.mockReset().mockResolvedValue({ journalNumber: 'JE-1' });
  state.permissions = new Set([
    'sales_desk.view',
    'invoice_desk.view',
    'cash_desk.view',
    'journal_entries.view',
    'journal_entries.create',
    'journal_entries.post',
    'cash_desk.manage',
    'cash_accounts.manage',
    'cash_desk.record',
    'invoice_desk.payments',
  ]);
  const ledgers = ['asset', 'income', 'expense', 'liability'].map((id) => ({
    ...scope,
    id,
    accountCode: id,
    accountName: id,
    accountType: id.toUpperCase(),
    ledgerBalance: '0.00',
  }));
  state.invoice = {
    source: {
      id: 'invoice',
      kind: 'sales',
      reference: 'INV-01',
      date: '2026-09-20',
      currency: 'TZS',
      amount: '100.00',
      status: 'Unposted',
      fingerprint: 'invoice-version',
      journalId: null,
    },
    fingerprint: 'invoice-version',
    status: 'Unposted',
    blocked: null,
    journals: [],
    accounts: ledgers,
  };
  state.cash = {
    source: {
      id: 'movement',
      kind: 'OTHER_IN',
      date: '2026-09-20',
      currency: 'TZS',
      amount: '100.00',
      status: 'Unposted',
      reference: 'CASH-01',
      description: 'Cash receipt',
      entries: [{ name: 'Till', amount: '100.00' }],
    },
    fingerprint: 'cash-version',
    issues: [],
    offsetId: null,
    accounts: ledgers,
    journals: [],
    cashAccounts: [{ id: 'desk', name: 'Till', amount: '100.00' }],
  };
  state.accounts = [
    {
      ...scope,
      id: 'desk',
      name: 'Till',
      currency: 'TZS',
      canConnect: true,
      erpCashAccountId: null,
      company: { name: 'Company' },
      branch: { name: 'Central' },
    },
  ];
  state.connections = {
    desk: structuredClone(state.accounts),
    bank: [
      {
        ...scope,
        id: 'bank',
        accountName: 'Bank',
        currency: 'TZS',
        canConnect: true,
        recordedBalance: '0.00',
        balanceDifference: null,
        ledgerBalance: null,
        ledgerAccountId: null,
        ledgerAccount: null,
      },
    ],
    ledger: ledgers.filter((l) => l.accountType === 'ASSET'),
  };
  state.payments = [
    {
      id: 'payment',
      amount: '100.00',
      paymentDate: '2026-09-20T00:00:00.000Z',
      reference: 'PAY-01',
      invoice: {
        ...scope,
        id: 'purchase',
        invoiceNumber: 'PUR-01',
        currency: 'TZS',
        supplier: { name: 'Supplier' },
      },
    },
  ];
});

describe('Reports accounting continuity', () => {
  it('exposes kept accounting work from the actual Reports home', async () => {
    render(
      <Providers>
        <UnsavedWorkScope id="main">
          <WorkspaceNavigationProvider
            appId="reports-main"
            initialHref="/reports?view=accounting&tab=sales"
            ownsPath={(p) => p === '/reports'}
          >
            <ReportsApp />
          </WorkspaceNavigationProvider>
        </UnsavedWorkScope>
      </Providers>,
    );
    await open(cases[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(screen.getByRole('link', { name: 'All reports' }));
    await screen.findByRole('heading', { name: 'A clearer view of your business.' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume Invoice journal review' }));
    expect(
      await screen.findByRole('combobox', { name: 'Debit · Customer receivables' }),
    ).toHaveValue('asset');
    expect(state.post).not.toHaveBeenCalled();
  });
  it.each(cases)(
    'keeps $name choices, resumes from Reports home and explicitly saves the correct operation',
    async (c) => {
      render(<App tab={c.tab} />);
      await open(c);
      ack();
      fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
      fireEvent.click(screen.getByRole('link', { name: 'Reports home' }));
      await screen.findByRole('heading', { name: 'All reports' });
      expect(state.post).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: `Resume ${c.title}` }));
      for (const [label, value] of c.fields)
        expect(await screen.findByRole('combobox', { name: label })).toHaveValue(value);
      expect(screen.getByRole('button', { name: c.action })).toBeDisabled();
      ack();
      fireEvent.click(screen.getByRole('button', { name: c.action }));
      await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
      expect(state.post.mock.calls[0][0]).toBe(c.endpoint);
      const payload = state.post.mock.calls[0][1];
      if (c.tab === 'sales' || c.tab === 'purchases')
        expect(payload).toEqual({
          fingerprint: 'invoice-version',
          debitAccountId: c.fields[0][1],
          creditAccountId: c.fields[1][1],
        });
      else if (c.name === 'cash posting')
        expect(payload).toEqual({ fingerprint: 'cash-version', offsetAccountId: 'income' });
      else if (c.tab === 'connections')
        expect(payload).toEqual({
          cashAccountId: 'bank',
          ledgerAccountId: 'asset',
          deskAccountId: c.name === 'desk connection' ? 'desk' : undefined,
        });
      else
        expect(payload).toEqual({
          requestId: expect.any(String),
          kind: 'SUPPLIER_PAYMENT',
          accountId: 'desk',
          invoiceId: 'purchase',
          existingInvoicePaymentId: 'payment',
          amount: '100.00',
          businessDate: '2026-09-20',
          description: 'Payment for PUR-01',
          reference: 'PAY-01',
        });
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.queryByRole('button', { name: `Resume ${c.title}` })).not.toBeInTheDocument();
    },
  );
  it.each(primary)('requires a new source review before writing a changed $name', async (c) => {
    render(<App tab={c.tab} />);
    await open(c);
    ack();
    changeSource(c);
    fireEvent.click(screen.getByRole('button', { name: c.action }));
    await screen.findByText('The source record has changed.');
    expect(state.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: c.action })).toBeDisabled();
    ack();
    fireEvent.click(screen.getByRole('button', { name: c.action }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
  });
  it.each(primary)(
    'keeps $name input through a failed write and resumes the same request',
    async (c) => {
      state.post.mockRejectedValueOnce(new Error('Connection interrupted'));
      render(<App tab={c.tab} />);
      await open(c);
      ack();
      fireEvent.click(screen.getByRole('button', { name: c.action }));
      await screen.findByText('Connection interrupted');
      const original = state.post.mock.calls[0][1];
      fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
      fireEvent.click(screen.getByRole('button', { name: `Resume ${c.title}` }));
      await screen.findByRole('combobox', { name: c.fields[0][0] });
      ack();
      if (c.name === 'supplier payment')
        expect(screen.getByRole('combobox', { name: 'Account that paid' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: c.action }));
      await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
      expect(state.post.mock.calls[1][1]).toEqual(original);
    },
  );
  it.each(primary)('rechecks current permission after the pending $name source read', async (c) => {
    const view = render(<App tab={c.tab} />);
    await open(c);
    ack();
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: c.action }));
    // The write saves its draft before it verifies the source, so the pending
    // read this test names is a microtask behind the click.
    await waitFor(() => expect(resolve).toBeDefined());
    state.permissions.delete(
      c.tab === 'connections'
        ? 'cash_desk.manage'
        : c.name === 'supplier payment'
          ? 'cash_desk.record'
          : 'journal_entries.post',
    );
    view.rerender(<App tab={c.tab} />);
    const path =
      c.tab === 'connections'
        ? '/cash-connections/accounts'
        : c.name === 'supplier payment'
          ? '/cash-connections/unlinked-payments'
          : c.endpoint;
    await act(async () => resolve(structuredClone(response(path))));
    await screen.findByText(/current role no longer permits/);
    expect(state.post).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Keep draft' })).toBeEnabled();
  });
  it('retains an invoice through guarded navigation and repeated source changes', async () => {
    const user = userEvent.setup();
    render(<App />);
    await open(cases[0]);
    await user.click(screen.getByRole('link', { name: 'Reports home' }));
    await user.click(screen.getByRole('button', { name: /Keep draft and continue/i }));
    changeSource(cases[0]);
    await user.click(await screen.findByRole('button', { name: 'Resume Invoice journal review' }));
    await screen.findByText('The source record has changed.');
    ack();
    state.invoice.fingerprint = 'third-version';
    await user.click(screen.getByRole('button', { name: 'Post balanced journal' }));
    await waitFor(() =>
      expect(
        screen.getByRole('checkbox', { name: /I have reviewed the latest record/ }),
      ).not.toBeChecked(),
    );
    expect(state.post).not.toHaveBeenCalled();
  });
  it('does not reuse a payment request identity with a changed source payload', async () => {
    state.post.mockRejectedValueOnce(new Error('Uncertain outcome'));
    render(<App tab="cash" />);
    await open(cases[5]);
    ack();
    fireEvent.click(screen.getByRole('button', { name: cases[5].action }));
    await screen.findByText('Uncertain outcome');
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    changeSource(cases[5]);
    fireEvent.click(screen.getByRole('button', { name: 'Resume Supplier payment link' }));
    await screen.findByText('The source record has changed.');
    ack();
    fireEvent.click(screen.getByRole('button', { name: cases[5].action }));
    await screen.findByText(/source changed after an earlier attempt/);
    expect(state.post).toHaveBeenCalledTimes(1);
  });
  it('keeps inaccessible review input and retries without posting automatically', async () => {
    render(<App />);
    await open(cases[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    state.get.mockRejectedValueOnce(new Error('Review unavailable'));
    fireEvent.click(screen.getByRole('button', { name: 'Resume Invoice journal review' }));
    await screen.findByText('Review unavailable');
    expect(screen.getByRole('button', { name: 'Keep draft' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry review' }));
    expect(
      await screen.findByRole('combobox', { name: 'Debit · Customer receivables' }),
    ).toHaveValue('asset');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('blocks unavailable ledger choices and completed connections after resume', async () => {
    render(<App tab="connections" />);
    await open(cases[3]);
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    state.connections.ledger = [];
    fireEvent.click(screen.getByRole('button', { name: 'Resume Account connection' }));
    await screen.findByText('The source record has changed.');
    ack();
    expect(screen.getByRole('button', { name: 'Save connection' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    state.connections.desk[0].erpCashAccountId = 'bank';
    fireEvent.click(screen.getByRole('button', { name: 'Resume Account connection' }));
    await screen.findByText(/This connection is saved/);
    expect(screen.queryByRole('button', { name: 'Save connection' })).not.toBeInTheDocument();
    expect(state.post).not.toHaveBeenCalled();
  });
  it.each([cases[0], cases[2], cases[5]])(
    'does not repeat a completed $name after an uncertain response',
    async (c) => {
      state.post.mockRejectedValueOnce(new Error('Uncertain response'));
      render(<App tab={c.tab} />);
      await open(c);
      ack();
      fireEvent.click(screen.getByRole('button', { name: c.action }));
      await screen.findByText('Uncertain response');
      if (c.tab === 'sales') state.invoice.status = 'Posted';
      else if (c.name === 'cash posting')
        state.cash.journals = [{ id: 'journal', number: 'JE-1', status: 'POSTED' }];
      else state.payments = [];
      fireEvent.click(screen.getByRole('button', { name: c.action }));
      await screen.findByText('The source record has changed.');
      const button = screen.queryByRole('button', { name: c.action });
      if (button) expect(button).toBeDisabled();
      expect(state.post).toHaveBeenCalledTimes(1);
    },
  );
  it('ignores repeated clicks and aborts a verification read when the window unmounts', async () => {
    const view = render(<App />);
    await open(cases[0]);
    ack();
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const button = screen.getByRole('button', { name: cases[0].action });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'Keep draft' })).toBeDisabled();
    // The verification read starts a microtask after the click it belongs to.
    await waitFor(() => expect(resolve).toBeDefined());
    const request = state.get.mock.calls.at(-1)![1];
    view.unmount();
    expect(request.signal.aborted).toBe(true);
    await act(async () => resolve(structuredClone(state.invoice)));
    expect(state.post).not.toHaveBeenCalled();
  });
  it('isolates paired register filters and prevents the same draft opening in both windows', async () => {
    render(
      <Providers>
        <Pane id="left" />
        <Pane id="right" />
      </Providers>,
    );
    const left = within(screen.getByRole('region', { name: 'left window' })),
      right = within(screen.getByRole('region', { name: 'right window' }));
    fireEvent.change(left.getByLabelText('Find document'), { target: { value: 'INV-01' } });
    expect(right.getByLabelText('Find document')).toHaveValue('');
    fireEvent.click(await left.findByRole('button', { name: 'Review' }));
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Debit · Customer receivables' }),
      { target: { value: 'asset' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.click(left.getByRole('button', { name: 'Resume Invoice journal review' }));
    await screen.findByRole('dialog');
    expect(right.getByRole('button', { name: 'Resume Invoice journal review' })).toBeDisabled();
    expect(left.getByLabelText('Find document')).toHaveValue('INV-01');
  });
  it('refreshes both registers after posting without resetting filters or another kept review', async () => {
    render(
      <Providers>
        <Pane id="left" />
        <Pane id="right" />
      </Providers>,
    );
    const left = within(screen.getByRole('region', { name: 'left window' })),
      right = within(screen.getByRole('region', { name: 'right window' }));
    fireEvent.click(await left.findByRole('button', { name: 'Review' }));
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Debit · Customer receivables' }),
      { target: { value: 'asset' } },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep draft' }));
    fireEvent.change(right.getByLabelText('Find document'), { target: { value: 'INV-01' } });
    fireEvent.click(right.getByRole('button', { name: 'Review' }));
    fireEvent.change(
      await screen.findByRole('combobox', { name: 'Debit · Customer receivables' }),
      { target: { value: 'asset' } },
    );
    fireEvent.change(screen.getByRole('combobox', { name: 'Credit · Sales income' }), {
      target: { value: 'income' },
    });
    ack();
    const reads = state.get.mock.calls.filter(([path]) => path === '/desk-posting/sales').length;
    state.post.mockImplementationOnce(async () => {
      state.invoice.status = 'Posted';
      state.invoice.source.status = 'Posted';
      return { journalNumber: 'JE-1' };
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post balanced journal' }));
    await waitFor(() =>
      expect(state.get.mock.calls.filter(([path]) => path === '/desk-posting/sales')).toHaveLength(
        reads + 2,
      ),
    );
    expect(await left.findByRole('cell', { name: 'Posted' })).toBeVisible();
    expect(await right.findByRole('cell', { name: 'Posted' })).toBeVisible();
    expect(right.getByLabelText('Find document')).toHaveValue('INV-01');
    fireEvent.click(left.getByRole('button', { name: 'Resume Invoice journal review' }));
    expect(
      await screen.findByRole('combobox', { name: 'Debit · Customer receivables' }),
    ).toHaveValue('asset');
    expect(screen.getByRole('button', { name: 'Post balanced journal' })).toBeDisabled();
    expect(state.post).toHaveBeenCalledTimes(1);
  });
});

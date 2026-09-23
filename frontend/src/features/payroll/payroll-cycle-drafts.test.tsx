import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Runs from '@/app/(dashboard)/hr/payroll-runs/page';
import Advances from '@/app/(dashboard)/hr/salary-advances/page';
import Payments from '@/app/(dashboard)/hr/salary-payments/page';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceNavigationProvider,
  WorkspaceLink,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import { PayrollDraftWorkspace } from './payroll-drafts';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  periodAvailable: true,
  employeeAvailable: true,
  accountFailure: false,
  run: {} as Record<string, unknown>,
  advance: {} as Record<string, unknown>,
  payment: {} as Record<string, unknown>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/payroll',
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
  backendPage: state.page,
  backendGet: state.get,
  backendPost: state.post,
  backendPatch: state.patch,
}));
function Pages() {
  const path = useWorkspacePathname();
  return (
    <PayrollDraftWorkspace viewKey={path}>
      <nav aria-label="Destinations">
        <WorkspaceLink href="/payroll">Open home</WorkspaceLink>
        <WorkspaceLink href="/hr/payroll-runs">Open runs</WorkspaceLink>
        <WorkspaceLink href="/hr/payroll-runs?companyId=other&payrollPeriodId=other-period&status=PAID">
          Open other pay cycle
        </WorkspaceLink>
        <WorkspaceLink href="/hr/salary-advances">Open advances</WorkspaceLink>
        <WorkspaceLink href="/hr/salary-payments">Open payments</WorkspaceLink>
      </nav>
      {path.endsWith('/payroll-runs') ? (
        <Runs />
      ) : path.endsWith('/salary-advances') ? (
        <Advances />
      ) : path.endsWith('/salary-payments') ? (
        <Payments />
      ) : (
        <h1>Payroll overview</h1>
      )}
    </PayrollDraftWorkspace>
  );
}
function App({ initial = '/hr/payroll-runs' }: { initial?: string }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="primary">
            <WorkspaceNavigationProvider
              appId="payroll"
              initialHref={initial}
              ownsPath={(path) => path === '/payroll' || path.startsWith('/hr/')}
            >
              <Pages />
            </WorkspaceNavigationProvider>
          </UnsavedWorkScope>
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'payroll.view',
    'payroll.manage',
    'payroll.pay',
    'payroll.cancel',
    'cash_desk.view',
    'cash_desk.record',
    'cash_desk.reverse',
    'journal_entries.create',
    'journal_entries.post',
    'journal_entries.reverse',
    'salary_advances.view',
    'salary_advances.create',
    'salary_advances.approve',
    'salary_advances.pay',
    'salary_payments.view',
    'salary_payments.reverse',
    'employees.view',
  ]);
  state.periodAvailable = true;
  state.employeeAvailable = true;
  state.accountFailure = false;
  const company = { id: 'company', name: 'Company A' };
  const employee = { id: 'employee', fullName: 'Alex Example', employeeCode: 'EMP-1' };
  state.run = {
    id: 'run',
    payrollRunNumber: 'PR-01',
    companyId: 'company',
    company,
    payrollPeriodId: 'period',
    payrollPeriod: { name: 'September 2026' },
    payrollType: 'REGULAR',
    status: 'APPROVED',
    totalNetPay: '800.50',
    hrApprovedById: 'hr',
    financeApprovedById: 'finance',
    cashMovements: [],
    updatedAt: 'v1',
  };
  state.advance = {
    id: 'advance',
    advanceNumber: 'ADV-01',
    companyId: 'company',
    employeeId: 'employee',
    company,
    employee,
    amount: '500',
    recoveredAmount: '0',
    status: 'REQUESTED',
    updatedAt: 'v1',
  };
  state.payment = {
    id: 'payment',
    salaryPaymentNumber: 'SP-01',
    companyId: 'company',
    employeeId: 'employee',
    company,
    employee,
    amount: '800.50',
    paymentDate: '2026-09-01',
    paymentMethod: 'CASH',
    status: 'PAID',
    cashMovementId: null,
    updatedAt: 'v1',
  };
  state.page.mockImplementation(async (path, opts) => {
    if (path === '/cash-desk/accounts' && state.accountFailure)
      throw new Error('Accounts unavailable');
    const rows =
      path === '/companies'
        ? [company, { id: 'other', name: 'Company B' }]
        : path === '/hr/employees'
          ? state.employeeAvailable
            ? [{ ...employee, companyId: 'company' }]
            : []
          : path === '/hr/payroll-periods'
            ? state.periodAvailable
              ? [{ id: 'period', companyId: 'company', company, name: 'September 2026' }]
              : []
            : path === '/cash-desk/accounts'
              ? [
                  {
                    id: 'bank',
                    name: 'Main bank',
                    currency: 'TZS',
                    balance: '5000',
                    erpCashAccountId: 'erp-bank',
                  },
                ]
              : path === '/hr/payroll-runs'
                ? [{ ...state.run }]
                : path === '/hr/salary-advances'
                  ? [{ ...state.advance }]
                  : path === '/hr/salary-payments'
                    ? [{ ...state.payment }]
                    : [];
    return { data: rows, total: opts?.query?.limit === 20 ? 21 : rows.length };
  });
  state.get.mockImplementation(async (path) =>
    path.includes('/payroll-runs/')
      ? { ...state.run }
      : path.includes('/salary-advances/')
        ? { ...state.advance }
        : { ...state.payment },
  );
  state.post.mockResolvedValue({ id: 'created' });
  state.patch.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
type User = ReturnType<typeof userEvent.setup>;
async function keep(user: User) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function resume(user: User, title: string, dialog: string) {
  await user.click(screen.getByRole('button', { name: 'Resume ' + title, exact: true }));
  return within(await screen.findByRole('dialog', { name: dialog }));
}
async function runAction(user: User, action = 'Record payment') {
  await user.click(await screen.findByRole('button', { name: 'Inspect PR-01' }));
  await user.click(screen.getByRole('button', { name: action, exact: true }));
  return within(await screen.findByRole('dialog', { name: action + ' · PR-01' }));
}
async function fillPayment(user: User) {
  const form = await runAction(user);
  await waitFor(() => expect(form.getByLabelText('Cash Desk account')).toBeEnabled());
  await user.selectOptions(form.getByLabelText('Cash Desk account'), 'bank');
  await setDateField('Payment date', '2026-09-01', user, form);
  return form;
}
async function fillReversal(user: User) {
  state.run = { ...state.run, status: 'PAID', cashMovements: [{ id: 'original-movement' }] };
  render(<App />);
  const form = await runAction(user, 'Reverse payment');
  await user.type(form.getByLabelText('Reason for reversal'), 'Returned payroll funds');
  await setDateField('Reversal date', '2026-09-02', user, form);
  return form;
}

describe('Payroll pay cycle continuity', () => {
  it('keeps a new run across navigation and retries creation without losing its pay cycle', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/payroll-runs?companyId=company&payrollPeriodId=period" />);
    await user.click(screen.getByRole('button', { name: 'New run' }));
    let form = within(await screen.findByRole('dialog', { name: 'New payroll run' }));
    await form.findByRole('option', { name: /September 2026/ });
    await user.selectOptions(form.getByLabelText('Run type'), 'BONUS');
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await screen.findByRole('heading', { name: 'Payroll overview' });
    expect(state.post).not.toHaveBeenCalled();
    form = await resume(user, 'New payroll run', 'New payroll run');
    await waitFor(() => expect(form.getByRole('button', { name: 'Create run' })).toBeEnabled());
    expect(form.getByLabelText(/Payroll period/)).toHaveValue('period');
    expect(form.getByLabelText('Run type')).toHaveValue('BONUS');
    state.post.mockRejectedValueOnce(new Error('Create unavailable'));
    await user.click(form.getByRole('button', { name: 'Create run' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Create unavailable');
    await user.click(form.getByRole('button', { name: 'Create run' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).toHaveBeenLastCalledWith('/hr/payroll-runs', {
      payrollPeriodId: 'period',
      companyId: 'company',
      payrollType: 'BONUS',
      createdById: 'operator',
    });
  });
  it('reloads period choices and refuses a kept run whose period is no longer available', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/payroll-runs?companyId=company&payrollPeriodId=period" />);
    await user.click(screen.getByRole('button', { name: 'New run' }));
    await screen.findByRole('dialog', { name: 'New payroll run' });
    await keep(user);
    state.periodAvailable = false;
    const form = await resume(user, 'New payroll run', 'New payroll run');
    await waitFor(() => expect(form.getByRole('button', { name: 'Create run' })).toBeEnabled());
    await user.click(form.getByRole('button', { name: 'Create run' }));
    expect(state.post).not.toHaveBeenCalled();
    expect(form.queryByRole('option', { name: /September 2026/ })).not.toBeInTheDocument();
  });
  it('requires a review of changed net pay before submitting a kept, unattempted payment', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillPayment(user);
    await keep(user);
    state.run = { ...state.run, totalNetPay: '900.25', updatedAt: 'v2' };
    const form = await resume(user, 'Record payment', 'Record payment · PR-01');
    await waitFor(() => expect(form.getByLabelText('Cash Desk account')).toHaveValue('bank'));
    expect(dateFieldValue(getDateField('Payment date', form))).toBe('2026-09-01');
    expect(form.getByText(/Net TZS 900.25/)).toBeInTheDocument();
    await user.click(form.getByRole('button', { name: 'Record payment' }));
    expect(state.patch).not.toHaveBeenCalled();
    expect(await form.findByRole('alert')).toHaveTextContent('Review the latest record');
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.patch).toHaveBeenCalledWith(
      '/hr/payroll-runs/run/pay',
      expect.objectContaining({
        cashDeskAccountId: 'bank',
        businessDate: '2026-09-01',
        requestId: expect.any(String),
      }),
    );
  });
  it('retries an ambiguous payment with the exact original request even after the run is paid and choices fail', async () => {
    const user = userEvent.setup();
    render(<App />);
    let form = await fillPayment(user);
    state.patch.mockRejectedValueOnce(new Error('Connection lost after submission'));
    await user.click(form.getByRole('button', { name: 'Record payment' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Connection lost');
    const original = structuredClone(state.patch.mock.calls[0]);
    expect(form.getByLabelText('Cash Desk account')).toBeDisabled();
    expect(getDateField('Payment date', form)).toHaveAttribute('aria-disabled', 'true');
    await keep(user);
    state.run = {
      ...state.run,
      status: 'PAID',
      updatedAt: 'v2',
      cashMovements: [{ id: 'committed-movement' }],
    };
    state.accountFailure = true;
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    form = await resume(user, 'Record payment', 'Record payment · PR-01');
    await form.findByText('Accounts unavailable');
    expect(form.getByText('Current status: paid')).toBeInTheDocument();
    expect(getDateField('Payment date', form)).toHaveAttribute('aria-disabled', 'true');
    expect(state.patch).toHaveBeenCalledTimes(1);
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
    expect(state.patch.mock.calls[1]).toEqual(original);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
  it('replays a kept reversal of an already reversed payment using its original movement, date and reason', async () => {
    const user = userEvent.setup();
    let form = await fillReversal(user);
    state.patch.mockRejectedValueOnce(new Error('Reversal response lost'));
    await user.click(form.getByRole('button', { name: 'Reverse payment' }));
    await form.findByText('Reversal response lost');
    const original = structuredClone(state.patch.mock.calls[0]);
    await keep(user);
    state.run = { ...state.run, status: 'APPROVED', cashMovements: [], updatedAt: 'v2' };
    form = await resume(user, 'Reverse payment', 'Reverse payment · PR-01');
    expect(form.getByLabelText('Reason for reversal')).toHaveValue('Returned payroll funds');
    expect(form.getByLabelText('Reason for reversal')).toBeDisabled();
    expect(state.patch).toHaveBeenCalledTimes(1);
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Reverse payment' }));
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
    expect(state.patch.mock.calls[1]).toEqual(original);
    expect(original).toEqual([
      '/hr/payroll-runs/run/reverse-payment',
      {
        movementId: 'original-movement',
        businessDate: '2026-09-02',
        reason: 'Returned payroll funds',
      },
    ]);
  });
  it('never retargets an unattempted reversal draft to a newer payment', async () => {
    const user = userEvent.setup();
    await fillReversal(user);
    await keep(user);
    state.run = { ...state.run, cashMovements: [{ id: 'new-movement' }], updatedAt: 'v2' };
    const form = await resume(user, 'Reverse payment', 'Reverse payment · PR-01');
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    expect(form.getByRole('button', { name: 'Reverse payment' })).toBeDisabled();
    expect(form.getByRole('alert')).toHaveTextContent('original payment');
    expect(state.patch).not.toHaveBeenCalled();
    await keep(user);
    expect(screen.getByRole('button', { name: 'Resume Reverse payment' })).toBeEnabled();
  }, 10_000);
  it('keeps an unreadable source recoverable and rechecks payment permissions before fetching it', async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await fillPayment(user);
    await keep(user);
    state.get.mockRejectedValueOnce(new Error('Run no longer accessible'));
    await user.click(screen.getByRole('button', { name: 'Resume Record payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Run no longer accessible');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    state.permissions.delete('journal_entries.post');
    view.rerender(<App />);
    await user.click(screen.getByRole('button', { name: 'Resume Record payment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current role cannot open');
    expect(state.get).toHaveBeenCalledTimes(1);
    state.permissions.add('journal_entries.post');
    view.rerender(<App />);
    await resume(user, 'Record payment', 'Record payment · PR-01');
    expect(state.get).toHaveBeenCalledTimes(2);
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('ignores a late source read after navigating away from its draft shelf', async () => {
    const user = userEvent.setup();
    render(<App />);
    await fillPayment(user);
    await keep(user);
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Resume Record payment' }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await act(async () => {
      resolve({ ...state.run });
    });
    expect(state.get.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Record payment' })).toBeEnabled();
  });
  it('revalidates a kept advance approval against the latest requested amount', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/salary-advances" />);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Review approval' }));
    let form = within(await screen.findByRole('dialog', { name: 'Approve advance · ADV-01' }));
    fireEvent.change(form.getByLabelText('Approved amount (TZS)'), { target: { value: '450' } });
    await keep(user);
    state.advance = { ...state.advance, amount: '400', updatedAt: 'v2' };
    form = await resume(user, 'Approve salary advance', 'Approve advance · ADV-01');
    expect(form.getByLabelText('Approved amount (TZS)')).toHaveValue(450);
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Approve advance' }));
    expect(await form.findByRole('alert')).toHaveTextContent('no more than the requested amount');
    expect(state.patch).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText('Approved amount (TZS)'), { target: { value: '350' } });
    await user.click(form.getByRole('button', { name: 'Approve advance' }));
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/hr/salary-advances/advance/approve', {
        approvedAmount: 350,
      }),
    );
  });
  it('preserves an advance request but prevents saving when its employee disappears', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/salary-advances" />);
    await user.click(screen.getByRole('button', { name: 'Request advance' }));
    let form = within(await screen.findByRole('dialog', { name: 'Request salary advance' }));
    await waitFor(() => expect(form.getByLabelText(/^Company/)).toBeEnabled());
    await user.selectOptions(form.getByLabelText(/^Company/), 'company');
    await form.findByRole('option', { name: /Alex Example/ });
    await user.selectOptions(form.getByLabelText(/^Employee/), 'employee');
    fireEvent.change(form.getByLabelText(/Amount \(TZS\)/), { target: { value: '300' } });
    await user.type(form.getByLabelText('Reason (optional)'), 'School fees');
    await keep(user);
    state.employeeAvailable = false;
    form = await resume(user, 'Request salary advance', 'Request salary advance');
    await waitFor(() => expect(form.getByLabelText(/^Employee/)).toBeEnabled());
    expect(form.getByLabelText(/Amount \(TZS\)/)).toHaveValue(300);
    expect(form.getByLabelText('Reason (optional)')).toHaveValue('School fees');
    await user.click(form.getByRole('button', { name: 'Request advance' }));
    expect(state.post).not.toHaveBeenCalled();
    await keep(user);
    state.employeeAvailable = true;
    form = await resume(user, 'Request salary advance', 'Request salary advance');
    await waitFor(() => expect(form.getByLabelText(/^Employee/)).toHaveValue('employee'));
    await user.click(form.getByRole('button', { name: 'Request advance' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/hr/salary-advances',
        expect.objectContaining({
          employeeId: 'employee',
          companyId: 'company',
          amount: 300,
          reason: 'School fees',
        }),
      ),
    );
  });
  it.each(['connected', 'reversed'])(
    'keeps reversal notes but blocks a salary record that becomes %s',
    async (change) => {
      const user = userEvent.setup();
      render(<App initial="/hr/salary-payments" />);
      await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
      await user.click(screen.getByRole('button', { name: 'Reverse record' }));
      let form = within(await screen.findByRole('dialog', { name: 'Reverse payment · SP-01' }));
      await user.type(form.getByLabelText('Reason (optional)'), 'Duplicate legacy record');
      await keep(user);
      state.payment = {
        ...state.payment,
        updatedAt: 'v2',
        ...(change === 'connected' ? { cashMovementId: 'movement' } : { status: 'REVERSED' }),
      };
      form = await resume(user, 'Reverse salary payment', 'Reverse payment · SP-01');
      expect(form.getByLabelText('Reason (optional)')).toHaveValue('Duplicate legacy record');
      await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
      expect(form.getByRole('button', { name: 'Reverse record' })).toBeDisabled();
      expect(state.patch).not.toHaveBeenCalled();
      await keep(user);
    },
  );
  it('retains run search, page and filters on return, but honors a new pay cycle deep link', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Inspect PR-01' });
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await user.type(screen.getByRole('searchbox'), 'PR');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({ query: expect.objectContaining({ search: 'PR' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    state.page.mockClear();
    await user.click(screen.getByRole('link', { name: 'Open runs' }));
    await screen.findByRole('button', { name: 'Inspect PR-01' });
    expect(screen.getByRole('searchbox')).toHaveValue('PR');
    const reads = state.page.mock.calls.filter(([path]) => path === '/hr/payroll-runs');
    expect(reads.length).toBeGreaterThan(0);
    expect(
      reads.every(
        ([, options]) =>
          options.query.companyId === 'company' &&
          options.query.page === 2 &&
          options.query.search === 'PR',
      ),
    ).toBe(true);
    await user.click(screen.getByRole('link', { name: 'Open other pay cycle' }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'other',
            payrollPeriodId: 'other-period',
            status: 'PAID',
            page: 1,
          }),
        }),
      ),
    );
  });
});

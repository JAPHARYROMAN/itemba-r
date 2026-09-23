import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PayrollRunsPage from '@/app/(dashboard)/hr/payroll-runs/page';
import PayrollEntriesPage from '@/app/(dashboard)/hr/payroll-entries/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  router: { push: vi.fn() },
  params: '',
  status: 'DRAFT',
  hr: null as string | null,
  finance: null as string | null,
  periodFailure: false,
  accountFailure: false,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => state.router,
  useSearchParams: () => new URLSearchParams(state.params),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator' },
    hasPermission: (...permissions: string[]) => permissions.every((p) => state.permissions.has(p)),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
}));
vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companyOptions: [
      { value: 'company', label: 'Company' },
      { value: 'other', label: 'Other' },
    ],
    loading: false,
    error: '',
    retry: vi.fn(),
  }),
}));
const period = {
  id: 'period',
  name: 'September 2026',
  payrollPeriodCode: 'PP-09',
  companyId: 'company',
  company: { name: 'Company' },
};
const run = () => ({
  id: 'run',
  payrollRunNumber: 'PR-01',
  companyId: 'company',
  company: { name: 'Company' },
  payrollPeriodId: 'period',
  payrollPeriod: { name: 'September 2026' },
  payrollType: 'REGULAR',
  totalGrossPay: '1000.25',
  totalNetPay: '800.50',
  status: state.status,
  cashMovements: state.status === 'PAID' ? [{ id: 'cash-payment' }] : [],
  hrApprovedById: state.hr,
  financeApprovedById: state.finance,
});
const entry = {
  id: 'entry',
  employee: { fullName: 'Alex Example', employeeCode: 'EMP-1' },
  company: { name: 'Company' },
  payrollRunId: 'run',
  payrollRun: { id: 'run', payrollRunNumber: 'PR-01' },
  status: 'CALCULATED',
  basePay: '900',
  attendancePay: '0',
  overtimePay: '50.25',
  totalAllowances: '50',
  grossPay: '1000.25',
  totalDeductions: '199.75',
  netPay: '800.50',
  allowances: [{ id: 'allowance', amount: '50', allowanceType: { name: 'Transport' } }],
  deductions: [{ id: 'deduction', amount: '20', deductionType: { name: 'Advance' } }],
};
const manifest = {
  runNumber: 'PR-01',
  companyName: 'Company',
  generatedAt: '2026-09-01T00:00:00Z',
  summary: { totalEmployees: 1, viaBank: 1, viaMobileMoney: 0, unmapped: 0 },
  files: [
    {
      filename: 'bank.csv',
      mimeType: 'text/csv',
      rowCount: 1,
      total: 800.5,
      content: 'name,amount\nExample,800.50',
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.params = '';
  state.status = 'DRAFT';
  state.hr = null;
  state.finance = null;
  state.periodFailure = false;
  state.accountFailure = false;
  state.permissions = new Set([
    'payroll.view',
    'payroll.manage',
    'payroll.calculate',
    'payroll.submit',
    'payroll.approve.hr',
    'payroll.approve.finance',
    'payroll.approve',
    'payroll.cancel',
    'payroll.pay',
    'cash_desk.view',
    'cash_desk.record',
    'journal_entries.create',
    'journal_entries.post',
    'cash_desk.reverse',
    'journal_entries.reverse',
    'chart_of_accounts.view',
  ]);
  state.page.mockImplementation(async (path, options) => {
    if (path === '/hr/payroll-periods') {
      if (state.periodFailure) throw new Error('Periods unavailable');
      return { data: [period], total: 1 };
    }
    if (path === '/cash-desk/accounts') {
      if (state.accountFailure) throw new Error('Accounts unavailable');
      return {
        data: [
          {
            id: 'bank',
            name: 'Bank account',
            currency: 'TZS',
            balance: '1000',
            erpCashAccountId: 'erp-bank',
          },
          { id: 'income', name: 'Unconnected', currency: 'TZS', balance: '1000' },
        ],
        total: 2,
      };
    }
    if (path === '/hr/payroll-entries') return { data: [entry], total: 25 };
    return { data: [run()], total: options.query.limit === 100 ? 1 : 25 };
  });
  state.post.mockImplementation(async (path) =>
    path.endsWith('/disbursement-files') ? manifest : {},
  );
  state.patch.mockResolvedValue({ status: 'APPROVED' });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const mount = (entries = false) =>
  render(
    <UnsavedWorkProvider>
      {entries ? <PayrollEntriesPage /> : <PayrollRunsPage />}
    </UnsavedWorkProvider>,
  );
async function inspect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Inspect PR-01' }));
}
describe('Payroll run and entry workspaces', () => {
  it('opens the company and status selected on the Payroll overview', async () => {
    state.params = 'companyId=company&status=APPROVED';
    mount();
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({
          query: expect.objectContaining({ companyId: 'company', status: 'APPROVED' }),
        }),
      ),
    );
  });
  it('blocks payroll reads and choices without payroll.view', () => {
    state.permissions = new Set(['payroll.manage']);
    mount();
    expect(screen.getByText('Your role cannot view payroll runs.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('hides calculation, creation and disbursement controls from read-only users', async () => {
    state.permissions = new Set(['payroll.view']);
    state.status = 'CALCULATED';
    const user = userEvent.setup();
    mount();
    await inspect(user);
    expect(screen.queryByRole('button', { name: 'New run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Recalculate run' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Disbursement files' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View entries' }));
    expect(state.router.push).toHaveBeenCalledWith('/hr/payroll-entries?payrollRunId=run');
  });
  it('preserves a period deep link through server pagination and search, and clears it on company change', async () => {
    state.params = 'payrollPeriodId=period';
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({
          query: expect.objectContaining({ page: 2, payrollPeriodId: 'period' }),
        }),
      ),
    );
    await user.type(screen.getByRole('searchbox'), 'PR');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({
          query: expect.objectContaining({ page: 1, search: 'PR', payrollPeriodId: 'period' }),
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'other');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({
          query: expect.objectContaining({ companyId: 'other', payrollPeriodId: '' }),
        }),
      ),
    );
  });
  it('guards a new run and retries creation with the selected period company and run type', async () => {
    state.post.mockRejectedValueOnce(new Error('Create unavailable'));
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'Inspect PR-01' });
    await user.click(screen.getByRole('button', { name: 'New run' }));
    await screen.findByRole('dialog', { name: 'New payroll run' });
    await within(screen.getByRole('dialog')).findByRole('option', { name: /PP-09/ });
    await user.selectOptions(screen.getByRole('combobox', { name: /Payroll period/ }), 'period');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Run type' }), 'BONUS');
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByRole('combobox', { name: 'Run type' })).toHaveValue('BONUS');
    await user.click(screen.getByRole('button', { name: 'Create run' }));
    expect(await screen.findByText('Create unavailable')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create run' }));
    expect(state.post).toHaveBeenLastCalledWith('/hr/payroll-runs', {
      payrollPeriodId: 'period',
      companyId: 'company',
      payrollType: 'BONUS',
      createdById: 'operator',
    });
    expect(await screen.findByText(/Payroll run created/)).toBeInTheDocument();
  });
  it('keeps failed period choices visible and blocks creating a run from them', async () => {
    state.periodFailure = true;
    const user = userEvent.setup();
    mount();
    await screen.findByText('Periods unavailable');
    await user.click(screen.getByRole('button', { name: 'New run' }));
    await screen.findByRole('dialog', { name: 'New payroll run' });
    expect(screen.getByRole('button', { name: 'Create run' })).toBeDisabled();
    state.periodFailure = false;
    await user.click(screen.getByRole('button', { name: 'Retry choices' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create run' })).toBeEnabled());
  });
  it('requires confirmation to calculate and preserves a retryable error', async () => {
    state.patch
      .mockRejectedValueOnce(new Error('Calculation unavailable'))
      .mockResolvedValue({ status: 'CALCULATED' });
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'Calculate run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Calculate run · PR-01' });
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Calculate run' }));
    expect(await within(dialog).findByText('Calculation unavailable')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Calculate run' }));
    expect(state.patch).toHaveBeenLastCalledWith('/hr/payroll-runs/run/calculate', undefined);
    expect(await screen.findByText(/Payroll calculated/)).toBeInTheDocument();
  });
  it('shows only outstanding sign-offs and preserves maker/checker errors', async () => {
    state.status = 'SUBMITTED';
    state.hr = 'operator';
    state.patch.mockRejectedValueOnce(
      new Error('The same user cannot sign off both HR and Finance'),
    );
    const user = userEvent.setup();
    mount();
    await inspect(user);
    expect(screen.queryByRole('button', { name: 'HR sign-off' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Finance sign-off' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Finance sign-off' }));
    expect(
      await within(dialog).findByText('The same user cannot sign off both HR and Finance'),
    ).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith('/hr/payroll-runs/run/approve-finance', undefined);
  });
  it('reports a first sign-off as pending rather than complete approval', async () => {
    state.status = 'SUBMITTED';
    state.patch.mockResolvedValue({ status: 'SUBMITTED' });
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'HR sign-off' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'HR sign-off' }),
    );
    expect(
      await screen.findByText('Sign-off recorded. The other approval is still required.'),
    ).toBeInTheDocument();
  });
  it('guards cancellation notes and sends the reason only after confirmation', async () => {
    state.status = 'APPROVED';
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'Cancel run' }));
    let dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Replace this cycle');
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox')).toHaveValue('Replace this cycle');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel run' }));
    expect(state.patch).toHaveBeenCalledWith('/hr/payroll-runs/run/cancel', {
      reason: 'Replace this cycle',
    });
  });
  it('loads company-specific payment accounts, retains failed selection and sends the selected account', async () => {
    state.status = 'APPROVED';
    state.patch.mockRejectedValueOnce(new Error('Posting unavailable'));
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Bank account · TZS 1,000' });
    expect(screen.queryByRole('option', { name: /Unconnected/ })).not.toBeInTheDocument();
    expect(state.page).toHaveBeenCalledWith(
      '/cash-desk/accounts',
      expect.objectContaining({ query: expect.objectContaining({ companyId: 'company' }) }),
    );
    await user.selectOptions(within(dialog).getByRole('combobox'), 'bank');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByText('Posting unavailable')).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox')).toHaveValue('bank');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(state.patch).toHaveBeenLastCalledWith('/hr/payroll-runs/run/pay', {
      cashDeskAccountId: 'bank',
      businessDate: expect.any(String),
      requestId: expect.any(String),
    });
  });
  it('prevents payment when connected account lookup fails', async () => {
    state.status = 'APPROVED';
    state.accountFailure = true;
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Accounts unavailable/)).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox')).toHaveValue('');
    await user.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(within(dialog).getByRole('button', { name: 'Record payment' })).toBeDisabled();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('requires a reason and reverses the specific connected payment', async () => {
    state.status = 'PAID';
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'Reverse payment' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Reverse payment' })).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'Bank returned payment');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse payment' }));
    expect(state.patch).toHaveBeenCalledWith('/hr/payroll-runs/run/reverse-payment', {
      movementId: 'cash-payment',
      businessDate: expect.any(String),
      reason: 'Bank returned payment',
    });
  });
  it('keeps a failed files dialog open, retries and offers the returned download', async () => {
    state.status = 'CALCULATED';
    state.post.mockRejectedValueOnce(new Error('Files unavailable'));
    const user = userEvent.setup();
    mount();
    await inspect(user);
    await user.click(screen.getByRole('button', { name: 'Disbursement files' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Files unavailable')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }));
    expect(
      await within(dialog).findByRole('button', { name: 'Download bank.csv' }),
    ).toBeInTheDocument();
    expect(state.post).toHaveBeenLastCalledWith(
      '/hr/payroll-runs/run/disbursement-files',
      undefined,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
  it('never offers cancellation or payment on paid runs', async () => {
    state.status = 'PAID';
    const user = userEvent.setup();
    mount();
    await inspect(user);
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel run' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disbursement files' })).toBeInTheDocument();
  });
  it('paginates run-scoped entries and displays the full employee breakdown with payslip navigation', async () => {
    state.params = 'runId=run';
    const user = userEvent.setup();
    mount(true);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.getByText('Transport · TZS 50.00')).toBeInTheDocument();
    expect(screen.getByText('Advance · TZS 20.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View payslip' }));
    expect(state.router.push).toHaveBeenCalledWith('/hr/payslips/entry');
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-entries',
        expect.objectContaining({
          query: expect.objectContaining({ payrollRunId: 'run', page: 2 }),
        }),
      ),
    );
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Alex' } });
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/payroll-entries',
        expect.objectContaining({
          query: expect.objectContaining({ payrollRunId: 'run', page: 1, search: 'Alex' }),
        }),
      ),
    );
  });
});

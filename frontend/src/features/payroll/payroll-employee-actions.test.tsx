import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import {
  WorkspaceDraftsProvider,
  useWorkspaceDrafts,
} from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceNavigationProvider,
  WorkspaceLink,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import { PayrollWorkspace } from './payroll-workspace';
import { EmployeeDetail } from './employee-detail';
import type { MobileMoney } from './mobile-money-types';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  accounts: [] as MobileMoney[],
  moneyError: false,
  pending: false,
  employeeStatus: 'ACTIVE',
  page: vi.fn(),
  updated: false,
  users: true,
  sourceError: false,
  usersError: false,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hr/employees/employee',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company' },
    hasPermission: (permission: string) => state.permissions.has(permission),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendGet: state.get,
  backendPut: state.put,
  backendPost: state.post,
  backendPatch: state.patch,
  backendPage: state.page,
}));
function employee() {
  return {
    id: 'employee',
    employeeCode: 'EMP-1',
    company: { id: 'company', name: 'Company A' },
    firstName: 'Alex',
    lastName: state.updated ? 'Latest' : 'Example',
    fullName: state.updated ? 'Alex Latest' : 'Alex Example',
    email: state.updated ? 'latest@example.test' : 'before@example.test',
    employmentStatus: state.employeeStatus,
    terminationRequestedAt: state.pending ? '2026-09-20T11:00:00Z' : null,
    terminationReason: state.pending ? 'Existing request' : null,
    baseSalary: '150000',
    salaryCurrency: 'TZS',
    bankName: state.updated ? 'Latest Bank' : 'Original Bank',
    bankAccountNumber: 'TEST-ACCOUNT',
    bankAccountName: state.updated ? 'Latest account name' : 'Original account name',
    tin: 'TEST-TIN',
    dependents: 2,
    heslbBorrower: true,
    updatedAt: state.updated ? '2026-09-20T10:00:00Z' : '2026-09-19T10:00:00Z',
  };
}
function DraftEvidence() {
  const { drafts } = useWorkspaceDrafts('payroll');
  return (
    <output data-testid="draft-values">
      {JSON.stringify(drafts.map((draft) => draft.values))}
    </output>
  );
}
function Routes() {
  const path = useWorkspacePathname();
  return (
    <>
      <nav aria-label="Test destinations">
        <WorkspaceLink href="/payroll">Open home</WorkspaceLink>
        <WorkspaceLink href="/hr/employees/employee">Open employee</WorkspaceLink>
      </nav>
      {path === '/payroll' ? <h1>Payroll overview</h1> : <EmployeeDetail employeeId="employee" />}
    </>
  );
}
function App({ companion = false }: { companion?: boolean }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <DraftEvidence />
          <UnsavedWorkScope id="primary">
            <section aria-label="Primary Payroll">
              <WorkspaceNavigationProvider
                appId="payroll"
                initialHref="/hr/employees/employee"
                ownsPath={(path) => path === '/payroll' || path.startsWith('/hr/')}
              >
                <PayrollWorkspace>
                  <Routes />
                </PayrollWorkspace>
              </WorkspaceNavigationProvider>
            </section>
          </UnsavedWorkScope>
          {companion && (
            <UnsavedWorkScope id="legacy">
              <section aria-label="Other employee window">
                <EmployeeDetail employeeId="employee" />
              </section>
            </UnsavedWorkScope>
          )}
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.updated = false;
  state.accounts = [];
  state.moneyError = false;
  state.pending = false;
  state.employeeStatus = 'ACTIVE';
  state.users = true;
  state.sourceError = false;
  state.usersError = false;
  state.permissions = new Set([
    'employees.view',
    'employees.update',
    'employees.sensitive.view',
    'employees.termination.request',
    'employment_contracts.view',
  ]);
  state.get.mockImplementation(async (path) => {
    if (path === '/hr/employees/employee') {
      if (state.sourceError) throw new Error('Employee is no longer available');
      return employee();
    }
    if (path === '/hr/mobile-money-accounts') {
      if (state.moneyError) throw new Error('Account list unavailable');
      return state.accounts.map((row) => ({ ...row }));
    }
    if (path === '/hr/employees/linkable-users') {
      if (state.usersError) throw new Error('Account directory unavailable');
      return state.users
        ? [{ id: 'new-user', fullName: 'New account', email: 'new@example.test' }]
        : [];
    }
    return [];
  });
  state.put.mockResolvedValue({});
  state.post.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  state.page.mockResolvedValue({ data: [], total: 0 });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  history.replaceState({}, '', '/hr/employees/employee');
});

const account: MobileMoney = {
  id: 'account',
  employeeId: 'employee',
  provider: 'M_PESA',
  msisdn: '+255712345678',
  accountName: 'Original name',
  notes: 'Original notes',
  isPrimary: false,
  status: 'ACTIVE',
  updatedAt: '2026-09-19T10:00:00Z',
};
async function openMobile(edit = false) {
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Alex Example' });
  await user.click(screen.getByRole('tab', { name: 'Banking & Mobile Money' }));
  if (edit) {
    await user.click(await screen.findByRole('button', { name: 'Inspect M-Pesa (Vodacom)' }));
    await user.click(screen.getByRole('button', { name: 'Edit account' }));
  } else await user.click(screen.getByRole('button', { name: 'Add account' }));
  const title = edit ? 'Edit mobile money account' : 'Add mobile money account';
  const form = within(await screen.findByRole('dialog', { name: title }));
  await waitFor(() => expect(form.getByLabelText(/Mobile number/)).toBeEnabled());
  return { user, title, form };
}
async function openTermination() {
  const user = userEvent.setup();
  await screen.findByRole('heading', { name: 'Alex Example' });
  await user.click(screen.getByRole('button', { name: 'Request Termination', exact: true }));
  return {
    user,
    title: 'Request Termination',
    form: within(await screen.findByRole('dialog', { name: 'Request Termination' })),
  };
}
async function keepAndLeave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await user.click(screen.getByRole('link', { name: 'Open home' }));
  await screen.findByRole('heading', { name: 'Payroll overview' });
}
async function resume(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
  return within(await screen.findByRole('dialog', { name: title }));
}

describe('Employee payment-account and termination drafts', () => {
  it('retains a new account and primary choice across app navigation, without replaying a failed submission', async () => {
    render(<App />);
    const { user, title, form } = await openMobile();
    fireEvent.change(form.getByLabelText(/Mobile number/), { target: { value: '0712345678' } });
    await user.click(form.getByRole('checkbox', { name: 'Set as primary disbursement account' }));
    await user.type(form.getByLabelText('Notes (optional)'), 'Draft account');
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    const resumed = await resume(user, title);
    expect(resumed.getByLabelText(/Mobile number/)).toHaveValue('0712345678');
    expect(
      resumed.getByRole('checkbox', { name: 'Set as primary disbursement account' }),
    ).toBeChecked();
    expect(state.post).not.toHaveBeenCalled();
    state.post.mockRejectedValueOnce(new Error('Account save unavailable'));
    await user.click(resumed.getByRole('button', { name: 'Add', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('Account save unavailable');
    expect(resumed.getByLabelText('Notes (optional)')).toHaveValue('Draft account');
    await user.click(resumed.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument(),
    );
    expect(state.post).toHaveBeenCalledTimes(2);
    expect(state.post).toHaveBeenLastCalledWith(
      '/hr/mobile-money-accounts',
      expect.objectContaining({
        employeeId: 'employee',
        provider: 'M_PESA',
        msisdn: '0712345678',
        isPrimary: true,
        notes: 'Draft account',
      }),
    );
    expect(JSON.parse(screen.getByTestId('draft-values').textContent!)).toEqual([]);
  });
  it('reviews changed account details and a new primary, then sends only explicit edits', async () => {
    state.accounts = [account];
    render(<App />);
    const { user, title, form } = await openMobile(true);
    fireEvent.change(form.getByLabelText('Notes (optional)'), { target: { value: 'Draft notes' } });
    await user.click(form.getByRole('checkbox', { name: 'Set as primary disbursement account' }));
    await keepAndLeave(user);
    expect(JSON.parse(screen.getByTestId('draft-values').textContent!)).toEqual([
      { notes: 'Draft notes', isPrimary: true },
    ]);
    state.accounts = [
      {
        ...account,
        msisdn: '+255700000001',
        accountName: 'Latest name',
        updatedAt: '2026-09-20T10:00:00Z',
      },
      {
        ...account,
        id: 'second',
        provider: 'AIRTEL_MONEY',
        msisdn: '+255700000002',
        isPrimary: true,
      },
    ];
    const resumed = await resume(user, title);
    expect(resumed.getByLabelText(/Mobile number/)).toHaveValue('+255700000001');
    expect(resumed.getByLabelText('Account name (optional)')).toHaveValue('Latest name');
    expect(resumed.getByText(/Current primary account: Airtel Money/)).toBeVisible();
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('Review the latest record');
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(resumed.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/hr/mobile-money-accounts/account', {
        notes: 'Draft notes',
        isPrimary: true,
      }),
    );
  });
  it('keeps an edited account draft when its source was removed', async () => {
    state.accounts = [account];
    render(<App />);
    const { user, title, form } = await openMobile(true);
    await user.type(form.getByLabelText('Notes (optional)'), ' retained');
    await keepAndLeave(user);
    state.accounts = [];
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume ' + title })).toBeEnabled();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('reloads provider availability before adding a retained account and recovers from a read failure', async () => {
    render(<App />);
    const { user, title, form } = await openMobile();
    fireEvent.change(form.getByLabelText(/Mobile number/), { target: { value: '0712345678' } });
    await keepAndLeave(user);
    state.moneyError = true;
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Account list unavailable');
    state.moneyError = false;
    state.accounts = [account];
    const resumed = await resume(user, title);
    await user.click(resumed.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(resumed.getByRole('button', { name: 'Add', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('already has a M-Pesa');
    expect(state.post).not.toHaveBeenCalled();
    await user.selectOptions(resumed.getByLabelText('Provider'), 'AIRTEL_MONEY');
    await user.click(resumed.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/hr/mobile-money-accounts',
        expect.objectContaining({ provider: 'AIRTEL_MONEY' }),
      ),
    );
  });
  it('keeps termination reason and date for a requester without employee-edit permission, and retries only on explicit submit', async () => {
    state.permissions.delete('employees.update');
    render(<App />);
    const { user, title, form } = await openTermination();
    await user.type(form.getByLabelText('Termination reason'), 'End of contract');
    await setDateField(/Termination date/, '2026-10-01', user, form);
    state.patch.mockRejectedValueOnce(new Error('Request unavailable'));
    await user.click(form.getByRole('button', { name: title, exact: true }));
    expect(await form.findByRole('alert')).toHaveTextContent('Request unavailable');
    await keepAndLeave(user);
    state.updated = true;
    const resumed = await resume(user, title);
    expect(resumed.getByLabelText('Termination reason')).toHaveValue('End of contract');
    expect(dateFieldValue(getDateField(/Termination date/, resumed))).toBe('2026-10-01');
    expect(state.patch).toHaveBeenCalledTimes(1);
    await user.click(resumed.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(resumed.getByRole('button', { name: title, exact: true }));
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
    expect(state.patch).toHaveBeenLastCalledWith('/hr/employees/employee/request-termination', {
      reason: 'End of contract',
      terminationDate: '2026-10-01',
    });
    expect(JSON.parse(screen.getByTestId('draft-values').textContent!)).toEqual([]);
  });
  it.each(['pending', 'terminated'])(
    'blocks a resumed termination draft when the employee is %s',
    async (status) => {
      render(<App />);
      const { user, title, form } = await openTermination();
      await user.type(form.getByLabelText('Termination reason'), 'My draft reason');
      await keepAndLeave(user);
      state.updated = true;
      state.pending = status === 'pending';
      state.employeeStatus = status === 'terminated' ? 'TERMINATED' : 'ACTIVE';
      const resumed = await resume(user, title);
      expect(resumed.getByRole('alert')).toHaveTextContent(
        status === 'pending' ? 'already awaiting approval' : 'already terminated',
      );
      expect(resumed.getByRole('button', { name: title, exact: true })).toBeDisabled();
      expect(resumed.getByLabelText('Termination reason')).toHaveValue('My draft reason');
      expect(state.patch).not.toHaveBeenCalled();
    },
  );
  it('requires the termination permission again when resuming a request', async () => {
    const view = render(<App />);
    const { user, title, form } = await openTermination();
    await user.type(form.getByLabelText('Termination reason'), 'Draft reason');
    await keepAndLeave(user);
    state.permissions.delete('employees.termination.request');
    view.rerender(<App />);
    state.get.mockClear();
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    expect(await screen.findByRole('alert')).toHaveTextContent('current role');
    expect(state.get).not.toHaveBeenCalled();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('retains related-record page and selection, refreshes details, and clamps a removed page', async () => {
    let total = 21;
    state.page.mockImplementation(async (_path, options) => ({
      total,
      data:
        options.query.page === 2 && total === 1
          ? []
          : [
              {
                id: 'contract-' + options.query.page,
                contractCode: 'CON-' + options.query.page,
                contractType: state.updated ? 'FIXED_TERM' : 'PERMANENT',
                status: 'ACTIVE',
              },
            ],
    }));
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole('heading', { name: 'Alex Example' });
    await user.click(screen.getByRole('tab', { name: 'Contracts' }));
    await screen.findByRole('button', { name: 'Inspect CON-1' });
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await user.click(await screen.findByRole('button', { name: 'Inspect CON-2' }));
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    state.updated = true;
    await user.click(screen.getByRole('tab', { name: 'Contracts' }));
    await screen.findByRole('button', { name: 'Inspect CON-2' });
    expect(
      within(screen.getByRole('complementary', { name: 'Record details' })).getByRole('heading', {
        name: 'CON-2',
      }),
    ).toBeVisible();
    expect(state.page).toHaveBeenLastCalledWith(
      '/hr/employment-contracts',
      expect.objectContaining({ query: { employeeId: 'employee', page: 2, limit: 20 } }),
    );
    expect(screen.getAllByText('FIXED TERM').length).toBeGreaterThan(0);
    await user.click(screen.getByRole('tab', { name: 'Profile' }));
    total = 1;
    await user.click(screen.getByRole('tab', { name: 'Contracts' }));
    await screen.findByRole('button', { name: 'Inspect CON-1' });
    expect(screen.queryByRole('heading', { name: 'CON-2' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next', exact: true })).not.toBeInTheDocument();
  });
});

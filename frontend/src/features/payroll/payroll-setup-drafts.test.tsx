import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Periods from '@/app/(dashboard)/hr/payroll-periods/page';
import Types from '@/app/(dashboard)/hr/leave-types/page';
import Balances from '@/app/(dashboard)/hr/leave-balances/page';
import Assignments from '@/app/(dashboard)/hr/employee-assignments/page';
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
  put: vi.fn(),
  employeeAvailable: true,
  typeActive: true,
  branchAvailable: true,
  companyAvailable: true,
  emptyPage: false,
  type: {} as Record<string, unknown>,
  balance: {} as Record<string, unknown>,
  assignment: {} as Record<string, unknown>,
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
  backendPut: state.put,
}));
const destinations = {
  periods: '/hr/payroll-periods',
  types: '/hr/leave-types',
  balances: '/hr/leave-balances',
  assignments: '/hr/employee-assignments',
};
type View = keyof typeof destinations;
function Pages() {
  const path = useWorkspacePathname();
  return (
    <PayrollDraftWorkspace viewKey={path}>
      <nav aria-label="Destinations">
        <WorkspaceLink href="/payroll">Open home</WorkspaceLink>
        {Object.entries(destinations).map(([name, href]) => (
          <WorkspaceLink key={name} href={href}>
            Open {name}
          </WorkspaceLink>
        ))}
      </nav>
      {path === destinations.periods ? (
        <Periods />
      ) : path === destinations.types ? (
        <Types />
      ) : path === destinations.balances ? (
        <Balances />
      ) : path === destinations.assignments ? (
        <Assignments />
      ) : (
        <h1>Payroll overview</h1>
      )}
    </PayrollDraftWorkspace>
  );
}
function App({ initial = 'periods' }: { initial?: View }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="primary">
            <WorkspaceNavigationProvider
              appId="payroll"
              initialHref={destinations[initial]}
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
    'leave_types.view',
    'leave_types.manage',
    'leave_balances.view',
    'leave_balances.manage',
    'employees.assignments.manage',
    'employees.view',
  ]);
  state.employeeAvailable =
    state.typeActive =
    state.branchAvailable =
    state.companyAvailable =
      true;
  state.emptyPage = false;
  const company = { id: 'company', name: 'Company A', code: 'A' };
  const employee = { id: 'employee', fullName: 'Alex Example', employeeCode: 'EMP-1' };
  state.type = {
    id: 'type',
    companyId: 'company',
    company,
    name: 'Annual leave',
    code: 'ANNUAL',
    paid: true,
    annualAllowanceDays: 21,
    carryForwardAllowed: true,
    isActive: true,
    updatedAt: 'v1',
  };
  state.balance = {
    id: 'balance',
    companyId: 'company',
    company,
    employeeId: 'employee',
    employee,
    leaveTypeId: 'type',
    leaveType: { id: 'type', name: 'Annual leave' },
    year: 2026,
    allocatedDays: '21',
    carriedForwardDays: '2',
    usedDays: '4',
    notes: 'Initial allocation',
    updatedAt: 'v1',
  };
  state.assignment = {
    id: 'assignment',
    employeeId: 'employee',
    employee,
    companyId: 'company',
    company,
    divisionId: 'division',
    branchId: 'branch',
    assignmentContextType: 'BRANCH',
    startDate: '2026-09-01T08:00:12.123Z',
    endDate: null,
    status: 'INACTIVE',
    approvalStatus: 'APPROVED',
    notes: 'Placement',
    updatedAt: 'v1',
  };
  state.page.mockImplementation(async (path, opts) => {
    const rows =
      path === '/companies'
        ? state.companyAvailable
          ? [company]
          : []
        : path === '/hr/employees'
          ? state.employeeAvailable
            ? [{ ...employee, companyId: 'company' }]
            : []
          : path === '/divisions'
            ? [{ id: 'division', companyId: 'company', name: 'Retail', code: 'RET' }]
            : path === '/branches'
              ? state.branchAvailable
                ? [
                    {
                      id: 'branch',
                      companyId: 'company',
                      divisionId: 'division',
                      name: 'Main branch',
                    },
                  ]
                : []
              : path === '/hr/leave-types'
                ? [{ ...state.type, isActive: state.typeActive }]
                : path === '/hr/leave-balances'
                  ? [{ ...state.balance }]
                  : path === '/hr/employee-assignments'
                    ? [{ ...state.assignment }]
                    : path === '/hr/payroll-periods'
                      ? [
                          {
                            id: 'period',
                            payrollPeriodCode: 'PP-01',
                            name: 'September 2026',
                            company,
                            status: 'OPEN',
                          },
                        ]
                      : [];
    return {
      data: state.emptyPage && opts?.query?.limit === 20 && opts.query.page > 1 ? [] : rows,
      total: opts?.query?.limit === 20 && !state.emptyPage ? 21 : rows.length,
    };
  });
  state.get.mockImplementation(async (path) =>
    path.includes('/leave-types/')
      ? { ...state.type }
      : path.includes('/leave-balances/')
        ? { ...state.balance }
        : { ...state.assignment },
  );
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
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
async function resume(user: User, title: string, dialog = title) {
  await user.click(screen.getByRole('button', { name: 'Resume ' + title, exact: true }));
  return within(await screen.findByRole('dialog', { name: dialog }));
}
async function edit(user: User, name: string, action: string) {
  await user.click(await screen.findByRole('button', { name: 'Inspect ' + name }));
  await user.click(screen.getByRole('button', { name: action, exact: true }));
  return within(await screen.findByRole('dialog', { name: action }));
}
async function newPeriod(user: User) {
  await user.click(screen.getByRole('button', { name: 'New period' }));
  const form = within(await screen.findByRole('dialog', { name: 'New payroll period' }));
  await waitFor(() => expect(form.getByLabelText(/^Company/)).toBeEnabled());
  await user.selectOptions(form.getByLabelText(/^Company/), 'company');
  await user.type(form.getByLabelText(/^Name/), 'October 2026');
  await setDateField(/^Start date/, '2026-10-01', user, form);
  await setDateField(/^End date/, '2026-10-31', user, form);
  await setDateField('Payment date', '2026-11-01', user, form);
  return form;
}
async function newAssignment(user: User) {
  await user.click(screen.getByRole('button', { name: 'New assignment' }));
  const form = within(await screen.findByRole('dialog', { name: 'New assignment' }));
  await waitFor(() => expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled());
  await user.selectOptions(form.getByLabelText(/^Employee/), 'employee');
  await user.selectOptions(form.getByLabelText(/^Destination company/), 'company');
  await form.findByRole('option', { name: /Retail/ });
  await waitFor(() => expect(form.getByLabelText('Division')).toBeEnabled());
  await user.selectOptions(form.getByLabelText('Division'), 'division');
  await user.selectOptions(form.getByLabelText('Branch'), 'branch');
  await user.selectOptions(form.getByLabelText('Assignment context'), 'BRANCH');
  await setDateField(/^Start date/, '2026-10-01', user, form);
  await user.type(form.getByLabelText('Notes'), 'Branch placement to finish');
  return form;
}

describe('Payroll setup continuity', () => {
  it('resumes a new leave category with its policy settings from Payroll home', async () => {
    const user = userEvent.setup();
    render(<App initial="types" />);
    await user.click(screen.getByRole('button', { name: 'New leave type' }));
    let form = within(await screen.findByRole('dialog', { name: 'New leave type' }));
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save leave type' })).toBeEnabled(),
    );
    await user.selectOptions(form.getByLabelText(/^Company/), 'company');
    await user.type(form.getByLabelText(/^Name/), 'Study leave');
    await user.type(form.getByLabelText(/^Code/), 'STUDY');
    await user.selectOptions(form.getByLabelText('Paid leave'), 'false');
    await user.selectOptions(form.getByLabelText('Allow carry forward'), 'true');
    fireEvent.change(form.getByLabelText('Annual allowance days'), { target: { value: '10' } });
    await keep(user);
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    form = await resume(user, 'New leave type');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save leave type' })).toBeEnabled(),
    );
    expect(form.getByLabelText(/^Code/)).toHaveValue('STUDY');
    expect(form.getByLabelText('Paid leave')).toHaveValue('false');
    expect(form.getByLabelText('Allow carry forward')).toHaveValue('true');
    expect(state.post).not.toHaveBeenCalled();
    await user.click(form.getByRole('button', { name: 'Save leave type' }));
    expect(state.post).toHaveBeenCalledWith('/hr/leave-types', {
      companyId: 'company',
      name: 'Study leave',
      code: 'STUDY',
      paid: false,
      carryForwardAllowed: true,
      isActive: true,
      annualAllowanceDays: 10,
    });
  });
  it.each([
    ['periods', 'New period', 'New payroll period', 'Create period', 'payroll.manage'],
    ['types', 'New leave type', 'New leave type', 'Save leave type', 'leave_types.manage'],
    ['balances', 'Allocate leave', 'Allocate leave balance', 'Save', 'leave_balances.manage'],
    [
      'assignments',
      'New assignment',
      'New assignment',
      'Save assignment',
      'employees.assignments.manage',
    ],
  ] as const)(
    'explains permission loss while the %s editor is already open',
    async (initial, opener, title, save, permission) => {
      const user = userEvent.setup();
      const view = render(<App initial={initial} />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: opener, exact: true })).toBeEnabled(),
      );
      await user.click(screen.getByRole('button', { name: opener, exact: true }));
      const form = within(await screen.findByRole('dialog', { name: title }));
      state.permissions.delete(permission);
      view.rerender(<App initial={initial} />);
      expect(form.getByRole('button', { name: save, exact: true })).toBeDisabled();
      expect(form.getByRole('alert')).toHaveTextContent('Your current role cannot');
      await keep(user);
      expect(screen.getByRole('button', { name: 'Resume ' + title })).toBeEnabled();
      expect(state.post).not.toHaveBeenCalled();
    },
  );
  it.each(['balances', 'assignments'] as const)(
    'does not read employee choices for %s without directory access',
    async (initial) => {
      const user = userEvent.setup();
      state.permissions.delete('employees.view');
      render(<App initial={initial} />);
      const opener = initial === 'balances' ? 'Allocate leave' : 'New assignment';
      await waitFor(() => expect(screen.getByRole('button', { name: opener })).toBeEnabled());
      await user.click(screen.getByRole('button', { name: opener }));
      const form = within(await screen.findByRole('dialog'));
      expect(form.getByRole('alert')).toHaveTextContent(/Employee.*viewing permission/);
      expect(
        form.getByRole('button', {
          name: initial === 'balances' ? 'Save' : 'Save assignment',
          exact: true,
        }),
      ).toBeDisabled();
      expect(state.page.mock.calls.some(([path]) => path === '/hr/employees')).toBe(false);
    },
  );
  it('keeps a complete pay period through navigation and a failed save', async () => {
    const user = userEvent.setup();
    render(<App />);
    let form = await newPeriod(user);
    await user.type(form.getByLabelText('Period code'), 'OCT26');
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await screen.findByRole('heading', { name: 'Payroll overview' });
    expect(state.post).not.toHaveBeenCalled();
    form = await resume(user, 'New payroll period');
    await waitFor(() => expect(form.getByRole('button', { name: 'Create period' })).toBeEnabled());
    expect(form.getByLabelText(/^Name/)).toHaveValue('October 2026');
    expect(dateFieldValue(getDateField('Payment date', form))).toBe('2026-11-01');
    state.post.mockRejectedValueOnce(new Error('Period service unavailable'));
    await user.click(form.getByRole('button', { name: 'Create period' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Period service unavailable');
    await user.click(form.getByRole('button', { name: 'Create period' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).toHaveBeenLastCalledWith('/hr/payroll-periods', {
      companyId: 'company',
      payrollPeriodCode: 'OCT26',
      name: 'October 2026',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      paymentDate: '2026-11-01',
      createdById: 'operator',
    });
  });
  it('reloads company choices before accepting a kept pay period', async () => {
    const user = userEvent.setup();
    render(<App />);
    await newPeriod(user);
    await keep(user);
    state.companyAvailable = false;
    const form = await resume(user, 'New payroll period');
    await waitFor(() => expect(form.getByRole('button', { name: 'Create period' })).toBeEnabled());
    await user.click(form.getByRole('button', { name: 'Create period' }));
    expect(state.post).not.toHaveBeenCalled();
    expect(form.queryByRole('option', { name: /Company A/ })).not.toBeInTheDocument();
    expect(form.getByLabelText(/^Name/)).toHaveValue('October 2026');
  });
  it('merges current leave settings while retaining only an edited name and requiring review', async () => {
    const user = userEvent.setup();
    render(<App initial="types" />);
    let form = await edit(user, 'Annual leave', 'Edit leave type');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save leave type' })).toBeEnabled(),
    );
    await user.clear(form.getByLabelText(/^Name/));
    await user.type(form.getByLabelText(/^Name/), 'Annual entitlement');
    await keep(user);
    state.type = {
      ...state.type,
      annualAllowanceDays: 28,
      paid: false,
      isActive: false,
      updatedAt: 'v2',
    };
    form = await resume(user, 'Edit leave type');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save leave type' })).toBeEnabled(),
    );
    expect(form.getByLabelText('Annual allowance days')).toHaveValue(28);
    expect(form.getByLabelText('Paid leave')).toHaveValue('false');
    expect(form.getByLabelText('Active')).toHaveValue('false');
    expect(form.getByLabelText(/^Name/)).toHaveValue('Annual entitlement');
    await user.click(form.getByRole('button', { name: 'Save leave type' }));
    expect(state.put).not.toHaveBeenCalled();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Save leave type' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/leave-types/type', {
        name: 'Annual entitlement',
      }),
    );
  });
  it('preserves an explicit allowance clear through a failed save and draft resume', async () => {
    const user = userEvent.setup();
    render(<App initial="types" />);
    let form = await edit(user, 'Annual leave', 'Edit leave type');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save leave type' })).toBeEnabled(),
    );
    fireEvent.change(form.getByLabelText('Annual allowance days'), { target: { value: '' } });
    state.put.mockRejectedValueOnce(new Error('Policy unavailable'));
    await user.click(form.getByRole('button', { name: 'Save leave type' }));
    await form.findByText('Policy unavailable');
    await keep(user);
    form = await resume(user, 'Edit leave type');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save leave type' })).toBeEnabled(),
    );
    expect(form.getByLabelText('Annual allowance days')).toHaveValue(null);
    expect(state.put).toHaveBeenCalledTimes(1);
    await user.click(form.getByRole('button', { name: 'Save leave type' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledTimes(2));
    expect(state.put).toHaveBeenLastCalledWith('/hr/leave-types/type', {
      annualAllowanceDays: null,
    });
  });
  it('shows fresh usage and carry forward while saving only a retained allocation change', async () => {
    const user = userEvent.setup();
    render(<App initial="balances" />);
    let form = await edit(user, 'Alex Example', 'Adjust allocation');
    fireEvent.change(form.getByLabelText('Allocated Days'), { target: { value: '32' } });
    await keep(user);
    state.balance = {
      ...state.balance,
      carriedForwardDays: '5',
      usedDays: '9',
      notes: 'Updated by HR',
      updatedAt: 'v2',
    };
    form = await resume(user, 'Adjust leave allocation', 'Adjust allocation');
    expect(form.getByText(/2026 · 9 used/)).toBeInTheDocument();
    expect(form.getByText(/Remaining after this adjustment: 28 days/)).toBeInTheDocument();
    expect(form.getByLabelText('Notes')).toHaveValue('Updated by HR');
    await user.click(form.getByRole('button', { name: 'Save', exact: true }));
    expect(state.post).not.toHaveBeenCalled();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Save', exact: true }));
    expect(state.post).toHaveBeenCalledWith('/hr/leave-balances', {
      companyId: 'company',
      employeeId: 'employee',
      leaveTypeId: 'type',
      year: 2026,
      allocatedDays: 32,
      carriedForwardDays: undefined,
      notes: undefined,
    });
    expect(state.post.mock.calls[0][1]).not.toHaveProperty('usedDays');
  });
  it('retains a notes-only allocation draft without replacing current entitlement totals', async () => {
    const user = userEvent.setup();
    render(<App initial="balances" />);
    let form = await edit(user, 'Alex Example', 'Adjust allocation');
    await user.clear(form.getByLabelText('Notes'));
    await keep(user);
    state.balance = { ...state.balance, allocatedDays: '30', updatedAt: 'v2' };
    form = await resume(user, 'Adjust leave allocation', 'Adjust allocation');
    expect(form.getByLabelText('Allocated Days')).toHaveValue(30);
    expect(form.getByLabelText('Notes')).toHaveValue('');
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Save', exact: true }));
    expect(state.post).toHaveBeenCalledWith(
      '/hr/leave-balances',
      expect.objectContaining({
        allocatedDays: undefined,
        carriedForwardDays: undefined,
        notes: '',
      }),
    );
  });
  it('keeps a new allocation but rejects a leave category made inactive before resume', async () => {
    const user = userEvent.setup();
    render(<App initial="balances" />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Allocate leave' })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: 'Allocate leave' }));
    let form = within(await screen.findByRole('dialog', { name: 'Allocate leave balance' }));
    await waitFor(() => expect(form.getByLabelText('Company')).toBeEnabled());
    await user.selectOptions(form.getByLabelText('Company'), 'company');
    await waitFor(() => expect(form.getByLabelText('Employee')).toBeEnabled());
    await user.selectOptions(form.getByLabelText('Employee'), 'employee');
    await user.selectOptions(form.getByLabelText('Leave Type'), 'type');
    fireEvent.change(form.getByLabelText('Allocated Days'), { target: { value: '24' } });
    await keep(user);
    state.typeActive = false;
    form = await resume(user, 'Allocate leave balance');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled(),
    );
    await user.click(form.getByRole('button', { name: 'Save', exact: true }));
    expect(await form.findByRole('alert')).toHaveTextContent('active leave type');
    expect(form.getByLabelText('Allocated Days')).toHaveValue(24);
    expect(state.post).not.toHaveBeenCalled();
  });
  it('keeps an assignment destination and dates across a failed create and navigation', async () => {
    const user = userEvent.setup();
    render(<App initial="assignments" />);
    let form = await newAssignment(user);
    state.post.mockRejectedValueOnce(new Error('Transfer service unavailable'));
    await user.click(form.getByRole('button', { name: 'Save assignment' }));
    await form.findByText('Transfer service unavailable');
    await keep(user);
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    form = await resume(user, 'New assignment');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    expect(form.getByLabelText('Division')).toHaveValue('division');
    expect(form.getByLabelText('Branch')).toHaveValue('branch');
    expect(form.getByLabelText('Notes')).toHaveValue('Branch placement to finish');
    expect(state.post).toHaveBeenCalledTimes(1);
    await user.click(form.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    expect(state.post.mock.calls[1]).toEqual(state.post.mock.calls[0]);
  });
  it('merges a newly approved transfer without writing its status, identity or untouched timestamp', async () => {
    const user = userEvent.setup();
    state.assignment.approvalStatus = 'PENDING_GROUP_HR_APPROVAL';
    render(<App initial="assignments" />);
    let form = await edit(user, 'Alex Example', 'Edit assignment');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    await user.type(form.getByLabelText('Notes'), ' reviewed');
    await keep(user);
    state.assignment = {
      ...state.assignment,
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      updatedAt: 'v2',
    };
    form = await resume(user, 'Edit assignment');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    expect(form.getByLabelText('Status')).toHaveValue('ACTIVE');
    expect(form.getByLabelText(/^Employee/)).toBeDisabled();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Save assignment' }));
    expect(state.put).toHaveBeenCalledWith('/hr/employee-assignments/assignment', {
      notes: 'Placement reviewed',
    });
  });
  it('requires restoring pending transfer status while preserving other edits', async () => {
    const user = userEvent.setup();
    render(<App initial="assignments" />);
    let form = await edit(user, 'Alex Example', 'Edit assignment');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    await user.selectOptions(form.getByLabelText('Status'), 'ACTIVE');
    await user.type(form.getByLabelText('Notes'), ' reviewed');
    await keep(user);
    state.assignment = {
      ...state.assignment,
      approvalStatus: 'PENDING_GROUP_HR_APPROVAL',
      updatedAt: 'v2',
    };
    form = await resume(user, 'Edit assignment');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    expect(form.getByLabelText('Status')).toHaveValue('ACTIVE');
    expect(form.getByLabelText('Status')).toBeDisabled();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Save assignment' }));
    expect(state.put).not.toHaveBeenCalled();
    await user.click(form.getByRole('button', { name: 'Use current status' }));
    await user.click(form.getByRole('button', { name: 'Save assignment' }));
    expect(state.put).toHaveBeenCalledWith('/hr/employee-assignments/assignment', {
      notes: 'Placement reviewed',
    });
  });
  it('rejects a removed destination branch without discarding a kept assignment', async () => {
    const user = userEvent.setup();
    render(<App initial="assignments" />);
    await newAssignment(user);
    await keep(user);
    state.branchAvailable = false;
    const form = await resume(user, 'New assignment');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    await user.click(form.getByRole('button', { name: 'Save assignment' }));
    expect(await form.findByRole('alert')).toHaveTextContent('available branch');
    expect(state.post).not.toHaveBeenCalled();
    await keep(user);
    expect(screen.getByRole('button', { name: 'Resume New assignment' })).toBeEnabled();
  });
  it('preserves an unreadable allocation and checks current permissions before loading it', async () => {
    const user = userEvent.setup();
    const view = render(<App initial="balances" />);
    const form = await edit(user, 'Alex Example', 'Adjust allocation');
    await user.type(form.getByLabelText('Notes'), ' pending');
    await keep(user);
    state.get.mockRejectedValueOnce(new Error('Allocation no longer accessible'));
    await user.click(screen.getByRole('button', { name: 'Resume Adjust leave allocation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Allocation no longer accessible');
    state.permissions.delete('leave_balances.manage');
    view.rerender(<App initial="balances" />);
    await user.click(screen.getByRole('button', { name: 'Resume Adjust leave allocation' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current role cannot open');
    expect(state.get).toHaveBeenCalledTimes(1);
    expect(state.post).not.toHaveBeenCalled();
    state.permissions.add('leave_balances.manage');
    view.rerender(<App initial="balances" />);
    const resumed = await resume(user, 'Adjust leave allocation', 'Adjust allocation');
    expect(resumed.getByLabelText('Notes')).toHaveValue('Initial allocation pending');
  });
  it('cancels a late assignment read when leaving its view', async () => {
    const user = userEvent.setup();
    render(<App initial="assignments" />);
    const form = await edit(user, 'Alex Example', 'Edit assignment');
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    await user.type(form.getByLabelText('Notes'), ' pending');
    await keep(user);
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Resume Edit assignment' }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await act(async () => {
      resolve({ ...state.assignment });
    });
    expect(state.get.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Edit assignment' })).toBeEnabled();
  });
  it.each(['periods', 'types', 'balances', 'assignments'] as View[])(
    'retains %s list scope and selection across views, then recovers an obsolete page',
    async (view) => {
      const user = userEvent.setup();
      render(<App initial={view} />);
      const name =
        view === 'periods' ? 'September 2026' : view === 'types' ? 'Annual leave' : 'Alex Example';
      await screen.findByRole('button', { name: 'Inspect ' + name });
      await user.click(screen.getByRole('button', { name: /Filters/ }));
      await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
      await user.type(screen.getByRole('searchbox'), 'A');
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          destinations[view],
          expect.objectContaining({ query: expect.objectContaining({ search: 'A' }) }),
        ),
      );
      await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          destinations[view],
          expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
        ),
      );
      await user.click(await screen.findByRole('button', { name: 'Inspect ' + name }));
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      state.page.mockClear();
      await user.click(screen.getByRole('link', { name: 'Open ' + view }));
      expect(await screen.findByRole('button', { name: 'Inspect ' + name })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      const reads = state.page.mock.calls.filter(
        ([path, options]) => path === destinations[view] && options?.query?.limit === 20,
      );
      expect(reads.length).toBeGreaterThan(0);
      expect(
        reads.every(
          ([, options]) =>
            options.query.page === 2 &&
            options.query.companyId === 'company' &&
            options.query.search === 'A',
        ),
      ).toBe(true);
      state.emptyPage = true;
      await user.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          destinations[view],
          expect.objectContaining({
            query: expect.objectContaining({ page: 1, companyId: 'company', search: 'A' }),
          }),
        ),
      );
    },
  );
});

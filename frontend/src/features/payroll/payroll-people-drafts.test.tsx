import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Contracts from '@/app/(dashboard)/hr/employment-contracts/page';
import Attendance from '@/app/(dashboard)/hr/attendance/page';
import Leave from '@/app/(dashboard)/hr/leave-requests/page';
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
  patch: vi.fn(),
  employeeAvailable: true,
  typeActive: true,
  emptyPage: false,
  attendance: {} as Record<string, unknown>,
  contract: {} as Record<string, unknown>,
  leave: {} as Record<string, unknown>,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/payroll',
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
  backendPatch: state.patch,
}));

function Pages() {
  const path = useWorkspacePathname();
  return (
    <PayrollDraftWorkspace viewKey={path}>
      <nav aria-label="Destinations">
        <WorkspaceLink href="/payroll">Open home</WorkspaceLink>
        <WorkspaceLink href="/hr/employment-contracts">Open contracts</WorkspaceLink>
        <WorkspaceLink href="/hr/attendance">Open attendance</WorkspaceLink>
        <WorkspaceLink href="/hr/leave-requests">Open leave</WorkspaceLink>
      </nav>
      {path.endsWith('/employment-contracts') ? (
        <Contracts />
      ) : path.endsWith('/attendance') ? (
        <Attendance />
      ) : path.endsWith('/leave-requests') ? (
        <Leave />
      ) : (
        <h1>Payroll overview</h1>
      )}
    </PayrollDraftWorkspace>
  );
}
function App({
  initial = '/hr/employment-contracts',
  companion = false,
}: {
  initial?: string;
  companion?: boolean;
}) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="primary">
            <section aria-label="Primary Payroll">
              <WorkspaceNavigationProvider
                appId="payroll"
                initialHref={initial}
                ownsPath={(path) => path === '/payroll' || path.startsWith('/hr/')}
              >
                <Pages />
              </WorkspaceNavigationProvider>
            </section>
          </UnsavedWorkScope>
          {companion && (
            <UnsavedWorkScope id="legacy">
              <section aria-label="Legacy attendance">
                <Attendance />
              </section>
            </UnsavedWorkScope>
          )}
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'employment_contracts.view',
    'employment_contracts.create',
    'employment_contracts.approve',
    'employment_contracts.terminate',
    'attendance.view',
    'attendance.create',
    'attendance.update',
    'attendance.approve',
    'leave_requests.view',
    'leave_requests.create',
    'leave_requests.approve',
    'leave_requests.approve.hr',
    'leave_requests.reject',
  ]);
  state.employeeAvailable = true;
  state.typeActive = true;
  state.emptyPage = false;
  const employee = { id: 'employee', fullName: 'Alex Example', employeeCode: 'EMP-1' };
  const company = { id: 'company', name: 'Company A' };
  state.contract = {
    id: 'contract',
    contractCode: 'CON-1',
    companyId: 'company',
    employeeId: 'employee',
    employee,
    company,
    contractType: 'PERMANENT',
    status: 'ACTIVE',
    startDate: '2026-09-01',
    updatedAt: 'v1',
  };
  state.attendance = {
    id: 'attendance',
    attendanceNumber: 'ATT-1',
    companyId: 'company',
    employeeId: 'employee',
    employee,
    company,
    attendanceDate: '2026-09-17',
    clockInTime: '2026-09-17T08:00:12.123Z',
    clockOutTime: '2026-09-17T16:00:12.123Z',
    attendanceStatus: 'PRESENT',
    notes: 'Original notes',
    updatedAt: 'v1',
  };
  state.leave = {
    id: 'leave',
    leaveRequestNumber: 'LR-1',
    companyId: 'company',
    employeeId: 'employee',
    employee,
    company,
    leaveTypeId: 'type',
    leaveType: { name: 'Annual leave' },
    startDate: '2026-10-01',
    endDate: '2026-10-06',
    totalDays: 6,
    status: 'SUBMITTED',
    updatedAt: 'v1',
  };
  state.page.mockImplementation(async (path, opts) => {
    const rows =
      path === '/companies'
        ? [{ ...company, code: 'A' }]
        : path === '/hr/employees'
          ? state.employeeAvailable
            ? [{ ...employee, companyId: 'company' }]
            : []
          : path === '/hr/leave-types'
            ? [{ id: 'type', name: 'Annual leave', isActive: state.typeActive }]
            : path === '/hr/employment-contracts'
              ? [state.contract]
              : path === '/hr/attendance'
                ? [state.attendance]
                : path === '/hr/leave-requests'
                  ? [state.leave]
                  : [];
    return {
      data: state.emptyPage && opts?.query?.limit === 20 && opts.query.page > 1 ? [] : rows,
      total: opts?.query?.limit === 20 && !state.emptyPage ? 21 : rows.length,
    };
  });
  state.get.mockImplementation(async (path) =>
    path.includes('/attendance/')
      ? { ...state.attendance }
      : path.includes('/employment-contracts/')
        ? { ...state.contract }
        : { ...state.leave },
  );
  state.post.mockResolvedValue({ id: 'created' });
  state.put.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
async function keep(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function openAttendance(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
  await user.click(screen.getByRole('button', { name: 'Edit attendance' }));
  return within(await screen.findByRole('dialog', { name: 'Edit attendance' }));
}
async function choosePerson(
  user: ReturnType<typeof userEvent.setup>,
  form: ReturnType<typeof within>,
) {
  await waitFor(() => expect(form.getByLabelText(/^Company/)).toBeEnabled());
  await user.selectOptions(form.getByLabelText(/^Company/), 'company');
  await form.findByRole('option', { name: /Alex Example/ });
  await waitFor(() => expect(form.getByLabelText(/^Employee/)).toBeEnabled());
  await user.selectOptions(form.getByLabelText(/^Employee/), 'employee');
}

describe('Payroll people workflow continuity', () => {
  it('keeps a full employment agreement through app navigation and a failed save', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'New contract' }));
    let form = within(await screen.findByRole('dialog', { name: 'New employment contract' }));
    await choosePerson(user, form);
    await setDateField(/^Start date/, '2026-09-01', user, form);
    fireEvent.change(form.getByLabelText(/^Salary amount/), { target: { value: '500000' } });
    await user.type(form.getByLabelText('Additional terms'), 'Agreement to finish later');
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await screen.findByRole('heading', { name: 'Payroll overview' });
    expect(state.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /Resume New employment contract/ }));
    form = within(await screen.findByRole('dialog', { name: 'New employment contract' }));
    await waitFor(() => expect(form.getByRole('button', { name: 'Create draft' })).toBeEnabled());
    expect(form.getByLabelText('Additional terms')).toHaveValue('Agreement to finish later');
    expect(form.getByLabelText(/^Salary amount/)).toHaveValue(500000);
    state.post.mockRejectedValueOnce(new Error('Contract service unavailable'));
    await user.click(form.getByRole('button', { name: 'Create draft' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Contract service unavailable');
    await user.click(form.getByRole('button', { name: 'Create draft' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).toHaveBeenLastCalledWith(
      '/hr/employment-contracts',
      expect.objectContaining({
        employeeId: 'employee',
        salaryAmount: 500000,
        terms: 'Agreement to finish later',
      }),
    );
    expect(
      screen.queryByRole('button', { name: /Resume New employment contract/ }),
    ).not.toBeInTheDocument();
  });
  it('merges an attendance note draft with fresh unedited times and requires review', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/attendance" />);
    let form = await openAttendance(user);
    await user.clear(form.getByLabelText('Notes'));
    await user.type(form.getByLabelText('Notes'), 'My correction');
    await keep(user);
    state.attendance = {
      ...state.attendance,
      updatedAt: 'v2',
      clockOutTime: '2026-09-17T18:12:34.456Z',
      notes: 'Someone else updated this',
      approvedById: 'manager',
    };
    await user.click(screen.getByRole('button', { name: /Resume Edit attendance/ }));
    form = within(await screen.findByRole('dialog', { name: 'Edit attendance' }));
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save attendance' })).toBeEnabled(),
    );
    expect(form.getByLabelText('Notes')).toHaveValue('My correction');
    expect(form.getByText(/Current notes:/)).toHaveTextContent('Someone else updated this');
    expect(form.getByText(/Present · Approved/)).toBeVisible();
    await user.click(form.getByRole('button', { name: 'Save attendance' }));
    expect(state.put).not.toHaveBeenCalled();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/attendance/attendance', {
        notes: 'My correction',
      }),
    );
  });
  it('keeps attendance source failures recoverable and checks current update permission', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/attendance" />);
    const form = await openAttendance(user);
    await user.type(form.getByLabelText('Notes'), ' correction');
    await keep(user);
    state.get.mockRejectedValueOnce(new Error('Attendance no longer accessible'));
    await user.click(screen.getByRole('button', { name: /Resume Edit attendance/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Attendance no longer accessible');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    state.permissions.delete('attendance.update');
    await user.click(screen.getByRole('button', { name: /Resume Edit attendance/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current role cannot open');
    expect(state.get).toHaveBeenCalledTimes(1);
    state.permissions.add('attendance.update');
    await user.click(screen.getByRole('button', { name: /Resume Edit attendance/ }));
    expect(await screen.findByRole('dialog', { name: 'Edit attendance' })).toBeVisible();
    expect(state.put).not.toHaveBeenCalled();
  });
  it('aborts an attendance resume when navigating and ignores its late record', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/attendance" />);
    const form = await openAttendance(user);
    await user.type(form.getByLabelText('Notes'), ' pending');
    await keep(user);
    let resolve!: (value: unknown) => void;
    let signal!: AbortSignal;
    state.get.mockImplementationOnce((_path, opts) => {
      signal = opts.signal;
      return new Promise((done) => {
        resolve = done;
      });
    });
    await user.click(screen.getByRole('button', { name: /Resume Edit attendance/ }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await screen.findByRole('heading', { name: 'Payroll overview' });
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ ...state.attendance }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.put).not.toHaveBeenCalled();
  });
  it('retains contract termination notes but prevents acting on an already terminated record', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole('button', { name: 'Inspect CON-1' }));
    await user.click(screen.getByRole('button', { name: 'Terminate contract' }));
    let form = within(await screen.findByRole('dialog', { name: 'Terminate CON-1?' }));
    await user.type(form.getByLabelText('Reason (optional)'), 'Agreement completed');
    await keep(user);
    state.contract = { ...state.contract, updatedAt: 'v2', status: 'TERMINATED' };
    await user.click(screen.getByRole('button', { name: /Resume Terminate contract/ }));
    form = within(await screen.findByRole('dialog', { name: 'Terminate CON-1?' }));
    expect(form.getByLabelText('Reason (optional)')).toHaveValue('Agreement completed');
    expect(form.getByRole('button', { name: 'Terminate contract' })).toBeDisabled();
    expect(form.getByRole('alert')).toHaveTextContent('no longer available');
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('retains leave dates and reason, then revalidates active leave types before creating', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/leave-requests" />);
    await user.click(screen.getByRole('button', { name: 'New request' }));
    let form = within(await screen.findByRole('dialog', { name: 'New leave request' }));
    await choosePerson(user, form);
    await user.selectOptions(form.getByLabelText(/^Leave type/), 'type');
    await setDateField(/^Start date/, '2026-10-01', user, form);
    await setDateField(/^End date/, '2026-10-06', user, form);
    await user.type(form.getByLabelText('Reason'), 'Planned time away');
    await keep(user);
    state.typeActive = false;
    await user.click(screen.getByRole('button', { name: /Resume New leave request/ }));
    form = within(await screen.findByRole('dialog', { name: 'New leave request' }));
    await waitFor(() => expect(form.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    expect(form.getByLabelText('Reason')).toHaveValue('Planned time away');
    expect(dateFieldValue(getDateField(/^End date/, form))).toBe('2026-10-06');
    fireEvent.submit(form.getByLabelText('Reason').closest('form')!);
    expect(await form.findByRole('alert')).toHaveTextContent('Choose an active leave type');
    expect(state.post).not.toHaveBeenCalled();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('reloads leave approval state and retains reviewed notes through a failed request', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/leave-requests" />);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Group HR approval' }));
    let form = within(
      await screen.findByRole('dialog', { name: 'Group HR approval for Alex Example?' }),
    );
    await user.type(form.getByLabelText('Approval notes (optional)'), 'Cover arranged');
    await keep(user);
    state.leave = {
      ...state.leave,
      updatedAt: 'v2',
      lineApprovedById: 'manager',
      approvalNotes: 'Line approved',
    };
    await user.click(screen.getByRole('button', { name: /Resume Group HR approval/ }));
    form = within(
      await screen.findByRole('dialog', { name: 'Group HR approval for Alex Example?' }),
    );
    expect(form.getByText(/Current approval notes:/)).toHaveTextContent('Line approved');
    await user.click(form.getByRole('button', { name: 'Group HR approval' }));
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    state.patch.mockRejectedValueOnce(new Error('Approver must be a different person'));
    await user.click(form.getByRole('button', { name: 'Group HR approval' }));
    expect(await form.findByRole('alert')).toHaveTextContent('different person');
    expect(form.getByLabelText('Approval notes (optional)')).toHaveValue('Cover arranged');
    await user.click(form.getByRole('button', { name: 'Group HR approval' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.patch).toHaveBeenLastCalledWith('/hr/leave-requests/leave/approve-hr', {
      notes: 'Cover arranged',
    });
  });
  it.each(['attendance', 'employment-contracts', 'leave-requests'])(
    'retains the %s register page, filters and selected ID when returning',
    async (route) => {
      const user = userEvent.setup();
      render(<App initial={'/hr/' + route} />);
      await user.click(screen.getByRole('button', { name: /^Filters/ }));
      await waitFor(() =>
        expect(screen.getByRole('option', { name: 'Company A (A)' })).toBeInTheDocument(),
      );
      await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
      await user.click(await screen.findByRole('button', { name: 'Next', exact: true }));
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          '/hr/' + route,
          expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
        ),
      );
      const label = route === 'employment-contracts' ? 'CON-1' : 'Alex Example';
      await user.click(await screen.findByRole('button', { name: 'Inspect ' + label }));
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      await user.click(
        screen.getByRole('link', {
          name:
            route === 'employment-contracts'
              ? 'Open contracts'
              : route === 'attendance'
                ? 'Open attendance'
                : 'Open leave',
        }),
      );
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Inspect ' + label })).toHaveAttribute(
          'aria-expanded',
          'true',
        ),
      );
      const calls = state.page.mock.calls.filter(
        ([path, opts]) => path === '/hr/' + route && opts.query.limit === 20,
      );
      expect(calls.at(-1)?.[1].query.page).toBe(2);
      expect(calls.at(-1)?.[1].query.companyId).toBe('company');
      await user.click(screen.getByRole('button', { name: /^Filters/ }));
      expect(screen.getByLabelText('Company filter')).toHaveValue('company');
      state.emptyPage = true;
      await user.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() => {
        const current = state.page.mock.calls.filter(
          ([path, opts]) => path === '/hr/' + route && opts.query.limit === 20,
        );
        expect(current.at(-1)?.[1].query.page).toBe(1);
      });
    },
  );
  it('resumes a new attendance entry without creating it until Save is selected', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/attendance" />);
    await user.click(screen.getByRole('button', { name: 'Log attendance' }));
    let form = within(await screen.findByRole('dialog', { name: 'Log attendance' }));
    await choosePerson(user, form);
    await setDateField(/^Attendance date/, '2026-09-17', user, form);
    await user.selectOptions(form.getByLabelText('Attendance status'), 'ABSENT');
    await user.type(form.getByLabelText('Notes'), 'Reported absence');
    await keep(user);
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: /Resume Log attendance/ }));
    form = within(await screen.findByRole('dialog', { name: 'Log attendance' }));
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save attendance' })).toBeEnabled(),
    );
    expect(form.getByLabelText(/^Employee/)).toHaveValue('employee');
    expect(form.getByLabelText('Attendance status')).toHaveValue('ABSENT');
    expect(form.getByLabelText('Notes')).toHaveValue('Reported absence');
    expect(state.post).not.toHaveBeenCalled();
    await user.click(form.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/hr/attendance',
        expect.objectContaining({
          companyId: 'company',
          employeeId: 'employee',
          attendanceStatus: 'ABSENT',
          attendanceDate: '2026-09-17',
          notes: 'Reported absence',
        }),
      ),
    );
  });
  it('shares draft ownership with the standalone attendance register', async () => {
    const user = userEvent.setup();
    render(<App initial="/hr/attendance" companion />);
    const primary = within(screen.getByRole('region', { name: 'Primary Payroll' }));
    const legacy = within(screen.getByRole('region', { name: 'Legacy attendance' }));
    await user.click(await primary.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(primary.getByRole('button', { name: 'Edit attendance' }));
    let form = within(await screen.findByRole('dialog', { name: 'Edit attendance' }));
    await user.type(form.getByLabelText('Notes'), ' in primary');
    await keep(user);
    await user.click(legacy.getByRole('button', { name: /Resume Edit attendance/ }));
    form = within(await screen.findByRole('dialog', { name: 'Edit attendance' }));
    expect(primary.getByRole('button', { name: /Resume Edit attendance/ })).toBeDisabled();
    await waitFor(() =>
      expect(form.getByRole('button', { name: 'Save attendance' })).toBeEnabled(),
    );
    await user.click(form.getByRole('button', { name: 'Save attendance' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.put).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /Resume Edit attendance/ }),
    ).not.toBeInTheDocument();
  });
});

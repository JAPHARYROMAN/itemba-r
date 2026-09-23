import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeesPage from '@/app/(dashboard)/hr/employees/page';
import { EmployeeAllocationWorkspace } from '@/components/workspace/employee-allocation-workspace';
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
import { PayrollWorkspace } from './payroll-workspace';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  branch: true,
  updated: false,
  employee: true,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/hr/employees',
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
  backendPage: state.page,
  backendGet: state.get,
  backendPost: state.post,
  backendPut: state.put,
}));
const allocation = (kind: string) => ({
  id: 'allocation',
  companyId: 'company',
  company: { id: 'company', name: 'Company A' },
  employeeId: 'employee',
  employee: { id: 'employee', fullName: 'Alex Example', employeeCode: 'EMP-1' },
  [kind + 'TypeId']: 'type',
  [kind + 'Type']: { id: 'type', name: 'Transport', code: 'TRANSPORT' },
  amount: state.updated ? '20000' : '10000',
  percentage: null,
  effectiveFrom: '2026-09-01T00:00:00Z',
  effectiveTo: null,
  status: 'ACTIVE',
  notes: '',
  updatedAt: state.updated ? '2026-09-20T01:00:00Z' : '2026-09-19T01:00:00Z',
});
function Routes() {
  const path = useWorkspacePathname();
  return (
    <>
      <nav aria-label="Test destinations">
        <WorkspaceLink href="/payroll">Open home</WorkspaceLink>
        <WorkspaceLink href="/hr/employees">Open employees</WorkspaceLink>
        <WorkspaceLink href="/hr/employee-allowances">Open allowances</WorkspaceLink>
        <WorkspaceLink href="/hr/employee-deductions">Open deductions</WorkspaceLink>
      </nav>
      {path === '/hr/employees' ? (
        <EmployeesPage />
      ) : path === '/hr/employee-allowances' ? (
        <EmployeeAllocationWorkspace kind="allowance" />
      ) : path === '/hr/employee-deductions' ? (
        <EmployeeAllocationWorkspace kind="deduction" />
      ) : (
        <h1>Payroll overview</h1>
      )}
    </>
  );
}
function App({
  initialHref = '/hr/employees',
  companion = false,
}: {
  initialHref?: string;
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
                initialHref={initialHref}
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
              <section aria-label="Legacy register">
                <EmployeeAllocationWorkspace kind="allowance" />
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
  state.branch = true;
  state.employee = true;
  state.permissions = new Set([
    'employees.view',
    'employees.create',
    'allowances.view',
    'allowances.manage',
    'deductions.view',
    'deductions.manage',
  ]);
  state.page.mockImplementation(async (path, options) => {
    const rows =
      path === '/companies'
        ? [{ id: 'company', name: 'Company A', code: 'A' }]
        : path === '/branches'
          ? state.branch
            ? [{ id: 'branch', companyId: 'company', name: 'Town', code: 'T' }]
            : []
          : path === '/hr/departments'
            ? [{ id: 'department', name: 'Operations', companyId: 'company' }]
            : path === '/hr/positions'
              ? [
                  {
                    id: 'position',
                    title: 'Manager',
                    companyId: 'company',
                    departmentId: 'department',
                  },
                ]
              : path === '/hr/employees'
                ? state.employee
                  ? [
                      {
                        id: 'employee',
                        firstName: 'Alex',
                        lastName: 'Example',
                        fullName: state.updated ? 'Alex Updated' : 'Alex Example',
                        employeeCode: 'EMP-1',
                      },
                    ]
                  : []
                : path.endsWith('-types')
                  ? [{ id: 'type', name: 'Transport', code: 'TRANSPORT', isActive: true }]
                  : path.includes('employee-allowances')
                    ? [allocation('allowance')]
                    : path.includes('employee-deductions')
                      ? [allocation('deduction')]
                      : [];
    return { data: rows, total: options?.query?.limit === 20 ? 21 : rows.length };
  });
  state.get.mockImplementation(async (path) =>
    path.endsWith('linkable-users')
      ? []
      : path.endsWith('next-code')
        ? { employeeCode: 'EMP-2' }
        : allocation(path.includes('allowances') ? 'allowance' : 'deduction'),
  );
  state.post.mockResolvedValue({ id: 'created' });
  state.put.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  history.replaceState({}, '', '/hr/employees');
});
async function newEmployee() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'New employee' }));
  const dialog = await screen.findByRole('dialog', { name: 'New employee' });
  const form = within(dialog);
  await form.findByRole('option', { name: 'Company A (A)' });
  await user.selectOptions(form.getByLabelText(/^Company/), 'company');
  await waitFor(() =>
    expect(form.getByRole('button', { name: 'Save', exact: true })).toBeEnabled(),
  );
  fireEvent.change(form.getByLabelText(/^First name/), { target: { value: 'Jamie' } });
  fireEvent.change(form.getByLabelText(/^Last name/), { target: { value: 'Example' } });
  return { user, form };
}
async function editAllocation(kind: 'allowance' | 'deduction') {
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
  await user.click(screen.getByRole('button', { name: 'Edit allocation' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit ' + kind });
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Save allocation' })).toBeEnabled(),
  );
  return { user, form: within(dialog) };
}

describe('Payroll draft continuity', () => {
  it('keeps complete employee onboarding while navigating, resumes from home, and retains a failed save', async () => {
    render(<App />);
    const { user, form } = await newEmployee();
    await user.selectOptions(form.getByLabelText('Branch'), 'branch');
    await user.selectOptions(form.getByLabelText('Department'), 'department');
    await user.selectOptions(form.getByLabelText('Position'), 'position');
    fireEvent.change(form.getByLabelText('Bank account number'), {
      target: { value: 'TEST-ACCOUNT' },
    });
    fireEvent.change(form.getByLabelText(/Base salary/), { target: { value: '125000' } });
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    expect(await screen.findByRole('heading', { name: 'Payroll overview' })).toBeVisible();
    expect(screen.queryByRole('dialog', { name: 'New employee' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume New employee' }));
    const resumed = within(await screen.findByRole('dialog', { name: 'New employee' }));
    await waitFor(() =>
      expect(resumed.getByRole('button', { name: 'Save', exact: true })).toBeEnabled(),
    );
    expect(resumed.getByLabelText('Branch')).toHaveValue('branch');
    expect(resumed.getByLabelText('Position')).toHaveValue('position');
    expect(resumed.getByLabelText('Bank account number')).toHaveValue('TEST-ACCOUNT');
    expect(state.post).not.toHaveBeenCalled();
    state.post.mockRejectedValueOnce(new Error('Employee save unavailable'));
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('Employee save unavailable');
    expect(resumed.getByLabelText(/^First name/)).toHaveValue('Jamie');
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New employee' })).not.toBeInTheDocument(),
    );
    expect(state.post).toHaveBeenLastCalledWith(
      '/hr/employees',
      expect.objectContaining({
        firstName: 'Jamie',
        branchId: 'branch',
        positionId: 'position',
        bankAccountNumber: 'TEST-ACCOUNT',
        baseSalary: 125000,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Resume New employee' })).not.toBeInTheDocument();
  }, 10_000);
  it('allows onboarding without an optional branch when that directory is unavailable', async () => {
    const previousRead = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (path, options) => {
      if (path === '/branches') throw new Error('Branches unavailable');
      return previousRead(path, options);
    });
    render(<App />);
    const { user, form } = await newEmployee();
    expect(form.getByRole('alert')).toHaveTextContent('Could not load branches');
    expect(form.getByLabelText('Branch')).toBeDisabled();
    await user.click(form.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/hr/employees',
        expect.objectContaining({ companyId: 'company', firstName: 'Jamie' }),
      ),
    );
    expect(state.post.mock.calls[0][1]).not.toHaveProperty('branchId');
  });
  it('rejects a retained organisation choice that is no longer available', async () => {
    render(<App />);
    const { user, form } = await newEmployee();
    await user.selectOptions(form.getByLabelText('Branch'), 'branch');
    await user.click(form.getByRole('button', { name: 'Keep draft', exact: true }));
    state.branch = false;
    await user.click(screen.getByRole('button', { name: 'Resume New employee' }));
    const dialog = await screen.findByRole('dialog', { name: 'New employee' });
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Save', exact: true })).toBeEnabled(),
    );
    fireEvent.submit(dialog.querySelector('form')!);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'selected branch is no longer available',
    );
    expect(state.post).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(/^First name/)).toHaveValue('Jamie');
  });
  it.each(['allowance', 'deduction'] as const)(
    'reloads a changed %s, requires review, and preserves entered notes through another keep',
    async (kind) => {
      render(<App initialHref={'/hr/employee-' + kind + 's'} />);
      const { user, form } = await editAllocation(kind);
      fireEvent.change(form.getByLabelText('Notes (optional)'), {
        target: { value: 'Reviewed for September' },
      });
      await user.click(form.getByRole('button', { name: 'Keep draft', exact: true }));
      state.updated = true;
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      await user.click(screen.getByRole('button', { name: 'Resume Edit ' + kind }));
      let dialog = await screen.findByRole('dialog', { name: 'Edit ' + kind });
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Save allocation' })).toBeEnabled(),
      );
      expect(state.get).toHaveBeenCalledWith(
        '/hr/employee-' + kind + 's/allocation',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(within(dialog).getByText(/Current allocation:/)).toHaveTextContent('20,000');
      await user.click(within(dialog).getByRole('button', { name: 'Save allocation' }));
      expect(state.put).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Keep draft', exact: true }));
      await user.click(screen.getByRole('button', { name: 'Resume Edit ' + kind }));
      dialog = await screen.findByRole('dialog', { name: 'Edit ' + kind });
      expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
      expect(within(dialog).getByLabelText('Notes (optional)')).toHaveValue(
        'Reviewed for September',
      );
      fireEvent.change(within(dialog).getByLabelText(/^Amount/), { target: { value: '20000' } });
      await user.click(within(dialog).getByRole('checkbox'));
      await waitFor(() =>
        expect(within(dialog).getByRole('button', { name: 'Save allocation' })).toBeEnabled(),
      );
      await user.click(within(dialog).getByRole('button', { name: 'Save allocation' }));
      await waitFor(() =>
        expect(state.put).toHaveBeenCalledWith('/hr/employee-' + kind + 's/allocation', {
          notes: 'Reviewed for September',
        }),
      );
    },
  );
  it('shares a draft with the standalone register and blocks a second concurrent editor', async () => {
    render(<App initialHref="/hr/employee-allowances" companion />);
    const user = userEvent.setup();
    const main = within(screen.getByLabelText('Primary Payroll'));
    const other = within(screen.getByLabelText('Legacy register'));
    await user.click(await main.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(main.getByRole('button', { name: 'Edit allocation' }));
    const first = within(await main.findByRole('dialog', { name: 'Edit allowance' }));
    fireEvent.change(first.getByLabelText('Notes (optional)'), {
      target: { value: 'Shared entry' },
    });
    await user.click(first.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(other.getByRole('button', { name: 'Resume Edit allowance' }));
    const resumed = within(await other.findByRole('dialog', { name: 'Edit allowance' }));
    expect(main.getByRole('button', { name: 'Resume Edit allowance' })).toBeDisabled();
    expect(main.getByRole('button', { name: 'Discard Edit allowance' })).toBeDisabled();
    fireEvent.change(resumed.getByLabelText('Notes (optional)'), {
      target: { value: 'Latest entry' },
    });
    await user.click(resumed.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(main.getByRole('button', { name: 'Resume Edit allowance' }));
    expect(
      within(await main.findByRole('dialog', { name: 'Edit allowance' })).getByLabelText(
        'Notes (optional)',
      ),
    ).toHaveValue('Latest entry');
    expect(state.put).not.toHaveBeenCalled();
    const active = within(await main.findByRole('dialog', { name: 'Edit allowance' }));
    await waitFor(() =>
      expect(active.getByRole('button', { name: 'Save allocation' })).toBeEnabled(),
    );
    state.page.mockClear();
    await user.click(active.getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(state.put).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(
        state.page.mock.calls.filter(([path]) => path === '/hr/employee-allowances').length,
      ).toBe(2),
    );
  });
  it('checks current permission before reopening a kept allocation', async () => {
    render(<App initialHref="/hr/employee-allowances" />);
    const { user, form } = await editAllocation('allowance');
    await user.click(form.getByRole('button', { name: 'Keep draft', exact: true }));
    state.permissions.delete('allowances.manage');
    state.get.mockClear();
    await user.click(screen.getByRole('button', { name: 'Resume Edit allowance' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('current role cannot open');
    expect(state.get).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
  });
  it('restores the employee register selection against fresh records without clearing manual company filters', async () => {
    render(<App />);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await user.selectOptions(screen.getByLabelText('Status filter'), 'ACTIVE');
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    state.updated = true;
    state.page.mockClear();
    await user.click(screen.getByRole('link', { name: 'Open employees' }));
    expect(await screen.findByRole('heading', { name: 'Alex Updated' })).toBeVisible();
    expect(screen.getByLabelText('Company filter')).toHaveValue('company');
    expect(screen.getByLabelText('Status filter')).toHaveValue('ACTIVE');
    expect(state.page).toHaveBeenCalledWith(
      '/hr/employees',
      expect.objectContaining({
        query: expect.objectContaining({
          page: 2,
          companyId: 'company',
          employmentStatus: 'ACTIVE',
        }),
      }),
    );
  });
  it('returns to an available allocation page when the retained page no longer exists', async () => {
    render(<App initialHref="/hr/employee-allowances" />);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employee-allowances',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    const previousRead = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (path, options) =>
      path === '/hr/employee-allowances'
        ? { data: options.query.page > 1 ? [] : [allocation('allowance')], total: 1 }
        : previousRead(path, options),
    );
    state.page.mockClear();
    await user.click(screen.getByRole('link', { name: 'Open allowances' }));
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    expect(screen.queryByRole('button', { name: 'Next', exact: true })).not.toBeInTheDocument();
    expect(state.page).toHaveBeenCalledWith(
      '/hr/employee-allowances',
      expect.objectContaining({ query: expect.objectContaining({ page: 1 }) }),
    );
  });
  it('retains register filters and page across navigation while reading fresh records', async () => {
    render(<App initialHref="/hr/employee-allowances" />);
    const user = userEvent.setup();
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await user.type(screen.getByPlaceholderText('Search employee or type…'), 'Alex');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employee-allowances',
        expect.objectContaining({ query: expect.objectContaining({ search: 'Alex' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employee-allowances',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    state.page.mockClear();
    await user.click(screen.getByRole('link', { name: 'Open allowances' }));
    expect(screen.getByPlaceholderText('Search employee or type…')).toHaveValue('Alex');
    await waitFor(() => expect(screen.getByLabelText('Company filter')).toHaveValue('company'));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employee-allowances',
        expect.objectContaining({
          query: expect.objectContaining({ companyId: 'company', search: 'Alex', page: 2 }),
        }),
      ),
    );
  });
});

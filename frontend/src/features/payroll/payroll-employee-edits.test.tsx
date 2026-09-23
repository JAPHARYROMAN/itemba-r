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

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  put: vi.fn(),
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
    employmentStatus: 'ACTIVE',
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
  state.users = true;
  state.sourceError = false;
  state.usersError = false;
  state.permissions = new Set(['employees.view', 'employees.update', 'employees.sensitive.view']);
  state.get.mockImplementation(async (path) => {
    if (path === '/hr/employees/employee') {
      if (state.sourceError) throw new Error('Employee is no longer available');
      return employee();
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
async function edit(
  section: 'profile' | 'statutory' | 'banking' = 'profile',
  container: Pick<typeof screen, 'getByRole' | 'findByRole'> = screen,
) {
  const user = userEvent.setup();
  await container.findByRole('heading', { name: 'Alex Example' });
  if (section !== 'profile')
    await user.click(
      container.getByRole('tab', {
        name: section === 'statutory' ? 'Tax & Statutory' : 'Banking & Mobile Money',
      }),
    );
  const title =
    section === 'profile'
      ? 'Edit profile'
      : section === 'statutory'
        ? 'Edit tax & statutory'
        : 'Edit bank details';
  await user.click(container.getByRole('button', { name: title }));
  return { user, title, form: within(await screen.findByRole('dialog', { name: title })) };
}
async function keepAndResume(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await user.click(screen.getByRole('link', { name: 'Open home' }));
  await screen.findByRole('heading', { name: 'Payroll overview' });
  await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
  return within(await screen.findByRole('dialog', { name: title }));
}

describe('Employee edits across the Payroll workspace', () => {
  it('requires review when the source version is unavailable and preserves an explicit account unlink', async () => {
    state.get.mockImplementation(async (path) =>
      path === '/hr/employees/employee'
        ? { ...employee(), userId: 'old-user', updatedAt: undefined }
        : [],
    );
    render(<App />);
    const { user, title, form } = await edit();
    await waitFor(() => expect(form.getByLabelText('User account')).toBeEnabled());
    await user.selectOptions(form.getByLabelText('User account'), '');
    const resumed = await keepAndResume(user, title);
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('Review the latest record');
    expect(state.put).not.toHaveBeenCalled();
    await user.click(resumed.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/employees/employee', { userId: null }),
    );
  });
  it('does not reopen sensitive retained input after its permission is removed', async () => {
    const view = render(<App />);
    const { user, title, form } = await edit('banking');
    fireEvent.change(form.getByLabelText('Account number'), { target: { value: 'PRIVATE-TEST' } });
    await user.click(form.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    state.permissions.delete('employees.sensitive.view');
    view.rerender(<App />);
    state.get.mockClear();
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'cannot access the sensitive fields',
    );
    expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
  });
  it('retains only edited input, reloads the employee, reviews changes and merges fresh names on retry', async () => {
    render(<App />);
    const { user, title, form } = await edit();
    fireEvent.change(form.getByLabelText(/^First Name/), { target: { value: 'Jordan' } });
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    expect(await screen.findByRole('heading', { name: 'Payroll overview' })).toBeVisible();
    expect(JSON.parse(screen.getByTestId('draft-values').textContent!)).toEqual([
      { firstName: 'Jordan' },
    ]);
    state.updated = true;
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    let resumed = within(await screen.findByRole('dialog', { name: title }));
    expect(resumed.getByLabelText(/^First Name/)).toHaveValue('Jordan');
    expect(resumed.getByLabelText(/^Last Name/)).toHaveValue('Latest');
    expect(resumed.getByLabelText('Email')).toHaveValue('latest@example.test');
    expect(resumed.getByText('Current first name')).toBeVisible();
    expect(state.put).not.toHaveBeenCalled();
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('Review the latest record');
    await user.click(resumed.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    resumed = within(await screen.findByRole('dialog', { name: title }));
    expect(resumed.getByRole('checkbox', { name: /I have reviewed/ })).not.toBeChecked();
    await user.click(resumed.getByRole('checkbox', { name: /I have reviewed/ }));
    state.put.mockRejectedValueOnce(new Error('Employee save unavailable'));
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('Employee save unavailable');
    expect(resumed.getByLabelText(/^First Name/)).toHaveValue('Jordan');
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: title })).not.toBeInTheDocument(),
    );
    expect(state.put).toHaveBeenCalledTimes(2);
    expect(state.put).toHaveBeenLastCalledWith('/hr/employees/employee', {
      firstName: 'Jordan',
      fullName: 'Jordan Latest',
    });
    expect(JSON.parse(screen.getByTestId('draft-values').textContent!)).toEqual([]);
  });
  it('restores statutory zero, false and cleared values without submitting them on resume', async () => {
    render(<App />);
    const { user, title, form } = await edit('statutory');
    fireEvent.change(form.getByLabelText(/^Dependents/), { target: { value: '0' } });
    await user.click(form.getByRole('checkbox', { name: /Active HESLB borrower/ }));
    await user.clear(form.getByLabelText('TIN'));
    const resumed = await keepAndResume(user, title);
    expect(resumed.getByLabelText(/^Dependents/)).toHaveValue(0);
    expect(resumed.getByRole('checkbox', { name: /Active HESLB borrower/ })).not.toBeChecked();
    expect(state.put).not.toHaveBeenCalled();
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/employees/employee', {
        dependents: 0,
        heslbBorrower: false,
        tin: null,
      }),
    );
  });
  it('retains banking changes while leaving a newer account name untouched', async () => {
    render(<App />);
    const { user, title, form } = await edit('banking');
    await user.clear(form.getByLabelText('Bank name'));
    fireEvent.change(form.getByLabelText('Account number'), {
      target: { value: 'NEW-TEST-ACCOUNT' },
    });
    state.updated = true;
    const resumed = await keepAndResume(user, title);
    expect(resumed.getByLabelText('Account name')).toHaveValue('Latest account name');
    expect(resumed.getByText('Latest Bank')).toBeVisible();
    expect(resumed.getByLabelText('Account number')).toHaveValue('NEW-TEST-ACCOUNT');
    await user.click(resumed.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(resumed.getByRole('button', { name: 'Save bank details' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/employees/employee', {
        bankName: null,
        bankAccountNumber: 'NEW-TEST-ACCOUNT',
      }),
    );
  });
  it('does not expose or submit sensitive source fields without their permission', async () => {
    state.permissions.delete('employees.sensitive.view');
    render(<App />);
    const { user, title, form } = await edit('banking');
    expect(form.getByLabelText('Account number')).toBeDisabled();
    expect(form.getByLabelText('Account number')).toHaveValue('');
    expect(form.getByLabelText('Bank name')).toHaveValue('');
    fireEvent.change(form.getByLabelText('Account name'), {
      target: { value: 'Entered account name' },
    });
    const resumed = await keepAndResume(user, title);
    await user.click(resumed.getByRole('button', { name: 'Save bank details' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/employees/employee', {
        bankAccountName: 'Entered account name',
      }),
    );
  });
  it('requires a fresh eligible linked account and still saves unrelated edits during directory failure', async () => {
    render(<App />);
    const { user, title, form } = await edit();
    await form.findByRole('option', { name: 'New account (new@example.test)' });
    await user.selectOptions(form.getByLabelText('User account'), 'new-user');
    fireEvent.change(form.getByLabelText('Phone'), { target: { value: 'TEST-PHONE' } });
    state.users = false;
    let resumed = await keepAndResume(user, title);
    await waitFor(() => expect(resumed.getByLabelText('User account')).toBeEnabled());
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('no longer available');
    expect(state.put).not.toHaveBeenCalled();
    await user.selectOptions(resumed.getByLabelText('User account'), '');
    await user.click(resumed.getByRole('button', { name: 'Keep draft', exact: true }));
    state.usersError = true;
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    resumed = within(await screen.findByRole('dialog', { name: title }));
    expect(await resumed.findByRole('alert')).toHaveTextContent('Account directory unavailable');
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/employees/employee', { phone: 'TEST-PHONE' }),
    );
  });
  it('keeps a draft after a failed source read and rejects resuming without edit permission', async () => {
    const view = render(<App />);
    const { user, title, form } = await edit();
    fireEvent.change(form.getByLabelText('Phone'), { target: { value: 'TEST-PHONE' } });
    await user.click(form.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    state.sourceError = true;
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no longer available');
    state.sourceError = false;
    state.permissions.delete('employees.update');
    view.rerender(<App />);
    state.get.mockClear();
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    expect(await screen.findByRole('alert')).toHaveTextContent('current role');
    expect(state.get).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
    state.permissions.add('employees.update');
    view.rerender(<App />);
    await user.click(screen.getByRole('button', { name: 'Resume ' + title }));
    expect(
      within(await screen.findByRole('dialog', { name: title })).getByLabelText('Phone'),
    ).toHaveValue('TEST-PHONE');
  });
  it('retains the selected tab per window and gives keyboard tabs unique targets', async () => {
    render(<App companion />);
    const user = userEvent.setup();
    const primary = within(screen.getByRole('region', { name: 'Primary Payroll' }));
    const other = within(screen.getByRole('region', { name: 'Other employee window' }));
    await primary.findByRole('heading', { name: 'Alex Example' });
    await other.findByRole('heading', { name: 'Alex Example' });
    const firstTab = primary.getByRole('tab', { name: 'Profile' });
    const otherTab = other.getByRole('tab', { name: 'Profile' });
    expect(firstTab.id).not.toBe(otherTab.id);
    await user.click(otherTab);
    await user.keyboard('{ArrowRight}');
    expect(other.getByRole('tab', { name: 'Tax & Statutory' })).toHaveFocus();
    expect(firstTab).toHaveAttribute('aria-selected', 'true');
    await user.click(primary.getByRole('tab', { name: 'Banking & Mobile Money' }));
    await user.click(primary.getByRole('link', { name: 'Open home' }));
    await user.click(primary.getByRole('link', { name: 'Open employee' }));
    expect(await primary.findByRole('tab', { name: 'Banking & Mobile Money' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(other.getByRole('tab', { name: 'Tax & Statutory' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
  it('owns a resumed draft in one window and refreshes the other employee after saving', async () => {
    render(<App companion />);
    const primary = within(screen.getByRole('region', { name: 'Primary Payroll' }));
    const other = within(screen.getByRole('region', { name: 'Other employee window' }));
    const { user, title, form } = await edit('profile', primary);
    fireEvent.change(form.getByLabelText('Phone'), { target: { value: 'TEST-PHONE' } });
    await user.click(form.getByRole('button', { name: 'Keep draft', exact: true }));
    await user.click(primary.getByRole('button', { name: 'Resume ' + title }));
    const resumed = within(await screen.findByRole('dialog', { name: title }));
    expect(other.getByRole('button', { name: 'Resume ' + title })).toBeDisabled();
    state.updated = true;
    await user.click(resumed.getByRole('button', { name: 'Save', exact: true }));
    expect(await other.findByRole('heading', { name: 'Alex Latest' })).toBeVisible();
    expect(other.queryByRole('button', { name: 'Resume ' + title })).not.toBeInTheDocument();
  });
});

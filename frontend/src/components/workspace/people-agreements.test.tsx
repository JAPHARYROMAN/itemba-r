import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmploymentContractsPage from '@/app/(dashboard)/hr/employment-contracts/page';
import EmployeeAssignmentsPage from '@/app/(dashboard)/hr/employee-assignments/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  contractStatus: 'DRAFT',
  scopeError: '',
  retry: vi.fn(),
  router: { push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPut: state.put,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companyOptions: [
      { value: 'source', label: 'Source company' },
      { value: 'destination', label: 'Destination company' },
    ],
    employeeOptions: [{ value: 'employee', label: 'Alex Example' }],
    divisionOptions: [{ value: 'division', label: 'Division' }],
    branches: [{ id: 'branch', divisionId: 'division', name: 'Branch' }],
    loading: false,
    error: state.scopeError,
    retry: state.retry,
  }),
}));
const employee = {
  id: 'employee',
  fullName: 'Alex Example',
  employeeCode: 'EMP-1',
  company: { name: 'Source company' },
};
const assignment = {
  id: 'assignment',
  employeeId: 'employee',
  employee,
  companyId: 'destination',
  company: { id: 'destination', name: 'Destination company' },
  divisionId: 'division',
  branchId: 'branch',
  assignmentContextType: 'DIVISION',
  startDate: '2026-01-01',
  endDate: '2026-02-01',
  status: 'INACTIVE',
  approvalStatus: 'PENDING_GROUP_HR_APPROVAL',
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'employment_contracts.view',
    'employment_contracts.create',
    'employment_contracts.approve',
    'employment_contracts.terminate',
    'employees.view',
    'employees.assignments.manage',
    'employees.transfer.approve.hr',
  ]);
  state.contractStatus = 'DRAFT';
  state.scopeError = '';
  state.page.mockImplementation(async (path) =>
    path === '/hr/employees'
      ? { data: [employee], total: 1 }
      : path === '/hr/employee-assignments'
        ? { data: [assignment], total: 25 }
        : {
            data: [
              {
                id: 'contract',
                contractCode: 'CON-1',
                employee,
                company: { name: 'Source company' },
                contractType: 'PERMANENT',
                salaryAmount: 125,
                currency: 'USD',
                status: state.contractStatus,
              },
            ],
            total: 25,
          },
  );
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
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
function mount(Page: typeof EmploymentContractsPage) {
  render(
    <UnsavedWorkProvider>
      <Page />
    </UnsavedWorkProvider>,
  );
  return userEvent.setup();
}
describe('Contract and assignment workspaces', () => {
  it('hides transfer approval from assignment managers without approval permission', async () => {
    state.permissions.delete('employees.transfer.approve.hr');
    const user = mount(EmployeeAssignmentsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.queryByRole('button', { name: 'Approve transfer' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit assignment' })).toBeInTheDocument();
  });
  it('resets pagination when contract search changes and preserves the company filter', async () => {
    const user = mount(EmploymentContractsPage);
    await screen.findByRole('button', { name: 'Inspect CON-1' });
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.selectOptions(screen.getByLabelText('Company filter'), 'source');
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await user.type(screen.getByRole('searchbox'), 'Alex');
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/employment-contracts',
        expect.objectContaining({
          query: expect.objectContaining({ page: 1, search: 'Alex', companyId: 'source' }),
        }),
      ),
    );
  });
  it('keeps contract readers out of creation and approval while paging real results', async () => {
    state.permissions = new Set(['employment_contracts.view']);
    const user = mount(EmploymentContractsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect CON-1' }));
    expect(screen.getByText('USD 125')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New contract' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve contract' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/employment-contracts',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
  });
  it('retains contract drafts after failed saves and sends typed pay terms with automatic numbering', async () => {
    const user = mount(EmploymentContractsPage);
    await user.click(screen.getByRole('button', { name: 'New contract' }));
    const editor = within(await screen.findByRole('dialog', { name: 'New employment contract' }));
    await user.selectOptions(editor.getByLabelText(/^Company/), 'source');
    await user.selectOptions(editor.getByLabelText(/^Employee/), 'employee');
    await setDateField(/^Start date/, '2026-01-01', user, editor);
    await user.type(editor.getByLabelText(/^Salary amount/), '123.50');
    await user.clear(editor.getByLabelText(/^Currency/));
    await user.type(editor.getByLabelText(/^Currency/), 'usd');
    await user.type(editor.getByLabelText('Additional terms'), 'Test agreement terms');
    state.post.mockRejectedValueOnce(new Error('Contract save unavailable'));
    await user.click(editor.getByRole('button', { name: 'Create draft' }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Contract save unavailable');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(editor.getByLabelText('Additional terms')).toHaveValue('Test agreement terms');
    await user.click(editor.getByRole('button', { name: 'Create draft' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Contract created as a draft.');
    expect(state.post).toHaveBeenLastCalledWith(
      '/hr/employment-contracts',
      expect.objectContaining({
        employeeId: 'employee',
        salaryAmount: 123.5,
        currency: 'USD',
        createdById: 'operator',
        terms: 'Test agreement terms',
      }),
    );
    expect(state.post.mock.calls[1][1]).not.toHaveProperty('contractCode');
  });
  it('keeps failed contract approval in a named confirmation until retry succeeds', async () => {
    const user = mount(EmploymentContractsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect CON-1' }));
    await user.click(screen.getByRole('button', { name: 'Approve contract' }));
    const confirmation = within(await screen.findByRole('dialog', { name: 'Approve CON-1?' }));
    state.patch.mockRejectedValueOnce(new Error('Approval unavailable'));
    await user.click(confirmation.getByRole('button', { name: 'Approve contract' }));
    expect(await confirmation.findByRole('alert')).toHaveTextContent('Approval unavailable');
    await user.click(confirmation.getByRole('button', { name: 'Approve contract' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Contract approved and active.');
  });
  it('protects the termination reason and submits it to the contract endpoint only', async () => {
    state.contractStatus = 'ACTIVE';
    const user = mount(EmploymentContractsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect CON-1' }));
    await user.click(screen.getByRole('button', { name: 'Terminate contract' }));
    const confirmation = within(await screen.findByRole('dialog', { name: 'Terminate CON-1?' }));
    await user.type(confirmation.getByLabelText('Reason (optional)'), 'Test-only agreement end');
    await user.click(confirmation.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(confirmation.getByLabelText('Reason (optional)')).toHaveValue('Test-only agreement end');
    await user.click(confirmation.getByRole('button', { name: 'Terminate contract' }));
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/hr/employment-contracts/contract/terminate', {
        reason: 'Test-only agreement end',
      }),
    );
  });
  it('allows an accessible employee from another company in a transfer draft and omits unsupported audit fields', async () => {
    const user = mount(EmployeeAssignmentsPage);
    await user.click(screen.getByRole('button', { name: 'New assignment' }));
    const editor = within(await screen.findByRole('dialog', { name: 'New assignment' }));
    await waitFor(() => expect(editor.getByLabelText(/^Employee/)).toBeEnabled());
    await user.selectOptions(editor.getByLabelText(/^Employee/), 'employee');
    await user.selectOptions(editor.getByLabelText(/^Destination company/), 'destination');
    expect(editor.getByLabelText(/^Employee/)).toHaveValue('employee');
    await setDateField(/^Start date/, '2026-01-01', user, editor);
    state.post.mockRejectedValueOnce(new Error('Assignment save unavailable'));
    await user.click(editor.getByRole('button', { name: 'Save assignment' }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Assignment save unavailable');
    await user.click(editor.getByRole('button', { name: 'Save assignment' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Assignment created.');
    expect(state.post).toHaveBeenLastCalledWith(
      '/hr/employee-assignments',
      expect.objectContaining({ employeeId: 'employee', companyId: 'destination' }),
    );
    expect(state.post.mock.calls[1][1]).not.toHaveProperty('createdById');
    expect(state.page).toHaveBeenCalledWith(
      '/hr/employees',
      expect.objectContaining({ query: { page: 1, limit: 100 } }),
    );
  });
  it('locks transfer identity on edit, protects pending status and clears optional fields explicitly', async () => {
    const user = mount(EmployeeAssignmentsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Edit assignment' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit assignment' }));
    await waitFor(() =>
      expect(editor.getByRole('button', { name: 'Save assignment' })).toBeEnabled(),
    );
    expect(editor.getByLabelText(/^Employee/)).toBeDisabled();
    expect(editor.getByLabelText(/^Destination company/)).toBeDisabled();
    expect(editor.getByLabelText('Division')).toBeDisabled();
    expect(editor.getByLabelText('Status')).toBeDisabled();
    await user.selectOptions(editor.getByLabelText('Branch'), '');
    await setDateField('End date', '', user, editor);
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    await user.click(editor.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith(
        '/hr/employee-assignments/assignment',
        expect.objectContaining({ branchId: null, endDate: null }),
      ),
    );
    expect(state.put.mock.calls[0][1]).not.toHaveProperty('status');
    expect(state.put.mock.calls[0][1]).not.toHaveProperty('startDate');
    expect(state.put.mock.calls[0][1]).not.toHaveProperty('companyId');
    expect(state.put.mock.calls[0][1]).not.toHaveProperty('employeeId');
  });
  it('requires transfer-approval permission and retains failures in the confirmation', async () => {
    const user = mount(EmployeeAssignmentsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Approve transfer' }));
    const confirmation = within(
      await screen.findByRole('dialog', { name: 'Approve transfer for Alex Example?' }),
    );
    state.patch.mockRejectedValueOnce(new Error('Maker-checker: requester cannot approve'));
    await user.click(confirmation.getByRole('button', { name: 'Approve transfer' }));
    expect(
      await confirmation.findByText(/Maker-checker: requester cannot approve/),
    ).toBeInTheDocument();
    await user.click(confirmation.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
  it('shows assignment deletion failures without dismissing the record confirmation', async () => {
    const user = mount(EmployeeAssignmentsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Delete assignment' }));
    const confirmation = within(
      await screen.findByRole('dialog', { name: 'Delete assignment for Alex Example?' }),
    );
    state.remove.mockRejectedValueOnce(new Error('Delete unavailable'));
    await user.click(confirmation.getByRole('button', { name: 'Delete assignment' }));
    expect(await confirmation.findByText(/Delete unavailable/)).toBeInTheDocument();
    await user.click(confirmation.getByRole('button', { name: 'Cancel' }));
  });
});

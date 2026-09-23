import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeDetailPage from '@/app/(dashboard)/hr/employees/[id]/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  router: { push: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'employee' }),
  useRouter: () => state.router,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPut: state.put,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
const employee = {
  id: 'employee',
  firstName: 'Alex',
  lastName: 'Example',
  fullName: 'Alex Example',
  employeeCode: 'EMP-1',
  company: { id: 'company', name: 'Example' },
  employmentStatus: 'ACTIVE',
  baseSalary: '150',
  salaryCurrency: 'USD',
  bankName: 'Example Bank',
  bankAccountNumber: 'test-account',
  tin: 'test-tin',
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'employees.view',
    'employees.update',
    'employees.sensitive.view',
    'employees.delete',
    'employees.termination.request',
    'employment_contracts.view',
  ]);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.get.mockImplementation(async (path) =>
    path === '/hr/employees/employee' ? { ...employee } : [],
  );
  state.page.mockResolvedValue({ data: [], total: 0 });
  state.put.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  state.post.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
async function mount() {
  render(
    <UnsavedWorkProvider>
      <EmployeeDetailPage />
    </UnsavedWorkProvider>,
  );
  await screen.findByRole('heading', { name: 'Alex Example' });
  return userEvent.setup();
}
describe('Employee profile workspace', () => {
  it('keeps a rejected termination approval visible and clears it after a successful retry', async () => {
    state.permissions.add('employees.termination.approve.hr');
    state.get.mockImplementation(async (path) =>
      path === '/hr/employees/employee'
        ? { ...employee, terminationRequestedAt: '2026-01-01', terminationReason: 'Test request' }
        : [],
    );
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Approve Termination' }));
    const confirmation = within(screen.getByRole('dialog', { name: 'Approve Termination' }));
    state.patch.mockRejectedValueOnce(new Error('Requester cannot approve their own request'));
    await user.click(confirmation.getByRole('button', { name: 'Approve Termination' }));
    expect(
      await confirmation.findByText('Requester cannot approve their own request'),
    ).toBeInTheDocument();
    await user.click(confirmation.getByRole('button', { name: 'Approve Termination' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Termination approved.');
    expect(state.patch).toHaveBeenLastCalledWith('/hr/employees/employee/approve-termination');
  });
  it('keeps a failed employee deletion in its named confirmation', async () => {
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Delete', exact: true }));
    const confirmation = within(screen.getByRole('dialog', { name: 'Delete Alex Example?' }));
    state.remove.mockRejectedValueOnce(new Error('Payroll entries prevent deletion'));
    await user.click(confirmation.getByRole('button', { name: 'Delete', exact: true }));
    expect(await confirmation.findByText('Payroll entries prevent deletion')).toBeInTheDocument();
    expect(state.router.push).not.toHaveBeenCalled();
    await user.click(confirmation.getByRole('button', { name: 'Cancel' }));
  });
  it('retains failed mobile-account removal and lets the user retry', async () => {
    state.get.mockImplementation(async (path) =>
      path === '/hr/employees/employee'
        ? { ...employee }
        : path === '/hr/mobile-money-accounts'
          ? [
              {
                id: 'account',
                provider: 'M_PESA',
                msisdn: 'test-number',
                isPrimary: false,
                status: 'ACTIVE',
              },
            ]
          : [],
    );
    const user = await mount();
    await user.click(screen.getByRole('tab', { name: 'Banking & Mobile Money' }));
    await user.click(await screen.findByRole('button', { name: 'Inspect M-Pesa (Vodacom)' }));
    await user.click(screen.getByRole('button', { name: 'Remove account' }));
    const confirmation = within(
      screen.getByRole('dialog', { name: 'Remove account for Alex Example?' }),
    );
    state.remove.mockRejectedValueOnce(new Error('Account removal unavailable'));
    await user.click(confirmation.getByRole('button', { name: 'Remove', exact: true }));
    expect(await confirmation.findByText('Account removal unavailable')).toBeInTheDocument();
    await user.click(confirmation.getByRole('button', { name: 'Remove', exact: true }));
    expect(state.remove).toHaveBeenLastCalledWith('/hr/mobile-money-accounts/account');
    expect(await screen.findByRole('status')).toHaveTextContent('Mobile money account removed.');
  });
  it('keeps readers out of edit actions and unrelated collections', async () => {
    state.permissions = new Set(['employees.view']);
    const user = await mount();
    expect(screen.queryByRole('button', { name: 'Edit profile' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete', exact: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Contracts' }));
    expect(screen.getByText('Your role cannot view contracts.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    await user.click(screen.getByRole('tab', { name: 'Banking & Mobile Money' }));
    expect(screen.queryByRole('button', { name: 'Add account' })).not.toBeInTheDocument();
  });
  it('shows failed employee loads and can retry instead of displaying an empty profile', async () => {
    state.get.mockRejectedValueOnce(new Error('Employee service unavailable'));
    render(
      <UnsavedWorkProvider>
        <EmployeeDetailPage />
      </UnsavedWorkProvider>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Employee service unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Alex Example' })).toBeInTheDocument();
  });
  it('retains failed profile edits, guards dismissal and only sends changed fields', async () => {
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Edit profile' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit profile' }));
    await user.clear(editor.getByLabelText(/First Name/));
    await user.type(editor.getByLabelText(/First Name/), 'Jordan');
    state.put.mockRejectedValueOnce(new Error('Save unavailable'));
    await user.click(editor.getByRole('button', { name: 'Save', exact: true }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Save unavailable');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(editor.getByLabelText(/First Name/)).toHaveValue('Jordan');
    await user.click(editor.getByRole('button', { name: 'Save', exact: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('Employee details updated.');
    expect(state.put).toHaveBeenLastCalledWith('/hr/employees/employee', {
      firstName: 'Jordan',
      fullName: 'Jordan Example',
    });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it('discards statutory changes before banking and clears an optional bank field explicitly', async () => {
    const user = await mount();
    await user.click(screen.getByRole('tab', { name: 'Tax & Statutory' }));
    await user.click(screen.getByRole('button', { name: 'Edit tax & statutory' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit tax & statutory' }));
    await user.type(editor.getByLabelText('TIN'), '-draft');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await user.click(screen.getByRole('tab', { name: 'Banking & Mobile Money' }));
    await user.click(screen.getByRole('button', { name: 'Edit bank details' }));
    const bank = within(await screen.findByRole('dialog', { name: 'Edit bank details' }));
    await user.clear(bank.getByLabelText('Bank name'));
    await user.click(bank.getByRole('button', { name: 'Save bank details' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/employees/employee', { bankName: null }),
    );
  });
  it('loads and pages employee-specific contracts; keyboard tabs expose selection', async () => {
    state.page.mockResolvedValue({
      data: [
        { id: 'contract', contractCode: 'CON-1', status: 'ACTIVE', contractType: 'PERMANENT' },
      ],
      total: 25,
    });
    const user = await mount();
    await user.click(screen.getByRole('tab', { name: 'Contracts' }));
    await user.click(await screen.findByRole('button', { name: 'Inspect CON-1' }));
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/employment-contracts',
        expect.objectContaining({ query: { employeeId: 'employee', page: 2, limit: 20 } }),
      ),
    );
    await user.click(screen.getByRole('tab', { name: 'Contracts' }));
    await user.keyboard('{Home}{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Tax & Statutory' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: 'Tax & Statutory' })).toHaveFocus();
  });
  it('protects mobile account drafts and reports failed requests without closing the editor', async () => {
    const user = await mount();
    await user.click(screen.getByRole('tab', { name: 'Banking & Mobile Money' }));
    await user.click(screen.getByRole('button', { name: 'Add account' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Add mobile money account' }));
    await user.type(editor.getByLabelText(/Mobile number/), '0712345678');
    state.post.mockRejectedValueOnce(new Error('Account save unavailable'));
    await user.click(editor.getByRole('button', { name: 'Add', exact: true }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Account save unavailable');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(editor.getByLabelText(/Mobile number/)).toHaveValue('0712345678');
    await user.click(editor.getByRole('button', { name: 'Add', exact: true }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    expect(state.post).toHaveBeenLastCalledWith(
      '/hr/mobile-money-accounts',
      expect.objectContaining({ employeeId: 'employee', msisdn: '0712345678' }),
    );
  });
  it('keeps a termination draft and its failure visible until explicitly discarded', async () => {
    const user = await mount();
    await user.click(screen.getByRole('button', { name: 'Request Termination', exact: true }));
    const editor = within(await screen.findByRole('dialog', { name: 'Request Termination' }));
    await user.type(editor.getByLabelText('Termination reason'), 'Test-only reason');
    state.patch.mockRejectedValueOnce(new Error('Request unavailable'));
    await user.click(editor.getByRole('button', { name: 'Request Termination' }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Request unavailable');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Request Termination' })).not.toBeInTheDocument(),
    );
  });
});

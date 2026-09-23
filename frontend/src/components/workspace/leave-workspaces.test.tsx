import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LeaveRequestsPage from '@/app/(dashboard)/hr/leave-requests/page';
import LeaveTypesPage from '@/app/(dashboard)/hr/leave-types/page';
import LeaveBalancesPage from '@/app/(dashboard)/hr/leave-balances/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  patch: vi.fn(),
  status: 'SUBMITTED',
  days: 6,
  lineApproved: null as string | null,
  scopeError: '',
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
}));
vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companies: [{ id: 'company', name: 'Company' }],
    companyOptions: [
      { value: 'company', label: 'Company' },
      { value: 'other', label: 'Other company' },
    ],
    employeeOptions: [{ value: 'employee', label: 'Alex Example' }],
    loading: false,
    error: state.scopeError,
    retry: vi.fn(),
  }),
}));
const type = {
  id: 'type',
  companyId: 'company',
  company: { name: 'Company' },
  name: 'Annual leave',
  code: 'ANNUAL',
  paid: true,
  annualAllowanceDays: 21,
  carryForwardAllowed: true,
  isActive: true,
};
const employee = { id: 'employee', fullName: 'Alex Example' };
const balance = {
  id: 'balance',
  employeeId: 'employee',
  employee,
  companyId: 'company',
  company: { id: 'company', name: 'Company' },
  leaveTypeId: 'type',
  leaveType: type,
  year: 2026,
  allocatedDays: '21',
  carriedForwardDays: '2',
  usedDays: '4',
  notes: 'Old note',
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'leave_requests.view',
    'leave_requests.create',
    'leave_requests.approve',
    'leave_requests.approve.hr',
    'leave_requests.reject',
    'employees.view',
    'leave_types.view',
    'leave_types.manage',
    'leave_balances.view',
    'leave_balances.manage',
  ]);
  state.status = 'SUBMITTED';
  state.days = 6;
  state.lineApproved = null;
  state.scopeError = '';
  state.page.mockImplementation(async (path, options) => {
    if (path === '/hr/leave-types')
      return {
        data: [type, { ...type, id: 'inactive', name: 'Retired leave', isActive: false }],
        total: options.query.limit === 100 ? 2 : 25,
      };
    if (path === '/hr/employees') return { data: [employee], total: 1 };
    if (path === '/hr/leave-balances') return { data: [balance], total: 25 };
    return {
      data: [
        {
          id: 'request',
          leaveRequestNumber: 'LR-1',
          employee,
          company: { name: 'Company' },
          leaveType: type,
          startDate: '2026-09-17',
          endDate: '2026-09-22',
          totalDays: state.days,
          status: state.status,
          lineApprovedById: state.lineApproved,
        },
      ],
      total: 25,
    };
  });
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
  state.patch.mockResolvedValue({ status: 'APPROVED' });
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
function mount(Page: typeof LeaveRequestsPage) {
  render(
    <UnsavedWorkProvider>
      <Page />
    </UnsavedWorkProvider>,
  );
  return userEvent.setup();
}
describe('Leave workspaces', () => {
  it('restricts long-leave HR actions by permission and recorded approval', async () => {
    state.permissions.delete('leave_requests.approve.hr');
    state.lineApproved = 'line-manager';
    const user = mount(LeaveRequestsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.queryByRole('button', { name: 'Group HR approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Line approval' })).not.toBeInTheDocument();
    expect(screen.getByText('Required for leave over 5 days')).toBeInTheDocument();
  });
  it('keeps an HR approval rejection and its notes, with guarded dismissal and retry', async () => {
    state.patch.mockRejectedValueOnce(new Error('Approvers must differ'));
    const user = mount(LeaveRequestsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Group HR approval' }));
    await screen.findByRole('dialog');
    const dialog = await screen.findByRole('dialog', {
      name: 'Group HR approval for Alex Example?',
    });
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Approval notes (optional)' }),
      'Reviewed',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    await user.click(within(dialog).getByRole('button', { name: 'Group HR approval' }));
    expect(await within(dialog).findByText('Approvers must differ')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox')).toHaveValue('Reviewed');
    await user.click(within(dialog).getByRole('button', { name: 'Group HR approval' }));
    expect(state.patch).toHaveBeenLastCalledWith('/hr/leave-requests/request/approve-hr', {
      notes: 'Reviewed',
    });
  });
  it('reports a recorded line approval still awaiting the other approval', async () => {
    state.patch.mockResolvedValue({ status: 'SUBMITTED' });
    const user = mount(LeaveRequestsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Line approval' }));
    await screen.findByRole('dialog');
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Line approval' }),
    );
    expect(
      await screen.findByText('Approval recorded. This request still needs the other approval.'),
    ).toBeInTheDocument();
  });
  it('saves an inclusive-day draft, excludes inactive choices and clears dependent choices on company change', async () => {
    const user = mount(LeaveRequestsPage);
    await user.click(screen.getByRole('button', { name: 'New request' }));
    await screen.findByRole('dialog', { name: 'New leave request' });
    await user.selectOptions(screen.getByLabelText(/Company\*/), 'company');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    expect(screen.queryByRole('option', { name: 'Retired leave' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Employee\*/), 'employee');
    await user.selectOptions(screen.getByLabelText(/Leave type\*/), 'type');
    await user.selectOptions(screen.getByLabelText(/Company\*/), 'other');
    expect(screen.getByLabelText(/Employee\*/)).toHaveValue('');
    expect(screen.getByLabelText(/Leave type\*/)).toHaveValue('');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    await user.selectOptions(screen.getByLabelText(/Employee\*/), 'employee');
    await user.selectOptions(screen.getByLabelText(/Leave type\*/), 'type');
    await setDateField(/Start date/, '2026-09-17', user);
    await setDateField(/End date/, '2026-09-22', user);
    expect(screen.getByText(/6 calendar days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith(
        '/hr/leave-requests',
        expect.objectContaining({ companyId: 'other', totalDays: 6, createdById: 'operator' }),
      ),
    );
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('keeps failed request drafts and shows lookup retry instead of an empty chooser', async () => {
    state.post.mockRejectedValue(new Error('Save unavailable'));
    const user = mount(LeaveRequestsPage);
    await user.click(screen.getByRole('button', { name: 'New request' }));
    await screen.findByRole('dialog', { name: 'New leave request' });
    await user.selectOptions(screen.getByLabelText(/Company\*/), 'company');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled());
    await user.selectOptions(screen.getByLabelText(/Employee\*/), 'employee');
    await user.selectOptions(screen.getByLabelText(/Leave type\*/), 'type');
    await setDateField(/Start date/, '2026-09-17', user);
    await setDateField(/End date/, '2026-09-17', user);
    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'Preview reason');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Save unavailable')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Reason' })).toHaveValue('Preview reason');
    state.page.mockRejectedValue(new Error('Leave types unavailable'));
    await user.selectOptions(screen.getByLabelText(/Company\*/), 'other');
    expect(await screen.findByText('Leave types unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry choices' })).toBeInTheDocument();
  });
  it('confirms approved cancellation and sends its reason to the cancellation endpoint', async () => {
    state.status = 'APPROVED';
    const user = mount(LeaveRequestsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    await screen.findByRole('dialog');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/returns any days charged/)).toBeInTheDocument();
    await user.type(within(dialog).getByRole('textbox'), 'Changed dates');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel request' }));
    expect(state.patch).toHaveBeenCalledWith('/hr/leave-requests/request/cancel', {
      reason: 'Changed dates',
    });
  });
  it('clears the optional annual allowance with null and guards type edits', async () => {
    const user = mount(LeaveTypesPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Annual leave' }));
    await user.click(screen.getByRole('button', { name: 'Edit leave type' }));
    await screen.findByRole('dialog', { name: 'Edit leave type' });
    fireEvent.change(screen.getByLabelText('Annual allowance days'), { target: { value: '' } });
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    await user.click(screen.getByRole('button', { name: 'Save leave type' }));
    await waitFor(() =>
      expect(state.put).toHaveBeenCalledWith('/hr/leave-types/type', { annualAllowanceDays: null }),
    );
  });
  it('keeps a failed type deactivation in its confirmation', async () => {
    state.put.mockRejectedValue(new Error('Policy in use'));
    const user = mount(LeaveTypesPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Annual leave' }));
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByText(/Policy in use/)).toBeInTheDocument();
  });
  it('requires the exact read permission for balances even when manage is granted', () => {
    state.permissions.delete('leave_balances.view');
    mount(LeaveBalancesPage);
    expect(screen.getByText('Your role cannot view leave balances.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('keeps balance usage unchanged and permits clearing notes in a guarded adjustment', async () => {
    const user = mount(LeaveBalancesPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Adjust allocation' }));
    await screen.findByRole('dialog', { name: 'Adjust allocation' });
    fireEvent.change(screen.getByLabelText('Allocated Days'), { target: { value: '25' } });
    await user.clear(screen.getByLabelText('Notes'));
    expect(screen.getByText(/Remaining after this adjustment: 23 days/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    await user.click(screen.getByRole('button', { name: 'Save', exact: true }));
    expect(state.post).toHaveBeenCalledWith('/hr/leave-balances', {
      companyId: 'company',
      employeeId: 'employee',
      leaveTypeId: 'type',
      year: 2026,
      allocatedDays: 25,
      carriedForwardDays: undefined,
      notes: '',
    });
  });
  it('retains scoped pagination and resets balance search to the first page', async () => {
    const user = mount(LeaveBalancesPage);
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/leave-balances',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await user.selectOptions(screen.getByLabelText('Year filter'), '2026');
    await user.type(screen.getByRole('searchbox'), 'Alex');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/leave-balances',
        expect.objectContaining({
          query: expect.objectContaining({
            page: 1,
            companyId: 'company',
            year: '2026',
            search: 'Alex',
          }),
        }),
      ),
    );
  });
});

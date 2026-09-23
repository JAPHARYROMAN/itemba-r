import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PayrollPeriodsPage from '@/app/(dashboard)/hr/payroll-periods/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  status: 'OPEN',
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
}));
vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companyOptions: [{ value: 'company', label: 'Company' }],
    loading: false,
    error: state.scopeError,
    retry: state.retry,
  }),
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set(['payroll.view', 'payroll.manage']);
  state.status = 'OPEN';
  state.scopeError = '';
  state.page.mockImplementation(async () => ({
    data: [
      {
        id: 'period',
        name: 'September 2026',
        payrollPeriodCode: 'PP-2026-09',
        company: { name: 'Company' },
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        paymentDate: '2026-10-02',
        status: state.status,
      },
    ],
    total: 25,
  }));
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
const mount = () =>
  render(
    <UnsavedWorkProvider>
      <PayrollPeriodsPage />
    </UnsavedWorkProvider>,
  );
async function fillPeriod(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'New period' }));
  await screen.findByRole('dialog', { name: 'New payroll period' });
  await user.selectOptions(screen.getByRole('combobox', { name: /^Company/ }), 'company');
  await user.type(screen.getByRole('textbox', { name: /^Name/ }), 'October cycle');
  await setDateField(/Start date/, '2026-10-01', user);
  await setDateField(/End date/, '2026-10-31', user);
}
describe('Payroll period workspace', () => {
  it('requires read permission and does not fetch for a manage-only user', async () => {
    state.permissions = new Set(['payroll.manage']);
    mount();
    expect(screen.getByText('Your role cannot view payroll periods.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('keeps read-only period details and run navigation while hiding changes', async () => {
    state.permissions = new Set(['payroll.view']);
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Inspect September 2026' }));
    expect(screen.queryByRole('button', { name: 'New period' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve period' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'View runs' }));
    expect(state.router.push).toHaveBeenCalledWith('/hr/payroll-runs?payrollPeriodId=period');
  });
  it('paginates on the server and resets the page while preserving scope and status', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'Inspect September 2026' });
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'company');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), 'APPROVED');
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/payroll-periods',
        expect.objectContaining({
          query: expect.objectContaining({
            page: 2,
            limit: 20,
            companyId: 'company',
            status: 'APPROVED',
          }),
        }),
      ),
    );
    await user.type(screen.getByRole('searchbox'), 'September');
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/payroll-periods',
        expect.objectContaining({
          query: expect.objectContaining({
            page: 1,
            companyId: 'company',
            status: 'APPROVED',
            search: 'September',
          }),
        }),
      ),
    );
  });
  it('preserves a failed draft through Stay, retries and sends the existing create contract', async () => {
    state.post.mockRejectedValueOnce(new Error('Period code already exists'));
    const user = userEvent.setup();
    mount();
    await fillPeriod(user);
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('October cycle');
    await user.click(screen.getByRole('button', { name: 'Create period' }));
    expect(await screen.findByText('Period code already exists')).toBeInTheDocument();
    expect(dateFieldValue(getDateField(/Start date/))).toBe('2026-10-01');
    await user.click(screen.getByRole('button', { name: 'Create period' }));
    expect(state.post).toHaveBeenLastCalledWith('/hr/payroll-periods', {
      companyId: 'company',
      name: 'October cycle',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      payrollPeriodCode: undefined,
      paymentDate: undefined,
      createdById: 'operator',
    });
    expect(
      await screen.findByText('Payroll period created. Select the period to view its runs.'),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New payroll period' })).not.toBeInTheDocument(),
    );
  });
  it('rejects reverse dates and explicitly discards the unsaved draft', async () => {
    const user = userEvent.setup();
    mount();
    await fillPeriod(user);
    await setDateField(/End date/, '2026-09-30', user);
    await user.click(screen.getByRole('button', { name: 'Create period' }));
    expect(screen.getByText('End date must be on or after start date.')).toBeInTheDocument();
    expect(state.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel', exact: true }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await user.click(screen.getByRole('button', { name: 'New period' }));
    await screen.findByRole('dialog', { name: 'New payroll period' });
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('');
  });
  it('blocks saving when company loading fails and offers retry', async () => {
    state.scopeError = 'Companies unavailable';
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'New period' }));
    await screen.findByRole('dialog', { name: 'New payroll period' });
    expect(screen.getByRole('button', { name: 'Create period' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Retry choices' }));
    expect(state.retry).toHaveBeenCalled();
  });
  it('names an approval, preserves a failed confirmation and retries the status-only update', async () => {
    state.put.mockRejectedValueOnce(new Error('Approval unavailable'));
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Inspect September 2026' }));
    await user.click(screen.getByRole('button', { name: 'Approve period' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve September 2026?' });
    expect(within(dialog).getByText(/does not approve its individual runs/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve period' }));
    expect(await within(dialog).findByText(/Approval unavailable/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Approve period' }));
    expect(state.put).toHaveBeenLastCalledWith('/hr/payroll-periods/period', {
      status: 'APPROVED',
    });
    expect(await screen.findByText('September 2026 approved.')).toBeInTheDocument();
  });
  it('offers closing for a paid period and performs nothing when confirmation is cancelled', async () => {
    state.status = 'PAID';
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Inspect September 2026' }));
    expect(screen.queryByRole('button', { name: 'Approve period' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close period' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(state.put).not.toHaveBeenCalled();
  });
});

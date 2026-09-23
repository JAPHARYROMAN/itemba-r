import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import SalaryAdvancesPage from '@/app/(dashboard)/hr/salary-advances/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  status: 'REQUESTED',
  lookupFailure: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.status = 'REQUESTED';
  state.lookupFailure = false;
  state.permissions = new Set([
    'salary_advances.view',
    'salary_advances.create',
    'salary_advances.approve',
    'salary_advances.pay',
    'employees.view',
  ]);
  state.page.mockImplementation(async (path) => {
    if (path === '/companies')
      return {
        data: [
          { id: 'company', name: 'Example Company' },
          { id: 'other', name: 'Other Company' },
        ],
        total: 2,
      };
    if (path === '/hr/employees') {
      if (state.lookupFailure) throw new Error('Employees unavailable');
      return {
        data: [{ id: 'employee', fullName: 'Alex Example', employeeCode: 'EXAMPLE-01' }],
        total: 1,
      };
    }
    return {
      data: [
        {
          id: 'advance',
          advanceNumber: 'ADV-EXAMPLE-01',
          companyId: 'company',
          company: { name: 'Example Company' },
          employeeId: 'employee',
          employee: { fullName: 'Alex Example', employeeCode: 'EXAMPLE-01' },
          amount: '500',
          currency: 'USD',
          recoveredAmount: '100',
          repaymentMethod: 'INSTALLMENTS',
          installmentAmount: '50',
          status: state.status,
          reason: 'Synthetic fixture',
          requestDate: '2026-09-17',
        },
      ],
      total: 25,
    };
  });
  state.post.mockResolvedValue({});
  state.patch.mockResolvedValue({});
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
      <SalaryAdvancesPage />
    </UnsavedWorkProvider>,
  );
function captureFixture(name: string) {
  const directory = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name + '.html'), document.body.innerHTML);
}
async function inspect() {
  await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
}
async function openForm() {
  await userEvent.click(screen.getByRole('button', { name: 'Request advance', exact: true }));
  const dialog = await screen.findByRole('dialog', { name: 'Request salary advance' });
  await within(dialog).findByRole('option', { name: 'Example Company' });
  await userEvent.selectOptions(
    within(dialog).getByLabelText('Company', { exact: false }),
    'company',
  );
  return dialog;
}
describe('Salary advances workspace', () => {
  it('does not fetch without read permission and hides mutations for a reader', async () => {
    state.permissions.clear();
    const view = mount();
    expect(screen.getByText('Your role cannot view salary advances.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('salary_advances.view');
    mount();
    await inspect();
    expect(screen.queryByRole('button', { name: 'Request advance' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review approval' })).not.toBeInTheDocument();
  });
  it('searches and paginates with company and status filters', async () => {
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/salary-advances',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await userEvent.selectOptions(screen.getByLabelText('Status filter'), 'SETTLED');
    await userEvent.type(screen.getByPlaceholderText('Search advance or employee…'), ' Alex ');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/salary-advances',
        expect.objectContaining({
          query: { page: 1, limit: 20, companyId: 'company', status: 'SETTLED', search: 'Alex' },
        }),
      ),
    );
  });
  it('retains a failed request and guarded draft, then sends the exact creation payload', async () => {
    mount();
    const dialog = await openForm();
    await within(dialog).findByRole('option', { name: 'Alex Example · EXAMPLE-01' });
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Employee', { exact: false }),
      'employee',
    );
    await userEvent.type(within(dialog).getByLabelText('Amount (TZS)', { exact: false }), '20000');
    await setDateField('Request date', '2026-09-17', userEvent, dialog);
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), '  Example request  ');
    state.post.mockRejectedValueOnce(new Error('Request failed'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request advance' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Request failed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByLabelText('Amount (TZS)', { exact: false })).toHaveValue(20000);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request advance' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenLastCalledWith('/hr/salary-advances', {
        companyId: 'company',
        employeeId: 'employee',
        amount: 20000,
        requestDate: '2026-09-17',
        reason: 'Example request',
        createdById: 'operator',
      }),
    );
    expect(await screen.findByText('Salary advance requested.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('clears the employee after company changes and recovers failed employee choices', async () => {
    state.lookupFailure = true;
    mount();
    const dialog = await openForm();
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Employees unavailable');
    expect(within(dialog).getByRole('button', { name: 'Request advance' })).toBeDisabled();
    state.lookupFailure = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry employees' }));
    await within(dialog).findByRole('option', { name: 'Alex Example · EXAMPLE-01' });
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Employee', { exact: false }),
      'employee',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Company', { exact: false }),
      'other',
    );
    expect(within(dialog).getByLabelText('Employee', { exact: false })).toHaveValue('');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('blocks employee lookup and creation without employee viewing permission', async () => {
    state.permissions.delete('employees.view');
    mount();
    const dialog = await openForm();
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Employee viewing permission');
    expect(within(dialog).getByRole('button', { name: 'Request advance' })).toBeDisabled();
    expect(state.page.mock.calls.some(([path]) => path === '/hr/employees')).toBe(false);
  });
  it('validates approval bounds, retains failed input and guards the adjusted amount', async () => {
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Review approval' }));
    const dialog = await screen.findByRole('dialog', { name: 'Approve advance · ADV-EXAMPLE-01' });
    const input = within(dialog).getByLabelText('Approved amount (USD)');
    captureFixture('advance-approval');
    for (const value of ['0', '501']) {
      fireEvent.change(input, { target: { value } });
      await userEvent.click(
        within(dialog).getByRole('button', { name: 'Approve advance', exact: true }),
      );
      expect(within(dialog).getByRole('alert')).toHaveTextContent(
        'no more than the requested amount',
      );
    }
    expect(state.patch).not.toHaveBeenCalled();
    await userEvent.clear(input);
    await userEvent.type(input, '400');
    state.patch.mockRejectedValueOnce(new Error('Approval failed'));
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Approve advance', exact: true }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Approval failed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(input).toHaveValue(400);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Approve advance', exact: true }),
    );
    await waitFor(() =>
      expect(state.patch).toHaveBeenLastCalledWith('/hr/salary-advances/advance/approve', {
        approvedAmount: 400,
      }),
    );
    expect(await screen.findByText('Salary advance approved.')).toBeInTheDocument();
  });
  it('confirms an approved payment, retains failure and retries only after another click', async () => {
    state.status = 'APPROVED';
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Record payment', exact: true }));
    const dialog = await screen.findByRole('dialog', { name: 'Record payment · ADV-EXAMPLE-01' });
    expect(dialog).toHaveTextContent('does not transfer funds');
    expect(state.patch).not.toHaveBeenCalled();
    state.patch.mockRejectedValueOnce(new Error('Posting failed'));
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Record payment', exact: true }),
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Posting failed');
    expect(state.patch).toHaveBeenCalledTimes(1);
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Record payment', exact: true }),
    );
    expect(await screen.findByText('Advance payment recorded.')).toBeInTheDocument();
    expect(state.patch).toHaveBeenLastCalledWith('/hr/salary-advances/advance/pay', undefined);
  });
  it('shows recovery in the record currency and prevents repeated payment actions', async () => {
    state.status = 'DEDUCTING';
    mount();
    await inspect();
    expect(screen.getByText('USD 400.00')).toBeInTheDocument();
    expect(screen.getByText('USD 50.00')).toBeInTheDocument();
    captureFixture('advance-recovery');
    expect(
      screen.queryByRole('button', { name: 'Record payment', exact: true }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review approval' })).not.toBeInTheDocument();
  });
});

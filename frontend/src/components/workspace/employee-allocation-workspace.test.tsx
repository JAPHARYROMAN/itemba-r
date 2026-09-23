import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { EmployeeAllocationWorkspace } from './employee-allocation-workspace';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { dateFieldValue, getDateField, setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  failTypes: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPut: state.put,
  backendDelete: state.remove,
}));
beforeEach(() => {
  vi.resetAllMocks();
  state.failTypes = false;
  state.permissions = new Set([
    'allowances.view',
    'allowances.manage',
    'deductions.view',
    'deductions.manage',
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
    if (path === '/hr/employees')
      return {
        data: [{ id: 'employee', fullName: 'Alex Example', employeeCode: 'EXAMPLE-01' }],
        total: 1,
      };
    if (path.endsWith('-types')) {
      if (state.failTypes) throw new Error('Types unavailable');
      return {
        data: [{ id: 'type', name: 'Example type', code: 'EXAMPLE', isActive: true }],
        total: 1,
      };
    }
    return {
      data: [
        {
          id: 'allocation',
          companyId: 'company',
          company: { name: 'Example Company' },
          employeeId: 'employee',
          employee: { fullName: 'Alex Example', employeeCode: 'EXAMPLE-01' },
          allowanceTypeId: 'type',
          deductionTypeId: 'type',
          allowanceType: { name: 'Example type', code: 'EXAMPLE' },
          deductionType: { name: 'Example type', code: 'EXAMPLE' },
          amount: '10000',
          percentage: '3.5',
          effectiveFrom: '2026-09-01T06:30:00Z',
          effectiveTo: '2026-09-30T06:30:00Z',
          notes: 'Existing note',
          status: 'ACTIVE',
        },
      ],
      total: 21,
    };
  });
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const mount = (kind: 'allowance' | 'deduction') =>
  render(
    <UnsavedWorkProvider>
      <EmployeeAllocationWorkspace kind={kind} />
    </UnsavedWorkProvider>,
  );
async function inspect() {
  await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
}
function captureFixture(name: string) {
  const directory = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name + '.html'), document.body.innerHTML);
}
async function openEditor(kind: 'allowance' | 'deduction') {
  await inspect();
  captureFixture(kind + '-allocation');
  await userEvent.click(screen.getByRole('button', { name: 'Edit allocation' }));
  const dialog = await screen.findByRole('dialog', { name: 'Edit ' + kind });
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Save allocation' })).toBeEnabled(),
  );
  return dialog;
}
describe.each(['allowance', 'deduction'] as const)('Employee %s workspace', (kind) => {
  it('gates read and manage permissions before requests and actions', async () => {
    state.permissions.clear();
    const view = mount(kind);
    expect(screen.getByText('Your role cannot view employee ' + kind + 's.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add(kind + 's.view');
    mount(kind);
    await inspect();
    expect(screen.queryByRole('button', { name: 'Edit allocation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New ' + kind })).not.toBeInTheDocument();
  });
  it('paginates and searches with scoped type/status filters, clearing type on company change', async () => {
    mount(kind);
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employee-' + kind + 's',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Type filter'), 'type');
    await userEvent.selectOptions(screen.getByLabelText('Status filter'), 'INACTIVE');
    await userEvent.type(screen.getByPlaceholderText('Search employee or type…'), ' Alex ');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employee-' + kind + 's',
        expect.objectContaining({
          query: {
            page: 1,
            limit: 20,
            companyId: '',
            search: 'Alex',
            status: 'INACTIVE',
            [kind + 'TypeId']: 'type',
          },
        }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Company filter'), 'other');
    expect(screen.getByLabelText('Type filter')).toHaveValue('');
  });
  it('retains failed edits, guards drafts and clears the end date without changing the start timestamp', async () => {
    mount(kind);
    const dialog = await openEditor(kind);
    await setDateField('Effective to (optional)', '', userEvent, dialog);
    await userEvent.clear(within(dialog).getByLabelText('Notes (optional)'));
    if (kind === 'deduction') {
      await userEvent.clear(within(dialog).getByLabelText('Amount (TZS)'));
      await userEvent.clear(within(dialog).getByLabelText('Percentage (%)'));
    }
    state.put.mockRejectedValueOnce(new Error('Save failed'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save allocation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save failed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(dateFieldValue(getDateField('Effective to (optional)', dialog))).toBe('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.put).toHaveBeenLastCalledWith('/hr/employee-' + kind + 's/allocation', {
      effectiveTo: null,
      notes: null,
      ...(kind === 'deduction' ? { amount: null, percentage: null } : {}),
    });
  });
  it('rejects reversed dates and retains employee/type identity until company changes', async () => {
    mount(kind);
    const dialog = await openEditor(kind);
    await setDateField('Effective to (optional)', '2026-08-31', userEvent, dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save allocation' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('end date on or after');
    expect(state.put).not.toHaveBeenCalled();
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Company', { exact: false }),
      'other',
    );
    expect(within(dialog).getByLabelText('Employee', { exact: false })).toHaveValue('');
    expect(
      within(dialog).getByLabelText(kind === 'allowance' ? 'Allowance type' : 'Deduction type', {
        exact: false,
      }),
    ).toHaveValue('');
  });
  it('allows unchanged employee identity without employee-view permission but blocks creation', async () => {
    state.permissions.delete('employees.view');
    mount(kind);
    const dialog = await openEditor(kind);
    expect(within(dialog).getByLabelText('Employee', { exact: false })).toBeDisabled();
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Status', { exact: true }),
      'INACTIVE',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save allocation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.put).toHaveBeenLastCalledWith('/hr/employee-' + kind + 's/allocation', {
      status: 'INACTIVE',
    });
    await userEvent.click(screen.getByRole('button', { name: 'New ' + kind }));
    expect(screen.getByRole('button', { name: 'Save allocation' })).toBeDisabled();
    expect(state.page.mock.calls.some(([p]) => p === '/hr/employees')).toBe(false);
  });
  it('creates after a type lookup retry with correctly typed values', async () => {
    mount(kind);
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'New ' + kind }));
    const dialog = await screen.findByRole('dialog', { name: 'New ' + kind });
    await within(dialog).findByRole('option', { name: 'Example Company' });
    state.failTypes = true;
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Company', { exact: false }),
      'company',
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Types unavailable');
    expect(within(dialog).getByRole('button', { name: 'Save allocation' })).toBeDisabled();
    state.failTypes = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry types' }));
    await within(dialog).findByRole('option', { name: 'Example type · EXAMPLE' });
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Employee', { exact: false }),
      'employee',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText(kind === 'allowance' ? 'Allowance type' : 'Deduction type', {
        exact: false,
      }),
      'type',
    );
    await userEvent.type(within(dialog).getByLabelText('Amount (TZS)', { exact: false }), '25000');
    if (kind === 'deduction')
      await userEvent.type(within(dialog).getByLabelText('Percentage (%)'), '2.5');
    await setDateField('Effective from', '2026-09-01', userEvent, dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save allocation' }));
    await waitFor(() =>
      expect(state.post).toHaveBeenCalledWith('/hr/employee-' + kind + 's', {
        companyId: 'company',
        employeeId: 'employee',
        [kind + 'TypeId']: 'type',
        amount: 25000,
        ...(kind === 'deduction' ? { percentage: 2.5 } : {}),
        effectiveFrom: '2026-09-01',
        status: 'ACTIVE',
      }),
    );
  });
  it('requires named deletion confirmation and keeps failures retryable', async () => {
    mount(kind);
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Delete allocation' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete employee ' + kind });
    expect(dialog).toHaveTextContent('Alex Example');
    expect(dialog).toHaveTextContent('Example type');
    expect(state.remove).not.toHaveBeenCalled();
    state.remove.mockRejectedValueOnce(new Error('Delete failed'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete allocation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Delete failed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete allocation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.remove).toHaveBeenLastCalledWith('/hr/employee-' + kind + 's/allocation');
  });
});

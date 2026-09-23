import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DisciplinaryWorkspace } from './disciplinary-workspace';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  user: { id: 'reviewer' },
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  failDisputes: false,
  failList: false,
  status: 'PENDING_HR_APPROVAL',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: state.user, hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
const record = {
  id: 'action',
  actionNumber: 'DA-EXAMPLE-01',
  companyId: 'company',
  company: { name: 'Example Company' },
  employeeId: 'employee',
  employee: { fullName: 'Alex Example', employeeCode: 'EXAMPLE-01' },
  disputeId: 'dispute',
  dispute: { disputeNumber: 'DIS-EXAMPLE-01', status: 'RAISED' },
  type: 'WRITTEN_WARNING',
  issuedAt: '2026-09-01T06:30:00Z',
  effectiveFrom: '2026-09-01T06:30:00Z',
  effectiveTo: '2026-10-01T06:30:00Z',
  issuedById: 'issuer',
  issuedBy: { fullName: 'Example Issuer' },
  reason: 'Synthetic record used to verify the review layout.',
  evidence: 'Example document reference',
  employeeResponse: 'Synthetic response for layout verification.',
  notes: 'No live employment record.',
  fineAmount: '10000',
  fineDeductionId: null,
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'disciplinary_actions.view',
    'disciplinary_actions.create',
    'disciplinary_actions.update',
    'disciplinary_actions.delete',
    'disciplinary_actions.approve.hr',
    'employees.view',
  ]);
  state.user = { id: 'reviewer' };
  state.failDisputes = false;
  state.failList = false;
  state.status = 'PENDING_HR_APPROVAL';
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
        data: [
          { id: 'employee', fullName: 'Alex Example', employeeCode: 'EXAMPLE-01' },
          { id: 'second', fullName: 'Other Example', employeeCode: 'EXAMPLE-02' },
        ],
        total: 2,
      };
    if (path === '/hr/employment-disputes') {
      if (state.failDisputes) throw new Error('Disputes unavailable');
      return {
        data: [{ id: 'dispute', disputeNumber: 'DIS-EXAMPLE-01', status: 'RAISED' }],
        total: 1,
      };
    }
    if (state.failList) throw new Error('Actions unavailable');
    return { data: [{ ...record, status: state.status }], total: 21 };
  });
  state.post.mockResolvedValue({});
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
const mount = () =>
  render(
    <UnsavedWorkProvider>
      <DisciplinaryWorkspace />
    </UnsavedWorkProvider>,
  );
async function inspect() {
  await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
}
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
  }
}
async function edit() {
  await inspect();
  capture('disciplinary-action');
  await userEvent.click(screen.getByRole('button', { name: 'Edit action' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit disciplinary action' });
  await waitFor(() =>
    expect(within(dialog).getByRole('button', { name: 'Save action' })).toBeEnabled(),
  );
  return dialog;
}
describe('Disciplinary workspace', () => {
  it('gates reads and each management action with its exact permission', async () => {
    state.permissions.clear();
    const view = mount();
    expect(screen.getByText('Your role cannot view disciplinary actions.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('disciplinary_actions.view');
    mount();
    await inspect();
    for (const name of ['New action', 'Edit action', 'Review approval', 'Delete record'])
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
  });
  it('preserves server search, pending status/type filters, company scope and pagination', async () => {
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/disciplinary-actions',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await userEvent.selectOptions(screen.getByLabelText('Status filter'), 'PENDING_GM_APPROVAL');
    await userEvent.selectOptions(screen.getByLabelText('Type filter'), 'WRITTEN_WARNING');
    await userEvent.type(screen.getByPlaceholderText('Search action or employee…'), ' Alex ');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/disciplinary-actions',
        expect.objectContaining({
          query: {
            page: 1,
            limit: 20,
            search: 'Alex',
            companyId: 'company',
            status: 'PENDING_GM_APPROVAL',
            type: 'WRITTEN_WARNING',
          },
        }),
      ),
    );
  });
  it('shows read failures with retry instead of an empty collection', async () => {
    state.failList = true;
    mount();
    expect(await screen.findByText('Actions unavailable')).toBeInTheDocument();
    state.failList = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await inspect();
  });
  it('keeps failed changes, guards drafts and explicitly clears optional values without rewriting timestamps', async () => {
    mount();
    const dialog = await edit();
    expect(within(dialog).queryByLabelText(/Company/)).not.toBeInTheDocument();
    for (const label of ['Evidence', 'Employee response', 'Notes'])
      await userEvent.clear(within(dialog).getByLabelText(label));
    await setDateField('Effective from', '', userEvent, dialog);
    await setDateField('Effective to', '', userEvent, dialog);
    await userEvent.selectOptions(within(dialog).getByLabelText('Linked dispute'), '');
    state.patch.mockRejectedValueOnce(new Error('Save unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save action' }));
    expect(await screen.findByText('Save unavailable')).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith('/hr/disciplinary-actions/action', {
      effectiveFrom: null,
      effectiveTo: null,
      disputeId: null,
      evidence: null,
      employeeResponse: null,
      notes: null,
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save action' }));
    expect(await screen.findByText('Disciplinary action saved.')).toBeInTheDocument();
  });
  it('rejects reversed date ranges before saving', async () => {
    mount();
    const dialog = await edit();
    await setDateField('Effective to', '2025-01-01', userEvent, dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save action' }));
    expect(
      await screen.findByText('Effective to must be on or after effective from.'),
    ).toBeInTheDocument();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('retries dispute choices, resets dependent selections and sends a typed creation request', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'New action' }));
    const dialog = screen.getByRole('dialog', { name: 'New disciplinary action' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByLabelText(/Company/)
          .querySelector('option[value="company"]'),
      ).toBeTruthy(),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText(/Company/), 'company');
    await waitFor(() => expect(within(dialog).getByLabelText(/Employee\*/)).toBeEnabled());
    state.failDisputes = true;
    await userEvent.selectOptions(within(dialog).getByLabelText(/Employee\*/), 'employee');
    expect(await screen.findByText('Disputes unavailable')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save action' })).toBeDisabled();
    state.failDisputes = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry disputes' }));
    await waitFor(() => expect(within(dialog).getByLabelText('Linked dispute')).toBeEnabled());
    await userEvent.selectOptions(within(dialog).getByLabelText('Linked dispute'), 'dispute');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Employee\*/), 'second');
    expect(within(dialog).getByLabelText('Linked dispute')).toHaveValue('');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Company/), 'other');
    expect(within(dialog).getByLabelText(/Employee\*/)).toHaveValue('');
    await waitFor(() => expect(within(dialog).getByLabelText(/Employee\*/)).toBeEnabled());
    await userEvent.selectOptions(within(dialog).getByLabelText(/Employee\*/), 'employee');
    await userEvent.selectOptions(within(dialog).getByLabelText('Action type'), 'WRITTEN_WARNING');
    await userEvent.type(within(dialog).getByLabelText('Reason *'), 'Synthetic reason');
    await setDateField(/Issued on/, '2026-09-01', userEvent, dialog);
    capture('disciplinary-form');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Save action' })).toBeEnabled(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save action' }));
    expect(await screen.findByText('Disciplinary action saved.')).toBeInTheDocument();
    expect(state.post).toHaveBeenCalledWith('/hr/disciplinary-actions', {
      companyId: 'other',
      employeeId: 'employee',
      type: 'WRITTEN_WARNING',
      issuedAt: '2026-09-01',
      reason: 'Synthetic reason',
    });
  });
  it('blocks creation without employee viewing while allowing unchanged-identity edits', async () => {
    state.permissions.delete('employees.view');
    mount();
    const dialog = await edit();
    expect(within(dialog).getByLabelText('Linked dispute')).toBeDisabled();
    await userEvent.type(within(dialog).getByLabelText('Notes'), ' updated');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save action' }));
    expect(await screen.findByText('Disciplinary action saved.')).toBeInTheDocument();
    expect(
      state.page.mock.calls.some(
        ([path]) => path === '/hr/employees' || path === '/hr/employment-disputes',
      ),
    ).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: 'New action' }));
    expect(screen.getByRole('button', { name: 'Save action' })).toBeDisabled();
  });
  it('enforces maker-checker and pending eligibility before showing approval confirmation', async () => {
    state.user = { id: 'issuer' };
    const view = mount();
    await inspect();
    expect(screen.getByRole('button', { name: 'Review approval' })).toBeDisabled();
    view.unmount();
    state.user = { id: 'reviewer' };
    state.status = 'ACTIVE';
    mount();
    await inspect();
    expect(screen.queryByRole('button', { name: 'Review approval' })).not.toBeInTheDocument();
  });
  it('reviews named approval and its recorded fine, retaining an approval failure', async () => {
    state.status = 'PENDING_GM_APPROVAL';
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Review approval' }));
    const dialog = screen.getByRole('dialog', { name: 'Approve disciplinary action?' });
    expect(within(dialog).getByText(/DA-EXAMPLE-01 · Alex Example/)).toBeInTheDocument();
    expect(within(dialog).getByText(/Recorded fine: TZS 10,000.00/)).toBeInTheDocument();
    capture('disciplinary-approval');
    expect(state.patch).not.toHaveBeenCalled();
    state.patch.mockRejectedValueOnce(new Error('Approval unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve action' }));
    expect(await screen.findByText('Approval unavailable')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve action' }));
    expect(await screen.findByText('Disciplinary action approved.')).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith('/hr/disciplinary-actions/action/approve');
  });
  it('confirms deletion without implying reversal of the linked payroll deduction', async () => {
    mount();
    await inspect();
    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete disciplinary action?' });
    expect(
      within(dialog).getByText(/Any linked payroll deduction remains unchanged/),
    ).toBeInTheDocument();
    state.remove.mockRejectedValueOnce(new Error('Delete unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete action' }));
    expect(await screen.findByText('Delete unavailable')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete action' }));
    expect(await screen.findByText('Disciplinary action deleted.')).toBeInTheDocument();
  });
});

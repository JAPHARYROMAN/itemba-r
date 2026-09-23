import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DisputeWorkspace } from './dispute-workspace';
import { DisputeDetailWorkspace } from './dispute-detail';
import type { DisputeRecord } from './dispute-types';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  push: vi.fn(),
  failEmployees: false,
  record: null as DisputeRecord | null,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendGet: state.get,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
const record: DisputeRecord = {
  id: 'dispute',
  disputeNumber: 'DIS-EXAMPLE-01',
  companyId: 'company',
  company: { id: 'company', name: 'Example Company' },
  employeeId: 'employee',
  employee: {
    id: 'employee',
    fullName: 'Alex Example',
    employeeCode: 'EXAMPLE-01',
    department: { name: 'Operations' },
    position: { title: 'Coordinator' },
  },
  type: 'GRIEVANCE',
  status: 'RAISED',
  raisedAt: '2026-09-01T06:30:00Z',
  summary: 'Synthetic case for interface review.',
  initialPosition: 'Synthetic initial position for layout verification.',
  notes: 'No live employment information.',
  raisedBy: { fullName: 'Example Operator' },
  disciplinaryActions: [
    {
      id: 'action',
      actionNumber: 'DA-EXAMPLE',
      type: 'WRITTEN_WARNING',
      status: 'PENDING_HR_APPROVAL',
      issuedAt: '2026-09-02T00:00:00Z',
      reason: 'Synthetic linked record.',
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'employees.view',
    'employees.update',
    'employees.delete',
    'disciplinary_actions.view',
  ]);
  state.failEmployees = false;
  state.record = { ...record };
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
      if (state.failEmployees) throw new Error('Employees unavailable');
      return { data: [record.employee], total: 1 };
    }
    return { data: [state.record], total: 21 };
  });
  state.get.mockImplementation(async () => state.record);
  state.post.mockResolvedValue({});
  state.patch.mockImplementation(async (path) => {
    const status = path.endsWith('/mediate')
      ? 'INTERNAL_MEDIATION'
      : path.endsWith('/refer-cma')
        ? 'CMA_REFERRED'
        : path.endsWith('/resolve')
          ? 'RESOLVED'
          : path.endsWith('/withdraw')
            ? 'WITHDRAWN'
            : state.record!.status;
    state.record = { ...state.record!, status };
    return state.record;
  });
  state.remove.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const mount = (detail = false) =>
  render(
    <UnsavedWorkProvider>
      {detail ? <DisputeDetailWorkspace id="dispute" /> : <DisputeWorkspace />}
    </UnsavedWorkProvider>,
  );
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
  }
}
async function detail() {
  mount(true);
  await screen.findByRole('heading', { name: 'Dispute DIS-EXAMPLE-01' });
}
describe('Dispute workspaces', () => {
  it('gates list and direct reads, and hides every mutation from viewers', async () => {
    state.permissions.clear();
    let view = mount();
    expect(screen.getByText('Your role cannot view employment disputes.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    view = mount(true);
    expect(state.get).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('employees.view');
    await detail();
    for (const name of [
      'Edit dispute',
      'Start mediation',
      'Record CMA referral',
      'Record resolution',
      'Withdraw',
      'Delete record',
    ])
      expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    expect(screen.queryByText('DA-EXAMPLE')).not.toBeInTheDocument();
  });
  it('combines company/status search with pagination and keeps the detail route', async () => {
    mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    capture('dispute-register');
    expect(screen.getByRole('link', { name: 'Open dispute' })).toHaveAttribute(
      'href',
      '/hr/disputes/dispute',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employment-disputes',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await userEvent.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await userEvent.selectOptions(screen.getByLabelText('Status filter'), 'CMA_REFERRED');
    await userEvent.type(
      screen.getByPlaceholderText('Search dispute, employee or summary…'),
      ' Alex ',
    );
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employment-disputes',
        expect.objectContaining({
          query: {
            page: 1,
            limit: 20,
            companyId: 'company',
            status: 'CMA_REFERRED',
            search: 'Alex',
          },
        }),
      ),
    );
  });
  it('retries employee choices, clears identity on company change and retains a failed create', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'New dispute' }));
    const dialog = screen.getByRole('dialog', { name: 'New dispute' });
    await waitFor(() =>
      expect(
        within(dialog)
          .getByLabelText(/Company/)
          .querySelector('option[value="company"]'),
      ).toBeTruthy(),
    );
    state.failEmployees = true;
    await userEvent.selectOptions(within(dialog).getByLabelText(/Company/), 'company');
    expect(await screen.findByText('Employees unavailable')).toBeInTheDocument();
    state.failEmployees = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry employees' }));
    await waitFor(() => expect(within(dialog).getByLabelText(/Employee/)).toBeEnabled());
    await userEvent.selectOptions(within(dialog).getByLabelText(/Employee/), 'employee');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Company/), 'other');
    expect(within(dialog).getByLabelText(/Employee/)).toHaveValue('');
    await waitFor(() => expect(within(dialog).getByLabelText(/Employee/)).toBeEnabled());
    await userEvent.selectOptions(within(dialog).getByLabelText(/Employee/), 'employee');
    await setDateField(/Raised on/, '2026-09-01', userEvent, dialog);
    await userEvent.type(within(dialog).getByLabelText('Summary *'), ' Synthetic issue ');
    state.post.mockRejectedValueOnce(new Error('Save unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save dispute' }));
    expect(await screen.findByText('Save unavailable')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save dispute' }));
    expect(await screen.findByText('Dispute saved.')).toBeInTheDocument();
    expect(state.post).toHaveBeenCalledWith('/hr/employment-disputes', {
      companyId: 'other',
      employeeId: 'employee',
      type: 'GRIEVANCE',
      raisedAt: '2026-09-01',
      summary: 'Synthetic issue',
    });
  });
  it('renders retryable detail failures and never displays a previous response under a new id', async () => {
    let finish: (r: DisputeRecord) => void = () => {};
    state.get
      .mockImplementationOnce(
        () =>
          new Promise<DisputeRecord>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new Error('Not found'));
    const view = mount(true);
    view.rerender(
      <UnsavedWorkProvider>
        <DisputeDetailWorkspace id="missing" />
      </UnsavedWorkProvider>,
    );
    expect(await screen.findByText('Not found')).toBeInTheDocument();
    finish(record);
    expect(screen.queryByText(record.summary)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(record.summary)).toBeInTheDocument();
  });
  it('preserves detail content, document links and explicit zero resolution values', async () => {
    state.record = {
      ...record,
      status: 'CMA_REFERRED',
      mediatedAt: '2026-09-03',
      mediationOutcome: 'Synthetic mediation notes.',
      cmaReferenceNumber: 'CMA-EXAMPLE',
      cmaReferredAt: '2026-09-05',
      cmaArbitrator: 'Example Arbitrator',
      cmaHearingDate: '2026-10-01',
      resolutionAmount: 0,
      resolutionNotes: 'Synthetic note.',
    };
    await detail();
    expect(screen.getByRole('link', { name: 'Open CMA referral form' })).toHaveAttribute(
      'href',
      '/hr/ccm-notices/cma-referral/dispute',
    );
    expect(screen.getByRole('link', { name: 'Open termination form' })).toHaveAttribute(
      'href',
      '/hr/ccm-notices/termination/employee',
    );
    expect(screen.getByText('TZS 0.00')).toBeInTheDocument();
    expect(screen.getByText('DA-EXAMPLE')).toBeInTheDocument();
    capture('dispute-detail');
  });
  it('protects edit drafts and clears optional notes while preserving the original raised timestamp', async () => {
    await detail();
    await userEvent.click(screen.getByRole('button', { name: 'Edit dispute' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit dispute' });
    await userEvent.clear(within(dialog).getByLabelText('Initial position'));
    await userEvent.clear(within(dialog).getByLabelText('Notes'));
    state.patch.mockRejectedValueOnce(new Error('Update unavailable'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save dispute' }));
    expect(await screen.findByText('Update unavailable')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByLabelText('Notes')).toHaveValue('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save dispute' }));
    expect(await screen.findByText('Dispute saved.')).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith('/hr/employment-disputes/dispute', {
      initialPosition: null,
      notes: null,
    });
  });
  it.each([
    [
      'Start mediation',
      'Start internal mediation',
      'Initial outcome or notes',
      'Synthetic outcome',
      'Start mediation',
      'mediate',
      { mediationOutcome: 'Synthetic outcome' },
      'Mediation recorded.',
    ],
    [
      'Record CMA referral',
      'Record CMA referral',
      'CMA reference',
      'CMA-EXAMPLE',
      'Record referral',
      'refer-cma',
      { cmaReferenceNumber: 'CMA-EXAMPLE' },
      'CMA referral recorded.',
    ],
  ] as const)(
    'guards and retries %s',
    async (open, title, label, value, submit, path, payload, notice) => {
      await detail();
      await userEvent.click(screen.getByRole('button', { name: open, exact: true }));
      const dialog = screen.getByRole('dialog', { name: title });
      await userEvent.type(within(dialog).getByLabelText(label), value);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
      expect(within(dialog).getByLabelText(label)).toHaveValue(value);
      state.patch.mockRejectedValueOnce(new Error('Workflow unavailable'));
      await userEvent.click(within(dialog).getByRole('button', { name: submit, exact: true }));
      expect(await screen.findByText('Workflow unavailable')).toBeInTheDocument();
      await userEvent.click(within(dialog).getByRole('button', { name: submit, exact: true }));
      expect(await screen.findByText(notice)).toBeInTheDocument();
      expect(state.patch).toHaveBeenCalledWith('/hr/employment-disputes/dispute/' + path, payload);
    },
  );
  it('records a zero-amount resolution and closes workflow actions after success', async () => {
    await detail();
    await userEvent.click(screen.getByRole('button', { name: 'Record resolution' }));
    const dialog = screen.getByRole('dialog', { name: 'Record resolution' });
    await userEvent.type(within(dialog).getByLabelText('Resolution amount (TZS, optional)'), '0');
    await userEvent.type(within(dialog).getByLabelText('Resolution notes'), 'Synthetic outcome');
    capture('dispute-resolution');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark resolved' }));
    expect(await screen.findByText('Resolution recorded.')).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith('/hr/employment-disputes/dispute/resolve', {
      resolutionType: 'SETTLED_INTERNALLY',
      resolutionAmount: 0,
      resolutionNotes: 'Synthetic outcome',
    });
    expect(screen.queryByRole('button', { name: 'Record resolution' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit dispute' })).not.toBeInTheDocument();
  });
  it('requires explicit withdrawal confirmation and cancels without a mutation', async () => {
    await detail();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw', exact: true }));
    const dialog = screen.getByRole('dialog', { name: 'Withdraw dispute?' });
    expect(within(dialog).getByText(/This closes the dispute as withdrawn/)).toBeInTheDocument();
    expect(state.patch).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw', exact: true }));
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw dispute', exact: true }));
    expect(await screen.findByText('Dispute withdrawn.')).toBeInTheDocument();
    expect(state.patch).toHaveBeenCalledWith('/hr/employment-disputes/dispute/withdraw', {});
  });
  it('retains failed deletion in the named confirmation and returns to the register on success', async () => {
    await detail();
    await userEvent.click(screen.getByRole('button', { name: 'Delete record' }));
    const dialog = screen.getByRole('dialog', { name: 'Delete dispute?' });
    expect(within(dialog).getByText(/DIS-EXAMPLE-01 · Alex Example/)).toBeInTheDocument();
    state.remove.mockRejectedValueOnce(new Error('Delete unavailable'));
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete dispute', exact: true }),
    );
    expect(await screen.findByText('Delete unavailable')).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Delete dispute', exact: true }),
    );
    await waitFor(() => expect(state.push).toHaveBeenCalledWith('/hr/disputes'));
  });
  it('hides transitions on closed records while preserving authorized deletion', async () => {
    state.record = { ...record, status: 'WITHDRAWN', resolvedAt: '2026-09-05' };
    await detail();
    for (const name of [
      'Edit dispute',
      'Start mediation',
      'Record CMA referral',
      'Record resolution',
      'Withdraw',
    ])
      expect(screen.queryByRole('button', { name, exact: true })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete record' })).toBeInTheDocument();
  });
});

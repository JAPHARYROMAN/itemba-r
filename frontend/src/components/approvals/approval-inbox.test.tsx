import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalInbox } from './approval-inbox';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { type ApprovalRequest, requestPath } from './approval-request-types';
const api = vi.hoisted(() => ({
  get: vi.fn(),
  page: vi.fn(),
  patch: vi.fn(),
  permissions: new Set<string>(),
  own: false,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/api-client', () => ({
  backendPage: api.page,
  backendGet: api.get,
  backendPatch: api.patch,
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: api.own ? 'maker' : 'reviewer' },
    hasPermission: (p: string) => api.permissions.has(p),
    loading: false,
  }),
}));
const request: ApprovalRequest = {
  id: 'r1',
  requestTitle: 'Supplier payment',
  requestSummary: 'Review the supplier payment for the September delivery.',
  approvalRequestNumber: 'PAY-0142',
  companyId: 'company',
  company: { id: 'company', name: 'Example Company' },
  entityType: 'SupplierInvoice',
  entityId: 'INV-42',
  actionType: 'PAY',
  requestedById: 'maker',
  requestedBy: { fullName: 'Test requester' },
  amount: '4850000',
  currency: 'TZS',
  status: 'PENDING',
  createdAt: '2026-09-17T08:00:00Z',
  submittedAt: '2026-09-17T09:00:00Z',
  dueAt: '2026-09-20T17:00:00Z',
  workflow: { name: 'Supplier payment review' },
  currentStepOrder: 2,
  riskLevel: 'MEDIUM',
  notes: 'Supporting documents reviewed.',
  oldValue: { amount: 4000000 },
  newValue: { amount: 4850000 },
  availableActions: { approve: true, reject: true, cancel: true },
  actions: [
    {
      id: 'a1',
      action: 'SUBMITTED',
      createdAt: '2026-09-17T09:00:00Z',
      actionBy: { fullName: 'Test requester' },
      comment: 'Ready for review.',
      stepOrder: 0,
    },
    {
      id: 'a2',
      action: 'COMMENTED',
      createdAt: '2026-09-17T10:00:00Z',
      actionBy: { fullName: 'Reviewer' },
      reason: 'Verify invoice reference.',
      stepOrder: 2,
    },
  ],
};
const collection = (rows = [request], total = rows.length) => ({ data: rows, total });
beforeEach(() => {
  vi.resetAllMocks();
  api.own = false;
  api.permissions = new Set([
    'approval_requests.view',
    'approval_requests.approve',
    'approval_requests.reject',
    'approval_requests.cancel',
  ]);
  api.get.mockImplementation(async (path: string) =>
    path === requestPath || path.endsWith('/pending/me') ? collection() : request,
  );
  api.page.mockResolvedValue({
    data: [
      { id: 'company', name: 'Example Company' },
      { id: 'other', name: 'Other Company' },
    ],
    total: 2,
  });
  api.patch.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const mount = (mode: 'pending' | 'all' = 'pending') =>
  render(
    <UnsavedWorkProvider>
      <ApprovalInbox mode={mode} />
    </UnsavedWorkProvider>,
  );
const select = async () => {
  await userEvent.click(await screen.findByRole('button', { name: /Supplier payment PAY-0142/ }));
  await screen.findByText('Supplier payment review');
};
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const clone = document.body.cloneNode(true) as HTMLElement;
  document.querySelectorAll('select').forEach((s, i) =>
    Array.from(clone.querySelectorAll('select')[i].options).forEach((o) => {
      if (o.value === s.value) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    }),
  );
  writeFileSync(join(dir, name + '.html'), clone.innerHTML);
}
describe('Request register and assigned inbox', () => {
  it('loads the assigned queue and retains complete request context and history', async () => {
    mount();
    await select();
    expect(api.get).toHaveBeenCalledWith(
      requestPath + '/pending/me',
      expect.objectContaining({
        query: { page: 1, limit: 15, search: '', companyId: '', entityType: '' },
        signal: expect.any(AbortSignal),
      }),
    );
    const detail = screen.getByRole('complementary', { name: 'Request details' });
    for (const text of [
      'Example Company',
      'INV-42',
      'PAY',
      '2',
      'MEDIUM',
      'Supporting documents reviewed.',
      'Ready for review.',
      'Verify invoice reference.',
    ])
      expect(within(detail).getAllByText(text).length).toBeGreaterThan(0);
    await userEvent.click(within(detail).getByText('Recorded changes'));
    expect(within(detail).getByText(/4000000/)).toBeInTheDocument();
    capture('approval-pending');
  });
  it('does not read without permission and hides independently restricted actions', async () => {
    api.permissions.clear();
    const view = mount();
    expect(screen.getByText('Approvals are not available to your role')).toBeVisible();
    expect(api.get).not.toHaveBeenCalled();
    expect(api.page).not.toHaveBeenCalled();
    view.unmount();
    api.permissions.add('approval_requests.view');
    mount('all');
    await select();
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
    expect(api.page).not.toHaveBeenCalled();
  });
  it('applies all-register search, every status, company/entity filters and server pagination', async () => {
    api.permissions.add('companies.read');
    api.get.mockResolvedValue(collection([request], 31));
    const user = userEvent.setup();
    mount('all');
    await screen.findByRole('button', { name: /Supplier payment/ });
    await user.click(screen.getByRole('button', { name: 'Next requests' }));
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        requestPath,
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 15 }) }),
      ),
    );
    await user.type(screen.getByRole('searchbox'), ' PAY ');
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        requestPath,
        expect.objectContaining({ query: expect.objectContaining({ page: 1, search: 'PAY' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'company');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), 'DRAFT');
    await user.type(screen.getByRole('textbox', { name: 'Entity type filter' }), 'SupplierInvoice');
    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith(
        requestPath,
        expect.objectContaining({
          query: {
            page: 1,
            limit: 15,
            search: 'PAY',
            companyId: 'company',
            entityType: 'SupplierInvoice',
            status: 'DRAFT',
          },
        }),
      ),
    );
    expect(screen.getByRole('option', { name: 'Expired' })).toBeInTheDocument();
  });
  it('cancels obsolete list/detail reads, removes stale actions and retries list errors', async () => {
    const user = userEvent.setup();
    mount();
    await select();
    let finish!: (v: unknown) => void;
    api.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh approvals' }));
    const signal = api.get.mock.calls.at(-1)![1].signal;
    expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
    api.get.mockRejectedValueOnce(new Error('Queue unavailable'));
    await user.type(screen.getByRole('searchbox'), 'missing');
    await screen.findByText('Queue unavailable');
    expect(signal.aborted).toBe(true);
    await act(async () => finish(collection()));
    expect(screen.queryByRole('button', { name: /Supplier payment PAY/ })).not.toBeInTheDocument();
    api.get.mockResolvedValue(collection([]));
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No matching requests.');
  });
  it('fails closed on detail errors and unknown eligibility, with retry', async () => {
    api.get.mockImplementation(async (path: string) => {
      if (path.endsWith('/r1')) throw new Error('Details unavailable');
      return collection();
    });
    mount();
    await userEvent.click(await screen.findByRole('button', { name: /Supplier payment PAY/ }));
    await screen.findByText('Details unavailable');
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeDisabled();
    api.get.mockResolvedValue({
      ...request,
      availableActions: { approve: false, reject: false, cancel: true },
    });
    await userEvent.click(screen.getByRole('button', { name: 'Retry details' }));
    await screen.findByText('No decision is available to you for this step.');
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeEnabled();
  });
  it.each(['APPROVED', 'ESCALATED', 'EXPIRED'])(
    'does not offer decisions or cancellation for %s',
    async (status) => {
      api.get.mockImplementation(async (path: string) =>
        path === requestPath ? collection([{ ...request, status }]) : { ...request, status },
      );
      mount('all');
      await select();
      expect(screen.queryByRole('button', { name: 'Approve request' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Reject request' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
    },
  );
  it('prevents requester self-decisions while allowing authorized cancellation', async () => {
    api.own = true;
    mount('all');
    await select();
    await screen.findByText('You can’t approve or reject your own request.');
    expect(screen.getByRole('button', { name: 'Approve request' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel request' })).toBeEnabled();
  });
  it.each(['approve', 'reject', 'cancel'] as const)(
    'confirms %s, guards text and retains failed input for retry',
    async (kind) => {
      const user = userEvent.setup();
      mount('all');
      await select();
      const label = kind[0].toUpperCase() + kind.slice(1) + ' request';
      await user.click(screen.getByRole('button', { name: label }));
      let dialog = screen.getByRole('dialog', { name: label });
      expect(within(dialog).getByText('PAY-0142 · Example Company')).toBeInTheDocument();
      expect(api.patch).not.toHaveBeenCalled();
      await user.click(within(dialog).getByRole('button', { name: 'Keep request' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: label }));
      dialog = screen.getByRole('dialog', { name: label });
      await user.type(within(dialog).getByRole('textbox'), ' Review note ');
      await user.click(within(dialog).getByRole('button', { name: 'Keep request' }));
      await user.click(screen.getByRole('button', { name: 'Stay here' }));
      expect(within(dialog).getByRole('textbox')).toHaveValue(' Review note ');
      if (kind === 'reject') capture('approval-request-decision');
      api.patch.mockRejectedValueOnce(new Error('Action unavailable'));
      await user.click(within(dialog).getByRole('button', { name: label }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Action unavailable');
      expect(within(dialog).getByRole('textbox')).toHaveValue(' Review note ');
      await user.click(within(dialog).getByRole('button', { name: label }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(api.patch).toHaveBeenLastCalledWith(requestPath + '/r1/' + kind, {
        [kind === 'approve' ? 'comment' : 'reason']: 'Review note',
      });
    },
  );
  it('moves focus into mobile details and restores the selected row on Back', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    mount('all');
    const button = await screen.findByRole('button', { name: /Supplier payment PAY/ });
    await userEvent.click(button);
    await screen.findByText('Supplier payment review');
    expect(screen.getByRole('complementary', { name: 'Request details' })).toHaveFocus();
    capture('approval-requests');
    await userEvent.click(screen.getByRole('button', { name: 'Back to requests' }));
    await waitFor(() => expect(button).toHaveFocus());
  });
});

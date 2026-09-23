import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalDelegationWorkspace } from './approval-delegation-workspace';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { type ApprovalDelegation, delegationPath } from './approval-delegation-types';
import { setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
}));
const people = [
  { id: 'first', fullName: 'Alex Morgan' },
  { id: 'second', fullName: 'Sam Taylor' },
];
const fixture: ApprovalDelegation = {
  id: 'delegation',
  delegatorUserId: 'first',
  delegateUserId: 'second',
  delegator: people[0],
  delegate: people[1],
  companyId: 'company',
  company: { id: 'company', name: 'Example Company' },
  entityType: 'PurchaseOrder',
  startDate: '2026-09-10T08:15:23.500Z',
  endDate: '2026-09-30T17:30:45.100Z',
  reason: 'Cover during planned leave.',
  status: 'ACTIVE',
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'approval_delegations.view',
    'approval_delegations.manage',
    'companies.read',
    'users.read',
  ]);
  state.get.mockImplementation(async (path: string) =>
    path === '/users' ? people : { data: [fixture], total: 21 },
  );
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/users'
        ? people
        : [
            { id: 'company', name: 'Example Company' },
            { id: 'other', name: 'Other Company' },
          ],
    total: 2,
  }));
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
      <ApprovalDelegationWorkspace />
    </UnsavedWorkProvider>,
  );
const inspect = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Morgan → Sam Taylor' }));
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
describe('Approval delegations', () => {
  it('keeps read, manage and directory access separate', async () => {
    state.permissions.clear();
    const view = mount();
    expect(screen.getByText('Your role cannot view approval delegations.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('approval_delegations.view');
    mount();
    await inspect();
    expect(screen.queryByRole('button', { name: 'New delegation' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit delegation' })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('preserves complete details and applies search, pagination and company/status filters', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    const detail = screen.getByRole('complementary', { name: 'Record details' });
    expect(within(detail).getByText(fixture.reason!)).toBeInTheDocument();
    expect(within(detail).getByText('Starts')).toBeInTheDocument();
    expect(within(detail).getByText('Time zone')).toBeInTheDocument();
    capture('approval-delegations');
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        delegationPath,
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await user.type(screen.getByRole('searchbox'), ' Alex ');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        delegationPath,
        expect.objectContaining({ query: expect.objectContaining({ page: 1, search: 'Alex' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'company');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), 'CANCELLED');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        delegationPath,
        expect.objectContaining({
          query: { page: 1, limit: 20, search: 'Alex', companyId: 'company', status: 'CANCELLED' },
        }),
      ),
    );
  });
  it('cancels stale scopes and exposes list failures without old rows or invented totals', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    let finish!: (v: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    const signal = state.get.mock.calls.at(-1)![1].signal;
    await user.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    state.get.mockRejectedValueOnce(new Error('List unavailable'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), 'EXPIRED');
    expect(signal.aborted).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('List unavailable');
    await act(async () => finish({ data: [fixture], total: 21 }));
    expect(screen.queryByText(fixture.reason!)).not.toBeInTheDocument();
    state.get.mockResolvedValue({ data: [], total: 0 });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No delegations match this view.');
  });
  it('guards drafts and retries a null clear without rewriting untouched timestamps', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    await user.click(screen.getByRole('button', { name: 'Edit delegation' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit delegation' });
    await within(dialog).findAllByRole('option', { name: 'Sam Taylor' });
    await user.clear(within(dialog).getByRole('textbox', { name: 'Reason' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByRole('textbox', { name: 'Reason' })).toHaveValue('');
    state.patch.mockRejectedValueOnce(new Error('Save unavailable'));
    await user.click(within(dialog).getByRole('button', { name: 'Save delegation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save unavailable');
    await user.click(within(dialog).getByRole('button', { name: 'Save delegation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.patch).toHaveBeenLastCalledWith(delegationPath + '/delegation', { reason: null });
  });
  it('retries scoped user choices, resets people on scope changes and creates with exact instants', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    state.get.mockRejectedValueOnce(new Error('People unavailable'));
    state.page.mockImplementation(async () => {
      return {
        data: [
          { id: 'company', name: 'Example Company' },
          { id: 'other', name: 'Other Company' },
        ],
        total: 2,
      };
    });
    await user.click(screen.getByRole('button', { name: 'New delegation' }));
    const dialog = screen.getByRole('dialog', { name: 'New delegation' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('People unavailable');
    expect(within(dialog).getByRole('button', { name: 'Save delegation' })).toBeDisabled();
    state.page.mockImplementation(async (_path: string, options: { query: { page: number } }) => ({
      data:
        options.query.page === 1
          ? [{ id: 'company', name: 'Example Company' }]
          : [{ id: 'other', name: 'Other Company' }],
      total: 2,
    }));
    await user.click(within(dialog).getByRole('button', { name: 'Retry people' }));
    await waitFor(() =>
      expect(within(dialog).getAllByRole('option', { name: 'Sam Taylor' })).toHaveLength(2),
    );
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Delegator/ }), 'first');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Delegate/ }), 'second');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Company', exact: true }),
      'company',
    );
    expect(within(dialog).getByRole('combobox', { name: /Delegator/ })).toHaveValue('');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/users',
        expect.objectContaining({ query: { companyId: 'company' } }),
      ),
    );
    await waitFor(() =>
      expect(within(dialog).getByRole('combobox', { name: /Delegate/ })).toBeEnabled(),
    );
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Delegator/ }), 'first');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: /Delegate/ }), 'second');
    await setDateField(/Starts/, '2026-09-20T09:00', user, dialog);
    await setDateField(/Ends/, '2026-09-19T17:00', user, dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Save delegation' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('end must be on or after');
    expect(state.post).not.toHaveBeenCalled();
    await setDateField(/Ends/, '2026-09-30T17:00', user, dialog);
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), 'Cover during leave.');
    capture('approval-delegation-editor');
    await user.click(within(dialog).getByRole('button', { name: 'Save delegation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).toHaveBeenCalledWith(delegationPath, {
      delegatorUserId: 'first',
      delegateUserId: 'second',
      companyId: 'company',
      entityType: null,
      reason: 'Cover during leave.',
      startDate: new Date('2026-09-20T09:00').toISOString(),
      endDate: new Date('2026-09-30T17:00').toISOString(),
    });
  });
  it('blocks new people selection without directory access but permits a guarded context edit', async () => {
    state.permissions.delete('users.read');
    state.permissions.delete('companies.read');
    const user = userEvent.setup();
    mount();
    await inspect();
    await user.click(screen.getByRole('button', { name: 'New delegation' }));
    let dialog = screen.getByRole('dialog', { name: 'New delegation' });
    expect(within(dialog).getByRole('button', { name: 'Save delegation' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Edit delegation' }));
    dialog = screen.getByRole('dialog', { name: 'Edit delegation' });
    expect(within(dialog).getByRole('combobox', { name: /Delegator/ })).toBeDisabled();
    expect(state.page).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox', { name: 'Reason' }), ' changed');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.patch).not.toHaveBeenCalled();
  });
  it.each(['cancel', 'delete'] as const)(
    'confirms %s with identity and keeps failed actions open',
    async (kind) => {
      const user = userEvent.setup();
      mount();
      await inspect();
      const label = kind === 'cancel' ? 'Cancel delegation' : 'Delete delegation';
      await user.click(screen.getByRole('button', { name: label }));
      let dialog = screen.getByRole('dialog', { name: label });
      expect(within(dialog).getByText('Alex Morgan → Sam Taylor')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Keep delegation' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(state.patch).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
      await user.click(screen.getByRole('button', { name: label }));
      dialog = screen.getByRole('dialog', { name: label });
      const mutation = kind === 'cancel' ? state.patch : state.remove;
      mutation.mockRejectedValueOnce(new Error('Action unavailable'));
      await user.click(within(dialog).getByRole('button', { name: label }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Action unavailable');
      await user.click(within(dialog).getByRole('button', { name: label }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mutation).toHaveBeenLastCalledWith(
        delegationPath + '/delegation' + (kind === 'cancel' ? '/cancel' : ''),
      );
    },
  );
});

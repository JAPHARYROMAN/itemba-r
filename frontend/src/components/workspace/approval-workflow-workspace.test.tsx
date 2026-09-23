import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApprovalWorkflowWorkspace } from './approval-workflow-workspace';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { type ApprovalWorkflow, workflowPath } from './approval-workflow-types';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  companyId: 'company',
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: state.companyId },
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
const fixture: ApprovalWorkflow = {
  id: 'workflow',
  workflowCode: 'WF-EXAMPLE',
  name: 'Purchase review',
  entityType: 'PurchaseOrder',
  description: 'Purchases require review.',
  companyId: 'company',
  company: { id: 'company', name: 'Example Company' },
  workflowScope: 'COMPANY',
  triggerAction: 'SUBMIT',
  priority: 5,
  isActive: true,
  steps: [{ id: 'step', stepName: 'Review', stepOrder: 1 }],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.companyId = 'company';
  state.permissions = new Set([
    'approval_workflows.view',
    'approval_workflows.manage',
    'companies.read',
  ]);
  state.get.mockResolvedValue({ data: [fixture], total: 21 });
  state.page.mockResolvedValue({
    data: [
      { id: 'company', name: 'Example Company' },
      { id: 'other', name: 'Other Company' },
    ],
    total: 2,
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
      <ApprovalWorkflowWorkspace />
    </UnsavedWorkProvider>,
  );
const inspect = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'Inspect Purchase review' }));
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
describe('Approval workflows', () => {
  it('enforces read and manage permissions independently', async () => {
    state.permissions.clear();
    const view = mount();
    expect(screen.getByText('Your role cannot view approval workflows.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('approval_workflows.view');
    mount();
    await inspect();
    expect(screen.queryByRole('button', { name: 'New workflow' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit workflow' })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('preserves all workflow fields and sends paginated scoped search and filters', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    const details = screen.getByRole('complementary', { name: 'Record details' });
    for (const text of [
      'PurchaseOrder',
      'Example Company',
      'Company',
      'Submit',
      '5',
      'Purchases require review.',
      '1',
    ])
      expect(within(details).getAllByText(text).length).toBeGreaterThan(0);
    capture('approval-workflows');
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        workflowPath,
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'company');
    await user.type(screen.getByRole('textbox', { name: 'Entity type filter' }), 'PurchaseOrder');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status filter' }), 'false');
    await user.type(screen.getByRole('searchbox'), ' WF ');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        workflowPath,
        expect.objectContaining({
          query: {
            page: 1,
            limit: 20,
            search: 'WF',
            companyId: 'company',
            entityType: 'PurchaseOrder',
            isActive: 'false',
          },
        }),
      ),
    );
  });
  it('aborts stale filter requests and clears a failed list before retry', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    await user.click(screen.getByRole('button', { name: 'Filters', exact: true }));
    let finish!: (data: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'company');
    const signal = state.get.mock.calls.at(-1)![1].signal;
    expect(
      screen.queryByRole('button', { name: 'Inspect Purchase review' }),
    ).not.toBeInTheDocument();
    state.get.mockRejectedValueOnce(new Error('Scope unavailable'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Company filter' }), 'other');
    expect(signal.aborted).toBe(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Scope unavailable');
    await act(async () => finish({ data: [fixture], total: 21 }));
    expect(
      screen.queryByRole('button', { name: 'Inspect Purchase review' }),
    ).not.toBeInTheDocument();
    state.get.mockResolvedValue({ data: [], total: 0 });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('No workflows match this view.');
  });
  it('guards changed drafts, retains failed saves and patches only changed fields', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    await user.click(screen.getByRole('button', { name: 'Edit workflow' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit workflow' });
    await user.clear(within(dialog).getByRole('textbox', { name: 'Description' }));
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByRole('textbox', { name: 'Description' })).toHaveValue('');
    state.patch.mockRejectedValueOnce(new Error('Save failed'));
    await user.click(within(dialog).getByRole('button', { name: 'Save workflow' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Save failed');
    await user.click(within(dialog).getByRole('button', { name: 'Save workflow' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.patch).toHaveBeenLastCalledWith(`${workflowPath}/workflow`, { description: null });
  });
  it('creates with real numeric, scope and trigger values after complete company-choice retry', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    state.page.mockRejectedValueOnce(new Error('Company choices failed'));
    await user.click(screen.getByRole('button', { name: 'New workflow' }));
    const dialog = screen.getByRole('dialog', { name: 'New workflow' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Company choices failed');
    expect(within(dialog).getByRole('button', { name: 'Save workflow' })).toBeDisabled();
    state.page
      .mockResolvedValueOnce({ data: [{ id: 'company', name: 'Example Company' }], total: 2 })
      .mockResolvedValueOnce({ data: [{ id: 'other', name: 'Other Company' }], total: 2 });
    await user.click(within(dialog).getByRole('button', { name: 'Retry companies' }));
    await within(dialog).findByRole('option', { name: 'Other Company' });
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Company', exact: true }),
      'other',
    );
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), ' New review ');
    await user.type(within(dialog).getByRole('textbox', { name: /^Entity type/ }), 'PurchaseOrder');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Scope' }), 'COMPANY');
    await user.selectOptions(
      within(dialog).getByRole('combobox', { name: 'Trigger action' }),
      'POST',
    );
    await user.clear(within(dialog).getByRole('spinbutton', { name: /Priority/ }));
    await user.type(within(dialog).getByRole('spinbutton', { name: /Priority/ }), '7');
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Status' }), 'false');
    capture('approval-workflow-editor');
    await user.click(within(dialog).getByRole('button', { name: 'Save workflow' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).toHaveBeenCalledWith(workflowPath, {
      name: 'New review',
      entityType: 'PurchaseOrder',
      workflowScope: 'COMPANY',
      triggerAction: 'POST',
      priority: 7,
      isActive: false,
      companyId: 'other',
      workflowCode: undefined,
      description: undefined,
    });
  });
  it('uses the assigned company without reading the company directory and discards changes', async () => {
    state.permissions.delete('companies.read');
    const user = userEvent.setup();
    mount();
    await inspect();
    await user.click(screen.getByRole('button', { name: 'New workflow' }));
    const dialog = screen.getByRole('dialog', { name: 'New workflow' });
    expect(within(dialog).getByText('Using your assigned company.')).toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Draft');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).not.toHaveBeenCalled();
  });
  it.each(['activate', 'deactivate', 'delete'] as const)(
    'confirms %s and retains action failures for retry',
    async (kind) => {
      state.get.mockResolvedValue({
        data: [{ ...fixture, isActive: kind !== 'activate' }],
        total: 1,
      });
      const user = userEvent.setup();
      mount();
      await inspect();
      const label =
        kind === 'delete' ? 'Delete workflow' : kind === 'activate' ? 'Activate' : 'Deactivate';
      await user.click(screen.getByRole('button', { name: label, exact: true }));
      const title = kind[0].toUpperCase() + kind.slice(1) + ' workflow';
      let dialog = screen.getByRole('dialog', { name: title });
      expect(within(dialog).getByText('Purchase review · WF-EXAMPLE')).toBeInTheDocument();
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(state.patch).not.toHaveBeenCalled();
      expect(state.remove).not.toHaveBeenCalled();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      await user.click(screen.getByRole('button', { name: label, exact: true }));
      dialog = screen.getByRole('dialog', { name: title });
      const mutation = kind === 'delete' ? state.remove : state.patch;
      mutation.mockRejectedValueOnce(new Error('Action failed'));
      await user.click(within(dialog).getByRole('button', { name: title }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent('Action failed');
      await user.click(within(dialog).getByRole('button', { name: title }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(mutation).toHaveBeenLastCalledWith(
        `${workflowPath}/workflow${kind === 'delete' ? '' : '/' + kind}`,
      );
    },
  );
});

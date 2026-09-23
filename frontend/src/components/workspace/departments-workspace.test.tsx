import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import DepartmentsPage from '@/app/(dashboard)/hr/departments/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  router: { push: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useRouter: () => state.router }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendGet: state.get,
  backendPost: state.post,
  backendPut: state.put,
  backendDelete: state.remove,
}));
vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    branches: [],
    companyOptions: [{ value: 'company-a', label: 'Alpha' }],
    divisionOptions: [{ value: 'division-a', label: 'Main division' }],
  }),
}));
const department = {
  id: 'dept-a',
  name: 'Operations',
  departmentCode: 'OPS',
  company: { id: 'company-a', name: 'Alpha' },
  status: 'ACTIVE',
  divisionId: 'division-a',
  branchId: 'branch-a',
};
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set(['departments.view', 'departments.manage']);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.page.mockResolvedValue({ data: [department], total: 40 });
  state.get.mockResolvedValue({ departmentCode: 'NEW-001' });
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
function mount() {
  render(
    <UnsavedWorkProvider>
      <DepartmentsPage />
    </UnsavedWorkProvider>,
  );
}
describe('Departments workspace', () => {
  it('uses backend pagination and search, retaining the company filter', async () => {
    const user = userEvent.setup();
    mount();
    await screen.findByRole('button', { name: 'Inspect Operations' });
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/departments',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company-a');
    await user.type(screen.getByRole('searchbox'), 'Ops');
    await waitFor(() =>
      expect(state.page).toHaveBeenLastCalledWith(
        '/hr/departments',
        expect.objectContaining({
          query: expect.objectContaining({ page: 1, search: 'Ops', companyId: 'company-a' }),
        }),
      ),
    );
  });
  it('offers retry after a list failure and hides mutations from readers', async () => {
    state.permissions.delete('departments.manage');
    state.page.mockRejectedValueOnce(new Error('Service unavailable'));
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Service unavailable');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await user.click(await screen.findByRole('button', { name: 'Inspect Operations' }));
    expect(screen.queryByRole('button', { name: 'Edit department' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete department' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New department' })).not.toBeInTheDocument();
  });
  it('keeps failed saves and cancelled navigation as drafts, then clears protection on successful save', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Inspect Operations' }));
    await user.click(screen.getByRole('button', { name: 'Edit department' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit department' }));
    await user.clear(editor.getByLabelText(/Name/));
    await user.type(editor.getByLabelText(/Name/), 'Operations draft');
    await user.selectOptions(editor.getByLabelText('Division'), '');
    state.put.mockRejectedValueOnce(new Error('Save unavailable'));
    await user.click(editor.getByRole('button', { name: 'Save department' }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Save unavailable');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(editor.getByLabelText(/Name/)).toHaveValue('Operations draft');
    await user.click(editor.getByRole('button', { name: 'Save department' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Department updated.');
    expect(state.put).toHaveBeenLastCalledWith(
      '/hr/departments/dept-a',
      expect.objectContaining({ name: 'Operations draft', divisionId: null, branchId: null }),
    );
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it('identifies the deletion target and keeps a failed deletion open for recovery', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Inspect Operations' }));
    await user.click(screen.getByRole('button', { name: 'Delete department' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete department' }));
    expect(dialog.getByText('Operations')).toBeInTheDocument();
    state.remove.mockRejectedValueOnce(new Error('Department is in use'));
    await user.click(dialog.getByRole('button', { name: 'Delete department' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Department is in use');
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(state.remove).toHaveBeenCalledTimes(1);
  });
});

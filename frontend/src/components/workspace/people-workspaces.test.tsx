import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PositionsPage from '@/app/(dashboard)/hr/positions/page';
import EmployeesPage from '@/app/(dashboard)/hr/employees/page';
import { UnsavedWorkProvider } from './unsaved-work-provider';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  pdf: vi.fn(),
  router: { push: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => state.router,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendGet: state.get,
  backendPost: state.post,
  backendPut: state.put,
  backendDelete: state.remove,
  ApiError: class extends Error {},
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: state.pdf }));
vi.mock('@/hooks/use-org-scope', () => ({
  useOrgScope: () => ({
    companies: [{ id: 'company', name: 'Example', code: 'EX' }],
    branches: [],
    companyOptions: [{ value: 'company', label: 'Example' }],
    divisionOptions: [],
    loading: false,
    error: '',
    retry: vi.fn(),
  }),
}));
const department = { id: 'department', name: 'Operations', companyId: 'company' };
const position = {
  id: 'position',
  title: 'Coordinator',
  positionCode: 'COORD',
  companyId: 'company',
  company: { id: 'company', name: 'Example' },
  departmentId: 'department',
  department,
  status: 'ACTIVE',
  defaultSalary: '100',
  currency: 'USD',
};
const employee = {
  id: 'employee',
  employeeCode: 'EMP-1',
  firstName: 'Alex',
  lastName: 'Example',
  company: { name: 'Example' },
  department: { name: 'Operations' },
  position: { title: 'Coordinator' },
  employmentStatus: 'ACTIVE',
};
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set([
    'positions.view',
    'positions.manage',
    'departments.view',
    'employees.view',
    'employees.create',
    'employees.delete',
  ]);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.page.mockImplementation(async (path, options) => ({
    data:
      path === '/hr/departments'
        ? [department]
        : path === '/hr/positions'
          ? [position]
          : [employee],
    total: options.query.limit === 20 ? 40 : 1,
  }));
  state.get.mockImplementation(async (path) =>
    path.endsWith('linkable-users') ? [] : { positionCode: 'POS-2', employeeCode: 'EMP-2' },
  );
  state.post.mockResolvedValue({});
  state.put.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  state.pdf.mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
function mount(Page: typeof PositionsPage) {
  render(
    <UnsavedWorkProvider>
      <Page />
    </UnsavedWorkProvider>,
  );
}
describe('People workspaces', () => {
  it('keeps successful organisation choices usable when account access is denied and preserves the draft on retry', async () => {
    state.get.mockImplementation(async (path) => {
      if (path.endsWith('linkable-users'))
        throw new Error('Insufficient access level for this company');
      return { employeeCode: 'EMP-2' };
    });
    const user = userEvent.setup();
    mount(EmployeesPage);
    await user.click(screen.getByRole('button', { name: 'New employee' }));
    const editor = within(await screen.findByRole('dialog', { name: 'New employee' }));
    await user.selectOptions(editor.getByLabelText(/^Company/), 'company');
    expect(await editor.findByText(/User accounts: Insufficient access/)).toBeInTheDocument();
    expect(editor.getByLabelText('User account')).toBeDisabled();
    await user.selectOptions(editor.getByLabelText('Department'), 'department');
    await user.selectOptions(editor.getByLabelText('Position'), 'position');
    await user.type(editor.getByLabelText(/^First name/), 'Preview');
    state.get.mockImplementation(async (path) =>
      path.endsWith('linkable-users') ? [] : { employeeCode: 'EMP-2' },
    );
    await user.click(editor.getByRole('button', { name: 'Retry choices' }));
    await waitFor(() => expect(editor.getByLabelText('User account')).toBeEnabled());
    expect(editor.getByLabelText('Department')).toHaveValue('department');
    expect(editor.getByLabelText('Position')).toHaveValue('position');
    expect(editor.getByLabelText(/^First name/)).toHaveValue('Preview');
  });
  it.each([
    ['positions', PositionsPage, 'Coordinator'],
    ['employees', EmployeesPage, 'Alex Example'],
  ] as const)(
    '%s pages real results and keeps writes hidden for readers',
    async (kind, Page, name) => {
      state.permissions = new Set([`${kind}.view`]);
      const user = userEvent.setup();
      mount(Page);
      await user.click(await screen.findByRole('button', { name: `Inspect ${name}` }));
      expect(
        screen.queryByRole('button', { name: /New (position|employee)/ }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /Delete (position|employee)/ }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          `/hr/${kind}`,
          expect.objectContaining({ query: expect.objectContaining({ page: 2, limit: 20 }) }),
        ),
      );
    },
  );
  it('preserves currency and failed position drafts, then allows salary to be cleared', async () => {
    const user = userEvent.setup();
    mount(PositionsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Coordinator' }));
    await user.click(screen.getByRole('button', { name: 'Edit position' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Edit position' }));
    await waitFor(() => expect(editor.getByLabelText(/Title/)).toBeEnabled());
    expect(editor.getByLabelText(/^Currency/)).toHaveValue('USD');
    await user.type(editor.getByLabelText(/Title/), ' draft');
    await user.clear(editor.getByLabelText('Default salary'));
    state.put.mockRejectedValueOnce(new Error('Save unavailable'));
    await user.click(editor.getByRole('button', { name: 'Save position' }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Save unavailable');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(editor.getByLabelText(/Title/)).toHaveValue('Coordinator draft');
    await user.click(editor.getByRole('button', { name: 'Save position' }));
    expect(await screen.findByText('Position updated.')).toBeInTheDocument();
    expect(state.put).toHaveBeenLastCalledWith('/hr/positions/position', {
      title: 'Coordinator draft',
      defaultSalary: null,
    });
  });
  it('creates employees with generated codes and protects the failed form until saved', async () => {
    const user = userEvent.setup();
    mount(EmployeesPage);
    await user.click(screen.getByRole('button', { name: 'New employee' }));
    const editor = within(await screen.findByRole('dialog', { name: 'New employee' }));
    await user.selectOptions(editor.getByLabelText(/^Company/), 'company');
    await waitFor(() =>
      expect(editor.getByRole('button', { name: 'Save', exact: true })).toBeEnabled(),
    );
    await user.type(editor.getByLabelText(/^First name/), 'Ada');
    await user.type(editor.getByLabelText(/^Last name/), 'Example');
    state.post.mockRejectedValueOnce(new Error('Create unavailable'));
    await user.click(editor.getByRole('button', { name: 'Save', exact: true }));
    expect(await editor.findByRole('alert')).toHaveTextContent('Create unavailable');
    await user.click(editor.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(editor.getByLabelText(/^First name/)).toHaveValue('Ada');
    await user.click(editor.getByRole('button', { name: 'Save', exact: true }));
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    const body = state.post.mock.calls[1][1];
    expect(body).toMatchObject({ firstName: 'Ada', lastName: 'Example', companyId: 'company' });
    expect(body).not.toHaveProperty('employeeCode');
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'New employee' })).not.toBeInTheDocument(),
    );
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
  it('exports all matching employees with the same search and company scope', async () => {
    state.page.mockImplementation(async (path, options) => {
      if (path === '/hr/employees' && options.query.limit === 100)
        return {
          data: [
            {
              ...employee,
              id: `employee-${options.query.page}`,
              employeeCode: `EMP-${options.query.page}`,
            },
          ],
          total: 2,
        };
      return { data: [employee], total: 40 };
    });
    const user = userEvent.setup();
    mount(EmployeesPage);
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    await user.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await user.type(screen.getByRole('searchbox'), 'Alex');
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/employees',
        expect.objectContaining({ query: expect.objectContaining({ search: 'Alex' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Export register' }));
    await waitFor(() => expect(state.pdf).toHaveBeenCalled());
    expect(state.pdf.mock.calls[0][0].rows).toHaveLength(2);
    expect(state.page).toHaveBeenCalledWith(
      '/hr/employees',
      expect.objectContaining({
        query: expect.objectContaining({
          page: 2,
          limit: 100,
          search: 'Alex',
          companyId: 'company',
        }),
      }),
    );
  });
  it('shows a failed position deletion within its named confirmation', async () => {
    const user = userEvent.setup();
    mount(PositionsPage);
    await user.click(await screen.findByRole('button', { name: 'Inspect Coordinator' }));
    await user.click(screen.getByRole('button', { name: 'Delete position' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Delete position' }));
    state.remove.mockRejectedValueOnce(new Error('Position is in use'));
    await user.click(dialog.getByRole('button', { name: 'Delete position' }));
    expect(await dialog.findByRole('alert')).toHaveTextContent('Position is in use');
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(state.remove).toHaveBeenCalledTimes(1);
  });
});

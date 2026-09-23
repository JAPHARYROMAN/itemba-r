import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Departments from '@/app/(dashboard)/hr/departments/page';
import Positions from '@/app/(dashboard)/hr/positions/page';
import { PayrollTypeWorkspace } from '@/components/workspace/payroll-type-workspace';
import { WorkspaceSessionProvider } from '@/components/workspace/workspace-session';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceNavigationProvider,
  WorkspaceLink,
  useWorkspacePathname,
} from '@/components/workspace/workspace-navigation';
import { PayrollDraftWorkspace } from './payroll-drafts';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  records: {} as Record<string, Record<string, unknown>>,
  departmentAvailable: true,
  branchAvailable: true,
  divisionAvailable: true,
  emptyPage: false,
  code: 'AUTO-1',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/payroll',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendPage: state.page,
  backendGet: state.get,
  backendPost: state.post,
  backendPut: state.put,
}));
const specs = {
  department: {
    path: '/hr/departments',
    name: 'Operations',
    edit: 'Edit department',
    save: 'Save department',
    field: /^Name/,
    permission: 'departments.manage',
  },
  position: {
    path: '/hr/positions',
    name: 'Coordinator',
    edit: 'Edit position',
    save: 'Save position',
    field: /^Title/,
    permission: 'positions.manage',
  },
  allowance: {
    path: '/hr/allowance-types',
    name: 'Transport',
    edit: 'Edit type',
    save: 'Save type',
    field: /^Name/,
    permission: 'allowances.manage',
  },
  deduction: {
    path: '/hr/deduction-types',
    name: 'Advance',
    edit: 'Edit type',
    save: 'Save type',
    field: /^Name/,
    permission: 'deductions.manage',
  },
};
type View = keyof typeof specs;
const views = Object.keys(specs) as View[];
const title = (view: View, editing = true) =>
  (editing ? 'Edit ' : 'New ') +
  view +
  (view === 'allowance' || view === 'deduction' ? ' type' : '');
function Pages() {
  const path = useWorkspacePathname();
  return (
    <PayrollDraftWorkspace viewKey={path}>
      <nav aria-label="Destinations">
        <WorkspaceLink href="/payroll">Open home</WorkspaceLink>
        {views.map((view) => (
          <WorkspaceLink key={view} href={specs[view].path}>
            Open {view}
          </WorkspaceLink>
        ))}
      </nav>
      {path === specs.department.path ? (
        <Departments />
      ) : path === specs.position.path ? (
        <Positions />
      ) : path === specs.allowance.path ? (
        <PayrollTypeWorkspace key="allowance" kind="allowance" />
      ) : path === specs.deduction.path ? (
        <PayrollTypeWorkspace key="deduction" kind="deduction" />
      ) : (
        <h1>Payroll overview</h1>
      )}
    </PayrollDraftWorkspace>
  );
}
function App({ initial = 'department' }: { initial?: View }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="primary">
            <WorkspaceNavigationProvider
              appId="payroll"
              initialHref={specs[initial].path}
              ownsPath={(path) => path === '/payroll' || path.startsWith('/hr/')}
            >
              <Pages />
            </WorkspaceNavigationProvider>
          </UnsavedWorkScope>
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'departments.view',
    'departments.manage',
    'positions.view',
    'positions.manage',
    'allowances.view',
    'allowances.manage',
    'deductions.view',
    'deductions.manage',
  ]);
  state.departmentAvailable = state.branchAvailable = state.divisionAvailable = true;
  state.emptyPage = false;
  state.code = 'AUTO-1';
  const company = { id: 'company', name: 'Company A', code: 'A' };
  const division = { id: 'division', companyId: 'company', name: 'Retail', code: 'RET' };
  const branch = {
    id: 'branch',
    companyId: 'company',
    divisionId: 'division',
    name: 'Main branch',
  };
  const department = {
    id: 'department',
    companyId: 'company',
    company,
    divisionId: 'division',
    division,
    branchId: 'branch',
    branch,
    departmentCode: 'OPS',
    name: 'Operations',
    status: 'ACTIVE',
    updatedAt: 'v1',
  };
  state.records = {
    department,
    position: {
      id: 'position',
      companyId: 'company',
      company,
      departmentId: 'department',
      department,
      title: 'Coordinator',
      positionCode: 'COORD',
      positionType: 'ADMINISTRATION',
      defaultSalary: '100',
      currency: 'USD',
      status: 'ACTIVE',
      updatedAt: 'v1',
    },
    allowance: {
      id: 'allowance',
      companyId: 'company',
      company,
      name: 'Transport',
      code: 'TRAVEL',
      taxable: true,
      recurring: true,
      isActive: true,
      defaultAmount: '500',
      updatedAt: 'v1',
    },
    deduction: {
      id: 'deduction',
      companyId: 'company',
      company,
      name: 'Advance',
      code: 'ADVANCE',
      statutory: true,
      recurring: true,
      isActive: true,
      defaultAmount: '500',
      defaultPercentage: '2.5',
      updatedAt: 'v1',
    },
  };
  state.page.mockImplementation(async (path, opts) => {
    const view = views.find((view) => specs[view].path === path);
    const rows =
      path === '/companies'
        ? [company, { id: 'company-b', name: 'Company B', code: 'B' }]
        : path === '/divisions'
          ? state.divisionAvailable
            ? [division]
            : []
          : path === '/branches'
            ? state.branchAvailable
              ? [branch]
              : []
            : view
              ? view === 'department' &&
                opts?.query?.status === 'ACTIVE' &&
                !state.departmentAvailable
                ? []
                : [{ ...state.records[view] }]
              : [];
    return {
      data: state.emptyPage && opts?.query?.limit === 20 && opts.query.page > 1 ? [] : rows,
      total: opts?.query?.limit === 20 && !state.emptyPage ? 21 : rows.length,
    };
  });
  state.get.mockImplementation(async (path) => {
    if (path.endsWith('/next-code'))
      return { departmentCode: state.code, positionCode: state.code };
    const view = views.find((view) => path.startsWith(specs[view].path + '/'));
    if (!view) throw new Error('Unexpected source read: ' + path);
    return { ...state.records[view] };
  });
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
type User = ReturnType<typeof userEvent.setup>;
async function ready(view: View, editing = true) {
  const form = within(await screen.findByRole('dialog', { name: title(view, editing) }));
  await waitFor(() => expect(form.getByRole('button', { name: specs[view].save })).toBeEnabled());
  return form;
}
async function edit(user: User, view: View) {
  await user.click(await screen.findByRole('button', { name: 'Inspect ' + specs[view].name }));
  await user.click(screen.getByRole('button', { name: specs[view].edit, exact: true }));
  return ready(view);
}
async function keep(user: User) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function resume(user: User, view: View, editing = true) {
  await user.click(screen.getByRole('button', { name: 'Resume ' + title(view, editing) }));
  return ready(view, editing);
}
async function create(user: User, view: View) {
  await user.click(screen.getByRole('button', { name: title(view, false) }));
  const form = await ready(view, false);
  await user.selectOptions(form.getByLabelText(/^Company/), 'company');
  if (view === 'department' || view === 'position') {
    await within(form.getByLabelText('Division')).findByRole('option', { name: /Retail/ });
    await waitFor(() => expect(form.getByRole('button', { name: specs[view].save })).toBeEnabled());
    await user.selectOptions(form.getByLabelText('Division'), 'division');
    await user.selectOptions(form.getByLabelText('Branch / Location'), 'branch');
    if (view === 'position')
      await user.selectOptions(form.getByLabelText(/^Department/), 'department');
  } else {
    await user.type(form.getByLabelText(/^Code/), 'NEW');
    await user.selectOptions(form.getByLabelText('Recurring'), 'true');
    fireEvent.change(form.getByLabelText('Default amount (TZS)'), { target: { value: '0' } });
  }
  await user.type(form.getByLabelText(specs[view].field), 'New definition');
  return form;
}

describe('Payroll definition continuity', () => {
  it.each(views)(
    'keeps a new %s through navigation and a failed save without submitting on resume',
    async (view) => {
      const user = userEvent.setup();
      render(<App initial={view} />);
      await create(user, view);
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
      await screen.findByRole('heading', { name: 'Payroll overview' });
      const form = await resume(user, view, false);
      expect(state.post).not.toHaveBeenCalled();
      expect(form.getByLabelText(specs[view].field)).toHaveValue('New definition');
      expect(form.getByLabelText(/^Company/)).toHaveValue('company');
      state.post.mockRejectedValueOnce(new Error('Save temporarily unavailable'));
      await user.click(form.getByRole('button', { name: specs[view].save }));
      expect(await form.findByRole('alert')).toHaveTextContent('Save temporarily unavailable');
      await user.click(form.getByRole('button', { name: specs[view].save }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(state.post).toHaveBeenCalledTimes(2);
      const payload = state.post.mock.calls[1][1];
      expect(state.post.mock.calls[1][0]).toBe(specs[view].path);
      expect(payload).toMatchObject({
        companyId: 'company',
        [view === 'position' ? 'title' : 'name']: 'New definition',
      });
      if (view === 'department')
        expect(payload).toMatchObject({ divisionId: 'division', branchId: 'branch' });
      if (view === 'position')
        expect(payload).toMatchObject({ departmentId: 'department', currency: 'TZS' });
      if (view === 'allowance' || view === 'deduction')
        expect(payload).toMatchObject({ defaultAmount: 0, recurring: true, code: 'NEW' });
      else expect(payload).not.toHaveProperty(view + 'Code');
      expect(
        screen.queryByRole('button', { name: 'Resume ' + title(view, false) }),
      ).not.toBeInTheDocument();
    },
  );
  it.each(views)(
    'merges current %s values on resume and sends only the edited name after review',
    async (view) => {
      const user = userEvent.setup();
      render(<App initial={view} />);
      let form = await edit(user, view);
      await user.clear(form.getByLabelText(specs[view].field));
      await user.type(form.getByLabelText(specs[view].field), 'Retained name');
      await keep(user);
      state.records[view] = {
        ...state.records[view],
        status: 'INACTIVE',
        isActive: false,
        defaultAmount: '800',
        defaultPercentage: '5',
        defaultSalary: '250',
        currency: 'TZS',
        taxable: false,
        statutory: false,
        recurring: false,
        updatedAt: 'v2',
      };
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      form = await resume(user, view);
      expect(form.getByLabelText(specs[view].field)).toHaveValue('Retained name');
      if (view === 'department' || view === 'position')
        expect(form.getByLabelText('Status')).toHaveValue('INACTIVE');
      else {
        expect(form.getByLabelText('Default amount (TZS)')).toHaveValue(800);
        expect(form.getByLabelText('Recurring')).toHaveValue('false');
        expect(form.getByLabelText(view === 'allowance' ? 'Taxable' : 'Statutory')).toHaveValue(
          'false',
        );
      }
      if (view === 'position') {
        expect(form.getByLabelText('Default salary')).toHaveValue(250);
        expect(form.getByLabelText(/^Currency/)).toHaveValue('TZS');
      }
      await user.click(form.getByRole('button', { name: specs[view].save }));
      expect(state.put).not.toHaveBeenCalled();
      await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
      await user.click(form.getByRole('button', { name: specs[view].save }));
      await waitFor(() =>
        expect(state.put).toHaveBeenCalledWith(specs[view].path + '/' + view, {
          [view === 'position' ? 'title' : 'name']: 'Retained name',
        }),
      );
    },
  );
  it.each(views)(
    'preserves explicit clears in the %s draft while leaving other defaults untouched',
    async (view) => {
      const user = userEvent.setup();
      render(<App initial={view} />);
      let form = await edit(user, view);
      if (view === 'department') await user.selectOptions(form.getByLabelText('Division'), '');
      else
        await user.clear(
          form.getByLabelText(view === 'position' ? 'Default salary' : 'Default amount (TZS)'),
        );
      if (view === 'deduction')
        fireEvent.change(form.getByLabelText('Default percentage (%)'), { target: { value: '0' } });
      await keep(user);
      state.records[view] = { ...state.records[view], updatedAt: 'v2' };
      form = await resume(user, view);
      await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
      await user.click(form.getByRole('button', { name: specs[view].save }));
      expect(state.put).toHaveBeenCalledWith(
        specs[view].path + '/' + view,
        view === 'department'
          ? { divisionId: null, branchId: null }
          : view === 'position'
            ? { defaultSalary: null }
            : view === 'allowance'
              ? { defaultAmount: null }
              : { defaultAmount: null, defaultPercentage: 0 },
      );
    },
  );
  it('refreshes a suggested department code without turning it into a reserved code', async () => {
    const user = userEvent.setup();
    render(<App />);
    let form = await create(user, 'department');
    await waitFor(() =>
      expect(form.getByLabelText('Department code')).toHaveAttribute('placeholder', 'AUTO-1'),
    );
    await keep(user);
    state.code = 'AUTO-2';
    form = await resume(user, 'department', false);
    await waitFor(() =>
      expect(form.getByLabelText('Department code')).toHaveAttribute('placeholder', 'AUTO-2'),
    );
    expect(form.getByLabelText('Department code')).toHaveValue('');
    await user.selectOptions(form.getByLabelText(/^Company/), 'company-b');
    expect(form.getByLabelText('Division')).toHaveValue('');
    expect(form.getByLabelText('Branch / Location')).toHaveValue('');
  });
  it('blocks a kept department draft when its branch is no longer available', async () => {
    const user = userEvent.setup();
    render(<App />);
    await create(user, 'department');
    await keep(user);
    state.branchAvailable = false;
    const form = await resume(user, 'department', false);
    await user.click(form.getByRole('button', { name: 'Save department' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Choose an available branch');
    expect(state.post).not.toHaveBeenCalled();
    await user.selectOptions(form.getByLabelText('Branch / Location'), '');
    await user.click(form.getByRole('button', { name: 'Save department' }));
    expect(state.post).toHaveBeenCalledWith(
      '/hr/departments',
      expect.objectContaining({ divisionId: 'division', branchId: undefined }),
    );
  });
  it('blocks a position whose current department is no longer an available active choice', async () => {
    const user = userEvent.setup();
    render(<App initial="position" />);
    let form = await edit(user, 'position');
    await user.type(form.getByLabelText(/^Title/), ' pending');
    await keep(user);
    state.departmentAvailable = false;
    form = await resume(user, 'position');
    expect(form.getByLabelText(/^Department/)).toHaveValue('department');
    await user.click(form.getByRole('button', { name: 'Save position' }));
    expect(await form.findByRole('alert')).toHaveTextContent(
      'Choose an available active department',
    );
    expect(state.put).not.toHaveBeenCalled();
  });
  it('allows title edits with a fixed department but prevents choosing one without directory permission', async () => {
    const user = userEvent.setup();
    state.permissions.delete('departments.view');
    render(<App initial="position" />);
    const form = await edit(user, 'position');
    expect(form.getByLabelText(/^Department/)).toBeDisabled();
    expect(form.getByLabelText(/^Company/)).toBeDisabled();
    await user.type(form.getByLabelText(/^Title/), ' revised');
    await user.click(form.getByRole('button', { name: 'Save position' }));
    expect(state.put).toHaveBeenCalledWith('/hr/positions/position', {
      title: 'Coordinator revised',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'New position' }));
    const createForm = within(await screen.findByRole('dialog', { name: 'New position' }));
    expect(createForm.getByRole('button', { name: 'Save position' })).toBeDisabled();
    expect(createForm.getByRole('note')).toHaveTextContent('Department viewing permission');
    expect(state.page.mock.calls.some(([path]) => path === '/hr/departments')).toBe(false);
  });
  it('keeps an inaccessible type draft and checks current permission before reloading it', async () => {
    const user = userEvent.setup();
    const app = render(<App initial="allowance" />);
    let form = await edit(user, 'allowance');
    await user.type(form.getByLabelText(/^Name/), ' pending');
    await keep(user);
    state.get.mockRejectedValueOnce(new Error('Type no longer accessible'));
    await user.click(screen.getByRole('button', { name: 'Resume Edit allowance type' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Type no longer accessible');
    state.permissions.delete('allowances.manage');
    app.rerender(<App initial="allowance" />);
    await user.click(screen.getByRole('button', { name: 'Resume Edit allowance type' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current role cannot open');
    expect(state.get).toHaveBeenCalledTimes(1);
    state.permissions.add('allowances.manage');
    app.rerender(<App initial="allowance" />);
    form = await resume(user, 'allowance');
    expect(form.getByLabelText(/^Name/)).toHaveValue('Transport pending');
  });
  it('ignores a late department read after navigating away', async () => {
    const user = userEvent.setup();
    render(<App />);
    const form = await edit(user, 'department');
    await user.type(form.getByLabelText(/^Name/), ' pending');
    await keep(user);
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Resume Edit department' }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await act(async () => {
      resolve({ ...state.records.department });
    });
    expect(state.get.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Edit department' })).toBeEnabled();
  });
  it.each(views)('explains current permission loss in an open %s editor', async (view) => {
    const user = userEvent.setup();
    const app = render(<App initial={view} />);
    const form = await edit(user, view);
    await user.type(form.getByLabelText(specs[view].field), ' pending');
    state.permissions.delete(specs[view].permission);
    app.rerender(<App initial={view} />);
    expect(form.getByRole('button', { name: specs[view].save })).toBeDisabled();
    expect(form.getByRole('alert')).toHaveTextContent('Your current role cannot save');
    await keep(user);
    expect(screen.getByRole('button', { name: 'Resume ' + title(view) })).toBeEnabled();
    expect(state.put).not.toHaveBeenCalled();
  });
  it.each(views)(
    'retains the %s register scope and selection and recovers an obsolete page',
    async (view) => {
      const user = userEvent.setup();
      render(<App initial={view} />);
      await screen.findByRole('button', { name: 'Inspect ' + specs[view].name });
      await user.click(screen.getByRole('button', { name: /Filters/ }));
      await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
      await user.type(screen.getByRole('searchbox'), 'A');
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          specs[view].path,
          expect.objectContaining({ query: expect.objectContaining({ search: 'A' }) }),
        ),
      );
      await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          specs[view].path,
          expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
        ),
      );
      await user.click(await screen.findByRole('button', { name: 'Inspect ' + specs[view].name }));
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      state.page.mockClear();
      await user.click(screen.getByRole('link', { name: 'Open ' + view }));
      expect(
        await screen.findByRole('button', { name: 'Inspect ' + specs[view].name }),
      ).toHaveAttribute('aria-expanded', 'true');
      const reads = state.page.mock.calls.filter(
        ([path, opts]) => path === specs[view].path && opts?.query?.limit === 20,
      );
      expect(reads.length).toBeGreaterThan(0);
      expect(
        reads.every(
          ([, opts]) =>
            opts.query.page === 2 &&
            opts.query.companyId === 'company' &&
            opts.query.search === 'A',
        ),
      ).toBe(true);
      state.emptyPage = true;
      await user.click(screen.getByRole('button', { name: 'Reload' }));
      await waitFor(() =>
        expect(state.page).toHaveBeenCalledWith(
          specs[view].path,
          expect.objectContaining({
            query: expect.objectContaining({ page: 1, companyId: 'company', search: 'A' }),
          }),
        ),
      );
    },
  );
});

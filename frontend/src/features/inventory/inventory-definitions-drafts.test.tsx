import { useState } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnitWorkspace } from '@/components/workspace/unit-workspace';
import { CatalogueWorkspace } from '@/components/workspace/catalogue-workspace';
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
import { InventoryWorkspaceProvider } from './inventory-workspace-context';
import { InventoryDraftWorkspace, useInventoryDefinitionEditor } from './inventory-drafts';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  saved: vi.fn(),
  records: {} as Record<string, Record<string, unknown>>,
  divisionAvailable: true,
  unitAvailable: true,
  emptyPage: false,
  parentAvailable: true,
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/inventory',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator', companyId: 'company' },
    loading: false,
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
}));
const scope = { companyId: 'company', divisionId: 'division', branchId: '' };
const specs = {
  unit: {
    name: 'Crate',
    edit: 'Edit unit',
    opener: 'New unit',
    title: 'unit',
    field: /^Name/,
    save: 'Save changes',
    create: 'Create unit',
    path: '/units',
    permission: 'units.manage',
  },
  conversion: {
    name: 'Crate to Piece',
    edit: 'Edit conversion',
    opener: 'New conversion',
    title: 'conversion',
    field: /^Description/,
    save: 'Save changes',
    create: 'Create conversion',
    path: '/unit-conversions',
    permission: 'units.manage',
  },
  category: {
    name: 'Paints',
    edit: 'Edit category',
    opener: 'New category',
    title: 'category',
    field: /^Category name/,
    save: 'Save category',
    create: 'Save category',
    path: '/product-categories',
    permission: 'product_categories.manage',
  },
  family: {
    name: 'Small tin',
    edit: 'Edit family',
    opener: 'New family',
    title: 'product family',
    field: /^Family name/,
    save: 'Save family',
    create: 'Save family',
    path: '/products/families',
    permission: 'product_categories.manage',
  },
};
type View = keyof typeof specs;
const views = Object.keys(specs) as View[];
const pathFor = (v: View) =>
  v === 'unit' || v === 'conversion' ? '/operations/units' : '/operations/product-categories';
function Pages() {
  const path = useWorkspacePathname();
  return (
    <>
      <nav aria-label="Destinations">
        <WorkspaceLink href="/inventory">Open home</WorkspaceLink>
        <WorkspaceLink href="/operations/units">Open units</WorkspaceLink>
        <WorkspaceLink href="/operations/product-categories">Open catalogue</WorkspaceLink>
      </nav>
      <InventoryDraftWorkspace key={path} onSaved={state.saved}>
        <InventoryWorkspaceProvider scope={scope} searchQuery="">
          {path === '/operations/units' ? (
            <UnitWorkspace />
          ) : path === '/operations/product-categories' ? (
            <CatalogueWorkspace />
          ) : (
            <h1>Inventory home</h1>
          )}
        </InventoryWorkspaceProvider>
      </InventoryDraftWorkspace>
    </>
  );
}
function App({ initial = 'unit' }: { initial?: View }) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="primary">
            <WorkspaceNavigationProvider
              appId="inventory"
              initialHref={pathFor(initial)}
              ownsPath={(p) => p === '/inventory' || p.startsWith('/operations/')}
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
    'units.view',
    'units.manage',
    'product_categories.view',
    'product_categories.manage',
    'products.view',
    'companies.read',
    'divisions.read',
  ]);
  state.divisionAvailable = state.unitAvailable = state.parentAvailable = true;
  state.emptyPage = false;
  const company = { id: 'company', name: 'Company A' },
    division = { id: 'division', name: 'Retail' };
  state.records = {
    unit: {
      id: 'unit',
      companyId: 'company',
      name: 'Crate',
      symbol: 'crt',
      unitType: 'PACKAGE',
      isBaseUnit: false,
      isSystemUnit: false,
      status: 'ACTIVE',
      updatedAt: 'v1',
    },
    piece: {
      id: 'piece',
      companyId: null,
      name: 'Piece',
      symbol: 'pc',
      unitType: 'PIECE',
      isBaseUnit: true,
      isSystemUnit: true,
      status: 'ACTIVE',
    },
    conversion: {
      id: 'conversion',
      companyId: 'company',
      fromUnitId: 'unit',
      toUnitId: 'piece',
      fromUnit: { name: 'Crate', symbol: 'crt' },
      toUnit: { name: 'Piece', symbol: 'pc' },
      conversionFactor: '12',
      description: 'Box to each',
      isActive: true,
      updatedAt: 'v1',
    },
    parent: {
      id: 'parent',
      companyId: 'company',
      name: 'Finishes',
      categoryType: 'HARDWARE',
      isActive: true,
    },
    category: {
      id: 'category',
      companyId: 'company',
      company,
      name: 'Paints',
      categoryType: 'HARDWARE',
      isActive: true,
      parentCategoryId: 'parent',
      parentCategory: { id: 'parent', name: 'Finishes' },
      description: 'Original category notes',
      updatedAt: 'v1',
    },
    family: {
      id: 'family',
      companyId: 'company',
      categoryId: 'category',
      divisionId: 'division',
      division,
      name: 'Small tin',
      description: 'Original family notes',
      isActive: true,
      defaultPurchasePrice: '10',
      defaultSellingPrice: '20',
      wholesalePrice: '15',
      retailPrice: '25',
      updatedAt: 'v1',
    },
    createdParent: {
      id: 'created-parent',
      companyId: 'company',
      name: 'New finishes',
      categoryType: 'TRADING_GOODS',
      isActive: true,
    },
  };
  const listing = (rows: unknown[], opts?: { query?: { page?: number; limit?: number } }) => ({
    data: state.emptyPage && opts?.query?.limit === 20 && (opts.query.page || 1) > 1 ? [] : rows,
    total: opts?.query?.limit === 20 && !state.emptyPage ? 21 : rows.length,
  });
  state.get.mockImplementation(async (path, opts) => {
    if (path === '/units')
      return listing([{ ...state.records.unit }, { ...state.records.piece }], opts);
    if (path === '/unit-conversions') return listing([{ ...state.records.conversion }], opts);
    if (path === '/product-categories') return listing([{ ...state.records.category }], opts);
    if (path === '/products/families') return listing([{ ...state.records.family }], opts);
    if (path === '/product-categories/created-parent') {
      if (!state.parentAvailable) throw new Error('Created parent no longer accessible');
      return { ...state.records.createdParent };
    }
    const view = views.find((v) => path === specs[v].path + '/' + v);
    if (!view) throw new Error('Unexpected source: ' + path);
    return { ...state.records[view] };
  });
  state.page.mockImplementation(async (path, opts) =>
    listing(
      path === '/companies'
        ? [company]
        : path === '/divisions'
          ? state.divisionAvailable
            ? [division]
            : []
          : path === '/units'
            ? [state.records.unit, ...(state.unitAvailable ? [state.records.piece] : [])]
            : path === '/product-categories'
              ? [state.records.category, state.records.parent]
              : [],
      opts,
    ),
  );
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
type User = ReturnType<typeof userEvent.setup>;
async function prepare(user: User, v: View) {
  const app = render(<App initial={v} />);
  if (v === 'conversion')
    await user.click(screen.getByRole('button', { name: 'Conversions', exact: true }));
  if (v === 'family') {
    await user.click(await screen.findByRole('button', { name: 'Inspect Paints' }));
    await user.click(screen.getByRole('button', { name: 'View families' }));
  }
  await screen.findByRole('button', { name: 'Inspect ' + specs[v].name });
  return app;
}
async function ready(v: View, edit = true) {
  const form = within(
    await screen.findByRole('dialog', { name: (edit ? 'Edit ' : 'New ') + specs[v].title }),
  );
  await waitFor(() =>
    expect(
      form.getByRole('button', { name: edit ? specs[v].save : specs[v].create }),
    ).toBeEnabled(),
  );
  return form;
}
async function edit(user: User, v: View) {
  await user.click(screen.getByRole('button', { name: 'Inspect ' + specs[v].name }));
  await user.click(screen.getByRole('button', { name: specs[v].edit, exact: true }));
  return ready(v);
}
async function keep(user: User) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function resume(user: User, v: View, editing = true) {
  await user.click(
    screen.getByRole('button', { name: 'Resume ' + (editing ? 'Edit ' : 'New ') + specs[v].title }),
  );
  return ready(v, editing);
}
async function create(user: User, v: View) {
  await user.click(screen.getByRole('button', { name: specs[v].opener, exact: true }));
  const form = await ready(v, false);
  fireEvent.change(form.getByLabelText(specs[v].field), { target: { value: 'Retained input' } });
  if (v === 'unit') fireEvent.change(form.getByLabelText(/^Symbol/), { target: { value: 'ret' } });
  if (v === 'conversion') {
    await user.selectOptions(form.getByLabelText(/^From unit/), 'unit');
    await user.selectOptions(form.getByLabelText(/^To unit/), 'piece');
    fireEvent.change(form.getByLabelText(/^Conversion factor/), { target: { value: '24.5' } });
  }
  if (v === 'family')
    fireEvent.change(form.getByLabelText('Purchase price'), { target: { value: '0' } });
  return form;
}

function NewUnitAction() {
  const editor = useInventoryDefinitionEditor(['unit'], () => undefined);
  return (
    <button onClick={() => editor.open({ kind: 'unit', companyId: 'company' })}>
      Create unit in first window
    </button>
  );
}
function UnfinishedWork() {
  const [text, setText] = useState('');
  return (
    <input
      aria-label="Unfinished work in second window"
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
function PairedWindows() {
  const [revision, setRevision] = useState(0);
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="first">
            <InventoryDraftWorkspace onSaved={() => undefined}>
              <NewUnitAction />
            </InventoryDraftWorkspace>
          </UnsavedWorkScope>
          <UnsavedWorkScope id="second">
            <InventoryDraftWorkspace onSaved={() => setRevision((v) => v + 1)}>
              <UnfinishedWork key={revision} />
            </InventoryDraftWorkspace>
          </UnsavedWorkScope>
        </WorkspaceDraftsProvider>
      </UnsavedWorkProvider>
    </WorkspaceSessionProvider>
  );
}
describe('Inventory catalogue continuity', () => {
  it('does not remount unrelated unfinished work when another Inventory window saves', async () => {
    const user = userEvent.setup();
    render(<PairedWindows />);
    await user.type(screen.getByLabelText('Unfinished work in second window'), 'Keep this work');
    await user.click(screen.getByRole('button', { name: 'Create unit in first window' }));
    const form = await ready('unit', false);
    await user.type(form.getByLabelText(/^Name/), 'New package');
    await user.type(form.getByLabelText(/^Symbol/), 'pkg');
    await user.click(form.getByRole('button', { name: 'Create unit' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).toHaveBeenCalledOnce();
    expect(screen.getByLabelText('Unfinished work in second window')).toHaveValue('Keep this work');
  });

  it.each(views)('retains a new %s through app navigation and a failed save', async (v) => {
    const user = userEvent.setup();
    await prepare(user, v);
    await create(user, v);
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await screen.findByRole('heading', { name: 'Inventory home' });
    const form = await resume(user, v, false);
    expect(form.getByLabelText(specs[v].field)).toHaveValue('Retained input');
    expect(state.post).not.toHaveBeenCalled();
    state.post.mockRejectedValueOnce(new Error('Save unavailable'));
    await user.click(form.getByRole('button', { name: specs[v].create }));
    expect(await form.findByRole('alert')).toHaveTextContent('Save unavailable');
    await user.click(form.getByRole('button', { name: specs[v].create }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(state.post).toHaveBeenCalledTimes(2);
    expect(state.post).toHaveBeenLastCalledWith(
      specs[v].path,
      expect.objectContaining({
        companyId: 'company',
        [v === 'conversion' ? 'description' : 'name']: 'Retained input',
      }),
    );
    if (v === 'conversion')
      expect(state.post.mock.calls[1][1]).toMatchObject({
        conversionFactor: 24.5,
        fromUnitId: 'unit',
        toUnitId: 'piece',
      });
    if (v === 'family')
      expect(state.post.mock.calls[1][1]).toMatchObject({
        divisionId: 'division',
        categoryId: 'category',
        defaultPurchasePrice: 0,
        defaultSellingPrice: null,
      });
    expect(state.saved).toHaveBeenCalledOnce();
  });
  it.each(views)('uses current %s settings on resume and patches only the user edit', async (v) => {
    const user = userEvent.setup();
    await prepare(user, v);
    let form = await edit(user, v);
    fireEvent.change(form.getByLabelText(specs[v].field), { target: { value: 'Edited text' } });
    await keep(user);
    state.records[v] = {
      ...state.records[v],
      updatedAt: 'v2',
      status: 'INACTIVE',
      isActive: false,
      isBaseUnit: true,
      defaultPurchasePrice: '12',
      defaultSellingPrice: '30',
      wholesalePrice: '22',
      retailPrice: '35',
      conversionFactor: '48',
    };
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    form = await resume(user, v);
    expect(form.getByLabelText(specs[v].field)).toHaveValue('Edited text');
    if (v === 'unit') {
      expect(form.getByLabelText('Status')).toHaveValue('INACTIVE');
      expect(
        form.getByRole('checkbox', { name: 'Base unit for this type and scope' }),
      ).toBeChecked();
    }
    if (v === 'conversion') expect(form.getByLabelText(/^Conversion factor/)).toHaveValue(48);
    if (v === 'family') expect(form.getByLabelText('Selling price')).toHaveValue(30);
    await user.click(form.getByRole('button', { name: specs[v].save }));
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: specs[v].save }));
    expect(state.patch).toHaveBeenCalledWith(specs[v].path + '/' + v, {
      [v === 'conversion' ? 'description' : 'name']: 'Edited text',
    });
  });
  it.each(['category', 'family', 'conversion'] as const)(
    'retains explicit clears in %s without overwriting other values',
    async (v) => {
      const user = userEvent.setup();
      await prepare(user, v);
      let form = await edit(user, v);
      await user.clear(form.getByLabelText('Description'));
      if (v === 'category') await user.selectOptions(form.getByLabelText('Parent category'), '');
      if (v === 'family') await user.clear(form.getByLabelText('Wholesale price'));
      await keep(user);
      form = await resume(user, v);
      await user.click(form.getByRole('button', { name: specs[v].save }));
      expect(state.patch).toHaveBeenCalledWith(
        specs[v].path + '/' + v,
        v === 'category'
          ? { description: null, parentCategoryId: null }
          : v === 'family'
            ? { description: null, wholesalePrice: null }
            : { description: '' },
      );
    },
  );
  it('requires review when the current unit has no version even if its values match', async () => {
    const user = userEvent.setup();
    state.records.unit.updatedAt = undefined;
    await prepare(user, 'unit');
    let form = await edit(user, 'unit');
    fireEvent.change(form.getByLabelText(/^Name/), { target: { value: 'New label' } });
    await keep(user);
    form = await resume(user, 'unit');
    expect(form.getByRole('checkbox', { name: /I have reviewed/ })).not.toBeChecked();
    await user.click(form.getByRole('button', { name: 'Save changes' }));
    expect(state.patch).not.toHaveBeenCalled();
  });
  it.each([true, false])(
    'keeps a successfully created parent through a failed child save; parent accessible=%s',
    async (available) => {
      const user = userEvent.setup();
      await prepare(user, 'category');
      let form = await create(user, 'category');
      await waitFor(() => expect(form.getByLabelText('Parent category')).toBeEnabled());
      await user.selectOptions(form.getByLabelText('Parent category'), '__new__');
      await user.type(form.getByLabelText(/^New parent name/), 'New finishes');
      state.post
        .mockResolvedValueOnce(state.records.createdParent)
        .mockRejectedValueOnce(new Error('Child save unavailable'));
      await user.click(form.getByRole('button', { name: 'Save category' }));
      expect(await form.findByRole('alert')).toHaveTextContent('Child save unavailable');
      await keep(user);
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      state.parentAvailable = available;
      if (!available) {
        await user.click(screen.getByRole('button', { name: 'Resume New category' }));
        expect(await screen.findByRole('alert')).toHaveTextContent(
          'Created parent no longer accessible',
        );
        expect(state.post).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        return;
      }
      form = await resume(user, 'category', false);
      expect(form.getByLabelText(/^Company/)).toBeDisabled();
      expect(form.getByLabelText('Parent category')).toHaveValue('created-parent');
      // The draft hint is a live region too, so name the one under test rather
      // than assuming the form has only one.
      expect(
        form
          .getAllByRole('status')
          .some((node) => node.textContent?.includes('has been created')),
      ).toBe(true);
      await user.click(form.getByRole('button', { name: 'Save category' }));
      expect(state.post).toHaveBeenCalledTimes(3);
      expect(state.post).toHaveBeenLastCalledWith(
        '/product-categories',
        expect.objectContaining({
          parentCategoryId: 'created-parent',
          companyId: 'company',
          name: 'Retained input',
        }),
      );
    },
  );
  it('prevents editing a unit that has become a protected system unit', async () => {
    const user = userEvent.setup();
    await prepare(user, 'unit');
    const form = await edit(user, 'unit');
    fireEvent.change(form.getByLabelText(/^Name/), { target: { value: 'Retained label' } });
    await keep(user);
    state.records.unit = { ...state.records.unit, isSystemUnit: true, updatedAt: 'v2' };
    await user.click(screen.getByRole('button', { name: 'Resume Edit unit' }));
    const resumed = within(await screen.findByRole('dialog', { name: 'Edit unit' }));
    expect(resumed.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(resumed.getByRole('alert')).toHaveTextContent('System units cannot be changed');
    await keep(user);
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('rejects an unavailable division in a resumed new family without losing its prices', async () => {
    const user = userEvent.setup();
    await prepare(user, 'family');
    await create(user, 'family');
    await keep(user);
    state.divisionAvailable = false;
    const form = await resume(user, 'family', false);
    await user.click(form.getByRole('button', { name: 'Save family' }));
    expect(await form.findByRole('alert')).toHaveTextContent('Choose an available division');
    expect(form.getByLabelText('Purchase price')).toHaveValue(0);
    expect(state.post).not.toHaveBeenCalled();
  });
  it('reloads the current category when a family has been moved before resuming', async () => {
    const user = userEvent.setup();
    await prepare(user, 'family');
    let form = await edit(user, 'family');
    fireEvent.change(form.getByLabelText(/^Family name/), { target: { value: 'Pending family' } });
    await keep(user);
    state.records.family = { ...state.records.family, categoryId: 'new-category', updatedAt: 'v2' };
    const get = state.get.getMockImplementation()!;
    state.get.mockImplementation((path, opts) =>
      path === '/product-categories/new-category'
        ? Promise.resolve({ ...state.records.category, id: 'new-category', name: 'New category' })
        : get(path, opts),
    );
    form = await resume(user, 'family');
    expect(form.getByText(/New category · Company A/)).toBeVisible();
    await user.click(form.getByRole('checkbox', { name: /I have reviewed/ }));
    await user.click(form.getByRole('button', { name: 'Save family' }));
    expect(state.patch).toHaveBeenCalledWith('/products/families/family', {
      name: 'Pending family',
    });
  });
  it.each(views)(
    'explains permission loss while a %s draft is open and preserves it',
    async (v) => {
      const user = userEvent.setup();
      const app = await prepare(user, v);
      const form = await edit(user, v);
      fireEvent.change(form.getByLabelText(specs[v].field), { target: { value: 'Pending edit' } });
      state.permissions.delete(specs[v].permission);
      app.rerender(<App initial={v} />);
      expect(form.getByRole('button', { name: specs[v].save })).toBeDisabled();
      expect(form.getByRole('alert')).toHaveTextContent('Your current role cannot save');
      await keep(user);
      expect(state.patch).not.toHaveBeenCalled();
    },
  );
  it('preserves an inaccessible conversion and checks current permissions before another read', async () => {
    const user = userEvent.setup();
    const app = await prepare(user, 'conversion');
    const form = await edit(user, 'conversion');
    fireEvent.change(form.getByLabelText('Description'), {
      target: { value: 'Pending conversion' },
    });
    await keep(user);
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    state.get.mockClear();
    state.get.mockRejectedValueOnce(new Error('Conversion unavailable'));
    await user.click(screen.getByRole('button', { name: 'Resume Edit conversion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Conversion unavailable');
    state.permissions.delete('units.manage');
    app.rerender(<App initial="conversion" />);
    await user.click(screen.getByRole('button', { name: 'Resume Edit conversion' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your current role cannot open');
    expect(state.get).toHaveBeenCalledTimes(1);
  });
  it('ignores a delayed family read after its workspace unmounts', async () => {
    const user = userEvent.setup();
    await prepare(user, 'family');
    const form = await edit(user, 'family');
    fireEvent.change(form.getByLabelText(/^Family name/), { target: { value: 'Pending family' } });
    await keep(user);
    let resolve!: (value: unknown) => void;
    state.get.mockClear();
    state.get.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await user.click(screen.getByRole('button', { name: 'Resume Edit product family' }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await act(async () => {
      resolve({ ...state.records.family });
    });
    expect(state.get.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume Edit product family' })).toBeEnabled();
  });
  it.each(views)(
    'retains the %s view, search, page and selection and recovers an obsolete page',
    async (v) => {
      const user = userEvent.setup();
      await prepare(user, v);
      fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'A' } });
      await waitFor(() =>
        expect(state.get).toHaveBeenCalledWith(
          specs[v].path,
          expect.objectContaining({ query: expect.objectContaining({ search: 'A' }) }),
        ),
      );
      await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
      await waitFor(() =>
        expect(state.get).toHaveBeenCalledWith(
          specs[v].path,
          expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
        ),
      );
      await user.click(await screen.findByRole('button', { name: 'Inspect ' + specs[v].name }));
      await user.click(screen.getByRole('link', { name: 'Open home' }));
      state.get.mockClear();
      await user.click(
        screen.getByRole('link', {
          name: v === 'unit' || v === 'conversion' ? 'Open units' : 'Open catalogue',
        }),
      );
      expect(
        await screen.findByRole('button', { name: 'Inspect ' + specs[v].name }),
      ).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('searchbox')).toHaveValue('A');
      const reads = state.get.mock.calls.filter(
        ([path, opts]) => path === specs[v].path && opts?.query?.limit === 20,
      );
      expect(reads.length).toBeGreaterThan(0);
      expect(reads.every(([, opts]) => opts.query.page === 2 && opts.query.search === 'A')).toBe(
        true,
      );
      state.emptyPage = true;
      await user.click(
        screen.getByRole('button', {
          name: v === 'family' ? 'Refresh families' : 'Refresh',
          exact: true,
        }),
      );
      await waitFor(() =>
        expect(state.get).toHaveBeenCalledWith(
          specs[v].path,
          expect.objectContaining({ query: expect.objectContaining({ page: 1, search: 'A' }) }),
        ),
      );
    },
  );
});

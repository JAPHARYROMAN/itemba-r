import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductWorkspace } from '@/components/workspace/product-workspace';
import { ProductProfile } from '@/components/workspace/product-profile';
import type { Product, ProductFamily } from '@/components/workspace/product-types';
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
import { InventoryDraftWorkspace } from './inventory-drafts';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  saved: vi.fn(),
  product: {} as Product,
  family: {} as ProductFamily,
  removed: new Set<string>(),
  emptyPage: false,
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
  backendUpload: state.upload,
  backendDelete: state.remove,
}));
const scope = { companyId: 'company', divisionId: '', branchId: '' };
function Pages({ standalone = false }: { standalone?: boolean }) {
  const path = useWorkspacePathname();
  const content =
    path === '/operations/products' ? (
      <ProductWorkspace />
    ) : path === '/inventory/profile' ? (
      <ProductProfile productId="product" backHref="/operations/products" />
    ) : (
      <h1>Inventory home</h1>
    );
  return (
    <>
      <nav aria-label="Destinations">
        <WorkspaceLink href="/inventory">Open home</WorkspaceLink>
        <WorkspaceLink href="/operations/products">Open products</WorkspaceLink>
        <WorkspaceLink href="/inventory/profile">Open profile</WorkspaceLink>
      </nav>
      {standalone ? (
        content
      ) : (
        <InventoryDraftWorkspace key={path} onSaved={state.saved}>
          <InventoryWorkspaceProvider scope={scope} searchQuery="">
            {content}
          </InventoryWorkspaceProvider>
        </InventoryDraftWorkspace>
      )}
    </>
  );
}
function App({
  initial = '/operations/products',
  standalone = false,
}: {
  initial?: string;
  standalone?: boolean;
}) {
  return (
    <WorkspaceSessionProvider>
      <UnsavedWorkProvider>
        <WorkspaceDraftsProvider>
          <UnsavedWorkScope id="primary">
            <WorkspaceNavigationProvider
              appId="inventory"
              initialHref={initial}
              ownsPath={(p) => p.startsWith('/inventory') || p.startsWith('/operations/')}
            >
              <Pages standalone={standalone} />
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
    'products.view',
    'products.create',
    'products.update',
    'companies.read',
    'divisions.read',
    'branches.read',
    'product_categories.view',
    'units.view',
    'inventory.view',
    'inventory.movements.view',
  ]);
  state.removed = new Set();
  state.emptyPage = false;
  state.family = {
    id: 'family',
    name: 'Small tin',
    categoryId: 'paint',
    defaultPurchasePrice: 10,
    defaultSellingPrice: 20,
    wholesalePrice: 18,
    retailPrice: 22,
  };
  state.product = {
    id: 'product',
    companyId: 'company',
    company: { name: 'Company A' },
    categoryId: 'paint',
    category: { name: 'Paints' },
    name: 'White paint',
    productCode: 'P-1',
    sku: 'PAINT',
    baseUnitId: 'unit',
    baseUnit: { name: 'Piece', symbol: 'pc' },
    salesUnitId: 'unit',
    status: 'ACTIVE',
    productType: 'STOCK_ITEM',
    trackInventory: true,
    trackBatch: false,
    trackExpiry: false,
    productFamilyId: 'family',
    productFamily: state.family,
    defaultPurchasePrice: 10,
    defaultSellingPrice: 25,
    retailPrice: 30,
    wholesalePrice: 24,
    minimumStockLevel: 4,
    description: 'Original notes',
    variantColor: 'White',
    variantSize: '4 L',
    isTaxable: true,
    taxRate: 18,
    imageUrl: '/existing.png',
    updatedAt: 'v1',
  };
  state.get.mockImplementation(
    async (path: string, options?: { query?: Record<string, unknown> }) => {
      if (path === '/products') {
        const second = options?.query?.page === 2;
        return {
          data: second
            ? state.emptyPage
              ? []
              : [{ ...state.product, id: 'second', name: 'Blue paint' }]
            : [state.product],
          total: state.emptyPage ? 1 : 40,
        };
      }
      if (path === '/products/product') return { ...state.product };
      if (path === '/inventory-movements') return { data: [], total: 0 };
      throw new Error('Unexpected read: ' + path);
    },
  );
  state.page.mockImplementation(async (path: string) => {
    const rows: Record<string, { id: string }[]> = {
      '/companies': [{ id: 'company', name: 'Company A' } as { id: string }],
      '/divisions': [{ id: 'division', name: 'Retail' } as { id: string }],
      '/branches': [],
      '/product-categories': [{ id: 'paint', name: 'Paints' } as { id: string }],
      '/units': [{ id: 'unit', name: 'Piece', symbol: 'pc' } as { id: string }],
      '/products/families': [state.family, { ...state.family, id: 'sibling', name: 'Large tin' }],
      '/inventory-balances': [],
    };
    const data = (rows[path] || []).filter((row) => !state.removed.has(row.id));
    return { data, total: data.length };
  });
  state.patch.mockImplementation(async (_path, body) => ({ ...state.product, ...body }));
  state.post.mockImplementation(async (_path, body) => ({ ...state.product, ...body }));
  state.upload.mockResolvedValue({ imageUrl: '/new.png' });
  state.remove.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
type User = ReturnType<typeof userEvent.setup>;
const input = (label: string, value: string) =>
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(new RegExp('^' + label)), {
    target: { value },
  });
async function dialog(editing = true) {
  const form = within(
    await screen.findByRole('dialog', { name: editing ? 'Edit product' : 'New product' }),
  );
  await waitFor(() => expect(form.getByLabelText('Product family')).not.toBeDisabled());
  return form;
}
async function edit(user: User) {
  await user.click(await screen.findByRole('button', { name: 'Inspect White paint' }));
  await user.click(screen.getByRole('button', { name: 'Edit product' }));
  return dialog();
}
async function create(user: User) {
  await user.click(screen.getByRole('button', { name: 'New product' }));
  await screen.findByRole('dialog', { name: 'New product' });
  await waitFor(() =>
    expect(within(screen.getByRole('dialog')).getByLabelText(/^Category/)).not.toBeDisabled(),
  );
  input('Product name', 'New white paint');
  input('Category', 'paint');
  await dialog(false);
  input('Base unit', 'unit');
  input('Product family', 'family');
}
async function keep(user: User) {
  await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
}
async function resume(user: User, editing = true, waitChoices = true) {
  await user.click(
    screen.getByRole('button', { name: editing ? 'Resume Edit product' : 'Resume New product' }),
  );
  if (waitChoices) return dialog(editing);
  return within(
    await screen.findByRole('dialog', { name: editing ? 'Edit product' : 'New product' }),
  );
}
const save = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Save product', exact: true }));
const review = () =>
  fireEvent.click(screen.getByLabelText('I have reviewed the latest record and my draft values.'));
const imageFile = () => new File(['paint'], 'paint.png', { type: 'image/png', lastModified: 123 });
function selectImage(file = imageFile()) {
  fireEvent.change(screen.getByLabelText('Product image', { exact: true }), {
    target: { files: [file] },
  });
  return file;
}

describe('Inventory product continuity', () => {
  it('keeps a new product through guarded navigation and failed save, including its variant settings', async () => {
    const user = userEvent.setup();
    render(<App />);
    await create(user);
    input('Colour', 'Ivory');
    input('Size', '4 L');
    input('Minimum stock', '0');
    input('Description', 'Keep me');
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await screen.findByRole('heading', { name: 'Inventory home' });
    expect(state.post).not.toHaveBeenCalled();
    await resume(user, false);
    expect(screen.getByLabelText('Create all family sizes')).toBeChecked();
    expect(screen.getByLabelText('Colour')).toHaveValue('Ivory');
    expect(screen.getByLabelText('Minimum stock')).toHaveValue(0);
    state.post.mockRejectedValueOnce(new Error('Save unavailable'));
    save();
    await screen.findByText('Save unavailable');
    await keep(user);
    await resume(user, false);
    save();
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(2));
    expect(state.post).toHaveBeenLastCalledWith(
      '/products',
      expect.objectContaining({
        name: 'New white paint',
        companyId: 'company',
        productFamilyId: 'family',
        variantColor: 'Ivory',
        variantSize: '4 L',
        minimumStockLevel: 0,
        description: 'Keep me',
        createFamilyVariants: true,
      }),
    );
  });
  it('retains inline family creation and reuses the product save contract without a separate family request', async () => {
    const user = userEvent.setup();
    render(<App />);
    await create(user);
    input('Product family', '__new__');
    input('New family name', '10 litre');
    input('Family brand', 'Coral');
    input('Selling price', '25');
    await keep(user);
    await resume(user, false);
    expect(screen.getByLabelText('Product family')).toHaveValue('__new__');
    expect(screen.getByLabelText('New family name', { exact: false })).toHaveValue('10 litre');
    save();
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    expect(state.post).toHaveBeenCalledWith(
      '/products',
      expect.objectContaining({ productFamilyName: '10 litre', productFamilyBrand: 'Coral' }),
    );
    expect(state.post.mock.calls[0][1]).not.toHaveProperty('productFamilyId');
  });
  it('reloads the current product, merges untouched fields and sends only the edited name after review', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    input('Product name', 'Ivory paint');
    await keep(user);
    state.product = {
      ...state.product,
      status: 'INACTIVE',
      defaultPurchasePrice: 40,
      defaultSellingPrice: 90,
      wholesalePrice: 80,
      retailPrice: 100,
      trackBatch: true,
      updatedAt: 'v2',
    };
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await resume(user);
    expect(state.get).toHaveBeenCalledWith(
      '/products/product',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByLabelText('Product name', { exact: false })).toHaveValue('Ivory paint');
    expect(screen.getByLabelText('Purchase price', { exact: false })).toHaveValue(40);
    expect(screen.getByLabelText('Status')).toHaveValue('INACTIVE');
    expect(screen.getByLabelText('Track batches')).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
    expect(state.patch).not.toHaveBeenCalled();
    review();
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', { name: 'Ivory paint' }),
    );
  });
  it('preserves explicit clears and zero while leaving new server values untouched', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    input('Description', '');
    input('SKU', '');
    input('Sales unit', '');
    input('Minimum stock', '0');
    await user.click(screen.getByLabelText('Taxable product'));
    await keep(user);
    state.product = { ...state.product, variantColor: 'Cream', updatedAt: 'v2' };
    await resume(user);
    review();
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', {
        description: null,
        sku: null,
        salesUnitId: null,
        minimumStockLevel: 0,
        isTaxable: false,
        taxRate: null,
      }),
    );
  });
  it('reviews current family defaults even if only the related family changed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    await user.click(screen.getByLabelText('Inherit family selling prices'));
    await keep(user);
    state.family = { ...state.family, defaultSellingPrice: 50 };
    state.product = { ...state.product, productFamily: state.family };
    await resume(user);
    expect(screen.getByLabelText('Selling price (TZS)')).toHaveValue(50);
    expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
    review();
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', {
        defaultSellingPrice: null,
        wholesalePrice: null,
        retailPrice: null,
      }),
    );
  });
  it('requires source review when the product has no version', async () => {
    state.product.updatedAt = undefined;
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    input('Description', 'Review me');
    await keep(user);
    await resume(user);
    expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
    review();
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', { description: 'Review me' }),
    );
  });
  it.each(['company', 'division', 'paint', 'unit', 'family'])(
    'blocks a new draft when its %s choice is no longer available',
    async (choice) => {
      const user = userEvent.setup();
      render(<App />);
      await create(user);
      if (choice === 'division') {
        input('Division', 'division');
        await dialog(false);
        input('Product family', 'family');
      }
      await keep(user);
      state.removed.add(choice);
      await resume(user, false);
      save();
      expect(await screen.findByRole('alert')).toHaveTextContent('Choose an available');
      expect(state.post).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Product name', { exact: false })).toHaveValue(
        'New white paint',
      );
      await keep(user);
      expect(screen.getByRole('button', { name: 'Resume New product' })).toBeVisible();
    },
  );
  it.each([true, false])(
    'keeps an open %s edit-mode draft after its write permission is revoked',
    async (editing) => {
      const user = userEvent.setup();
      const app = render(<App />);
      if (editing) await edit(user);
      else await create(user);
      input('Description', 'Keep after permission loss');
      state.permissions.delete(editing ? 'products.update' : 'products.create');
      app.rerender(<App />);
      expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
      await keep(user);
      expect(
        screen.getByRole('button', {
          name: editing ? 'Resume Edit product' : 'Resume New product',
        }),
      ).toBeVisible();
      expect(state.post).not.toHaveBeenCalled();
      expect(state.patch).not.toHaveBeenCalled();
    },
  );
  it('keeps inaccessible edits and checks current read/write permissions before retrying a source read', async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await edit(user);
    input('Description', 'Private draft');
    await keep(user);
    const normal = state.get.getMockImplementation()!;
    state.get.mockImplementation((path, options) =>
      path === '/products/product'
        ? Promise.reject(new Error('Product not accessible'))
        : normal(path, options),
    );
    await user.click(screen.getByRole('button', { name: 'Resume Edit product' }));
    await screen.findByText('Product not accessible');
    const count = state.get.mock.calls.length;
    state.permissions.delete('products.update');
    app.rerender(<App />);
    await user.click(screen.getByRole('button', { name: 'Resume Edit product' }));
    await screen.findByText('Your current role cannot open this Inventory draft.');
    expect(state.get).toHaveBeenCalledTimes(count);
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('requires a current product-read permission even while update permission remains', async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await edit(user);
    input('Description', 'Retain');
    await keep(user);
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    for (const permission of [
      'products.view',
      'inventory.view',
      'inventory.adjustments.create',
      'pos.create',
      'sales.create',
      'purchases.create',
      'operations.dashboard.view',
    ])
      state.permissions.delete(permission);
    app.rerender(<App />);
    const before = state.get.mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'Resume Edit product' }));
    await screen.findByText('Your current role cannot open this Inventory draft.');
    expect(state.get).toHaveBeenCalledTimes(before);
    expect(state.permissions.has('products.update')).toBe(true);
  });
  it('retains an explicit choice to create only one family size', async () => {
    const user = userEvent.setup();
    render(<App />);
    await create(user);
    await user.click(screen.getByLabelText('Create all family sizes'));
    await keep(user);
    await resume(user, false);
    expect(screen.getByLabelText('Create all family sizes')).not.toBeChecked();
    save();
    await waitFor(() => expect(state.post).toHaveBeenCalledTimes(1));
    expect(state.post.mock.calls[0][1]).not.toHaveProperty('createFamilyVariants');
  });
  it('ignores a source response after its workspace unmounts', async () => {
    const user = userEvent.setup();
    const app = render(<App />);
    await edit(user);
    input('Description', 'Keep');
    await keep(user);
    let finish!: (value: Product) => void;
    state.get.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Resume Edit product' }));
    const signal = state.get.mock.lastCall?.[1].signal as AbortSignal;
    app.unmount();
    expect(signal.aborted).toBe(true);
    await act(async () => finish(state.product));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('retains a selected image and product text after upload failure without automatically replaying either write', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    input('Description', 'Unfinished description');
    const file = selectImage();
    expect(state.upload).not.toHaveBeenCalled();
    state.upload.mockRejectedValueOnce(new Error('Image unavailable'));
    await user.click(screen.getByRole('button', { name: 'Save image' }));
    await screen.findByText('Image unavailable');
    await keep(user);
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await resume(user);
    expect(screen.getByText('Selected: paint.png')).toBeVisible();
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Save image' }));
    await screen.findByText('Image saved.');
    expect(state.upload.mock.lastCall?.[1].get('file')).toBe(file);
    expect(screen.getByLabelText('Description')).toHaveValue('Unfinished description');
    expect(state.saved).not.toHaveBeenCalled();
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', {
        description: 'Unfinished description',
      }),
    );
  });
  it('requires review before applying a retained removal to a changed product image', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    await keep(user);
    state.product = { ...state.product, imageUrl: '/another.png', updatedAt: 'v2' };
    await resume(user);
    expect(screen.getByRole('button', { name: 'Confirm image removal' })).toBeDisabled();
    expect(state.remove).not.toHaveBeenCalled();
    review();
    await user.click(screen.getByRole('button', { name: 'Confirm image removal' }));
    await screen.findByText('Image removed.');
    expect(state.remove).toHaveBeenCalledWith('/products/product/image');
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('retains pending image selection through guarded navigation and clears it only when explicitly discarded', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    selectImage();
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('button', { name: 'Keep draft and continue' }));
    await resume(user);
    expect(screen.getByText('Selected: paint.png')).toBeVisible();
    save();
    await screen.findByText('Save or discard the selected image change before saving the product.');
    expect(state.patch).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Discard image change' }));
    input('Description', 'Text only');
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', { description: 'Text only' }),
    );
    expect(state.upload).not.toHaveBeenCalled();
  });
  it('clears a completed image-only draft without another discard confirmation or product write', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    selectImage();
    await keep(user);
    await resume(user);
    await user.click(screen.getByRole('button', { name: 'Save image' }));
    await screen.findByText('Image saved.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Resume Edit product' })).not.toBeInTheDocument();
    expect(screen.getByText('Keep your changes?')).not.toBeVisible();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('keeps failed image removals and allows a deliberate retry', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    await user.click(screen.getByRole('button', { name: 'Remove image' }));
    state.remove.mockRejectedValueOnce(new Error('Removal unavailable'));
    await user.click(screen.getByRole('button', { name: 'Confirm image removal' }));
    await screen.findByText('Removal unavailable');
    await keep(user);
    await resume(user);
    expect(state.remove).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Confirm image removal' }));
    await screen.findByText('Image removed.');
    expect(state.remove).toHaveBeenCalledTimes(2);
  });
  it('keeps text editable after an image save in the standalone profile without remounting the form', async () => {
    const user = userEvent.setup();
    render(<App initial="/inventory/profile" standalone />);
    await user.click(await screen.findByRole('button', { name: 'Edit product' }));
    await dialog();
    input('Description', 'Profile draft');
    selectImage();
    await user.click(screen.getByRole('button', { name: 'Save image' }));
    await screen.findByText('Image saved.');
    expect(screen.getByLabelText('Description')).toHaveValue('Profile draft');
    await keep(user);
    await user.click(screen.getByRole('link', { name: 'Open products' }));
    await resume(user);
    expect(screen.getByLabelText('Description')).toHaveValue('Profile draft');
    expect(screen.queryByText('Selected: paint.png')).not.toBeInTheDocument();
    expect(state.upload).toHaveBeenCalledTimes(1);
  });
  it('does not repeat a pending upload on a second click and keeps draft dismissal disabled until it settles', async () => {
    const user = userEvent.setup();
    render(<App />);
    await edit(user);
    selectImage();
    let finish!: (value: { imageUrl: string }) => void;
    state.upload.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const button = screen.getByRole('button', { name: 'Save image' });
    // The upload is issued after the draft saves, so the clicks must be flushed
    // before it is observable. The guard against the second one is synchronous.
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Keep draft', exact: true })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => finish({ imageUrl: '/new.png' }));
    await screen.findByText('Image saved.');
  });
  it('retains generated and skipped family outcomes across navigation until dismissed', async () => {
    const user = userEvent.setup();
    render(<App />);
    await create(user);
    state.post.mockResolvedValue({
      ...state.product,
      generatedFamilyProducts: [{ ...state.product, id: 'generated' }],
      skippedFamilyProducts: [
        { productFamilyId: 'skip', familyName: 'Large tin', reason: 'Existing variant' },
      ],
    });
    save();
    await screen.findByText('Large tin: Existing variant');
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    expect(
      await screen.findByText('White paint: 1 additional family-size products created.'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Dismiss family results' }));
    await user.click(screen.getByRole('link', { name: 'Open products' }));
    expect(screen.queryByLabelText('Product family creation results')).not.toBeInTheDocument();
  });
  it('restores register filters, page and selected ID after leaving, then recovers an obsolete page', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('button', { name: 'Inspect White paint' });
    await user.type(screen.getByRole('searchbox'), 'paint');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/products',
        expect.objectContaining({ query: expect.objectContaining({ search: 'paint' }) }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await user.click(await screen.findByRole('button', { name: 'Inspect Blue paint' }));
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('link', { name: 'Open products' }));
    expect(screen.getByRole('searchbox')).toHaveValue('paint');
    expect(await screen.findByRole('heading', { name: 'Blue paint' })).toBeVisible();
    expect(screen.getByText('Page 2 of 2')).toBeVisible();
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    state.emptyPage = true;
    await user.click(screen.getByRole('link', { name: 'Open products' }));
    await screen.findByRole('button', { name: 'Inspect White paint' });
    expect(screen.queryByRole('heading', { name: 'Blue paint' })).not.toBeInTheDocument();
  });
  it('retains the profile section when returning and refreshes its data', async () => {
    const user = userEvent.setup();
    render(<App initial="/inventory/profile" standalone />);
    await user.click(await screen.findByRole('button', { name: 'Movement history' }));
    await screen.findByText('No movements');
    const before = state.get.mock.calls.filter(([path]) => path === '/inventory-movements').length;
    await user.click(screen.getByRole('link', { name: 'Open home' }));
    await user.click(screen.getByRole('link', { name: 'Open profile' }));
    await screen.findByText('No movements');
    expect(
      state.get.mock.calls.filter(([path]) => path === '/inventory-movements').length,
    ).toBeGreaterThan(before);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CatalogueWorkspace, PriceReview } from './catalogue-workspace';
import { CategoryEditor, FamilyEditor } from './catalogue-editors';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import { InventoryWorkspaceProvider } from '@/features/inventory/inventory-workspace-context';
import type { ProductCategory, ProductFamily } from './catalogue-types';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  pdf: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/operations/product-categories',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    loading: false,
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
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: state.download,
}));
vi.mock('@/lib/export-download', () => ({ downloadTablePdf: state.pdf, TABLE_PDF_MAX_ROWS: 5000 }));
const category: ProductCategory = {
  id: 'paint',
  companyId: 'company',
  name: 'Paints',
  categoryType: 'HARDWARE',
  isActive: true,
  parentCategoryId: 'parent',
  parentCategory: { id: 'parent', name: 'Finishes' },
  description: 'Interior and exterior finishes.',
  company: { id: 'company', name: 'Example Company' },
};
const family: ProductFamily = {
  id: 'family',
  companyId: 'company',
  categoryId: 'paint',
  name: '4 litre',
  brand: 'Coral',
  divisionId: 'division',
  division: { id: 'division', name: 'Building supplies' },
  description: 'Standard finishes. Individual product prices can override these defaults.',
  isActive: true,
  defaultPurchasePrice: '12000.00',
  defaultSellingPrice: '18000.00',
  wholesalePrice: '16000.00',
  retailPrice: '20000.00',
  productCount: 2,
  inheritedPriceCount: 1,
  overridePriceCount: 1,
  missingPriceCount: 0,
  priceExceptionCount: 1,
};
const mount = (children: React.ReactNode = <CatalogueWorkspace />) =>
  render(<UnsavedWorkProvider>{children}</UnsavedWorkProvider>);
const inspect = async () =>
  fireEvent.click(await screen.findByRole('button', { name: 'Inspect Paints' }));
const openFamilies = async () => {
  await inspect();
  fireEvent.click(screen.getByRole('button', { name: 'View families' }));
  return screen.findByRole('button', { name: 'Inspect Coral · 4 litre' });
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
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'product_categories.view',
    'product_categories.manage',
    'products.view',
    'companies.read',
    'divisions.read',
  ]);
  state.get.mockImplementation(async (path: string) =>
    path === '/product-categories/paint'
      ? category
      : path === '/products/families'
        ? { data: [family], total: 41 }
        : { data: [category], total: 41, counts: { active: 32, inactive: 9, total: 41 } },
  );
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [{ id: 'company', name: 'Example Company' }]
        : path === '/divisions'
          ? [{ id: 'division', name: 'Building supplies' }]
          : path === '/product-categories'
            ? [category, { ...category, id: 'parent', name: 'Finishes', parentCategoryId: null }]
            : [
                {
                  id: 'product',
                  name: 'Coral white',
                  productCode: 'P-1',
                  defaultSellingPrice: '19000',
                  effectiveSellingPrice: '19000',
                  wholesalePrice: '16000',
                  retailPrice: '20000',
                  priceSource: 'PRODUCT_OVERRIDE',
                },
              ],
    total: path === '/product-categories' ? 2 : 1,
  }));
  state.post.mockResolvedValue({ id: 'created', name: 'New parent' });
  state.patch.mockResolvedValue({});
  state.remove.mockResolvedValue({});
  state.pdf.mockResolvedValue(undefined);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});

describe('catalogue workspace', () => {
  it('separates category reading, family reading, management and directory permissions', async () => {
    state.permissions.clear();
    const ui = mount();
    expect(await screen.findByText('Your role cannot view product categories.')).toBeVisible();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    state.permissions.add('product_categories.view');
    ui.rerender(
      <UnsavedWorkProvider>
        <CatalogueWorkspace />
      </UnsavedWorkProvider>,
    );
    await inspect();
    expect(screen.queryByRole('button', { name: 'View families' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New category' })).not.toBeInTheDocument();
    expect(state.page).not.toHaveBeenCalled();
    state.permissions.add('operations.dashboard.view');
    ui.rerender(
      <UnsavedWorkProvider>
        <CatalogueWorkspace />
      </UnsavedWorkProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'View families' }));
    await screen.findByRole('button', { name: 'Inspect Coral · 4 litre' });
  });
  it('uses server totals, preserves category details and combines paginated filters', async () => {
    const user = userEvent.setup();
    mount();
    await inspect();
    expect(screen.getByText('32')).toBeVisible();
    expect(screen.getByText('Interior and exterior finishes.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await user.selectOptions(screen.getByLabelText('Type filter'), 'HARDWARE');
    await user.selectOptions(screen.getByLabelText('Status filter'), 'false');
    await user.type(screen.getByPlaceholderText('Search categories…'), 'paint');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/product-categories',
        expect.objectContaining({
          query: expect.objectContaining({
            companyId: 'company',
            search: 'paint',
            categoryType: 'HARDWARE',
            isActive: 'false',
            page: 1,
          }),
        }),
      ),
    );
    await screen.findByRole('button', { name: 'Inspect Paints' });
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/product-categories',
        expect.objectContaining({ query: expect.objectContaining({ page: 2, isActive: 'false' }) }),
      ),
    );
  });
  it('cancels stale reads and retries failed reads without retaining old records', async () => {
    let resolve!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    mount();
    const signal = state.get.mock.calls[0][1].signal as AbortSignal;
    fireEvent.change(screen.getByPlaceholderText('Search categories…'), {
      target: { value: 'missing' },
    });
    state.get.mockRejectedValueOnce(new Error('Read failed'));
    await screen.findByText('Read failed');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve({ data: [category], total: 1 }));
    expect(screen.queryByRole('button', { name: 'Inspect Paints' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Inspect Paints' });
  });
  it('exports every matching page and refuses oversized PDF without truncating', async () => {
    state.page.mockImplementation(async (path: string, options: { query: { page: number } }) =>
      path === '/companies'
        ? { data: [], total: 0 }
        : {
            data: [
              {
                ...category,
                name: options.query.page === 1 ? 'First export page' : 'Last export page',
              },
            ],
            total: 2,
          },
    );
    mount();
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() =>
      expect(state.download).toHaveBeenCalledWith(
        'product-categories.csv',
        'text/csv',
        expect.stringContaining('Last export page'),
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await waitFor(() =>
      expect(state.pdf).toHaveBeenCalledWith(
        expect.objectContaining({
          rows: expect.arrayContaining([expect.arrayContaining(['Last export page'])]),
        }),
      ),
    );
    state.page.mockResolvedValue({
      data: Array.from({ length: 5001 }, (_, i) => ({ ...category, id: String(i) })),
      total: 5001,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('PDF supports up to 5,000');
    expect(state.pdf).toHaveBeenCalledTimes(1);
  });
  it('retains category drafts through Stay and failed saves, clears parent and description explicitly', async () => {
    const user = userEvent.setup(),
      saved = vi.fn();
    state.patch.mockRejectedValueOnce(new Error('Save failed'));
    mount(
      <CategoryEditor record={category} companyId="company" onClose={vi.fn()} onSaved={saved} />,
    );
    await waitFor(() => expect(screen.getByLabelText('Parent category')).toBeEnabled());
    await user.clear(screen.getByLabelText('Description'));
    await user.selectOptions(screen.getByLabelText('Parent category'), '');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await screen.findByText('Save failed');
    expect(screen.getByLabelText('Description')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.patch).toHaveBeenLastCalledWith('/product-categories/paint', {
      parentCategoryId: null,
      description: null,
    });
  });
  it('reuses a created parent after child save fails instead of creating another parent', async () => {
    const user = userEvent.setup(),
      saved = vi.fn();
    state.post
      .mockResolvedValueOnce({ id: 'new-parent', name: 'Finishing materials' })
      .mockRejectedValueOnce(new Error('Child failed'))
      .mockResolvedValueOnce({});
    mount(<CategoryEditor companyId="company" onClose={vi.fn()} onSaved={saved} />);
    await user.type(screen.getByLabelText(/Category name/), ' Paints two ');
    await waitFor(() => expect(screen.getByLabelText('Parent category')).toBeEnabled());
    await user.selectOptions(screen.getByLabelText('Parent category'), '__new__');
    await user.type(screen.getByLabelText(/New parent name/), 'Finishing materials');
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await screen.findByText('Child failed');
    expect(screen.getByLabelText(/^Company/)).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.post).toHaveBeenCalledTimes(3);
    expect(state.post.mock.calls[2][1]).toMatchObject({
      name: 'Paints two',
      companyId: 'company',
      parentCategoryId: 'new-parent',
    });
  });
  it('loads complete parent choices and retries a later-page failure without partial choices', async () => {
    let failed = true;
    state.page.mockImplementation(async (path: string, options: { query: { page: number } }) => {
      if (path !== '/product-categories') return { data: [], total: 0 };
      if (options.query.page === 2 && failed) throw new Error('Second page failed');
      return {
        data: [
          {
            ...category,
            id: `choice-${options.query.page}`,
            name: `Parent page ${options.query.page}`,
          },
        ],
        total: 2,
      };
    });
    mount(<CategoryEditor companyId="company" onClose={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText(/Second page failed/);
    expect(screen.queryByRole('option', { name: 'Parent page 1' })).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry parent category choices' }));
    await screen.findByRole('option', { name: 'Parent page 2' });
  });
  it('keeps named delete failures in the dialog and retries the same category', async () => {
    state.remove.mockRejectedValueOnce(new Error('Category is in use'));
    mount();
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Delete category' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Paints')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete category' }));
    await screen.findByText('Category is in use');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete category' }));
    await screen.findByText('Category deleted.');
    expect(state.remove).toHaveBeenCalledTimes(2);
  });
  it('confirms status changes and preserves the existing API operation', async () => {
    mount();
    await inspect();
    fireEvent.click(screen.getByRole('button', { name: 'Deactivate category' }));
    expect(state.patch).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate category' }),
    );
    await screen.findByText('Category status updated.');
    expect(state.patch).toHaveBeenCalledWith('/product-categories/paint', { isActive: false });
  });
  it('uses embedded company/search scope and includes company-wide families in division reads', async () => {
    mount(
      <InventoryWorkspaceProvider
        scope={{ companyId: 'company', divisionId: 'division', branchId: '' }}
        searchQuery="paint"
      >
        <CatalogueWorkspace />
      </InventoryWorkspaceProvider>,
    );
    await inspect();
    expect(state.get).toHaveBeenCalledWith(
      '/product-categories',
      expect.objectContaining({
        query: expect.objectContaining({ companyId: 'company', search: 'paint' }),
      }),
    );
    expect(screen.queryByLabelText('Company filter')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New category' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'View families' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Coral · 4 litre' }));
    expect(state.get).toHaveBeenLastCalledWith(
      '/products/families',
      expect.objectContaining({
        query: expect.objectContaining({
          companyId: 'company',
          categoryId: 'paint',
          divisionId: 'division',
          limit: 20,
        }),
      }),
    );
    expect(screen.getByText('Inherited')).toBeVisible();
    expect(screen.getByText('Missing prices')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/products/families',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
  });
  it('edits family prices with validation, draft protection and changed fields only', async () => {
    const user = userEvent.setup(),
      saved = vi.fn();
    state.patch.mockRejectedValueOnce(new Error('Family save failed'));
    mount(<FamilyEditor category={category} record={family} onClose={vi.fn()} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText('Selling price'), { target: { value: '11000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save family' }));
    await screen.findByText('Selling price must be greater than family purchase price.');
    expect(state.patch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Selling price'), { target: { value: '21000' } });
    await user.clear(screen.getByLabelText('Brand'));
    await user.clear(screen.getByLabelText('Wholesale price'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save family' }));
    await screen.findByText('Family save failed');
    expect(screen.getByLabelText('Selling price')).toHaveValue(21000);
    fireEvent.click(screen.getByRole('button', { name: 'Save family' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.patch).toHaveBeenLastCalledWith('/products/families/family', {
      brand: null,
      defaultSellingPrice: 21000,
      wholesalePrice: null,
    });
  });
  it('creates a scoped family and keeps zero distinct from an empty default', async () => {
    const saved = vi.fn();
    mount(
      <FamilyEditor category={category} divisionId="division" onClose={vi.fn()} onSaved={saved} />,
    );
    fireEvent.change(screen.getByLabelText(/Family name/), { target: { value: ' 10 litre ' } });
    fireEvent.change(screen.getByLabelText('Purchase price'), { target: { value: '0' } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save family' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Save family' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(state.post).toHaveBeenCalledWith(
      '/products/families',
      expect.objectContaining({
        companyId: 'company',
        categoryId: 'paint',
        divisionId: 'division',
        name: '10 litre',
        defaultPurchasePrice: 0,
        defaultSellingPrice: null,
      }),
    );
  });
  it('reviews every product page, includes wholesale differences and missing prices, and retries read failures', async () => {
    let failed = true;
    state.page.mockImplementation(async (_path: string, options: { query: { page: number } }) => {
      if (failed) throw new Error('Price read failed');
      return {
        data:
          options.query.page === 1
            ? [{ id: 'inherited', name: 'Inherited white', priceSource: 'FAMILY_DEFAULT' }]
            : [
                {
                  id: 'wholesale',
                  name: 'Wholesale exception',
                  priceSource: 'PRODUCT_OVERRIDE',
                  wholesalePrice: 17000,
                  defaultSellingPrice: 18000,
                },
                {
                  id: 'missing',
                  name: 'No defaults',
                  priceSource: 'MISSING',
                  defaultSellingPrice: 0,
                },
              ],
        total: 3,
      };
    });
    mount(<PriceReview category={category} family={family} onClose={vi.fn()} />);
    await screen.findByText(/Price read failed/);
    expect(
      screen.queryByText('No price exceptions found for this family.'),
    ).not.toBeInTheDocument();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry price review' }));
    await screen.findByText('Wholesale exception');
    expect(screen.getByText('No defaults')).toBeVisible();
    expect(screen.queryByText('Inherited white')).not.toBeInTheDocument();
    expect(screen.getByText('TZS 0.00')).toBeVisible();
    expect(screen.getByText('Products to review: 2 of 3.')).toBeVisible();
  });
  it('captures populated category, family, editor and price review layouts', async () => {
    state.get.mockImplementation(async (path: string) =>
      path === '/products/families'
        ? { data: [family], total: 1 }
        : {
            data: [
              category,
              {
                ...category,
                id: 'parent',
                name: 'Finishes',
                parentCategoryId: null,
                parentCategory: null,
              },
            ],
            total: 2,
            counts: { active: 2, inactive: 0, total: 2 },
          },
    );
    const choices = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (path: string, options: unknown) => {
      const result = await choices(path, options);
      return path === '/products'
        ? {
            data: [
              ...result.data,
              {
                id: 'inherited',
                name: 'Coral blue',
                priceSource: 'FAMILY_DEFAULT',
                effectiveSellingPrice: 18000,
              },
            ],
            total: 2,
          }
        : result;
    });
    mount();
    await inspect();
    capture('catalogue-categories');
    fireEvent.click(screen.getByRole('button', { name: 'Edit category' }));
    await waitFor(() => expect(screen.getByLabelText('Parent category')).toBeEnabled());
    capture('catalogue-category-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'View families' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect Coral · 4 litre' }));
    capture('catalogue-families');
    fireEvent.click(screen.getByRole('button', { name: 'Edit family' }));
    await waitFor(() => expect(screen.getByLabelText('Division')).toBeEnabled());
    capture('catalogue-family-editor');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review product prices' }));
    await screen.findByText('Coral white');
    capture('catalogue-price-review');
  });
});

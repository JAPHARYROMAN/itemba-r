import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProductEditor } from './product-editor';
import { productBody, productForm } from './product-form';
import { UnsavedWorkProvider } from './unsaved-work-provider';
import type { Product } from './product-types';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { companyId: 'company' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
  backendDelete: state.remove,
  backendUpload: state.upload,
}));
const family = {
  id: 'family',
  name: '4 litre',
  brand: 'Coral',
  categoryId: 'paint',
  divisionId: null,
  defaultPurchasePrice: '12000',
  defaultSellingPrice: '18000',
  wholesalePrice: '16000',
  retailPrice: '20000',
};
const product: Product = {
  id: 'product',
  companyId: 'company',
  company: { name: 'Example Company' },
  divisionId: null,
  name: 'Coral white',
  productCode: 'P-01',
  categoryId: 'paint',
  category: { name: 'Paints' },
  productType: 'STOCK_ITEM',
  baseUnitId: 'unit',
  baseUnit: { name: 'Litre', symbol: 'L' },
  status: 'ACTIVE',
  trackInventory: true,
  trackBatch: false,
  trackExpiry: false,
  productFamilyId: 'family',
  productFamily: family,
  defaultPurchasePrice: '12000',
  defaultSellingPrice: '19000',
  wholesalePrice: '17000',
  retailPrice: '21000',
  description: 'Washable interior finish',
  purchaseUnitId: 'unit',
  sku: 'COR-W',
  taxRate: 18,
  isTaxable: true,
};
const mount = (props: Partial<React.ComponentProps<typeof ProductEditor>> = {}) =>
  render(
    <UnsavedWorkProvider>
      <ProductEditor record={product} onClose={vi.fn()} onSaved={vi.fn()} {...props} />
    </UnsavedWorkProvider>,
  );
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label, { exact: false }), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save product' }));
async function ready() {
  await waitFor(() => expect(screen.getByLabelText('Product family')).not.toBeDisabled());
}
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const clone = document.body.cloneNode(true) as HTMLElement;
  document.querySelectorAll('input').forEach((input, i) => {
    const copy = clone.querySelectorAll('input')[i];
    if (input.type === 'checkbox') {
      if (input.checked) copy.setAttribute('checked', '');
      else copy.removeAttribute('checked');
    } else if (input.type !== 'file') copy.setAttribute('value', input.value);
  });
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
    'products.view',
    'products.create',
    'products.update',
    'companies.read',
    'divisions.read',
    'product_categories.view',
    'units.view',
  ]);
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [{ id: 'company', name: 'Example Company' }]
        : path === '/divisions'
          ? [{ id: 'division', name: 'Building supplies' }]
          : path === '/product-categories'
            ? [{ id: 'paint', name: 'Paints' }]
            : path === '/units'
              ? [{ id: 'unit', name: 'Litre', symbol: 'L' }]
              : [
                  family,
                  { ...family, id: 'small', name: '1 litre' },
                  {
                    ...family,
                    id: 'division-only',
                    divisionId: 'division',
                    name: 'Division family',
                  },
                ],
    total: path === '/products/families' ? 3 : 1,
  }));
  state.post.mockResolvedValue(product);
  state.patch.mockResolvedValue(product);
  state.remove.mockResolvedValue({});
  state.upload.mockResolvedValue({ imageUrl: '/product.png' });
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

describe('product editor', () => {
  it('preserves company-wide scope, sends only changed fields and explicitly clears optional data', async () => {
    const saved = vi.fn();
    mount({ divisionId: 'division', onSaved: saved });
    await ready();
    expect(screen.getByLabelText('Division')).toHaveValue('');
    change('Description', '');
    change('SKU', '');
    change('Purchase unit', '');
    fireEvent.click(screen.getByLabelText('Taxable product'));
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', {
        description: null,
        sku: null,
        purchaseUnitId: null,
        isTaxable: false,
        taxRate: null,
      }),
    );
    expect(saved).toHaveBeenCalledWith(product);
  });
  it('protects a draft on Cancel and preserves input through a failed save and retry', async () => {
    const close = vi.fn();
    mount({ onClose: close });
    await ready();
    change('Product name', 'Coral ivory');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Keep your changes?')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(close).not.toHaveBeenCalled();
    state.patch.mockRejectedValueOnce(new Error('Save unavailable'));
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('Save unavailable');
    expect(screen.getByLabelText('Product name', { exact: false })).toHaveValue('Coral ivory');
    save();
    await waitFor(() => expect(state.patch).toHaveBeenCalledTimes(2));
    expect(state.patch).toHaveBeenLastCalledWith('/products/product', { name: 'Coral ivory' });
  });
  it('clears only selling overrides when inheritance is enabled and rejects invalid stock margins', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByLabelText('Inherit family selling prices'));
    expect(screen.getByLabelText('Selling price (TZS)')).toBeDisabled();
    expect(screen.getByLabelText('Selling price (TZS)')).toHaveValue(18000);
    expect(screen.getByLabelText('Wholesale price (TZS)')).toHaveValue(16000);
    expect(screen.getByText('Estimated gross margin · 33.3%', { exact: false })).toBeVisible();
    change('Purchase price (TZS)', '19000');
    save();
    expect(await screen.findByRole('alert')).toHaveTextContent('inherited family selling price');
    expect(state.patch).not.toHaveBeenCalled();
    change('Purchase price (TZS)', '12000');
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', {
        defaultSellingPrice: null,
        wholesalePrice: null,
        retailPrice: null,
      }),
    );
  });
  it('loads every family page and limits generated variants to the matching scope', async () => {
    const normal = state.page.getMockImplementation()!;
    state.page.mockImplementation(async (path, options) =>
      path === '/products/families'
        ? {
            data:
              options.query.page === 1
                ? [family]
                : [
                    { ...family, id: 'small', name: '1 litre' },
                    {
                      ...family,
                      id: 'division-only',
                      name: 'Division family',
                      divisionId: 'division',
                    },
                  ],
            total: 3,
          }
        : normal(path, options),
    );
    const saved = vi.fn();
    mount({ record: undefined, onSaved: saved });
    await waitFor(() =>
      expect(screen.getByLabelText('Category', { exact: false })).not.toBeDisabled(),
    );
    change('Category', 'paint');
    await ready();
    change('Product name', 'Coral white');
    change('Base unit', 'unit');
    change('Product family', 'family');
    expect(screen.queryByRole('option', { name: /Division family/ })).not.toBeInTheDocument();
    expect(
      screen.getByText('1 other active family in this category and scope.', { exact: false }),
    ).toBeVisible();
    const result = {
      ...product,
      generatedFamilyProducts: [],
      skippedFamilyProducts: [
        { productFamilyId: 'small', familyName: '1 litre', reason: 'Existing variant' },
      ],
    };
    state.post.mockResolvedValue(result);
    save();
    await waitFor(() => expect(state.post).toHaveBeenCalled());
    expect(state.post.mock.calls[0][1]).toMatchObject({
      companyId: 'company',
      productFamilyId: 'family',
      createFamilyVariants: true,
      defaultPurchasePrice: 12000,
      defaultSellingPrice: null,
    });
    expect(saved).toHaveBeenCalledWith(result);
    expect(
      state.page.mock.calls.some(
        ([path, options]) => path === '/products/families' && options.query.page === 2,
      ),
    ).toBe(true);
  });
  it('exposes failed family reads with retry without presenting partial choices', async () => {
    const normal = state.page.getMockImplementation()!;
    let failed = true;
    state.page.mockImplementation(async (path, options) => {
      if (path !== '/products/families') return normal(path, options);
      if (options.query.page === 1) return { data: [family], total: 2 };
      if (failed) throw new Error('Second page failed');
      return { data: [{ ...family, id: 'small', name: '1 litre' }], total: 2 };
    });
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('Second page failed');
    expect(screen.getByLabelText('Product family')).toBeDisabled();
    failed = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry family choices' }));
    await ready();
    expect(screen.getByRole('option', { name: 'Coral · 1 litre' })).toBeInTheDocument();
  });
  it('keeps product update separate from create and directory permissions', async () => {
    state.permissions = new Set(['products.create']);
    mount();
    expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
    expect(screen.getByLabelText('Product image')).toBeDisabled();
    expect(state.page).not.toHaveBeenCalled();
    save();
    expect(state.patch).not.toHaveBeenCalled();
  });
  it('allows updating existing data without unrelated directory permissions', async () => {
    state.permissions = new Set(['products.update']);
    mount();
    change('Description', 'Updated finish');
    save();
    await waitFor(() =>
      expect(state.patch).toHaveBeenCalledWith('/products/product', {
        description: 'Updated finish',
      }),
    );
    expect(state.page).not.toHaveBeenCalled();
  });
  it('creates a family inline and keeps variant, unit, stock and tax fields', async () => {
    mount();
    await ready();
    change('Product family', '__new__');
    change('New family name', '10 litre');
    change('Family brand', 'Coral');
    change('Colour', 'Ivory');
    change('Size', '10 L');
    change('Finish', 'Matt');
    change('Variant name', 'Premium');
    change('Sales unit', 'unit');
    change('Minimum stock', '0');
    change('Maximum stock', '150.5');
    change('Reorder level', '20');
    fireEvent.click(screen.getByLabelText('Track batches'));
    fireEvent.click(screen.getByLabelText('Track expiry dates'));
    save();
    await waitFor(() => expect(state.patch).toHaveBeenCalled());
    expect(state.patch.mock.calls[0][1]).toEqual({
      productFamilyName: '10 litre',
      productFamilyBrand: 'Coral',
      variantColor: 'Ivory',
      variantSize: '10 L',
      variantFinish: 'Matt',
      variantName: 'Premium',
      salesUnitId: 'unit',
      minimumStockLevel: 0,
      maximumStockLevel: 150.5,
      reorderLevel: 20,
      trackBatch: true,
      trackExpiry: true,
    });
  });
  it('saves images independently, validates files and retains the form when an image fails', async () => {
    const changed = vi.fn();
    mount({ record: { ...product, imageUrl: '/existing.png' }, onImageChanged: changed });
    await ready();
    const input = screen.getByLabelText('Product image');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'image.svg', { type: 'image/svg+xml' })] },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('PNG, JPEG or WebP');
    expect(state.upload).not.toHaveBeenCalled();
    fireEvent.change(input, {
      target: {
        files: [
          new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
        ],
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('2 MB');
    change('Description', 'Unsaved draft');
    state.upload.mockRejectedValueOnce(new Error('Upload unavailable'));
    const image = new File(['png'], 'paint.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [image] } });
    expect(state.upload).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Upload unavailable');
    expect(screen.getByLabelText('Description')).toHaveValue('Unsaved draft');
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    expect(await screen.findByText('Image saved.')).toBeVisible();
    expect(state.upload.mock.calls[1][1].get('file')).toBe(image);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(state.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(state.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm image removal' }));
    expect(await screen.findByText('Image removed.')).toBeVisible();
    expect(state.remove).toHaveBeenCalledWith('/products/product/image');
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it('blocks dismissal and duplicate image writes while an upload is pending', async () => {
    const close = vi.fn();
    let finish!: (value: { imageUrl: string }) => void;
    state.upload.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    mount({ onClose: close });
    await ready();
    fireEvent.change(screen.getByLabelText('Product image'), {
      target: { files: [new File(['png'], 'paint.png', { type: 'image/png' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save image' }));
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save product' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish({ imageUrl: '/new.png' }));
    expect(screen.getByRole('button', { name: 'Save product' })).not.toBeDisabled();
  });
  it('captures the grouped editor with inherited prices for visual review', async () => {
    mount();
    await ready();
    fireEvent.click(screen.getByLabelText('Inherit family selling prices'));
    capture('product-editor');
    expect(screen.getByRole('group', { name: 'Identity & organisation' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Family & variant' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Prices & tax' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Units & inventory' })).toBeInTheDocument();
  });
});
describe('product validation contracts', () => {
  it('distinguishes blank numeric data, zero and optional clears without rewriting untouched values', () => {
    const initial = productForm({
      ...product,
      isTaxable: false,
      taxRate: 18,
      minimumStockLevel: 0,
    });
    expect(productBody(initial, initial, true, family)).toEqual({});
    expect(productBody({ ...initial, minimumStockLevel: '' }, initial, true, family)).toEqual({
      minimumStockLevel: null,
    });
    expect(() =>
      productBody({ ...initial, defaultPurchasePrice: '' }, initial, true, family),
    ).toThrow('purchase price greater than zero');
    expect(() =>
      productBody({ ...initial, defaultSellingPrice: '10000' }, initial, true, family),
    ).toThrow('greater than purchase price');
    expect(() =>
      productBody({ ...initial, reorderLevel: 'Infinity' }, initial, true, family),
    ).toThrow('finite');
    expect(() => productBody({ ...initial, productCode: '' }, initial, true, family)).toThrow(
      'cannot be cleared',
    );
  });
  it('applies inherited-price validation even when zero overrides implicitly inherit', () => {
    const initial = productForm(product);
    expect(() =>
      productBody(
        {
          ...initial,
          defaultSellingPrice: '0',
          wholesalePrice: '',
          retailPrice: '',
          defaultPurchasePrice: '19000',
        },
        initial,
        true,
        family,
      ),
    ).toThrow('inherited family selling price');
    expect(
      productBody(
        { ...initial, productType: 'SERVICE', defaultPurchasePrice: '', defaultSellingPrice: '0' },
        initial,
        true,
        family,
      ),
    ).toMatchObject({ productType: 'SERVICE', defaultPurchasePrice: null, defaultSellingPrice: 0 });
  });
});

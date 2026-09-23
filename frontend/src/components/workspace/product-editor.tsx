'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Image from 'next/image';
import { Btn, FileUpload, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendDelete, backendPatch, backendPost, backendUpload } from '@/lib/api-client';
import { DraftFormNotice, type WorkspaceDraft } from './workspace-drafts';
import { useInventoryDefinitionForm } from '@/features/inventory/inventory-definition-form';
import { CatalogueChoiceError } from './catalogue-editors';
import {
  familySelling,
  productBody,
  productForm,
  productLabel,
  productQuantity,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  type ProductForm,
} from './product-form';
import type {
  Category,
  Company,
  Division,
  Product,
  ProductCreateResponse,
  ProductFamily,
  Unit,
} from './product-types';
import './catalogue-workspace.css';
import './product-workspace.css';

export function ProductEditor({
  record,
  draftSource,
  companyId = '',
  divisionId = '',
  onClose,
  onSaved,
  onImageChanged,
}: {
  record?: Product;
  draftSource?: WorkspaceDraft;
  companyId?: string;
  divisionId?: string;
  onClose: () => void;
  onSaved: (result: ProductCreateResponse) => void;
  onImageChanged?: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const [initial] = useState(() => ({
    ...productForm(record, companyId || user?.companyId || '', divisionId),
    newFamily: false,
    imageFile: null as File | null,
    removeImage: false,
  }));
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [imageUrl, setImageUrl] = useState(record?.imageUrl);
  const [imageVersion, setImageVersion] = useState(() => Date.now());
  const [imageBusy, setImageBusy] = useState(false),
    [imageError, setImageError] = useState(''),
    [imageNotice, setImageNotice] = useState('');
  const saving = busy || imageBusy;
  const draft = useInventoryDefinitionForm({
    baseline: initial,
    kind: 'product',
    title: record ? 'Edit product' : 'New product',
    describe: (values) =>
      [
        values.name || record?.name || 'Product',
        values.imageFile ? 'image selected' : values.removeImage ? 'image removal' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    record,
    source: draftSource,
    busy: saving,
    onClose,
    context: {
      family: JSON.stringify(record?.productFamily || null),
      imageUrl: record?.imageUrl || '',
    },
  });
  const { form, setForm } = draft;
  const newFamily = form.newFamily;
  const pending = useRef(false),
    mounted = useRef(true),
    id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [imagePreview, setImagePreview] = useState('');
  useEffect(() => {
    if (!form.imageFile || !URL.createObjectURL) {
      setImagePreview('');
      return;
    }
    const url = URL.createObjectURL(form.imageFile);
    setImagePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [form.imageFile]);
  const hasImageChange = !!form.imageFile || form.removeImage;
  const allowed = hasPermission(record ? 'products.update' : 'products.create');
  const canReadFamilies =
    hasPermission('products.view') || hasPermission('operations.dashboard.view');
  const companies = useWorkspaceChoices<Company>(
    '/companies',
    {},
    !record && hasPermission('companies.read'),
  );
  const divisions = useWorkspaceChoices<Division>(
    '/divisions',
    { companyId: form.companyId },
    !!form.companyId && hasPermission('divisions.read'),
  );
  const categories = useWorkspaceChoices<Category>(
    '/product-categories',
    { companyId: form.companyId },
    !!form.companyId && hasPermission('product_categories.view'),
  );
  const units = useWorkspaceChoices<Unit>(
    '/units',
    { companyId: form.companyId || undefined, status: 'ACTIVE' },
    !!form.companyId && hasPermission('units.view'),
  );
  const families = useWorkspaceChoices<ProductFamily>(
    '/products/families',
    {
      companyId: form.companyId,
      categoryId: form.categoryId,
      divisionId: form.divisionId || undefined,
      isActive: true,
    },
    !!form.companyId && !!form.categoryId && canReadFamilies,
  );
  // A company-wide product cannot use division-specific families. The API's
  // unfiltered family list includes those families, so scope the picker explicitly.
  const scopedFamilies = families.rows.filter(
    (f) => !f.divisionId || f.divisionId === form.divisionId,
  );
  const family =
    scopedFamilies.find((f) => f.id === form.productFamilyId) ||
    (record?.productFamilyId === form.productFamilyId &&
    record.categoryId === form.categoryId &&
    (record.divisionId || '') === form.divisionId
      ? record?.productFamily
      : undefined);
  const siblings = scopedFamilies.filter((f) => f.id !== form.productFamilyId);
  const purchaseCost = Number(
    form.defaultPurchasePrice ||
      (record && form.defaultPurchasePrice !== initial.defaultPurchasePrice
        ? 0
        : family?.defaultPurchasePrice) ||
      0,
  );
  const sellingPrice = form.useFamilyPrice
    ? familySelling(family)
    : familySelling({
        defaultSellingPrice: form.defaultSellingPrice,
        retailPrice: form.retailPrice,
        wholesalePrice: form.wholesalePrice,
      }) || familySelling(family);
  const margin =
    Number.isFinite(purchaseCost) && purchaseCost > 0 && sellingPrice > 0
      ? ((sellingPrice - purchaseCost) / sellingPrice) * 100
      : null;
  const change = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm((p) => ({ ...p, [key]: value }));
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const chooseFamily = (value: string) => {
    const selected = scopedFamilies.find((f) => f.id === value);
    setForm((p) => ({
      ...p,
      newFamily: value === '__new__',
      productFamilyId: selected?.id || '',
      productFamilyName: '',
      productFamilyBrand: '',
      useFamilyPrice: !!selected && familySelling(selected) > 0,
      ...(selected
        ? {
            defaultPurchasePrice:
              selected.defaultPurchasePrice == null ? '' : String(selected.defaultPurchasePrice),
            defaultSellingPrice: '',
            wholesalePrice: '',
            retailPrice: '',
          }
        : {}),
    }));
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending.current || !allowed) return;
    pending.current = true;
    setError('');
    try {
      draft.validateReview();
      await draft.saveNow();
      if (hasImageChange)
        throw new Error('Save or discard the selected image change before saving the product.');
      if (
        !record &&
        (hasPermission('companies.read')
          ? companies.loading ||
            !!companies.error ||
            !companies.rows.some((c) => c.id === form.companyId)
          : form.companyId !== user?.companyId)
      )
        throw new Error('Choose an available company before saving.');
      const checkChoice = (
        key:
          | 'divisionId'
          | 'categoryId'
          | 'productFamilyId'
          | 'baseUnitId'
          | 'purchaseUnitId'
          | 'salesUnitId',
        label: string,
        choices: { rows: { id: string }[]; loading: boolean; error: string },
        canRead: boolean,
      ) => {
        if (!form[key] || (record && form[key] === initial[key])) return;
        if (
          !canRead ||
          choices.loading ||
          choices.error ||
          !choices.rows.some((row) => row.id === form[key])
        )
          throw new Error(`Choose an available ${label} before saving. Your draft is still kept.`);
      };
      checkChoice('divisionId', 'division', divisions, hasPermission('divisions.read'));
      checkChoice('categoryId', 'category', categories, hasPermission('product_categories.view'));
      if (!newFamily)
        checkChoice(
          'productFamilyId',
          'product family',
          { ...families, rows: scopedFamilies },
          canReadFamilies,
        );
      for (const key of ['baseUnitId', 'purchaseUnitId', 'salesUnitId'] as const)
        checkChoice(key, 'unit', units, hasPermission('units.view'));
      if (newFamily && !form.productFamilyName.trim())
        throw new Error('Enter a name for the new family.');
      if (
        !record &&
        form.createFamilyVariants &&
        form.productFamilyId &&
        (families.loading || families.error || !canReadFamilies)
      )
        throw new Error(
          'Load family choices before creating all family sizes, or turn off that option.',
        );
      const body = productBody(form, initial, !!record, family, siblings.length);
      setBusy(true);
      const result = record
        ? await backendPatch<ProductCreateResponse>(`/products/${record.id}`, body)
        : await backendPost<ProductCreateResponse>('/products', body);
      if (mounted.current) {
        draft.markSaved();
        onSaved(result);
      }
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : 'Unable to save this product.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const selectImage = (files: FileList | null) => {
    if (!record || !allowed || pending.current) return;
    const file = files?.[0];
    if (!file) return;
    setImageError('');
    setImageNotice('');
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
      return setImageError('Use a PNG, JPEG or WebP image.');
    if (file.size > 2 * 1024 * 1024)
      return setImageError('Product images must be 2 MB or smaller.');
    draft.guard.change(() => setForm((p) => ({ ...p, imageFile: file, removeImage: false })));
  };
  const imageAction = async () => {
    if (!record || !allowed || pending.current || !hasImageChange) return;
    setImageError('');
    setImageNotice('');
    // Claimed synchronously. saveNow() below awaits, and a second click inside
    // that window would otherwise clear the guard above and upload twice.
    pending.current = true;
    setImageBusy(true);
    try {
      draft.validateReview();
      await draft.saveNow();
      if (form.imageFile) {
        const data = new FormData();
        data.append('file', form.imageFile);
        const result = await backendUpload<{ imageUrl: string }>(
          `/products/${record.id}/image`,
          data,
        );
        if (mounted.current) setImageUrl(result.imageUrl);
      } else {
        await backendDelete(`/products/${record.id}/image`);
        if (mounted.current) setImageUrl(null);
      }
      if (mounted.current) {
        setImageVersion(Date.now());
        setImageNotice(form.imageFile ? 'Image saved.' : 'Image removed.');
        setForm((p) => ({ ...p, imageFile: null, removeImage: false }));
        const hasProductChanges = (Object.keys(initial) as Array<keyof typeof initial>).some(
          (key) => key !== 'imageFile' && key !== 'removeImage' && form[key] !== initial[key],
        );
        if (!hasProductChanges) draft.markSaved();
        onImageChanged?.();
      }
    } catch (err) {
      if (mounted.current)
        setImageError(err instanceof Error ? err.message : 'Unable to update the image.');
    } finally {
      pending.current = false;
      if (mounted.current) setImageBusy(false);
    }
  };
  const text = (key: keyof ProductForm, label: string, required = false) => (
    <FormInput
      label={label}
      value={String(form[key])}
      required={required}
      onChange={(e) => change(key, e.target.value)}
    />
  );
  const number = (key: keyof ProductForm, label: string, disabled = false) => (
    <FormInput
      label={label}
      type="number"
      min="0"
      step="any"
      value={String(
        disabled && form.useFamilyPrice
          ? key === 'defaultSellingPrice'
            ? familySelling(family) || ''
            : key === 'wholesalePrice'
              ? (family?.wholesalePrice ?? '')
              : key === 'retailPrice'
                ? (family?.retailPrice ?? '')
                : form[key]
          : form[key],
      )}
      disabled={disabled}
      onChange={(e) => change(key, e.target.value)}
    />
  );
  const checkbox = (
    key:
      | 'isTaxable'
      | 'trackInventory'
      | 'trackBatch'
      | 'trackExpiry'
      | 'useFamilyPrice'
      | 'createFamilyVariants',
    label: string,
    disabled = false,
  ) => (
    <label className="catalogue-check">
      <input
        type="checkbox"
        checked={form[key]}
        disabled={disabled}
        onChange={(e) => change(key, e.target.checked)}
      />
      {label}
    </label>
  );
  const unitSelect = (key: 'baseUnitId' | 'purchaseUnitId' | 'salesUnitId', label: string) => (
    <FormSelect
      label={label}
      required={key === 'baseUnitId'}
      value={form[key]}
      disabled={!hasPermission('units.view') || units.loading || !!units.error}
      onChange={(e) => change(key, e.target.value)}
    >
      <option value="">{key === 'baseUnitId' ? 'Choose a base unit' : 'Not assigned'}</option>
      {form[key] && !units.rows.some((u) => u.id === form[key]) && (
        <option value={form[key]}>
          {record?.[
            key === 'baseUnitId'
              ? 'baseUnit'
              : key === 'purchaseUnitId'
                ? 'purchaseUnit'
                : 'salesUnit'
          ]?.name || form[key]}
        </option>
      )}
      {units.rows.map((u) => (
        <option key={u.id} value={u.id}>
          {u.name} · {u.symbol}
        </option>
      ))}
    </FormSelect>
  );
  return (
    <Modal
      open
      title={record ? 'Edit product' : 'New product'}
      onClose={close}
      size="xl"
      footer={
        <>
          <Btn variant="secondary" disabled={saving} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={saving} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            type="submit"
            form={id}
            loading={busy}
            disabled={imageBusy || !allowed || !draft.reviewed || !!draft.availabilityError}
          >
            Save product
          </Btn>
        </>
      }
    >
      <form
        id={id}
        onSubmit={submit}
        {...draft.guard.capture}
        className="catalogue-editor product-editor"
      >
        <p className="catalogue-help">
          {record
            ? record.name
            : 'Build your catalogue with clear prices, units and stock controls.'}
        </p>
        <DraftFormNotice draft={draft}>
          {record && (
            <p>
              Current product: {record.name} · {productLabel(record.status)} ·{' '}
              {record.category?.name || record.categoryId}. Purchase:{' '}
              {productQuantity(record.defaultPurchasePrice)} TZS. Selling override:{' '}
              {productQuantity(record.defaultSellingPrice)} TZS. Family selling:{' '}
              {productQuantity(familySelling(record.productFamily))} TZS.
            </p>
          )}
        </DraftFormNotice>
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        {!allowed && (
          <p role="alert" className="workspace-notice">
            You do not have permission to {record ? 'edit' : 'create'} products.
          </p>
        )}
        <fieldset disabled={saving || !allowed}>
          <legend>Identity & organisation</legend>
          <div className="catalogue-form-grid">
            <FormSelect
              label="Company"
              required
              value={form.companyId}
              disabled={
                !!record ||
                !hasPermission('companies.read') ||
                companies.loading ||
                !!companies.error
              }
              onChange={(e) => {
                setForm((p) => ({
                  ...p,
                  newFamily: false,
                  companyId: e.target.value,
                  divisionId: '',
                  categoryId: '',
                  productFamilyId: '',
                  productFamilyName: '',
                  productFamilyBrand: '',
                  useFamilyPrice: false,
                }));
              }}
            >
              <option value="">Choose a company</option>
              {form.companyId && !companies.rows.some((c) => c.id === form.companyId) && (
                <option value={form.companyId}>{record?.company?.name || form.companyId}</option>
              )}
              {companies.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Division"
              value={form.divisionId}
              disabled={
                !form.companyId ||
                !hasPermission('divisions.read') ||
                divisions.loading ||
                !!divisions.error
              }
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  divisionId: e.target.value,
                  productFamilyId: '',
                  useFamilyPrice: false,
                }))
              }
            >
              <option value="">Company-wide</option>
              {form.divisionId && !divisions.rows.some((d) => d.id === form.divisionId) && (
                <option value={form.divisionId}>{record?.division?.name || form.divisionId}</option>
              )}
              {divisions.rows.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </FormSelect>
            {text('name', 'Product name', true)}
            {text('productCode', 'Product code')}
            <FormSelect
              label="Category"
              required
              value={form.categoryId}
              disabled={
                !form.companyId ||
                !hasPermission('product_categories.view') ||
                categories.loading ||
                !!categories.error
              }
              onChange={(e) => {
                setForm((p) => ({
                  ...p,
                  newFamily: false,
                  categoryId: e.target.value,
                  productFamilyId: '',
                  productFamilyName: '',
                  productFamilyBrand: '',
                  useFamilyPrice: false,
                }));
              }}
            >
              <option value="">Choose a category</option>
              {form.categoryId && !categories.rows.some((c) => c.id === form.categoryId) && (
                <option value={form.categoryId}>{record?.category?.name || form.categoryId}</option>
              )}
              {categories.rows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </FormSelect>
            <FormSelect
              label="Product type"
              value={form.productType}
              onChange={(e) => change('productType', e.target.value)}
            >
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {productLabel(t)}
                </option>
              ))}
            </FormSelect>
            {text('sku', 'SKU')}
            {text('barcode', 'Barcode')}
            <FormSelect
              label="Status"
              value={form.status}
              onChange={(e) => change('status', e.target.value)}
            >
              {PRODUCT_STATUSES.map((t) => (
                <option key={t} value={t}>
                  {productLabel(t)}
                </option>
              ))}
            </FormSelect>
          </div>
          <CatalogueChoiceError label="Company" source={companies} />
          <CatalogueChoiceError label="Division" source={divisions} />
          <CatalogueChoiceError label="Category" source={categories} />
          <FormTextarea
            label="Description"
            value={form.description}
            onChange={(e) => change('description', e.target.value)}
            rows={3}
          />
        </fieldset>
        <fieldset disabled={saving || !allowed}>
          <legend>Family & variant</legend>
          <FormSelect
            label="Product family"
            value={newFamily ? '__new__' : form.productFamilyId}
            disabled={!form.categoryId || families.loading || !!families.error || !canReadFamilies}
            onChange={(e) => chooseFamily(e.target.value)}
          >
            <option value="">No family</option>
            <option value="__new__">Create a new family…</option>
            {form.productFamilyId && !scopedFamilies.some((f) => f.id === form.productFamilyId) && (
              <option value={form.productFamilyId}>
                {record?.productFamily?.name || form.productFamilyId}
              </option>
            )}
            {scopedFamilies.map((f) => (
              <option key={f.id} value={f.id}>
                {[f.brand, f.name].filter(Boolean).join(' · ')}
              </option>
            ))}
          </FormSelect>
          <CatalogueChoiceError label="Family" source={families} />
          {newFamily && (
            <>
              <div className="catalogue-form-grid">
                {text('productFamilyName', 'New family name', true)}
                {text('productFamilyBrand', 'Family brand')}
              </div>
              <p className="catalogue-help">
                The family is created when you save this product. An existing family with the same
                name and scope is reused.
              </p>
            </>
          )}
          <div className="catalogue-form-grid">
            {text('variantName', 'Variant name')}
            {text('variantColor', 'Colour')}
            {text('variantSize', 'Size')}
            {text('variantFinish', 'Finish')}
          </div>
          {!record && form.productFamilyId && (
            <div className="product-price-note">
              {checkbox('createFamilyVariants', 'Create all family sizes')}
              <p className="catalogue-help">
                {families.loading
                  ? 'Loading family sizes…'
                  : `${siblings.length} other active ${siblings.length === 1 ? 'family' : 'families'} in this category and scope.`}{' '}
                Each generated product uses its family’s prices. Existing variants and families with
                unsuitable prices are skipped.
              </p>
              {siblings.length > 0 && (
                <p className="catalogue-help">
                  {siblings
                    .slice(0, 6)
                    .map((f) => [f.brand, f.name].filter(Boolean).join(' · '))
                    .join(', ')}
                  {siblings.length > 6 ? ` and ${siblings.length - 6} more` : ''}
                </p>
              )}
            </div>
          )}
        </fieldset>
        <fieldset disabled={saving || !allowed}>
          <legend>Prices & tax</legend>
          {checkbox('useFamilyPrice', 'Inherit family selling prices', !form.productFamilyId)}
          {form.useFamilyPrice && (
            <div className="product-price-note">
              <p>
                Family selling price ·{' '}
                {familySelling(family) > 0
                  ? `TZS ${productQuantity(familySelling(family))}`
                  : 'Not set'}
              </p>
              <p className="catalogue-help">
                Saving clears this product’s selling, wholesale and retail overrides. Future changes
                to family prices apply automatically. Purchase cost is managed separately.
              </p>
            </div>
          )}
          <div className="catalogue-form-grid">
            {number('defaultPurchasePrice', 'Purchase price (TZS)')}
            {number('defaultSellingPrice', 'Selling price (TZS)', form.useFamilyPrice)}
            {number('wholesalePrice', 'Wholesale price (TZS)', form.useFamilyPrice)}
            {number('retailPrice', 'Retail price (TZS)', form.useFamilyPrice)}
          </div>
          <p className="catalogue-help">
            Tracked stock needs a positive purchase cost. Any positive selling price must exceed
            that cost. A blank or zero selling override uses the family default when available.
          </p>
          {margin !== null && (
            <p className="product-price-note">
              Estimated gross margin · {margin.toFixed(1)}%
              <span className="catalogue-help">
                Based on the current selling price and purchase cost, before tax and other costs.
              </span>
            </p>
          )}
          {checkbox('isTaxable', 'Taxable product')}
          {form.isTaxable && number('taxRate', 'Tax rate (%)')}
        </fieldset>
        <fieldset disabled={saving || !allowed}>
          <legend>Units & inventory</legend>
          <div className="catalogue-form-grid">
            {unitSelect('baseUnitId', 'Base unit')}
            {unitSelect('purchaseUnitId', 'Purchase unit')}
            {unitSelect('salesUnitId', 'Sales unit')}
          </div>
          <CatalogueChoiceError label="Unit" source={units} />
          {checkbox('trackInventory', 'Track inventory')}
          {checkbox('trackBatch', 'Track batches')}
          {checkbox('trackExpiry', 'Track expiry dates')}
          <div className="catalogue-form-grid">
            {number('minimumStockLevel', 'Minimum stock')}
            {number('maximumStockLevel', 'Maximum stock')}
            {number('reorderLevel', 'Reorder level')}
          </div>
        </fieldset>
      </form>
      <section className="product-image-editor" aria-label="Product photo management">
        <h3>Product image</h3>
        {record ? (
          <>
            <p className="catalogue-help">
              Select an image, then save it when ready. Image changes save separately from product
              details. Keeping a draft retains the selected image for this session; cancelling does
              not undo an image already saved.
            </p>
            {imageError && (
              <p role="alert" className="workspace-notice">
                {imageError}
              </p>
            )}
            {imageNotice && <p role="status">{imageNotice}</p>}
            {imageUrl && (
              <div className="product-image-preview">
                <Image
                  src={`/api/backend/products/${record.id}/image?v=${imageVersion}`}
                  alt={record.name}
                  width={88}
                  height={88}
                  unoptimized
                />
                <Btn
                  variant="secondary"
                  disabled={saving || !allowed}
                  onClick={() => {
                    setImageError('');
                    setImageNotice('');
                    draft.guard.change(() =>
                      setForm((p) => ({ ...p, imageFile: null, removeImage: true })),
                    );
                  }}
                >
                  Remove image
                </Btn>
              </div>
            )}
            <FileUpload
              label="Product image"
              hint="PNG, JPEG or WebP, up to 2 MB. Used on the POS tile."
              accept="image/png,image/jpeg,image/webp"
              disabled={saving || !allowed}
              onChange={selectImage}
            />
            {hasImageChange && (
              <div className="product-price-note" role="status">
                <p>
                  {form.imageFile
                    ? `Selected: ${form.imageFile.name}`
                    : 'The current image will be removed.'}
                </p>
                {imagePreview && (
                  <Image
                    src={imagePreview}
                    alt="Selected product image preview"
                    width={88}
                    height={88}
                    unoptimized
                  />
                )}
                <p className="catalogue-help">
                  Save or discard this image change before saving product details.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Btn
                    variant="secondary"
                    loading={imageBusy}
                    disabled={busy || !allowed || !draft.reviewed || !!draft.availabilityError}
                    onClick={() => void imageAction()}
                  >
                    {form.removeImage ? 'Confirm image removal' : 'Save image'}
                  </Btn>
                  <Btn
                    variant="ghost"
                    disabled={saving}
                    onClick={() => {
                      setForm((p) => ({ ...p, imageFile: null, removeImage: false }));
                      setImageError('');
                    }}
                  >
                    Discard image change
                  </Btn>
                </div>
              </div>
            )}
            {imageBusy && <p role="status">Saving image…</p>}
          </>
        ) : (
          <p className="catalogue-help">
            Save the product first, then add its image from Edit product.
          </p>
        )}
      </section>
    </Modal>
  );
}

'use client';
import { useId, useRef, useState } from 'react';
import { Btn, FormInput, FormSelect, FormTextarea, Modal } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspaceChoices } from '@/hooks/use-workspace-choices';
import { backendDelete, backendPatch, backendPost } from '@/lib/api-client';
import { DraftFormNotice, type WorkspaceDraft } from './workspace-drafts';
import { useInventoryDefinitionForm } from '@/features/inventory/inventory-definition-form';
import {
  CATEGORY_TYPES,
  FAMILY_PRICES,
  categoryTypeLabel,
  familyLabel,
  catalogueMoney,
  type ProductCategory,
  type ProductFamily,
  type CatalogueCompany,
} from './catalogue-types';
import './catalogue-workspace.css';

export function CatalogueChoiceError({
  label,
  source,
}: {
  label: string;
  source: { error: string; retry: () => void };
}) {
  return source.error ? (
    <p role="alert" className="workspace-notice">
      {label} choices unavailable. {source.error}{' '}
      <Btn type="button" variant="ghost" onClick={source.retry}>
        Retry {label.toLowerCase()} choices
      </Btn>
    </p>
  ) : null;
}
export function CategoryEditor({
  record,
  draftSource,
  retainedParent,
  companyId,
  onClose,
  onSaved,
}: {
  record?: ProductCategory;
  companyId: string;
  draftSource?: WorkspaceDraft;
  retainedParent?: ProductCategory;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission, user } = useAuth();
  const baseline = {
    companyId: record?.companyId || companyId || user?.companyId || '',
    name: record?.name || '',
    categoryType: record?.categoryType || 'TRADING_GOODS',
    parentCategoryId: record?.parentCategoryId || '',
    description: record?.description || '',
    isActive: record?.isActive ?? true,
    newParent: false,
    parentName: '',
    createdParentId: '',
    createdParentName: '',
  };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    id = useId();
  const draft = useInventoryDefinitionForm({
    baseline,
    kind: 'category',
    title: (record ? 'Edit ' : 'New ') + 'category',
    describe: (values) => values.name || record?.name || 'category',
    record,
    source: draftSource,
    busy,
    onClose,
    context: { companyId: baseline.companyId },
  });
  const { form, setForm } = draft;
  const createdParent = form.createdParentId
    ? { id: form.createdParentId, name: retainedParent?.name || form.createdParentName }
    : null;
  const allowed =
    hasPermission('product_categories.manage') && hasPermission('product_categories.view');
  const companies = useWorkspaceChoices<CatalogueCompany>(
    '/companies',
    {},
    !record && hasPermission('companies.read'),
  );
  const parents = useWorkspaceChoices<ProductCategory>(
    '/product-categories',
    { companyId: form.companyId },
    !!form.companyId && hasPermission('product_categories.view'),
  );
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [key]: value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || !allowed || draft.availabilityError) return;
    pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review this draft.');
      pending.current = false;
      return;
    }
    if (
      !record &&
      hasPermission('companies.read') &&
      (companies.loading || companies.error || !companies.rows.some((c) => c.id === form.companyId))
    ) {
      pending.current = false;
      return setError('Load and choose an available company.');
    }
    if (!record && !hasPermission('companies.read') && form.companyId !== user?.companyId) {
      pending.current = false;
      return setError('Your current role cannot select this company.');
    }
    if (
      form.parentCategoryId &&
      !createdParent &&
      !(record && form.parentCategoryId === baseline.parentCategoryId) &&
      (parents.loading ||
        parents.error ||
        !parents.rows.some((p) => p.id === form.parentCategoryId && p.id !== record?.id))
    ) {
      pending.current = false;
      return setError('Choose an available parent category for this company.');
    }
    if (!form.companyId || !form.name.trim()) {
      pending.current = false;
      return setError('Choose a company and enter a category name.');
    }
    if (form.newParent && !form.parentName.trim()) {
      pending.current = false;
      return setError('Enter a name for the new parent category.');
    }
    setBusy(true);
    setError('');
    try {
      let parentId = createdParent?.id || form.parentCategoryId || null;
      if (!record && form.newParent && !createdParent) {
        const parent = await backendPost<ProductCategory>('/product-categories', {
          companyId: form.companyId,
          name: form.parentName.trim(),
          categoryType: form.categoryType,
          isActive: true,
        });
        parentId = parent.id;
        setForm((current) => ({
          ...current,
          createdParentId: parent.id,
          createdParentName: parent.name,
        }));
      }
      const body = {
        name: form.name.trim(),
        categoryType: form.categoryType,
        parentCategoryId: parentId,
        description: form.description.trim() || null,
        isActive: form.isActive,
      };
      if (record) {
        const previous = {
          name: record.name,
          categoryType: record.categoryType,
          parentCategoryId: record.parentCategoryId || null,
          description: record.description || null,
          isActive: record.isActive,
        };
        await backendPatch(
          `/product-categories/${record.id}`,
          Object.fromEntries(
            Object.entries(body).filter(
              ([key, value]) => value !== previous[key as keyof typeof previous],
            ),
          ),
        );
      } else await backendPost('/product-categories', { ...body, companyId: form.companyId });
      draft.markSaved();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this category.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={record ? 'Edit category' : 'New category'}
      onClose={close}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            type="submit"
            form={id}
            loading={busy}
            disabled={!allowed || !!draft.availabilityError || (!record && companies.loading)}
          >
            Save category
          </Btn>
        </>
      }
    >
      <form id={id} onSubmit={submit} {...draft.guard.capture} className="catalogue-editor">
        <DraftFormNotice draft={draft} />
        {record && (
          <p className="workspace-notice">
            Current: {record.name} · {categoryTypeLabel(record.categoryType)} ·{' '}
            {record.parentCategory?.name || 'Top-level'} · {record.isActive ? 'Active' : 'Inactive'}
          </p>
        )}
        {!allowed && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save this definition. Your draft can still be kept.
          </p>
        )}

        {error && (
          <p className="workspace-notice" role="alert">
            {error}
          </p>
        )}
        {createdParent && (
          <p className="workspace-notice" role="status">
            Parent “{createdParent.name}” has been created. Retry saves this category beneath it.
            Cancelling keeps the parent.
          </p>
        )}
        <fieldset disabled={busy || !allowed}>
          <legend>Identity & organisation</legend>
          <FormSelect
            label="Company"
            required
            value={form.companyId}
            disabled={
              !!record ||
              !!createdParent ||
              !hasPermission('companies.read') ||
              companies.loading ||
              !!companies.error
            }
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                companyId: e.target.value,
                parentCategoryId: '',
                newParent: false,
                parentName: '',
              }))
            }
          >
            <option value="">Select company</option>
            {form.companyId && !companies.rows.some((c) => c.id === form.companyId) && (
              <option value={form.companyId}>
                {record?.company?.name ||
                  (form.companyId === user?.companyId ? 'Assigned company' : form.companyId)}
              </option>
            )}
            {companies.rows.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </FormSelect>
          <CatalogueChoiceError label="Company" source={companies} />
          <FormInput
            label="Category name"
            required
            value={form.name}
            onChange={(e) => change('name', e.target.value)}
          />
          <FormSelect
            label="Category type"
            value={form.categoryType}
            onChange={(e) => change('categoryType', e.target.value)}
          >
            {CATEGORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {categoryTypeLabel(t)}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Parent category"
            disabled={
              !!createdParent ||
              parents.loading ||
              !!parents.error ||
              !hasPermission('product_categories.view')
            }
            value={createdParent?.id || (form.newParent ? '__new__' : form.parentCategoryId)}
            onChange={(e) =>
              setForm((p) => ({
                ...p,
                newParent: e.target.value === '__new__',
                parentCategoryId: e.target.value === '__new__' ? '' : e.target.value,
                parentName: '',
              }))
            }
          >
            <option value="">None (top-level)</option>
            {createdParent && <option value={createdParent.id}>{createdParent.name}</option>}
            {!createdParent &&
              form.parentCategoryId &&
              !parents.rows.some((c) => c.id === form.parentCategoryId) && (
                <option value={form.parentCategoryId}>
                  {record?.parentCategory?.name || form.parentCategoryId}
                </option>
              )}
            {parents.rows
              .filter((p) => p.id !== record?.id && p.id !== createdParent?.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            {!record && !createdParent && <option value="__new__">Create a new parent…</option>}
          </FormSelect>
          <CatalogueChoiceError label="Parent category" source={parents} />
          {form.newParent && !createdParent && (
            <>
              <FormInput
                label="New parent name"
                required
                value={form.parentName}
                onChange={(e) => change('parentName', e.target.value)}
              />
              <p className="catalogue-help">
                Creates the parent first, then this category. If the second save fails, the parent
                remains and will be reused on retry.
              </p>
            </>
          )}
          <FormTextarea
            label="Description"
            value={form.description}
            onChange={(e) => change('description', e.target.value)}
          />
          <label className="catalogue-check">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => change('isActive', e.target.checked)}
            />
            Active
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}

export function FamilyEditor({
  category,
  record,
  draftSource,
  divisionId = '',
  onClose,
  onSaved,
}: {
  category: ProductCategory;
  record?: ProductFamily;
  divisionId?: string;
  draftSource?: WorkspaceDraft;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission } = useAuth();
  const baseline = {
    name: record?.name || '',
    brand: record?.brand || '',
    description: record?.description || '',
    divisionId: record ? record.divisionId || '' : divisionId,
    isActive: record?.isActive ?? true,
    defaultPurchasePrice: String(record?.defaultPurchasePrice ?? ''),
    defaultSellingPrice: String(record?.defaultSellingPrice ?? ''),
    wholesalePrice: String(record?.wholesalePrice ?? ''),
    retailPrice: String(record?.retailPrice ?? ''),
  };
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false),
    id = useId();
  const draft = useInventoryDefinitionForm({
    baseline,
    kind: 'family',
    title: (record ? 'Edit ' : 'New ') + 'product family',
    describe: (values) => values.name || record?.name || 'product family',
    record,
    source: draftSource,
    busy,
    onClose,
    context: {
      companyId: category.companyId,
      categoryId: category.id,
      categoryVersion: category.updatedAt || '',
      categoryName: category.name,
    },
  });
  const { form, setForm } = draft;
  const initial = baseline;
  const allowed =
    hasPermission('product_categories.manage') &&
    hasPermission('product_categories.view') &&
    (hasPermission('products.view') || hasPermission('operations.dashboard.view'));
  const divisions = useWorkspaceChoices<{ id: string; name: string }>(
    '/divisions',
    { companyId: category.companyId },
    hasPermission('divisions.read'),
  );
  const close = () => {
    if (!pending.current) draft.guard.requestClose(onClose);
  };
  const change = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((p) => ({ ...p, [key]: value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending.current || !allowed || draft.availabilityError) return;
    pending.current = true;
    try {
      draft.validateReview();
      await draft.saveNow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Review this draft.');
      pending.current = false;
      return;
    }
    if (
      form.divisionId &&
      !(record && form.divisionId === baseline.divisionId) &&
      (!hasPermission('divisions.read') ||
        divisions.loading ||
        divisions.error ||
        !divisions.rows.some((d) => d.id === form.divisionId))
    ) {
      pending.current = false;
      return setError('Choose an available division for this company.');
    }
    if (!form.name.trim()) {
      pending.current = false;
      return setError('Enter a family name.');
    }
    for (const [key, label] of FAMILY_PRICES) {
      if (form[key].trim() && (!Number.isFinite(Number(form[key])) || Number(form[key]) < 0)) {
        pending.current = false;
        return setError(`${label} must be a finite, non-negative amount.`);
      }
      const purchase = Number(form.defaultPurchasePrice),
        amount = Number(form[key]);
      if (key !== 'defaultPurchasePrice' && purchase > 0 && amount > 0 && amount <= purchase) {
        pending.current = false;
        return setError(`${label} must be greater than family purchase price.`);
      }
    }
    const body: Record<string, unknown> = {};
    for (const key of ['name', 'brand', 'description', 'divisionId', 'isActive'] as const) {
      if (!record || form[key] !== initial[key])
        body[key] = typeof form[key] === 'string' ? form[key].trim() || null : form[key];
    }
    for (const [key] of FAMILY_PRICES)
      if (!record || form[key] !== initial[key])
        body[key] = form[key].trim() ? Number(form[key]) : null;
    setBusy(true);
    setError('');
    try {
      if (record) await backendPatch(`/products/families/${record.id}`, body);
      else
        await backendPost('/products/families', {
          ...body,
          companyId: category.companyId,
          categoryId: category.id,
        });
      draft.markSaved();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save this family.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={record ? 'Edit product family' : 'New product family'}
      size="lg"
      onClose={close}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={close}>
            Cancel
          </Btn>
          {draft.canRetain && (
            <Btn variant="secondary" disabled={busy} onClick={draft.keep}>
              Keep draft
            </Btn>
          )}
          <Btn
            type="submit"
            form={id}
            loading={busy}
            disabled={
              !allowed ||
              !!draft.availabilityError ||
              (!!form.divisionId && form.divisionId !== record?.divisionId && divisions.loading)
            }
          >
            Save family
          </Btn>
        </>
      }
    >
      <form id={id} className="catalogue-editor" {...draft.guard.capture} onSubmit={submit}>
        <DraftFormNotice draft={draft} />
        {record && (
          <div className="workspace-notice">
            <p>
              Current: {familyLabel(record)} · {record.isActive ? 'Active' : 'Inactive'}
            </p>
            <p>
              {FAMILY_PRICES.map(([key, label]) => `${label}: ${catalogueMoney(record[key])}`).join(
                ' · ',
              )}
            </p>
          </div>
        )}
        {!allowed && (
          <p role="alert" className="workspace-notice">
            Your current role cannot save this definition. Your draft can still be kept.
          </p>
        )}

        <p className="catalogue-help">
          {category.name} · {category.company?.name || category.companyId}
        </p>
        {error && (
          <p role="alert" className="workspace-notice">
            {error}
          </p>
        )}
        <fieldset disabled={busy || !allowed}>
          <legend>Family details</legend>
          <div className="catalogue-form-grid">
            <FormInput
              required
              label="Family name"
              value={form.name}
              onChange={(e) => change('name', e.target.value)}
            />
            <FormInput
              label="Brand"
              value={form.brand}
              onChange={(e) => change('brand', e.target.value)}
            />
          </div>
          <FormSelect
            label="Division"
            value={form.divisionId}
            disabled={!hasPermission('divisions.read') || divisions.loading || !!divisions.error}
            onChange={(e) => change('divisionId', e.target.value)}
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
          <CatalogueChoiceError label="Division" source={divisions} />
          <FormTextarea
            label="Description"
            value={form.description}
            onChange={(e) => change('description', e.target.value)}
          />
        </fieldset>
        <fieldset disabled={busy || !allowed}>
          <legend>Default prices · TZS</legend>
          <p className="catalogue-help">
            Products can inherit these defaults. Their individual price overrides remain in place.
            Leave an amount empty to remove that default.
          </p>
          <div className="catalogue-form-grid">
            {FAMILY_PRICES.map(([key, label]) => (
              <FormInput
                key={key}
                type="number"
                min="0"
                step="any"
                label={label}
                value={form[key]}
                onChange={(e) => change(key, e.target.value)}
              />
            ))}
          </div>
          <label className="catalogue-check">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => change('isActive', e.target.checked)}
            />
            Active
          </label>
        </fieldset>
      </form>
    </Modal>
  );
}

export function CategoryAction({
  record,
  action,
  onClose,
  onSaved,
}: {
  record: ProductCategory;
  action: 'delete' | 'status';
  onClose: () => void;
  onSaved: () => void;
}) {
  const { hasPermission } = useAuth();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const verb = action === 'delete' ? 'Delete' : record.isActive ? 'Deactivate' : 'Activate';
  const submit = async () => {
    if (busy || !hasPermission('product_categories.manage')) return;
    setBusy(true);
    setError('');
    try {
      if (action === 'delete') await backendDelete(`/product-categories/${record.id}`);
      else await backendPatch(`/product-categories/${record.id}`, { isActive: !record.isActive });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update this category.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={`${verb} category`}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <>
          <Btn variant="secondary" disabled={busy} onClick={onClose}>
            Keep category
          </Btn>
          <Btn variant={action === 'delete' ? 'danger' : 'primary'} loading={busy} onClick={submit}>
            {verb} category
          </Btn>
        </>
      }
    >
      <p className="catalogue-record-name">{record.name}</p>
      <p className="catalogue-help">
        {action === 'delete'
          ? 'Categories linked to products, families, supplier mappings or child categories cannot be deleted.'
          : `${verb} this category? Existing products and family prices are retained.`}
      </p>
      {error && (
        <p role="alert" className="workspace-notice">
          {error}
        </p>
      )}
    </Modal>
  );
}

'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  Modal,
  Btn,
  PageSpinner,
  FormInput,
  FormSelect,
  FormTextarea,
  ConfirmDialog,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  backendDelete,
  backendGet,
  backendList,
  backendPatch,
  backendPost,
  normalizePaginated,
} from '@/lib/api-client';

interface Company {
  id: string;
  name: string;
  code: string;
}

interface ProductCategory {
  id: string;
  name: string;
  categoryType: string;
  isActive: boolean;
  companyId: string;
  parentCategoryId?: string | null;
  description?: string | null;
  company?: { name: string } | null;
  parentCategory?: { id: string; name: string } | null;
}

interface ProductFamily {
  id: string;
  companyId: string;
  divisionId?: string | null;
  categoryId: string;
  name: string;
  brand?: string | null;
  description?: string | null;
  defaultPurchasePrice?: number | string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
  isActive: boolean;
  productCount?: number;
  inheritedPriceCount?: number;
  overridePriceCount?: number;
  missingPriceCount?: number;
  priceExceptionCount?: number;
  division?: { id: string; name: string; code?: string | null } | null;
}

interface ProductPriceException {
  id: string;
  name: string;
  productCode?: string | null;
  defaultSellingPrice?: number | string | null;
  wholesalePrice?: number | string | null;
  retailPrice?: number | string | null;
  effectiveSellingPrice?: number | string | null;
  priceSource?: string | null;
}

interface CategoryForm {
  companyId: string;
  name: string;
  categoryType: string;
  parentCategoryId: string;
  description: string;
  isActive: boolean;
}

interface FamilyForm {
  companyId: string;
  categoryId: string;
  divisionId: string;
  name: string;
  brand: string;
  description: string;
  defaultPurchasePrice: string;
  defaultSellingPrice: string;
  wholesalePrice: string;
  retailPrice: string;
  isActive: boolean;
}

interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  totalPages: number;
}

function emptyPaginated<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

const CATEGORY_TYPES = [
  'TRADING_GOODS',
  'RAW_MATERIAL',
  'FINISHED_GOODS',
  'FUEL',
  'LUBRICANT',
  'BEVERAGE_ALCOHOLIC',
  'BEVERAGE_NON_ALCOHOLIC',
  'HARDWARE',
  'BUILDING_MATERIAL',
  'AGRICULTURE_INPUT',
  'AGRICULTURE_PRODUCE',
  'CONSTRUCTION_MATERIAL',
  'SPARE_PART',
  'SERVICE',
  'OTHER',
];

const BLANK_FORM: CategoryForm = {
  companyId: '',
  name: '',
  categoryType: 'TRADING_GOODS',
  parentCategoryId: '',
  description: '',
  isActive: true,
};

const NEW_PARENT_VALUE = '__new_parent_category__';

function fmtTZS(value?: number | string | null) {
  if (value == null || value === '') return '—';
  const n = Number(value);
  return `TZS ${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)}`;
}

function familyLabel(family: ProductFamily) {
  return family.brand ? `${family.brand} — ${family.name}` : family.name;
}

function hasPositivePrice(value: number | string | null | undefined) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0;
}

function CategoryModal({
  mode,
  initial,
  companies,
  defaultCompanyId,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: ProductCategory;
  companies: Company[];
  defaultCompanyId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CategoryForm>(() =>
    initial
      ? {
          companyId: initial.companyId ?? '',
          name: initial.name,
          categoryType: initial.categoryType,
          parentCategoryId: initial.parentCategoryId ?? '',
          description: initial.description ?? '',
          isActive: initial.isActive,
        }
      : { ...BLANK_FORM, companyId: defaultCompanyId ?? '' },
  );
  const [parentMode, setParentMode] = useState<'existing' | 'new'>('existing');
  const [newParentName, setNewParentName] = useState('');
  const [parents, setParents] = useState<ProductCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof CategoryForm>(k: K, v: CategoryForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const selectedParentValue = parentMode === 'new' ? NEW_PARENT_VALUE : form.parentCategoryId;

  useEffect(() => {
    let cancelled = false;

    async function loadParents() {
      if (!form.companyId) {
        setParents([]);
        return;
      }

      try {
        const payload = await backendGet<unknown>('/product-categories', {
          query: { limit: 5000, companyId: form.companyId },
        });
        const categories = normalizePaginated<ProductCategory>(payload).data;
        if (!cancelled) {
          setParents(categories.filter((p) => p.id !== initial?.id));
        }
      } catch {
        if (!cancelled) setParents([]);
      }
    }

    void loadParents();

    return () => {
      cancelled = true;
    };
  }, [form.companyId, initial?.id]);

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (parentMode === 'new' && !newParentName.trim()) {
      setError('New parent name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      let parentCategoryId = form.parentCategoryId || undefined;
      if (mode === 'create' && parentMode === 'new') {
        const parent = await backendPost<ProductCategory>('/product-categories', {
          companyId: form.companyId,
          name: newParentName.trim(),
          categoryType: form.categoryType,
          isActive: true,
        });
        parentCategoryId = parent.id;
      }
      const body = {
        name: form.name.trim(),
        categoryType: form.categoryType,
        parentCategoryId,
        description: form.description || undefined,
        isActive: form.isActive,
      };
      if (mode === 'create') {
        await backendPost('/product-categories', { ...body, companyId: form.companyId });
      } else {
        await backendPatch(`/product-categories/${initial!.id}`, body);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Category' : 'Edit Category'}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="space-y-3">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(e) => {
            setParentMode('existing');
            setNewParentName('');
            setForm((f) => ({ ...f, companyId: e.target.value, parentCategoryId: '' }));
          }}
          placeholder="Select company"
          disabled={mode === 'edit'}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormSelect
            label="Category Type"
            required
            value={form.categoryType}
            onChange={(e) => set('categoryType', e.target.value)}
          >
            {CATEGORY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </FormSelect>
          <FormSelect
            label="Parent Category"
            value={selectedParentValue}
            onChange={(e) => {
              if (e.target.value === NEW_PARENT_VALUE) {
                setParentMode('new');
                setNewParentName('');
                set('parentCategoryId', '');
                return;
              }
              setParentMode('existing');
              setNewParentName('');
              set('parentCategoryId', e.target.value);
            }}
            placeholder="None (top-level)"
          >
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {mode === 'create' && <option value={NEW_PARENT_VALUE}>Create new parent...</option>}
          </FormSelect>
        </div>
        {mode === 'create' && parentMode === 'new' && (
          <FormInput
            label="New Parent Category"
            required
            value={newParentName}
            onChange={(e) => setNewParentName(e.target.value)}
            placeholder="Example: Paints"
          />
        )}
        <FormTextarea
          label="Description"
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="rounded"
          />
          Active
        </label>
      </div>
    </Modal>
  );
}

function FamilyModal({
  mode,
  category,
  initial,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  category: ProductCategory;
  initial?: ProductFamily;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FamilyForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          categoryId: initial.categoryId,
          divisionId: initial.divisionId ?? '',
          name: initial.name,
          brand: initial.brand ?? '',
          description: initial.description ?? '',
          defaultPurchasePrice:
            initial.defaultPurchasePrice != null ? String(initial.defaultPurchasePrice) : '',
          defaultSellingPrice:
            initial.defaultSellingPrice != null ? String(initial.defaultSellingPrice) : '',
          wholesalePrice: initial.wholesalePrice != null ? String(initial.wholesalePrice) : '',
          retailPrice: initial.retailPrice != null ? String(initial.retailPrice) : '',
          isActive: initial.isActive,
        }
      : {
          companyId: category.companyId ?? '',
          categoryId: category.id,
          divisionId: '',
          name: '',
          brand: '',
          description: '',
          defaultPurchasePrice: '',
          defaultSellingPrice: '',
          wholesalePrice: '',
          retailPrice: '',
          isActive: true,
        },
  );
  const [divisions, setDivisions] = useState<Array<{ id: string; name: string; code?: string | null }>>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!form.companyId) {
      setDivisions([]);
      return;
    }
    backendGet<unknown>('/divisions', { query: { companyId: form.companyId, limit: 200 } })
      .then((payload) => {
        if (!cancelled) setDivisions(normalizePaginated<{ id: string; name: string; code?: string | null }>(payload).data);
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const set = <K extends keyof FamilyForm>(key: K, value: FamilyForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) {
      setError('Family name is required');
      return;
    }
    const purchase = Number(form.defaultPurchasePrice || 0);
    if (purchase > 0) {
      for (const [label, value] of [
        ['Selling price', form.defaultSellingPrice],
        ['Wholesale price', form.wholesalePrice],
        ['Retail price', form.retailPrice],
      ] as const) {
        const price = Number(value || 0);
        if (price > 0 && price <= purchase) {
          setError(`${label} must be greater than family purchase price`);
          return;
        }
      }
    }

    const numberOrNull = (value: string) => (value.trim() ? Number(value) : null);
    const body = {
      categoryId: form.categoryId,
      divisionId: form.divisionId || null,
      name: form.name.trim(),
      brand: form.brand.trim() || null,
      description: form.description.trim() || null,
      defaultPurchasePrice: numberOrNull(form.defaultPurchasePrice),
      defaultSellingPrice: numberOrNull(form.defaultSellingPrice),
      wholesalePrice: numberOrNull(form.wholesalePrice),
      retailPrice: numberOrNull(form.retailPrice),
      isActive: form.isActive,
    };

    setSaving(true);
    setError('');
    try {
      if (mode === 'create') {
        await backendPost('/products/families', { ...body, companyId: form.companyId });
      } else {
        await backendPatch(`/products/families/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save family');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? `New Family In ${category.name}` : `Edit ${initial ? familyLabel(initial) : 'Family'}`}
      size="lg"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create Family' : 'Save Family'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Family Name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Example: 4L" />
        <FormInput label="Brand" value={form.brand} onChange={(e) => set('brand', e.target.value)} placeholder="Example: Coral" />
        <FormSelect label="Division" value={form.divisionId} onChange={(e) => set('divisionId', e.target.value)} placeholder="Company-wide">
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.code ? `${division.code} — ${division.name}` : division.name}
            </option>
          ))}
        </FormSelect>
        <FormInput label="Family Purchase Price" type="number" value={form.defaultPurchasePrice} onChange={(e) => set('defaultPurchasePrice', e.target.value)} />
        <FormInput label="Family Selling Price" type="number" value={form.defaultSellingPrice} onChange={(e) => set('defaultSellingPrice', e.target.value)} />
        <FormInput label="Family Wholesale Price" type="number" value={form.wholesalePrice} onChange={(e) => set('wholesalePrice', e.target.value)} />
        <FormInput label="Family Retail Price" type="number" value={form.retailPrice} onChange={(e) => set('retailPrice', e.target.value)} />
        <label className="flex items-center gap-2 text-sm self-end" style={{ color: 'var(--aurora-text)' }}>
          <input className="rounded" type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
          Active
        </label>
        <div className="col-span-2">
          <FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export default function ProductCategoriesPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<ProductCategory> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [categoryType, setCategoryType] = useState('');
  const [activeFilter, setActiveFilter] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProductCategory | null>(null);
  const [deleting, setDeleting] = useState<ProductCategory | null>(null);
  const [expandedCategoryId, setExpandedCategoryId] = useState('');
  const [familiesByCategory, setFamiliesByCategory] = useState<Record<string, ProductFamily[]>>({});
  const [familyLoading, setFamilyLoading] = useState<Record<string, boolean>>({});
  const [creatingFamilyFor, setCreatingFamilyFor] = useState<ProductCategory | null>(null);
  const [editingFamily, setEditingFamily] = useState<{ category: ProductCategory; family: ProductFamily } | null>(null);
  const [exceptionsFamily, setExceptionsFamily] = useState<{ category: ProductCategory; family: ProductFamily } | null>(null);
  const [familyExceptions, setFamilyExceptions] = useState<ProductPriceException[]>([]);
  const [exceptionsLoading, setExceptionsLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState('');

  const canView = hasPermission('product_categories.view');
  const canCreate = hasPermission('product_categories.manage');

  const loadFamiliesForCategory = useCallback(async (category: ProductCategory) => {
    setFamilyLoading((current) => ({ ...current, [category.id]: true }));
    try {
      const records = await backendList<ProductFamily>('/products/families', {
        query: {
          companyId: category.companyId,
          categoryId: category.id,
          limit: 500,
        },
      });
      setFamiliesByCategory((current) => ({ ...current, [category.id]: records }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load product families');
      setFamiliesByCategory((current) => ({ ...current, [category.id]: [] }));
    } finally {
      setFamilyLoading((current) => ({ ...current, [category.id]: false }));
    }
  }, []);

  const toggleFamilies = async (category: ProductCategory) => {
    if (expandedCategoryId === category.id) {
      setExpandedCategoryId('');
      return;
    }
    setExpandedCategoryId(category.id);
    if (!familiesByCategory[category.id]) {
      await loadFamiliesForCategory(category);
    }
  };

  const refreshFamilies = async (category: ProductCategory) => {
    await loadFamiliesForCategory(category);
  };

  const openExceptions = async (category: ProductCategory, family: ProductFamily) => {
    setExceptionsFamily({ category, family });
    setExceptionsLoading(true);
    setFamilyExceptions([]);
    try {
      const products = await backendList<ProductPriceException>('/products', {
        query: {
          companyId: category.companyId,
          categoryId: category.id,
          productFamilyId: family.id,
          limit: 500,
        },
      });
      setFamilyExceptions(
        products.filter(
          (product) =>
            product.priceSource !== 'FAMILY_DEFAULT' ||
            (hasPositivePrice(product.defaultSellingPrice) &&
              hasPositivePrice(family.defaultSellingPrice) &&
              Number(product.defaultSellingPrice) !== Number(family.defaultSellingPrice)),
        ),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load price exceptions');
      setFamilyExceptions([]);
    } finally {
      setExceptionsLoading(false);
    }
  };

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadCompanies() {
      try {
        const payload = await backendGet<unknown>('/companies', { query: { limit: 100 } });
        if (!cancelled) setCompanies(normalizePaginated<Company>(payload).data);
      } catch {
        if (!cancelled) setCompanies([]);
      }
    }

    void loadCompanies();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    try {
      const payload = await backendGet<unknown>('/product-categories', {
        query: {
          page,
          limit: 20,
          search: search.trim() || undefined,
          companyId: companyId || undefined,
          categoryType: categoryType || undefined,
          isActive: activeFilter || undefined,
        },
      });
      setData(normalizePaginated<ProductCategory>(payload));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load product categories');
      setData(emptyPaginated<ProductCategory>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, page, search, companyId, categoryType, activeFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteLoading(true);
    setError(null);
    try {
      await backendDelete(`/product-categories/${deleting.id}`);
      setDeleting(null);
      await load();
    } catch (err) {
      setDeleting(null);
      setError(err instanceof Error ? err.message : 'Failed to delete product category');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleToggleStatus = async (category: ProductCategory) => {
    setStatusUpdatingId(category.id);
    setError(null);
    const nextActive = !category.isActive;
    try {
      await backendPatch(`/product-categories/${category.id}`, { isActive: nextActive });
      showToast(
        'success',
        nextActive ? 'Category activated' : 'Category deactivated',
        category.name,
      );
      await load();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to update product category status';
      setError(message);
      showToast('error', 'Could not update category', message);
    } finally {
      setStatusUpdatingId('');
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Product Categories" subtitle="Manage categories" />
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">Access Restricted</p>
        </div>
      </div>
    );
  }

  const filterSelectCls =
    'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <CategoryModal
          mode="create"
          companies={companies}
          defaultCompanyId={companyId || undefined}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <CategoryModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {creatingFamilyFor && (
        <FamilyModal
          mode="create"
          category={creatingFamilyFor}
          onClose={() => setCreatingFamilyFor(null)}
          onSaved={() => {
            const category = creatingFamilyFor;
            setCreatingFamilyFor(null);
            void refreshFamilies(category);
          }}
        />
      )}
      {editingFamily && (
        <FamilyModal
          mode="edit"
          category={editingFamily.category}
          initial={editingFamily.family}
          onClose={() => setEditingFamily(null)}
          onSaved={() => {
            const category = editingFamily.category;
            setEditingFamily(null);
            void refreshFamilies(category);
          }}
        />
      )}
      {exceptionsFamily && (
        <Modal
          open
          title={`Price Exceptions - ${familyLabel(exceptionsFamily.family)}`}
          onClose={() => setExceptionsFamily(null)}
          size="lg"
          footer={
            <Btn variant="secondary" onClick={() => setExceptionsFamily(null)}>
              Close
            </Btn>
          }
        >
          <div className="mb-3 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-secondary)' }}>
            Family selling price: <span className="font-semibold" style={{ color: 'var(--aurora-text)' }}>{fmtTZS(exceptionsFamily.family.defaultSellingPrice)}</span>
          </div>
          {exceptionsLoading ? (
            <PageSpinner />
          ) : familyExceptions.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
              No price exceptions found for this family.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2 text-right">Product Price</th>
                    <th className="px-3 py-2 text-right">Effective Price</th>
                    <th className="px-3 py-2">Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {familyExceptions.map((product) => (
                    <tr key={product.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {product.productCode ?? 'No code'}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">{fmtTZS(product.defaultSellingPrice)}</td>
                      <td className="px-3 py-2 text-right">{fmtTZS(product.effectiveSellingPrice)}</td>
                      <td className="px-3 py-2 text-xs">{product.priceSource?.replace(/_/g, ' ') ?? 'MISSING'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Modal>
      )}
      <ConfirmDialog
        open={!!deleting}
        title="Delete Product Category"
        message={`Delete "${deleting?.name ?? 'this category'}"? This cannot be undone. Categories linked to products, product families, supplier mappings, or child categories cannot be deleted.`}
        confirmLabel="Delete"
        variant="danger"
        loading={deleteLoading}
        onClose={() => setDeleting(null)}
        onConfirm={handleDelete}
      />

      <PageHeader title="Product Categories" subtitle="Organize products into categories" />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Active" value={data?.data.filter((c) => c.isActive).length ?? 0} />
        <StatCard label="Inactive" value={data?.data.filter((c) => !c.isActive).length ?? 0} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search categories…"
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={categoryType}
              onChange={(e) => {
                setCategoryType(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {CATEGORY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={activeFilter}
              onChange={(e) => {
                setActiveFilter(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </>
        }
        actions={
          canCreate ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Category
            </Btn>
          ) : null
        }
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Parent</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                {canCreate && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={6}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No categories found
                  </td>
                </tr>
              ) : (
                data.data.map((cat) => (
                  <Fragment key={cat.id}>
                  <tr key={cat.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{cat.name}</div>
                      <button
                        type="button"
                        className="mt-1 text-xs font-semibold text-brand-600 hover:underline"
                        onClick={() => void toggleFamilies(cat)}
                      >
                        {expandedCategoryId === cat.id ? 'Hide families' : 'View families'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-xs">{cat.categoryType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                      {cat.parentCategory?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">{cat.company?.name ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${cat.isActive ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-zinc-100 text-zinc-500 border-zinc-200'}`}
                      >
                        {cat.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    {canCreate && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Btn variant="ghost" size="xs" onClick={() => setCreatingFamilyFor(cat)}>
                            + Family
                          </Btn>
                          <Btn
                            variant={cat.isActive ? 'warning' : 'success'}
                            size="xs"
                            loading={statusUpdatingId === cat.id}
                            onClick={() => void handleToggleStatus(cat)}
                          >
                            {cat.isActive ? 'Deactivate' : 'Activate'}
                          </Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(cat)}>
                            Edit
                          </Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(cat)}>
                            Delete
                          </Btn>
                        </div>
                      </td>
                    )}
                  </tr>
                  {expandedCategoryId === cat.id && (
                    <tr key={`${cat.id}-families`}>
                      <td colSpan={6} className="bg-slate-50 px-4 py-4">
                        {familyLoading[cat.id] ? (
                          <PageSpinner />
                        ) : !(familiesByCategory[cat.id] ?? []).length ? (
                          <div className="rounded-lg border border-dashed px-4 py-6 text-center text-sm" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text-muted)' }}>
                            No families in this category yet.
                            {canCreate && (
                              <button type="button" className="ml-2 font-semibold text-brand-600 hover:underline" onClick={() => setCreatingFamilyFor(cat)}>
                                Create family
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="overflow-x-auto rounded-lg border bg-white" style={{ borderColor: 'var(--aurora-border)' }}>
                            <table className="w-full text-xs min-w-[900px]">
                              <thead>
                                <tr className="text-left uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                                  <th className="px-3 py-2">Family</th>
                                  <th className="px-3 py-2 text-right">Selling</th>
                                  <th className="px-3 py-2 text-right">Wholesale</th>
                                  <th className="px-3 py-2 text-right">Retail</th>
                                  <th className="px-3 py-2 text-center">Products</th>
                                  <th className="px-3 py-2 text-center">Inherited</th>
                                  <th className="px-3 py-2 text-center">Overrides</th>
                                  <th className="px-3 py-2 text-center">Missing</th>
                                  <th className="px-3 py-2">Status</th>
                                  <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {(familiesByCategory[cat.id] ?? []).map((family) => (
                                  <tr key={family.id}>
                                    <td className="px-3 py-2">
                                      <div className="font-semibold">{familyLabel(family)}</div>
                                      <div style={{ color: 'var(--aurora-text-muted)' }}>
                                        {family.division?.name ?? 'Company-wide'}
                                      </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">{fmtTZS(family.defaultSellingPrice)}</td>
                                    <td className="px-3 py-2 text-right">{fmtTZS(family.wholesalePrice)}</td>
                                    <td className="px-3 py-2 text-right">{fmtTZS(family.retailPrice)}</td>
                                    <td className="px-3 py-2 text-center">{family.productCount ?? 0}</td>
                                    <td className="px-3 py-2 text-center text-emerald-700">{family.inheritedPriceCount ?? 0}</td>
                                    <td className="px-3 py-2 text-center text-blue-700">{family.overridePriceCount ?? 0}</td>
                                    <td className="px-3 py-2 text-center text-red-700">{family.missingPriceCount ?? 0}</td>
                                    <td className="px-3 py-2">
                                      <span className={`inline-flex rounded border px-2 py-0.5 ${family.isActive ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-zinc-200 bg-zinc-100 text-zinc-500'}`}>
                                        {family.isActive ? 'Active' : 'Inactive'}
                                      </span>
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                      <Btn variant="ghost" size="xs" onClick={() => void openExceptions(cat, family)}>
                                        Exceptions
                                      </Btn>
                                      {canCreate && (
                                        <Btn variant="ghost" size="xs" onClick={() => setEditingFamily({ category: cat, family })}>
                                          Edit
                                        </Btn>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div
            className="px-5 py-3 border-t flex items-center justify-between"
            style={{ borderColor: 'var(--aurora-border)' }}
          >
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn
                variant="secondary"
                size="xs"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Btn>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

'use client';

import { useCallback, useEffect, useState } from 'react';
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
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  backendDelete,
  backendGet,
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
  companyId?: string | null;
  parentCategoryId?: string | null;
  description?: string | null;
  company?: { name: string } | null;
  parentCategory?: { id: string; name: string } | null;
}

interface CategoryForm {
  companyId: string;
  name: string;
  categoryType: string;
  parentCategoryId: string;
  description: string;
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
          query: { limit: 200, companyId: form.companyId },
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
  const [deleteLoading, setDeleteLoading] = useState(false);

  const canView = hasPermission('product_categories.view');
  const canCreate = hasPermission('product_categories.manage');

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
                  <tr key={cat.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{cat.name}</td>
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

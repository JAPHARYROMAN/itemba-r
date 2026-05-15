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
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  backendDelete,
  backendList,
  backendPage,
  backendPatch,
  backendPost,
} from '@/lib/api-client';

interface Company {
  id: string;
  name: string;
  code: string;
}
interface Category {
  id: string;
  name: string;
}
interface Unit {
  id: string;
  name: string;
  symbol: string;
}
interface Division {
  id: string;
  name: string;
  code: string;
}

interface Product {
  id: string;
  productCode?: string | null;
  name: string;
  productType: string;
  status: string;
  defaultSellingPrice?: number | null;
  defaultPurchasePrice?: number | null;
  wholesalePrice?: number | null;
  retailPrice?: number | null;
  minimumStockLevel?: number | null;
  reorderLevel?: number | null;
  trackInventory: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  description?: string | null;
  companyId: string;
  divisionId?: string | null;
  categoryId: string;
  baseUnitId: string;
  company?: { name: string } | null;
  division?: { id: string; name: string; code: string } | null;
  category?: { name: string } | null;
  baseUnit?: { name: string; symbol: string } | null;
}

interface ProductForm {
  companyId: string;
  divisionId: string;
  productCode: string;
  name: string;
  categoryId: string;
  productType: string;
  baseUnitId: string;
  defaultSellingPrice: string;
  defaultPurchasePrice: string;
  wholesalePrice: string;
  retailPrice: string;
  minimumStockLevel: string;
  reorderLevel: string;
  trackInventory: boolean;
  trackBatch: boolean;
  trackExpiry: boolean;
  status: string;
  description: string;
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

const PRODUCT_TYPES = ['STOCK_ITEM', 'SERVICE', 'NON_STOCK_ITEM', 'ASSET_RELATED'];
const PRODUCT_STATUSES = ['ACTIVE', 'INACTIVE', 'DISCONTINUED'];

const TYPE_BADGE: Record<string, string> = {
  STOCK_ITEM: 'bg-blue-50 text-blue-700 border-blue-200',
  SERVICE: 'bg-purple-50 text-purple-700 border-purple-200',
  NON_STOCK_ITEM: 'bg-zinc-50 text-zinc-700 border-zinc-200',
  ASSET_RELATED: 'bg-amber-50 text-amber-700 border-amber-200',
};

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  DISCONTINUED: 'bg-red-50 text-red-700 border-red-200',
};

const BLANK: ProductForm = {
  companyId: '',
  divisionId: '',
  productCode: '',
  name: '',
  categoryId: '',
  productType: 'STOCK_ITEM',
  baseUnitId: '',
  defaultSellingPrice: '',
  defaultPurchasePrice: '',
  wholesalePrice: '',
  retailPrice: '',
  minimumStockLevel: '',
  reorderLevel: '',
  trackInventory: true,
  trackBatch: false,
  trackExpiry: false,
  status: 'ACTIVE',
  description: '',
};

function fmtTZS(n?: number | null) {
  if (n == null) return '—';
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  );
}

function ProductModal({
  mode,
  initial,
  companies,
  units,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Product;
  companies: Company[];
  units: Unit[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProductForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: initial.divisionId ?? '',
          productCode: initial.productCode ?? '',
          name: initial.name,
          categoryId: initial.categoryId,
          productType: initial.productType,
          baseUnitId: initial.baseUnitId,
          defaultSellingPrice:
            initial.defaultSellingPrice != null ? String(initial.defaultSellingPrice) : '',
          defaultPurchasePrice:
            initial.defaultPurchasePrice != null ? String(initial.defaultPurchasePrice) : '',
          wholesalePrice: initial.wholesalePrice != null ? String(initial.wholesalePrice) : '',
          retailPrice: initial.retailPrice != null ? String(initial.retailPrice) : '',
          minimumStockLevel:
            initial.minimumStockLevel != null ? String(initial.minimumStockLevel) : '',
          reorderLevel: initial.reorderLevel != null ? String(initial.reorderLevel) : '',
          trackInventory: initial.trackInventory,
          trackBatch: initial.trackBatch,
          trackExpiry: initial.trackExpiry,
          status: initial.status,
          description: initial.description ?? '',
        }
      : { ...BLANK },
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.companyId) {
      setCategories([]);
      setDivisions([]);
      return;
    }
    let cancelled = false;

    async function loadLookups() {
      const [categoryResult, divisionResult] = await Promise.allSettled([
        backendList<Category>('/product-categories', {
          query: { companyId: form.companyId, limit: 200 },
        }),
        backendList<Division>('/divisions', {
          query: { companyId: form.companyId, limit: 200 },
        }),
      ]);
      if (cancelled) return;
      setCategories(categoryResult.status === 'fulfilled' ? categoryResult.value : []);
      setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
    }

    void loadLookups();

    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.categoryId) {
      setError('Category is required');
      return;
    }
    if (!form.baseUnitId) {
      setError('Base unit is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const num = (s: string) => (s.trim() === '' ? undefined : Number(s));
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        name: form.name.trim(),
        categoryId: form.categoryId,
        productType: form.productType,
        baseUnitId: form.baseUnitId,
        status: form.status,
        trackInventory: form.trackInventory,
        trackBatch: form.trackBatch,
        trackExpiry: form.trackExpiry,
      };
      if (form.productCode.trim()) body.productCode = form.productCode.trim();
      if (form.description.trim()) body.description = form.description.trim();
      // Division: empty string => clear in edit mode (send null);
      // populated => assign to that division; omit on create when blank.
      if (mode === 'edit') body.divisionId = form.divisionId || null;
      else if (form.divisionId) body.divisionId = form.divisionId;
      const fields: (keyof ProductForm)[] = [
        'defaultSellingPrice',
        'defaultPurchasePrice',
        'wholesalePrice',
        'retailPrice',
        'minimumStockLevel',
        'reorderLevel',
      ];
      for (const k of fields) {
        const v = num(form[k] as string);
        if (v !== undefined) body[k] = v;
      }
      if (mode === 'create') {
        await backendPost('/products', body);
      } else {
        await backendPatch(`/products/${initial!.id}`, body);
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
      title={mode === 'create' ? 'Create Product' : 'Edit Product'}
      size="xl"
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
      <div className="grid grid-cols-2 gap-3">
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(e) => set('companyId', e.target.value)}
          placeholder="Select company"
          disabled={mode === 'edit'}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Category"
          required
          value={form.categoryId}
          onChange={(e) => set('categoryId', e.target.value)}
          placeholder={form.companyId ? 'Select category' : 'Select company first'}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Division"
          value={form.divisionId}
          onChange={(e) => set('divisionId', e.target.value)}
          placeholder={form.companyId ? 'Company-wide (no division)' : 'Select company first'}
        >
          {divisions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.code ? `${d.code} — ${d.name}` : d.name}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Product Code"
          value={form.productCode}
          onChange={(e) => set('productCode', e.target.value)}
        />
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <FormSelect
          label="Product Type"
          required
          value={form.productType}
          onChange={(e) => set('productType', e.target.value)}
        >
          {PRODUCT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Base Unit"
          required
          value={form.baseUnitId}
          onChange={(e) => set('baseUnitId', e.target.value)}
          placeholder="Select unit"
        >
          {units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.symbol})
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Selling Price"
          type="number"
          value={form.defaultSellingPrice}
          onChange={(e) => set('defaultSellingPrice', e.target.value)}
        />
        <FormInput
          label="Purchase Price"
          type="number"
          value={form.defaultPurchasePrice}
          onChange={(e) => set('defaultPurchasePrice', e.target.value)}
        />
        <FormInput
          label="Wholesale Price"
          type="number"
          value={form.wholesalePrice}
          onChange={(e) => set('wholesalePrice', e.target.value)}
        />
        <FormInput
          label="Retail Price"
          type="number"
          value={form.retailPrice}
          onChange={(e) => set('retailPrice', e.target.value)}
        />
        <FormInput
          label="Min Stock Level"
          type="number"
          value={form.minimumStockLevel}
          onChange={(e) => set('minimumStockLevel', e.target.value)}
        />
        <FormInput
          label="Reorder Level"
          type="number"
          value={form.reorderLevel}
          onChange={(e) => set('reorderLevel', e.target.value)}
        />
        <FormSelect
          label="Status"
          required
          value={form.status}
          onChange={(e) => set('status', e.target.value)}
        >
          {PRODUCT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </FormSelect>
        <div
          className="col-span-2 grid grid-cols-3 gap-2 text-sm"
          style={{ color: 'var(--aurora-text)' }}
        >
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="rounded"
              checked={form.trackInventory}
              onChange={(e) => set('trackInventory', e.target.checked)}
            />
            Track Inventory
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="rounded"
              checked={form.trackBatch}
              onChange={(e) => set('trackBatch', e.target.checked)}
            />
            Track Batch
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="rounded"
              checked={form.trackExpiry}
              onChange={(e) => set('trackExpiry', e.target.checked)}
            />
            Track Expiry
          </label>
        </div>
        <div className="col-span-2">
          <FormTextarea
            label="Description"
            rows={2}
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirm({
  product,
  onClose,
  onConfirmed,
}: {
  product: Product;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/products/${product.id}`);
      onConfirmed();
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
      title="Delete Product"
      size="md"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>
            Cancel
          </Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>
            Delete
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Are you sure you want to delete <strong>{product.name}</strong>? This will fail if the
        product has any inventory movement, sales, or purchase history.
      </p>
    </Modal>
  );
}

export default function ProductsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [data, setData] = useState<Paginated<Product> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [productType, setProductType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);

  const canView = hasPermission('products.view');
  const canCreate = hasPermission('products.create');
  const canDelete = hasPermission('products.delete');

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadBaseLookups() {
      const [companyResult, unitResult] = await Promise.allSettled([
        backendList<Company>('/companies', { query: { limit: 100 } }),
        backendList<Unit>('/units', { query: { limit: 200 } }),
      ]);
      if (cancelled) return;
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value : []);
      setUnits(unitResult.status === 'fulfilled' ? unitResult.value : []);
    }

    void loadBaseLookups();

    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadCategories() {
      try {
        const records = await backendList<Category>('/product-categories', {
          query: { limit: 200, companyId: companyId || undefined },
        });
        if (!cancelled) setCategories(records);
      } catch {
        if (!cancelled) setCategories([]);
      }
    }

    void loadCategories();

    return () => {
      cancelled = true;
    };
  }, [canView, companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const result = await backendPage<Product>('/products', {
        query: {
          page,
          limit: 20,
          search: search.trim() || undefined,
          companyId: companyId || undefined,
          categoryId: categoryId || undefined,
          productType: productType || undefined,
          status: status || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
      setData(emptyPaginated<Product>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, page, search, companyId, categoryId, productType, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Products" subtitle="Catalogue" />
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

  const counts = {
    active: data?.data.filter((p) => p.status === 'ACTIVE').length ?? 0,
    inactive: data?.data.filter((p) => p.status === 'INACTIVE').length ?? 0,
    discontinued: data?.data.filter((p) => p.status === 'DISCONTINUED').length ?? 0,
  };

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <ProductModal
          mode="create"
          companies={companies}
          units={units}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <ProductModal
          mode="edit"
          initial={editing}
          companies={companies}
          units={units}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {deleting && (
        <DeleteConfirm
          product={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader title="Products" subtitle="Master data for goods and services" />

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Active (page)" value={counts.active} />
        <StatCard label="Inactive (page)" value={counts.inactive} />
        <StatCard label="Discontinued (page)" value={counts.discontinued} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search products…"
        filters={
          <>
            <select
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                setCategoryId('');
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
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Categories</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <select
              value={productType}
              onChange={(e) => {
                setProductType(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              {PRODUCT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          canCreate ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Product
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
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Division</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3 text-right">Selling</th>
                <th className="px-4 py-3 text-right">Purchase</th>
                <th className="px-4 py-3">Status</th>
                {(canCreate || canDelete) && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={canCreate || canDelete ? 10 : 9}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={canCreate || canDelete ? 10 : 9}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No products found
                  </td>
                </tr>
              ) : (
                data.data.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{p.productCode ?? '—'}</td>
                    <td className="px-4 py-3 font-medium">{p.name}</td>
                    <td className="px-4 py-3 text-xs">{p.category?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">
                      {p.division?.name ?? (
                        <span className="text-slate-400 italic">company-wide</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${TYPE_BADGE[p.productType] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {p.productType.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.baseUnit?.symbol ?? p.baseUnit?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtTZS(p.defaultSellingPrice)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtTZS(p.defaultPurchasePrice)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${STATUS_BADGE[p.status] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {p.status}
                      </span>
                    </td>
                    {(canCreate || canDelete) && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {canCreate && (
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(p)}>
                            Edit
                          </Btn>
                        )}
                        {canDelete && (
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(p)}>
                            Delete
                          </Btn>
                        )}
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

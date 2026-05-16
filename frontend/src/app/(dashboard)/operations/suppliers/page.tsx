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

interface Division {
  id: string;
  name: string;
  code: string;
}

interface ProductCategory {
  id: string;
  name: string;
  categoryType: string;
}

interface Supplier {
  id: string;
  supplierCode?: string | null;
  name: string;
  legalName?: string | null;
  supplierType: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  contactPerson?: string | null;
  tin?: string | null;
  creditLimit: number;
  currentBalance: number;
  paymentTerms?: string | null;
  status: string;
  notes?: string | null;
  companyId: string;
  company?: { name: string } | null;
  divisionId?: string | null;
  division?: { name: string; code?: string | null } | null;
  productCategories?: Array<{ productCategory: ProductCategory }>;
}

interface SupplierForm {
  companyId: string;
  divisionId: string;
  productCategoryIds: string[];
  supplierType: string;
  supplierCode: string;
  name: string;
  legalName: string;
  tin: string;
  phone: string;
  email: string;
  address: string;
  contactPerson: string;
  creditLimit: string;
  paymentTerms: string;
  status: string;
  notes: string;
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

const SUPPLIER_TYPES = [
  'FUEL_SUPPLIER',
  'BEVERAGE_SUPPLIER',
  'HARDWARE_SUPPLIER',
  'AGRICULTURE_INPUT_SUPPLIER',
  'CONSTRUCTION_MATERIAL_SUPPLIER',
  'LOGISTICS_SERVICE_PROVIDER',
  'GENERAL_SUPPLIER',
  'CONTRACTOR',
  'SERVICE_PROVIDER',
  'OTHER',
];

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  BLOCKED: 'bg-red-50 text-red-700 border-red-200',
};

const BLANK_FORM: SupplierForm = {
  companyId: '',
  divisionId: '',
  productCategoryIds: [],
  supplierType: 'GENERAL_SUPPLIER',
  supplierCode: '',
  name: '',
  legalName: '',
  tin: '',
  phone: '',
  email: '',
  address: '',
  contactPerson: '',
  creditLimit: '0',
  paymentTerms: '',
  status: 'ACTIVE',
  notes: '',
};

function fmtTZS(n: number) {
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
  );
}

function SupplierModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Supplier;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<SupplierForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: initial.divisionId ?? '',
          productCategoryIds:
            initial.productCategories?.map((item) => item.productCategory.id) ?? [],
          supplierType: initial.supplierType,
          supplierCode: initial.supplierCode ?? '',
          name: initial.name,
          legalName: initial.legalName ?? '',
          tin: initial.tin ?? '',
          phone: initial.phone ?? '',
          email: initial.email ?? '',
          address: initial.address ?? '',
          contactPerson: initial.contactPerson ?? '',
          creditLimit: String(initial.creditLimit ?? 0),
          paymentTerms: initial.paymentTerms ?? '',
          status: initial.status,
          notes: initial.notes ?? '',
        }
      : { ...BLANK_FORM },
  );
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof SupplierForm>(k: K, v: SupplierForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      setCategories([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Division>('/divisions', { query: { companyId: form.companyId, limit: 200 } }),
      backendList<ProductCategory>('/product-categories', {
        query: { companyId: form.companyId, isActive: true, limit: 500 },
      }),
    ]).then(([divisionResult, categoryResult]) => {
      if (cancelled) return;
      setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
      setCategories(categoryResult.status === 'fulfilled' ? categoryResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const toggleCategory = (id: string) =>
    setForm((f) => ({
      ...f,
      productCategoryIds: f.productCategoryIds.includes(id)
        ? f.productCategoryIds.filter((categoryId) => categoryId !== id)
        : [...f.productCategoryIds, id],
    }));

  const handleSubmit = async () => {
    if (!form.companyId) {
      setError('Company is required');
      return;
    }
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.divisionId) {
      setError('Division is required');
      return;
    }
    if (form.productCategoryIds.length === 0) {
      setError('Select at least one product category this supplier serves');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        divisionId: form.divisionId,
        productCategoryIds: form.productCategoryIds,
        supplierType: form.supplierType,
        name: form.name,
        status: form.status,
        creditLimit: Number(form.creditLimit) || 0,
      };
      if (form.supplierCode) body.supplierCode = form.supplierCode;
      if (form.legalName) body.legalName = form.legalName;
      if (form.tin) body.tin = form.tin;
      if (form.phone) body.phone = form.phone;
      if (form.email) body.email = form.email;
      if (form.address) body.address = form.address;
      if (form.contactPerson) body.contactPerson = form.contactPerson;
      if (form.paymentTerms) body.paymentTerms = form.paymentTerms;
      if (form.notes) body.notes = form.notes;
      if (mode === 'create') {
        await backendPost('/suppliers', body);
      } else {
        await backendPatch(`/suppliers/${initial!.id}`, body);
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
      title={mode === 'create' ? 'Create Supplier' : 'Edit Supplier'}
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
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              companyId: e.target.value,
              divisionId: '',
              productCategoryIds: [],
            }))
          }
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
          label="Division"
          required
          value={form.divisionId}
          onChange={(e) => set('divisionId', e.target.value)}
          placeholder={form.companyId ? 'Select division' : 'Select company first'}
        >
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name} ({division.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Type"
          required
          value={form.supplierType}
          onChange={(e) => set('supplierType', e.target.value)}
        >
          {SUPPLIER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Supplier Code"
          value={form.supplierCode}
          onChange={(e) => set('supplierCode', e.target.value)}
        />
        <FormInput
          label="Status"
          value={form.status}
          onChange={(e) => set('status', e.target.value)}
          placeholder="ACTIVE / INACTIVE / BLOCKED"
        />
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <FormInput
          label="Legal Name"
          value={form.legalName}
          onChange={(e) => set('legalName', e.target.value)}
        />
        <FormInput label="TIN" value={form.tin} onChange={(e) => set('tin', e.target.value)} />
        <FormInput
          label="Phone"
          value={form.phone}
          onChange={(e) => set('phone', e.target.value)}
        />
        <FormInput
          label="Email"
          value={form.email}
          onChange={(e) => set('email', e.target.value)}
        />
        <FormInput
          label="Contact Person"
          value={form.contactPerson}
          onChange={(e) => set('contactPerson', e.target.value)}
        />
        <FormInput
          label="Credit Limit"
          type="number"
          value={form.creditLimit}
          onChange={(e) => set('creditLimit', e.target.value)}
        />
        <FormInput
          label="Payment Terms"
          value={form.paymentTerms}
          onChange={(e) => set('paymentTerms', e.target.value)}
          placeholder="Net 30, COD, etc."
        />
        <div className="col-span-2">
          <div
            className="rounded-lg border p-3"
            style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-bg-subtle)' }}
          >
            <p className="mb-2 text-xs font-medium" style={{ color: 'var(--aurora-text-secondary)' }}>
              Product Categories *
            </p>
            {categories.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                No categories loaded for this company.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {categories.map((category) => (
                  <label
                    key={category.id}
                    className="flex items-center gap-2 text-sm"
                    style={{ color: 'var(--aurora-text)' }}
                  >
                    <input
                      type="checkbox"
                      checked={form.productCategoryIds.includes(category.id)}
                      onChange={() => toggleCategory(category.id)}
                      className="rounded"
                    />
                    <span>
                      {category.name}
                      <span className="ml-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {category.categoryType.replace(/_/g, ' ')}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="col-span-2">
          <FormTextarea
            label="Address"
            rows={2}
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <FormTextarea
            label="Notes"
            rows={2}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </div>
    </Modal>
  );
}

function DeleteConfirm({
  supplier,
  onClose,
  onConfirmed,
}: {
  supplier: Supplier;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/suppliers/${supplier.id}`);
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
      title="Delete Supplier"
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
        Are you sure you want to delete <strong>{supplier.name}</strong>? This action cannot be
        undone.
      </p>
    </Modal>
  );
}

export default function SuppliersPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Supplier> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [supplierType, setSupplierType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  const canView = hasPermission('suppliers.view');
  const canCreate = hasPermission('suppliers.create');
  const canDelete = hasPermission('suppliers.delete');

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;

    async function loadCompanies() {
      try {
        const records = await backendList<Company>('/companies', { query: { limit: 100 } });
        if (!cancelled) setCompanies(records);
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
    setError('');
    try {
      const result = await backendPage<Supplier>('/suppliers', {
        query: {
          page,
          limit: 20,
          search: search.trim() || undefined,
          companyId: companyId || undefined,
          supplierType: supplierType || undefined,
          status: status || undefined,
        },
      });
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load suppliers');
      setData(emptyPaginated<Supplier>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, page, search, companyId, supplierType, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Suppliers" subtitle="Manage suppliers" />
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

  const activeCount = data?.data.filter((c) => c.status === 'ACTIVE').length ?? 0;
  const blockedCount = data?.data.filter((c) => c.status === 'BLOCKED').length ?? 0;

  return (
    <div className="p-6 space-y-6">
      {creating && (
        <SupplierModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            load();
          }}
        />
      )}
      {editing && (
        <SupplierModal
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
      {deleting && (
        <DeleteConfirm
          supplier={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader title="Suppliers" subtitle="Master data for supplier accounts" />

      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Total" value={data?.total ?? 0} />
        <StatCard label="Active (page)" value={activeCount} />
        <StatCard label="Blocked (page)" value={blockedCount} />
        <StatCard label="Page" value={data ? `${data.page}/${data.totalPages}` : '—'} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search name, code, phone…"
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
              value={supplierType}
              onChange={(e) => {
                setSupplierType(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {SUPPLIER_TYPES.map((t) => (
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
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="BLOCKED">Blocked</option>
            </select>
          </>
        }
        actions={
          canCreate ? (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Supplier
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
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Division</th>
                <th className="px-4 py-3">Product Categories</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3 text-right">Credit Limit</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Status</th>
                {(canCreate || canDelete) && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={10}>
                    <PageSpinner />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={10}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No suppliers found
                  </td>
                </tr>
              ) : (
                data.data.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{s.supplierCode ?? '—'}</td>
                    <td className="px-4 py-3 font-medium">{s.name}</td>
                    <td className="px-4 py-3 text-xs">{s.supplierType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs">
                      {s.division ? `${s.division.name}${s.division.code ? ` (${s.division.code})` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {s.productCategories?.length
                        ? s.productCategories.map((item) => item.productCategory.name).join(', ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">{s.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtTZS(s.creditLimit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtTZS(s.currentBalance)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${STATUS_BADGE[s.status] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {s.status}
                      </span>
                    </td>
                    {(canCreate || canDelete) && (
                      <td className="px-4 py-3 text-right space-x-1">
                        {canCreate && (
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(s)}>
                            Edit
                          </Btn>
                        )}
                        {canDelete && (
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(s)}>
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

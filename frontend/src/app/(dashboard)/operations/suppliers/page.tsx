'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Btn,
  Card,
  FormInput,
  FormSelect,
  FormTextarea,
  Modal,
  PageHeader,
  PageToolbar,
  SkeletonTable,
  StatCard,
  StatusBadge,
  showToast,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import {
  backendDelete,
  backendGet,
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
  vrn?: string | null;
  creditLimit: number;
  currentBalance: number;
  paymentTerms?: string | null;
  status: string;
  notes?: string | null;
  companyId: string;
  company?: { name: string; code?: string | null } | null;
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
  vrn: string;
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

interface WorkbenchSummary {
  total: number;
  active: number;
  blocked: number;
  inactive: number;
  currentBalance: number;
  openPayableBalance: number;
  overduePayableBalance: number;
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

const SUPPLIER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

const BLANK_FORM: SupplierForm = {
  companyId: '',
  divisionId: '',
  productCategoryIds: [],
  supplierType: 'GENERAL_SUPPLIER',
  supplierCode: '',
  name: '',
  legalName: '',
  tin: '',
  vrn: '',
  phone: '',
  email: '',
  address: '',
  contactPerson: '',
  creditLimit: '0',
  paymentTerms: '',
  status: 'ACTIVE',
  notes: '',
};

function fmtMoney(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0)
  );
}

function humanize(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

function categoryGroups(categories: ProductCategory[]) {
  return categories.reduce<Record<string, ProductCategory[]>>((groups, category) => {
    const key = category.categoryType || 'OTHER';
    groups[key] = groups[key] ?? [];
    groups[key].push(category);
    return groups;
  }, {});
}

function SectionTitle({ title, description }: { title: string; description?: string }) {
  return (
    <div className="col-span-2 border-t pt-4" style={{ borderColor: 'var(--aurora-border)' }}>
      <h3 className="text-sm font-semibold" style={{ color: 'var(--aurora-text)' }}>
        {title}
      </h3>
      {description && (
        <p className="mt-1 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
          {description}
        </p>
      )}
    </div>
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
          vrn: initial.vrn ?? '',
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
  const [categorySearch, setCategorySearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof SupplierForm>(k: K, v: SupplierForm[K]) =>
    setForm((current) => ({ ...current, [k]: v }));

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      setCategories([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Division>('/divisions', { query: { companyId: form.companyId, limit: 500 } }),
      backendList<ProductCategory>('/product-categories', {
        query: { companyId: form.companyId, limit: 5000 },
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

  const filteredCategories = useMemo(() => {
    const search = categorySearch.trim().toLowerCase();
    return categories
      .filter((category) => !search || category.name.toLowerCase().includes(search))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [categories, categorySearch]);

  const groupedCategories = useMemo(
    () => categoryGroups(filteredCategories),
    [filteredCategories],
  );

  const toggleCategory = (id: string) =>
    setForm((current) => ({
      ...current,
      productCategoryIds: current.productCategoryIds.includes(id)
        ? current.productCategoryIds.filter((categoryId) => categoryId !== id)
        : [...current.productCategoryIds, id],
    }));

  const handleSubmit = async () => {
    if (!form.companyId) return setError('Company is required');
    if (!form.divisionId) return setError('Division is required');
    if (!form.name.trim()) return setError('Supplier name is required');
    if (form.productCategoryIds.length === 0) {
      return setError('Select at least one product category this supplier serves');
    }

    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        divisionId: form.divisionId,
        productCategoryIds: form.productCategoryIds,
        supplierType: form.supplierType,
        name: form.name.trim(),
        status: form.status,
        creditLimit: Number(form.creditLimit) || 0,
      };
      if (form.supplierCode.trim()) body.supplierCode = form.supplierCode.trim();
      if (form.legalName.trim()) body.legalName = form.legalName.trim();
      if (form.tin.trim()) body.tin = form.tin.trim();
      if (form.vrn.trim()) body.vrn = form.vrn.trim();
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.email.trim()) body.email = form.email.trim();
      if (form.address.trim()) body.address = form.address.trim();
      if (form.contactPerson.trim()) body.contactPerson = form.contactPerson.trim();
      if (form.paymentTerms.trim()) body.paymentTerms = form.paymentTerms.trim();
      if (form.notes.trim()) body.notes = form.notes.trim();

      if (mode === 'create') {
        await backendPost('/suppliers', body);
      } else {
        await backendPatch(`/suppliers/${initial!.id}`, body);
      }
      showToast('success', mode === 'create' ? 'Supplier created' : 'Supplier updated', form.name);
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save supplier';
      setError(message);
      showToast('error', 'Could not save supplier', message);
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
            {mode === 'create' ? 'Create Supplier' : 'Save Changes'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-4 rounded-lg border border-red-300 bg-red-950/20 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SectionTitle title="Scope" description="Supplier visibility and procurement ownership." />
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              companyId: event.target.value,
              divisionId: '',
              productCategoryIds: [],
            }))
          }
          placeholder="Select company"
          disabled={mode === 'edit'}
        >
          {companies.map((company) => (
            <option key={company.id} value={company.id}>
              {company.name} ({company.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Division"
          required
          value={form.divisionId}
          onChange={(event) => set('divisionId', event.target.value)}
          placeholder={form.companyId ? 'Select division' : 'Select company first'}
        >
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name} ({division.code})
            </option>
          ))}
        </FormSelect>

        <SectionTitle title="Supplier Identity" description="Core supplier master data." />
        <FormSelect
          label="Type"
          required
          value={form.supplierType}
          onChange={(event) => set('supplierType', event.target.value)}
        >
          {SUPPLIER_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanize(type)}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Supplier Code"
          value={form.supplierCode}
          onChange={(event) => set('supplierCode', event.target.value)}
          placeholder="Auto-generated when blank"
        />
        <FormInput
          label="Name"
          required
          value={form.name}
          onChange={(event) => set('name', event.target.value)}
        />
        <FormInput
          label="Legal Name"
          value={form.legalName}
          onChange={(event) => set('legalName', event.target.value)}
        />

        <SectionTitle title="Contact & Tax" description="Information used on purchasing documents." />
        <FormInput label="TIN" value={form.tin} onChange={(event) => set('tin', event.target.value)} />
        <FormInput label="VRN" value={form.vrn} onChange={(event) => set('vrn', event.target.value)} />
        <FormInput
          label="Phone"
          value={form.phone}
          onChange={(event) => set('phone', event.target.value)}
        />
        <FormInput
          label="Email"
          type="email"
          value={form.email}
          onChange={(event) => set('email', event.target.value)}
        />
        <FormInput
          label="Contact Person"
          value={form.contactPerson}
          onChange={(event) => set('contactPerson', event.target.value)}
        />
        <FormTextarea
          label="Address"
          rows={2}
          value={form.address}
          onChange={(event) => set('address', event.target.value)}
        />

        <SectionTitle
          title="Product Categories"
          description="Controls which product categories this supplier can serve."
        />
        <div className="md:col-span-2 rounded-lg border p-3" style={{ borderColor: 'var(--aurora-border)' }}>
          <FormInput
            label="Search Categories"
            value={categorySearch}
            onChange={(event) => setCategorySearch(event.target.value)}
            placeholder="Search category name..."
          />
          <div className="mt-3 max-h-64 space-y-4 overflow-auto pr-1">
            {Object.entries(groupedCategories).map(([type, rows]) => (
              <div key={type}>
                <p className="mb-2 text-xs font-semibold uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                  {humanize(type)}
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {rows.map((category) => (
                    <label key={category.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.productCategoryIds.includes(category.id)}
                        onChange={() => toggleCategory(category.id)}
                        className="rounded"
                      />
                      <span style={{ color: 'var(--aurora-text)' }}>{category.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {filteredCategories.length === 0 && (
              <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                No categories match this search.
              </p>
            )}
          </div>
        </div>

        <SectionTitle title="Credit & Terms" description="Operational terms, not bank details." />
        <FormInput
          label="Credit Limit"
          type="number"
          value={form.creditLimit}
          onChange={(event) => set('creditLimit', event.target.value)}
        />
        <FormInput
          label="Payment Terms"
          value={form.paymentTerms}
          onChange={(event) => set('paymentTerms', event.target.value)}
          placeholder="Net 30, COD, etc."
        />
        <FormSelect
          label="Status"
          required
          value={form.status}
          onChange={(event) => set('status', event.target.value)}
        >
          {SUPPLIER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </FormSelect>
        <FormTextarea
          label="Notes"
          rows={2}
          value={form.notes}
          onChange={(event) => set('notes', event.target.value)}
        />
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
      showToast('success', 'Supplier deleted', supplier.name);
      onConfirmed();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete supplier';
      setError(message);
      showToast('error', 'Could not delete supplier', message);
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
      {error && <div className="mb-3 rounded-lg border border-red-300 px-3 py-2 text-sm text-red-200">{error}</div>}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Delete <strong>{supplier.name}</strong>? Suppliers linked to historical purchases remain
        preserved in those documents, but this supplier will no longer be selectable.
      </p>
    </Modal>
  );
}

export default function SuppliersPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [summary, setSummary] = useState<WorkbenchSummary | null>(null);
  const [data, setData] = useState<Paginated<Supplier> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierType, setSupplierType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [deleting, setDeleting] = useState<Supplier | null>(null);

  const canView = hasPermission('suppliers.view');
  const canCreate = hasPermission('suppliers.create');
  const canUpdate = hasPermission('suppliers.update') || canCreate;
  const canDelete = hasPermission('suppliers.delete');

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    Promise.allSettled([
      backendList<Company>('/companies', { query: { limit: 500 } }),
      backendList<ProductCategory>('/product-categories', { query: { limit: 5000 } }),
    ]).then(([companyResult, categoryResult]) => {
      if (cancelled) return;
      setCompanies(companyResult.status === 'fulfilled' ? companyResult.value : []);
      setCategories(categoryResult.status === 'fulfilled' ? categoryResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setDivisionId('');
      return;
    }
    let cancelled = false;
    backendList<Division>('/divisions', { query: { companyId, limit: 500 } })
      .then((rows) => {
        if (!cancelled) setDivisions(rows);
      })
      .catch(() => {
        if (!cancelled) setDivisions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const query = useMemo(
    () => ({
      search: search.trim() || undefined,
      companyId: companyId || undefined,
      divisionId: divisionId || undefined,
      productCategoryId: categoryId || undefined,
      supplierType: supplierType || undefined,
      status: status || undefined,
    }),
    [categoryId, companyId, divisionId, search, status, supplierType],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const [listResult, summaryResult] = await Promise.all([
        backendPage<Supplier>('/suppliers', { query: { ...query, page, limit: 20 } }),
        backendGet<WorkbenchSummary>('/suppliers/workbench-summary', { query }),
      ]);
      setData(listResult);
      setSummary(summaryResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load suppliers';
      setError(message);
      setData(emptyPaginated<Supplier>(page));
      setSummary(null);
      showToast('error', 'Could not load suppliers', message);
    } finally {
      setLoading(false);
    }
  }, [canView, page, query]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStatusToggle = async (supplier: Supplier) => {
    const nextStatus = supplier.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    try {
      await backendPatch(`/suppliers/${supplier.id}`, {
        companyId: supplier.companyId,
        status: nextStatus,
      });
      showToast('success', nextStatus === 'BLOCKED' ? 'Supplier blocked' : 'Supplier unblocked', supplier.name);
      load();
    } catch (err) {
      showToast('error', 'Could not update supplier status', err instanceof Error ? err.message : 'Failed');
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Suppliers" subtitle="Supplier control center" />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted.
        </p>
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
    <div className="space-y-6 p-6">
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

      <PageHeader
        title="Suppliers"
        subtitle="Supplier profiles, purchase exposure, payables, statements, and performance"
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <StatCard label="Total Suppliers" value={summary?.total ?? data?.total ?? 0} />
        <StatCard label="Active" value={summary?.active ?? 0} />
        <StatCard label="Blocked" value={summary?.blocked ?? 0} />
        <StatCard label="Open AP" value={fmtMoney(summary?.openPayableBalance)} />
        <StatCard label="Overdue AP" value={fmtMoney(summary?.overduePayableBalance)} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search supplier, code, phone, email, TIN..."
        filters={
          <>
            <select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setDivisionId('');
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Companies</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
            <select
              value={divisionId}
              onChange={(event) => {
                setDivisionId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
              disabled={!companyId}
            >
              <option value="">All Divisions</option>
              {divisions.map((division) => (
                <option key={division.id} value={division.id}>
                  {division.name}
                </option>
              ))}
            </select>
            <select
              value={categoryId}
              onChange={(event) => {
                setCategoryId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
            <select
              value={supplierType}
              onChange={(event) => {
                setSupplierType(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {SUPPLIER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {humanize(type)}
                </option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Status</option>
              {SUPPLIER_STATUSES.map((row) => (
                <option key={row} value={row}>
                  {humanize(row)}
                </option>
              ))}
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
        <div role="alert" className="rounded-lg border border-red-300 bg-red-950/20 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1180px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Supplier</th>
                <th className="px-4 py-3">Scope</th>
                <th className="px-4 py-3">Categories</th>
                <th className="px-4 py-3">Contact</th>
                <th className="px-4 py-3 text-right">Credit Limit</th>
                <th className="px-4 py-3 text-right">Current Balance</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: 'var(--aurora-border)' }}>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <SkeletonTable rows={6} cols={8} />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
                    No suppliers found
                  </td>
                </tr>
              ) : (
                data.data.map((supplier) => (
                  <tr key={supplier.id} className="align-top">
                    <td className="px-4 py-3">
                      <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {supplier.name}
                      </div>
                      <div className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {supplier.supplierCode ?? 'No code'} · {humanize(supplier.supplierType)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{supplier.company?.name ?? '—'}</div>
                      <div style={{ color: 'var(--aurora-text-muted)' }}>
                        {supplier.division
                          ? `${supplier.division.name}${supplier.division.code ? ` (${supplier.division.code})` : ''}`
                          : 'No division'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {supplier.productCategories?.length
                        ? supplier.productCategories.map((item) => item.productCategory.name).join(', ')
                        : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div>{supplier.phone ?? supplier.email ?? '—'}</div>
                      <div style={{ color: 'var(--aurora-text-muted)' }}>
                        {supplier.contactPerson ?? supplier.tin ?? ''}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(supplier.creditLimit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(supplier.currentBalance)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={supplier.status} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() => router.push(`/operations/suppliers/${supplier.id}`)}
                        >
                          View
                        </Btn>
                        {canUpdate && (
                          <>
                            <Btn variant="ghost" size="xs" onClick={() => setEditing(supplier)}>
                              Edit
                            </Btn>
                            <Btn
                              variant={supplier.status === 'BLOCKED' ? 'success' : 'warning'}
                              size="xs"
                              onClick={() => handleStatusToggle(supplier)}
                            >
                              {supplier.status === 'BLOCKED' ? 'Unblock' : 'Block'}
                            </Btn>
                          </>
                        )}
                        {canDelete && (
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(supplier)}>
                            Delete
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="flex items-center justify-between border-t px-5 py-3" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
              Page {data.page} of {data.totalPages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                Previous
              </Btn>
              <Btn
                variant="secondary"
                size="xs"
                disabled={page >= data.totalPages}
                onClick={() => setPage((current) => current + 1)}
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

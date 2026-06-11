'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Card,
  PageHeader,
  PageToolbar,
  StatCard,
  Modal,
  Btn,
  SkeletonTable,
  FormInput,
  FormSelect,
  FormTextarea,
  showToast,
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

interface Branch {
  id: string;
  name: string;
  code: string;
  divisionId: string;
}

interface Customer {
  id: string;
  customerCode?: string | null;
  name: string;
  legalName?: string | null;
  customerType: string;
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
  branchId?: string | null;
  division?: { name: string; code?: string | null } | null;
  branch?: { name: string; code?: string | null } | null;
}

interface CustomerForm {
  companyId: string;
  divisionId: string;
  branchId: string;
  customerType: string;
  customerCode: string;
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

const CUSTOMER_TYPES = [
  'WALK_IN',
  'INDIVIDUAL',
  'COMPANY',
  'CORPORATE',
  'FLEET',
  'CONTRACTOR',
  'FARM_BUYER',
  'INTERNAL_COMPANY',
  'OTHER',
];

const STATUS_BADGE: Record<string, string> = {
  ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  INACTIVE: 'bg-zinc-100 text-zinc-500 border-zinc-200',
  BLOCKED: 'bg-red-50 text-red-700 border-red-200',
};

const BLANK_FORM: CustomerForm = {
  companyId: '',
  divisionId: '',
  branchId: '',
  customerType: 'INDIVIDUAL',
  customerCode: '',
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

function fmtTZS(n: number | string | null | undefined) {
  const value = Number(n ?? 0);
  return (
    'TZS ' +
    new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number.isFinite(value) ? value : 0,
    )
  );
}

function CustomerModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Customer;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CustomerForm>(() =>
    initial
      ? {
          companyId: initial.companyId,
          divisionId: initial.divisionId ?? '',
          branchId: initial.branchId ?? '',
          customerType: initial.customerType,
          customerCode: initial.customerCode ?? '',
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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      setBranches([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Division>('/divisions', { query: { companyId: form.companyId, limit: 200 } }),
      backendList<Branch>('/branches', {
        query: { companyId: form.companyId, activeOnly: true, limit: 500 },
      }),
    ]).then(([divisionResult, branchResult]) => {
      if (cancelled) return;
      setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
      setBranches(branchResult.status === 'fulfilled' ? branchResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [form.companyId]);

  const divisionBranches = branches.filter((branch) => branch.divisionId === form.divisionId);

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
    if (!form.branchId) {
      setError('Branch/location is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        divisionId: form.divisionId,
        branchId: form.branchId,
        customerType: form.customerType,
        name: form.name,
        status: form.status,
        creditLimit: Number(form.creditLimit) || 0,
      };
      if (form.customerCode) body.customerCode = form.customerCode;
      if (form.legalName) body.legalName = form.legalName;
      if (form.tin) body.tin = form.tin;
      if (form.phone) body.phone = form.phone;
      if (form.email) body.email = form.email;
      if (form.address) body.address = form.address;
      if (form.contactPerson) body.contactPerson = form.contactPerson;
      if (form.paymentTerms) body.paymentTerms = form.paymentTerms;
      if (form.notes) body.notes = form.notes;
      if (mode === 'create') {
        await backendPost('/customers', body);
      } else {
        await backendPatch(`/customers/${initial!.id}`, body);
      }
      showToast('success', mode === 'create' ? 'Customer created' : 'Customer updated', form.name.trim());
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
      showToast('error', 'Could not save customer', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'Create Customer' : 'Edit Customer'}
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
              branchId: '',
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
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              divisionId: e.target.value,
              branchId: '',
            }))
          }
          placeholder={form.companyId ? 'Select division' : 'Select company first'}
        >
          {divisions.map((division) => (
            <option key={division.id} value={division.id}>
              {division.name} ({division.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Branch / Location"
          required
          value={form.branchId}
          onChange={(e) => set('branchId', e.target.value)}
          placeholder={form.divisionId ? 'Select branch' : 'Select division first'}
          disabled={!form.divisionId}
        >
          {divisionBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name} ({branch.code})
            </option>
          ))}
        </FormSelect>
        <FormSelect
          label="Type"
          required
          value={form.customerType}
          onChange={(e) => set('customerType', e.target.value)}
        >
          {CUSTOMER_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, ' ')}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Customer Code"
          value={form.customerCode}
          onChange={(e) => set('customerCode', e.target.value)}
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
  customer,
  onClose,
  onConfirmed,
}: {
  customer: Customer;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true);
    setError('');
    try {
      await backendDelete(`/customers/${customer.id}`);
      showToast('success', 'Customer deleted', customer.name);
      onConfirmed();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed';
      setError(message);
      showToast('error', 'Could not delete customer', message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Delete Customer"
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
        Are you sure you want to delete <strong>{customer.name}</strong>? This action cannot be
        undone.
      </p>
    </Modal>
  );
}

export default function CustomersPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Customer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);

  const canView = hasPermission('customers.view');
  const canCreate = hasPermission('customers.create');
  const canDelete = hasPermission('customers.delete');

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
      const result = await backendPage<Customer>('/customers', {
        query: {
          page,
          limit: 20,
          search: search.trim() || undefined,
          companyId: companyId || undefined,
          customerType: customerType || undefined,
          status: status || undefined,
        },
      });
      setData(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load customers';
      setError(message);
      showToast('error', 'Could not load customers', message);
      setData(emptyPaginated<Customer>(page));
    } finally {
      setLoading(false);
    }
  }, [canView, page, search, companyId, customerType, status]);

  useEffect(() => {
    load();
  }, [load]);

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Customers" subtitle="Manage customers" />
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
        <CustomerModal
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
        <CustomerModal
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
          customer={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => {
            setDeleting(null);
            load();
          }}
        />
      )}

      <PageHeader title="Customers" subtitle="Master data for customer accounts" />

      <div className="grid grid-cols-4 gap-3 aurora-stagger">
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
              value={customerType}
              onChange={(e) => {
                setCustomerType(e.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {CUSTOMER_TYPES.map((t) => (
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
              + New Customer
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
          <table className="w-full text-sm min-w-[1050px]">
            <thead>
              <tr
                className="text-left text-xs uppercase bg-gray-50"
                style={{ color: 'var(--aurora-text-muted)' }}
              >
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Branch / Division</th>
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
                  <td colSpan={9}>
                    <SkeletonTable rows={6} cols={9} />
                  </td>
                </tr>
              ) : !data?.data.length ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-10 text-center text-sm"
                    style={{ color: 'var(--aurora-text-muted)' }}
                  >
                    No customers found
                  </td>
                </tr>
              ) : (
                data.data.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs">{c.customerCode ?? '—'}</td>
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 text-xs">{c.customerType.replace(/_/g, ' ')}</td>
                    <td className="px-4 py-3 text-xs">
                      <div>{c.branch?.name ?? '—'}</div>
                      <div style={{ color: 'var(--aurora-text-muted)' }}>
                        {c.division?.name ?? 'No division'}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">{c.phone ?? '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{fmtTZS(c.creditLimit)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtTZS(c.currentBalance)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs border ${STATUS_BADGE[c.status] ?? 'bg-zinc-50 text-zinc-700 border-zinc-200'}`}
                      >
                        {c.status}
                      </span>
                    </td>
                    {(canCreate || canDelete) && (
                      <td className="px-4 py-3 text-right space-x-1">
                        {canCreate && (
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(c)}>
                            Edit
                          </Btn>
                        )}
                        {canDelete && (
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(c)}>
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

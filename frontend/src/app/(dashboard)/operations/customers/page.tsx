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
  vrn?: string | null;
  creditLimit: number;
  currentBalance: number;
  paymentTerms?: string | null;
  status: string;
  notes?: string | null;
  companyId: string;
  company?: { name: string; code?: string | null } | null;
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
  creditLimit: number;
  currentBalance: number;
  openReceivableBalance: number;
  overdueReceivableBalance: number;
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

const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'];

const BLANK_FORM: CustomerForm = {
  companyId: '',
  divisionId: '',
  branchId: '',
  customerType: 'INDIVIDUAL',
  customerCode: '',
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

function emptyPaginated<T>(page = 1): Paginated<T> {
  return { data: [], total: 0, page, totalPages: 1 };
}

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
  const [branches, setBranches] = useState<Branch[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = <K extends keyof CustomerForm>(key: K, value: CustomerForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!form.companyId) {
      setDivisions([]);
      setBranches([]);
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Division>('/divisions', { query: { companyId: form.companyId, limit: 500 } }),
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

  const divisionBranches = useMemo(
    () => branches.filter((branch) => branch.divisionId === form.divisionId),
    [branches, form.divisionId],
  );

  const handleSubmit = async () => {
    if (!form.companyId) return setError('Company is required');
    if (!form.divisionId) return setError('Division is required');
    if (!form.branchId) return setError('Branch/location is required');
    if (!form.name.trim()) return setError('Customer name is required');

    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        divisionId: form.divisionId,
        branchId: form.branchId,
        customerType: form.customerType,
        name: form.name.trim(),
        status: form.status,
        creditLimit: Number(form.creditLimit) || 0,
      };
      if (form.customerCode.trim()) body.customerCode = form.customerCode.trim();
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
        await backendPost('/customers', body);
      } else {
        await backendPatch(`/customers/${initial!.id}`, body);
      }
      showToast(
        'success',
        mode === 'create' ? 'Customer created' : 'Customer updated',
        form.name.trim(),
      );
      onSaved();
    } catch (err) {
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
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <SectionTitle
          title="Scope"
          description="Defines where this customer can be used for sales and receivables."
        />
        <FormSelect
          label="Company"
          required
          value={form.companyId}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              companyId: event.target.value,
              divisionId: '',
              branchId: '',
            }))
          }
          disabled={mode === 'edit'}
          placeholder="Select company"
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
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              divisionId: event.target.value,
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
          onChange={(event) => set('branchId', event.target.value)}
          placeholder={form.divisionId ? 'Select branch' : 'Select division first'}
          disabled={!form.divisionId}
        >
          {divisionBranches.map((branch) => (
            <option key={branch.id} value={branch.id}>
              {branch.name} ({branch.code})
            </option>
          ))}
        </FormSelect>

        <SectionTitle title="Customer Identity" />
        <FormSelect
          label="Type"
          required
          value={form.customerType}
          onChange={(event) => set('customerType', event.target.value)}
        >
          {CUSTOMER_TYPES.map((type) => (
            <option key={type} value={type}>
              {humanize(type)}
            </option>
          ))}
        </FormSelect>
        <FormInput
          label="Customer Code"
          value={form.customerCode}
          onChange={(event) => set('customerCode', event.target.value)}
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

        <SectionTitle title="Contact & Tax" />
        <FormInput label="TIN" value={form.tin} onChange={(event) => set('tin', event.target.value)} />
        <FormInput label="VRN" value={form.vrn} onChange={(event) => set('vrn', event.target.value)} />
        <FormInput
          label="Phone"
          value={form.phone}
          onChange={(event) => set('phone', event.target.value)}
        />
        <FormInput
          label="Email"
          value={form.email}
          onChange={(event) => set('email', event.target.value)}
        />
        <FormInput
          label="Contact Person"
          value={form.contactPerson}
          onChange={(event) => set('contactPerson', event.target.value)}
        />
        <div className="md:col-span-2">
          <FormTextarea
            label="Address"
            rows={2}
            value={form.address}
            onChange={(event) => set('address', event.target.value)}
          />
        </div>

        <SectionTitle
          title="Credit & Terms"
          description="Balances are calculated from receivables. Only the credit limit and terms are edited here."
        />
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

        <SectionTitle title="Status & Notes" />
        <FormSelect
          label="Status"
          required
          value={form.status}
          onChange={(event) => set('status', event.target.value)}
        >
          {CUSTOMER_STATUSES.map((status) => (
            <option key={status} value={status}>
              {humanize(status)}
            </option>
          ))}
        </FormSelect>
        <div />
        <div className="md:col-span-2">
          <FormTextarea
            label="Notes"
            rows={3}
            value={form.notes}
            onChange={(event) => set('notes', event.target.value)}
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
    } catch (err) {
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
        <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Are you sure you want to delete <strong>{customer.name}</strong>?
      </p>
    </Modal>
  );
}

export default function CustomersPage() {
  const router = useRouter();
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [divisions, setDivisions] = useState<Division[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [data, setData] = useState<Paginated<Customer> | null>(null);
  const [summary, setSummary] = useState<WorkbenchSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [customerType, setCustomerType] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState<Customer | null>(null);

  const canView = hasPermission('customers.view');
  const canCreate = hasPermission('customers.create');
  const canUpdate = hasPermission('customers.update') || canCreate;
  const canDelete = hasPermission('customers.delete');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    backendList<Company>('/companies', { query: { limit: 500 } })
      .then((records) => {
        if (!cancelled) setCompanies(records);
      })
      .catch(() => {
        if (!cancelled) setCompanies([]);
      });
    return () => {
      cancelled = true;
    };
  }, [canView]);

  useEffect(() => {
    if (!companyId) {
      setDivisions([]);
      setBranches([]);
      setDivisionId('');
      setBranchId('');
      return;
    }
    let cancelled = false;
    Promise.allSettled([
      backendList<Division>('/divisions', { query: { companyId, limit: 500 } }),
      backendList<Branch>('/branches', { query: { companyId, activeOnly: true, limit: 500 } }),
    ]).then(([divisionResult, branchResult]) => {
      if (cancelled) return;
      setDivisions(divisionResult.status === 'fulfilled' ? divisionResult.value : []);
      setBranches(branchResult.status === 'fulfilled' ? branchResult.value : []);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const filteredBranches = useMemo(
    () => branches.filter((branch) => !divisionId || branch.divisionId === divisionId),
    [branches, divisionId],
  );

  const query = useMemo(
    () => ({
      search: debouncedSearch || undefined,
      companyId: companyId || undefined,
      divisionId: divisionId || undefined,
      branchId: branchId || undefined,
      customerType: customerType || undefined,
      status: status || undefined,
    }),
    [branchId, companyId, customerType, debouncedSearch, divisionId, status],
  );

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setError('');
    try {
      const [listResult, summaryResult] = await Promise.all([
        backendPage<Customer>('/customers', { query: { ...query, page, limit: 20 } }),
        backendGet<WorkbenchSummary>('/customers/workbench-summary', { query }),
      ]);
      setData(listResult);
      setSummary(summaryResult);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load customers';
      setError(message);
      setData(emptyPaginated<Customer>(page));
      setSummary(null);
      showToast('error', 'Could not load customers', message);
    } finally {
      setLoading(false);
    }
  }, [canView, page, query]);

  useEffect(() => {
    load();
  }, [load]);

  const handleStatusToggle = async (customer: Customer) => {
    const nextStatus = customer.status === 'BLOCKED' ? 'ACTIVE' : 'BLOCKED';
    try {
      await backendPatch(`/customers/${customer.id}`, {
        companyId: customer.companyId,
        status: nextStatus,
      });
      showToast('success', nextStatus === 'BLOCKED' ? 'Customer blocked' : 'Customer unblocked', customer.name);
      load();
    } catch (err) {
      showToast('error', 'Could not update customer status', err instanceof Error ? err.message : 'Failed');
    }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Customers" subtitle="Customer control center" />
        <p className="mt-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
          Access restricted.
        </p>
      </div>
    );
  }

  const filterSelectCls =
    'rounded-lg border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = {
    borderColor: 'var(--aurora-border)',
    background: 'var(--aurora-card)',
    color: 'var(--aurora-text)',
  } as const;

  return (
    <div className="space-y-6 p-6">
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

      <PageHeader
        title="Customers"
        subtitle="Customer profiles, sales, receivables, credit exposure, statements, and pricing"
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <StatCard label="Total Customers" value={summary?.total ?? data?.total ?? 0} />
        <StatCard label="Active" value={summary?.active ?? 0} />
        <StatCard label="Blocked" value={summary?.blocked ?? 0} />
        <StatCard label="Open AR" value={fmtMoney(summary?.openReceivableBalance)} />
        <StatCard label="Overdue AR" value={fmtMoney(summary?.overdueReceivableBalance)} />
      </div>

      <PageToolbar
        search={search}
        onSearch={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search name, code, contact, phone, TIN or VRN..."
        filters={
          <>
            <select
              value={companyId}
              onChange={(event) => {
                setCompanyId(event.target.value);
                setDivisionId('');
                setBranchId('');
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
                setBranchId('');
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
              value={branchId}
              onChange={(event) => {
                setBranchId(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
              disabled={!companyId}
            >
              <option value="">All Branches</option>
              {filteredBranches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
            <select
              value={customerType}
              onChange={(event) => {
                setCustomerType(event.target.value);
                setPage(1);
              }}
              className={filterSelectCls}
              style={filterStyle}
            >
              <option value="">All Types</option>
              {CUSTOMER_TYPES.map((type) => (
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
              {CUSTOMER_STATUSES.map((item) => (
                <option key={item} value={item}>
                  {humanize(item)}
                </option>
              ))}
            </select>
          </>
        }
        actions={
          canCreate && (
            <Btn variant="primary" onClick={() => setCreating(true)}>
              + New Customer
            </Btn>
          )
        }
      />

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        {loading ? (
          <SkeletonTable rows={8} cols={8} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1180px] text-sm">
              <thead>
                <tr
                  className="text-left text-xs uppercase"
                  style={{ background: 'var(--aurora-panel)', color: 'var(--aurora-text-muted)' }}
                >
                  <th className="px-4 py-3">Customer</th>
                  <th className="px-4 py-3">Scope</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Contact</th>
                  <th className="px-4 py-3 text-right">Credit Limit</th>
                  <th className="px-4 py-3 text-right">AR Balance</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(data?.data ?? []).map((customer) => (
                  <tr key={customer.id} className="border-t" style={{ borderColor: 'var(--aurora-border)' }}>
                    <td className="px-4 py-4">
                      <div className="font-semibold" style={{ color: 'var(--aurora-text)' }}>
                        {customer.name}
                      </div>
                      <div className="font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {customer.customerCode ?? 'No code'}
                      </div>
                      {customer.legalName && (
                        <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                          {customer.legalName}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div>{customer.company?.name ?? 'Company'}</div>
                      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {customer.division?.name ?? 'No division'} - {customer.branch?.name ?? 'No branch'}
                      </div>
                    </td>
                    <td className="px-4 py-4">{humanize(customer.customerType)}</td>
                    <td className="px-4 py-4">
                      <div>{customer.phone ?? 'No phone'}</div>
                      <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>
                        {customer.email ?? customer.contactPerson ?? 'No contact'}
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">{fmtMoney(customer.creditLimit)}</td>
                    <td className="px-4 py-4 text-right">{fmtMoney(customer.currentBalance)}</td>
                    <td className="px-4 py-4">
                      <StatusBadge status={customer.status} />
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Btn
                          variant="secondary"
                          size="xs"
                          onClick={() => router.push(`/operations/customers/${customer.id}`)}
                        >
                          View
                        </Btn>
                        {canUpdate && (
                          <>
                            <Btn variant="secondary" size="xs" onClick={() => setEditing(customer)}>
                              Edit
                            </Btn>
                            <Btn
                              variant={customer.status === 'BLOCKED' ? 'success' : 'warning'}
                              size="xs"
                              onClick={() => handleStatusToggle(customer)}
                            >
                              {customer.status === 'BLOCKED' ? 'Unblock' : 'Block'}
                            </Btn>
                          </>
                        )}
                        {canDelete && (
                          <Btn variant="danger" size="xs" onClick={() => setDeleting(customer)}>
                            Delete
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {data?.data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center" style={{ color: 'var(--aurora-text-muted)' }}>
                      No customers found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>
            Page {data.page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Btn
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((current) => Math.max(1, current - 1))}
            >
              Previous
            </Btn>
            <Btn
              variant="secondary"
              disabled={page >= data.totalPages}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { ResponsiveDataTable } from '@/components/aurora';
import type { ResponsiveColumn } from '@/components/aurora';
import { Modal, Btn, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { backendPost, backendPut, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface CreditProfileRow extends Record<string, unknown> {
  id: string;
  companyId?: string;
  customerId?: string;
  creditLimit?: number | string | null;
  currency?: string | null;
  paymentTermsDays?: number | null;
  riskRating?: string | null;
  creditStatus?: string | null;
  currentOutstanding?: number | string | null;
  overdueAmount?: number | string | null;
  notes?: string | null;
}

interface Company {
  id: string;
  name: string;
}

interface CustomerOption {
  id: string;
  customerCode?: string | null;
  name: string;
}

const RISK_RATINGS = ['LOW', 'MEDIUM', 'HIGH', 'BLOCKED', 'UNKNOWN'];
const CREDIT_STATUSES = ['ACTIVE', 'SUSPENDED', 'BLOCKED', 'REVIEW_REQUIRED'];

function riskClasses(risk?: string | null): string {
  if (risk === 'HIGH') return 'bg-red-100 text-red-700';
  if (risk === 'MEDIUM') return 'bg-yellow-100 text-yellow-700';
  return 'bg-green-100 text-green-700';
}

function statusClasses(status?: string | null): string {
  if (status === 'ACTIVE') return 'bg-green-100 text-green-700';
  if (status === 'BLOCKED') return 'bg-red-100 text-red-700';
  return 'bg-gray-100 text-gray-600';
}

interface ProfileForm {
  companyId: string;
  customerId: string;
  creditLimit: string;
  currency: string;
  paymentTermsDays: string;
  riskRating: string;
  creditStatus: string;
  notes: string;
}

const BLANK: ProfileForm = {
  companyId: '',
  customerId: '',
  creditLimit: '',
  currency: 'TZS',
  paymentTermsDays: '',
  riskRating: 'UNKNOWN',
  creditStatus: 'ACTIVE',
  notes: '',
};

function ProfileModal({
  mode,
  initial,
  companies,
  onClose,
  onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: CreditProfileRow;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProfileForm>(() =>
    initial
      ? {
          companyId: initial.companyId ?? '',
          customerId: initial.customerId ?? '',
          creditLimit: initial.creditLimit != null ? String(initial.creditLimit) : '',
          currency: initial.currency ?? 'TZS',
          paymentTermsDays: initial.paymentTermsDays != null ? String(initial.paymentTermsDays) : '',
          riskRating: initial.riskRating ?? 'UNKNOWN',
          creditStatus: initial.creditStatus ?? 'ACTIVE',
          notes: initial.notes ?? '',
        }
      : { ...BLANK },
  );
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof ProfileForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (mode !== 'create') return;
    if (!form.companyId) {
      setCustomers([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/backend/customers?companyId=${encodeURIComponent(form.companyId)}&limit=500`)
      .then((r) => r.json())
      .then((j) => {
        const rows = Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : [];
        if (!cancelled) setCustomers(rows);
      })
      .catch(() => {
        if (!cancelled) setCustomers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mode, form.companyId]);

  const submit = async () => {
    if (mode === 'create' && (!form.companyId || !form.customerId)) {
      setError('Company and customer are required');
      return;
    }
    if (form.creditLimit !== '' && (Number.isNaN(Number(form.creditLimit)) || Number(form.creditLimit) < 0)) {
      setError('Credit limit must be a non-negative amount');
      return;
    }
    if (form.paymentTermsDays !== '' && (!Number.isInteger(Number(form.paymentTermsDays)) || Number(form.paymentTermsDays) < 0)) {
      setError('Payment terms must be a non-negative whole number of days');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        creditLimit: form.creditLimit === '' ? (mode === 'edit' ? 0 : undefined) : Number(form.creditLimit),
        currency: form.currency || undefined,
        paymentTermsDays: form.paymentTermsDays === '' ? (mode === 'edit' ? null : undefined) : Number(form.paymentTermsDays),
        riskRating: form.riskRating,
        creditStatus: form.creditStatus,
        notes: form.notes ? form.notes : mode === 'edit' ? null : undefined,
      };
      if (mode === 'create') {
        await backendPost('/customer-credit-profiles', {
          ...body,
          companyId: form.companyId,
          customerId: form.customerId,
        });
      } else {
        await backendPut(`/customer-credit-profiles/${initial!.id}`, body);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError || err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const companyName = companies.find((c) => c.id === form.companyId)?.name ?? form.companyId;

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Credit Profile' : 'Edit Credit Profile'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        {mode === 'create' ? (
          <>
            <FormSelect label="Company" required value={form.companyId} onChange={(e) => { set('companyId', e.target.value); set('customerId', ''); }} placeholder="Select…">
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </FormSelect>
            <FormSelect label="Customer" required value={form.customerId} onChange={(e) => set('customerId', e.target.value)} placeholder={form.companyId ? 'Select…' : 'Select a company first'} disabled={!form.companyId}>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.customerCode ? `${c.customerCode} — ${c.name}` : c.name}</option>)}
            </FormSelect>
          </>
        ) : (
          <>
            <FormInput label="Company" value={companyName} disabled />
            <FormInput label="Customer" value={form.customerId} disabled />
          </>
        )}
        <FormInput label="Credit Limit" type="number" min={0} step="0.01" value={form.creditLimit} onChange={(e) => set('creditLimit', e.target.value)} />
        <FormInput label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} placeholder="TZS" />
        <FormInput label="Payment Terms (days)" type="number" min={0} step={1} value={form.paymentTermsDays} onChange={(e) => set('paymentTermsDays', e.target.value)} />
        <FormSelect label="Risk Rating" value={form.riskRating} onChange={(e) => set('riskRating', e.target.value)}>
          {RISK_RATINGS.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>
        <FormSelect label="Credit Status" value={form.creditStatus} onChange={(e) => set('creditStatus', e.target.value)}>
          {CREDIT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function CreditProfilesPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('credit_profiles.create');
  const canUpdate = hasPermission('credit_profiles.update');

  const [data, setData] = useState<CreditProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CreditProfileRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/backend/customer-credit-profiles').then((r) => r.json());
      const rows: CreditProfileRow[] = Array.isArray(res.data)
        ? res.data
        : Array.isArray(res.data?.data)
          ? res.data.data
          : Array.isArray(res.data?.items)
            ? res.data.items
            : [];
      setData(rows);
    } catch {
      setError('Failed to load credit profiles');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100')
      .then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []))
      .catch(() => setCompanies([]));
  }, []);

  const onSaved = () => {
    setCreating(false);
    setEditing(null);
    void load();
  };

  const columns: ResponsiveColumn<CreditProfileRow>[] = [
    { key: 'companyId', header: 'Company', priority: 2, accessor: (row) => row.companyId ?? '—' },
    {
      key: 'customerId',
      header: 'Customer',
      priority: 1,
      accessor: (row) => <span className="font-medium">{row.customerId ?? '—'}</span>,
    },
    { key: 'creditLimit', header: 'Credit Limit', priority: 2, accessor: (row) => row.creditLimit ?? '—' },
    { key: 'currency', header: 'Currency', priority: 3, accessor: (row) => row.currency ?? '—' },
    {
      key: 'riskRating',
      header: 'Risk Rating',
      priority: 1,
      accessor: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${riskClasses(row.riskRating)}`}>
          {row.riskRating ?? '—'}
        </span>
      ),
    },
    {
      key: 'creditStatus',
      header: 'Credit Status',
      priority: 1,
      accessor: (row) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusClasses(row.creditStatus)}`}>
          {row.creditStatus ?? '—'}
        </span>
      ),
    },
    {
      key: 'currentOutstanding',
      header: 'Outstanding',
      priority: 2,
      accessor: (row) => <span className="font-medium">{row.currentOutstanding ?? '—'}</span>,
    },
    {
      key: 'overdueAmount',
      header: 'Overdue',
      priority: 2,
      accessor: (row) => <span className="font-medium text-red-600">{row.overdueAmount ?? '—'}</span>,
    },
    ...(canUpdate
      ? [
          {
            key: 'actions',
            header: '',
            priority: 1,
            align: 'right',
            exportExclude: true,
            accessor: (row) => (
              <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>
            ),
          } satisfies ResponsiveColumn<CreditProfileRow>,
        ]
      : []),
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Customer Credit Profiles</h1>
        <p className="text-gray-500 mt-1">Manage customer credit limits and risk ratings</p>
      </div>

      <ResponsiveDataTable<CreditProfileRow>
        columns={columns}
        data={data}
        keyField="id"
        loading={loading}
        error={error}
        onRetry={load}
        errorTitle="Couldn't load credit profiles"
        emptyTitle="No records found"
        emptyDescription="There are no credit profiles to display."
        actions={canCreate ? <Btn variant="primary" size="sm" onClick={() => setCreating(true)}>+ New Profile</Btn> : undefined}
      />

      {creating && <ProfileModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <ProfileModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </div>
  );
}

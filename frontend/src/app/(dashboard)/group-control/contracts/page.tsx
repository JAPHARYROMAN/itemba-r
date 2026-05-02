'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Card, PageHeader, PageToolbar, StatCard, StatusBadge, Btn, PageSpinner,
  Modal, FormInput, FormSelect, FormTextarea,
} from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface Contract {
  id: string;
  title: string;
  contractType: string;
  contractNumber?: string | null;
  counterpartyName: string;
  startDate: string;
  endDate?: string | null;
  value?: string | number | null;
  currency: string;
  status: string;
  riskLevel: string;
  isSensitive?: boolean;
  company?: { id: string; name: string; code: string } | null;
}

interface ContractSummary {
  total: number;
  active: number;
  draft: number;
  pendingApproval: number;
  expired: number;
  expiringSoon: number;
  highRisk: number;
  totalActiveValue: string | number;
  byType?: { contractType: string; count: number }[];
}

interface ExpiringContract { id: string; title: string; endDate?: string | null; daysUntilExpiry: number; counterpartyName?: string }

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const CONTRACT_TYPES = ['SUPPLIER', 'CUSTOMER', 'TRANSPORT', 'CONSTRUCTION', 'FARM_LEASE', 'LAND_AGREEMENT', 'RENTAL', 'EMPLOYMENT', 'LOAN_AGREEMENT', 'INSURANCE', 'SERVICE', 'MAINTENANCE', 'PARTNERSHIP', 'DISTRIBUTION', 'GOVERNMENT_INSTITUTIONAL', 'LEGAL_SETTLEMENT', 'OTHER'];
const STATUSES = ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXPIRED', 'TERMINATED', 'SUSPENDED', 'CANCELLED', 'PENDING_RENEWAL'];
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const OWNERSHIP_LEVELS = ['COMPANY', 'GROUP'];
const CURRENCIES = ['TZS', 'USD', 'EUR', 'GBP', 'KES', 'UGX'];

function fmt(n: number | string) {
  const v = typeof n === 'string' ? Number(n) : n;
  return new Intl.NumberFormat('en-TZ', { maximumFractionDigits: 0 }).format(v || 0);
}

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' });
}

function daysUntil(d?: string | null) {
  if (!d) return Infinity;
  return Math.ceil((new Date(d).getTime() - Date.now()) / 86400000);
}

// ─── Contract Modal ───────────────────────────────────────────────────────────

function ContractModal({
  mode, initial, companies, onClose, onSaved,
}: {
  mode: 'create' | 'edit';
  initial?: Contract;
  companies: Company[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const initialOwning = (initial as any)?.owningLevel ?? ((initial as any)?.companyId ? 'COMPANY' : 'GROUP');
  const [form, setForm] = useState({
    owningLevel: initialOwning,
    companyId: (initial as any)?.companyId ?? '',
    title: initial?.title ?? '',
    contractNumber: initial?.contractNumber ?? '',
    contractType: initial?.contractType ?? 'SUPPLIER',
    counterpartyName: initial?.counterpartyName ?? '',
    counterpartyContact: '',
    counterpartyAddress: '',
    startDate: initial?.startDate?.slice(0, 10) ?? '',
    endDate: initial?.endDate?.slice(0, 10) ?? '',
    renewalDate: '',
    renewalNoticeDate: '',
    autoRenews: false,
    value: initial?.value != null ? String(initial.value) : '',
    currency: initial?.currency ?? 'TZS',
    paymentTerms: '',
    obligations: '',
    status: initial?.status ?? 'DRAFT',
    riskLevel: initial?.riskLevel ?? 'LOW',
    isSensitive: initial?.isSensitive ?? false,
    description: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const setField = <K extends keyof typeof form>(k: K, v: typeof form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.title.trim() || !form.counterpartyName.trim()) {
      setError('Title and counterparty are required');
      return;
    }
    if (mode === 'create' && !form.startDate) {
      setError('Start date is required');
      return;
    }
    if (form.owningLevel === 'COMPANY' && !form.companyId) {
      setError('Pick a company when owning level is COMPANY');
      return;
    }

    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        owningLevel: form.owningLevel,
        title: form.title.trim(),
        contractType: form.contractType,
        counterpartyName: form.counterpartyName.trim(),
        currency: form.currency,
        status: form.status,
        riskLevel: form.riskLevel,
        autoRenews: form.autoRenews,
        isSensitive: form.isSensitive,
      };
      if (form.companyId) body.companyId = form.companyId;
      if (form.contractNumber) body.contractNumber = form.contractNumber;
      if (form.counterpartyContact) body.counterpartyContact = form.counterpartyContact;
      if (form.counterpartyAddress) body.counterpartyAddress = form.counterpartyAddress;
      if (form.startDate) body.startDate = form.startDate;
      if (form.endDate) body.endDate = form.endDate;
      if (form.renewalDate) body.renewalDate = form.renewalDate;
      if (form.renewalNoticeDate) body.renewalNoticeDate = form.renewalNoticeDate;
      if (form.value) body.value = form.value;
      if (form.paymentTerms) body.paymentTerms = form.paymentTerms;
      if (form.obligations) body.obligations = form.obligations;
      if (form.description) body.description = form.description;
      if (form.notes) body.notes = form.notes;

      const url = mode === 'create' ? '/api/backend/contracts' : `/api/backend/contracts/${initial!.id}`;
      const method = mode === 'create' ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const message = (Array.isArray(j?.message) && j.message.join(', ')) || j?.message || `HTTP ${res.status}`;
        throw new Error(message);
      }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={mode === 'create' ? 'New Contract' : 'Edit Contract'}
      subtitle="Legally binding agreement — supplier, customer, transport, employment, etc."
      size="xl"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} loading={saving}>
            {mode === 'create' ? 'Create' : 'Save'}
          </Btn>
        </>
      }
    >
      {error && (
        <div className="mb-3 text-sm rounded-lg px-3 py-2 border" style={{ color: 'var(--aurora-danger)', borderColor: 'var(--aurora-danger)', background: 'var(--aurora-danger-bg, #fef2f2)' }}>
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><FormInput label="Title" required value={form.title} onChange={(e) => setField('title', e.target.value)} /></div>

        <FormSelect label="Owning Level" value={form.owningLevel} onChange={(e) => setField('owningLevel', e.target.value)}>
          {OWNERSHIP_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </FormSelect>
        <FormSelect label="Company" value={form.companyId} onChange={(e) => setField('companyId', e.target.value)} placeholder="— Group level —">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>

        <FormSelect label="Type" value={form.contractType} onChange={(e) => setField('contractType', e.target.value)}>
          {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormInput label="Contract Number" value={form.contractNumber} onChange={(e) => setField('contractNumber', e.target.value)} />

        <FormInput label="Counterparty Name" required value={form.counterpartyName} onChange={(e) => setField('counterpartyName', e.target.value)} />
        <FormInput label="Counterparty Contact" value={form.counterpartyContact} onChange={(e) => setField('counterpartyContact', e.target.value)} />

        <div className="col-span-2"><FormInput label="Counterparty Address" value={form.counterpartyAddress} onChange={(e) => setField('counterpartyAddress', e.target.value)} /></div>

        <FormInput label="Start Date" required={mode === 'create'} type="date" value={form.startDate} onChange={(e) => setField('startDate', e.target.value)} />
        <FormInput label="End Date" type="date" value={form.endDate} onChange={(e) => setField('endDate', e.target.value)} />

        <FormInput label="Renewal Date" type="date" value={form.renewalDate} onChange={(e) => setField('renewalDate', e.target.value)} />
        <FormInput label="Renewal Notice Date" type="date" value={form.renewalNoticeDate} onChange={(e) => setField('renewalNoticeDate', e.target.value)} />

        <FormInput label="Value" type="number" step="0.01" value={form.value} onChange={(e) => setField('value', e.target.value)} />
        <FormSelect label="Currency" value={form.currency} onChange={(e) => setField('currency', e.target.value)}>
          {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </FormSelect>

        <FormSelect label="Status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
        </FormSelect>
        <FormSelect label="Risk Level" value={form.riskLevel} onChange={(e) => setField('riskLevel', e.target.value)}>
          {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
        </FormSelect>

        <FormInput label="Payment Terms" value={form.paymentTerms} onChange={(e) => setField('paymentTerms', e.target.value)} />
        <div className="flex flex-col justify-end gap-2 text-sm" style={{ color: 'var(--aurora-text)' }}>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.autoRenews} onChange={(e) => setField('autoRenews', e.target.checked)} /> Auto-renews
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.isSensitive} onChange={(e) => setField('isSensitive', e.target.checked)} /> Sensitive (Group Control)
          </label>
        </div>

        <div className="col-span-2"><FormTextarea label="Obligations" rows={2} value={form.obligations} onChange={(e) => setField('obligations', e.target.value)} /></div>
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => setField('description', e.target.value)} /></div>
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => setField('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

function ContractDeleteConfirm({ contract, onClose, onConfirmed }: {
  contract: Contract; onClose: () => void; onConfirmed: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const handleDelete = async () => {
    setSaving(true); setError('');
    try {
      const res = await fetch(`/api/backend/contracts/${contract.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.message ?? 'Delete failed');
      }
      onConfirmed();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed');
    } finally { setSaving(false); }
  };
  return (
    <Modal open onClose={onClose} title="Delete contract?" size="sm"
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
          <Btn variant="danger" onClick={handleDelete} loading={saving}>Delete</Btn>
        </>
      }
    >
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <p className="text-sm" style={{ color: 'var(--aurora-text)' }}>
        Soft-delete <strong>{contract.title}</strong>? The record stays in the database for audit but is hidden from lists.
      </p>
    </Modal>
  );
}

export default function ContractsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [data, setData] = useState<Paginated<Contract> | null>(null);
  const [summary, setSummary] = useState<ContractSummary | null>(null);
  const [expiring, setExpiring] = useState<ExpiringContract[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [filterCompany, setFilterCompany] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterRisk, setFilterRisk] = useState('');
  const [page, setPage] = useState(1);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Contract | null>(null);
  const [deleting, setDeleting] = useState<Contract | null>(null);

  const canView = hasPermission('contracts.read');
  const canManage = hasPermission('contracts.create');

  const reloadSummary = useCallback(() => {
    fetch('/api/backend/contracts/summary').then((r) => r.json()).then((j) => setSummary(j.data ?? null));
    fetch('/api/backend/contracts/expiring?days=60').then((r) => r.json())
      .then((j) => setExpiring(Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    reloadSummary();
  }, [reloadSummary]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (search.trim()) params.set('search', search.trim());
      if (filterCompany) params.set('companyId', filterCompany);
      if (filterType) params.set('contractType', filterType);
      if (filterStatus) params.set('status', filterStatus);
      if (filterRisk) params.set('riskLevel', filterRisk);
      const res = await fetch(`/api/backend/contracts?${params}`);
      const json = await res.json();
      setData(json.data ?? null);
    } finally { setLoading(false); }
  }, [page, search, filterCompany, filterType, filterStatus, filterRisk]);

  useEffect(() => { load(); }, [load]);

  const refresh = useCallback(() => {
    load();
    reloadSummary();
  }, [load, reloadSummary]);

  if (!canView) {
    return <div className="p-6"><PageHeader title="Contracts" subtitle="Group contracts registry" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  const expiring30 = expiring.filter((e) => e.daysUntilExpiry <= 30);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Contracts"
        subtitle="Group contracts registry — risk, expiry, and obligations"
        actions={canManage && <Btn variant="primary" size="sm" onClick={() => setCreating(true)}>+ New Contract</Btn>}
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-7 gap-3">
        <StatCard label="Total" value={summary?.total ?? 0} />
        <StatCard label="Active" value={summary?.active ?? 0} hint="In force" />
        <StatCard label="Pending" value={summary?.pendingApproval ?? 0} hint="Sign-off" />
        <StatCard label="Expiring (60d)" value={summary?.expiringSoon ?? 0} hint="Attention" />
        <StatCard label="Expired" value={summary?.expired ?? 0} />
        <StatCard label="High Risk" value={summary?.highRisk ?? 0} hint="HIGH/CRITICAL" />
        <StatCard label="Active Value" value={fmt(summary?.totalActiveValue ?? 0)} hint="Sum" />
      </div>

      {expiring30.length > 0 && (
        <Card className="p-4 border-amber-300 bg-amber-50">
          <div className="text-sm font-semibold text-amber-900 mb-2">⚠ {expiring30.length} contract(s) expiring within 30 days</div>
          <ul className="space-y-1 text-xs">
            {expiring30.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link href={`/group-control/contracts/${c.id}`} className="text-amber-900 hover:underline">
                  {c.title} — {c.daysUntilExpiry} day{c.daysUntilExpiry === 1 ? '' : 's'} ({fmtDate(c.endDate)})
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {summary?.byType?.length ? (
        <Card className="p-5">
          <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--aurora-text)' }}>By Contract Type</h3>
          <div className="flex flex-wrap gap-2">
            {summary.byType.map((row, i) => (
              <span key={i} className="text-xs px-3 py-1.5 rounded-full border" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}>
                {row.contractType.replace(/_/g, ' ')} <strong className="ml-1">{row.count}</strong>
              </span>
            ))}
          </div>
        </Card>
      ) : null}

      <PageToolbar
        search={search} onSearch={(v) => { setSearch(v); setPage(1); }}
        searchPlaceholder="Title, counterparty, contract #…"
        filters={
          <>
            <select value={filterCompany} onChange={(e) => { setFilterCompany(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={filterType} onChange={(e) => { setFilterType(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterStatus} onChange={(e) => { setFilterStatus(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
            <select value={filterRisk} onChange={(e) => { setFilterRisk(e.target.value); setPage(1); }} className={filterSelectCls} style={filterStyle}>
              <option value="">All Risk</option>
              {RISK_LEVELS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </>
        }
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Counterparty</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Start</th>
                <th className="px-4 py-3">End</th>
                <th className="px-4 py-3 text-right">Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Risk</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? <tr><td colSpan={canManage ? 10 : 9}><PageSpinner /></td></tr>
                : !data?.data.length ? <tr><td colSpan={canManage ? 10 : 9} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No contracts</td></tr>
                : data.data.map((c) => {
                  const days = daysUntil(c.endDate);
                  const expSoon = days <= 30 && days >= 0 && c.status === 'ACTIVE';
                  return (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link href={`/group-control/contracts/${c.id}`} className="text-brand-600 hover:underline">
                          {c.isSensitive && <span className="mr-1">🔒</span>}{c.title}
                        </Link>
                        {c.contractNumber && <div className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{c.contractNumber}</div>}
                      </td>
                      <td className="px-4 py-3 text-xs">{c.contractType.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3">{c.counterpartyName}</td>
                      <td className="px-4 py-3 text-xs">{c.company?.name ?? '—'}</td>
                      <td className="px-4 py-3 text-xs">{fmtDate(c.startDate)}</td>
                      <td className={`px-4 py-3 text-xs ${expSoon ? 'text-amber-700 font-semibold' : ''}`}>
                        {fmtDate(c.endDate)}{expSoon && <div className="text-[10px]">{days}d left</div>}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">{c.value ? `${c.currency} ${fmt(c.value)}` : '—'}</td>
                      <td className="px-4 py-3"><StatusBadge value={c.status} /></td>
                      <td className="px-4 py-3"><StatusBadge value={c.riskLevel} /></td>
                      {canManage && (
                        <td className="px-4 py-3 text-right whitespace-nowrap">
                          <Btn variant="ghost" size="xs" onClick={() => setEditing(c)}>Edit</Btn>
                          <Btn variant="ghost" size="xs" onClick={() => setDeleting(c)}>Delete</Btn>
                        </td>
                      )}
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {data && data.totalPages > 1 && (
          <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {data.page} of {data.totalPages} · {data.total} total</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="xs" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="xs" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>

      {creating && (
        <ContractModal
          mode="create"
          companies={companies}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); refresh(); }}
        />
      )}
      {editing && (
        <ContractModal
          mode="edit"
          initial={editing}
          companies={companies}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); refresh(); }}
        />
      )}
      {deleting && (
        <ContractDeleteConfirm
          contract={deleting}
          onClose={() => setDeleting(null)}
          onConfirmed={() => { setDeleting(null); refresh(); }}
        />
      )}
    </div>
  );
}

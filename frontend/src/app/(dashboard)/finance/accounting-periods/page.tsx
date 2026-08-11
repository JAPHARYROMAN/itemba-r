'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }
interface FiscalYear { id: string; name: string }

interface AccountingPeriod {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  companyId: string;
  fiscalYearId: string;
  company?: { name: string } | null;
  fiscalYear?: { name: string } | null;
  createdAt: string;
}

interface PeriodForm { companyId: string; fiscalYearId: string; name: string; startDate: string; endDate: string }

const BLANK_FORM: PeriodForm = { companyId: '', fiscalYearId: '', name: '', startDate: '', endDate: '' };

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function PeriodModal({ mode, initial, companies, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial?: AccountingPeriod; companies: Company[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<PeriodForm>(() => initial ? {
    companyId: initial.companyId, fiscalYearId: initial.fiscalYearId, name: initial.name,
    startDate: initial.startDate.split('T')[0], endDate: initial.endDate.split('T')[0],
  } : { ...BLANK_FORM });
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof PeriodForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (form.companyId) {
      fetch(`/api/backend/fiscal-years?companyId=${form.companyId}`).then((r) => r.json())
        .then((j) => setFiscalYears(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    } else { setFiscalYears([]); }
  }, [form.companyId]);

  const handleSubmit = async () => {
    if (!form.companyId || !form.fiscalYearId || !form.name.trim() || !form.startDate || !form.endDate) {
      setError('All fields required'); return;
    }
    setSaving(true); setError('');
    try {
      const res = await fetch(
        mode === 'create' ? '/api/backend/accounting-periods' : `/api/backend/accounting-periods/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'Create Period' : 'Edit Period'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>{mode === 'create' ? 'Create' : 'Save Changes'}</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <FormSelect label="Company" required disabled={mode === 'edit'} value={form.companyId} onChange={(e) => { set('companyId', e.target.value); set('fiscalYearId', ''); }} placeholder="Select company…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
        </FormSelect>
        <FormSelect label="Fiscal Year" required disabled={!form.companyId || mode === 'edit'} value={form.fiscalYearId} onChange={(e) => set('fiscalYearId', e.target.value)} placeholder="Select fiscal year…">
          {fiscalYears.map((fy) => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
        </FormSelect>
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. January 2025" />
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Start Date" required type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          <FormInput label="End Date" required type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export default function AccountingPeriodsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [filterFYs, setFilterFYs] = useState<FiscalYear[]>([]);
  const [list, setList] = useState<AccountingPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [fiscalYearId, setFiscalYearId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<AccountingPeriod | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const canView = hasPermission('accounting_periods.view');
  const canManage = hasPermission('accounting_periods.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  useEffect(() => {
    if (companyId) {
      fetch(`/api/backend/fiscal-years?companyId=${companyId}`).then((r) => r.json())
        .then((j) => setFilterFYs(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
    } else { setFilterFYs([]); setFiscalYearId(''); }
  }, [companyId]);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (fiscalYearId) params.set('fiscalYearId', fiscalYearId);
      if (status) params.set('status', status);
      const res = await fetch(`/api/backend/accounting-periods?${params}`);
      const json = await res.json();
      const arr = Array.isArray(json.data?.data) ? json.data.data : Array.isArray(json.data) ? json.data : [];
      setList(arr);
    } finally { setLoading(false); }
  }, [canView, companyId, fiscalYearId, status]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActionLoading(id + action);
    try { await fetch(`/api/backend/accounting-periods/${id}/${action}`, { method: 'PATCH' }); load(); }
    finally { setActionLoading(null); }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Accounting Periods" subtitle="Manage accounting periods" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && <PeriodModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <PeriodModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      <PageHeader title="Accounting Periods" subtitle="Manage monthly/quarterly accounting periods" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={list.length} />
        <StatCard label="Open" value={list.filter((p) => p.status === 'OPEN').length} />
        <StatCard label="Closed" value={list.filter((p) => p.status === 'CLOSED').length} />
        <StatCard label="Locked" value={list.filter((p) => p.status === 'LOCKED').length} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={fiscalYearId} onChange={(e) => setFiscalYearId(e.target.value)} className={filterSelectCls} style={filterStyle} disabled={!companyId}>
              <option value="">All Fiscal Years</option>
              {filterFYs.map((fy) => <option key={fy.id} value={fy.id}>{fy.name}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
              <option value="LOCKED">Locked</option>
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Period</Btn> : null}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Fiscal Year</th>
                <th className="px-4 py-3">Start Date</th>
                <th className="px-4 py-3">End Date</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={7}><PageSpinner /></td></tr>
              ) : !list.length ? (
                <tr><td colSpan={7} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No periods found</td></tr>
              ) : list.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3">{p.company?.name ?? '—'}</td>
                  <td className="px-4 py-3">{p.fiscalYear?.name ?? '—'}</td>
                  <td className="px-4 py-3">{fmtDate(p.startDate)}</td>
                  <td className="px-4 py-3">{fmtDate(p.endDate)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {p.status === 'OPEN' && (
                          <>
                            <Btn variant="warning" size="xs" onClick={() => handleAction(p.id, 'close')} loading={actionLoading === p.id + 'close'}>Close</Btn>
                            <Btn variant="ghost" size="xs" onClick={() => setEditing(p)}>Edit</Btn>
                          </>
                        )}
                        {p.status === 'CLOSED' && (
                          <Btn variant="danger" size="xs" onClick={() => handleAction(p.id, 'lock')} loading={actionLoading === p.id + 'lock'}>Lock</Btn>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

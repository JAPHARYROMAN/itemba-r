'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string; code: string }

interface FiscalYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'OPEN' | 'CLOSED' | 'LOCKED';
  companyId: string;
  company?: { name: string } | null;
  createdAt: string;
}

interface FiscalYearForm {
  companyId: string;
  name: string;
  startDate: string;
  endDate: string;
}

const BLANK_FORM: FiscalYearForm = { companyId: '', name: '', startDate: '', endDate: '' };

function fmtDate(d?: string | null) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function FiscalYearModal({ mode, initial, companies, onClose, onSaved }: {
  mode: 'create' | 'edit'; initial?: FiscalYear; companies: Company[]; onClose: () => void; onSaved: () => void;
}) {
  const [form, setForm] = useState<FiscalYearForm>(() => initial ? {
    companyId: initial.companyId, name: initial.name,
    startDate: initial.startDate.split('T')[0], endDate: initial.endDate.split('T')[0],
  } : { ...BLANK_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (k: keyof FiscalYearForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.companyId) { setError('Company is required'); return; }
    if (!form.name.trim()) { setError('Name is required'); return; }
    if (!form.startDate || !form.endDate) { setError('Dates are required'); return; }
    setSaving(true); setError('');
    try {
      const res = await fetch(
        mode === 'create' ? '/api/backend/fiscal-years' : `/api/backend/fiscal-years/${initial!.id}`,
        { method: mode === 'create' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) }
      );
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'Create Fiscal Year' : 'Edit Fiscal Year'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={handleSubmit} loading={saving}>{mode === 'create' ? 'Create' : 'Save Changes'}</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="space-y-3">
        <FormSelect label="Company" required disabled={mode === 'edit'} value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select company…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
        </FormSelect>
        <FormInput label="Name" required value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. FY 2025" />
        <div className="grid grid-cols-2 gap-3">
          <FormInput label="Start Date" required type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />
          <FormInput label="End Date" required type="date" value={form.endDate} onChange={(e) => set('endDate', e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

export default function FiscalYearsPage() {
  const { hasPermission } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [list, setList] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FiscalYear | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const canView = hasPermission('fiscal_years.view');
  const canManage = hasPermission('fiscal_years.manage');

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json())
      .then((j) => setCompanies(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []));
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (companyId) params.set('companyId', companyId);
      if (status) params.set('status', status);
      const res = await fetch(`/api/backend/fiscal-years?${params}`);
      const json = await res.json();
      const arr = Array.isArray(json.data?.data) ? json.data.data : Array.isArray(json.data) ? json.data : [];
      setList(arr);
    } finally { setLoading(false); }
  }, [canView, companyId, status]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (id: string, action: string) => {
    setActionLoading(id + action);
    try {
      await fetch(`/api/backend/fiscal-years/${id}/${action}`, { method: 'PATCH' });
      load();
    } finally { setActionLoading(null); }
  };

  if (!canView) {
    return (
      <div className="p-6">
        <PageHeader title="Fiscal Years" subtitle="Manage fiscal years" />
        <div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div>
      </div>
    );
  }

  const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
  const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' } as const;

  return (
    <div className="p-6 space-y-6">
      {creating && <FiscalYearModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
      {editing && <FiscalYearModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}

      <PageHeader title="Fiscal Years" subtitle="Manage company fiscal years" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total" value={list.length} />
        <StatCard label="Open" value={list.filter((f) => f.status === 'OPEN').length} hint="Currently active" />
        <StatCard label="Closed" value={list.filter((f) => f.status === 'CLOSED').length} />
        <StatCard label="Locked" value={list.filter((f) => f.status === 'LOCKED').length} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              <option value="OPEN">Open</option>
              <option value="CLOSED">Closed</option>
              <option value="LOCKED">Locked</option>
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Fiscal Year</Btn> : null}
      />

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[700px]">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Start Date</th>
                <th className="px-4 py-3">End Date</th>
                <th className="px-4 py-3">Status</th>
                {canManage && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr><td colSpan={6}><PageSpinner /></td></tr>
              ) : !list.length ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No fiscal years found</td></tr>
              ) : list.map((fy) => (
                <tr key={fy.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{fy.name}</td>
                  <td className="px-4 py-3">{fy.company?.name ?? '—'}</td>
                  <td className="px-4 py-3">{fmtDate(fy.startDate)}</td>
                  <td className="px-4 py-3">{fmtDate(fy.endDate)}</td>
                  <td className="px-4 py-3"><StatusBadge status={fy.status} /></td>
                  {canManage && (
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {fy.status === 'OPEN' && (
                          <>
                            <Btn variant="warning" size="xs" onClick={() => handleAction(fy.id, 'close')} loading={actionLoading === fy.id + 'close'}>Close</Btn>
                            <Btn variant="ghost" size="xs" onClick={() => setEditing(fy)}>Edit</Btn>
                          </>
                        )}
                        {fy.status === 'CLOSED' && (
                          <Btn variant="danger" size="xs" onClick={() => handleAction(fy.id, 'lock')} loading={actionLoading === fy.id + 'lock'}>Lock</Btn>
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

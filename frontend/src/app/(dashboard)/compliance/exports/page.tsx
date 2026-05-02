'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface ExportItem {
  id: string;
  exportCode: string;
  companyId: string;
  company?: { name: string };
  exportType: string;
  format: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  status: string;
  fileUrl?: string | null;
  errorMessage?: string | null;
  notes?: string | null;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const TYPES = ['TAX_TRANSACTIONS', 'TAX_RETURNS', 'OBLIGATIONS', 'DOCUMENT_STATUS', 'FULL_COMPLIANCE_PACK'];
const FORMATS = ['CSV', 'JSON', 'XLSX', 'PDF'];
const STATUSES = ['REQUESTED', 'PROCESSING', 'COMPLETED', 'FAILED'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface ExForm {
  exportCode: string; companyId: string; exportType: string; format: string;
  periodStart: string; periodEnd: string; notes: string;
}
const BLANK: ExForm = { exportCode: '', companyId: '', exportType: 'TAX_TRANSACTIONS', format: 'CSV', periodStart: '', periodEnd: '', notes: '' };

function CreateExportModal({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<ExForm>({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof ExForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.exportCode.trim() || !form.companyId) { setError('Code and company required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        exportCode: form.exportCode, companyId: form.companyId,
        exportType: form.exportType, format: form.format,
        periodStart: form.periodStart || undefined,
        periodEnd: form.periodEnd || undefined,
        notes: form.notes || undefined,
      };
      const res = await fetch('/api/backend/compliance/exports', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Request Export" size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Request</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.exportCode} onChange={(e) => set('exportCode', e.target.value)} />
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Type" value={form.exportType} onChange={(e) => set('exportType', e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Format" value={form.format} onChange={(e) => set('format', e.target.value)}>
          {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
        </FormSelect>
        <FormInput label="Period Start" type="date" value={form.periodStart} onChange={(e) => set('periodStart', e.target.value)} />
        <FormInput label="Period End" type="date" value={form.periodEnd} onChange={(e) => set('periodEnd', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Notes" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function ComplianceExportsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('data_exports.create');
  const canView = hasPermission('data_exports.view') || canManage;

  const [items, setItems] = useState<ExportItem[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [exportType, setExportType] = useState('');
  const [format, setFormat] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (exportType) params.set('exportType', exportType);
    if (format) params.set('format', format);
    if (status) params.set('status', status);
    const j = await fetch(`/api/backend/compliance/exports?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<ExportItem> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, exportType, format, status]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  const completed = items.filter((x) => x.status === 'COMPLETED').length;
  const failed = items.filter((x) => x.status === 'FAILED').length;

  if (!canView) return <div className="p-6"><PageHeader title="Compliance Exports" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Compliance Exports" subtitle="Generate downloadable compliance datasets" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Completed (page)" value={completed} />
        <StatCard label="Failed (page)" value={failed} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={exportType} onChange={(e) => reset(setExportType)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={format} onChange={(e) => reset(setFormat)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Formats</option>
              {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select value={status} onChange={(e) => reset(setStatus)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Status</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ Request Export</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No exports</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Format</th>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">File</th>
                </tr>
              </thead>
              <tbody>
                {items.map((x) => (
                  <tr key={x.id} className="border-t" style={{ borderColor: 'var(--aurora-border)', background: x.status === 'FAILED' ? 'rgba(239,68,68,0.06)' : undefined }}>
                    <td className="px-4 py-3 font-mono text-xs">{x.exportCode}</td>
                    <td className="px-4 py-3 text-xs">{x.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{x.exportType}</td>
                    <td className="px-4 py-3 text-xs">{x.format}</td>
                    <td className="px-4 py-3 text-xs">{x.periodStart?.split('T')[0] ?? '—'} → {x.periodEnd?.split('T')[0] ?? '—'}</td>
                    <td className="px-4 py-3"><StatusBadge status={x.status} /></td>
                    <td className="px-4 py-3 text-xs">
                      {x.fileUrl ? <a href={x.fileUrl} target="_blank" rel="noopener" className="underline" style={{ color: 'var(--aurora-text)' }}>Download</a> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between p-3 border-t" style={{ borderColor: 'var(--aurora-border)' }}>
            <span className="text-xs" style={{ color: 'var(--aurora-text-muted)' }}>Page {page} of {totalPages} ({total} total)</span>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Btn>
              <Btn variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
            </div>
          </div>
        )}
      </Card>

      {creating && <CreateExportModal companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
}

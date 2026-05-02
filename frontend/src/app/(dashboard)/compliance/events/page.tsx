'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatCard, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }
interface ComplianceEvent {
  id: string;
  eventCode: string;
  companyId: string;
  company?: { name: string };
  eventType: string;
  title: string;
  description?: string | null;
  eventDate: string;
  severity: string;
  metadata?: unknown;
  createdAt: string;
}

interface Paginated<T> { data: T[]; total: number; page: number; totalPages: number }

const TYPES = ['FILING_SUBMITTED', 'AUDIT_STARTED', 'AUDIT_COMPLETED', 'PENALTY_ISSUED', 'EXEMPTION_GRANTED', 'NOTICE_RECEIVED', 'OTHER'];
const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];

const filterSelectCls = 'text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500';
const filterStyle = { borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' };

interface EventForm {
  eventCode: string; title: string; companyId: string; eventType: string;
  severity: string; eventDate: string; description: string;
}
const BLANK: EventForm = { eventCode: '', title: '', companyId: '', eventType: 'OTHER', severity: 'INFO', eventDate: '', description: '' };

function CreateEventModal({ companies, onClose, onSaved }: { companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<EventForm>({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof EventForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.eventCode.trim() || !form.title.trim() || !form.companyId || !form.eventDate) { setError('Code, title, company, date required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        eventCode: form.eventCode, title: form.title, companyId: form.companyId,
        eventType: form.eventType, severity: form.severity, eventDate: form.eventDate,
        description: form.description || undefined,
      };
      const res = await fetch('/api/backend/compliance/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message ?? 'Save failed'); }
      onSaved();
    } catch (err) { setError(err instanceof Error ? err.message : 'Error'); } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title="Record Event" size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormInput label="Code" required value={form.eventCode} onChange={(e) => set('eventCode', e.target.value)} />
        <FormInput label="Title" required value={form.title} onChange={(e) => set('title', e.target.value)} />
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…">
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormSelect label="Type" value={form.eventType} onChange={(e) => set('eventType', e.target.value)}>
          {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </FormSelect>
        <FormSelect label="Severity" value={form.severity} onChange={(e) => set('severity', e.target.value)}>
          {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
        </FormSelect>
        <FormInput label="Event Date" type="date" required value={form.eventDate} onChange={(e) => set('eventDate', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Description" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function ComplianceEventsPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('compliance_events.manage');
  const canView = hasPermission('compliance_events.view') || canManage;

  const [items, setItems] = useState<ComplianceEvent[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [companyId, setCompanyId] = useState('');
  const [eventType, setEventType] = useState('');
  const [severity, setSeverity] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? []));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (companyId) params.set('companyId', companyId);
    if (eventType) params.set('eventType', eventType);
    if (severity) params.set('severity', severity);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    const j = await fetch(`/api/backend/compliance/events?${params}`).then((r) => r.json()).catch(() => ({}));
    const p: Paginated<ComplianceEvent> = j.data ?? {};
    setItems(p.data ?? []); setTotal(p.total ?? 0); setTotalPages(p.totalPages ?? 1);
    setLoading(false);
  }, [page, companyId, eventType, severity, dateFrom, dateTo]);

  useEffect(() => { load(); }, [load]);
  const reset = (fn: (v: string) => void) => (v: string) => { fn(v); setPage(1); };

  const criticalCount = items.filter((e) => e.severity === 'CRITICAL').length;
  const warningCount = items.filter((e) => e.severity === 'WARNING').length;

  if (!canView) return <div className="p-6"><PageHeader title="Compliance Events" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Compliance Events" subtitle="Audit log of compliance-relevant events" />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard label="Total" value={total} />
        <StatCard label="Critical (page)" value={criticalCount} />
        <StatCard label="Warning (page)" value={warningCount} />
      </div>

      <PageToolbar
        filters={
          <>
            <select value={companyId} onChange={(e) => reset(setCompanyId)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Companies</option>
              {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={eventType} onChange={(e) => reset(setEventType)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Types</option>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={severity} onChange={(e) => reset(setSeverity)(e.target.value)} className={filterSelectCls} style={filterStyle}>
              <option value="">All Severities</option>
              {SEVERITIES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <input type="date" value={dateFrom} onChange={(e) => reset(setDateFrom)(e.target.value)} className={filterSelectCls} style={filterStyle} />
            <input type="date" value={dateTo} onChange={(e) => reset(setDateTo)(e.target.value)} className={filterSelectCls} style={filterStyle} />
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={() => setCreating(true)}>+ Record Event</Btn> : null}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : items.length === 0 ? (
          <div className="p-8 text-center text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No events</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                  <th className="px-4 py-3">Code</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Company</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Severity</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {items.map((e) => (
                  <tr key={e.id} className="border-t" style={{ borderColor: 'var(--aurora-border)', background: e.severity === 'CRITICAL' ? 'rgba(239,68,68,0.06)' : e.severity === 'WARNING' ? 'rgba(245,158,11,0.06)' : undefined }}>
                    <td className="px-4 py-3 font-mono text-xs">{e.eventCode}</td>
                    <td className="px-4 py-3">{e.title}</td>
                    <td className="px-4 py-3 text-xs">{e.company?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{e.eventType}</td>
                    <td className="px-4 py-3"><StatusBadge status={e.severity} /></td>
                    <td className="px-4 py-3 text-xs">{e.eventDate?.split('T')[0]}</td>
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

      {creating && <CreateEventModal companies={companies} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); load(); }} />}
    </div>
  );
}

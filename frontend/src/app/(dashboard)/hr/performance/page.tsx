'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, FormInput, FormSelect, Modal, Btn, PageSpinner, FormTextarea } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface PerformanceRecord {
  id: string;
  employee?: string;
  employeeId?: string;
  reviewer?: string;
  reviewDate?: string;
  score?: number;
  rating?: string;
  status: string;
  comments?: string;
}

interface FormState {
  companyId: string;
  employeeId: string;
  reviewerId: string;
  reviewDate: string;
  score: string;
  rating: string;
  comments: string;
}

const empty: FormState = { companyId: '', employeeId: '', reviewerId: '', reviewDate: '', score: '', rating: 'SATISFACTORY', comments: '' };

export default function PerformancePage() {
  const [rows, setRows] = useState<PerformanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<PerformanceRecord | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const { companyOptions, employeeOptions } = useOrgScope(form.companyId, { skipBranches: true, skipDivisions: true });

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/performance');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setShowModal(true); };
  const openEdit = (p: PerformanceRecord) => {
    setEditing(p);
    setForm({ companyId: '', employeeId: p.employeeId ?? '', reviewerId: p.reviewer ?? '', reviewDate: p.reviewDate ?? '', score: String(p.score ?? ''), rating: p.rating ?? 'SATISFACTORY', comments: p.comments ?? '' });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const url = editing ? `/api/backend/hr/performance/${editing.id}` : '/api/backend/hr/performance';
    await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(() => { const { companyId: _c, ...rest } = form; void _c; return rest; })(), score: form.score ? Number(form.score) : undefined }),
    });
    setSaving(false);
    setShowModal(false);
    load();
  };

  const doAction = async (id: string, action: 'submit' | 'approve') => {
    setActionLoading(`${id}-${action}`);
    await fetch(`/api/backend/hr/performance/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    setActionLoading('');
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  const ratingColor: Record<string, string> = {
    EXCELLENT: 'text-emerald-600',
    GOOD: 'text-blue-600',
    SATISFACTORY: 'text-amber-600',
    NEEDS_IMPROVEMENT: 'text-orange-600',
    UNSATISFACTORY: 'text-red-600',
  };

  return (
    <div className="p-6">
      <PageHeader
        title="Performance Records"
        subtitle="Employee performance reviews and evaluations"
      />
      <PageToolbar actions={<Btn variant="primary" onClick={openCreate}>+ New Review</Btn>} />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-50 border-b border-slate-100" style={{ color: 'var(--aurora-text-muted)' }}>
                <tr>
                  <th className={thCls}>Employee</th>
                  <th className={thCls}>Review Date</th>
                  <th className={thCls}>Reviewer</th>
                  <th className={thCls}>Score</th>
                  <th className={thCls}>Rating</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(p => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-medium`}>{p.employee ?? p.employeeId ?? '—'}</td>
                    <td className={tdCls}>{p.reviewDate ? new Date(p.reviewDate).toLocaleDateString('en-GB') : '—'}</td>
                    <td className={tdCls}>{p.reviewer ?? '—'}</td>
                    <td className={tdCls}>{p.score ?? '—'}</td>
                    <td className={`${tdCls} font-medium ${ratingColor[p.rating ?? ''] ?? ''}`}>{p.rating ?? '—'}</td>
                    <td className={tdCls}><StatusBadge status={p.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-1">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(p)}>Edit</Btn>
                        {p.status === 'DRAFT' && (
                          <Btn variant="warning" size="xs" onClick={() => doAction(p.id, 'submit')} disabled={actionLoading === `${p.id}-submit`}>
                            {actionLoading === `${p.id}-submit` ? '…' : 'Submit'}
                          </Btn>
                        )}
                        {p.status === 'SUBMITTED' && (
                          <Btn variant="success" size="xs" onClick={() => doAction(p.id, 'approve')} disabled={actionLoading === `${p.id}-approve`}>
                            {actionLoading === `${p.id}-approve` ? '…' : 'Approve'}
                          </Btn>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No performance records found</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Performance Review' : 'New Performance Review'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="performance-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="performance-form" onSubmit={handleSubmit} className="space-y-3">
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, employeeId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormSelect label="Employee" required value={form.employeeId} onChange={f('employeeId')}
            options={employeeOptions} placeholder={form.companyId ? 'Select employee' : 'Select company first'} />
          <FormInput label="Reviewer ID" value={form.reviewerId} onChange={f('reviewerId')} />
          <FormInput label="Review Date" type="date" value={form.reviewDate} onChange={f('reviewDate')} required />
          <div className="grid grid-cols-2 gap-3">
            <FormInput label="Score (0-100)" type="number" value={form.score} onChange={f('score')} min="0" max="100" />
            <FormSelect label="Rating" value={form.rating} onChange={f('rating')}
              options={[
                { value: 'EXCELLENT', label: 'Excellent' },
                { value: 'GOOD', label: 'Good' },
                { value: 'SATISFACTORY', label: 'Satisfactory' },
                { value: 'NEEDS_IMPROVEMENT', label: 'Needs Improvement' },
                { value: 'UNSATISFACTORY', label: 'Unsatisfactory' },
              ]} />
          </div>
          <FormTextarea label="Comments" value={form.comments} onChange={f('comments')} rows={3} />
        </form>
      </Modal>
    </div>
  );
}

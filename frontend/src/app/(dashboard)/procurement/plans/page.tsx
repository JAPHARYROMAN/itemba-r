'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageSpinner, PageToolbar, Modal, ConfirmDialog, Btn, FormInput, FormSelect, FormTextarea, showToast } from '@/components/ui';
import { backendPost, backendPut, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Company { id: string; name: string }

interface ProcurementPlan {
  id: string;
  planNumber: string;
  companyId: string;
  title: string;
  description?: string | null;
  totalBudget: number | string;
  currency: string;
  status: string;
}

interface PlanForm {
  companyId: string;
  planNumber: string;
  title: string;
  description: string;
  totalBudget: string;
  currency: string;
}

const BLANK: PlanForm = { companyId: '', planNumber: '', title: '', description: '', totalBudget: '', currency: 'TZS' };

function PlanModal({ mode, initial, companies, onClose, onSaved }: { mode: 'create' | 'edit'; initial?: ProcurementPlan; companies: Company[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PlanForm>(() => initial ? {
    companyId: initial.companyId,
    planNumber: initial.planNumber,
    title: initial.title,
    description: initial.description ?? '',
    totalBudget: String(initial.totalBudget ?? ''),
    currency: initial.currency,
  } : { ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof PlanForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.companyId || !form.planNumber || !form.title) { setError('Company, plan number and title are required'); return; }
    setSaving(true); setError('');
    try {
      const body: Record<string, unknown> = {
        companyId: form.companyId,
        planNumber: form.planNumber,
        title: form.title,
        description: form.description || undefined,
        totalBudget: form.totalBudget ? Number(form.totalBudget) : undefined,
        currency: form.currency || undefined,
      };
      if (mode === 'create') await backendPost('/procurement-plans', body);
      else await backendPut(`/procurement-plans/${initial!.id}`, body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    } finally { setSaving(false); }
  };

  return (
    <Modal open onClose={onClose} title={mode === 'create' ? 'New Procurement Plan' : 'Edit Procurement Plan'} size="lg"
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit} loading={saving}>Save</Btn></>}>
      {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
      <div className="grid grid-cols-2 gap-3">
        <FormSelect label="Company" required value={form.companyId} onChange={(e) => set('companyId', e.target.value)} placeholder="Select…" disabled={mode === 'edit'}>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <FormInput label="Plan Number" required value={form.planNumber} onChange={(e) => set('planNumber', e.target.value)} />
        <div className="col-span-2"><FormInput label="Title" required value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
        <FormInput label="Total Budget" type="number" value={form.totalBudget} onChange={(e) => set('totalBudget', e.target.value)} />
        <FormInput label="Currency" value={form.currency} onChange={(e) => set('currency', e.target.value)} />
        <div className="col-span-2"><FormTextarea label="Description" rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} /></div>
      </div>
    </Modal>
  );
}

export default function ProcurementPlansPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission('procurement_plans.create');
  const canUpdate = hasPermission('procurement_plans.update');
  const canApprove = hasPermission('procurement_plans.approve');
  const showActions = canUpdate || canApprove;

  const [data, setData] = useState<ProcurementPlan[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ProcurementPlan | null>(null);
  const [approving, setApproving] = useState<ProcurementPlan | null>(null);

  useEffect(() => {
    fetch('/api/backend/companies?limit=100').then((r) => r.json()).then((j) => setCompanies(j.data?.data ?? j.data ?? [])).catch(() => {});
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/procurement-plans')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data?.items) ? res.data.items : Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = () => { setCreating(false); setEditing(null); load(); };

  const doApprove = async () => {
    if (!approving) return;
    try {
      await backendPost(`/procurement-plans/${approving.id}/approve`);
      showToast('success', 'Plan approved');
    } catch (err) {
      showToast('error', 'Approve failed', err instanceof ApiError ? err.message : 'Error');
    }
    setApproving(null);
    load();
  };

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? id;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Procurement Plans</h1>
        <p className="text-gray-500 mt-1">Annual and periodic procurement planning</p>
      </div>

      <div className="mb-4">
        <PageToolbar actions={canCreate ? <Btn variant="primary" onClick={() => setCreating(true)}>+ New Plan</Btn> : null} />
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Plan #</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Total Budget</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Status</th>
                {showActions && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={showActions ? 7 : 6} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.planNumber}</td>
                  <td className="px-4 py-3">{companyName(row.companyId)}</td>
                  <td className="px-4 py-3 font-medium">{row.title}</td>
                  <td className="px-4 py-3 font-medium">{row.totalBudget}</td>
                  <td className="px-4 py-3">{row.currency}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'APPROVED' ? 'bg-green-100 text-green-700' : row.status === 'DRAFT' ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-700'}`}>
                      {row.status}
                    </span>
                  </td>
                  {showActions && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {row.status === 'DRAFT' && (
                        <>
                          {canUpdate && <Btn variant="ghost" size="xs" onClick={() => setEditing(row)}>Edit</Btn>}
                          {canApprove && <Btn variant="success" size="xs" onClick={() => setApproving(row)}>Approve</Btn>}
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <PlanModal mode="create" companies={companies} onClose={() => setCreating(false)} onSaved={onSaved} />}
      {editing && <PlanModal mode="edit" initial={editing} companies={companies} onClose={() => setEditing(null)} onSaved={onSaved} />}
      <ConfirmDialog
        open={!!approving}
        title="Approve Plan"
        message={`Approve plan ${approving?.planNumber ?? ''}? Approved plans can no longer be edited.`}
        confirmLabel="Approve"
        onConfirm={doApprove}
        onCancel={() => setApproving(null)}
      />
    </div>
  );
}

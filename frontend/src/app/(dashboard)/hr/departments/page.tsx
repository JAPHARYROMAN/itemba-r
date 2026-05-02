'use client';

import { useEffect, useState } from 'react';
import { Card, PageHeader, StatusBadge, FormInput, FormSelect, ConfirmDialog, Modal, Btn, PageSpinner } from '@/components/ui';
import { useOrgScope } from '@/hooks/use-org-scope';

const thCls = 'px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide';
const tdCls = 'px-4 py-2 text-sm';

interface Department {
  id: string;
  departmentCode: string;
  name: string;
  company?: { id: string; name: string } | string;
  companyId?: string;
  division?: { id: string; name: string; code?: string | null } | null;
  divisionId?: string;
  status: string;
}

interface FormState {
  departmentCode: string;
  name: string;
  companyId: string;
  divisionId: string;
  status: string;
}

const empty: FormState = { departmentCode: '', name: '', companyId: '', divisionId: '', status: 'ACTIVE' };

export default function DepartmentsPage() {
  const [rows, setRows] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<FormState>(empty);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [nextCodePreview, setNextCodePreview] = useState('');
  const { companyOptions, divisionOptions } = useOrgScope(form.companyId, { skipBranches: true, skipEmployees: true });

  useEffect(() => {
    if (!form.companyId || editing) { setNextCodePreview(''); return; }
    fetch(`/api/backend/hr/departments/next-code?companyId=${form.companyId}`).then(r => r.json())
      .then(j => setNextCodePreview(j.data?.departmentCode ?? j.departmentCode ?? ''))
      .catch(() => setNextCodePreview(''));
  }, [form.companyId, editing]);

  const load = async () => {
    setLoading(true);
    const r = await fetch('/api/backend/hr/departments');
    const j = await r.json();
    setRows(Array.isArray(j.data?.data) ? j.data.data : Array.isArray(j.data) ? j.data : []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openCreate = () => { setEditing(null); setForm(empty); setError(''); setShowModal(true); };
  const openEdit = (d: Department) => {
    setEditing(d);
    const companyId = typeof d.company === 'object' && d.company ? d.company.id : (d.companyId ?? '');
    setForm({
      departmentCode: d.departmentCode,
      name: d.name,
      companyId,
      divisionId: d.division?.id ?? d.divisionId ?? '',
      status: d.status,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    const url = editing ? `/api/backend/hr/departments/${editing.id}` : '/api/backend/hr/departments';
    // Omit departmentCode entirely when blank — server auto-generates.
    const body: Record<string, unknown> = {
      name: form.name,
      companyId: form.companyId,
      status: form.status,
    };
    if (form.departmentCode.trim()) body.departmentCode = form.departmentCode.trim();
    if (form.divisionId) body.divisionId = form.divisionId;
    try {
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        const msg = Array.isArray(j?.message) ? j.message.join(', ') : (j?.message ?? `Save failed (HTTP ${res.status})`);
        throw new Error(msg);
      }
      setShowModal(false);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    await fetch(`/api/backend/hr/departments/${deleteId}`, { method: 'DELETE' });
    setDeleteId(null);
    load();
  };

  const f = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }));

  return (
    <div className="p-6">
      <PageHeader
        title="Departments"
        subtitle="Manage organisational departments"
        actions={<Btn variant="primary" onClick={openCreate}>+ Add Department</Btn>}
      />
      <Card className="overflow-hidden">
        {loading ? (
          <PageSpinner />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead style={{ color: 'var(--aurora-text-muted)' }} className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className={thCls}>Code</th>
                  <th className={thCls}>Name</th>
                  <th className={thCls}>Company</th>
                  <th className={thCls}>Division</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody style={{ color: 'var(--aurora-text)' }}>
                {rows.map(d => {
                  const companyLabel = typeof d.company === 'object' && d.company ? d.company.name : (d.company ?? '—');
                  const divisionLabel = d.division?.name ?? '—';
                  return (
                  <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className={`${tdCls} font-mono`}>{d.departmentCode}</td>
                    <td className={`${tdCls} font-medium`}>{d.name}</td>
                    <td className={tdCls}>{companyLabel}</td>
                    <td className={tdCls}>{divisionLabel}</td>
                    <td className={tdCls}><StatusBadge status={d.status} /></td>
                    <td className={tdCls}>
                      <div className="flex gap-2">
                        <Btn variant="ghost" size="xs" onClick={() => openEdit(d)}>Edit</Btn>
                        <Btn variant="danger" size="xs" onClick={() => setDeleteId(d.id)}>Delete</Btn>
                      </div>
                    </td>
                  </tr>
                  );
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No departments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={showModal}
        onClose={() => setShowModal(false)}
        title={editing ? 'Edit Department' : 'New Department'}
        footer={
          <>
            <Btn variant="secondary" type="button" onClick={() => setShowModal(false)}>Cancel</Btn>
            <Btn variant="primary" type="submit" form="department-form" loading={saving}>Save</Btn>
          </>
        }
      >
        <form id="department-form" onSubmit={handleSubmit} className="space-y-3">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">{error}</div>
          )}
          <FormSelect label="Company" required value={form.companyId}
            onChange={(e) => setForm(p => ({ ...p, companyId: e.target.value, divisionId: '' }))}
            options={companyOptions} placeholder="Select company" />
          <FormInput
            label="Department Code"
            value={form.departmentCode}
            onChange={f('departmentCode')}
            placeholder={editing ? '' : (nextCodePreview ? `Auto: ${nextCodePreview}` : 'Auto-generated when blank')}
            hint={editing ? '' : (nextCodePreview && !form.departmentCode ? `Will be assigned ${nextCodePreview}` : 'Leave blank to auto-generate, or enter a meaningful abbreviation (e.g. MWAN-OPS)')}
          />
          <FormInput label="Name" value={form.name} onChange={f('name')} required />
          <FormSelect label="Division" value={form.divisionId} onChange={f('divisionId')}
            options={divisionOptions} placeholder={form.companyId ? 'Select division' : 'Select company first'} />
          <FormSelect label="Status" value={form.status} onChange={f('status')}
            options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'INACTIVE', label: 'Inactive' }]} />
        </form>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        title="Delete Department"
        message="Are you sure you want to delete this department? This cannot be undone."
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
      />
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface Provider {
  id: string;
  providerCode: string;
  name: string;
  providerType: string;
  status: string;
  supportsWebhooks: boolean;
  supportsSandbox: boolean;
}

const EMPTY_FORM = { providerCode: '', name: '', providerType: 'PAYMENT', status: 'ACTIVE', supportsWebhooks: false, supportsSandbox: false, description: '' };

export default function IntegrationProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterType) params.set('providerType', filterType);
    if (filterStatus) params.set('status', filterStatus);
    fetch(`/api/backend/integration-providers?${params}`)
      .then(r => r.json())
      .then(data => setProviders(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterType, filterStatus]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }
  function openEdit(p: Provider) { setEditing(p); setForm({ providerCode: p.providerCode, name: p.name, providerType: p.providerType, status: p.status, supportsWebhooks: p.supportsWebhooks, supportsSandbox: p.supportsSandbox, description: '' }); setError(''); setModalOpen(true); }

  async function save() {
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/backend/integration-providers/${editing.id}` : '/api/backend/integration-providers';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Save failed'); }
      setModalOpen(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Integration Providers" subtitle="Manage available integration providers" />

      <PageToolbar
        filters={
          <>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Types</option>
              {['PAYMENT','MESSAGING','ERP','CRM','STORAGE','OTHER'].map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Status</option>
              {['ACTIVE','INACTIVE','DEPRECATED'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={<Btn variant="primary" onClick={openCreate}>+ New Provider</Btn>}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Webhooks</th>
                <th className="px-4 py-3">Sandbox</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No providers found</td></tr>
              ) : providers.map(p => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.providerCode}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.providerType} /></td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">{p.supportsWebhooks ? 'Yes' : '—'}</td>
                  <td className="px-4 py-3">{p.supportsSandbox ? 'Yes' : '—'}</td>
                  <td className="px-4 py-3">
                    <Btn variant="ghost" size="xs" onClick={() => openEdit(p)}>Edit</Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? 'Edit Provider' : 'New Provider'}
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={save} loading={saving}>Save</Btn>
          </>
        }
      >
        {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-3">
          <FormInput label="Provider Code" required value={form.providerCode} onChange={e => setForm(f => ({ ...f, providerCode: e.target.value }))} placeholder="e.g. STRIPE" />
          <FormInput label="Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Provider name" />
          <FormSelect label="Provider Type" value={form.providerType} onChange={e => setForm(f => ({ ...f, providerType: e.target.value }))}>
            {['PAYMENT','MESSAGING','ERP','CRM','STORAGE','OTHER'].map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {['ACTIVE','INACTIVE','DEPRECATED'].map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <div className="flex gap-4 pt-1">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.supportsWebhooks} onChange={e => setForm(f => ({ ...f, supportsWebhooks: e.target.checked }))} />
              Supports Webhooks
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.supportsSandbox} onChange={e => setForm(f => ({ ...f, supportsSandbox: e.target.checked }))} />
              Supports Sandbox
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}

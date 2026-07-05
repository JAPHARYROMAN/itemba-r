'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea, ConfirmDialog } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';
import { backendPost, backendPatch, backendDelete } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

interface Provider {
  id: string;
  providerCode: string;
  name: string;
  providerType: string;
  status: string;
  supportsWebhooks: boolean;
  supportsSandbox: boolean;
  description?: string | null;
  baseUrl?: string | null;
  documentationUrl?: string | null;
}

const PROVIDER_TYPES = ['MOBILE_MONEY', 'BANK', 'SMS', 'EMAIL', 'WHATSAPP', 'TAX_AUTHORITY', 'E_INVOICE', 'PAYMENT_GATEWAY', 'POS_DEVICE', 'LOGISTICS', 'HOSPITALITY_BOOKING', 'BI_EXPORT', 'ACCOUNTING_EXPORT', 'CUSTOM'];
const STATUSES = ['ACTIVE', 'INACTIVE', 'TESTING', 'DEPRECATED'];

const EMPTY_FORM = { providerCode: '', name: '', providerType: 'CUSTOM', status: 'ACTIVE', supportsWebhooks: false, supportsSandbox: false, description: '', baseUrl: '', documentationUrl: '' };

export default function IntegrationProvidersPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('integration_providers.manage');

  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Provider | null>(null);
  const [actionError, setActionError] = useState('');

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
  function openEdit(p: Provider) { setEditing(p); setForm({ providerCode: p.providerCode, name: p.name, providerType: p.providerType, status: p.status, supportsWebhooks: p.supportsWebhooks, supportsSandbox: p.supportsSandbox, description: p.description ?? '', baseUrl: p.baseUrl ?? '', documentationUrl: p.documentationUrl ?? '' }); setError(''); setModalOpen(true); }

  async function save() {
    setSaving(true); setError('');
    try {
      const body = {
        providerCode: form.providerCode,
        name: form.name,
        providerType: form.providerType,
        status: form.status,
        supportsWebhooks: form.supportsWebhooks,
        supportsSandbox: form.supportsSandbox,
        description: form.description || undefined,
        baseUrl: form.baseUrl || undefined,
        documentationUrl: form.documentationUrl || undefined,
      };
      if (editing) await backendPatch(`/integration-providers/${editing.id}`, body);
      else await backendPost('/integration-providers', body);
      setModalOpen(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setActionError('');
    try {
      await backendDelete(`/integration-providers/${deleting.id}`);
      setDeleting(null); load();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Delete failed');
      setDeleting(null);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Integration Providers" subtitle="Manage available integration providers" />

      <PageToolbar
        filters={
          <>
            <select value={filterType} onChange={e => setFilterType(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Types</option>
              {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Status</option>
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </>
        }
        actions={canManage ? <Btn variant="primary" onClick={openCreate}>+ New Provider</Btn> : null}
      />

      {actionError && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{actionError}</div>}

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
                {canManage && <th className="px-4 py-3">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr><td colSpan={canManage ? 7 : 6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No providers found</td></tr>
              ) : providers.map(p => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{p.providerCode}</td>
                  <td className="px-4 py-3 font-medium">{p.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.providerType} /></td>
                  <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                  <td className="px-4 py-3">{p.supportsWebhooks ? 'Yes' : '—'}</td>
                  <td className="px-4 py-3">{p.supportsSandbox ? 'Yes' : '—'}</td>
                  {canManage && (
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Btn variant="ghost" size="xs" onClick={() => openEdit(p)}>Edit</Btn>
                      <Btn variant="ghost" size="xs" onClick={() => setDeleting(p)}>Delete</Btn>
                    </td>
                  )}
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
          <FormInput label="Provider Code" required value={form.providerCode} onChange={e => setForm(f => ({ ...f, providerCode: e.target.value }))} placeholder="e.g. MPESA" />
          <FormInput label="Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Provider name" />
          <FormSelect label="Provider Type" value={form.providerType} onChange={e => setForm(f => ({ ...f, providerType: e.target.value }))}>
            {PROVIDER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </FormSelect>
          <FormSelect label="Status" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </FormSelect>
          <FormInput label="Base URL" value={form.baseUrl} onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))} placeholder="https://" />
          <FormInput label="Documentation URL" value={form.documentationUrl} onChange={e => setForm(f => ({ ...f, documentationUrl: e.target.value }))} placeholder="https://" />
          <FormTextarea label="Description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
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

      <ConfirmDialog
        open={!!deleting}
        title="Delete Provider"
        message={`Delete provider "${deleting?.name ?? ''}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

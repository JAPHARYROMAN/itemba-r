'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface IntegrationMapping {
  id: string;
  mappingCode: string;
  internalEntityType: string;
  externalEntityType: string;
  externalEntityId: string;
  provider?: { name: string };
  status: string;
}

interface Provider {
  id: string;
  name: string;
}

const EMPTY_FORM = { mappingCode: '', internalEntityType: '', internalEntityId: '', externalEntityType: '', externalEntityId: '', providerId: '' };

export default function IntegrationMappingsPage() {
  const [mappings, setMappings] = useState<IntegrationMapping[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/integration-mappings?limit=50')
      .then(r => r.json())
      .then(data => setMappings(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/backend/integration-providers?limit=100').then(r => r.json()).then(data => setProviders(unwrapList(data))).catch(() => {});
  }, []);

  async function save() {
    setSaving(true); setError('');
    try {
      const res = await fetch('/api/backend/integration-mappings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Save failed'); }
      setModalOpen(false); setForm({ ...EMPTY_FORM }); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Integration Mappings" subtitle="Map internal entities to external provider entities" />

      <PageToolbar
        actions={<Btn variant="primary" onClick={() => { setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }}>+ New Mapping</Btn>}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Internal Entity Type</th>
                <th className="px-4 py-3">External Entity Type</th>
                <th className="px-4 py-3">External Entity ID</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {mappings.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No mappings found</td></tr>
              ) : mappings.map(m => (
                <tr key={m.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{m.mappingCode}</td>
                  <td className="px-4 py-3">{m.internalEntityType}</td>
                  <td className="px-4 py-3">{m.externalEntityType}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{m.externalEntityId}</td>
                  <td className="px-4 py-3">{m.provider?.name ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={m.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="New Mapping"
        size="lg"
        footer={
          <>
            <Btn variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Btn>
            <Btn variant="primary" onClick={save} loading={saving}>Save</Btn>
          </>
        }
      >
        {error && <div className="mb-3 text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
        <div className="space-y-3">
          <FormInput label="Mapping Code" required value={form.mappingCode} onChange={e => setForm(f => ({ ...f, mappingCode: e.target.value }))} />
          <FormInput label="Internal Entity Type" required value={form.internalEntityType} onChange={e => setForm(f => ({ ...f, internalEntityType: e.target.value }))} placeholder="e.g. CUSTOMER, PRODUCT" />
          <FormInput label="Internal Entity ID" required value={form.internalEntityId} onChange={e => setForm(f => ({ ...f, internalEntityId: e.target.value }))} />
          <FormInput label="External Entity Type" required value={form.externalEntityType} onChange={e => setForm(f => ({ ...f, externalEntityType: e.target.value }))} />
          <FormInput label="External Entity ID" required value={form.externalEntityId} onChange={e => setForm(f => ({ ...f, externalEntityId: e.target.value }))} />
          <FormSelect label="Provider" required value={form.providerId} onChange={e => setForm(f => ({ ...f, providerId: e.target.value }))} placeholder="Select provider…">
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </FormSelect>
        </div>
      </Modal>
    </div>
  );
}

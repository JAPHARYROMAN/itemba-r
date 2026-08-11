'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, ErrorState } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface WebhookEndpoint {
  id: string;
  webhookCode: string;
  name: string;
  endpointPath: string;
  status: string;
  provider?: { name: string };
  allowedEvents: string[];
}

interface Provider {
  id: string;
  name: string;
}

interface Connection {
  id: string;
  connectionName: string;
}

const EMPTY_FORM = { name: '', endpointPath: '', providerId: '', connectionId: '', allowedEventsInput: '' };

export default function WebhookEndpointsPage() {
  const [webhooks, setWebhooks] = useState<WebhookEndpoint[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [secretModal, setSecretModal] = useState<{ secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetch('/api/backend/webhook-endpoints?limit=50')
      .then(r => r.json())
      .then(data => setWebhooks(unwrapList(data)))
      .catch(() => { setWebhooks([]); setLoadError('Failed to load webhook endpoints.'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    // optional lookups — on failure the provider/connection dropdowns simply stay empty
    fetch('/api/backend/integration-providers?limit=100').then(r => r.json()).then(data => setProviders(unwrapList(data))).catch(() => undefined);
    fetch('/api/backend/integration-connections?limit=100').then(r => r.json()).then(data => setConnections(unwrapList(data))).catch(() => undefined);
  }, []);

  async function save() {
    setSaving(true); setError('');
    try {
      const allowedEvents = form.allowedEventsInput.split(',').map(s => s.trim()).filter(Boolean);
      const body: Record<string, unknown> = { name: form.name, endpointPath: form.endpointPath, providerId: form.providerId || undefined, allowedEvents };
      if (form.connectionId) body.connectionId = form.connectionId;
      const res = await fetch('/api/backend/webhook-endpoints', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Save failed'); }
      const data = await res.json();
      setModalOpen(false);
      setForm({ ...EMPTY_FORM });
      load();
      if (data.rawSecret) {
        setSecretModal({ secret: data.rawSecret });
      }
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  function copySecret(secret: string) {
    navigator.clipboard.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Webhook Endpoints"
        subtitle="Manage incoming webhook endpoints"
      />

      <PageToolbar
        actions={<Btn variant="primary" onClick={() => { setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }}>+ New Webhook</Btn>}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Endpoint Path</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Allowed Events</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No webhooks found</td></tr>
              ) : webhooks.map(w => (
                <tr key={w.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{w.webhookCode}</td>
                  <td className="px-4 py-3 font-medium">{w.name}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{w.endpointPath}</td>
                  <td className="px-4 py-3"><StatusBadge status={w.status} /></td>
                  <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>{w.provider?.name ?? '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(w.allowedEvents ?? []).map(ev => <span key={ev} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-xs">{ev}</span>)}
                    </div>
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
        title="New Webhook Endpoint"
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
          <FormInput label="Name" required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
          <FormInput label="Endpoint Path" required value={form.endpointPath} onChange={e => setForm(f => ({ ...f, endpointPath: e.target.value }))} placeholder="/webhooks/my-provider" />
          <FormSelect label="Provider" value={form.providerId} onChange={e => setForm(f => ({ ...f, providerId: e.target.value }))} placeholder="Select provider…">
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </FormSelect>
          <FormSelect label="Connection (optional)" value={form.connectionId} onChange={e => setForm(f => ({ ...f, connectionId: e.target.value }))}>
            <option value="">None</option>
            {connections.map(c => <option key={c.id} value={c.id}>{c.connectionName}</option>)}
          </FormSelect>
          <FormInput label="Allowed Events" value={form.allowedEventsInput} onChange={e => setForm(f => ({ ...f, allowedEventsInput: e.target.value }))} placeholder="payment.success, payment.failed" hint="Comma-separated list of event names." />
        </div>
      </Modal>

      <Modal
        open={Boolean(secretModal)}
        onClose={() => setSecretModal(null)}
        title="Webhook Secret"
        size="md"
        footer={
          <>
            <Btn variant="secondary" onClick={() => secretModal && copySecret(secretModal.secret)}>{copied ? 'Copied!' : 'Copy'}</Btn>
            <Btn variant="primary" onClick={() => setSecretModal(null)}>Done</Btn>
          </>
        }
      >
        <p className="text-sm mb-4" style={{ color: 'var(--aurora-text-muted)' }}>This secret is shown only once. Copy and store it securely.</p>
        <div className="bg-slate-50 rounded-lg px-4 py-3 font-mono text-sm break-all mb-2" style={{ color: 'var(--aurora-text)' }}>{secretModal?.secret}</div>
      </Modal>
    </div>
  );
}

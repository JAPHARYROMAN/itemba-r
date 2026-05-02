'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, FormInput, FormSelect, FormTextarea } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface Connection {
  id: string;
  connectionCode: string;
  connectionName: string;
  provider?: { name: string };
  environment: string;
  status: string;
  lastTestedAt: string | null;
  lastSuccessAt: string | null;
}

interface Provider {
  id: string;
  name: string;
}

const EMPTY_FORM = { connectionCode: '', connectionName: '', providerId: '', environment: 'PRODUCTION', publicConfig: '{}' };

export default function IntegrationConnectionsPage() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [filterEnv, setFilterEnv] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterStatus) params.set('status', filterStatus);
    if (filterEnv) params.set('environment', filterEnv);
    fetch(`/api/backend/integration-connections?${params}`)
      .then(r => r.json())
      .then(data => setConnections(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterStatus, filterEnv]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/backend/integration-providers?limit=100').then(r => r.json()).then(data => setProviders(unwrapList(data))).catch(() => {});
  }, []);

  async function save() {
    setSaving(true); setError('');
    try {
      let config = {};
      try { config = JSON.parse(form.publicConfig); } catch { throw new Error('Invalid JSON in Public Config'); }
      const body = { connectionCode: form.connectionCode, connectionName: form.connectionName, providerId: form.providerId, environment: form.environment, publicConfig: config };
      const res = await fetch('/api/backend/integration-connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Save failed'); }
      setModalOpen(false); setForm({ ...EMPTY_FORM }); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function testConnection(id: string) {
    setTestingId(id);
    try {
      const res = await fetch(`/api/backend/integration-connections/${id}/test`, { method: 'POST' });
      const data = await res.json();
      setTestResult(prev => ({ ...prev, [id]: data.success ? 'Success' : (data.message ?? 'Failed') }));
    } catch { setTestResult(prev => ({ ...prev, [id]: 'Error' })); }
    finally { setTestingId(null); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Integration Connections"
        subtitle="Manage company integration connections"
      />

      <PageToolbar
        filters={
          <>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}
            >
              <option value="">All Status</option>
              {['ACTIVE', 'INACTIVE', 'ERROR', 'TESTING'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select
              value={filterEnv}
              onChange={e => setFilterEnv(e.target.value)}
              className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}
            >
              <option value="">All Environments</option>
              {['PRODUCTION', 'SANDBOX', 'STAGING'].map(env => <option key={env} value={env}>{env}</option>)}
            </select>
          </>
        }
        actions={<Btn variant="primary" onClick={() => { setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }}>+ New Connection</Btn>}
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Environment</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Tested</th>
                <th className="px-4 py-3">Last Success</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {connections.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No connections found</td></tr>
              ) : connections.map(c => (
                <tr key={c.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{c.connectionCode}</td>
                  <td className="px-4 py-3 font-medium">{c.connectionName}</td>
                  <td className="px-4 py-3" style={{ color: 'var(--aurora-text-muted)' }}>{c.provider?.name ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.environment} /></td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{c.lastTestedAt ? new Date(c.lastTestedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{c.lastSuccessAt ? new Date(c.lastSuccessAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Btn variant="ghost" size="xs" onClick={() => testConnection(c.id)} disabled={testingId === c.id}>
                        {testingId === c.id ? 'Testing...' : 'Test'}
                      </Btn>
                      {testResult[c.id] && <span className={`text-xs ${testResult[c.id] === 'Success' ? 'text-green-600' : 'text-red-600'}`}>{testResult[c.id]}</span>}
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
        title="New Connection"
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
          <FormInput label="Connection Code" required value={form.connectionCode} onChange={e => setForm(f => ({ ...f, connectionCode: e.target.value }))} placeholder="CONN-001" />
          <FormInput label="Connection Name" required value={form.connectionName} onChange={e => setForm(f => ({ ...f, connectionName: e.target.value }))} />
          <FormSelect label="Provider" required value={form.providerId} onChange={e => setForm(f => ({ ...f, providerId: e.target.value }))} placeholder="Select provider…">
            {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </FormSelect>
          <FormSelect label="Environment" value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))}>
            {['PRODUCTION', 'SANDBOX', 'STAGING'].map(env => <option key={env} value={env}>{env}</option>)}
          </FormSelect>
          <FormTextarea label="Public Config (JSON)" value={form.publicConfig} onChange={e => setForm(f => ({ ...f, publicConfig: e.target.value }))} rows={4} className="font-mono" hint="Non-secret configuration as JSON." />
        </div>
      </Modal>
    </div>
  );
}

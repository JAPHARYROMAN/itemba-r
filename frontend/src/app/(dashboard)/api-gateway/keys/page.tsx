'use client';

import { useState, useEffect, useCallback } from 'react';
import { unwrapList } from '@/lib/unwrap';

interface ApiKey {
  id: string;
  apiKeyCode: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  status: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  client?: { name: string };
}

interface ApiClient {
  id: string;
  name: string;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  REVOKED: 'bg-red-100 text-red-700',
  EXPIRED: 'bg-orange-100 text-orange-700',
};

const EMPTY_FORM = { name: '', clientId: '', scopes: '', expiresAt: '' };

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [rawKeyModal, setRawKeyModal] = useState<{ key: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/api-keys?limit=50')
      .then(r => r.json())
      .then(data => setKeys(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch('/api/backend/api-clients?limit=100').then(r => r.json()).then(data => setClients(unwrapList(data))).catch(() => {});
  }, []);

  async function save() {
    setSaving(true); setError('');
    try {
      const scopes = form.scopes.split(',').map(s => s.trim()).filter(Boolean);
      const body: Record<string, unknown> = { name: form.name, clientId: form.clientId, scopes };
      if (form.expiresAt) body.expiresAt = form.expiresAt;
      const res = await fetch('/api/backend/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Save failed'); }
      const data = await res.json();
      setModalOpen(false); setForm({ ...EMPTY_FORM }); load();
      if (data.rawKey) setRawKeyModal({ key: data.rawKey });
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await fetch(`/api/backend/api-keys/${id}/revoke`, { method: 'POST' });
      load();
    } catch (e) { console.error(e); }
    finally { setRevokingId(null); }
  }

  function copyKey(key: string) {
    navigator.clipboard.writeText(key).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
          <p className="text-gray-500 mt-1">Manage API keys for client applications</p>
        </div>
        <button onClick={() => { setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">+ Create Key</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {loading ? <div className="text-center py-10 text-gray-500">Loading...</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name / Client</th>
                <th className="px-4 py-3">Key Prefix</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Last Used</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {keys.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">No API keys found</td></tr>
              ) : keys.map(k => (
                <tr key={k.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{k.apiKeyCode}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{k.name}</div>
                    <div className="text-xs text-gray-400">{k.client?.name}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs">{k.keyPrefix}...</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {(k.scopes ?? []).map(s => <span key={s} className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-xs">{s}</span>)}
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[k.status] ?? 'bg-gray-100 text-gray-600'}`}>{k.status}</span></td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{k.expiresAt ? new Date(k.expiresAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    {k.status === 'ACTIVE' && (
                      <button onClick={() => revoke(k.id)} disabled={revokingId === k.id} className="text-red-600 hover:underline text-xs disabled:opacity-50">
                        {revokingId === k.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Create API Key</h2>
            {error && <div className="mb-3 text-red-600 text-sm bg-red-50 rounded px-3 py-2">{error}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Key Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Client</label>
                <select value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  <option value="">Select client...</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Scopes (comma-separated)</label>
                <input value={form.scopes} onChange={e => setForm(f => ({ ...f, scopes: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" placeholder="read:orders, write:payments" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Expires At (optional)</label>
                <input type="date" value={form.expiresAt} onChange={e => setForm(f => ({ ...f, expiresAt: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">{saving ? 'Creating...' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}

      {rawKeyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Copy Your API Key</h2>
            <p className="text-sm text-gray-500 mb-4">This key is shown only once. Copy and store it securely.</p>
            <div className="bg-gray-50 rounded-lg px-4 py-3 font-mono text-sm break-all text-gray-800 mb-4">{rawKeyModal.key}</div>
            <div className="flex justify-end gap-3">
              <button onClick={() => copyKey(rawKeyModal.key)} className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">{copied ? 'Copied!' : 'Copy'}</button>
              <button onClick={() => setRawKeyModal(null)} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700">Done</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

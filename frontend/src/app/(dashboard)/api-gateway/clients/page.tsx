'use client';

import { useState, useEffect, useCallback } from 'react';
import { unwrapList } from '@/lib/unwrap';

interface ApiClient {
  id: string;
  clientCode: string;
  name: string;
  clientType: string;
  status: string;
  companyId: string;
  rateLimitPerMinute: number;
  rateLimitPerDay: number;
}

const CLIENT_TYPE_COLORS: Record<string, string> = {
  INTERNAL: 'bg-blue-100 text-blue-700',
  EXTERNAL: 'bg-orange-100 text-orange-700',
  PARTNER: 'bg-purple-100 text-purple-700',
  MOBILE: 'bg-green-100 text-green-700',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  SUSPENDED: 'bg-red-100 text-red-700',
};

const EMPTY_FORM = { clientCode: '', name: '', clientType: 'EXTERNAL', status: 'ACTIVE', rateLimitPerMinute: 60, rateLimitPerDay: 10000, description: '' };

export default function ApiClientsPage() {
  const [clients, setClients] = useState<ApiClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApiClient | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterType) params.set('clientType', filterType);
    if (filterStatus) params.set('status', filterStatus);
    fetch(`/api/backend/api-clients?${params}`)
      .then(r => r.json())
      .then(data => setClients(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterType, filterStatus]);

  useEffect(() => { load(); }, [load]);

  function openCreate() { setEditing(null); setForm({ ...EMPTY_FORM }); setError(''); setModalOpen(true); }
  function openEdit(c: ApiClient) { setEditing(c); setForm({ clientCode: c.clientCode, name: c.name, clientType: c.clientType, status: c.status, rateLimitPerMinute: c.rateLimitPerMinute, rateLimitPerDay: c.rateLimitPerDay, description: '' }); setError(''); setModalOpen(true); }

  async function save() {
    setSaving(true); setError('');
    try {
      const url = editing ? `/api/backend/api-clients/${editing.id}` : '/api/backend/api-clients';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (!res.ok) { const d = await res.json(); throw new Error(d.message ?? 'Save failed'); }
      setModalOpen(false); load();
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed'); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">API Clients</h1>
          <p className="text-gray-500 mt-1">Manage API client applications</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">+ New Client</button>
      </div>

      <div className="flex gap-3 mb-4">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          {['INTERNAL','EXTERNAL','PARTNER','MOBILE'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          {['ACTIVE','INACTIVE','SUSPENDED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {loading ? <div className="text-center py-10 text-gray-500">Loading...</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Rate/Min</th>
                <th className="px-4 py-3">Rate/Day</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">No clients found</td></tr>
              ) : clients.map(c => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{c.clientCode}</td>
                  <td className="px-4 py-3 font-medium">{c.name}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${CLIENT_TYPE_COLORS[c.clientType] ?? 'bg-gray-100 text-gray-600'}`}>{c.clientType}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[c.status] ?? 'bg-gray-100 text-gray-600'}`}>{c.status}</span></td>
                  <td className="px-4 py-3">{c.rateLimitPerMinute}</td>
                  <td className="px-4 py-3">{c.rateLimitPerDay?.toLocaleString()}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(c)} className="text-blue-600 hover:underline text-xs">Edit</button>
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
            <h2 className="text-lg font-semibold text-gray-900 mb-4">{editing ? 'Edit Client' : 'New API Client'}</h2>
            {error && <div className="mb-3 text-red-600 text-sm bg-red-50 rounded px-3 py-2">{error}</div>}
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Client Code</label>
                <input value={form.clientCode} onChange={e => setForm(f => ({ ...f, clientCode: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Client Type</label>
                <select value={form.clientType} onChange={e => setForm(f => ({ ...f, clientType: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {['INTERNAL','EXTERNAL','PARTNER','MOBILE'].map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {['ACTIVE','INACTIVE','SUSPENDED'].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Rate Limit/Min</label>
                  <input type="number" value={form.rateLimitPerMinute} onChange={e => setForm(f => ({ ...f, rateLimitPerMinute: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Rate Limit/Day</label>
                  <input type="number" value={form.rateLimitPerDay} onChange={e => setForm(f => ({ ...f, rateLimitPerDay: Number(e.target.value) }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

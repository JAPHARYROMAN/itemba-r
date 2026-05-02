'use client';

import { useState, useEffect, useCallback } from 'react';
import { unwrapList } from '@/lib/unwrap';

interface MobileSession {
  id: string;
  sessionCode: string;
  user?: { name: string; email: string };
  deviceId: string;
  status: string;
  appVersion: string;
  ipAddress: string;
  startedAt: string;
  expiresAt: string | null;
  lastActivityAt: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-orange-100 text-orange-700',
  REVOKED: 'bg-red-100 text-red-700',
  ENDED: 'bg-gray-100 text-gray-600',
};

export default function MobileSessionsPage() {
  const [sessions, setSessions] = useState<MobileSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterStatus) params.set('status', filterStatus);
    fetch(`/api/backend/mobile-sessions?${params}`)
      .then(r => r.json())
      .then(data => setSessions(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await fetch(`/api/backend/mobile-sessions/${id}/revoke`, { method: 'POST' });
      load();
    } catch (e) { console.error(e); }
    finally { setRevokingId(null); }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Mobile Sessions</h1>
        <p className="text-gray-500 mt-1">View and manage active mobile sessions</p>
      </div>

      <div className="flex gap-3 mb-4">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          {['ACTIVE','EXPIRED','REVOKED','ENDED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {loading ? <div className="text-center py-10 text-gray-500">Loading...</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Device ID</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">App Version</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Started</th>
                <th className="px-4 py-3">Expires</th>
                <th className="px-4 py-3">Last Activity</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.length === 0 ? (
                <tr><td colSpan={10} className="text-center py-8 text-gray-400">No sessions found</td></tr>
              ) : sessions.map(s => (
                <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{s.sessionCode}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{s.user?.name ?? '—'}</div>
                    <div className="text-xs text-gray-400">{s.user?.email}</div>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.deviceId}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[s.status] ?? 'bg-gray-100 text-gray-600'}`}>{s.status}</span></td>
                  <td className="px-4 py-3 text-gray-500">{s.appVersion}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.ipAddress}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{s.startedAt ? new Date(s.startedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{s.expiresAt ? new Date(s.expiresAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    {s.status === 'ACTIVE' && (
                      <button onClick={() => revoke(s.id)} disabled={revokingId === s.id} className="text-red-600 hover:underline text-xs disabled:opacity-50">
                        {revokingId === s.id ? 'Revoking...' : 'Revoke'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

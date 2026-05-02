'use client';

import { useState, useEffect, useCallback } from 'react';
import { unwrapList } from '@/lib/unwrap';

interface Device {
  id: string;
  deviceCode: string;
  deviceName: string;
  deviceType: string;
  platform: string;
  status: string;
  userId: string;
  lastSeenAt: string | null;
}

const DEVICE_TYPE_COLORS: Record<string, string> = {
  SMARTPHONE: 'bg-blue-100 text-blue-700',
  TABLET: 'bg-purple-100 text-purple-700',
  DESKTOP: 'bg-gray-100 text-gray-700',
  WEARABLE: 'bg-green-100 text-green-700',
};

const PLATFORM_COLORS: Record<string, string> = {
  ANDROID: 'bg-green-100 text-green-700',
  IOS: 'bg-gray-100 text-gray-700',
  WEB: 'bg-blue-100 text-blue-700',
  WINDOWS: 'bg-blue-100 text-blue-700',
};

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-600',
  BLOCKED: 'bg-red-100 text-red-700',
  REVOKED: 'bg-orange-100 text-orange-700',
};

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterPlatform, setFilterPlatform] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterType) params.set('deviceType', filterType);
    if (filterPlatform) params.set('platform', filterPlatform);
    if (filterStatus) params.set('status', filterStatus);
    fetch(`/api/backend/devices?${params}`)
      .then(r => r.json())
      .then(data => setDevices(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterType, filterPlatform, filterStatus]);

  useEffect(() => { load(); }, [load]);

  async function performAction(id: string, action: 'block' | 'revoke') {
    setActionId(id);
    try {
      await fetch(`/api/backend/devices/${id}/${action}`, { method: 'POST' });
      load();
    } catch (e) { console.error(e); }
    finally { setActionId(null); }
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Device Registrations</h1>
        <p className="text-gray-500 mt-1">Manage registered mobile and web devices</p>
      </div>

      <div className="flex gap-3 mb-4">
        <select value={filterType} onChange={e => setFilterType(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Types</option>
          {['SMARTPHONE','TABLET','DESKTOP','WEARABLE'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterPlatform} onChange={e => setFilterPlatform(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Platforms</option>
          {['ANDROID','IOS','WEB','WINDOWS'].map(p => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Status</option>
          {['ACTIVE','INACTIVE','BLOCKED','REVOKED'].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {loading ? <div className="text-center py-10 text-gray-500">Loading...</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Device Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Platform</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">User ID</th>
                <th className="px-4 py-3">Last Seen</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {devices.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">No devices found</td></tr>
              ) : devices.map(d => (
                <tr key={d.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{d.deviceCode}</td>
                  <td className="px-4 py-3 font-medium">{d.deviceName}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${DEVICE_TYPE_COLORS[d.deviceType] ?? 'bg-gray-100 text-gray-600'}`}>{d.deviceType}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${PLATFORM_COLORS[d.platform] ?? 'bg-gray-100 text-gray-600'}`}>{d.platform}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[d.status] ?? 'bg-gray-100 text-gray-600'}`}>{d.status}</span></td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{d.userId}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 flex gap-2">
                    {d.status === 'ACTIVE' && (
                      <>
                        <button onClick={() => performAction(d.id, 'block')} disabled={actionId === d.id} className="text-yellow-600 hover:underline text-xs disabled:opacity-50">Block</button>
                        <button onClick={() => performAction(d.id, 'revoke')} disabled={actionId === d.id} className="text-red-600 hover:underline text-xs disabled:opacity-50">Revoke</button>
                      </>
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

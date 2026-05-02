'use client';

import { useCallback, useEffect, useState } from 'react';

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-blue-100 text-blue-700',
  INFO: 'bg-gray-100 text-gray-600',
};

const STATUS_COLORS: Record<string, string> = {
  OPEN: 'bg-red-100 text-red-700',
  REVIEWED: 'bg-yellow-100 text-yellow-700',
  RESOLVED: 'bg-green-100 text-green-700',
  DISMISSED: 'bg-gray-100 text-gray-500',
};

export default function SecurityEventsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (severity) params.set('severity', severity);
    if (status) params.set('status', status);
    setLoading(true);
    fetch(`/api/backend/security-events?${params}`)
      .then((r) => r.json())
      .then((res) =>
        setData(
          Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [],
        ),
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [severity, status]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAction(id: string, action: 'review' | 'resolve') {
    await fetch(`/api/backend/security-events/${id}/${action}`, { method: 'POST' }).catch(() => {});
    load();
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Security Events</h1>
        <p className="text-gray-500 mt-1">Review and resolve security events</p>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Severities</option>
          {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Statuses</option>
          {['OPEN', 'REVIEWED', 'RESOLVED', 'DISMISSED'].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Event #</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created At</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-gray-400">
                    No events found
                  </td>
                </tr>
              ) : (
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.eventNumber}</td>
                    <td className="px-4 py-3">{row.eventType}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[row.severity] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {row.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3">{row.user?.name ?? row.userId ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.ipAddress ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.createdAt ? new Date(row.createdAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        {row.status === 'OPEN' && (
                          <button
                            onClick={() => handleAction(row.id, 'review')}
                            className="px-2 py-1 rounded text-xs bg-yellow-100 text-yellow-700 hover:bg-yellow-200"
                          >
                            Review
                          </button>
                        )}
                        {(row.status === 'OPEN' || row.status === 'REVIEWED') && (
                          <button
                            onClick={() => handleAction(row.id, 'resolve')}
                            className="px-2 py-1 rounded text-xs bg-green-100 text-green-700 hover:bg-green-200"
                          >
                            Resolve
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

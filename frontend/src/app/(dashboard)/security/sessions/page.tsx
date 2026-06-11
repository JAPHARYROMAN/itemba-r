'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';
import { backendList, backendPatch } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
  REVOKED: 'bg-red-100 text-red-700',
};

export default function ActiveSessionsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    backendList<any>('active-sessions')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(id: string) {
    await backendPatch(`active-sessions/${id}/revoke`, { revokeReason: 'ADMIN_REVOKED' }).catch(
      () => {},
    );
    load();
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Active Sessions</h1>
        <p className="text-gray-500 mt-1">Monitor and revoke user sessions</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Session Code</th>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Device</th>
                <th className="px-4 py-3">Started At</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Activity</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                    No sessions found
                  </td>
                </tr>
              ) : (
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs">{row.sessionCode}</td>
                    <td className="px-4 py-3">{row.user?.name ?? row.userId}</td>
                    <td className="px-4 py-3">{row.sessionType}</td>
                    <td className="px-4 py-3 font-mono text-xs">{row.ipAddress ?? '—'}</td>
                    <td className="px-4 py-3 text-xs">{row.deviceSummary ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.lastActivityAt ? new Date(row.lastActivityAt).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === 'ACTIVE' && (
                        <button
                          onClick={() => revoke(row.id)}
                          className="px-2 py-1 rounded text-xs bg-red-100 text-red-700 hover:bg-red-200"
                        >
                          Revoke
                        </button>
                      )}
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

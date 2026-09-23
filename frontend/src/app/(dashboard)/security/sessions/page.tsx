'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, PageSpinner, showToast } from '@/components/ui';
import { ApiError, backendList, backendPatch } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  EXPIRED: 'bg-gray-100 text-gray-500',
  REVOKED: 'bg-red-100 text-red-700',
};

export default function ActiveSessionsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('active_sessions.view');
  const beginRequest = useRequestGuard();
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await backendList<any>('active-sessions', { signal: request.signal });
      if (!request.current()) return;
      setData(rows);
    } catch {
      if (!request.current()) return;
      setData([]);
      setLoadError('Failed to load active sessions.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(id: string) {
    try {
      await backendPatch(`active-sessions/${id}/revoke`, { revokeReason: 'ADMIN_REVOKED' });
    } catch (err) {
      showToast('error', 'Failed to revoke session', err instanceof ApiError ? err.message : undefined);
      return;
    }
    void load();
  }

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900">Active Sessions</h1>
        <p className="text-gray-500 mt-1">{authLoading ? 'Loading' : 'Access Restricted'}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Active Sessions</h1>
        <p className="text-gray-500 mt-1">Monitor and revoke user sessions</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <WorkspaceTable className="w-full text-sm">
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
          </WorkspaceTable>
        </div>
      )}
    </div>
  );
}

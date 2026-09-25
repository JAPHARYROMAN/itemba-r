'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useCallback, useEffect, useState } from 'react';
import { ErrorState, PageSpinner } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';
import { backendList } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  REQUESTED: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

interface BackupRun {
  id: string;
  backupRunNumber: string;
  backupJobId?: string | null;
  backupType: string;
  status: string;
  startedAt?: string | null;
  durationMs?: number | null;
  fileSizeBytes?: string | null;
  errorMessage?: string | null;
  coverageWarning?: string | null;
}

export default function BackupRunsPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('backup_runs.view');
  const beginRequest = useRequestGuard();
  const [data, setData] = useState<BackupRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const rows = await backendList<BackupRun>('/backup-runs', { signal: request.signal });
      if (!request.current()) return;
      setData(rows);
    } catch (err) {
      if (!request.current()) return;
      setLoadError(err instanceof Error ? err.message : 'Failed to load backup runs.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => {
    void load();
  }, [load]);

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900">Backup Runs</h1>
        <p className="text-gray-500 mt-1">{authLoading ? 'Loading' : 'Access restricted'}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Backup Runs</h1>
        <p className="text-gray-500 mt-1">History of all backup run executions</p>
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
                <th className="px-4 py-3">Run #</th>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Started At</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">File Size</th>
                <th className="px-4 py-3">Error</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No backup runs found</td></tr>
              ) : data.map((row) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.backupRunNumber}</td>
                  <td className="px-4 py-3">{row.backupJobId ?? '—'}</td>
                  <td className="px-4 py-3">{row.backupType ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.coverageWarning ? 'bg-amber-100 text-amber-900' : STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.coverageWarning ? 'REVIEW REQUIRED' : row.status}</span>
                    {row.coverageWarning ? <p className="mt-2 max-w-sm text-xs text-amber-800 dark:text-amber-300">{row.coverageWarning}</p> : null}
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">{row.durationMs != null ? `${(row.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="px-4 py-3">{row.fileSizeBytes != null ? `${(Number(row.fileSizeBytes) / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
                  <td className="px-4 py-3 text-red-600 text-xs max-w-[280px] break-words">{row.errorMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </WorkspaceTable>
        </div>
      )}
    </div>
  );
}

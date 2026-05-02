'use client';

import { useState, useEffect } from 'react';
import { backendList } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  REQUESTED: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

export default function BackupRunsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    backendList<any>('/backup-runs')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Backup Runs</h1>
        <p className="text-gray-500 mt-1">History of all backup run executions</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
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
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.backupRunNumber}</td>
                  <td className="px-4 py-3">{row.backupJobId ?? '—'}</td>
                  <td className="px-4 py-3">{row.backupType ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">{row.durationMs != null ? `${(row.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                  <td className="px-4 py-3">{row.fileSizeBytes != null ? `${(row.fileSizeBytes / 1024 / 1024).toFixed(1)} MB` : '—'}</td>
                  <td className="px-4 py-3 text-red-600 text-xs max-w-[200px] truncate">{row.errorMessage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

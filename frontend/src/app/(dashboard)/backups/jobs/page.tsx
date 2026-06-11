'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';
import { backendList } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  INACTIVE: 'bg-gray-100 text-gray-500',
  PAUSED: 'bg-yellow-100 text-yellow-700',
};

export default function BackupJobsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    backendList<any>('/backup-jobs')
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Backup Jobs</h1>
        <p className="text-gray-500 mt-1">Configure and manage scheduled backup jobs</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Storage Target</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Run</th>
                <th className="px-4 py-3">Next Run</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No backup jobs found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.backupJobCode}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">{row.backupType}</td>
                  <td className="px-4 py-3 font-mono text-xs">{row.schedule ?? '—'}</td>
                  <td className="px-4 py-3">{row.storageTarget ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.lastRunAt ? new Date(row.lastRunAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{row.nextRunAt ? new Date(row.nextRunAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

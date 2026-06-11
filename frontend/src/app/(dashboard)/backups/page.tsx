'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';
import Link from 'next/link';
import { backendGet } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  RUNNING: 'bg-blue-100 text-blue-700',
  REQUESTED: 'bg-yellow-100 text-yellow-700',
  CANCELLED: 'bg-gray-100 text-gray-500',
};

interface BackupJobLite { id: string; name: string; status: string }
interface BackupRunLite {
  id: string;
  backupRunNumber?: string;
  backupJobId?: string | null;
  status: string;
  startedAt?: string | null;
  durationMs?: number | null;
}

export default function BackupDashboardPage() {
  const [activeJobs, setActiveJobs] = useState<BackupJobLite[]>([]);
  const [runs, setRuns] = useState<BackupRunLite[]>([]);
  const [failedRunsLast7Days, setFailedRunsLast7Days] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    backendGet<any>('/backups/dashboard')
      .then(d => {
        setActiveJobs(Array.isArray(d?.activeJobs) ? d.activeJobs : []);
        setRuns(Array.isArray(d?.recentRuns) ? d.recentRuns : []);
        setFailedRunsLast7Days(typeof d?.failedRunsLast7Days === 'number' ? d.failedRunsLast7Days : 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const successfulRunsRecent = runs.filter(r => r.status === 'COMPLETED').length;
  const lastSuccessfulRun = runs.find(r => r.status === 'COMPLETED' && r.startedAt);

  const statCards = [
    { label: 'Active Backup Jobs', value: activeJobs.length, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Successful Runs (Recent)', value: successfulRunsRecent, color: 'bg-green-50 text-green-700 border-green-200' },
    { label: 'Failed Runs (7d)', value: failedRunsLast7Days, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: 'Last Backup', value: lastSuccessfulRun?.startedAt ? new Date(lastSuccessfulRun.startedAt).toLocaleTimeString() : '—', color: 'bg-purple-50 text-purple-700 border-purple-200' },
  ];

  const quickLinks = [
    { label: 'Backup Jobs', href: '/backups/jobs', desc: 'Configure scheduled backup jobs' },
    { label: 'Backup Runs', href: '/backups/runs', desc: 'View backup run history' },
    { label: 'Restore Tests', href: '/backups/restore-tests', desc: 'Verify restore procedures' },
    { label: 'Disaster Recovery', href: '/backups/disaster-recovery', desc: 'Manage DR plans' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Backup Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of backup jobs, runs, and recovery status</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(card => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          {runs.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
              <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">Recent Backup Runs</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-2">Run #</th>
                    <th className="px-4 py-2">Job</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Started At</th>
                    <th className="px-4 py-2">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((run: any) => (
                    <tr key={run.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{run.backupRunNumber}</td>
                      <td className="px-4 py-2">{run.backupJobId ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[run.status] ?? 'bg-gray-100 text-gray-600'}`}>{run.status}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-400">{run.startedAt ? new Date(run.startedAt).toLocaleString() : '—'}</td>
                      <td className="px-4 py-2">{run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickLinks.map(link => (
              <Link key={link.href} href={link.href} className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="font-semibold text-gray-900 mb-1">{link.label}</div>
                <div className="text-sm text-gray-500">{link.desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

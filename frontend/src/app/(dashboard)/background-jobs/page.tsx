'use client';

import { useState, useEffect, useCallback } from 'react';
import { backendGet, backendPage, backendPut } from '@/lib/api-client';

const STATUS_COLORS: Record<string, string> = {
  QUEUED: 'bg-blue-100 text-blue-700',
  RUNNING: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-100 text-gray-600',
  DEAD_LETTER: 'bg-red-200 text-red-800',
};

export default function BackgroundJobsPage() {
  const [jobs, setJobs] = useState<any[]>([]);
  const [stats, setStats] = useState({ queued: 0, running: 0, failed: 0, deadLetter: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const fetchJobs = useCallback(() => {
    setLoading(true);
    Promise.all([
      backendPage<any>('/background-jobs', { query: { page, pageSize: limit } }),
      backendGet<Record<string, number>>('/background-jobs/stats'),
    ])
      .then(([jobsRes, statsRes]) => {
        setJobs(jobsRes.data);
        setTotal(jobsRes.total);
        const s = statsRes;
        setStats({ queued: s.queued ?? s.QUEUED ?? 0, running: s.running ?? s.RUNNING ?? 0, failed: s.failed ?? s.FAILED ?? 0, deadLetter: s.deadLetter ?? s.DEAD_LETTER ?? 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  async function retryJob(id: string) {
    await backendPut(`/background-jobs/${id}/retry`);
    fetchJobs();
  }

  async function cancelJob(id: string) {
    await backendPut(`/background-jobs/${id}/cancel`);
    fetchJobs();
  }

  const statCards = [
    { label: 'Queued', value: stats.queued, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Running', value: stats.running, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    { label: 'Failed', value: stats.failed, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: 'Dead Letter', value: stats.deadLetter, color: 'bg-red-100 text-red-800 border-red-300' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Background Jobs</h1>
        <p className="text-gray-500 mt-1">Monitor and manage background job processing queues</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {statCards.map(card => (
          <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
            <div className="text-3xl font-bold">{card.value}</div>
            <div className="text-sm font-medium mt-1">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Job #</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Queue</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Priority</th>
              <th className="px-4 py-3">Attempts</th>
              <th className="px-4 py-3">Scheduled At</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : jobs.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">No jobs found</td></tr>
            ) : jobs.map((j: any) => (
              <tr key={j.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{j.jobNumber ?? j.id?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-3">{j.jobType ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{j.queue ?? j.queueName ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[j.status] ?? 'bg-gray-100 text-gray-600'}`}>{j.status ?? '—'}</span>
                </td>
                <td className="px-4 py-3">{j.priority ?? '—'}</td>
                <td className="px-4 py-3">{j.attempts ?? 0}</td>
                <td className="px-4 py-3 text-gray-400">{j.scheduledAt ? new Date(j.scheduledAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3 text-gray-400">{j.createdAt ? new Date(j.createdAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => retryJob(j.id)} className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Retry</button>
                    <button onClick={() => cancelJob(j.id)} className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100">Cancel</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            <span>Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-40">‹ Prev</button>
              <button onClick={() => setPage(p => p + 1)} disabled={page * limit >= total} className="px-3 py-1 border rounded disabled:opacity-40">Next ›</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

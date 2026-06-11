'use client';

import { useState, useEffect, useCallback } from 'react';
import { PageSpinner } from '@/components/ui';
import { backendList, backendPut } from '@/lib/api-client';

export default function JobQueuesPage() {
  const [queues, setQueues] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchQueues = useCallback(() => {
    setLoading(true);
    backendList<any>('/job-queue-configs')
      .then(setQueues)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchQueues(); }, [fetchQueues]);

  async function toggleQueue(id: string, isActive: boolean) {
    const endpoint = isActive ? 'deactivate' : 'activate';
    await backendPut(`/job-queue-configs/${id}/${endpoint}`);
    fetchQueues();
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Job Queue Configurations</h1>
        <p className="text-gray-500 mt-1">Manage background job queues, concurrency and retry settings</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Queue Name</th>
              <th className="px-4 py-3">Description</th>
              <th className="px-4 py-3">Concurrency</th>
              <th className="px-4 py-3">Retry Attempts</th>
              <th className="px-4 py-3">Timeout (s)</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-6"><PageSpinner label="Loading records" className="py-8" /></td></tr>
            ) : queues.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No queues configured</td></tr>
            ) : queues.map((q: any) => (
              <tr key={q.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{q.queueName ?? q.name ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{q.description ?? '—'}</td>
                <td className="px-4 py-3">{q.concurrency ?? '—'}</td>
                <td className="px-4 py-3">{q.retryAttempts ?? q.maxRetries ?? '—'}</td>
                <td className="px-4 py-3">{q.timeoutSeconds ?? q.timeout ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${q.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {q.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleQueue(q.id, q.isActive)}
                    className={`px-3 py-1 text-xs rounded font-medium transition-colors ${q.isActive ? 'bg-red-50 text-red-700 hover:bg-red-100' : 'bg-green-50 text-green-700 hover:bg-green-100'}`}
                  >
                    {q.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

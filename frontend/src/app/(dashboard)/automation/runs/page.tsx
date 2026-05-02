'use client';

import { useState, useEffect } from 'react';

export default function AutomationRunsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/automation-runs')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Automation Runs</h1>
        <p className="text-gray-500 mt-1">Monitor automation execution history and results</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Run #</th>
                <th className="px-4 py-3">Run Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Started At</th>
                <th className="px-4 py-3">Completed At</th>
                <th className="px-4 py-3">Processed</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Failed</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No records found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.automationRunNumber}</td>
                  <td className="px-4 py-3">{row.runType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : row.status === 'FAILED' ? 'bg-red-100 text-red-700' : row.status === 'RUNNING' ? 'bg-blue-100 text-blue-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.startedAt ? new Date(row.startedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3 text-gray-400">{row.completedAt ? new Date(row.completedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">{row.recordsProcessed ?? 0}</td>
                  <td className="px-4 py-3 text-green-700">{row.recordsCreated ?? 0}</td>
                  <td className="px-4 py-3 text-red-600 font-medium">{row.recordsFailed ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

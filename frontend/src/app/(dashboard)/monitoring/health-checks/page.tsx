'use client';

import { useState, useEffect } from 'react';

const STATUS_COLORS: Record<string, string> = {
  HEALTHY: 'bg-green-100 text-green-700',
  WARNING: 'bg-yellow-100 text-yellow-700',
  CRITICAL: 'bg-red-100 text-red-700',
  UNKNOWN: 'bg-gray-100 text-gray-500',
};

export default function HealthChecksPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch('/api/backend/system-health')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function runCheck(id: string) {
    setRunning(id);
    await fetch(`/api/backend/system-health/${id}/run`, { method: 'POST' }).catch(() => {});
    setRunning(null);
    load();
  }

  async function runAll() {
    setRunning('all');
    await fetch('/api/backend/system-health/run-all', { method: 'POST' }).catch(() => {});
    setRunning(null);
    load();
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health Checks</h1>
          <p className="text-gray-500 mt-1">Monitor and run system health checks</p>
        </div>
        <button
          onClick={runAll}
          disabled={running === 'all'}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          {running === 'all' ? 'Running...' : 'Run All'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Checked</th>
                <th className="px-4 py-3">Response Time</th>
                <th className="px-4 py-3">Active</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No health checks found</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.checkCode}</td>
                  <td className="px-4 py-3 font-medium">{row.name}</td>
                  <td className="px-4 py-3">{row.checkType}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.status}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">{row.responseTimeMs != null ? `${row.responseTimeMs}ms` : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {row.isActive ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => runCheck(row.id)}
                      disabled={running === row.id}
                      className="px-2 py-1 rounded text-xs bg-blue-100 text-blue-700 hover:bg-blue-200 disabled:opacity-60"
                    >
                      {running === row.id ? 'Running...' : 'Run'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

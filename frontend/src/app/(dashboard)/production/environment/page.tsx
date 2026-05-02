'use client';

import { useState, useEffect } from 'react';

const STATUS_COLORS: Record<string, string> = {
  PASS: 'bg-green-100 text-green-700',
  FAIL: 'bg-red-100 text-red-700',
  WARNING: 'bg-yellow-100 text-yellow-700',
  UNKNOWN: 'bg-gray-100 text-gray-500',
};

export default function EnvironmentChecksPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  function load() {
    setLoading(true);
    fetch('/api/backend/environment-config-checks')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function runChecks() {
    setRunning(true);
    await fetch('/api/backend/environment-config-checks/run', { method: 'POST' }).catch(() => {});
    setRunning(false);
    load();
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Environment Config Checks</h1>
          <p className="text-gray-500 mt-1">Validate required environment configuration values</p>
        </div>
        <button
          onClick={runChecks}
          disabled={running}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60"
        >
          {running ? 'Running Checks...' : 'Run Checks'}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Config Key</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Required</th>
                <th className="px-4 py-3">Present</th>
                <th className="px-4 py-3">Valid</th>
                <th className="px-4 py-3">Masked Value</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Last Checked</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No environment checks found — click &quot;Run Checks&quot; to populate</td></tr>
              ) : data.map((row: any) => (
                <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{row.configKey}</td>
                  <td className="px-4 py-3">{row.category ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isRequired ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                      {row.isRequired ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isPresent ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {row.isPresent ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.isValid ? 'bg-green-100 text-green-700' : row.isValid === false ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                      {row.isValid == null ? '—' : row.isValid ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{row.maskedValue ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.status ?? '—'}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-400">{row.lastCheckedAt ? new Date(row.lastCheckedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { unwrapList } from '@/lib/unwrap';

interface ApiRequestLog {
  id: string;
  requestNumber: string;
  method: string;
  path: string;
  statusCode: number;
  ipAddress: string;
  durationMs: number;
  rateLimited: boolean;
  createdAt: string;
}

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-blue-100 text-blue-700',
  POST: 'bg-green-100 text-green-700',
  PUT: 'bg-yellow-100 text-yellow-700',
  PATCH: 'bg-orange-100 text-orange-700',
  DELETE: 'bg-red-100 text-red-700',
};

function statusCodeColor(code: number): string {
  if (code >= 200 && code < 300) return 'text-green-700 font-medium';
  if (code >= 400 && code < 500) return 'text-yellow-700 font-medium';
  if (code >= 500) return 'text-red-700 font-medium';
  return 'text-gray-600';
}

export default function ApiRequestLogsPage() {
  const [logs, setLogs] = useState<ApiRequestLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatusCode, setFilterStatusCode] = useState('');
  const [filterRateLimited, setFilterRateLimited] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (filterStatusCode) params.set('statusCode', filterStatusCode);
    if (filterRateLimited === 'true') params.set('rateLimited', 'true');
    if (filterRateLimited === 'false') params.set('rateLimited', 'false');
    fetch(`/api/backend/api-request-logs?${params}`)
      .then(r => r.json())
      .then(data => setLogs(unwrapList(data)))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [filterStatusCode, filterRateLimited]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">API Request Logs</h1>
        <p className="text-gray-500 mt-1">Monitor incoming API requests</p>
      </div>

      <div className="flex gap-3 mb-4">
        <input value={filterStatusCode} onChange={e => setFilterStatusCode(e.target.value)} placeholder="Status code (e.g. 200, 4xx)..." className="border border-gray-200 rounded-lg px-3 py-2 text-sm w-48" />
        <select value={filterRateLimited} onChange={e => setFilterRateLimited(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All Requests</option>
          <option value="true">Rate Limited Only</option>
          <option value="false">Not Rate Limited</option>
        </select>
        <button onClick={load} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm hover:bg-gray-200">Search</button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        {loading ? <div className="text-center py-10 text-gray-500">Loading...</div> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Method</th>
                <th className="px-4 py-3">Path</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">IP Address</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3">Rate Limited</th>
                <th className="px-4 py-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-8 text-gray-400">No logs found</td></tr>
              ) : logs.map(log => (
                <tr key={log.id} className="border-t border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{log.requestNumber}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs font-medium ${METHOD_COLORS[log.method] ?? 'bg-gray-100 text-gray-600'}`}>{log.method}</span></td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-600 max-w-xs truncate">{log.path}</td>
                  <td className={`px-4 py-3 ${statusCodeColor(log.statusCode)}`}>{log.statusCode}</td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{log.ipAddress}</td>
                  <td className="px-4 py-3 text-gray-500">{log.durationMs}ms</td>
                  <td className="px-4 py-3">{log.rateLimited ? <span className="px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Yes</span> : <span className="text-gray-400 text-xs">No</span>}</td>
                  <td className="px-4 py-3 text-gray-400 text-xs">{log.createdAt ? new Date(log.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

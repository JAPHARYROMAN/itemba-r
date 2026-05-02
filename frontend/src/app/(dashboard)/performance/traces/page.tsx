'use client';

import { useState, useEffect, useCallback } from 'react';

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  timeout: 'bg-yellow-100 text-yellow-700',
};

export default function PerformanceTracesPage() {
  const [traces, setTraces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [traceType, setTraceType] = useState('');
  const [status, setStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const fetchTraces = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (traceType) params.set('traceType', traceType);
    if (status) params.set('status', status);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);
    fetch(`/api/backend/performance-traces?${params}`)
      .then(r => r.json())
      .then(res => {
        setTraces(res.data ?? res.traces ?? []);
        setTotal(res.total ?? res.meta?.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, traceType, status, dateFrom, dateTo]);

  useEffect(() => { fetchTraces(); }, [fetchTraces]);

  async function purgeOldTraces() {
    if (!confirm('Purge all old traces? This cannot be undone.')) return;
    const res = await fetch('/api/backend/performance-traces/purge-old', { method: 'DELETE' });
    if (res.ok) { fetchTraces(); }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance Traces</h1>
          <p className="text-gray-500 mt-1">All distributed traces and operation timing records</p>
        </div>
        <button onClick={purgeOldTraces} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 transition-colors">
          Purge Old Traces
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4 flex flex-wrap gap-3">
        <select value={traceType} onChange={e => { setTraceType(e.target.value); setPage(1); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="">All Types</option>
          <option value="HTTP">HTTP</option>
          <option value="DATABASE">DATABASE</option>
          <option value="CACHE">CACHE</option>
          <option value="QUEUE">QUEUE</option>
          <option value="EXTERNAL">EXTERNAL</option>
        </select>
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
          <option value="">All Statuses</option>
          <option value="success">Success</option>
          <option value="error">Error</option>
          <option value="timeout">Timeout</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Operation Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Duration (ms)</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Path</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : traces.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400">No traces found</td></tr>
            ) : traces.map((t: any) => (
              <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-medium">{t.operationName ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{t.traceType ?? '—'}</td>
                <td className="px-4 py-3">{t.durationMs ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>{t.status ?? '—'}</span>
                </td>
                <td className="px-4 py-3 text-gray-500 max-w-[160px] truncate">{t.path ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{t.companyId ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400">{t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</td>
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

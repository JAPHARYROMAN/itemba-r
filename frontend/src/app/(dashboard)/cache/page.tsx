'use client';

import { useState, useEffect, useCallback } from 'react';

export default function CachePage() {
  const [entries, setEntries] = useState<any[]>([]);
  const [stats, setStats] = useState({ total: 0, expired: 0 });
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const fetchData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/backend/cache?page=${page}&limit=${limit}`).then(r => r.json()),
      fetch('/api/backend/cache/stats').then(r => r.json()),
    ])
      .then(([cacheRes, statsRes]) => {
        setEntries(Array.isArray(cacheRes.data?.data) ? cacheRes.data.data : Array.isArray(cacheRes.data) ? cacheRes.data : Array.isArray(cacheRes.entries) ? cacheRes.entries : []);
        setTotal(cacheRes.data?.total ?? cacheRes.total ?? cacheRes.meta?.total ?? 0);
        const s = statsRes.data ?? statsRes;
        setStats({ total: s.total ?? s.totalEntries ?? 0, expired: s.expired ?? s.expiredEntries ?? 0 });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function deleteEntry(id: string) {
    await fetch(`/api/backend/cache/${id}`, { method: 'DELETE' });
    fetchData();
  }

  async function invalidateByCompany() {
    const companyId = prompt('Enter Company ID to invalidate cache:');
    if (!companyId) return;
    const res = await fetch(`/api/backend/cache/invalidate-company/${companyId}`, { method: 'DELETE' });
    if (res.ok) { fetchData(); }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cache Management</h1>
          <p className="text-gray-500 mt-1">View and manage application cache entries</p>
        </div>
        <button onClick={invalidateByCompany} className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg hover:bg-orange-700 transition-colors">
          Invalidate by Company
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border p-5 bg-blue-50 text-blue-700 border-blue-200">
          <div className="text-3xl font-bold">{stats.total}</div>
          <div className="text-sm font-medium mt-1">Total Cache Entries</div>
        </div>
        <div className="rounded-xl border p-5 bg-yellow-50 text-yellow-700 border-yellow-200">
          <div className="text-3xl font-bold">{stats.expired}</div>
          <div className="text-sm font-medium mt-1">Expired Entries</div>
          <div className="text-xs mt-1 opacity-70">Expired entries are purged automatically on next access</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Cache Key</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Company</th>
              <th className="px-4 py-3">Expires At</th>
              <th className="px-4 py-3">Created</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : entries.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">No cache entries found</td></tr>
            ) : entries.map((e: any) => (
              <tr key={e.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs max-w-[200px] truncate">{e.cacheKey ?? e.key ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{e.cacheType ?? e.type ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{e.companyId ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400">{e.expiresAt ? new Date(e.expiresAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3 text-gray-400">{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <button onClick={() => deleteEntry(e.id)} className="px-2 py-1 text-xs bg-red-50 text-red-700 rounded hover:bg-red-100">Delete</button>
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

'use client';

import { useState, useEffect } from 'react';

const STATUS_COLORS: Record<string, string> = {
  PASSED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  NOT_STARTED: 'bg-gray-100 text-gray-500',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  WAIVED: 'bg-yellow-100 text-yellow-700',
  PENDING: 'bg-orange-100 text-orange-700',
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-blue-100 text-blue-700',
};

export default function ReadinessChecklistPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    fetch('/api/backend/production-readiness')
      .then(r => r.json())
      .then(res => setData(Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function updateStatus(id: string, status: string) {
    await fetch(`/api/backend/production-readiness/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    }).catch(() => {});
    load();
  }

  const categories = [...new Set(data.map(d => d.category).filter(Boolean))];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Production Readiness Checklist</h1>
        <p className="text-gray-500 mt-1">All readiness checks grouped by category</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="space-y-6">
          {categories.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Responsible</th>
                    <th className="px-4 py-3">Due Date</th>
                    <th className="px-4 py-3">Update</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No readiness checks found</td></tr>
                </tbody>
              </table>
            </div>
          ) : categories.map(cat => {
            const items = data.filter(d => d.category === cat);
            return (
              <div key={cat} className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
                <div className="px-5 py-3 border-b border-gray-100 font-semibold text-gray-800 bg-gray-50">{cat}</div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                      <th className="px-4 py-2">Code</th>
                      <th className="px-4 py-2">Title</th>
                      <th className="px-4 py-2">Priority</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2">Responsible</th>
                      <th className="px-4 py-2">Due Date</th>
                      <th className="px-4 py-2">Update</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row: any) => (
                      <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="px-4 py-2 font-mono text-xs">{row.checkCode}</td>
                        <td className="px-4 py-2 font-medium">{row.title}</td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${PRIORITY_COLORS[row.priority] ?? 'bg-gray-100 text-gray-600'}`}>{row.priority}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[row.status] ?? 'bg-gray-100 text-gray-600'}`}>{row.status}</span>
                        </td>
                        <td className="px-4 py-2">{row.responsibleUser?.name ?? '—'}</td>
                        <td className="px-4 py-2 text-gray-400">{row.dueDate ? new Date(row.dueDate).toLocaleDateString() : '—'}</td>
                        <td className="px-4 py-2">
                          <select
                            defaultValue={row.status}
                            onChange={e => updateStatus(row.id, e.target.value)}
                            className="border rounded px-2 py-1 text-xs"
                          >
                            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

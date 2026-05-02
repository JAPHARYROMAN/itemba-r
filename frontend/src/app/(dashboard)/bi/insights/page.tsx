'use client';

import { useCallback, useEffect, useState } from 'react';

interface ExecutiveInsight {
  id: string;
  insightNumber: string;
  title: string;
  insightType: string;
  severity: string;
  status: string;
  insightDate: string;
}

export default function InsightsPage() {
  const [insights, setInsights] = useState<ExecutiveInsight[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const loadInsights = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (statusFilter) params.set('status', statusFilter);
    fetch(`/api/backend/bi/insights?${params}`)
      .then((r) => r.json())
      .then((data: ExecutiveInsight[]) => setInsights(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [statusFilter]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  function acknowledge(id: string) {
    fetch(`/api/backend/bi/insights/${id}/acknowledge`, { method: 'PATCH' })
      .then(() => loadInsights())
      .catch(console.error);
  }

  function resolve(id: string) {
    fetch(`/api/backend/bi/insights/${id}/resolve`, { method: 'PATCH' })
      .then(() => loadInsights())
      .catch(console.error);
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Executive Insights</h1>

      <div className="mb-4 flex gap-3 items-center">
        <label className="text-sm text-gray-600">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1 text-sm"
        >
          <option value="">All</option>
          {['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED'].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-gray-500 animate-pulse">Loading...</p>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Title</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Severity</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {insights.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    No insights found
                  </td>
                </tr>
              ) : (
                insights.map((ins) => (
                  <tr key={ins.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">{ins.insightNumber}</td>
                    <td className="px-4 py-2 font-medium">{ins.title}</td>
                    <td className="px-4 py-2">{ins.insightType}</td>
                    <td className="px-4 py-2">
                      <SeverityBadge value={ins.severity} />
                    </td>
                    <td className="px-4 py-2">
                      <StatusBadge value={ins.status} />
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {ins.insightDate ? new Date(ins.insightDate).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 flex gap-1">
                      {ins.status === 'OPEN' && (
                        <button
                          onClick={() => acknowledge(ins.id)}
                          className="px-2 py-1 rounded text-xs border border-yellow-300 text-yellow-600 hover:bg-yellow-50"
                        >
                          Acknowledge
                        </button>
                      )}
                      {(ins.status === 'OPEN' || ins.status === 'ACKNOWLEDGED') && (
                        <button
                          onClick={() => resolve(ins.id)}
                          className="px-2 py-1 rounded text-xs border border-green-300 text-green-600 hover:bg-green-50"
                        >
                          Resolve
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SeverityBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    CRITICAL: 'bg-red-100 text-red-700',
    HIGH: 'bg-orange-100 text-orange-700',
    NORMAL: 'bg-blue-100 text-blue-700',
    LOW: 'bg-gray-100 text-gray-600',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {value}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    OPEN: 'bg-yellow-100 text-yellow-700',
    ACKNOWLEDGED: 'bg-blue-100 text-blue-700',
    RESOLVED: 'bg-green-100 text-green-700',
    DISMISSED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs font-medium ${map[value] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {value}
    </span>
  );
}

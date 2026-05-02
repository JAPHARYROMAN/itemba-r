'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  success: 'bg-green-100 text-green-700',
  error: 'bg-red-100 text-red-700',
  timeout: 'bg-yellow-100 text-yellow-700',
};

export default function PerformanceDashboardPage() {
  const [stats, setStats] = useState({ totalTraces: 0, avgResponseTimeToday: 0, slowTraces: 0, failedTracesToday: 0 });
  const [recentTraces, setRecentTraces] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/performance/dashboard')
      .then(r => r.json())
      .then(res => {
        const d = res.data ?? res;
        setStats({
          totalTraces: d.totalTraces ?? 0,
          avgResponseTimeToday: d.avgResponseTimeToday ?? 0,
          slowTraces: d.slowTraces ?? 0,
          failedTracesToday: d.failedTracesToday ?? 0,
        });
        setRecentTraces(d.recentTraces ?? []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Total Traces', value: stats.totalTraces, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Avg Response Time Today', value: `${stats.avgResponseTimeToday}ms`, color: 'bg-purple-50 text-purple-700 border-purple-200' },
    { label: 'Slow Traces (>2s)', value: stats.slowTraces, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    { label: 'Failed Traces Today', value: stats.failedTracesToday, color: 'bg-red-50 text-red-700 border-red-200' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Performance Dashboard</h1>
          <p className="text-gray-500 mt-1">Distributed tracing and response time insights</p>
        </div>
        <Link href="/performance/traces" className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          View All Traces
        </Link>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(card => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <span className="font-semibold text-gray-800">Recent Traces</span>
              <Link href="/performance/traces" className="text-sm text-blue-600 hover:underline">View all →</Link>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                  <th className="px-4 py-2">Operation</th>
                  <th className="px-4 py-2">Type</th>
                  <th className="px-4 py-2">Duration (ms)</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Company</th>
                  <th className="px-4 py-2">Date</th>
                </tr>
              </thead>
              <tbody>
                {recentTraces.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No traces found</td></tr>
                ) : (
                  recentTraces.slice(0, 5).map((t: any) => (
                    <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-medium">{t.operationName ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-500">{t.traceType ?? '—'}</td>
                      <td className="px-4 py-2">{t.durationMs ?? '—'}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>{t.status ?? '—'}</span>
                      </td>
                      <td className="px-4 py-2 text-gray-500">{t.companyId ?? '—'}</td>
                      <td className="px-4 py-2 text-gray-400">{t.createdAt ? new Date(t.createdAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

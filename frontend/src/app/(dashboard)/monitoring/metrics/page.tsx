'use client';

import { useCallback, useEffect, useState } from 'react';

export default function SystemMetricsPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [metricType, setMetricType] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (metricType) params.set('metricType', metricType);
    setLoading(true);
    fetch(`/api/backend/system-metrics?${params}`)
      .then((r) => r.json())
      .then((res) =>
        setData(
          Array.isArray(res.data) ? res.data : Array.isArray(res.data?.data) ? res.data.data : [],
        ),
      )
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [metricType]);

  useEffect(() => {
    load();
  }, [load]);

  const metricTypes = [...new Set(data.map((d: any) => d.metricType).filter(Boolean))];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">System Metrics</h1>
        <p className="text-gray-500 mt-1">View system performance and resource metrics</p>
      </div>

      <div className="flex gap-3 mb-4">
        <select
          value={metricType}
          onChange={(e) => setMetricType(e.target.value)}
          className="border rounded-lg px-3 py-2 text-sm"
        >
          <option value="">All Metric Types</option>
          {metricTypes.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                <th className="px-4 py-3">Metric Type</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Recorded At</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No metrics found
                  </td>
                </tr>
              ) : (
                data.map((row: any) => (
                  <tr key={row.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{row.metricType}</td>
                    <td className="px-4 py-3 font-mono">{row.value}</td>
                    <td className="px-4 py-3 text-gray-500">{row.unit ?? '—'}</td>
                    <td className="px-4 py-3">{row.company?.name ?? row.companyId ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-400">
                      {row.recordedAt ? new Date(row.recordedAt).toLocaleString() : '—'}
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

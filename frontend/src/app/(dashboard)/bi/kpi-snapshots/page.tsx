'use client';

import { useCallback, useEffect, useState } from 'react';

interface KPISnapshot {
  id: string;
  kpiIndicatorId: string;
  periodType: string;
  periodStart: string;
  periodEnd: string;
  value: number;
  currency: string | null;
  companyId: string | null;
  kpiIndicator?: { kpiCode: string };
}

export default function KPISnapshotsPage() {
  const [snapshots, setSnapshots] = useState<KPISnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodFilter, setPeriodFilter] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ periodType: 'MONTHLY', periodStart: '', periodEnd: '' });
  const [generating, setGenerating] = useState(false);

  const loadSnapshots = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ limit: '50' });
    if (periodFilter) params.set('periodType', periodFilter);
    fetch(`/api/backend/bi/kpi-snapshots?${params}`)
      .then((r) => r.json())
      .then((data: KPISnapshot[]) => setSnapshots(Array.isArray(data) ? data : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [periodFilter]);

  useEffect(() => {
    loadSnapshots();
  }, [loadSnapshots]);

  function generateSnapshots() {
    setGenerating(true);
    fetch('/api/backend/bi/kpi-snapshots/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
      .then(() => {
        setShowModal(false);
        loadSnapshots();
      })
      .catch(console.error)
      .finally(() => setGenerating(false));
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">KPI Snapshots</h1>
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
        >
          Generate Snapshots
        </button>
      </div>

      <div className="mb-4 flex gap-3 items-center">
        <label className="text-sm text-gray-600">Period Type:</label>
        <select
          value={periodFilter}
          onChange={(e) => setPeriodFilter(e.target.value)}
          className="border border-gray-300 rounded px-3 py-1 text-sm"
        >
          <option value="">All</option>
          {['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].map((p) => (
            <option key={p} value={p}>
              {p}
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
                <th className="px-4 py-3">KPI Code</th>
                <th className="px-4 py-3">Period Type</th>
                <th className="px-4 py-3">Period Start</th>
                <th className="px-4 py-3">Period End</th>
                <th className="px-4 py-3">Value</th>
                <th className="px-4 py-3">Currency</th>
                <th className="px-4 py-3">Company</th>
              </tr>
            </thead>
            <tbody>
              {snapshots.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-gray-400">
                    No snapshots found
                  </td>
                </tr>
              ) : (
                snapshots.map((s) => (
                  <tr key={s.id} className="border-t border-gray-100 hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono text-xs">
                      {s.kpiIndicator?.kpiCode ?? s.kpiIndicatorId}
                    </td>
                    <td className="px-4 py-2">{s.periodType}</td>
                    <td className="px-4 py-2 text-xs">
                      {s.periodStart ? new Date(s.periodStart).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      {s.periodEnd ? new Date(s.periodEnd).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-2 font-mono">{s.value?.toLocaleString()}</td>
                    <td className="px-4 py-2">{s.currency ?? '—'}</td>
                    <td className="px-4 py-2 text-xs">{s.companyId ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-semibold mb-4">Generate KPI Snapshots</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Period Type</label>
                <select
                  value={form.periodType}
                  onChange={(e) => setForm({ ...form, periodType: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                >
                  {['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Period Start</label>
                <input
                  type="date"
                  value={form.periodStart}
                  onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Period End</label>
                <input
                  type="date"
                  value={form.periodEnd}
                  onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={generateSnapshots}
                disabled={generating}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {generating ? 'Generating...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

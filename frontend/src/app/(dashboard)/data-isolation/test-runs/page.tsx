'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  RUNNING: 'bg-blue-100 text-blue-700',
  PASSED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  ERROR: 'bg-red-200 text-red-800',
};

const RUN_TYPES = [
  { value: 'COMPANY_SCOPE', label: 'Company Scope' },
  { value: 'DIVISION_SCOPE', label: 'Division Scope' },
  { value: 'USER_SCOPE', label: 'User Scope' },
  { value: 'CROSS_TENANT', label: 'Cross Tenant' },
  { value: 'FULL_SUITE', label: 'Full Suite' },
];

export default function DataIsolationTestRunsPage() {
  const [testRuns, setTestRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [runType, setRunType] = useState('COMPANY_SCOPE');
  const [saving, setSaving] = useState(false);

  const fetchTestRuns = useCallback(() => {
    setLoading(true);
    fetch('/api/backend/data-isolation-tests')
      .then(r => r.json())
      .then(res => setTestRuns(res.data ?? res.testRuns ?? res ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchTestRuns(); }, [fetchTestRuns]);

  async function runNewTest() {
    setSaving(true);
    try {
      const res = await fetch('/api/backend/data-isolation-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runType }),
      });
      if (res.ok) {
        setShowModal(false);
        fetchTestRuns();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Isolation Test Runs</h1>
          <p className="text-gray-500 mt-1">Data isolation and multi-tenancy boundary test executions</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          + Run New Test
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Test Run #</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Total Checks</th>
              <th className="px-4 py-3">Passed</th>
              <th className="px-4 py-3">Failed</th>
              <th className="px-4 py-3">Started At</th>
              <th className="px-4 py-3">Issues</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : testRuns.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No test runs found</td></tr>
            ) : testRuns.map((t: any) => (
              <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.runNumber ?? t.id?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{t.runType ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>{t.status ?? '—'}</span>
                </td>
                <td className="px-4 py-3">{t.totalChecks ?? '—'}</td>
                <td className="px-4 py-3 text-green-700">{t.passedChecks ?? '—'}</td>
                <td className="px-4 py-3 text-red-700">{t.failedChecks ?? '—'}</td>
                <td className="px-4 py-3 text-gray-400">{t.startedAt ? new Date(t.startedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <Link href={`/data-isolation/test-runs/${t.id}/issues`} className="px-2 py-1 text-xs bg-orange-50 text-orange-700 rounded hover:bg-orange-100">
                    View Issues
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Run New Test Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Run New Isolation Test</h2>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Run Type *</label>
              <select value={runType} onChange={e => setRunType(e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                {RUN_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
              </select>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={runNewTest} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Running...' : 'Run Test'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

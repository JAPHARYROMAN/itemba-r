'use client';

import { useState, useEffect, useCallback } from 'react';

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-100 text-gray-600',
  RUNNING: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  CANCELLED: 'bg-gray-200 text-gray-500',
};

interface NewLoadTestForm {
  testName: string;
  environment: string;
  targetUrl: string;
  notes: string;
}

export default function LoadTestsPage() {
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<NewLoadTestForm>({ testName: '', environment: 'staging', targetUrl: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const fetchTests = useCallback(() => {
    setLoading(true);
    fetch(`/api/backend/load-tests?page=${page}&limit=${limit}`)
      .then(r => r.json())
      .then(res => {
        setTests(res.data ?? res.tests ?? []);
        setTotal(res.total ?? res.meta?.total ?? 0);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => { fetchTests(); }, [fetchTests]);

  async function createTest() {
    setSaving(true);
    try {
      const res = await fetch('/api/backend/load-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowModal(false);
        setForm({ testName: '', environment: 'staging', targetUrl: '', notes: '' });
        fetchTests();
      }
    } finally {
      setSaving(false);
    }
  }

  async function startTest(id: string) {
    await fetch(`/api/backend/load-tests/${id}/start`, { method: 'PUT' });
    fetchTests();
  }

  async function completeTest(id: string) {
    await fetch(`/api/backend/load-tests/${id}/complete`, { method: 'PUT' });
    fetchTests();
  }

  async function cancelTest(id: string) {
    await fetch(`/api/backend/load-tests/${id}/cancel`, { method: 'PUT' });
    fetchTests();
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Load Tests</h1>
          <p className="text-gray-500 mt-1">Performance and scalability load testing records</p>
        </div>
        <button onClick={() => setShowModal(true)} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          + New Load Test
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
              <th className="px-4 py-3">Test #</th>
              <th className="px-4 py-3">Test Name</th>
              <th className="px-4 py-3">Environment</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Avg Response (ms)</th>
              <th className="px-4 py-3">P95 Response (ms)</th>
              <th className="px-4 py-3">Error Rate</th>
              <th className="px-4 py-3">Started At</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">Loading...</td></tr>
            ) : tests.length === 0 ? (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400">No load tests found</td></tr>
            ) : tests.map((t: any) => (
              <tr key={t.id} className="border-t border-gray-100 hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.testNumber ?? t.id?.slice(0, 8) ?? '—'}</td>
                <td className="px-4 py-3 font-medium">{t.testName ?? '—'}</td>
                <td className="px-4 py-3 text-gray-500">{t.environment ?? '—'}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[t.status] ?? 'bg-gray-100 text-gray-600'}`}>{t.status ?? '—'}</span>
                </td>
                <td className="px-4 py-3">{t.avgResponseMs ?? '—'}</td>
                <td className="px-4 py-3">{t.p95ResponseMs ?? '—'}</td>
                <td className="px-4 py-3">{t.errorRate != null ? `${t.errorRate}%` : '—'}</td>
                <td className="px-4 py-3 text-gray-400">{t.startedAt ? new Date(t.startedAt).toLocaleString() : '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    <button onClick={() => startTest(t.id)} className="px-2 py-1 text-xs bg-green-50 text-green-700 rounded hover:bg-green-100">Start</button>
                    <button onClick={() => completeTest(t.id)} className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100">Complete</button>
                    <button onClick={() => cancelTest(t.id)} className="px-2 py-1 text-xs bg-gray-50 text-gray-600 rounded hover:bg-gray-100">Cancel</button>
                  </div>
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

      {/* New Load Test Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowModal(false)} />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">New Load Test</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Test Name *</label>
                <input value={form.testName} onChange={e => setForm(f => ({ ...f, testName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="e.g. API Stress Test v1" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Environment *</label>
                <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm">
                  <option value="staging">Staging</option>
                  <option value="production">Production</option>
                  <option value="development">Development</option>
                  <option value="testing">Testing</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Target URL</label>
                <input value={form.targetUrl} onChange={e => setForm(f => ({ ...f, targetUrl: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="https://api.example.com" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm" rows={3} />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={createTest} disabled={saving || !form.testName} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Test'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function TestRunsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [suites, setSuites] = useState<any[]>([]);
  const [form, setForm] = useState({ suiteId: '', environment: 'STAGING', notes: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/qa/test-runs?pageSize=50').then(r => r.json()).then(d => {
      setItems(unwrapList(d));
      setTotal(unwrapTotal(d));
      setLoading(false);
    });
  };
  useEffect(() => {
    load();
    fetch('/api/backend/qa/test-suites?pageSize=100').then(r => r.json()).then(d => setSuites(unwrapList(d)));
  }, []);

  const create = async () => {
    await fetch('/api/backend/qa/test-runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowModal(false);
    load();
  };

  const action = async (id: string, endpoint: string) => {
    await fetch(`/api/backend/qa/test-runs/${id}/${endpoint}`, { method: 'PATCH' });
    load();
  };

  const statusColor: Record<string, string> = { PASSED: 'bg-green-100 text-green-800', FAILED: 'bg-red-100 text-red-800', BLOCKED: 'bg-orange-100 text-orange-800', IN_PROGRESS: 'bg-yellow-100 text-yellow-800', DRAFT: 'bg-gray-100 text-gray-600', CANCELLED: 'bg-gray-100 text-gray-400' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Test Runs" subtitle="Execute and track QA test runs" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Test Runs ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ Start New Run</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Run #', 'Suite', 'Environment', 'Status', 'Passed', 'Failed', 'Blocked', 'Executed By', 'Date', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((r: any) => (
                  <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{r.runCode}</td>
                    <td className="px-4 py-3">{r.qATestSuite?.name || r.testSuite?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.environment || '—'}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[r.status] || 'bg-gray-100'}`}>{r.status}</span></td>
                    <td className="px-4 py-3 text-green-600 font-medium">{r.passedCount ?? 0}</td>
                    <td className="px-4 py-3 text-red-600 font-medium">{r.failedCount ?? 0}</td>
                    <td className="px-4 py-3 text-orange-600 font-medium">{r.blockedCount ?? 0}</td>
                    <td className="px-4 py-3 text-gray-500">{r.executedBy?.name || r.executedBy?.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {r.status === 'DRAFT' && <button onClick={() => action(r.id, 'start')} className="text-xs text-blue-600 hover:underline mr-2">Start</button>}
                      {r.status === 'IN_PROGRESS' && <button onClick={() => action(r.id, 'complete')} className="text-xs text-green-600 hover:underline">Complete</button>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={10} className="px-4 py-8 text-center text-gray-500">No test runs yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Start New Test Run</h3>
              <select value={form.suiteId} onChange={e => setForm(f => ({ ...f, suiteId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option value="">-- Select Test Suite --</option>
                {suites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['DEVELOPMENT', 'STAGING', 'PRODUCTION', 'TRAINING'].map(e => <option key={e}>{e}</option>)}
              </select>
              <textarea placeholder="Notes (optional)" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={create} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Create Run</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}
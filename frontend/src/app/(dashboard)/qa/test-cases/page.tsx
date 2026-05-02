'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function TestCasesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [suites, setSuites] = useState<any[]>([]);
  const [form, setForm] = useState({ title: '', suiteId: '', caseType: 'FUNCTIONAL', priority: 'NORMAL', expectedResult: '', testSteps: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/qa/test-cases?pageSize=50')
      .then(r => r.json()).then(d => { setItems(unwrapList(d)); setTotal(unwrapTotal(d)); setLoading(false); });
  };
  useEffect(() => {
    load();
    fetch('/api/backend/qa/test-suites?pageSize=100').then(r => r.json()).then(d => setSuites(unwrapList(d)));
  }, []);

  const create = async () => {
    await fetch('/api/backend/qa/test-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, testSteps: form.testSteps ? form.testSteps.split('\n').filter(Boolean).map((s, i) => ({ step: i + 1, action: s })) : [] }) });
    setShowModal(false);
    load();
  };

  const priorityColor: Record<string, string> = { CRITICAL: 'bg-red-100 text-red-800', HIGH: 'bg-orange-100 text-orange-800', NORMAL: 'bg-blue-100 text-blue-800', LOW: 'bg-gray-100 text-gray-600' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Test Cases" subtitle="Individual test case definitions for QA execution" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Test Cases ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Test Case</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Title', 'Suite', 'Type', 'Priority', 'Status'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{c.caseCode}</td>
                    <td className="px-4 py-3 font-medium">{c.title}</td>
                    <td className="px-4 py-3 text-gray-500">{c.qATestSuite?.name || c.suite?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{c.caseType}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${priorityColor[c.priority] || 'bg-gray-100'}`}>{c.priority}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${c.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{c.status}</span></td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No test cases yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">New Test Case</h3>
              <input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.suiteId} onChange={e => setForm(f => ({ ...f, suiteId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option value="">-- Select Suite --</option>
                {suites.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={form.caseType} onChange={e => setForm(f => ({ ...f, caseType: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['FUNCTIONAL', 'SECURITY', 'PERFORMANCE', 'UI_UX', 'DATA_INTEGRITY', 'INTEGRATION', 'REGRESSION', 'SMOKE'].map(t => <option key={t}>{t}</option>)}
              </select>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map(p => <option key={p}>{p}</option>)}
              </select>
              <input placeholder="Expected Result" value={form.expectedResult} onChange={e => setForm(f => ({ ...f, expectedResult: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Test steps (one per line)" rows={4} value={form.testSteps} onChange={e => setForm(f => ({ ...f, testSteps: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={create} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Create</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}
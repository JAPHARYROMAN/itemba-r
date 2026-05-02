'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function TestSuitesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', suiteType: 'MANUAL', moduleName: '', priority: 'NORMAL', description: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/qa/test-suites?pageSize=50')
      .then(r => r.json()).then(d => {
        setItems(unwrapList(d));
        setTotal(unwrapTotal(d));
        setLoading(false);
      });
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    await fetch('/api/backend/qa/test-suites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowModal(false);
    setForm({ name: '', suiteType: 'MANUAL', moduleName: '', priority: 'NORMAL', description: '' });
    load();
  };

  const activate = async (id: string) => {
    await fetch(`/api/backend/qa/test-suites/${id}/activate`, { method: 'PATCH' });
    load();
  };

  const priorityColor: Record<string, string> = { CRITICAL: 'bg-red-100 text-red-800', HIGH: 'bg-orange-100 text-orange-800', NORMAL: 'bg-blue-100 text-blue-800', LOW: 'bg-gray-100 text-gray-600' };
  const statusColor: Record<string, string> = { ACTIVE: 'bg-green-100 text-green-800', DRAFT: 'bg-gray-100 text-gray-600', ARCHIVED: 'bg-gray-100 text-gray-400' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Test Suites" subtitle="QA test suites organized by module" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Test Suites ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Suite</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Name', 'Type', 'Module', 'Priority', 'Status', 'Test Cases', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((s: any) => (
                  <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{s.suiteCode}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{s.name}</td>
                    <td className="px-4 py-3 text-gray-500">{s.suiteType}</td>
                    <td className="px-4 py-3 text-gray-500">{s.moduleName || '—'}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${priorityColor[s.priority] || 'bg-gray-100 text-gray-600'}`}>{s.priority}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[s.status] || 'bg-gray-100 text-gray-600'}`}>{s.status}</span></td>
                    <td className="px-4 py-3 text-gray-600">{s.testCasesCount ?? s._count?.testCases ?? 0}</td>
                    <td className="px-4 py-3">
                      {s.status === 'DRAFT' && (
                        <button onClick={() => activate(s.id)} className="text-xs text-blue-600 hover:underline">Activate</button>
                      )}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No test suites yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">New Test Suite</h3>
              <input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Module Name" value={form.moduleName} onChange={e => setForm(f => ({ ...f, moduleName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.suiteType} onChange={e => setForm(f => ({ ...f, suiteType: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['MANUAL', 'AUTOMATED', 'HYBRID', 'REGRESSION', 'SMOKE', 'PERFORMANCE', 'SECURITY', 'UAT'].map(t => <option key={t}>{t}</option>)}
              </select>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['LOW', 'NORMAL', 'HIGH', 'CRITICAL'].map(p => <option key={p}>{p}</option>)}
              </select>
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
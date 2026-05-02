'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function LaunchBlockersPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', severity: 'HIGH', category: 'FUNCTIONAL', moduleName: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/launch/blockers?pageSize=50').then(r => r.json()).then(d => {
      setItems(unwrapList(d));
      setTotal(unwrapTotal(d));
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    await fetch('/api/backend/launch/blockers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowModal(false);
    setForm({ title: '', description: '', severity: 'HIGH', category: 'FUNCTIONAL', moduleName: '' });
    load();
  };

  const action = async (id: string, endpoint: string) => {
    await fetch(`/api/backend/launch/blockers/${id}/${endpoint}`, { method: 'PATCH' });
    load();
  };

  const severityColor: Record<string, string> = { CRITICAL: 'bg-red-100 text-red-800', HIGH: 'bg-orange-100 text-orange-800', MEDIUM: 'bg-yellow-100 text-yellow-800', LOW: 'bg-gray-100 text-gray-600' };
  const statusColor: Record<string, string> = { OPEN: 'bg-blue-100 text-blue-800', IN_PROGRESS: 'bg-yellow-100 text-yellow-800', RESOLVED: 'bg-green-100 text-green-800', WAIVED: 'bg-purple-100 text-purple-800', DEFERRED: 'bg-gray-100 text-gray-600' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Launch Blockers" subtitle="Issues that must be resolved before go-live" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Blockers ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700">+ Add Blocker</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Title', 'Module', 'Severity', 'Status', 'Category', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((b: any) => (
                  <tr key={b.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{b.blockerCode}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-xs truncate">{b.title}</td>
                    <td className="px-4 py-3 text-gray-500">{b.moduleName || '—'}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${severityColor[b.severity] || 'bg-gray-100'}`}>{b.severity}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[b.status] || 'bg-gray-100'}`}>{b.status}</span></td>
                    <td className="px-4 py-3 text-gray-500">{b.category}</td>
                    <td className="px-4 py-3">
                      {b.status === 'OPEN' && <button onClick={() => action(b.id, 'start')} className="text-xs text-yellow-600 hover:underline mr-2">Start</button>}
                      {b.status === 'IN_PROGRESS' && <button onClick={() => action(b.id, 'resolve')} className="text-xs text-green-600 hover:underline mr-2">Resolve</button>}
                      {['OPEN', 'IN_PROGRESS'].includes(b.status) && <button onClick={() => action(b.id, 'waive')} className="text-xs text-purple-600 hover:underline">Waive</button>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No launch blockers. System is clear for launch review.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add Launch Blocker</h3>
              <input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Description" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Module Name (optional)" value={form.moduleName} onChange={e => setForm(f => ({ ...f, moduleName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.severity} onChange={e => setForm(f => ({ ...f, severity: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(s => <option key={s}>{s}</option>)}
              </select>
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['FUNCTIONAL', 'SECURITY', 'PERFORMANCE', 'DATA', 'COMPLIANCE', 'UI_UX', 'INTEGRATION', 'DEPLOYMENT', 'DOCUMENTATION', 'TRAINING'].map(c => <option key={c}>{c}</option>)}
              </select>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={create} className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg">Add Blocker</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}
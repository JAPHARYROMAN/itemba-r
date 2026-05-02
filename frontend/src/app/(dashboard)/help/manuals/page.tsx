'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function ManualsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', roleName: '', manualType: 'USER_GUIDE', moduleName: '', summary: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/documentation/manuals?pageSize=50').then(r => r.json()).then(d => {
      setItems(unwrapList(d));
      setTotal(unwrapTotal(d));
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    await fetch('/api/backend/documentation/manuals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowModal(false);
    setForm({ title: '', roleName: '', manualType: 'USER_GUIDE', moduleName: '', summary: '' });
    load();
  };

  const publish = async (id: string) => {
    await fetch(`/api/backend/documentation/manuals/${id}/publish`, { method: 'PATCH' });
    load();
  };

  return (
    <AuroraPage>
      <AuroraPageHeader title="User Manuals" subtitle="Complete role-based system guides" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Manuals ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Manual</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Title', 'Type', 'Role', 'Module', 'Version', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((m: any) => (
                  <tr key={m.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{m.manualCode}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{m.title}</td>
                    <td className="px-4 py-3 text-gray-500">{m.manualType}</td>
                    <td className="px-4 py-3 text-gray-500">{m.roleName || 'All'}</td>
                    <td className="px-4 py-3 text-gray-500">{m.moduleName || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">v{m.version || '1.0'}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${m.status === 'PUBLISHED' ? 'bg-green-100 text-green-800' : m.status === 'DRAFT' ? 'bg-gray-100 text-gray-600' : 'bg-yellow-100 text-yellow-800'}`}>{m.status}</span></td>
                    <td className="px-4 py-3">
                      {m.status === 'DRAFT' && <button onClick={() => publish(m.id)} className="text-xs text-blue-600 hover:underline">Publish</button>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No manuals yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">New User Manual</h3>
              <input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Role Name (e.g. Finance Controller)" value={form.roleName} onChange={e => setForm(f => ({ ...f, roleName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Module Name (e.g. Finance)" value={form.moduleName} onChange={e => setForm(f => ({ ...f, moduleName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Summary" rows={2} value={form.summary} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.manualType} onChange={e => setForm(f => ({ ...f, manualType: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['USER_GUIDE', 'ADMIN_GUIDE', 'OPERATIONS_GUIDE', 'TECHNICAL_GUIDE', 'QUICK_REFERENCE', 'TRAINING_MATERIAL'].map(t => <option key={t}>{t}</option>)}
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
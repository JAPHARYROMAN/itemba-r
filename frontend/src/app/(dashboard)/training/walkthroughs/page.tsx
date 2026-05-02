'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList } from '@/lib/unwrap';

export default function WalkthroughsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', routePath: '', moduleName: '', roleName: '', description: '', steps: '[]' });

  const load = () => {
    fetch('/api/backend/training/walkthroughs')
      .then(r => r.json()).then(d => { setItems(unwrapList(d)); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    let steps: any;
    try { steps = JSON.parse(form.steps); } catch { steps = []; }
    await fetch('/api/backend/training/walkthroughs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, steps }),
    });
    setShowModal(false); load();
  };

  const toggle = async (id: string, status: string) => {
    const endpoint = status === 'ACTIVE' ? 'deactivate' : 'activate';
    await fetch(`/api/backend/training/walkthroughs/${id}/${endpoint}`, { method: 'PATCH' });
    load();
  };

  if (loading) return <AuroraPage><div className="p-8 text-gray-500">Loading...</div></AuroraPage>;

  return (
    <AuroraPage>
      <AuroraPageHeader title="Guided Walkthroughs" subtitle="In-app step-by-step guidance for users" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">Walkthroughs ({items.length})</h2>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Walkthrough</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700"><tr>
              {['Code','Title','Route','Module','Role','Status','Steps','Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {items.map((w: any) => (
                <tr key={w.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3 font-mono text-xs">{w.walkthroughCode}</td>
                  <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{w.title}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{w.routePath || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{w.moduleName || '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{w.roleName || 'All'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-xs rounded-full ${w.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{w.status}</span></td>
                  <td className="px-4 py-3">{Array.isArray(w.steps) ? w.steps.length : '—'}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggle(w.id, w.status)} className="text-xs text-blue-600 hover:underline">
                      {w.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No walkthroughs yet.</td></tr>}
            </tbody>
          </table>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">New Walkthrough</h3>
              {(['title', 'routePath', 'moduleName', 'roleName', 'description'] as const).map((key) => (
                <input key={key} placeholder={key === 'routePath' ? 'Route Path (e.g. /finance)' : key.charAt(0).toUpperCase() + key.slice(1)} value={form[key]} onChange={e => setForm(f => ({...f, [key]: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              ))}
              <textarea placeholder='Steps JSON (e.g. [{"step":1,"title":"...","content":"..."}])' rows={4} value={form.steps} onChange={e => setForm(f => ({...f, steps: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={save} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}


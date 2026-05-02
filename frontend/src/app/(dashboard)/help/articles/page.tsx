'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';

export default function HelpArticlesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', articleCategory: 'GENERAL', moduleName: '', content: '', tags: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/help/articles?pageSize=50').then(r => r.json()).then(d => {
      const inner = d?.data ?? d;
      const rows = Array.isArray(inner)
        ? inner
        : Array.isArray(inner?.data)
          ? inner.data
          : Array.isArray(inner?.items)
            ? inner.items
            : [];
      const totalCount =
        typeof inner?.total === 'number' ? inner.total : typeof d?.total === 'number' ? d.total : rows.length;
      setItems(rows);
      setTotal(totalCount);
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    await fetch('/api/backend/help/articles', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [] }) });
    setShowModal(false);
    setForm({ title: '', articleCategory: 'GENERAL', moduleName: '', content: '', tags: '' });
    load();
  };

  const publish = async (id: string) => {
    await fetch(`/api/backend/help/articles/${id}/publish`, { method: 'PATCH' });
    load();
  };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Help Articles" subtitle="Quick-access help content for users" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Articles ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Article</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Title', 'Category', 'Module', 'Views', 'Helpful', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((a: any) => (
                  <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{a.articleCode}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white max-w-xs truncate">{a.title}</td>
                    <td className="px-4 py-3 text-gray-500">{a.articleCategory}</td>
                    <td className="px-4 py-3 text-gray-500">{a.moduleName || '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{a.viewCount ?? 0}</td>
                    <td className="px-4 py-3 text-green-600">{a.helpfulCount ?? 0}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${a.status === 'PUBLISHED' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{a.status}</span></td>
                    <td className="px-4 py-3">
                      {a.status === 'DRAFT' && <button onClick={() => publish(a.id)} className="text-xs text-blue-600 hover:underline">Publish</button>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No articles yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">New Help Article</h3>
              <input placeholder="Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.articleCategory} onChange={e => setForm(f => ({ ...f, articleCategory: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['GETTING_STARTED', 'FINANCE', 'PETROLEUM', 'SALES', 'HR', 'SECURITY', 'TRAINING', 'COMPLIANCE', 'GENERAL', 'FAQ'].map(c => <option key={c}>{c}</option>)}
              </select>
              <input placeholder="Module Name (optional)" value={form.moduleName} onChange={e => setForm(f => ({ ...f, moduleName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Article content (markdown supported)" rows={5} value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Tags (comma-separated)" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
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
'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function ReadinessItemsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [assessments, setAssessments] = useState<any[]>([]);
  const [form, setForm] = useState({ assessmentId: '', category: 'SECURITY', itemName: '', description: '', required: true });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/launch/readiness-items?pageSize=50').then(r => r.json()).then(d => {
      setItems(unwrapList(d));
      setTotal(unwrapTotal(d));
      setLoading(false);
    });
  };
  useEffect(() => {
    load();
    fetch('/api/backend/launch/assessments?pageSize=100').then(r => r.json()).then(d => setAssessments(unwrapList(d)));
  }, []);

  const create = async () => {
    await fetch('/api/backend/launch/readiness-items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowModal(false);
    load();
  };

  const action = async (id: string, endpoint: string) => {
    await fetch(`/api/backend/launch/readiness-items/${id}/${endpoint}`, { method: 'PATCH' });
    load();
  };

  const statusColor: Record<string, string> = { PASSED: 'bg-green-100 text-green-800', FAILED: 'bg-red-100 text-red-800', WAIVED: 'bg-purple-100 text-purple-800', PENDING: 'bg-gray-100 text-gray-600', IN_REVIEW: 'bg-yellow-100 text-yellow-800' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Readiness Items" subtitle="Individual launch readiness checklist items" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Readiness Items ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ Add Item</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Item', 'Category', 'Required', 'Status', 'Score', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((item: any) => (
                  <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{item.itemCode}</td>
                    <td className="px-4 py-3 font-medium">{item.itemName}</td>
                    <td className="px-4 py-3 text-gray-500">{item.category}</td>
                    <td className="px-4 py-3">{item.required ? <span className="px-2 py-0.5 text-xs bg-red-100 text-red-700 rounded-full">Required</span> : <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">Optional</span>}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[item.status] || 'bg-gray-100'}`}>{item.status}</span></td>
                    <td className="px-4 py-3 text-gray-600">{item.score ?? '—'}</td>
                    <td className="px-4 py-3">
                      {item.status === 'PENDING' && <button onClick={() => action(item.id, 'mark-passed')} className="text-xs text-green-600 hover:underline mr-2">Pass</button>}
                      {item.status === 'PENDING' && <button onClick={() => action(item.id, 'mark-failed')} className="text-xs text-red-600 hover:underline mr-2">Fail</button>}
                      {item.status !== 'WAIVED' && item.status !== 'PASSED' && <button onClick={() => action(item.id, 'waive')} className="text-xs text-purple-600 hover:underline">Waive</button>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No readiness items yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add Readiness Item</h3>
              <select value={form.assessmentId} onChange={e => setForm(f => ({ ...f, assessmentId: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                <option value="">-- Select Assessment --</option>
                {assessments.map((a: any) => <option key={a.id} value={a.id}>{a.assessmentCode} — {a.environment}</option>)}
              </select>
              <input placeholder="Item Name" value={form.itemName} onChange={e => setForm(f => ({ ...f, itemName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['SECURITY', 'BACKUP', 'ACCOUNTING', 'DATA_QUALITY', 'PERFORMANCE', 'UI_UX', 'DOCUMENTATION', 'TRAINING', 'INTEGRATIONS', 'COMPLIANCE', 'USER_ACCESS', 'REPORTING', 'DEPLOYMENT', 'SUPPORT'].map(c => <option key={c}>{c}</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={form.required} onChange={e => setForm(f => ({ ...f, required: e.target.checked }))} className="rounded" />
                Required (blocking if failed)
              </label>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={create} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg">Add Item</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}
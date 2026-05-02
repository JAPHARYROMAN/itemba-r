'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function LaunchAssessmentsPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ environment: 'STAGING', assessmentDate: new Date().toISOString().slice(0, 10), notes: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/launch/assessments?pageSize=20').then(r => r.json()).then(d => {
      setItems(unwrapList(d));
      setTotal(unwrapTotal(d));
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    await fetch('/api/backend/launch/assessments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowModal(false);
    load();
  };

  const action = async (id: string, endpoint: string) => {
    await fetch(`/api/backend/launch/assessments/${id}/${endpoint}`, { method: 'PATCH' });
    load();
  };

  const statusColor: Record<string, string> = { READY: 'bg-green-100 text-green-800', NOT_READY: 'bg-red-100 text-red-800', READY_WITH_RISKS: 'bg-yellow-100 text-yellow-800', IN_PROGRESS: 'bg-blue-100 text-blue-800', DRAFT: 'bg-gray-100 text-gray-600' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Launch Assessments" subtitle="Launch readiness assessments for go-live approval" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Assessments ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Assessment</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Environment', 'Overall Status', 'Score', 'Approved By', 'Date', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((a: any) => (
                  <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{a.assessmentCode}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 text-xs bg-purple-100 text-purple-800 rounded-full">{a.environment}</span></td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[a.overallStatus] || 'bg-gray-100'}`}>{a.overallStatus}</span></td>
                    <td className="px-4 py-3 font-medium">{a.overallScore ?? '—'} / 100</td>
                    <td className="px-4 py-3 text-gray-500">{a.approvedBy?.name || a.approvedBy?.email || '—'}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{new Date(a.assessmentDate || a.createdAt).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      {a.overallStatus === 'IN_PROGRESS' && <button onClick={() => action(a.id, 'calculate')} className="text-xs text-blue-600 hover:underline mr-2">Calculate</button>}
                      {['IN_PROGRESS', 'READY_WITH_RISKS', 'READY'].includes(a.overallStatus) && <button onClick={() => action(a.id, 'approve')} className="text-xs text-green-600 hover:underline">Approve</button>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No assessments yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">New Launch Assessment</h3>
              <select value={form.environment} onChange={e => setForm(f => ({ ...f, environment: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['DEVELOPMENT', 'STAGING', 'PRODUCTION'].map(e => <option key={e}>{e}</option>)}
              </select>
              <input type="date" value={form.assessmentDate} onChange={e => setForm(f => ({ ...f, assessmentDate: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Notes (optional)" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
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
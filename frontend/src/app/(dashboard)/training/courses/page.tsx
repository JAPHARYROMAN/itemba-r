'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import Link from 'next/link';
import { unwrapList, unwrapTotal } from '@/lib/unwrap';

export default function CoursesPage() {
  const [items, setItems] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', roleName: '', difficulty: 'BEGINNER', estimatedMinutes: 30, description: '' });

  const load = () => {
    setLoading(true);
    fetch('/api/backend/training/courses?pageSize=50').then(r => r.json()).then(d => {
      setItems(unwrapList(d));
      setTotal(unwrapTotal(d));
      setLoading(false);
    });
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    await fetch('/api/backend/training/courses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
    setShowModal(false);
    setForm({ title: '', roleName: '', difficulty: 'BEGINNER', estimatedMinutes: 30, description: '' });
    load();
  };

  const publish = async (id: string) => {
    await fetch(`/api/backend/training/courses/${id}/publish`, { method: 'PATCH' });
    load();
  };

  const difficultyColor: Record<string, string> = { BEGINNER: 'bg-green-100 text-green-800', INTERMEDIATE: 'bg-yellow-100 text-yellow-800', ADVANCED: 'bg-orange-100 text-orange-800' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Training Courses" subtitle="Role-based courses to onboard and upskill staff" />
      <div className="p-6">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <span className="font-semibold text-gray-900 dark:text-white">Courses ({total})</span>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ New Course</button>
          </div>
          {loading ? <div className="p-8 text-center text-gray-500">Loading...</div> : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700">
                <tr>{['Code', 'Title', 'Role', 'Difficulty', 'Duration', 'Lessons', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {items.map((c: any) => (
                  <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-4 py-3 font-mono text-xs">{c.courseCode}</td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white"><Link href={`/training/courses/${c.id}`} className="hover:text-blue-600">{c.title}</Link></td>
                    <td className="px-4 py-3 text-gray-500">{c.roleName || 'All'}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${difficultyColor[c.difficulty] || 'bg-gray-100'}`}>{c.difficulty}</span></td>
                    <td className="px-4 py-3 text-gray-600">{c.estimatedMinutes} min</td>
                    <td className="px-4 py-3 text-gray-600">{c.lessonsCount ?? c._count?.lessons ?? 0}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${c.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{c.status}</span></td>
                    <td className="px-4 py-3">
                      <Link href={`/training/courses/${c.id}`} className="text-xs text-blue-600 hover:underline mr-2">Manage</Link>
                      {c.status === 'DRAFT' && <button onClick={() => publish(c.id)} className="text-xs text-green-600 hover:underline">Publish</button>}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-500">No courses yet.</td></tr>}
              </tbody>
            </table>
          )}
        </div>
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-md space-y-3">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">New Training Course</h3>
              <input placeholder="Course Title" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <input placeholder="Role Name (e.g. Finance Controller)" value={form.roleName} onChange={e => setForm(f => ({ ...f, roleName: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Description" rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.difficulty} onChange={e => setForm(f => ({ ...f, difficulty: e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['BEGINNER', 'INTERMEDIATE', 'ADVANCED'].map(d => <option key={d}>{d}</option>)}
              </select>
              <input type="number" placeholder="Estimated Minutes" value={form.estimatedMinutes} onChange={e => setForm(f => ({ ...f, estimatedMinutes: +e.target.value }))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
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
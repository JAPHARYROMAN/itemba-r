'use client';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList, unwrapOne } from '@/lib/unwrap';

export default function CourseDetailPage() {
  const params = useParams();
  const [course, setCourse] = useState<any>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ title: '', lessonType: 'TEXT', lessonOrder: 1, content: '', description: '' });

  useEffect(() => {
    fetch(`/api/backend/training/courses/${params.id}`)
      .then(r => r.json()).then(d => { setCourse(unwrapOne(d)); setLoading(false); });
    fetch(`/api/backend/training/courses/${params.id}/lessons`)
      .then(r => r.json()).then(d => setLessons(unwrapList(d)));
  }, [params.id]);

  const addLesson = async () => {
    await fetch(`/api/backend/training/courses/${params.id}/lessons`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
    });
    setShowModal(false);
    fetch(`/api/backend/training/courses/${params.id}/lessons`).then(r => r.json()).then(d => setLessons(unwrapList(d)));
  };

  const toggleLesson = async (id: string, status: string) => {
    const endpoint = status === 'ACTIVE' ? 'deactivate' : 'activate';
    await fetch(`/api/backend/training/lessons/${id}/${endpoint}`, { method: 'PATCH' });
    fetch(`/api/backend/training/courses/${params.id}/lessons`).then(r => r.json()).then(d => setLessons(unwrapList(d)));
  };

  if (loading) return <AuroraPage><div className="p-8 text-gray-500">Loading...</div></AuroraPage>;

  return (
    <AuroraPage>
      <AuroraPageHeader title={course?.title || 'Course Detail'} subtitle={`Role: ${course?.roleName || 'All'} | Difficulty: ${course?.difficulty} | ~${course?.estimatedMinutes} min`} />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-blue-600">{lessons.length}</div>
            <div className="text-sm text-gray-500">Total Lessons</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-green-600">{lessons.filter(l => l.status === 'ACTIVE').length}</div>
            <div className="text-sm text-gray-500">Active Lessons</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <div className="text-2xl font-bold text-gray-600">{course?.status}</div>
            <div className="text-sm text-gray-500">Course Status</div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="font-semibold text-gray-900 dark:text-white">Lessons</h2>
            <button onClick={() => setShowModal(true)} className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">+ Add Lesson</button>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700"><tr>
              {['#', 'Code', 'Title', 'Type', 'Status', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {lessons.map((l: any) => (
                <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-3">{l.lessonOrder}</td>
                  <td className="px-4 py-3 font-mono text-xs">{l.lessonCode}</td>
                  <td className="px-4 py-3 font-medium">{l.title}</td>
                  <td className="px-4 py-3"><span className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded-full">{l.lessonType}</span></td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 text-xs rounded-full ${l.status === 'ACTIVE' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>{l.status}</span></td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggleLesson(l.id, l.status)} className="text-xs text-blue-600 hover:underline">
                      {l.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </button>
                  </td>
                </tr>
              ))}
              {lessons.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No lessons yet. Click Add Lesson to start.</td></tr>}
            </tbody>
          </table>
        </div>

        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 w-full max-w-lg space-y-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Add Lesson</h3>
              <input placeholder="Title" value={form.title} onChange={e => setForm(f => ({...f, title: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <select value={form.lessonType} onChange={e => setForm(f => ({...f, lessonType: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white">
                {['TEXT','VIDEO_PLACEHOLDER','WALKTHROUGH','CHECKLIST','QUIZ','TASK_PRACTICE'].map(t => <option key={t}>{t}</option>)}
              </select>
              <input type="number" placeholder="Order" value={form.lessonOrder} onChange={e => setForm(f => ({...f, lessonOrder: +e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <textarea placeholder="Content (markdown supported)" rows={4} value={form.content} onChange={e => setForm(f => ({...f, content: e.target.value}))} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm dark:bg-gray-700 dark:border-gray-600 dark:text-white" />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-lg">Cancel</button>
                <button onClick={addLesson} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">Add Lesson</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AuroraPage>
  );
}



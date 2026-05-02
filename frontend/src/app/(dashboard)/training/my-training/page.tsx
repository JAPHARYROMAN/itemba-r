'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import { unwrapList } from '@/lib/unwrap';

export default function MyTrainingPage() {
  const [enrollments, setEnrollments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch('/api/backend/training/enrollments/me')
      .then(r => r.json()).then(d => { setEnrollments(unwrapList(d)); setLoading(false); });
  };
  useEffect(() => { load(); }, []);

  const startEnrollment = async (id: string) => {
    await fetch(`/api/backend/training/enrollments/${id}/start`, { method: 'PATCH' });
    load();
  };

  const statusColor = (s: string) => ({ ASSIGNED: 'bg-blue-100 text-blue-800', IN_PROGRESS: 'bg-yellow-100 text-yellow-800', COMPLETED: 'bg-green-100 text-green-800', CANCELLED: 'bg-gray-100 text-gray-600' } as Record<string,string>)[s] || 'bg-gray-100 text-gray-600';

  if (loading) return <AuroraPage><div className="p-8 text-gray-500">Loading...</div></AuroraPage>;

  return (
    <AuroraPage>
      <AuroraPageHeader title="My Training" subtitle="Your assigned training courses and progress" />
      <div className="p-6 space-y-4">
        {enrollments.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-12 text-center">
            <div className="text-4xl mb-3">🎓</div>
            <p className="text-gray-500">No training courses assigned yet.</p>
            <p className="text-sm text-gray-400 mt-1">Contact your manager or IT admin to enroll in courses.</p>
          </div>
        )}
        {enrollments.map((e: any) => (
          <div key={e.id} className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-5">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">{e.trainingCourse?.title}</h3>
                <p className="text-sm text-gray-500 mt-0.5">{e.trainingCourse?.roleName} · {e.trainingCourse?.difficulty} · ~{e.trainingCourse?.estimatedMinutes} min</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`px-2 py-1 text-xs rounded-full ${statusColor(e.status)}`}>{e.status}</span>
                {e.status === 'ASSIGNED' && (
                  <button onClick={() => startEnrollment(e.id)} className="px-3 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-700">Start</button>
                )}
              </div>
            </div>
            <div className="mt-4">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>Progress</span>
                <span>{Number(e.progressPercent).toFixed(0)}%</span>
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                <div className="bg-blue-600 h-2 rounded-full transition-all" style={{ width: `${Number(e.progressPercent)}%` }} />
              </div>
            </div>
            {e.lessonProgresses && e.lessonProgresses.length > 0 && (
              <div className="mt-3 space-y-1">
                {e.lessonProgresses.map((lp: any) => (
                  <div key={lp.id} className="flex items-center justify-between text-xs">
                    <span className="text-gray-600 dark:text-gray-400">{lp.trainingLesson?.title}</span>
                    <span className={`px-2 py-0.5 rounded-full ${lp.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : lp.status === 'IN_PROGRESS' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>{lp.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </AuroraPage>
  );
}


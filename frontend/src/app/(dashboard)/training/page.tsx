'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import Link from 'next/link';

export default function TrainingDashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/training/dashboard/summary')
      .then((r) => r.json())
      .then((d) => {
        setSummary(d?.data ?? d);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const cards = summary
    ? [
        { label: 'Total Courses', value: summary.totalCourses ?? 0, color: 'text-blue-600' },
        { label: 'Active Courses', value: summary.activeCourses ?? 0, color: 'text-green-600' },
        { label: 'Enrollments', value: summary.totalEnrollments ?? 0, color: 'text-indigo-600' },
        { label: 'Completions', value: summary.completedEnrollments ?? 0, color: 'text-teal-600' },
        {
          label: 'Completion Rate',
          value: `${summary.completionRate ?? 0}%`,
          color: 'text-purple-600',
        },
        {
          label: 'Active Environments',
          value: summary.activeTrainingEnvironments ?? 0,
          color: 'text-orange-600',
        },
      ]
    : [];

  return (
    <AuroraPage>
      <AuroraPageHeader
        title="Training Dashboard"
        subtitle="Staff training courses, walkthroughs, and learning progress"
      />
      <div className="p-6 space-y-6">
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {cards.map((c) => (
                <div
                  key={c.label}
                  className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
                >
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                  <div className="text-xs text-gray-500 mt-1">{c.label}</div>
                </div>
              ))}
            </div>
            {summary && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {summary.courseReadiness?.coursesNeedingLessons?.length ?? 0}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Courses Needing Lessons</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {summary.averageProgressPercent ?? 0}%
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Average Learner Progress</div>
                </div>
                <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className="text-2xl font-bold text-gray-900 dark:text-white">
                    {summary.activeWalkthroughs ?? 0}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">Active Walkthroughs</div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                {
                  href: '/training/courses',
                  icon: '📚',
                  label: 'All Courses',
                  desc: 'Browse and manage training courses',
                },
                {
                  href: '/training/my-training',
                  icon: '🎓',
                  label: 'My Training',
                  desc: 'Your enrolled courses and progress',
                },
                {
                  href: '/training/walkthroughs',
                  icon: '🗺️',
                  label: 'Walkthroughs',
                  desc: 'Step-by-step in-app guides',
                },
                {
                  href: '/training/environment',
                  icon: '🧪',
                  label: 'Training Environment',
                  desc: 'Demo and sandbox configuration',
                },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="block bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors"
                >
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{item.label}</h3>
                  <p className="text-sm text-gray-500 mt-1">{item.desc}</p>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </AuroraPage>
  );
}

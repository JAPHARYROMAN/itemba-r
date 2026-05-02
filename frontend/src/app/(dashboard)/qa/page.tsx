'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import Link from 'next/link';

export default function QADashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [recentRuns, setRecentRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/backend/qa/summary').then(r => r.json()),
      fetch('/api/backend/qa/test-runs?page=1&pageSize=5').then(r => r.json()),
    ]).then(([sum, runs]) => {
      setSummary(sum?.data ?? sum);
      const runsData = runs?.data ?? runs;
      setRecentRuns(Array.isArray(runsData) ? runsData : Array.isArray(runsData?.data) ? runsData.data : []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const statusColor: Record<string, string> = {
    PASSED: 'bg-green-100 text-green-800',
    FAILED: 'bg-red-100 text-red-800',
    BLOCKED: 'bg-orange-100 text-orange-800',
    IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
    DRAFT: 'bg-gray-100 text-gray-600',
    CANCELLED: 'bg-gray-100 text-gray-400',
  };

  const cards = summary ? [
    { label: 'Test Suites', value: summary.totalSuites ?? 0, color: 'text-blue-600' },
    { label: 'Test Cases', value: summary.totalCases ?? 0, color: 'text-indigo-600' },
    { label: 'Runs This Month', value: summary.runsThisMonth ?? 0, color: 'text-purple-600' },
    { label: 'Pass Rate', value: summary.passRate ? `${summary.passRate}%` : '—', color: 'text-green-600' },
    { label: 'Open Blockers', value: summary.openBlockers ?? 0, color: 'text-red-600' },
    { label: 'Active Suites', value: summary.activeSuites ?? 0, color: 'text-teal-600' },
  ] : [];

  return (
    <AuroraPage>
      <AuroraPageHeader title="QA Dashboard" subtitle="Quality assurance test management and launch readiness" />
      <div className="p-6 space-y-6">
        {loading ? (
          <div className="text-gray-500">Loading...</div>
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              {cards.map(c => (
                <div key={c.label} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                  <div className="text-xs text-gray-500 mt-1">{c.label}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { href: '/qa/test-suites', icon: '📋', label: 'Test Suites', desc: 'Manage QA test suites by module' },
                { href: '/qa/test-cases', icon: '✅', label: 'Test Cases', desc: 'Individual test case definitions' },
                { href: '/qa/test-runs', icon: '▶️', label: 'Test Runs', desc: 'Execute and track test runs' },
                { href: '/qa/test-results', icon: '📊', label: 'Test Results', desc: 'Review pass/fail results and blockers' },
              ].map(item => (
                <Link key={item.href} href={item.href} className="block bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors">
                  <div className="text-2xl mb-2">{item.icon}</div>
                  <h3 className="font-semibold text-gray-900 dark:text-white">{item.label}</h3>
                  <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
                </Link>
              ))}
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
                <h2 className="font-semibold text-gray-900 dark:text-white">Recent Test Runs</h2>
                <Link href="/qa/test-runs" className="text-sm text-blue-600 hover:underline">View All</Link>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-700">
                  <tr>{['Run #', 'Suite', 'Executed By', 'Status', 'Passed', 'Failed', 'Date'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  {recentRuns.map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                      <td className="px-4 py-3 font-mono text-xs">{r.runCode}</td>
                      <td className="px-4 py-3">{r.qATestSuite?.name || r.testSuite?.name || '—'}</td>
                      <td className="px-4 py-3 text-gray-500">{r.executedBy?.name || r.executedBy?.email || '—'}</td>
                      <td className="px-4 py-3"><span className={`px-2 py-0.5 text-xs rounded-full ${statusColor[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span></td>
                      <td className="px-4 py-3 text-green-600 font-medium">{r.passedCount ?? 0}</td>
                      <td className="px-4 py-3 text-red-600 font-medium">{r.failedCount ?? 0}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{new Date(r.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                  {recentRuns.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No test runs yet. Go to Test Runs to start one.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AuroraPage>
  );
}
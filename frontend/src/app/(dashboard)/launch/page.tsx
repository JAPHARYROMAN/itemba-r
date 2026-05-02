'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import Link from 'next/link';

export default function LaunchDashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/launch/summary')
      .then(r => r.json())
      .then(d => { setSummary(d?.data ?? d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statusBg: Record<string, string> = { READY: 'bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-700', NOT_READY: 'bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-700', READY_WITH_RISKS: 'bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-700' };
  const statusText: Record<string, string> = { READY: 'text-green-700 dark:text-green-300', NOT_READY: 'text-red-700 dark:text-red-300', READY_WITH_RISKS: 'text-yellow-700 dark:text-yellow-300' };

  return (
    <AuroraPage>
      <AuroraPageHeader title="Launch Readiness" subtitle="Go-live readiness dashboard — final gate before production launch" />
      <div className="p-6 space-y-6">
        {loading ? <div className="text-gray-500">Loading...</div> : (
          <>
            {summary?.latestAssessment && (
              <div className={`rounded-lg border p-5 ${statusBg[summary.latestAssessment.overallStatus] || 'bg-gray-50 border-gray-200'}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className={`text-xl font-bold ${statusText[summary.latestAssessment.overallStatus] || 'text-gray-700'}`}>
                      {summary.latestAssessment.overallStatus === 'READY' ? '✅ READY FOR LAUNCH' : summary.latestAssessment.overallStatus === 'NOT_READY' ? '❌ NOT READY' : '⚠️ READY WITH RISKS'}
                    </h2>
                    <p className="text-sm mt-1 text-gray-600 dark:text-gray-400">Overall Score: {summary.latestAssessment.overallScore ?? '—'} / 100</p>
                  </div>
                  <Link href="/launch/assessments" className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">View Assessments</Link>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Critical Blockers', value: summary?.criticalBlockers ?? 0, color: 'text-red-600' },
                { label: 'High Blockers', value: summary?.highBlockers ?? 0, color: 'text-orange-600' },
                { label: 'Items Passed', value: summary?.passedItems ?? 0, color: 'text-green-600' },
                { label: 'Items Pending', value: summary?.pendingItems ?? 0, color: 'text-blue-600' },
              ].map(c => (
                <div key={c.label} className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
                  <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
                  <div className="text-xs text-gray-500 mt-1">{c.label}</div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { href: '/launch/blockers', icon: '🚫', label: 'Launch Blockers', desc: 'Critical issues blocking go-live' },
                { href: '/launch/assessments', icon: '📋', label: 'Assessments', desc: 'Launch readiness assessments' },
                { href: '/launch/readiness-items', icon: '✅', label: 'Readiness Items', desc: 'Individual readiness checklist items' },
                { href: '/qa', icon: '🧪', label: 'QA Dashboard', desc: 'Test suites and test runs' },
              ].map(item => (
                <Link key={item.href} href={item.href} className="block bg-white dark:bg-gray-800 rounded-lg p-5 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors">
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
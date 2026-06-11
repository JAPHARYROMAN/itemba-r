'use client';

import { useState, useEffect } from 'react';
import { PageSpinner } from '@/components/ui';
import Link from 'next/link';

export default function DataIsolationDashboardPage() {
  const [stats, setStats] = useState({ totalTestRuns: 0, passed: 0, failed: 0, openIssues: 0, criticalIssues: 0, highIssues: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/data-isolation/dashboard')
      .then(r => r.json())
      .then(res => {
        const d = res.data ?? res;
        setStats({
          totalTestRuns: d.totalTestRuns ?? 0,
          passed: d.passed ?? 0,
          failed: d.failed ?? 0,
          openIssues: d.openIssues ?? 0,
          criticalIssues: d.criticalIssues ?? 0,
          highIssues: d.highIssues ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Total Test Runs', value: stats.totalTestRuns, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Passed', value: stats.passed, color: 'bg-green-50 text-green-700 border-green-200' },
    { label: 'Failed', value: stats.failed, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: 'Open Issues', value: stats.openIssues, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ];

  const quickLinks = [
    { label: 'Test Runs', href: '/data-isolation/test-runs', desc: 'Run and review isolation test suites' },
    { label: 'Issues', href: '/data-isolation/issues', desc: 'Review and resolve data isolation violations' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Isolation</h1>
        <p className="text-gray-500 mt-1">Multi-tenancy data isolation testing and compliance</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {statCards.map(card => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          {(stats.criticalIssues > 0 || stats.highIssues > 0) && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6 flex items-center gap-4">
              <div className="text-sm text-red-700 font-medium">Open Issues by Severity:</div>
              {stats.criticalIssues > 0 && (
                <span className="px-3 py-1 bg-red-200 text-red-800 text-xs font-bold rounded-full">{stats.criticalIssues} CRITICAL</span>
              )}
              {stats.highIssues > 0 && (
                <span className="px-3 py-1 bg-orange-200 text-orange-800 text-xs font-bold rounded-full">{stats.highIssues} HIGH</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {quickLinks.map(link => (
              <Link key={link.href} href={link.href} className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
                <div className="font-semibold text-gray-900 mb-1">{link.label}</div>
                <div className="text-sm text-gray-500">{link.desc}</div>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

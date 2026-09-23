'use client';

import { useCallback, useEffect, useState } from 'react';
import { ErrorState, PageSpinner } from '@/components/ui';
import Link from 'next/link';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

export default function DataIsolationDashboardPage() {
  const { hasPermission, loading: authLoading } = useAuth();
  const canView = hasPermission('data_isolation.view');
  const beginRequest = useRequestGuard();
  const [stats, setStats] = useState({ totalTestRuns: 0, passed: 0, failed: 0, openIssues: 0, criticalIssues: 0, highIssues: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/backend/data-isolation/dashboard', { signal: request.signal });
      if (!request.current()) return;
      if (!response.ok) throw new Error('Failed to load data isolation statistics.');
      const body = await response.json();
      if (!request.current()) return;
      const dashboard = body.data ?? body;
      setStats({
        totalTestRuns: dashboard.totalTestRuns ?? 0,
        passed: dashboard.passed ?? 0,
        failed: dashboard.failed ?? 0,
        openIssues: dashboard.openIssues ?? 0,
        criticalIssues: dashboard.criticalIssues ?? 0,
        highIssues: dashboard.highIssues ?? 0,
      });
    } catch (err) {
      if (!request.current()) return;
      setLoadError(err instanceof Error ? err.message : 'Failed to load data isolation statistics.');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView]);

  useEffect(() => {
    void load();
  }, [load]);

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

  if (authLoading || !canView) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Isolation</h1>
        <p className="text-gray-500 mt-1">{authLoading ? 'Loading' : 'Access Restricted'}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Isolation</h1>
        <p className="text-gray-500 mt-1">Multi-tenancy data isolation testing and compliance</p>
      </div>

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={() => void load()} />
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

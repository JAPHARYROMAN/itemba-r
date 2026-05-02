'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { unwrapList } from '@/lib/unwrap';

const STATUS_COLORS: Record<string, string> = {
  PASSED: 'bg-green-100 text-green-700',
  FAILED: 'bg-red-100 text-red-700',
  NOT_STARTED: 'bg-gray-100 text-gray-500',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  WAIVED: 'bg-yellow-100 text-yellow-700',
  PENDING: 'bg-orange-100 text-orange-700',
};

export default function ProductionDashboardPage() {
  const [checks, setChecks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/production-readiness')
      .then(r => r.json())
      .then(res => setChecks(unwrapList(res)))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const counts = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'PASSED').length,
    failed: checks.filter(c => c.status === 'FAILED').length,
    notStarted: checks.filter(c => c.status === 'NOT_STARTED').length,
    pending: checks.filter(c => c.status === 'PENDING' || c.status === 'IN_PROGRESS').length,
  };
  const pct = counts.total > 0 ? Math.round((counts.passed / counts.total) * 100) : 0;

  const statCards = [
    { label: 'Total Checks', value: counts.total, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Passed', value: counts.passed, color: 'bg-green-50 text-green-700 border-green-200' },
    { label: 'Failed', value: counts.failed, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: 'Not Started', value: counts.notStarted, color: 'bg-gray-50 text-gray-600 border-gray-200' },
    { label: 'In Progress / Pending', value: counts.pending, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ];

  const quickLinks = [
    { label: 'Readiness Checklist', href: '/production/readiness', desc: 'View all checklist items by category' },
    { label: 'Environment Checks', href: '/production/environment', desc: 'Validate environment configuration' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Production Dashboard</h1>
        <p className="text-gray-500 mt-1">Production readiness overview and progress</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
            {statCards.map(card => (
              <div key={card.label} className={`rounded-xl border p-4 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-xs font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-gray-700">Overall Readiness</span>
              <span className="text-sm font-bold text-gray-900">{pct}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div
                className={`h-3 rounded-full ${pct >= 80 ? 'bg-green-500' : pct >= 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 mt-2">{counts.passed} of {counts.total} checks passed</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {quickLinks.map(link => (
              <Link key={link.href} href={link.href} className="block bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
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

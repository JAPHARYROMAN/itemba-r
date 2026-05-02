'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { unwrapList } from '@/lib/unwrap';

export default function RetentionOverviewPage() {
  const [stats, setStats] = useState({ activePolicies: 0, legalHoldRecords: 0, pendingArchiveJobs: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/backend/retention-policies').then(r => r.json()).catch(() => []),
      fetch('/api/backend/archive-jobs?status=PENDING').then(r => r.json()).catch(() => []),
    ]).then(([policies, jobs]) => {
      const policyList: any[] = unwrapList(policies);
      const jobList: any[] = unwrapList(jobs);
      setStats({
        activePolicies: policyList.filter((p: any) => p.isActive).length,
        legalHoldRecords: policyList.filter((p: any) => p.legalHold).length,
        pendingArchiveJobs: jobList.length,
      });
    }).finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Active Policies', value: stats.activePolicies, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Legal Hold Records', value: stats.legalHoldRecords, color: 'bg-purple-50 text-purple-700 border-purple-200' },
    { label: 'Pending Archive Jobs', value: stats.pendingArchiveJobs, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  ];

  const links = [
    { label: 'Retention Policies', href: '/retention/policies', desc: 'Configure data retention rules and timelines' },
    { label: 'Archive Jobs', href: '/retention/archive-jobs', desc: 'View archive and deletion job runs' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Data Retention Overview</h1>
        <p className="text-gray-500 mt-1">Manage data retention policies and archival operations</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            {statCards.map(card => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {links.map(link => (
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

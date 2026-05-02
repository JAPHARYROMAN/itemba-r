'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function ScalabilityDashboardPage() {
  const [stats, setStats] = useState({ activeQueues: 0, totalCacheEntries: 0, loadTestsRun: 0, jobsToday: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/scalability/dashboard')
      .then(r => r.json())
      .then(res => {
        const d = res.data ?? res;
        setStats({
          activeQueues: d.activeQueues ?? 0,
          totalCacheEntries: d.totalCacheEntries ?? 0,
          loadTestsRun: d.loadTestsRun ?? 0,
          jobsToday: d.jobsToday ?? 0,
        });
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Active Queues', value: stats.activeQueues, color: 'bg-green-50 text-green-700 border-green-200' },
    { label: 'Total Cache Entries', value: stats.totalCacheEntries, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Load Tests Run', value: stats.loadTestsRun, color: 'bg-purple-50 text-purple-700 border-purple-200' },
    { label: 'Jobs Today', value: stats.jobsToday, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ];

  const quickLinks = [
    { label: 'Load Tests', href: '/scalability/load-tests', desc: 'Run and review load tests' },
    { label: 'Background Jobs', href: '/background-jobs', desc: 'Monitor job queues and processing' },
    { label: 'Job Queues', href: '/background-jobs/queues', desc: 'Configure queue concurrency and retries' },
    { label: 'Cache Management', href: '/cache', desc: 'View and manage application cache' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Scalability Dashboard</h1>
        <p className="text-gray-500 mt-1">System scalability and load management overview</p>
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(card => (
              <div key={card.label} className={`rounded-xl border p-5 ${card.color}`}>
                <div className="text-3xl font-bold">{card.value}</div>
                <div className="text-sm font-medium mt-1">{card.label}</div>
              </div>
            ))}
          </div>

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

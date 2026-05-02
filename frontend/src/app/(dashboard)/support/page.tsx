'use client';
import { useState, useEffect } from 'react';
import { AuroraPage } from '@/components/aurora/layout/AuroraPage';
import { AuroraPageHeader } from '@/components/aurora/layout/AuroraPageHeader';
import Link from 'next/link';

export default function SupportOverviewPage() {
  const [summary, setSummary] = useState<any>(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/support/summary')
      .then((r) => r.json())
      .then((d) => setSummary(d?.data ?? d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const cards = summary
    ? [
        { label: 'Open Tickets', value: summary.openTickets ?? 0, color: 'text-blue-600' },
        { label: 'In Progress', value: summary.inProgressTickets ?? 0, color: 'text-yellow-600' },
        { label: 'Urgent', value: summary.urgentTickets ?? 0, color: 'text-red-600' },
        { label: 'Resolved Today', value: summary.resolvedToday ?? 0, color: 'text-green-600' },
        {
          label: 'Overdue SLA',
          value: summary.serviceLevel?.overdueTickets ?? 0,
          color: 'text-rose-600',
        },
        {
          label: 'Avg Resolution Hours',
          value: summary.averageResolutionHours ?? 0,
          color: 'text-indigo-600',
        },
      ]
    : [];

  return (
    <AuroraPage>
      <AuroraPageHeader
        title="Support Center"
        subtitle="Track and manage support tickets and user requests"
      />
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {cards.map((c) => (
            <div
              key={c.label}
              className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700"
            >
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-sm text-gray-500 mt-1">{c.label}</div>
            </div>
          ))}
        </div>
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {summary.unassignedTickets ?? 0}
              </div>
              <div className="text-sm text-gray-500 mt-1">Unassigned Active Tickets</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {summary.serviceLevel?.overdueRate ?? 0}%
              </div>
              <div className="text-sm text-gray-500 mt-1">SLA Overdue Rate</div>
            </div>
            <div className="bg-white dark:bg-gray-800 rounded-lg p-4 border border-gray-200 dark:border-gray-700">
              <div className="text-2xl font-bold text-gray-900 dark:text-white">
                {summary.waitingUserTickets ?? 0}
              </div>
              <div className="text-sm text-gray-500 mt-1">Waiting on User</div>
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <Link
            href="/support/tickets"
            className="block bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors"
          >
            <div className="text-2xl mb-2">🎫</div>
            <h3 className="font-semibold text-gray-900 dark:text-white">All Support Tickets</h3>
            <p className="text-sm text-gray-500 mt-1">
              View and manage all tickets across the system
            </p>
          </Link>
          <Link
            href="/support/tickets/me"
            className="block bg-white dark:bg-gray-800 rounded-lg p-6 border border-gray-200 dark:border-gray-700 hover:border-blue-500 transition-colors"
          >
            <div className="text-2xl mb-2">📋</div>
            <h3 className="font-semibold text-gray-900 dark:text-white">My Tickets</h3>
            <p className="text-sm text-gray-500 mt-1">View tickets you have submitted</p>
          </Link>
        </div>
      </div>
    </AuroraPage>
  );
}

'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function ApprovalsDashboardPage() {
  const [stats, setStats] = useState({
    pending: 0,
    approvedToday: 0,
    rejectedThisWeek: 0,
    myPending: 0,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/approvals/requests?limit=1').then(r => r.json())
      .then((_res: any) => { /* stats will be loaded in production */ })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Pending Approvals', value: stats.pending, color: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
    { label: 'Approved Today', value: stats.approvedToday, color: 'bg-green-50 text-green-700 border-green-200' },
    { label: 'Rejected This Week', value: stats.rejectedThisWeek, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: 'My Pending', value: stats.myPending, color: 'bg-blue-50 text-blue-700 border-blue-200' },
  ];

  const quickLinks = [
    { label: 'Workflows', href: '/approvals/workflows', desc: 'Manage approval workflow definitions' },
    { label: 'Requests', href: '/approvals/requests', desc: 'View all approval requests' },
    { label: 'Pending Approvals', href: '/approvals/pending', desc: 'Requests awaiting your approval' },
    { label: 'Delegations', href: '/approvals/delegations', desc: 'Manage approval delegations' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Approvals Dashboard</h1>
        <p className="text-gray-500 mt-1">Overview of approval workflows and requests</p>
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {quickLinks.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className="block bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
              >
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

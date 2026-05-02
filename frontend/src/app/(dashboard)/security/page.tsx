'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface SecurityStats {
  totalEvents: number;
  activeSessions: number;
  lockedAccounts: number;
  failedLogins24h: number;
}

interface SecurityEvent {
  id: string;
  eventNumber: string;
  eventType: string;
  severity: string;
  status: string;
  ipAddress: string;
  createdAt: string;
}

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  MEDIUM: 'bg-yellow-100 text-yellow-700',
  LOW: 'bg-blue-100 text-blue-700',
  INFO: 'bg-gray-100 text-gray-600',
};

export default function SecurityDashboardPage() {
  const [stats, setStats] = useState<SecurityStats>({ totalEvents: 0, activeSessions: 0, lockedAccounts: 0, failedLogins24h: 0 });
  const [events, setEvents] = useState<SecurityEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/backend/security/dashboard')
      .then(r => r.json())
      .then(res => {
        const d = res?.data ?? res;
        setStats({
          totalEvents: d.totalEvents ?? 0,
          activeSessions: d.activeSessions ?? 0,
          lockedAccounts: d.lockedAccounts ?? 0,
          failedLogins24h: d.failedLogins24h ?? 0,
        });
        setEvents(Array.isArray(d.recentCriticalEvents) ? d.recentCriticalEvents : []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'Security Events (30d)', value: stats.totalEvents, color: 'bg-purple-50 text-purple-700 border-purple-200' },
    { label: 'Active Sessions', value: stats.activeSessions, color: 'bg-blue-50 text-blue-700 border-blue-200' },
    { label: 'Locked Accounts', value: stats.lockedAccounts, color: 'bg-red-50 text-red-700 border-red-200' },
    { label: 'Failed Logins (24h)', value: stats.failedLogins24h, color: 'bg-orange-50 text-orange-700 border-orange-200' },
  ];

  const quickLinks = [
    { label: 'Security Policies', href: '/security/policies', desc: 'Manage security policy configurations' },
    { label: 'User Security Profiles', href: '/security/user-profiles', desc: 'View 2FA, risk levels, and login history' },
    { label: 'Security Events', href: '/security/events', desc: 'Review and resolve security events' },
    { label: 'Active Sessions', href: '/security/sessions', desc: 'Monitor and revoke user sessions' },
    { label: 'Two-Factor Auth', href: '/security/two-factor', desc: 'Manage 2FA adoption and requirements' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Security Dashboard</h1>
        <p className="text-gray-500 mt-1">Security overview — access control and audit are enforced by the backend</p>
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

          {events.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm mb-8">
              <div className="px-5 py-4 border-b border-gray-100 font-semibold text-gray-800">Recent Critical Events</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 text-xs uppercase bg-gray-50">
                    <th className="px-4 py-2">Event #</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Severity</th>
                    <th className="px-4 py-2">IP Address</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono text-xs">{ev.eventNumber}</td>
                      <td className="px-4 py-2">{ev.eventType}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${SEVERITY_COLORS[ev.severity] ?? 'bg-gray-100 text-gray-600'}`}>{ev.severity}</span>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">{ev.ipAddress ?? '—'}</td>
                      <td className="px-4 py-2">{ev.status}</td>
                      <td className="px-4 py-2 text-gray-400">{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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

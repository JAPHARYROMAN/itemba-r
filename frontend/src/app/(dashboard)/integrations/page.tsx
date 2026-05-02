'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, StatusBadge, PageSpinner } from '@/components/ui';

interface IntegrationStats {
  totalProviders: number;
  activeConnections: number;
  eventsLast24h: number;
  activeApiKeys: number;
}

interface RecentEvent {
  id: string;
  eventNumber: string;
  eventType: string;
  direction: string;
  status: string;
  entityType: string;
  createdAt: string;
}

export default function IntegrationsDashboardPage() {
  const [stats, setStats] = useState<IntegrationStats>({ totalProviders: 0, activeConnections: 0, eventsLast24h: 0, activeApiKeys: 0 });
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/backend/integration-providers?limit=1').then(r => r.json()).catch(() => null),
      fetch('/api/backend/integration-connections?limit=1').then(r => r.json()).catch(() => null),
      fetch('/api/backend/integration-events?limit=10').then(r => r.json()).catch(() => null),
      fetch('/api/backend/api-keys?limit=1').then(r => r.json()).catch(() => null),
    ]).then(([providers, connections, eventsData, keys]) => {
      const pTotal = providers?.data?.total ?? providers?.total ?? 0;
      const cTotal = connections?.data?.total ?? connections?.total ?? 0;
      const eArr = Array.isArray(eventsData?.data?.data) ? eventsData.data.data : Array.isArray(eventsData?.data) ? eventsData.data : [];
      const eTotal = eventsData?.data?.total ?? eventsData?.total ?? eArr.length;
      const kTotal = keys?.data?.total ?? keys?.total ?? 0;
      setStats({ totalProviders: pTotal, activeConnections: cTotal, eventsLast24h: eTotal, activeApiKeys: kTotal });
      setEvents(eArr.slice(0, 10));
    }).finally(() => setLoading(false));
  }, []);

  const quickLinks = [
    { label: 'Providers', href: '/integrations/providers', desc: 'Manage integration providers' },
    { label: 'Connections', href: '/integrations/connections', desc: 'Company integration connections' },
    { label: 'Events Log', href: '/integrations/events', desc: 'View all integration events' },
    { label: 'Webhook Endpoints', href: '/integrations/webhooks', desc: 'Manage webhook endpoints' },
    { label: 'Webhook Events', href: '/integrations/webhook-events', desc: 'Incoming webhook events' },
    { label: 'External Payments', href: '/integrations/payments', desc: 'Payment transactions' },
    { label: 'Messages', href: '/integrations/messages', desc: 'Outgoing messages' },
    { label: 'Templates', href: '/integrations/templates', desc: 'Message templates' },
    { label: 'Mappings', href: '/integrations/mappings', desc: 'Entity mappings' },
  ];

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Integration Dashboard" subtitle="Overview of integrations, connections, and events" />

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Total Providers" value={stats.totalProviders} />
            <StatCard label="Active Connections" value={stats.activeConnections} />
            <StatCard label="Events (24h)" value={stats.eventsLast24h} />
            <StatCard label="API Keys Active" value={stats.activeApiKeys} />
          </div>

          {events.length > 0 && (
            <Card className="overflow-hidden">
              <div className="px-5 py-4 border-b font-semibold" style={{ borderColor: 'var(--aurora-border)', color: 'var(--aurora-text)' }}>Recent Integration Events</div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                    <th className="px-4 py-2">Number</th>
                    <th className="px-4 py-2">Type</th>
                    <th className="px-4 py-2">Direction</th>
                    <th className="px-4 py-2">Status</th>
                    <th className="px-4 py-2">Entity</th>
                    <th className="px-4 py-2">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(ev => (
                    <tr key={ev.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2 font-mono text-xs">{ev.eventNumber}</td>
                      <td className="px-4 py-2">{ev.eventType}</td>
                      <td className="px-4 py-2">{ev.direction}</td>
                      <td className="px-4 py-2"><StatusBadge status={ev.status} /></td>
                      <td className="px-4 py-2">{ev.entityType}</td>
                      <td className="px-4 py-2 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {quickLinks.map(link => (
              <Link key={link.href} href={link.href} className="block">
                <Card className="p-5 hover:shadow-md transition-shadow h-full">
                  <div className="font-semibold mb-1" style={{ color: 'var(--aurora-text)' }}>{link.label}</div>
                  <div className="text-sm" style={{ color: 'var(--aurora-text-muted)' }}>{link.desc}</div>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

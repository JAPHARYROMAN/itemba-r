'use client';

import { WorkspaceTable } from '@/components/ui/workspace-table';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Card, PageHeader, StatCard, StatusBadge, PageSpinner, ErrorState } from '@/components/ui';
import { useAuth } from '@/hooks/use-auth';
import { useRequestGuard } from '@/hooks/use-request-guard';

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
  const { hasPermission, loading: authLoading } = useAuth();
  const canViewProviders = hasPermission('integration_providers.view');
  const canViewConnections = hasPermission('integration_connections.view');
  const canViewEvents = hasPermission('integration_events.view');
  const canViewApiKeys = hasPermission('api_keys.view');
  const canView = canViewProviders || canViewConnections || canViewEvents || canViewApiKeys;
  const beginRequest = useRequestGuard();

  const [stats, setStats] = useState<IntegrationStats>({ totalProviders: 0, activeConnections: 0, eventsLast24h: 0, activeApiKeys: 0 });
  const [events, setEvents] = useState<RecentEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    if (authLoading || !canView) return;
    const request = beginRequest();
    setLoading(true);
    setLoadError('');
    try {
      const fetches: Promise<Response>[] = [];
      const keys: Array<'providers' | 'connections' | 'events' | 'keys'> = [];
      if (canViewProviders) {
        keys.push('providers');
        fetches.push(fetch('/api/backend/integration-providers?limit=1', { signal: request.signal }));
      }
      if (canViewConnections) {
        keys.push('connections');
        fetches.push(fetch('/api/backend/integration-connections?limit=1', { signal: request.signal }));
      }
      if (canViewEvents) {
        keys.push('events');
        fetches.push(fetch('/api/backend/integration-events?limit=10', { signal: request.signal }));
      }
      if (canViewApiKeys) {
        keys.push('keys');
        fetches.push(fetch('/api/backend/api-keys?limit=1', { signal: request.signal }));
      }

      const responses = await Promise.all(fetches);
      if (!request.current()) return;

      const bodies = await Promise.all(responses.map((r) => r.json().catch(() => ({}))));
      if (!request.current()) return;

      for (let i = 0; i < responses.length; i++) {
        if (!responses[i].ok) {
          throw new Error(bodies[i]?.message ?? 'Failed to load integration dashboard');
        }
      }

      const byKey = Object.fromEntries(keys.map((k, i) => [k, bodies[i]])) as Record<string, any>;
      const providers = byKey.providers;
      const connections = byKey.connections;
      const eventsData = byKey.events;
      const apiKeys = byKey.keys;

      const pTotal = providers ? (providers?.data?.total ?? providers?.total ?? 0) : 0;
      const cTotal = connections ? (connections?.data?.total ?? connections?.total ?? 0) : 0;
      const eArr = eventsData
        ? (Array.isArray(eventsData?.data?.data) ? eventsData.data.data : Array.isArray(eventsData?.data) ? eventsData.data : [])
        : [];
      const eTotal = eventsData ? (eventsData?.data?.total ?? eventsData?.total ?? eArr.length) : 0;
      const kTotal = apiKeys ? (apiKeys?.data?.total ?? apiKeys?.total ?? 0) : 0;

      setStats({ totalProviders: pTotal, activeConnections: cTotal, eventsLast24h: eTotal, activeApiKeys: kTotal });
      setEvents(eArr.slice(0, 10));
    } catch (err) {
      if (!request.current()) return;
      setStats({ totalProviders: 0, activeConnections: 0, eventsLast24h: 0, activeApiKeys: 0 });
      setEvents([]);
      setLoadError(err instanceof Error ? err.message : 'Failed to load integration dashboard');
    } finally {
      if (request.current()) setLoading(false);
    }
  }, [authLoading, beginRequest, canView, canViewProviders, canViewConnections, canViewEvents, canViewApiKeys]);

  useEffect(() => { load(); }, [load]);

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

  if (authLoading) return <div className="p-6"><PageHeader title="Integration Dashboard" subtitle="Loading" /></div>;
  if (!canView) return <div className="p-6"><PageHeader title="Integration Dashboard" /><div className="mt-8 text-center"><p className="text-sm text-slate-500">Access Restricted</p></div></div>;

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="Integration Dashboard" subtitle="Overview of integrations, connections, and events" />

      {loading ? (
        <PageSpinner />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} />
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
              <WorkspaceTable className="w-full text-sm">
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
              </WorkspaceTable>
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

'use client';
import { useState, useEffect, useCallback } from 'react';
import { Btn, ConfirmDialog, PageSpinner, showToast } from '@/components/ui';
import { backendPatch, ApiError } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-500',
};

type Tab = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
type AlertAction = 'acknowledge' | 'resolve' | 'dismiss';

const ACTIONS: Record<string, { action: AlertAction; label: string; variant: 'primary' | 'success' | 'secondary' }[]> = {
  OPEN: [
    { action: 'acknowledge', label: 'Acknowledge', variant: 'primary' },
    { action: 'resolve', label: 'Resolve', variant: 'success' },
    { action: 'dismiss', label: 'Dismiss', variant: 'secondary' },
  ],
  ACKNOWLEDGED: [
    { action: 'resolve', label: 'Resolve', variant: 'success' },
    { action: 'dismiss', label: 'Dismiss', variant: 'secondary' },
  ],
  RESOLVED: [
    { action: 'dismiss', label: 'Dismiss', variant: 'secondary' },
  ],
  DISMISSED: [],
};

const ACTION_PERMISSIONS: Record<AlertAction, string> = {
  acknowledge: 'alert_events.acknowledge',
  resolve: 'alert_events.resolve',
  dismiss: 'alert_events.dismiss',
};

export default function AlertEventsPage() {
  const { hasPermission } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('OPEN');
  const [actionLoading, setActionLoading] = useState('');
  const [dismissing, setDismissing] = useState<any | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    fetch(`/api/backend/alert-events?status=${activeTab}`)
      .then(r => r.json())
      .then((res: any) => setEvents(res.data?.data ?? []))
      .catch(() => {
        setEvents([]);
        setLoadError('Failed to load alert events. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => {
    load();
  }, [load]);

  const runAction = async (ev: any, action: AlertAction) => {
    setActionLoading(`${ev.id}-${action}`);
    try {
      await backendPatch(`/alert-events/${ev.id}/${action}`, {});
      showToast('success', `Alert ${action === 'acknowledge' ? 'acknowledged' : action === 'resolve' ? 'resolved' : 'dismissed'}`);
      load();
    } catch (err) {
      showToast('error', err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setActionLoading('');
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'OPEN', label: 'Open' },
    { key: 'ACKNOWLEDGED', label: 'Acknowledged' },
    { key: 'RESOLVED', label: 'Resolved' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Alert Events</h1>
        <p className="text-gray-500 mt-1">Monitor and manage system alert events</p>
      </div>

      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === t.key
                ? 'border-brand-600 text-brand-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadError && (
        <div className="mb-4 flex items-center justify-between text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <span>{loadError}</span>
          <button onClick={load} className="text-red-700 font-medium hover:underline ml-3">Retry</button>
        </div>
      )}

      {loading ? (
        <PageSpinner label="Loading records" />
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Alert #', 'Type', 'Title', 'Priority', 'Company', 'Triggered At', 'Actions'].map(h => (
                  <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {events.map(ev => (
                <tr key={ev.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono text-gray-700">{ev.alertEventNumber || ev.id}</td>
                  <td className="px-6 py-4 text-sm text-gray-600">{ev.alertRule?.alertType || ev.alertType}</td>
                  <td className="px-6 py-4 text-sm font-medium text-gray-900">{ev.title || ev.alertRule?.name}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[ev.priority] || 'bg-gray-100 text-gray-500'}`}>
                      {ev.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-600">{ev.company?.name || '—'}</td>
                  <td className="px-6 py-4 text-sm text-gray-400">{ev.triggeredAt ? new Date(ev.triggeredAt).toLocaleString() : '—'}</td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex flex-wrap gap-1">
                      {(ACTIONS[ev.status ?? activeTab] ?? [])
                        .filter(a => hasPermission(ACTION_PERMISSIONS[a.action]))
                        .map(a => (
                          <Btn
                            key={a.action}
                            variant={a.variant}
                            size="xs"
                            loading={actionLoading === `${ev.id}-${a.action}`}
                            disabled={actionLoading !== ''}
                            onClick={() => (a.action === 'dismiss' ? setDismissing(ev) : runAction(ev, a.action))}
                          >
                            {a.label}
                          </Btn>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
              {events.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-10 text-center text-gray-400">No {activeTab.toLowerCase()} alerts</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={!!dismissing}
        title="Dismiss Alert"
        message={`Dismiss alert ${dismissing?.alertEventNumber || dismissing?.id || ''}? It will be removed from the active queues.`}
        confirmLabel="Dismiss"
        variant="warning"
        onConfirm={async () => {
          if (!dismissing) return;
          await runAction(dismissing, 'dismiss');
          setDismissing(null);
        }}
        onCancel={() => setDismissing(null)}
      />
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Modal, Btn, PageSpinner, ErrorState } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface IntegrationEvent {
  id: string;
  eventNumber: string;
  eventType: string;
  direction: string;
  status: string;
  entityType: string;
  entityId: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  errorMessage?: string;
  createdAt: string;
}

export default function IntegrationEventsPage() {
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDirection, setFilterDirection] = useState('');
  const [selected, setSelected] = useState<IntegrationEvent | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams({ limit: '50' });
    if (filterType) params.set('eventType', filterType);
    if (filterStatus) params.set('status', filterStatus);
    if (filterDirection) params.set('direction', filterDirection);
    fetch(`/api/backend/integration-events?${params}`)
      .then(r => r.json())
      .then(data => setEvents(unwrapList(data)))
      .catch(() => { setEvents([]); setLoadError('Failed to load integration events.'); })
      .finally(() => setLoading(false));
  }, [filterType, filterStatus, filterDirection]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Integration Events" subtitle="Log of all integration events" />

      <PageToolbar
        search={filterType}
        onSearch={setFilterType}
        searchPlaceholder="Event type…"
        filters={
          <>
            <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Status</option>
              {['SUCCESS','FAILED','PENDING','PROCESSING'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterDirection} onChange={e => setFilterDirection(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Directions</option>
              {['INBOUND','OUTBOUND'].map(d => <option key={d} value={d}>{d}</option>)}
            </select>
          </>
        }
      />

      <Card className="overflow-hidden">
        {loading ? <PageSpinner /> : loadError ? <ErrorState message={loadError} onRetry={load} /> : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase bg-gray-50" style={{ color: 'var(--aurora-text-muted)' }}>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Direction</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Entity Type</th>
                <th className="px-4 py-3">Entity ID</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No events found</td></tr>
              ) : events.map(ev => (
                <tr key={ev.id} className="border-t border-slate-100 hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(ev)}>
                  <td className="px-4 py-3 font-mono text-xs">{ev.eventNumber}</td>
                  <td className="px-4 py-3">{ev.eventType}</td>
                  <td className="px-4 py-3"><StatusBadge status={ev.direction} /></td>
                  <td className="px-4 py-3"><StatusBadge status={ev.status} /></td>
                  <td className="px-4 py-3">{ev.entityType}</td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{ev.entityId}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{ev.createdAt ? new Date(ev.createdAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `Event Detail — ${selected.eventNumber}` : ''}
        size="2xl"
        footer={<Btn variant="secondary" onClick={() => setSelected(null)}>Close</Btn>}
      >
        {selected && (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm mb-4">
              <div><span style={{ color: 'var(--aurora-text-muted)' }}>Type:</span> <span className="font-medium">{selected.eventType}</span></div>
              <div><span style={{ color: 'var(--aurora-text-muted)' }}>Direction:</span> <StatusBadge status={selected.direction} /></div>
              <div><span style={{ color: 'var(--aurora-text-muted)' }}>Status:</span> <StatusBadge status={selected.status} /></div>
              <div><span style={{ color: 'var(--aurora-text-muted)' }}>Entity Type:</span> <span className="font-medium">{selected.entityType}</span></div>
              <div><span style={{ color: 'var(--aurora-text-muted)' }}>Entity ID:</span> <span className="font-mono text-xs">{selected.entityId}</span></div>
              <div><span style={{ color: 'var(--aurora-text-muted)' }}>Created:</span> <span>{selected.createdAt ? new Date(selected.createdAt).toLocaleString() : '—'}</span></div>
            </div>
            {selected.errorMessage && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700"><strong>Error:</strong> {selected.errorMessage}</div>
            )}
            {!!selected.requestPayload && (
              <div className="mb-3">
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--aurora-text)' }}>Request Payload</div>
                <pre className="bg-slate-50 rounded-lg p-3 text-xs overflow-x-auto">{JSON.stringify(selected.requestPayload, null, 2)}</pre>
              </div>
            )}
            {!!selected.responsePayload && (
              <div>
                <div className="text-xs font-medium mb-1" style={{ color: 'var(--aurora-text)' }}>Response Payload</div>
                <pre className="bg-slate-50 rounded-lg p-3 text-xs overflow-x-auto">{JSON.stringify(selected.responsePayload, null, 2)}</pre>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

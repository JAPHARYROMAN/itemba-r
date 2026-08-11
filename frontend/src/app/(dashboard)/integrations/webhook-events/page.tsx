'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, PageHeader, PageToolbar, StatusBadge, Btn, PageSpinner, ErrorState } from '@/components/ui';
import { unwrapList } from '@/lib/unwrap';

interface WebhookEvent {
  id: string;
  webhookEventNumber: string;
  eventName: string;
  verificationStatus: string;
  processingStatus: string;
  companyId: string;
  receivedAt: string;
}

export default function WebhookEventsPage() {
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterProcessing, setFilterProcessing] = useState('');
  const [filterVerification, setFilterVerification] = useState('');
  const [reprocessingId, setReprocessingId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    const params = new URLSearchParams({ limit: '50' });
    if (filterProcessing) params.set('processingStatus', filterProcessing);
    if (filterVerification) params.set('verificationStatus', filterVerification);
    fetch(`/api/backend/webhook-events?${params}`)
      .then(r => r.json())
      .then(data => setEvents(unwrapList(data)))
      .catch(() => { setEvents([]); setLoadError('Failed to load webhook events.'); })
      .finally(() => setLoading(false));
  }, [filterProcessing, filterVerification]);

  useEffect(() => { load(); }, [load]);

  async function reprocess(id: string) {
    setReprocessingId(id);
    try {
      await fetch(`/api/backend/webhook-events/${id}/reprocess`, { method: 'POST' });
      load();
    } catch (e) { console.error(e); }
    finally { setReprocessingId(null); }
  }

  return (
    <div className="p-6 space-y-4">
      <PageHeader title="Webhook Events" subtitle="Incoming webhook events log" />

      <PageToolbar
        filters={
          <>
            <select value={filterProcessing} onChange={e => setFilterProcessing(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Processing Status</option>
              {['PROCESSED','PENDING','FAILED','SKIPPED'].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterVerification} onChange={e => setFilterVerification(e.target.value)} className="text-sm border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500" style={{ borderColor: 'var(--aurora-border)', background: 'var(--aurora-card)', color: 'var(--aurora-text)' }}>
              <option value="">All Verification Status</option>
              {['VERIFIED','UNVERIFIED','FAILED'].map(s => <option key={s} value={s}>{s}</option>)}
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
                <th className="px-4 py-3">Event Name</th>
                <th className="px-4 py-3">Verification</th>
                <th className="px-4 py-3">Processing</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Received At</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-sm" style={{ color: 'var(--aurora-text-muted)' }}>No webhook events found</td></tr>
              ) : events.map(ev => (
                <tr key={ev.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs">{ev.webhookEventNumber}</td>
                  <td className="px-4 py-3">{ev.eventName}</td>
                  <td className="px-4 py-3"><StatusBadge status={ev.verificationStatus} /></td>
                  <td className="px-4 py-3"><StatusBadge status={ev.processingStatus} /></td>
                  <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{ev.companyId}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: 'var(--aurora-text-muted)' }}>{ev.receivedAt ? new Date(ev.receivedAt).toLocaleString() : '—'}</td>
                  <td className="px-4 py-3">
                    {ev.processingStatus === 'FAILED' && (
                      <Btn variant="primary" size="xs" onClick={() => reprocess(ev.id)} loading={reprocessingId === ev.id}>Reprocess</Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

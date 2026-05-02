'use client';
import { useState, useEffect } from 'react';

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700',
  HIGH: 'bg-orange-100 text-orange-700',
  NORMAL: 'bg-blue-100 text-blue-700',
  LOW: 'bg-gray-100 text-gray-500',
};

type Tab = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

export default function AlertEventsPage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('OPEN');

  useEffect(() => {
    setLoading(true);
    fetch(`/api/backend/alert-events?status=${activeTab}`)
      .then(r => r.json())
      .then((res: any) => setEvents(res.data?.data ?? []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab]);

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

      {loading ? (
        <div className="text-center py-10 text-gray-500">Loading...</div>
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
                  <td className="px-6 py-4 text-sm space-x-2">
                    {activeTab === 'OPEN' && <button className="text-blue-600 hover:underline">Acknowledge</button>}
                    {activeTab !== 'RESOLVED' && <button className="text-green-600 hover:underline">Resolve</button>}
                    <button className="text-gray-400 hover:underline">Dismiss</button>
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
    </div>
  );
}

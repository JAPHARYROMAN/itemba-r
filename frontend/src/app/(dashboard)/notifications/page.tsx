'use client';
import { useState, useEffect } from 'react';

const TYPE_ICONS: Record<string, string> = {
  APPROVAL_REQUIRED: '✅',
  ALERT: '⚠️',
  REMINDER: '🔔',
  INFO: 'ℹ️',
  WARNING: '⚡',
  SYSTEM: '🖥️',
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-600',
  HIGH: 'text-orange-500',
  NORMAL: 'text-gray-700',
  LOW: 'text-gray-400',
};

type Tab = 'all' | 'unread' | 'archived';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    const params: Record<string, string> = {};
    if (activeTab === 'unread') params.status = 'UNREAD';
    if (activeTab === 'archived') params.status = 'ARCHIVED';
    setLoading(true);
    const qs = new URLSearchParams(params).toString();
    fetch(`/api/backend/notifications${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then((res: any) => {
        const data = res.data?.data ?? [];
        setNotifications(data);
        if (activeTab === 'all') {
          setUnreadCount(data.filter((n: any) => n.status === 'UNREAD').length);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [activeTab]);

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { key: 'archived', label: 'Archived' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Notifications
          {unreadCount > 0 && (
            <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500 text-white">{unreadCount}</span>
          )}
        </h1>
        <p className="text-gray-500 mt-1">Your notification centre</p>
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
        <div className="space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              className={`bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3 hover:shadow-sm transition-shadow ${n.status === 'UNREAD' ? 'border-l-4 border-l-brand-500' : ''}`}
            >
              <span className="text-xl">{TYPE_ICONS[n.notificationType] || '🔔'}</span>
              <div className="flex-1 min-w-0">
                <div className={`font-medium text-sm ${PRIORITY_COLORS[n.priority] || 'text-gray-800'}`}>
                  {n.title}
                  {n.status === 'UNREAD' && (
                    <span className="ml-2 inline-block w-2 h-2 rounded-full bg-brand-500 align-middle" />
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{n.body}</div>
                <div className="text-xs text-gray-400 mt-1">{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {n.status === 'UNREAD' && (
                  <button className="text-xs text-blue-600 hover:underline">Mark Read</button>
                )}
                <button className="text-xs text-gray-400 hover:underline">Dismiss</button>
              </div>
            </div>
          ))}
          {notifications.length === 0 && (
            <div className="text-center py-10 text-gray-400">No notifications</div>
          )}
        </div>
      )}
    </div>
  );
}

'use client';
import { useCallback, useEffect, useState } from 'react';
import { AppIcon, type AppIconName, SkeletonCardGrid, Btn, ConfirmDialog, showToast } from '@/components/ui';
import { backendPatch, backendDelete } from '@/lib/api-client';
import { useAuth } from '@/hooks/use-auth';

const TYPE_ICONS: Record<string, AppIconName> = {
  APPROVAL_REQUIRED: 'approved',
  ALERT: 'alert',
  REMINDER: 'bell',
  INFO: 'report',
  WARNING: 'alert',
  SYSTEM: 'settings',
};

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-600',
  HIGH: 'text-orange-500',
  NORMAL: 'text-gray-700',
  LOW: 'text-gray-400',
};

type Tab = 'all' | 'unread' | 'archived' | 'dismissed';
type RowAction = 'read' | 'dismiss';

const ROW_ACTIONS: Record<string, { action: RowAction; label: string }[]> = {
  UNREAD: [
    { action: 'read', label: 'Mark Read' },
    { action: 'dismiss', label: 'Dismiss' },
  ],
  READ: [{ action: 'dismiss', label: 'Dismiss' }],
  ARCHIVED: [{ action: 'dismiss', label: 'Dismiss' }],
  DISMISSED: [],
};

export default function NotificationsPage() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('notifications.view');
  const canManage = hasPermission('notifications.manage');

  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('all');
  const [unreadCount, setUnreadCount] = useState(0);
  const [actionLoading, setActionLoading] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const [deleting, setDeleting] = useState<any | null>(null);

  const load = useCallback(() => {
    const params: Record<string, string> = {};
    if (activeTab === 'unread') params.status = 'UNREAD';
    if (activeTab === 'archived') params.status = 'ARCHIVED';
    if (activeTab === 'dismissed') params.status = 'DISMISSED';
    setLoading(true);
    setLoadError('');
    const qs = new URLSearchParams(params).toString();
    fetch(`/api/backend/notifications${qs ? '?' + qs : ''}`)
      .then(r => r.json())
      .then((res: any) => {
        const data = res.data?.data ?? [];
        setNotifications(data);
        if (activeTab === 'all') {
          setUnreadCount(data.filter((n: any) => n.status === 'UNREAD').length);
        } else if (activeTab === 'unread') {
          setUnreadCount(data.length);
        }
      })
      .catch(() => {
        setNotifications([]);
        setLoadError('Failed to load notifications. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, [activeTab]);

  useEffect(() => { load(); }, [load]);

  const doAction = async (id: string, action: RowAction) => {
    setActionLoading(`${id}-${action}`);
    try {
      await backendPatch(`/notifications/${id}/${action}`);
      load();
    } catch (err) {
      showToast('error', action === 'read' ? 'Failed to mark as read' : 'Failed to dismiss', err instanceof Error ? err.message : undefined);
    } finally {
      setActionLoading('');
    }
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      await backendPatch('/notifications/mark-all-read');
      load();
    } catch (err) {
      showToast('error', 'Failed to mark all as read', err instanceof Error ? err.message : undefined);
    } finally {
      setMarkingAll(false);
    }
  };

  const doDelete = async () => {
    if (!deleting) return;
    try {
      await backendDelete(`/notifications/${deleting.id}`);
      load();
    } catch (err) {
      showToast('error', 'Failed to delete notification', err instanceof Error ? err.message : undefined);
    } finally {
      setDeleting(null);
    }
  };

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: `Unread${unreadCount > 0 ? ` (${unreadCount})` : ''}` },
    { key: 'archived', label: 'Archived' },
    { key: 'dismissed', label: 'Dismissed' },
  ];

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Notifications
            {unreadCount > 0 && (
              <span className="ml-2 px-2 py-0.5 rounded-full text-xs font-medium bg-red-500 text-white">{unreadCount}</span>
            )}
          </h1>
          <p className="text-gray-500 mt-1">Your notification centre</p>
        </div>
        {canView && unreadCount > 0 && (
          <Btn variant="secondary" size="sm" onClick={markAllRead} loading={markingAll}>
            Mark All Read
          </Btn>
        )}
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
        <SkeletonCardGrid count={4} className="grid grid-cols-1 gap-2" />
      ) : (
        <div className="space-y-2">
          {notifications.map(n => (
            <div
              key={n.id}
              className={`bg-white rounded-xl border border-gray-200 p-4 flex items-start gap-3 hover:shadow-sm transition-shadow ${n.status === 'UNREAD' ? 'border-l-4 border-l-brand-500' : ''}`}
            >
              <AppIcon
                name={TYPE_ICONS[n.notificationType] ?? 'bell'}
                size={20}
                className="mt-0.5 flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className={`font-medium text-sm ${PRIORITY_COLORS[n.priority] || 'text-gray-800'}`}>
                  {n.title}
                  {n.status === 'UNREAD' && (
                    <span className="ml-2 inline-block w-2 h-2 rounded-full bg-brand-500 align-middle" />
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">{n.message}</div>
                <div className="text-xs text-gray-400 mt-1">{n.createdAt ? new Date(n.createdAt).toLocaleString() : ''}</div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {canView && (ROW_ACTIONS[n.status] ?? []).map(a => (
                  <button
                    key={a.action}
                    onClick={() => doAction(n.id, a.action)}
                    disabled={actionLoading === `${n.id}-${a.action}`}
                    className={`text-xs hover:underline disabled:opacity-50 ${a.action === 'read' ? 'text-blue-600' : 'text-gray-400'}`}
                  >
                    {actionLoading === `${n.id}-${a.action}` ? '…' : a.label}
                  </button>
                ))}
                {canManage && (
                  <button
                    onClick={() => setDeleting(n)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
          {notifications.length === 0 && (
            <div className="text-center py-10 text-gray-400">No notifications</div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        title="Delete Notification"
        message={`Delete "${deleting?.title ?? 'this notification'}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={doDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

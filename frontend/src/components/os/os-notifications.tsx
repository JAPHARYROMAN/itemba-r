'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Check, CheckCheck, RefreshCw } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { LoadingState } from '@/components/ui/loading-state';
import { backendGet, backendPage, backendPatch } from '@/lib/api-client';
import { safeNotificationActionUrl } from '@/lib/notification-links';
import { useAuth } from '@/hooks/use-auth';

interface Notice {
  id: string;
  title: string;
  message: string;
  status: string;
  priority: string;
  actionUrl?: string | null;
  createdAt?: string | null;
}

/** The OS surface reads the same scoped inbox as the full Notifications app. */
export function OsNotifications({ onNavigate }: { onNavigate: (href: string) => void }) {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('notifications.view');
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [rows, setRows] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState('');
  const [revision, setRevision] = useState(0);
  const filterRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCount(null);
    if (!allowed) return;
    const controller = new AbortController();
    let pending = false;
    const refresh = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const result = await backendGet<{ count: number }>('/notifications/unread-count', {
          signal: controller.signal,
        });
        if (!controller.signal.aborted)
          setCount(Number.isFinite(result.count) ? Math.max(0, result.count) : 0);
      } catch {
        if (!controller.signal.aborted) setCount(null);
      } finally {
        pending = false;
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    const onVisible = () => void refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [allowed, user?.id, revision]);

  useEffect(() => {
    if (!open || !allowed) return;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setRows([]);
    backendPage<Notice>('/notifications', {
      query: { limit: 20, status: unreadOnly ? 'UNREAD' : undefined },
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) setRows(page.data);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Notifications could not be loaded. Check your connection and try again.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [open, allowed, unreadOnly, revision, user?.id]);

  async function markRead(id?: string) {
    if (busy) return;
    const trigger = document.activeElement;
    setBusy(id || 'all');
    setActionError('');
    try {
      await backendPatch(
        id ? `/notifications/${encodeURIComponent(id)}/read` : '/notifications/mark-all-read',
      );
      // The read action disappears on success. Keep keyboard users in the inbox,
      // but do not take focus back if they moved elsewhere during the request.
      if (document.activeElement === trigger) filterRef.current?.focus();
      setRevision((value) => value + 1);
    } catch {
      setActionError('Could not mark notifications as read. Please try again.');
    } finally {
      setBusy('');
    }
  }
  function visit(href: string) {
    setOpen(false);
    onNavigate(href);
  }
  if (!allowed) return null;
  return (
    <>
      <button
        type="button"
        className="os-notification-trigger"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        title="Notification centre"
        onClick={() => setOpen(true)}
      >
        <Bell size={17} aria-hidden="true" />
        {count !== null && count > 0 && <span aria-hidden="true" />}
      </button>
      {typeof document !== 'undefined' &&
        createPortal(
          <div className="os-system-layer">
            <Modal
              open={open}
              onClose={() => setOpen(false)}
              title="Notification centre"
              subtitle="What needs your attention, across your workspace."
              placement="right"
              size="md"
            >
              <div className="os-notifications">
                <div className="os-notification-toolbar">
                  <div role="group" aria-label="Notification filter">
                    <button
                      ref={!unreadOnly ? filterRef : undefined}
                      type="button"
                      aria-pressed={!unreadOnly}
                      onClick={() => setUnreadOnly(false)}
                    >
                      Recent
                    </button>
                    <button
                      ref={unreadOnly ? filterRef : undefined}
                      type="button"
                      aria-pressed={unreadOnly}
                      onClick={() => setUnreadOnly(true)}
                    >
                      Unread{count ? ` (${count})` : ''}
                    </button>
                  </div>
                  <button
                    type="button"
                    aria-label="Refresh notifications"
                    onClick={() => setRevision((value) => value + 1)}
                    disabled={loading}
                  >
                    <RefreshCw size={16} />
                  </button>
                </div>
                {actionError && (
                  <p className="os-notification-error" role="alert">
                    {actionError}
                  </p>
                )}
                {loading ? (
                  <LoadingState rows={3} label="Getting your notifications…" />
                ) : error ? (
                  <div className="os-notification-state" role="alert">
                    <p>{error}</p>
                    <button onClick={() => setRevision((value) => value + 1)}>Try again</button>
                  </div>
                ) : !rows.length ? (
                  <div className="os-notification-state">
                    <CheckCheck size={30} aria-hidden="true" />
                    <h3>{unreadOnly ? 'You’re all caught up' : 'A clear workspace'}</h3>
                    <p>
                      {unreadOnly
                        ? 'There are no unread notifications.'
                        : 'Updates and requests will appear here.'}
                    </p>
                  </div>
                ) : (
                  <ul className="os-notification-list">
                    {rows.map((row) => {
                      const href = safeNotificationActionUrl(row.actionUrl);
                      const date = row.createdAt ? new Date(row.createdAt) : null;
                      return (
                        <li key={row.id} data-unread={row.status === 'UNREAD'}>
                          <div className="os-notification-heading">
                            <strong>{row.title}</strong>
                            {['HIGH', 'CRITICAL'].includes(row.priority) && (
                              <span>{row.priority === 'CRITICAL' ? 'Critical' : 'Important'}</span>
                            )}
                          </div>
                          <p>{row.message}</p>
                          {date && Number.isFinite(date.getTime()) && (
                            <time dateTime={date.toISOString()}>
                              {date.toLocaleString(undefined, {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </time>
                          )}
                          <div className="os-notification-actions">
                            {href && (
                              <button type="button" onClick={() => visit(href)}>
                                Open details
                              </button>
                            )}
                            {row.status === 'UNREAD' && (
                              <button
                                type="button"
                                disabled={!!busy}
                                onClick={() => void markRead(row.id)}
                              >
                                <Check size={14} aria-hidden="true" />
                                {busy === row.id ? 'Updating…' : 'Mark read'}
                              </button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <footer>
                  <button type="button" onClick={() => visit('/notifications')}>
                    View all notifications
                  </button>
                  {count !== null && count > 0 && (
                    <button type="button" disabled={!!busy} onClick={() => void markRead()}>
                      {busy === 'all' ? 'Updating…' : 'Mark all read'}
                    </button>
                  )}
                </footer>
              </div>
            </Modal>
          </div>,
          document.body,
        )}
    </>
  );
}

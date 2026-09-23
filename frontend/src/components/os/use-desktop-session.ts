'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { backendGet, backendPut } from '@/lib/api-client';
import { EMPTY_DESKTOP, parseDesktopSession, type DesktopSession } from '@/lib/desktop';
export interface SavedDesktopSession {
  id: string;
  deviceId: string;
  name: string;
  revision: number;
  layout: DesktopSession;
  updatedAt: string;
}
function identifier(storage: Storage, key: string) {
  let value = storage.getItem(key);
  if (!value || !/^[a-z\d-]{20,80}$/i.test(value)) {
    value = crypto.randomUUID();
    storage.setItem(key, value);
  }
  return value;
}
export function useDesktopSession(userId: string) {
  const [session, setSession] = useState<DesktopSession>(EMPTY_DESKTOP);
  const [ready, setReady] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedDesktopSession[]>([]);
  const [status, setStatus] = useState('Loading workspace…');
  const identity = useRef({ id: '', deviceId: '', revision: 0 });
  const saved = useRef(''),
    pending = useRef<DesktopSession | null>(null),
    sending = useRef(false),
    mounted = useRef(true),
    loaded = useRef(false);
  useEffect(() => {
    mounted.current = true;
    try {
      identity.current.id = identifier(sessionStorage, `itemba.desktop.session.${userId}`);
      identity.current.deviceId = identifier(localStorage, `itemba.desktop.device.${userId}`);
    } catch {
      identity.current = { id: crypto.randomUUID(), deviceId: crypto.randomUUID(), revision: 0 };
    }
    const controller = new AbortController();
    backendGet<SavedDesktopSession[]>('/workspace/sessions', { signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return;
        loaded.current = true;
        setSavedSessions(rows);
        const own = rows.find((row) => row.id === identity.current.id);
        const previous = own ?? rows.find((row) => row.deviceId === identity.current.deviceId);
        identity.current.revision = own?.revision ?? 0;
        const layout = parseDesktopSession(previous?.layout);
        saved.current = own ? JSON.stringify(layout) : '';
        setSession(layout);
        setReady(true);
        setStatus('Workspace saved');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReady(true);
          setStatus('Workspace recovery unavailable');
        }
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [userId]);
  const flush = useCallback(async () => {
    if (sending.current || !loaded.current) return;
    sending.current = true;
    try {
      while (pending.current && mounted.current) {
        const layout: DesktopSession = pending.current;
        if (JSON.stringify(layout) === saved.current) {
          pending.current = null;
          continue;
        }
        setStatus('Saving workspace…');
        const result = await backendPut<SavedDesktopSession>(
          `/workspace/sessions/${identity.current.id}`,
          {
            deviceId: identity.current.deviceId,
            name: `${/Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop'} workspace`,
            layout,
            expectedRevision: identity.current.revision,
          },
        );
        identity.current.revision = result.revision;
        saved.current = JSON.stringify(layout);
        if (pending.current === layout) pending.current = null;
        if (mounted.current) setStatus('Workspace saved');
      }
    } catch {
      if (mounted.current) setStatus('Workspace not synced · check your connection');
    } finally {
      sending.current = false;
    }
  }, []);
  useEffect(() => {
    const online = () => void flush();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flush]);
  useEffect(() => {
    if (!ready) return;
    pending.current = session;
    const timer = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timer);
  }, [ready, session, flush]);
  return { session, setSession, ready, savedSessions, status };
}

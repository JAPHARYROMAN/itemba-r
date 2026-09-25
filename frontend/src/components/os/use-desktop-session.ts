'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, backendGet, backendPut } from '@/lib/api-client';
import { EMPTY_DESKTOP, parseDesktopSession, type DesktopSession } from '@/lib/desktop';
export interface SavedDesktopSession {
  id: string;
  deviceId: string;
  name: string;
  revision: number;
  layout: DesktopSession;
  updatedAt: string;
}
export type SessionRecovery = 'connection' | 'conflict' | null;
function identifier(storage: Storage, key: string) {
  let value = storage.getItem(key);
  if (!value || !/^[a-z\d-]{20,80}$/i.test(value)) {
    value = crypto.randomUUID();
    storage.setItem(key, value);
  }
  return value;
}
const serialise = (layout: DesktopSession) => JSON.stringify(parseDesktopSession(layout));
export function useDesktopSession(userId: string) {
  const [session, setSession] = useState<DesktopSession>(EMPTY_DESKTOP);
  const [ready, setReady] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedDesktopSession[]>([]);
  const [status, setStatus] = useState('Loading workspace…');
  const [recovery, setRecovery] = useState<SessionRecovery>(null);
  const [recovering, setRecovering] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const identity = useRef({ id: '', deviceId: '', revision: 0 });
  const saved = useRef(''),
    pending = useRef<DesktopSession | null>(null);
  const sending = useRef(false),
    loaded = useRef(false),
    blocked = useRef(false),
    epoch = useRef(0);
  useEffect(() => {
    const generation = ++epoch.current;
    loaded.current = false;
    sending.current = false;
    blocked.current = false;
    pending.current = null;
    saved.current = '';
    setReady(false);
    setSession(EMPTY_DESKTOP);
    setSavedSessions([]);
    setRecovery(null);
    setRecovering(false);
    setStatus('Loading workspace…');
    try {
      identity.current = {
        id: identifier(sessionStorage, 'itemba.desktop.session.' + userId),
        deviceId: identifier(localStorage, 'itemba.desktop.device.' + userId),
        revision: 0,
      };
    } catch {
      identity.current = { id: crypto.randomUUID(), deviceId: crypto.randomUUID(), revision: 0 };
    }
    setSessionId(identity.current.id);
    const controller = new AbortController();
    backendGet<SavedDesktopSession[]>('/workspace/sessions', { signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted || generation !== epoch.current) return;
        loaded.current = true;
        setSavedSessions(rows);
        const own = rows.find((row) => row.id === identity.current.id);
        const previous = own ?? rows.find((row) => row.deviceId === identity.current.deviceId);
        identity.current.revision = own?.revision ?? 0;
        const layout = parseDesktopSession(previous?.layout);
        saved.current = own ? serialise(layout) : '';
        setSession(layout);
        setReady(true);
        setStatus(own ? 'Workspace saved' : 'Workspace ready');
      })
      .catch(() => {
        if (controller.signal.aborted || generation !== epoch.current) return;
        setReady(true);
        blocked.current = true;
        setRecovery('connection');
        setStatus('Saved workspace unavailable. Your open windows stay on this device.');
      });
    return () => {
      controller.abort();
      epoch.current = generation + 1;
      pending.current = null;
    };
  }, [userId]);
  const flush = useCallback(async () => {
    if (sending.current || !loaded.current || blocked.current) return;
    const generation = epoch.current;
    const ownerSession = { ...identity.current };
    sending.current = true;
    try {
      while (pending.current && generation === epoch.current) {
        const layout = parseDesktopSession(pending.current);
        const attempted = pending.current;
        if (serialise(layout) === saved.current) {
          pending.current = null;
          continue;
        }
        setStatus('Saving workspace…');
        let result: SavedDesktopSession | undefined;
        try {
          result = await backendPut<SavedDesktopSession>('/workspace/sessions/' + ownerSession.id, {
            deviceId: ownerSession.deviceId,
            name: (/Mobi|Android/i.test(navigator.userAgent) ? 'Mobile' : 'Desktop') + ' workspace',
            layout,
            expectedRevision: identity.current.revision,
          });
        } catch (error) {
          if (generation !== epoch.current) return;
          let remote: SavedDesktopSession | undefined;
          try {
            const rows = await backendGet<SavedDesktopSession[]>('/workspace/sessions');
            if (generation !== epoch.current) return;
            setSavedSessions(rows);
            remote = rows.find((row) => row.id === ownerSession.id);
          } catch {
            /* Keep the acknowledged copy and unsynced layout intact. */
            remote = undefined;
          }
          if (generation !== epoch.current) return;
          if (remote && serialise(remote.layout) === serialise(layout)) result = remote;
          else {
            blocked.current = true;
            const conflict =
              (error instanceof ApiError && error.status === 409) ||
              (remote && remote.revision !== identity.current.revision);
            setRecovery(conflict ? 'conflict' : 'connection');
            setStatus(
              conflict
                ? 'This workspace changed in another tab. Choose which layout to keep.'
                : 'Workspace not synced. Your open windows are still available.',
            );
            return;
          }
        }
        if (generation !== epoch.current) return;
        identity.current.revision = result.revision;
        saved.current = serialise(layout);
        if (pending.current === attempted) pending.current = null;
        const acknowledged = result;
        setSavedSessions((rows) => [
          acknowledged,
          ...rows.filter((row) => row.id !== acknowledged.id),
        ]);
        setRecovery(null);
        setStatus('Workspace saved');
      }
    } finally {
      if (generation === epoch.current) sending.current = false;
    }
  }, []);
  const recover = useCallback(
    async (choice: 'saved' | 'keep' | 'retry') => {
      if (sending.current) return;
      const generation = epoch.current;
      sending.current = true;
      setRecovering(true);
      setStatus('Checking your saved workspace…');
      try {
        const rows = await backendGet<SavedDesktopSession[]>('/workspace/sessions');
        if (generation !== epoch.current) return;
        setSavedSessions(rows);
        const own = rows.find((row) => row.id === identity.current.id);
        const previous =
          own ??
          (!loaded.current
            ? rows.find((row) => row.deviceId === identity.current.deviceId)
            : undefined);
        const layout = parseDesktopSession(previous?.layout);
        if (
          choice === 'retry' &&
          pending.current &&
          previous &&
          (!loaded.current || (own?.revision ?? 0) !== identity.current.revision) &&
          serialise(layout) !== serialise(pending.current)
        ) {
          blocked.current = true;
          setRecovery('conflict');
          setStatus('A different layout is saved. Choose which workspace to keep.');
          return;
        }
        loaded.current = true;
        identity.current.revision = own?.revision ?? 0;
        saved.current = own ? serialise(own.layout) : '';
        blocked.current = false;
        setRecovery(null);
        if (
          choice === 'saved' ||
          !pending.current ||
          serialise(layout) === serialise(pending.current)
        ) {
          pending.current = null;
          setSession(layout);
          setStatus(own ? 'Workspace saved' : 'Workspace ready');
        }
      } catch {
        if (generation === epoch.current) {
          blocked.current = true;
          setRecovery('connection');
          setStatus('Could not reach your saved workspace. Try again when connected.');
        }
      } finally {
        if (generation === epoch.current) {
          sending.current = false;
          setRecovering(false);
          void flush();
        }
      }
    },
    [flush],
  );
  useEffect(() => {
    const online = () => {
      if (!blocked.current) void flush();
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flush]);
  useEffect(() => {
    if (!ready) return;
    pending.current = session;
    if (!blocked.current) {
      if (serialise(session) !== saved.current) setStatus('Saving workspace…');
      else if (!sending.current) setStatus('Workspace saved');
    }
    const timer = setTimeout(() => void flush(), 900);
    return () => clearTimeout(timer);
  }, [ready, session, flush]);
  return {
    session,
    setSession,
    ready,
    savedSessions,
    status,
    recovery,
    recovering,
    recover,
    sessionId,
  };
}

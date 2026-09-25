'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ApiError, backendGet, backendPut } from '@/lib/api-client';
import { DEFAULT_APPEARANCE, parseAppearance, type DesktopAppearance } from '@/lib/desktop';
import { readWorkspace } from '@/lib/workspace-preferences';
import { useTheme } from '@/hooks/use-theme';
import { useMotionPreference } from '@/hooks/use-motion-preference';

type Profile = { desktop?: unknown; desktopRevision?: number; theme?: string };
export type AppearanceRecovery = 'conflict' | 'connection' | null;
export function useDesktopProfile(userId: string) {
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading your desktop…');
  const [recovery, setRecovery] = useState<AppearanceRecovery>(null);
  const [recovering, setRecovering] = useState(false);
  const revision = useRef(0),
    saving = useRef(false),
    loaded = useRef(false);
  const blocked = useRef(false),
    epoch = useRef(0);
  const appearanceRef = useRef(appearance);
  const pending = useRef<DesktopAppearance | null>(null);
  const { setMode } = useTheme();
  const { setMode: setMotionMode } = useMotionPreference();
  useLayoutEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);
  const applyProfile = useCallback((next: DesktopAppearance) => {
    appearanceRef.current = next;
    setAppearance(next);
  }, []);
  useEffect(() => {
    const generation = ++epoch.current;
    const controller = new AbortController();
    revision.current = 0;
    loaded.current = false;
    saving.current = false;
    blocked.current = false;
    pending.current = null;
    setReady(false);
    setRecovery(null);
    setRecovering(false);
    applyProfile(DEFAULT_APPEARANCE);
    setStatus('Loading your desktop…');
    backendGet<Profile>('/user-preferences/me', { signal: controller.signal })
      .then((profile) => {
        if (controller.signal.aborted || generation !== epoch.current) return;
        revision.current = profile.desktopRevision ?? 0;
        loaded.current = true;
        const existing = readWorkspace(userId);
        const imported = {
          ...DEFAULT_APPEARANCE,
          mode: profile.theme ?? 'system',
          density: existing.density,
          transparency: existing.transparency,
          theme:
            existing.backdrop === 'graphite'
              ? 'graphite'
              : existing.backdrop === 'mist'
                ? 'pearl'
                : 'dune',
        };
        const next = parseAppearance(profile.desktop ?? imported);
        applyProfile(next);
        setReady(true);
        setStatus('Synced to your account');
        if (!profile.desktop) pending.current = next;
      })
      .catch(() => {
        if (controller.signal.aborted || generation !== epoch.current) return;
        setReady(true);
        blocked.current = true;
        setRecovery('connection');
        setStatus('Your appearance could not be loaded. Changes are kept in this window.');
      });
    return () => {
      controller.abort();
      epoch.current = generation + 1;
      pending.current = null;
    };
  }, [userId, applyProfile]);
  useEffect(() => {
    if (!ready) return;
    setMode(appearance.mode);
    setMotionMode(appearance.motion);
  }, [ready, appearance.mode, appearance.motion, setMode, setMotionMode]);

  const flush = useCallback(async () => {
    if (saving.current || blocked.current || !pending.current || !loaded.current) return;
    const generation = epoch.current;
    saving.current = true;
    try {
      while (pending.current && generation === epoch.current) {
        const value: DesktopAppearance = pending.current;
        setStatus('Saving appearance…');
        let acknowledged: number;
        try {
          const result = await backendPut<{ desktopRevision: number }>('/user-preferences/me', {
            desktop: value,
            expectedDesktopRevision: revision.current,
            theme: value.mode,
            density: value.density,
          });
          acknowledged = result.desktopRevision;
        } catch (error) {
          if (generation !== epoch.current) return;
          // A lost response may follow a successful save. Reconcile before treating it as a conflict.
          let current: Profile | undefined;
          if (!(error instanceof ApiError) || error.status === 409 || error.status >= 500) {
            try {
              current = await backendGet<Profile>('/user-preferences/me');
            } catch {
              // The recovery message below keeps the unsynced preview available.
              current = undefined;
            }
          }
          if (generation !== epoch.current) return;
          if (
            current?.desktop &&
            JSON.stringify(parseAppearance(current.desktop)) === JSON.stringify(value)
          ) {
            acknowledged = current.desktopRevision ?? 0;
          } else {
            blocked.current = true;
            const conflict =
              (error instanceof ApiError && error.status === 409) ||
              (current && current.desktopRevision !== revision.current);
            setRecovery(conflict ? 'conflict' : 'connection');
            setStatus(
              conflict
                ? 'Appearance changed in another session. Choose which version to use.'
                : 'Appearance is not synced. Your changes are kept in this window.',
            );
            return;
          }
        }
        if (generation !== epoch.current) return;
        revision.current = acknowledged;
        if (pending.current === value) pending.current = null;
        setRecovery(null);
        setStatus('Synced to your account');
      }
    } finally {
      if (generation === epoch.current) saving.current = false;
    }
  }, []);

  const recover = useCallback(
    async (choice: 'saved' | 'keep' | 'retry') => {
      if (saving.current) return;
      const generation = epoch.current;
      saving.current = true;
      setRecovering(true);
      setStatus('Checking your saved appearance…');
      try {
        const profile = await backendGet<Profile>('/user-preferences/me');
        if (generation !== epoch.current) return;
        const saved = parseAppearance(profile.desktop ?? DEFAULT_APPEARANCE);
        // Retry never silently replaces a newer account profile.
        if (
          choice === 'retry' &&
          pending.current &&
          ((profile.desktopRevision ?? 0) !== revision.current || !loaded.current) &&
          JSON.stringify(saved) !== JSON.stringify(pending.current)
        ) {
          blocked.current = true;
          setRecovery('conflict');
          setStatus('Your account has a different appearance. Choose which version to use.');
          return;
        }
        revision.current = profile.desktopRevision ?? 0;
        loaded.current = true;
        blocked.current = false;
        setRecovery(null);
        if (
          choice === 'saved' ||
          !pending.current ||
          JSON.stringify(saved) === JSON.stringify(pending.current)
        ) {
          pending.current = null;
          applyProfile(saved);
          setStatus('Synced to your account');
        } else {
          pending.current = appearanceRef.current;
        }
      } catch {
        if (generation === epoch.current) {
          blocked.current = true;
          setRecovery('connection');
          setStatus('Could not reach your account. Your current appearance is still available.');
        }
      } finally {
        if (generation === epoch.current) {
          saving.current = false;
          setRecovering(false);
          void flush();
        }
      }
    },
    [applyProfile, flush],
  );

  useEffect(() => {
    const online = () => {
      if (blocked.current) return;
      void flush();
    };
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, [flush]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void flush(), 700);
    return () => clearTimeout(timer);
  }, [appearance, ready, flush]);

  function update(change: (current: DesktopAppearance) => DesktopAppearance) {
    const current = appearanceRef.current,
      next = parseAppearance(change(current));
    if (JSON.stringify(current) === JSON.stringify(next)) return;
    appearanceRef.current = next;
    pending.current = next;
    const apply = () => setAppearance(next);
    const transition = (
      document as Document & {
        startViewTransition?: (update: () => void) => { finished: Promise<void> };
      }
    ).startViewTransition;
    if (
      transition &&
      (current.mode !== next.mode || current.theme !== next.theme) &&
      next.motion !== 'reduced' &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      void transition.call(document, () => flushSync(apply)).finished.catch(apply);
    } else apply();
  }
  return { appearance, update, ready, status, recovery, recovering, recover };
}

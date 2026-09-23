'use client';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { backendGet, backendPut } from '@/lib/api-client';
import { DEFAULT_APPEARANCE, parseAppearance, type DesktopAppearance } from '@/lib/desktop';
import { readWorkspace } from '@/lib/workspace-preferences';
import { useTheme } from '@/hooks/use-theme';
import { useMotionPreference } from '@/hooks/use-motion-preference';
export function useDesktopProfile(userId: string) {
  const [appearance, setAppearance] = useState(DEFAULT_APPEARANCE);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState('Loading your desktop…');
  const revision = useRef(0),
    saving = useRef(false),
    loaded = useRef(false);
  const appearanceRef = useRef(appearance);
  useLayoutEffect(() => {
    appearanceRef.current = appearance;
  }, [appearance]);
  const pending = useRef<DesktopAppearance | null>(null);
  const mounted = useRef(true);
  const { setMode } = useTheme();
  const { setMode: setMotionMode } = useMotionPreference();
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    backendGet<{ desktop?: unknown; desktopRevision?: number; theme?: string }>(
      '/user-preferences/me',
      { signal: controller.signal },
    )
      .then((profile) => {
        if (controller.signal.aborted) return;
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
        setAppearance(next);
        setReady(true);
        setStatus('Synced to your account');
        if (!profile.desktop) pending.current = next;
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setReady(true);
          setStatus('Settings unavailable · changes stay in this session');
        }
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, [userId]);
  useEffect(() => {
    if (!ready) return;
    setMode(appearance.mode);
    setMotionMode(appearance.motion);
  }, [ready, appearance.mode, appearance.motion, setMode, setMotionMode]);
  const flush = useCallback(async () => {
    if (saving.current || !pending.current || !loaded.current) return;
    saving.current = true;
    try {
      while (pending.current && mounted.current) {
        const value: DesktopAppearance = pending.current;
        setStatus('Saving appearance…');
        const result = await backendPut<{ desktopRevision: number }>('/user-preferences/me', {
          desktop: value,
          expectedDesktopRevision: revision.current,
          theme: value.mode,
          density: value.density,
        });
        revision.current = result.desktopRevision;
        if (pending.current === value) pending.current = null;
        if (mounted.current) setStatus('Synced to your account');
      }
    } catch (error) {
      if (mounted.current)
        setStatus(
          error instanceof Error
            ? `Not synced · ${error.message}`
            : 'Not synced · check your connection',
        );
    } finally {
      saving.current = false;
    }
  }, []);
  useEffect(() => {
    const online = () => void flush();
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
      void transition
        .call(document, () => flushSync(apply))
        .finished.catch(() => {
          apply();
        });
    } else apply();
  }
  return { appearance, update, ready, status };
}

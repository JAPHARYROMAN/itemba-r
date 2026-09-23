'use client';

import { useCallback, useEffect, useState } from 'react';
import { safeLocalStorageSet } from '@/lib/safe-storage';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Storage key read by the no-flash boot script in app/layout.tsx — the two
 * must stay in sync so the theme applied before hydration matches the one
 * this hook manages after it.
 */
const THEME_KEY = 'aurora-theme';
const THEME_CHANGED = 'itemba-theme-changed';

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function applyMode(mode: ThemeMode) {
  const dark = mode === 'dark' || (mode === 'system' && systemPrefersDark());
  document.documentElement.classList.toggle('dark', dark);
}

/**
 * Theme state for the whole app. Provider-less by design: state lives in
 * localStorage + the <html> class, so any number of consumers stay consistent
 * via the storage event (cross-tab) and matchMedia listener (system mode).
 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setModeState(readStoredMode());
    setHydrated(true);
  }, []);

  // Follow OS changes while in system mode.
  useEffect(() => {
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyMode('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  // Stay in sync when another tab changes the theme.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== THEME_KEY) return;
      const next = readStoredMode();
      setModeState(next);
      applyMode(next);
    };
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<ThemeMode>).detail;
      setModeState(next);
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(THEME_CHANGED, onChange);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(THEME_CHANGED, onChange);
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    // Best-effort persist (private mode etc.) — the theme still applies this session.
    safeLocalStorageSet(THEME_KEY, next);
    applyMode(next);
    window.dispatchEvent(new CustomEvent(THEME_CHANGED, { detail: next }));
  }, []);

  return { mode, setMode, hydrated };
}

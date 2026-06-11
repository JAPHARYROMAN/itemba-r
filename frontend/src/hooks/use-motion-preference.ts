'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  applyMotionPreference,
  getStoredMotionPreference,
  setStoredMotionPreference,
  type MotionMode,
} from '@/lib/design-system/theme';

export function useMotionPreference() {
  const [mode, setModeState] = useState<MotionMode>('system');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const stored = getStoredMotionPreference();
    setModeState(stored);
    applyMotionPreference(stored);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (mode !== 'system') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => applyMotionPreference('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [mode]);

  const setMode = useCallback((next: MotionMode) => {
    setModeState(next);
    setStoredMotionPreference(next);
    applyMotionPreference(next);
  }, []);

  return { mode, setMode, hydrated };
}

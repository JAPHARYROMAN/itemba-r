'use client';
import { useCallback, useEffect, useRef } from 'react';

/** Only the latest mounted request may commit a result after a filter/scope change. */
export function useRequestGuard() {
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  return useCallback(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    return { signal: controller.signal, current: () => !controller.signal.aborted };
  }, []);
}

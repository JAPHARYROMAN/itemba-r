'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useUnsavedWork, useUnsavedWorkScope } from '@/components/workspace/unsaved-work-provider';
import { usePosHost } from './pos-host-context';

/** Unsynchronised counter inputs stay in memory; closing a hosted terminal must be explicit. */
export function usePosWindowGuard(dirty: boolean) {
  const host = usePosHost();
  const { register } = useUnsavedWork();
  const scope = useUnsavedWorkScope();
  const state = useRef(false);
  const id = useRef(Symbol('pos-counter'));
  useLayoutEffect(() => {
    state.current = !!host && dirty;
  }, [host, dirty]);
  useEffect(
    () =>
      register(id.current, {
        scope,
        dirty: () => state.current,
        reset: () => {
          state.current = false;
        },
      }),
    [register, scope],
  );
}

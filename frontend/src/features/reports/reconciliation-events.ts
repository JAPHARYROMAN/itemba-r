'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { MatchingResult } from './reconciliation-types';
const EVENT = 'itemba:statement-matched';
export function publishMatching(id: string, result: MatchingResult) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { id, result } }));
}
/** Transient matching suggestions for an open detail view; never persisted or replayed. */
export function useMatchingResult(id: string, receive: (result: MatchingResult) => void) {
  const current = useRef({ id, receive });
  useLayoutEffect(() => {
    current.current = { id, receive };
  });
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; result: MatchingResult }>).detail;
      if (detail.id === current.current.id) current.current.receive(detail.result);
    };
    window.addEventListener(EVENT, listener);
    return () => window.removeEventListener(EVENT, listener);
  }, []);
}

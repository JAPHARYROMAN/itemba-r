'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';

type Desk = 'invoice-desk' | 'cash-desk' | 'sales-desk';
const EVENT = 'itemba:desk-saved';

/** In-tab invalidation only: every receiver refetches through its authorised endpoints. */
export function notifyDeskSaved(source: Desk) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: source }));
}

export function useLinkedDeskChanges(source: Desk, editing: boolean, refresh: () => void) {
  const current = useRef({ editing, refresh });
  const pending = useRef(false);
  useLayoutEffect(() => {
    current.current = { editing, refresh };
  });
  useEffect(() => {
    const onSaved = (event: Event) => {
      if ((event as CustomEvent<Desk>).detail === source) return;
      if (current.current.editing) pending.current = true;
      else current.current.refresh();
    };
    window.addEventListener(EVENT, onSaved);
    return () => window.removeEventListener(EVENT, onSaved);
  }, [source]);
  useEffect(() => {
    if (!editing && pending.current) {
      pending.current = false;
      current.current.refresh();
    }
  }, [editing]);
}

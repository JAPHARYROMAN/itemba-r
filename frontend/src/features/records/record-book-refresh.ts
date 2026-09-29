'use client';
import { useEffect, useLayoutEffect, useRef } from 'react';
const event = 'itemba:record-book-changed';
export function notifyRecordBookChanged() {
  window.dispatchEvent(new Event(event));
}
/** A sibling window may save while this window is editing. Defer its refresh. */
export function useRecordBookRefresh(reload: () => unknown, editing = false) {
  const current = useRef({ reload, editing });
  const pending = useRef(false);
  useLayoutEffect(() => {
    current.current = { reload, editing };
  });
  useEffect(() => {
    const refresh = () => {
      if (current.current.editing) pending.current = true;
      else void current.current.reload();
    };
    window.addEventListener(event, refresh);
    return () => window.removeEventListener(event, refresh);
  }, []);
  useEffect(() => {
    if (!editing && pending.current) {
      pending.current = false;
      void current.current.reload();
    }
  }, [editing]);
}

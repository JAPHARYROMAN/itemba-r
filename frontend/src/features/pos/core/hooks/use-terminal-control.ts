'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { claimTerminalControl } from '../terminal-control';

export function useTerminalControl(terminal: string | undefined, enabled: boolean) {
  const [owned, setOwned] = useState(false);
  const release = useRef<(() => void) | null>(null);
  const request = useCallback(() => {
    release.current?.();
    if (terminal && enabled) release.current = claimTerminalControl(terminal, setOwned);
  }, [terminal, enabled]);
  useEffect(() => {
    request();
    return () => {
      release.current?.();
      release.current = null;
    };
  }, [request]);
  return {
    owned: !enabled || owned,
    request,
    release: () => {
      release.current?.();
      release.current = null;
      setOwned(false);
    },
  };
}

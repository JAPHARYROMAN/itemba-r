'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from its previous value to `target` with an ease-out curve.
 * Honors prefers-reduced-motion (jumps straight to the value) and non-finite
 * targets. Presentational only — no effect on the value passed in by callers.
 */
export function useCountUp(target: number, durationMs = 800): number {
  const [value, setValue] = useState(target);
  const frame = useRef<number | null>(null);
  const fromRef = useRef(target);

  useEffect(() => {
    if (typeof window === 'undefined' || !Number.isFinite(target)) {
      setValue(target);
      return;
    }
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      setValue(target);
      fromRef.current = target;
      return;
    }

    const from = fromRef.current;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setValue(from + (target - from) * eased);
      if (t < 1) {
        frame.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };
    frame.current = requestAnimationFrame(tick);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [target, durationMs]);

  return value;
}

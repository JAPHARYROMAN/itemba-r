'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Where the new POS is in a sale, kept in the URL hash so the phone's hardware
 * back button behaves like Kaunta's (KAUNTA-5/6/8):
 *   - back from pay returns to the sale with the cart intact;
 *   - done replaces pay in history, so back from done lands on sale (and the
 *     shell starts a fresh one);
 *   - a cold boot never resumes mid-flow: pay/done normalise to sale, because
 *     the cart lives in memory and cannot survive a reload.
 * Only `#pos/...` hashes are ours; anything else (e.g. a Kaunta module hash
 * while the Kaunta bridge is open) is left alone.
 */
export type PosStep = 'sale' | 'pay' | 'done' | 'queue';

const PREFIX = '#pos/';
const STEPS: readonly PosStep[] = ['sale', 'pay', 'done', 'queue'];

function stepFromHash(hash: string): PosStep | null {
  if (!hash.startsWith(PREFIX)) return null;
  const candidate = hash.slice(PREFIX.length) as PosStep;
  return STEPS.includes(candidate) ? candidate : null;
}

export function usePosStep() {
  const [step, setStep] = useState<PosStep>('sale');

  useEffect(() => {
    const initial = stepFromHash(window.location.hash);
    const boot: PosStep = initial === 'queue' ? 'queue' : 'sale';
    window.history.replaceState(window.history.state, '', `${PREFIX}${boot}`);
    setStep(boot);
    const onPop = () => {
      const next = stepFromHash(window.location.hash);
      if (next) setStep(next);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next: PosStep, options: { replace?: boolean } = {}) => {
    const url = `${PREFIX}${next}`;
    if (window.location.hash !== url) {
      if (options.replace) window.history.replaceState(window.history.state, '', url);
      else window.history.pushState(window.history.state, '', url);
    }
    setStep(next);
  }, []);

  return { step, go };
}

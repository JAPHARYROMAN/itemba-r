'use client';

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';
import { useMotionPreference } from '@/hooks/use-motion-preference';

/** One motion policy for the desktop, including the explicit app preference. */
export function OsMotion({ children }: { children: ReactNode }) {
  const { mode } = useMotionPreference();
  return (
    <MotionConfig
      reducedMotion={mode === 'reduced' ? 'always' : mode === 'full' ? 'never' : 'user'}
      transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
    >
      {children}
    </MotionConfig>
  );
}

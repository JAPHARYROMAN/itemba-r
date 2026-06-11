'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

export function RouteProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(true);
    const timer = window.setTimeout(() => setActive(false), 650);
    return () => window.clearTimeout(timer);
  }, [pathname]);

  return (
    <div
      aria-hidden
      className={`fixed left-0 right-0 top-0 z-command h-0.5 overflow-hidden transition-opacity duration-200 ${
        active ? 'opacity-100' : 'opacity-0'
      }`}
    >
      <div
        className="h-full w-1/2 animate-route-progress rounded-full"
        style={{
          background: 'linear-gradient(90deg, var(--aurora-primary), var(--aurora-accent))',
          boxShadow: 'var(--aurora-glow-primary)',
        }}
      />
    </div>
  );
}

'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/**
 * Routes with an inline enquiry form, where the bar would only repeat it.
 * The same matrix as origin/main's floating QuickContact (the baseline
 * records it per route; tests/e2e/quick-contact.spec.ts holds it).
 */
export function hasInlineEnquiry(pathname: string) {
  return (
    pathname === '/contact' ||
    pathname === '/company-profile' ||
    pathname === '/capabilities' ||
    pathname === '/partnerships' ||
    pathname === '/faq' ||
    pathname.startsWith('/companies/') ||
    pathname.startsWith('/services/') ||
    pathname.startsWith('/locations/') ||
    pathname.startsWith('/insights/')
  );
}

/**
 * The quick-contact bar's only script: it shows the bar (server markup,
 * src/shell/QuickContactBar.tsx, passed in as children) on every route
 * without an inline enquiry form, following client-side navigation. The
 * bar itself, its icons and its contact hrefs stay server-rendered, so
 * this island is the pathname check alone.
 */
export default function QuickContact({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/';
  if (hasInlineEnquiry(pathname)) return null;
  return <>{children}</>;
}

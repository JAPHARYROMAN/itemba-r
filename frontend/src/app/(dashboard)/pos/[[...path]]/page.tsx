'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { DesktopAppHost } from '@/components/os/desktop-app-host';
import { useGuardedRouter } from '@/components/workspace/unsaved-work-provider';

/** Canonical links also work when the desktop rollout is disabled. */
export default function PosPage() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useGuardedRouter();
  const href = `${pathname}${params.size ? `?${params}` : ''}`;
  return <DesktopAppHost appId="pos" href={href} onHrefChange={(next) => router.replace(next)} />;
}

'use client';
import { usePathname, useSearchParams } from 'next/navigation';
import { DesktopAppHost } from '@/components/os/desktop-app-host';
import { useGuardedRouter } from '@/components/workspace/unsaved-work-provider';

export default function PosDraftPage() {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useGuardedRouter();
  const href = `${pathname}${params.size ? `?${params}` : ''}`;
  return (
    <DesktopAppHost appId="pos-draft" href={href} onHrefChange={(next) => router.replace(next)} />
  );
}

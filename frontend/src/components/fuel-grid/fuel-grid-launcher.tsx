'use client';
import { AppLauncher } from '@/components/apps/app-launcher';
import { getApp } from '@/lib/apps';

/** Legacy route remains a stable link into the shared app launcher. */
export function FuelGridLauncher(props: { appUrl: string | null; onBack?: () => void }) {
  return <AppLauncher app={getApp('fuel-grid')!} {...props} />;
}

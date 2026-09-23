import { notFound } from 'next/navigation';
import { getApp } from '@/lib/apps';
import { getAppConnection } from '@/lib/app-connections';
import { AppLauncher } from '@/components/apps/app-launcher';

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const app = getApp((await params).appId);
  if (!app || app.launch.kind !== 'external') notFound();
  return <AppLauncher app={app} appUrl={getAppConnection(app).appUrl} />;
}

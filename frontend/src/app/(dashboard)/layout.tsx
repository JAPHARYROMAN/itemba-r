import DashboardClientLayout from '@/components/os/dashboard-layout';
import { getAppUrls } from '@/lib/app-connections';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardClientLayout appUrls={getAppUrls()}>{children}</DashboardClientLayout>;
}

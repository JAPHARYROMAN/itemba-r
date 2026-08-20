import { FuelGridLauncher } from '@/components/fuel-grid/fuel-grid-launcher';
import { getFuelGridConfig } from '@/lib/fuel-grid';

export const dynamic = 'force-dynamic';

export default function FuelGridPage() {
  const { appUrl } = getFuelGridConfig();
  return <FuelGridLauncher appUrl={appUrl} />;
}

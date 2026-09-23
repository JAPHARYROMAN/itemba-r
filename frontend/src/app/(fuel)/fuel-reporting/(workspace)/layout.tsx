import { FuelAccess } from '@/components/fuel-reporting/fuel-access';

export default function FuelWorkspaceLayout({ children }: { children: React.ReactNode }) {
  return <FuelAccess>{children}</FuelAccess>;
}

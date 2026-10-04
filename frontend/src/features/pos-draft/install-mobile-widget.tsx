'use client';
import { Smartphone, ArrowUpRight } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
export function InstallMobileWidget({ open }: { open: () => void }) {
  const { hasPermission } = useAuth();
  if (!hasPermission('mobile_pos_onboarding.manage')) return null;
  return (
    <section className="desktop-widget desktop-widget-compact pd-desktop-install">
      <header>
        <Smartphone size={17} />
        <h2>Install Mobile POS</h2>
      </header>
      <p>Connect a phone to its branch. Approve cashier or stockist access.</p>
      <button onClick={open}>
        <span>Set up mobile devices</span>
        <ArrowUpRight size={15} />
      </button>
    </section>
  );
}

import type { Metadata } from 'next';
import { ArrowUpRight, Fuel } from 'lucide-react';
import '@/components/fuel-reporting/fuel-portal.css';

export const metadata: Metadata = {
  title: 'Fuel Reporting | Station operations',
  description: 'Daily shift reports, fuel receipts, and branch performance.',
};

export default function FuelPortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fuel-portal">
      <a className="fp-skip" href="#fuel-workspace">
        Skip to content
      </a>
      <header className="fp-topbar">
        <a className="fp-brand" href="/fuel-reporting" aria-label="Fuel Reporting home">
          <span className="fp-brand-icon">
            <Fuel size={22} aria-hidden="true" />
          </span>
          <span>
            Fuel Reporting<small>STATION OPERATIONS</small>
          </span>
        </a>
        <a className="fp-itemba" href="/dashboard">
          Open Itemba <ArrowUpRight size={16} aria-hidden="true" />
        </a>
      </header>
      <div id="fuel-workspace" className="fp-workspace" tabIndex={-1}>
        {children}
      </div>
      <footer className="fp-footer">
        <span>Fuel Reporting</span>
        <span>Connected to Itemba · Your station, every shift.</span>
      </footer>
    </div>
  );
}

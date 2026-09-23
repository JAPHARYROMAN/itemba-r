import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ComplianceDashboard from '@/app/(dashboard)/compliance/page';
import ComplianceCalendar from '@/app/(dashboard)/compliance/calendar/page';
import ComplianceCockpit from '@/app/(dashboard)/compliance/cockpit/page';
import DocumentRequirements from '@/app/(dashboard)/compliance/document-requirements/page';
import DocumentStatus from '@/app/(dashboard)/compliance/document-status/page';
import ComplianceEvents from '@/app/(dashboard)/compliance/events/page';
import EvidencePacks from '@/app/(dashboard)/compliance/evidence-packs/page';
import ComplianceExports from '@/app/(dashboard)/compliance/exports/page';
import Obligations from '@/app/(dashboard)/compliance/obligations/page';
import OshaRegistrations from '@/app/(dashboard)/compliance/osha-registrations/page';
import StatutoryRules from '@/app/(dashboard)/compliance/statutory-rules/page';
import TaxAuthorities from '@/app/(dashboard)/compliance/tax-authorities/page';
import TaxCodes from '@/app/(dashboard)/compliance/tax-codes/page';
import TaxFilingPeriods from '@/app/(dashboard)/compliance/tax-filing-periods/page';
import TaxRates from '@/app/(dashboard)/compliance/tax-rates/page';
import TaxRegistrations from '@/app/(dashboard)/compliance/tax-registrations/page';
import TaxReturns from '@/app/(dashboard)/compliance/tax-returns/page';
import TaxTransactions from '@/app/(dashboard)/compliance/tax-transactions/page';
import TaxTypes from '@/app/(dashboard)/compliance/tax-types/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));

const routes: Array<{ name: string; Page: () => JSX.Element | null }> = [
  { name: 'dashboard', Page: ComplianceDashboard },
  { name: 'calendar', Page: ComplianceCalendar },
  { name: 'cockpit', Page: ComplianceCockpit },
  { name: 'document requirements', Page: DocumentRequirements },
  { name: 'document status', Page: DocumentStatus },
  { name: 'events', Page: ComplianceEvents },
  { name: 'evidence packs', Page: EvidencePacks },
  { name: 'exports', Page: ComplianceExports },
  { name: 'obligations', Page: Obligations },
  { name: 'osha registrations', Page: OshaRegistrations },
  { name: 'statutory rules', Page: StatutoryRules },
  { name: 'tax authorities', Page: TaxAuthorities },
  { name: 'tax codes', Page: TaxCodes },
  { name: 'filing periods', Page: TaxFilingPeriods },
  { name: 'tax rates', Page: TaxRates },
  { name: 'tax registrations', Page: TaxRegistrations },
  { name: 'tax returns', Page: TaxReturns },
  { name: 'tax transactions', Page: TaxTransactions },
  { name: 'tax types', Page: TaxTypes },
];

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('compliance route gates', () => {
  it.each(routes)('does not read $name without its view permission', ({ Page }) => {
    render(<Page />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it('retries a failed compliance dashboard load', async () => {
    state.permissions = new Set(['compliance.dashboard.view']);
    state.fetch.mockRejectedValue(new Error('Compliance offline'));
    const user = userEvent.setup();
    render(<ComplianceDashboard />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Compliance offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries a failed tax-authority load', async () => {
    state.permissions = new Set(['tax_authorities.view']);
    state.fetch.mockRejectedValue(new Error('Authorities offline'));
    const user = userEvent.setup();
    render(<TaxAuthorities />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByText('Authorities offline')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.fetch).toHaveBeenCalledTimes(2);
  });
});

import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PeopleHub } from './people-hub';
import { peopleDestinations, type PeopleDashboard } from './people-hub-types';
const state = vi.hoisted(() => ({ permissions: new Set<string>(), get: vi.fn(), page: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPage: state.page }));
const fixture: PeopleDashboard = {
  workforce: { total: 25, active: 20, onLeave: 3, suspended: 2, activeRate: 80 },
  contracts: { active: 18, expiringWithin30Days: 4 },
  leave: { pendingApproval: 5, approved: 7 },
  payroll: {
    openPeriods: 2,
    runsInFlight: 3,
    paidRunsThisMonth: 1,
    grossPayThisMonth: 10000000,
    deductionsThisMonth: 2000000,
    netPayThisMonth: 8000000,
  },
  attendance: {
    scheduledShiftsToday: 20,
    presentToday: 16,
    absentToday: 2,
    lateToday: 1,
    attendanceCaptureRate: 95,
  },
  compliance: {
    totalHrDocuments: 14,
    expiringMedicalExams: 6,
    openDisputes: 2,
    activeDisciplinaryActions: 1,
  },
  employeesByCompany: [
    { companyId: 'company', company: 'Example Company', code: 'EXAMPLE', count: 20 },
  ],
  recentEmployees: [
    {
      id: 'employee',
      employeeCode: 'EXAMPLE-01',
      fullName: 'Alex Example',
      employmentStatus: 'ACTIVE',
    },
  ],
  upcomingContractExpiries: [
    {
      id: 'contract',
      contractCode: 'CONTRACT-EXAMPLE',
      employeeId: 'employee',
      contractType: 'FIXED_TERM',
      endDate: '2026-09-30',
      status: 'ACTIVE',
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'hr.dashboard.view',
    'companies.read',
    ...peopleDestinations.map((d) => d.permission),
  ]);
  state.get.mockResolvedValue(fixture);
  state.page.mockResolvedValue({
    data: [
      { id: 'company', name: 'Example Company' },
      { id: 'other', name: 'Other Company' },
    ],
    total: 2,
  });
});
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  const clone = document.body.cloneNode(true) as HTMLElement;
  document.querySelectorAll('select').forEach((s, i) => {
    Array.from(clone.querySelectorAll('select')[i].options).forEach((o) => {
      if (o.value === s.value) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    });
  });
  writeFileSync(join(dir, name + '.html'), clone.innerHTML);
}
describe('People hub', () => {
  it('denies the overview without making data or choice requests', () => {
    state.permissions.clear();
    render(<PeopleHub />);
    expect(screen.getByText('Your role cannot view the People overview.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
  });
  it('retains dashboard aggregates but hides employee details and unrelated navigation without their permissions', async () => {
    state.permissions = new Set(['hr.dashboard.view']);
    render(<PeopleHub />);
    expect(await screen.findByRole('region', { name: 'Workforce' })).toHaveTextContent(
      'Active employees20',
    );
    expect(
      screen.queryByRole('region', { name: 'Recently added employees' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Upcoming contract expiries')).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'People workspaces' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(state.page).not.toHaveBeenCalled();
  });
  it('groups the real workforce, attention, attendance and paid-payroll metrics and preserves navigation', async () => {
    render(<PeopleHub />);
    await screen.findByRole('region', { name: 'Workforce' });
    expect(screen.getByRole('region', { name: 'Workforce' })).toHaveTextContent('80% active');
    expect(screen.getByRole('region', { name: 'Attention' })).toHaveTextContent(
      'Medical exams expiringWithin the next 30 days6',
    );
    expect(screen.getByRole('region', { name: 'Attendance today' })).toHaveTextContent(
      'Capture rate95%',
    );
    const payroll = screen.getByRole('region', { name: 'Payroll this month' });
    expect(payroll).toHaveTextContent('Net payTZS 8,000,000.00');
    expect(payroll).toHaveTextContent('Gross payTZS 10,000,000.00');
    expect(payroll).toHaveTextContent('DeductionsTZS 2,000,000.00');
    expect(screen.getByRole('region', { name: 'Employment records' })).toHaveTextContent(
      'Active contracts18',
    );
    expect(screen.getByRole('region', { name: 'Active employees by company' })).toHaveTextContent(
      'Example CompanyEXAMPLE20',
    );
    expect(screen.getByRole('link', { name: /Alex Example/ })).toHaveAttribute(
      'href',
      '/hr/employees/employee',
    );
    const workspaces = screen.getByRole('navigation', { name: 'People workspaces' });
    for (const destination of peopleDestinations)
      expect(
        within(workspaces).getByRole('link', { name: new RegExp(destination.label) }),
      ).toHaveAttribute('href', destination.href);
    capture('people-hub');
    await userEvent.click(screen.getByText('Upcoming contract expiries'));
    expect(screen.getByText('CONTRACT-EXAMPLE')).toBeVisible();
    capture('people-hub-expiries');
  });
  it('cancels company changes and hides old values while waiting for the new scope', async () => {
    let finish!: (v: PeopleDashboard) => void;
    state.get
      .mockResolvedValueOnce(fixture)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValueOnce({ ...fixture, workforce: { ...fixture.workforce, active: 7 } });
    render(<PeopleHub />);
    await screen.findByRole('region', { name: 'Workforce' });
    await screen.findByRole('option', { name: 'Example Company' });
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'company');
    expect(screen.queryByRole('region', { name: 'Workforce' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    const signal = state.get.mock.calls[1][1].signal as AbortSignal;
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'other');
    expect(signal.aborted).toBe(true);
    await screen.findByRole('region', { name: 'Workforce' });
    await act(async () => finish(fixture));
    expect(screen.getByRole('region', { name: 'Workforce' })).toHaveTextContent(
      'Active employees7',
    );
    expect(state.get).toHaveBeenLastCalledWith(
      '/hr/dashboard',
      expect.objectContaining({ query: { companyId: 'other' } }),
    );
  });
  it('shows failure rather than fabricated zero metrics and retries without losing the selected company', async () => {
    state.get.mockRejectedValueOnce(new Error('Service unavailable'));
    render(<PeopleHub />);
    expect(await screen.findByRole('alert')).toHaveTextContent('People overview unavailable');
    expect(screen.queryByRole('region', { name: 'Workforce' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('region', { name: 'Workforce' });
    await screen.findByRole('option', { name: 'Example Company' });
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'company');
    await screen.findByRole('region', { name: 'Workforce' });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await screen.findByRole('region', { name: 'Workforce' });
    expect(state.get).toHaveBeenLastCalledWith(
      '/hr/dashboard',
      expect.objectContaining({ query: { companyId: 'company' } }),
    );
  });
  it('handles empty scoped collections and retries all company-choice pages', async () => {
    state.get.mockResolvedValue({
      ...fixture,
      employeesByCompany: [],
      recentEmployees: [],
      upcomingContractExpiries: [],
    });
    state.page
      .mockRejectedValueOnce(new Error('Directory unavailable'))
      .mockResolvedValueOnce({ data: [{ id: 'company', name: 'Example Company' }], total: 2 })
      .mockResolvedValueOnce({ data: [{ id: 'other', name: 'Other Company' }], total: 2 });
    render(<PeopleHub />);
    await userEvent.click(await screen.findByRole('button', { name: 'Retry companies' }));
    await screen.findByRole('option', { name: 'Other Company' });
    expect(within(screen.getByLabelText('Company')).getAllByRole('option')).toHaveLength(3);
    expect(screen.getByText('No active employees in this scope.')).toBeInTheDocument();
    expect(screen.getByText('No employee profiles in this scope.')).toBeInTheDocument();
    await userEvent.click(screen.getByText('Upcoming contract expiries'));
    expect(screen.getByText('No active contracts expire in the next 30 days.')).toBeVisible();
  });
});

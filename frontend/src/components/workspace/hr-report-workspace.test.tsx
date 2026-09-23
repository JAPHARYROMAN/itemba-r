import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HrReportWorkspace } from './hr-report-workspace';
import type { HrReportResult } from './hr-report-types';
import { queryDateField, setDateField } from '@/test/date-field';
const state = vi.hoisted(() => ({ permissions: new Set<string>(), get: vi.fn(), page: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get, backendPage: state.page }));
const employee = {
  id: 'employee',
  employeeCode: 'EXAMPLE-01',
  fullName: 'Alex Example',
  company: { name: 'Example Company' },
  department: { name: 'Operations' },
  position: { title: 'Coordinator' },
  employmentType: 'FULL_TIME',
  employmentStatus: 'INACTIVE',
  hireDate: '2024-09-01',
  email: 'example@example.invalid',
  phone: null,
};
const base = { total: 21, page: 1, limit: 20 };
const fixtures: Record<string, HrReportResult> = {
  employees: { ...base, data: [employee] },
  attendance: {
    ...base,
    data: [
      {
        id: 'attendance',
        attendanceNumber: 'ATT-EXAMPLE',
        employee: {
          id: employee.id,
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
        },
        company: employee.company,
        attendanceDate: '2026-09-17',
        attendanceStatus: 'LATE',
        totalHours: '7.50',
        overtimeHours: 0,
        lateMinutes: 30,
        source: 'MANUAL',
        notes: 'Synthetic attendance record.',
      },
    ],
    summary: {
      totalRecords: 21,
      totalHours: '168.50',
      totalOvertimeHours: '12.25',
      totalLateMinutes: 90,
    },
  },
  payroll: {
    ...base,
    data: [
      {
        id: 'run',
        payrollRunNumber: 'PAY-EXAMPLE',
        company: employee.company,
        payrollPeriod: {
          id: 'period',
          name: 'September 2026',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
        },
        status: 'CALCULATED',
        totalGrossPay: '1000000',
        totalDeductions: '100000',
        totalNetPay: '900000',
        _count: { entries: 3 },
      },
    ],
    totals: { totalGrossPay: '12000000', totalDeductions: '1200000', totalNetPay: '10800000' },
  },
  leave: {
    ...base,
    data: [
      {
        id: 'leave',
        leaveRequestNumber: 'LEV-EXAMPLE',
        employee: {
          id: employee.id,
          employeeCode: employee.employeeCode,
          fullName: employee.fullName,
        },
        company: employee.company,
        leaveType: { name: 'Annual leave' },
        status: 'SUBMITTED',
        startDate: '2026-09-20',
        endDate: '2026-09-21',
        totalDays: '2',
        reason: 'Synthetic leave request.',
      },
    ],
    summary: [
      { status: 'SUBMITTED', count: 12, totalDays: '24' },
      { status: 'APPROVED', count: 9, totalDays: '18' },
    ],
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  state.permissions = new Set([
    'hr.reports.view',
    'companies.read',
    'employees.view',
    'payroll.view',
  ]);
  state.get.mockImplementation(async (path: string) => fixtures[path.split('/').pop()!]);
  state.page.mockImplementation(async (path: string) => ({
    data:
      path === '/companies'
        ? [
            { id: 'company', name: 'Example Company' },
            { id: 'other', name: 'Other Company' },
          ]
        : [{ id: 'period', name: 'September 2026', company: { name: 'Example Company' } }],
    total: path === '/companies' ? 2 : 1,
  }));
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
  }
}
async function run(kind = 'Employees') {
  await userEvent.click(screen.getByRole('button', { name: kind, exact: true }));
  await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
  await screen.findByRole('region', { name: 'Totals for all matching records' });
}
describe('People reports', () => {
  it('gates report and choice reads, but allows reporting without separate employee or payroll navigation permissions', async () => {
    state.permissions.clear();
    const denied = render(<HrReportWorkspace />);
    expect(screen.getByText('Your role cannot view HR reports.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.page).not.toHaveBeenCalled();
    denied.unmount();
    state.permissions.add('hr.reports.view');
    render(<HrReportWorkspace />);
    await run();
    expect(screen.queryByLabelText('Company')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.queryByRole('link', { name: 'Open employee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Statutory returns' })).not.toBeInTheDocument();
    await run('Payroll');
    expect(screen.queryByLabelText('Pay period')).not.toBeInTheDocument();
  });
  it('renders real employee relation fields and status, keeps filters and exposes later pages', async () => {
    render(<HrReportWorkspace />);
    expect(state.get).not.toHaveBeenCalled();
    await screen.findByRole('option', { name: 'Example Company' });
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'company');
    await userEvent.type(screen.getByLabelText('Employee name or code'), 'Alex');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'INACTIVE');
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    expect(state.get).toHaveBeenLastCalledWith(
      '/hr/reports/employees',
      expect.objectContaining({
        query: { companyId: 'company', search: 'Alex', status: 'INACTIVE', page: 1, limit: 20 },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.getByRole('complementary', { name: 'Record details' })).toHaveTextContent(
      'Coordinator',
    );
    expect(screen.getByRole('link', { name: 'Open employee' })).toHaveAttribute(
      'href',
      '/hr/employees/employee',
    );
    capture('hr-report-employees');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/hr/reports/employees',
        expect.objectContaining({
          query: expect.objectContaining({ page: 2, search: 'Alex', status: 'INACTIVE' }),
        }),
      ),
    );
    await userEvent.type(screen.getByLabelText('Employee name or code'), ' Example');
    expect(
      screen.queryByRole('region', { name: 'Totals for all matching records' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Choose your report' })).toBeInTheDocument();
  });
  it('validates attendance dates and preserves whole-report hour totals independent of page rows', async () => {
    render(<HrReportWorkspace />);
    await userEvent.click(screen.getByRole('button', { name: 'Attendance', exact: true }));
    await setDateField('From date', '2026-09-30');
    await setDateField('To date', '2026-09-01');
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(screen.getByRole('alert')).toHaveTextContent('From date must');
    expect(state.get).not.toHaveBeenCalled();
    await setDateField('From date', '2026-09-01');
    await setDateField('To date', '2026-09-30');
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    const totals = await screen.findByRole('region', { name: 'Totals for all matching records' });
    expect(totals).toHaveTextContent('168.5');
    expect(totals).toHaveTextContent('12.25');
    expect(state.get).toHaveBeenLastCalledWith(
      '/hr/reports/attendance',
      expect.objectContaining({
        query: expect.objectContaining({
          dateFrom: '2026-09-01',
          dateTo: '2026-09-30T23:59:59.999Z',
        }),
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.getByRole('complementary')).toHaveTextContent('Synthetic attendance record.');
    capture('hr-report-attendance');
  });
  it('uses supported payroll period filters, run numbers, entry counts and totals across all pages', async () => {
    render(<HrReportWorkspace />);
    await userEvent.click(screen.getByRole('button', { name: 'Payroll', exact: true }));
    await screen.findByRole('option', { name: 'September 2026 · Example Company' });
    await userEvent.selectOptions(screen.getByLabelText('Pay period'), 'period');
    expect(queryDateField('From date')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(
      await screen.findByRole('region', { name: 'Totals for all matching records' }),
    ).toHaveTextContent('TZS 10,800,000.00');
    expect(state.get).toHaveBeenLastCalledWith(
      '/hr/reports/payroll',
      expect.objectContaining({
        query: { companyId: '', payrollPeriodId: 'period', status: '', page: 1, limit: 20 },
      }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Inspect September 2026' }));
    expect(screen.getByRole('complementary')).toHaveTextContent('PAY-EXAMPLE');
    expect(screen.getByRole('complementary')).toHaveTextContent('Employees3');
    expect(screen.getByRole('link', { name: 'View payroll entries' })).toHaveAttribute(
      'href',
      '/hr/payroll-entries?payrollRunId=run',
    );
    capture('hr-report-payroll');
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'other');
    expect(screen.getByLabelText('Pay period')).toHaveValue('');
    expect(
      screen.queryByRole('region', { name: 'Totals for all matching records' }),
    ).not.toBeInTheDocument();
  });
  it('shows leave request status counts and days without inventing leave balances', async () => {
    render(<HrReportWorkspace />);
    await run('Leave');
    const totals = screen.getByRole('region', { name: 'Totals for all matching records' });
    expect(totals).toHaveTextContent('12 requests · 24 days');
    expect(totals).toHaveTextContent('9 requests · 18 days');
    await userEvent.click(screen.getByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.getByRole('complementary')).toHaveTextContent('Annual leave');
    expect(screen.getByRole('complementary')).toHaveTextContent('Synthetic leave request.');
    expect(screen.queryByText('Balance')).not.toBeInTheDocument();
    capture('hr-report-leave');
  });
  it('retains report filters on failure and retries the exact request', async () => {
    state.get.mockRejectedValueOnce(new Error('Reports temporarily unavailable'));
    render(<HrReportWorkspace />);
    await userEvent.type(screen.getByLabelText('Employee name or code'), 'Alex');
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reports temporarily unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    expect(state.get).toHaveBeenLastCalledWith(
      '/hr/reports/employees',
      expect.objectContaining({ query: expect.objectContaining({ search: 'Alex', page: 1 }) }),
    );
  });
  it('cancels old reports and does not render their rows after changing report type', async () => {
    let resolve!: (r: HrReportResult) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise<HrReportResult>((r) => {
          resolve = r;
        }),
    );
    render(<HrReportWorkspace />);
    await userEvent.click(screen.getByRole('button', { name: 'Generate report' }));
    const signal = state.get.mock.calls[0][1].signal;
    await run('Payroll');
    expect(signal.aborted).toBe(true);
    await act(async () => resolve(fixtures.employees));
    expect(screen.queryByRole('button', { name: 'Inspect Alex Example' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inspect September 2026' })).toBeInTheDocument();
  });
  it('loads every company page and exposes choice failures with retry', async () => {
    state.page.mockRejectedValueOnce(new Error('Companies unavailable'));
    render(<HrReportWorkspace />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Companies unavailable');
    state.page.mockImplementation(async (_path: string, options: { query: { page: number } }) => ({
      data: [{ id: `company-${options.query.page}`, name: `Company ${options.query.page}` }],
      total: 2,
    }));
    await userEvent.click(screen.getByRole('button', { name: 'Retry companies' }));
    await screen.findByRole('option', { name: 'Company 2' });
    expect(within(screen.getByLabelText('Company')).getAllByRole('option')).toHaveLength(3);
  });
});

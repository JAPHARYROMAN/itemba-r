import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PayrollHome, PayrollInputs } from './payroll-home';
import { PayrollWorkspace } from './payroll-workspace';
import { activePayrollTab } from '@/lib/payroll-app';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  choices: vi.fn(),
  path: '/payroll',
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => state.permissions.has(p) }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => state.path,
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: state.get }));
vi.mock('@/lib/backend-all-pages', () => ({ backendAllPages: state.choices }));
beforeEach(() => {
  vi.resetAllMocks();
  state.path = '/payroll';
  state.permissions = new Set(['payroll.view', 'companies.read', 'salary_payments.view']);
  state.choices.mockResolvedValue([{ id: 'company', name: 'Company A' }]);
  state.get.mockImplementation(async (_path: string, opts: { query: { status?: string } }) =>
    opts.query.status
      ? { data: [], total: { DRAFT: 2, SUBMITTED: 3, APPROVED: 4 }[opts.query.status as 'DRAFT'] }
      : {
          data: [
            {
              id: 'run',
              payrollRunNumber: 'PR-01',
              status: 'CALCULATED',
              totalNetPay: '9007199254740993.11',
              payrollPeriod: { name: 'September' },
              company: { name: 'Company A' },
            },
          ],
          total: 20,
        },
  );
});
describe('Payroll app', () => {
  it('shows employees and company-scoped workforce counts without granting access to payroll runs', async () => {
    state.permissions = new Set(['employees.view', 'companies.read']);
    state.get.mockImplementation(async (_path, options) => ({
      data: [],
      total: options.query.employmentStatus ? 7 : 9,
    }));
    render(
      <PayrollWorkspace>
        <PayrollHome />
      </PayrollWorkspace>,
    );
    await screen.findByRole('link', { name: /Active employees 7/ });
    expect(
      within(screen.getByRole('navigation', { name: 'Payroll workspace' })).getByRole('link', {
        name: 'Employees',
        exact: true,
      }),
    ).toHaveAttribute('href', '/hr/employees');
    expect(state.get.mock.calls.every(([path]) => path === '/hr/employees')).toBe(true);
    expect(screen.queryByRole('link', { name: 'Payroll runs' })).not.toBeInTheDocument();
    await screen.findByRole('option', { name: 'Company A' });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'company' } });
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/hr/employees',
        expect.objectContaining({
          query: expect.objectContaining({ companyId: 'company', employmentStatus: 'ACTIVE' }),
        }),
      ),
    );
    // The request above is made before its answer lands; until then the count
    // reads "…", so wait for the link rather than racing the response.
    expect(await screen.findByRole('link', { name: /Active employees 7/ })).toHaveAttribute(
      'href',
      '/hr/employees?companyId=company&employmentStatus=ACTIVE',
    );
  });
  it('keeps employee profiles, contracts and reports in the appropriate app sections', () => {
    expect(activePayrollTab('/hr/employees/employee')).toBe('/hr/employees');
    expect(activePayrollTab('/hr/employment-contracts/contract')).toBe('/hr/employment-contracts');
    expect(activePayrollTab('/hr/reports/statutory')).toBe('/hr/reports');
    expect(activePayrollTab('/hr/leave-balances')).toBe('/payroll/leave');
    expect(activePayrollTab('/hr/employee-assignments')).toBe('/payroll/organisation');
  });
  it('does not request payroll data or company choices without access', () => {
    state.permissions.clear();
    render(<PayrollHome />);
    expect(screen.getByText(/Ask your administrator/)).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.choices).not.toHaveBeenCalled();
  });
  it('offers payments to payment-only users without reading full payroll runs', () => {
    state.permissions = new Set(['salary_payments.view']);
    render(
      <PayrollWorkspace>
        <PayrollHome />
      </PayrollWorkspace>,
    );
    expect(screen.getAllByRole('link', { name: 'Payments' })).toHaveLength(2);
    expect(screen.queryByRole('link', { name: 'Payroll runs' })).not.toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    expect(state.choices).not.toHaveBeenCalled();
  });
  it('shows real status totals and carries company and status into the run register', async () => {
    render(<PayrollHome />);
    await screen.findByText('TZS 9,007,199,254,740,993.11');
    expect(screen.getByRole('link', { name: /Awaiting sign-off/ })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /PR-01/ })).toHaveAttribute(
      'href',
      '/hr/payroll-entries?payrollRunId=run',
    );
    await screen.findByRole('option', { name: 'Company A' });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'company' } });
    await waitFor(() =>
      expect(state.get).toHaveBeenCalledWith(
        '/hr/payroll-runs',
        expect.objectContaining({
          query: expect.objectContaining({ companyId: 'company', status: 'APPROVED' }),
        }),
      ),
    );
    expect(screen.getByRole('link', { name: /Ready for payment/ })).toHaveAttribute(
      'href',
      '/hr/payroll-runs?companyId=company&status=APPROVED',
    );
  });
  it('does not present failed reads as zero payroll or a first-use state', async () => {
    state.get.mockRejectedValue(new Error('Backend service unavailable'));
    render(<PayrollHome />);
    await screen.findByText('Backend service unavailable');
    expect(screen.queryByText('Your next payday starts here')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /In preparation/ })).toHaveTextContent('—');
  });
  it('offers first-use guidance when there are no payroll runs', async () => {
    state.get.mockResolvedValue({ data: [], total: 0 });
    render(<PayrollHome />);
    expect(await screen.findByRole('link', { name: /Open pay periods/ })).toHaveAttribute(
      'href',
      '/hr/payroll-periods',
    );
  });
  it('only exposes permitted pay input tools', () => {
    state.permissions = new Set(['allowances.view']);
    render(<PayrollInputs />);
    expect(screen.getByRole('link', { name: /Employee allowances/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Employee deductions/ })).not.toBeInTheDocument();
  });
  it('keeps individual and run-wide payslips inside the Payslips section', () => {
    expect(activePayrollTab('/hr/payslips/entry')).toBe('/hr/payroll-entries');
    expect(activePayrollTab('/hr/payroll-runs/run/payslips')).toBe('/hr/payroll-entries');
    expect(activePayrollTab('/hr/employee-allowances')).toBe('/payroll/inputs');
  });
});

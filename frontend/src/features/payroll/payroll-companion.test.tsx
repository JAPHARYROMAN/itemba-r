import { useState } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModalPortalProvider } from '@/components/ui/modal';
import {
  UnsavedWorkProvider,
  UnsavedWorkScope,
  useFormGuard,
} from '@/components/workspace/unsaved-work-provider';
import {
  WorkspaceLink,
  WorkspaceNavigationProvider,
  useWorkspaceHistory,
} from '@/components/workspace/workspace-navigation';
import {
  PAYROLL_INPUTS,
  PAYROLL_LEAVE,
  PAYROLL_ORGANISATION,
  PAYROLL_TABS,
} from '@/lib/payroll-app';
import { payslipFixture } from '@/test/payslip-fixture';
import { PayrollCompanion } from './payroll-companion';
import { payrollCompanionRoute } from './payroll-companion-routes';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  push: vi.fn(),
  put: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: state.push, replace: vi.fn() }),
  usePathname: () => '/reports',
  useSearchParams: () => new URLSearchParams('companyId=main-company&payrollRunId=main-run'),
  useParams: () => ({ id: 'main-record' }),
}));
vi.mock('next/dynamic', async () => {
  const React = await import('react');
  return {
    default: (loader: () => Promise<{ default: React.ComponentType } | React.ComponentType>) => {
      const Loaded = React.lazy(async () => {
        const value = await loader();
        return { default: typeof value === 'function' ? value : value.default };
      });
      return function Dynamic(props: Record<string, unknown>) {
        return (
          <React.Suspense fallback={<p>Opening Payroll</p>}>
            <Loaded {...props} />
          </React.Suspense>
        );
      };
    },
  };
});
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator' },
    loading: false,
    hasPermission: (code: string) => state.permissions.has(code),
  }),
}));
vi.mock('@/lib/api-client', async (original) => ({
  ...(await original<typeof import('@/lib/api-client')>()),
  backendGet: state.get,
  backendPage: state.page,
  backendPut: state.put,
}));
const employee = {
  id: 'employee',
  firstName: 'Alex',
  lastName: 'Example',
  fullName: 'Alex Example',
  employeeCode: 'EMP-1',
  companyId: 'side-company',
  company: { id: 'side-company', name: 'Side Company' },
  employmentStatus: 'ACTIVE',
};
function MainForm() {
  const [value, setValue] = useState('');
  const guard = useFormGuard(value, setValue);
  return (
    <label {...guard.capture}>
      Main app draft
      <input value={value} onChange={(event) => setValue(event.target.value)} />
    </label>
  );
}
function Navigation() {
  const history = useWorkspaceHistory()!;
  return (
    <nav aria-label="Local history">
      <button onClick={history.back} disabled={!history.canBack}>
        Back locally
      </button>
      <WorkspaceLink href="/payroll/leave">Leave tools</WorkspaceLink>
      <output>{history.href}</output>
    </nav>
  );
}
function Harness({ href = '/payroll' }: { href?: string }) {
  return (
    <UnsavedWorkProvider>
      <UnsavedWorkScope id="primary">
        <MainForm />
      </UnsavedWorkScope>
      <UnsavedWorkScope id="companion">
        <ModalPortalProvider>
          <WorkspaceNavigationProvider
            appId="payroll"
            initialHref={href}
            ownsPath={(path) => payrollCompanionRoute(path) !== null}
          >
            <div data-os-pane="companion" data-testid="payroll-pane">
              <Navigation />
              <PayrollCompanion />
            </div>
          </WorkspaceNavigationProvider>
        </ModalPortalProvider>
      </UnsavedWorkScope>
    </UnsavedWorkProvider>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  state.permissions = new Set(['employees.view', 'employees.update', 'companies.read']);
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.get.mockImplementation(async (path) => {
    if (path === '/hr/employees') return { data: [employee], total: 1 };
    if (path === '/hr/employees/employee') return { ...employee };
    if (path === '/hr/payslips/run/side-run')
      return {
        data: [{ ...payslipFixture.entry, employee: payslipFixture.employee }],
        total: 1,
        run: { ...payslipFixture.payrollRun, id: 'side-run' },
        totals: { employees: 1, gross: 1150000, deductions: 230000, net: 920000 },
      };
    if (path === '/hr/payslips/entry')
      return { ...payslipFixture, payrollRun: { ...payslipFixture.payrollRun, id: 'side-run' } };
    return [];
  });
  state.page.mockImplementation(async (path) => ({
    data:
      path === '/companies'
        ? [{ id: 'side-company', name: 'Side Company' }]
        : path === '/hr/employees'
          ? [employee]
          : [],
    total: path === '/companies' || path === '/hr/employees' ? 1 : 0,
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
describe('Payroll companion workflows', () => {
  it('opens company-filtered employees and the selected profile without reading the main route', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await screen.findByRole('option', { name: 'Side Company' });
    await user.selectOptions(screen.getByLabelText('Company'), 'side-company');
    await user.click(await screen.findByRole('link', { name: /Active employees 1/ }));
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'Open employee' }));
    expect(await screen.findByRole('heading', { name: 'Alex Example' })).toBeVisible();
    expect(state.get).toHaveBeenCalledWith('/hr/employees/employee', expect.anything());
    expect(
      state.get.mock.calls.some(
        ([path, options]) =>
          path.includes('main-record') || options?.query?.companyId === 'main-company',
      ),
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Back locally' }));
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    expect(screen.getByRole('navigation', { name: 'Local history' })).toHaveTextContent(
      'companyId=side-company',
    );
    expect(state.push).not.toHaveBeenCalled();
  });
  it('guards profile edits during local navigation and leaves the other app draft intact', async () => {
    const user = userEvent.setup();
    render(<Harness href="/hr/employees/employee" />);
    await user.type(screen.getByLabelText('Main app draft'), 'Unfinished report');
    await user.click(await screen.findByRole('button', { name: 'Edit profile' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit profile' });
    expect(screen.getByTestId('payroll-pane')).not.toContainElement(dialog);
    await user.clear(within(dialog).getByLabelText(/First Name/));
    await user.type(within(dialog).getByLabelText(/First Name/), 'Jordan');
    await user.click(screen.getByRole('link', { name: 'Leave tools' }));
    await user.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByLabelText(/First Name/)).toHaveValue('Jordan');
    await user.click(screen.getByRole('link', { name: 'Leave tools' }));
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Edit profile' })).not.toBeInTheDocument(),
    );
    expect(screen.getByLabelText('Main app draft')).toHaveValue('Unfinished report');
    expect(state.put).not.toHaveBeenCalled();
  });
  it('opens a run payslip with its own ID and prints only its app pane', async () => {
    state.permissions = new Set(['payroll.view']);
    const user = userEvent.setup();
    render(<Harness href="/hr/payroll-runs/side-run/payslips" />);
    await user.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await user.click(screen.getByRole('button', { name: 'View payslip', exact: true }));
    await screen.findByText('Payslip / Hati ya Malipo');
    expect(state.get).toHaveBeenCalledWith('/hr/payslips/entry', expect.anything());
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      expect(screen.getByTestId('payroll-pane')).toHaveAttribute('data-os-print-target');
    });
    await user.click(screen.getByRole('button', { name: 'Print / Save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('afterprint'));
    print.mockRestore();
    await user.click(screen.getByRole('button', { name: 'All payslips' }));
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    expect(state.get.mock.calls.some(([path]) => /main-record|main-run/.test(path))).toBe(false);
    expect(state.push).not.toHaveBeenCalled();
  });
  it('keeps a payment-only user out of employee details without fetching them', async () => {
    state.permissions = new Set(['salary_payments.view']);
    render(<Harness href="/hr/employees/employee" />);
    await screen.findByText(
      /cannot view employee|cannot view this employee|permission to view employees/i,
    );
    expect(state.get).not.toHaveBeenCalled();
  });
  it('covers every Payroll navigation target and rejects unrelated or malformed routes', () => {
    for (const entry of [
      ...PAYROLL_TABS,
      ...PAYROLL_INPUTS,
      ...PAYROLL_LEAVE,
      ...PAYROLL_ORGANISATION,
    ]) {
      expect(payrollCompanionRoute(entry.href), entry.href).not.toBeNull();
    }
    expect(payrollCompanionRoute('/hr/employees/employee')).toEqual({
      kind: 'employee',
      id: 'employee',
    });
    expect(payrollCompanionRoute('/hr/employees/%broken')).toBeNull();
    expect(payrollCompanionRoute('/hr/payroll-runs/side-run/payslips/unavailable')).toBeNull();
    expect(payrollCompanionRoute('/invoice-desk')).toBeNull();
  });
});

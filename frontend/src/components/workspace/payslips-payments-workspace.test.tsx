import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RunPayslipsPage from '@/app/(dashboard)/hr/payroll-runs/[id]/payslips/page';
import PayslipPage from '@/app/(dashboard)/hr/payslips/[id]/page';
import SalaryPaymentsPage from '@/app/(dashboard)/hr/salary-payments/page';
import { payslipFixture } from '@/test/payslip-fixture';
import { UnsavedWorkProvider } from './unsaved-work-provider';
const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  get: vi.fn(),
  page: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  router: { push: vi.fn() },
  id: 'run',
  lookupFailure: false,
  paymentStatus: 'PAID',
}));
vi.mock('next/navigation', () => ({
  useRouter: () => state.router,
  useParams: () => ({ id: state.id }),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'operator' },
    hasPermission: (p: string) => state.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendPost: state.post,
  backendPatch: state.patch,
}));
const payment = () => ({
  id: 'payment',
  salaryPaymentNumber: 'SP-01',
  companyId: 'company',
  company: { name: 'Example Company' },
  employee: payslipFixture.employee,
  employeeId: 'employee',
  payrollEntryId: 'entry',
  payrollRunId: 'run',
  amount: '920000',
  paymentDate: '2026-09-28',
  paymentMethod: 'BANK_TRANSFER',
  status: state.paymentStatus,
  reference: 'Bank-ref',
});
const workspace = {
  data: [{ ...payslipFixture.entry, employee: payslipFixture.employee }],
  total: 25,
  run: payslipFixture.payrollRun,
  totals: { employees: 40, gross: 46000000, deductions: 9200000, net: 36800000 },
};
beforeEach(() => {
  vi.resetAllMocks();
  state.id = 'run';
  state.lookupFailure = false;
  state.paymentStatus = 'PAID';
  state.permissions = new Set([
    'payroll.view',
    'employees.view',
    'salary_payments.view',
    'salary_payments.create',
    'salary_payments.reverse',
  ]);
  state.get.mockImplementation(async (path) =>
    path.includes('/run/') ? workspace : payslipFixture,
  );
  state.page.mockImplementation(async (path, opts) => {
    if (path === '/companies')
      return {
        data: [
          { id: 'company', name: 'Example Company' },
          { id: 'other', name: 'Other Company' },
        ],
        total: 2,
      };
    if (path === '/hr/employees')
      return {
        data: [
          payslipFixture.employee,
          { id: 'other-person', fullName: 'Other Employee', employeeCode: 'OTHER' },
        ],
        total: 2,
      };
    if (path === '/hr/payroll-runs') {
      if (state.lookupFailure) throw new Error('Runs unavailable');
      return { data: [{ id: 'run', payrollRunNumber: 'PR-01', status: 'APPROVED' }], total: 1 };
    }
    if (path === '/hr/payroll-entries')
      return {
        data: [
          {
            id: 'entry',
            netPay: '920000',
            employeeId: opts.query.employeeId,
            companyId: opts.query.companyId,
            payrollRunId: 'run',
          },
        ],
        total: 1,
      };
    return { data: [payment()], total: 25 };
  });
  state.post.mockResolvedValue({});
  state.patch.mockResolvedValue({});
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
const mount = (child: React.ReactNode) =>
  render(<UnsavedWorkProvider>{child}</UnsavedWorkProvider>);
// Optional local visual review output, containing only the synthetic fixtures above.
function captureFixture(name: string) {
  const directory = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name + '.html'), document.body.innerHTML);
}
describe('Payslip workspace', () => {
  it('gates the run collection and individual document before fetching', () => {
    state.permissions.clear();
    const view = mount(<RunPayslipsPage />);
    expect(screen.getByText('Your role cannot view payslips.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
    view.unmount();
    mount(<PayslipPage />);
    expect(screen.getByText('Your role cannot view this payslip.')).toBeInTheDocument();
    expect(state.get).not.toHaveBeenCalled();
  });
  it('keeps full-run totals while searching/paging and opens the selected payslip', async () => {
    mount(<RunPayslipsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.getByLabelText('Whole run totals')).toHaveTextContent('40');
    expect(screen.getByLabelText('Whole run totals')).toHaveTextContent('TZS 36,800,000.00');
    captureFixture('run-payslips');
    await userEvent.click(screen.getByRole('button', { name: 'View payslip', exact: true }));
    expect(state.router.push).toHaveBeenCalledWith('/hr/payslips/entry');
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/hr/payslips/run/run',
        expect.objectContaining({ query: { page: 2, limit: 20, search: '' } }),
      ),
    );
    await userEvent.type(screen.getByPlaceholderText('Search employee name or code…'), 'Alex');
    await waitFor(() =>
      expect(state.get).toHaveBeenLastCalledWith(
        '/hr/payslips/run/run',
        expect.objectContaining({ query: { page: 1, limit: 20, search: 'Alex' } }),
      ),
    );
  });
  it('keeps read failures visible with retry, without showing misleading totals', async () => {
    state.get.mockRejectedValueOnce(new Error('Payslip service unavailable'));
    mount(<RunPayslipsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Payslip service unavailable');
    expect(screen.queryByLabelText('Whole run totals')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Inspect Alex Example' })).toBeInTheDocument();
  });
  it('preserves bilingual earnings, statutory contributions, employer totals, print and PDF contracts', async () => {
    state.id = 'entry';
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const fallback = state.get.getMockImplementation()!;
    state.get.mockImplementation((path, ...args) =>
      path === '/generated-documents/artifact/preview'
        ? Promise.resolve({ kind: 'text', text: 'Generated payslip preview' })
        : fallback(path, ...args),
    );
    state.post.mockResolvedValue({
      generatedDocument: { id: 'artifact' },
      document: { id: 'document' },
    });
    mount(<PayslipPage />);
    await screen.findByText('Payslip / Hati ya Malipo');
    captureFixture('payslip');
    expect(screen.getByText('Transport allowance')).toBeInTheDocument();
    expect(screen.getByText('Advance recovery')).toBeInTheDocument();
    expect(screen.getByText('Net pay / Malipo halisi')).toBeInTheDocument();
    expect(screen.getByText('TZS 920,000.00')).toBeInTheDocument();
    expect(screen.getByText(/Michango ya mwajiri/)).toBeInTheDocument();
    expect(screen.getByText(/Payment destination: see disbursement details/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Print / Save as PDF' }));
    expect(print).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Generate PDF' }));
    expect(state.post).toHaveBeenCalledWith(
      '/generated-documents/pdf',
      {
        entityType: 'PAYSLIP',
        entityId: 'entry',
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    await screen.findByText('Generated payslip preview');
    expect(open).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await userEvent.click(screen.getByRole('button', { name: 'All payslips' }));
    expect(state.router.push).toHaveBeenCalledWith('/hr/payroll-runs/run/payslips');
    print.mockRestore();
    open.mockRestore();
  });
  it('keeps net pay on page 1 when allowances overflow onto a continuation', async () => {
    state.id = 'entry';
    const long = {
      ...payslipFixture,
      allowances: Array.from({ length: 32 }, (_, index) => ({
        id: `allowance-${index + 1}`,
        name: `Allowance ${index + 1}`,
        taxable: true,
        amount: 1000,
      })),
    };
    state.get.mockImplementation(async (path) =>
      path.includes('/run/') ? workspace : long,
    );
    mount(<PayslipPage />);
    await screen.findByText('Payslip / Hati ya Malipo');
    const first = document.querySelector('[data-payslip-sheet="1"]');
    const second = document.querySelector('[data-payslip-sheet="2"]');
    expect(first).toHaveTextContent('Net pay / Malipo halisi');
    expect(first).toHaveTextContent('Gross pay');
    expect(second).toHaveTextContent('Allowance 32');
    expect(second).not.toHaveTextContent('Net pay / Malipo halisi');
  });
  it('retries individual document failure and ignores an obsolete document response', async () => {
    let resolveOld!: (value: unknown) => void;
    state.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    state.id = 'old';
    const view = mount(<PayslipPage />);
    const oldSignal = state.get.mock.calls[0][1].signal;
    state.id = 'entry';
    view.rerender(
      <UnsavedWorkProvider>
        <PayslipPage />
      </UnsavedWorkProvider>,
    );
    await screen.findByText('Payslip / Hati ya Malipo');
    expect(oldSignal.aborted).toBe(true);
    resolveOld({
      ...payslipFixture,
      employee: { ...payslipFixture.employee, fullName: 'Stale Person' },
    });
    await waitFor(() => expect(screen.queryByText('Stale Person')).not.toBeInTheDocument());
    view.unmount();
    state.get.mockRejectedValueOnce(new Error('Document unavailable'));
    mount(<PayslipPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Document unavailable');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Payslip / Hati ya Malipo');
  });
});
describe('Salary payments workspace', () => {
  it('gates reads and mutation controls by their exact permissions', async () => {
    state.permissions.clear();
    const view = mount(<SalaryPaymentsPage />);
    expect(state.page).not.toHaveBeenCalled();
    view.unmount();
    state.permissions.add('salary_payments.view');
    mount(<SalaryPaymentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse record' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'View payslip' })).not.toBeInTheDocument();
  });
  it('paginates and searches with company/status filters', async () => {
    mount(<SalaryPaymentsPage />);
    await screen.findByRole('button', { name: 'Inspect Alex Example' });
    await userEvent.click(screen.getByRole('button', { name: 'Next', exact: true }));
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/salary-payments',
        expect.objectContaining({ query: expect.objectContaining({ page: 2 }) }),
      ),
    );
    await userEvent.click(screen.getByRole('button', { name: /Filters/ }));
    await userEvent.selectOptions(screen.getByLabelText('Company filter'), 'company');
    await userEvent.selectOptions(screen.getByLabelText('Status filter'), 'PAID');
    await userEvent.type(
      screen.getByPlaceholderText('Search payment, employee or reference…'),
      'Bank',
    );
    await waitFor(() =>
      expect(state.page).toHaveBeenCalledWith(
        '/hr/salary-payments',
        expect.objectContaining({
          query: { page: 1, limit: 20, search: 'Bank', companyId: 'company', status: 'PAID' },
        }),
      ),
    );
  });
  it('routes new salary payments to the connected payroll workflow', async () => {
    mount(<SalaryPaymentsPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(state.router.push).toHaveBeenCalledWith('/hr/payroll-runs');
    expect(state.post).not.toHaveBeenCalled();
  });
  it('requires a named reversal confirmation and retains the reason after errors and Stay', async () => {
    state.patch.mockRejectedValueOnce(new Error('Reversal rejected'));
    mount(<SalaryPaymentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    await userEvent.click(screen.getByRole('button', { name: 'Reverse record' }));
    expect(state.patch).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog', { name: 'Reverse payment · SP-01' });
    captureFixture('salary-reversal');
    expect(dialog).toHaveTextContent('does not recover money');
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Duplicate record');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse record' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Reversal rejected');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stay here' }));
    expect(within(dialog).getByLabelText('Reason (optional)')).toHaveValue('Duplicate record');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse record' }));
    expect(state.patch).toHaveBeenLastCalledWith('/hr/salary-payments/payment/reverse', {
      reason: 'Duplicate record',
    });
  });
  it('does not offer reversal for an already reversed record', async () => {
    state.paymentStatus = 'REVERSED';
    mount(<SalaryPaymentsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Inspect Alex Example' }));
    expect(screen.queryByRole('button', { name: 'Reverse record' })).not.toBeInTheDocument();
  });
});

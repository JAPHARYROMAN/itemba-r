import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import LoansDebtsPage from '@/app/(dashboard)/group-control/loans-debts/page';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function capture(name: string) {
  const dir = process.env.ITEMBA_OS_VISUAL_DIR;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${name}.html`), document.body.innerHTML);
}

const state = vi.hoisted(() => ({ permissions: new Set<string>(), fail: false, calls: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (permission: string) => state.permissions.has(permission) }),
}));
vi.mock('@/components/aurora/feedback', () => ({ showToast: vi.fn() }));
const loan = {
  id: 'loan-1',
  lenderName: 'Example bank',
  loanReference: 'LN-101',
  company: { name: 'Example company' },
  outstandingBalance: '8500',
  principalAmount: '10000',
  currency: 'TZS',
  interestRate: '0.12',
  repaymentFrequency: 'MONTHLY',
  maturityDate: '2027-08-01',
  status: 'ACTIVE',
  riskLevel: 'LOW',
  obligationType: 'BANK_LOAN',
};
beforeEach(() => {
  state.permissions = new Set(['loans.read', 'debts.read']);
  state.fail = false;
  state.calls.mockReset();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      state.calls(url);
      const path = new URL(url, 'http://localhost').pathname;
      const failed = state.fail && path === '/api/backend/loans';
      return {
        ok: !failed,
        status: failed ? 503 : 200,
        json: async () =>
          failed
            ? { message: 'Service temporarily unavailable' }
            : {
                success: true,
                data: path.endsWith('/summary')
                  ? {
                      activeCount: 1,
                      highRiskCount: 0,
                      upcomingMaturity: 0,
                      outstandingCount: 0,
                      overdueCount: 0,
                    }
                  : path.endsWith('/companies')
                    ? {
                        data: [{ id: 'co', name: 'Example company', code: 'EX' }],
                        page: 1,
                        total: 1,
                        totalPages: 1,
                      }
                    : {
                        data: path.endsWith('/loans') ? [loan] : [],
                        total: path.endsWith('/loans') ? 16 : 0,
                        page: 1,
                        totalPages: path.endsWith('/loans') ? 2 : 1,
                      },
              },
      };
    }),
  );
});

describe('Loans & Debts workspace', () => {
  it('opens complete loan details by keyboard and preserves read-only permissions', async () => {
    render(<LoansDebtsPage />);
    const trigger = await screen.findByRole('button', { name: 'Review Example bank' });
    capture('loans-list');
    trigger.focus();
    await userEvent.keyboard('{Enter}');
    const panel = screen.getByRole('complementary', { name: 'Obligation details' });
    expect(within(panel).getByText('12.00%')).toBeVisible();
    capture('loans-details');
    expect(within(panel).getByRole('link')).toHaveAttribute(
      'href',
      '/group-control/loans-debts/loans/loan-1',
    );
    expect(screen.queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('button', { name: 'Back to list' }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it('combines filters and pagination, and clears obsolete selected details', async () => {
    render(<LoansDebtsPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Review Example bank' }));
    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    await userEvent.selectOptions(screen.getByLabelText('Company'), 'co');
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ACTIVE');
    await userEvent.type(screen.getByRole('searchbox'), 'bank');
    await waitFor(() =>
      expect(
        state.calls.mock.calls.some(
          ([url]) =>
            url.includes('companyId=co') &&
            url.includes('status=ACTIVE') &&
            url.includes('search=bank'),
        ),
      ).toBe(true),
    );
    expect(
      screen.queryByRole('link', { name: 'Open loan & payment history' }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() =>
      expect(
        state.calls.mock.calls.some(
          ([url]) => url.includes('page=2') && url.includes('companyId=co'),
        ),
      ).toBe(true),
    );
  });
  it('shows a recoverable failure instead of a misleading empty register', async () => {
    state.fail = true;
    render(<LoansDebtsPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Service temporarily unavailable');
    expect(screen.queryByText('No loans recorded')).not.toBeInTheDocument();
    state.fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Review Example bank' })).toBeVisible();
  });
  it('allows debt-only readers without loading the loan endpoints', async () => {
    state.permissions = new Set(['debts.read']);
    render(<LoansDebtsPage />);
    expect(await screen.findByText('No debts recorded')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Loans', exact: true })).not.toBeInTheDocument();
    expect(state.calls.mock.calls.some(([url]) => url.includes('/loans'))).toBe(false);
  });
});

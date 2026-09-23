import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import FinanceDashboard from '@/app/(dashboard)/finance/page';
import ChartOfAccounts from '@/app/(dashboard)/finance/chart-of-accounts/page';
import FiscalYears from '@/app/(dashboard)/finance/fiscal-years/page';
import AccountingPeriods from '@/app/(dashboard)/finance/accounting-periods/page';
import JournalEntries from '@/app/(dashboard)/finance/journal-entries/page';
import CashAccounts from '@/app/(dashboard)/finance/cash-accounts/page';
import Expenses from '@/app/(dashboard)/finance/expenses/page';
import ExpenseCategories from '@/app/(dashboard)/finance/expense-categories/page';
import Receivables from '@/app/(dashboard)/finance/receivables/page';
import Payments from '@/app/(dashboard)/finance/payments/page';
import CreditNotes from '@/app/(dashboard)/finance/credit-notes/page';
import Refunds from '@/app/(dashboard)/finance/refunds/page';
import Payables from '@/app/(dashboard)/finance/payables/page';
import Intercompany from '@/app/(dashboard)/finance/intercompany/page';
import FinanceReports from '@/app/(dashboard)/finance/reports/page';

const state = vi.hoisted(() => ({
  permissions: new Set<string>(),
  fetch: vi.fn(),
  backendGet: vi.fn(),
  backendPage: vi.fn(),
  backendList: vi.fn(),
}));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    hasPermission: (permission: string) => state.permissions.has(permission),
    loading: false,
    user: null,
  }),
}));
vi.mock('@/lib/api-client', () => ({
  ApiError: class ApiError extends Error {},
  backendGet: state.backendGet,
  backendPage: state.backendPage,
  backendList: state.backendList,
  backendPost: vi.fn(),
  backendPut: vi.fn(),
  backendDelete: vi.fn(),
}));

const pages = [
  ['dashboard', FinanceDashboard],
  ['chart of accounts', ChartOfAccounts],
  ['fiscal years', FiscalYears],
  ['accounting periods', AccountingPeriods],
  ['journal entries', JournalEntries],
  ['cash accounts', CashAccounts],
  ['expenses', Expenses],
  ['expense categories', ExpenseCategories],
  ['receivables', Receivables],
  ['payments', Payments],
  ['credit notes', CreditNotes],
  ['refunds', Refunds],
  ['payables', Payables],
  ['intercompany', Intercompany],
  ['reports', FinanceReports],
] as const;

beforeEach(() => {
  state.permissions = new Set();
  state.fetch.mockReset();
  state.backendGet.mockReset();
  state.backendPage.mockReset();
  state.backendList.mockReset();
  vi.stubGlobal('fetch', state.fetch);
});

describe('finance route gates', () => {
  it.each(pages)('does not read %s without its view permission', (_name, Page) => {
    render(<Page />);
    expect(screen.getByText('Access Restricted')).toBeInTheDocument();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.backendGet).not.toHaveBeenCalled();
    expect(state.backendPage).not.toHaveBeenCalled();
    expect(state.backendList).not.toHaveBeenCalled();
  });

  it('retries a failed chart-of-accounts load', async () => {
    state.permissions = new Set(['chart_of_accounts.view']);
    state.fetch.mockRejectedValue(new Error('Accounts offline'));
    const user = userEvent.setup();
    render(<ChartOfAccounts />);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    const chartCalls = () =>
      state.fetch.mock.calls.filter((call) => String(call[0]).includes('/api/backend/chart-of-accounts'));
    expect(chartCalls()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(chartCalls()).toHaveLength(2);
  });
});

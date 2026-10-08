import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import CustomerStatementsPage from '@/app/(dashboard)/crm/customer-statements/page';

const state = vi.hoisted(() => ({ get: vi.fn(), page: vi.fn() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    hasPermission: (permission: string) => permission === 'customer_statements.view',
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: state.get,
  backendPage: state.page,
  backendList: vi.fn().mockResolvedValue([]),
  backendPost: vi.fn(),
}));

it('opens the selected saved statement in its original currency and labels an evidence gap', async () => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
  state.page.mockResolvedValue({
    data: [
      {
        id: 'statement',
        statementRunNumber: 'ST-USD',
        companyId: 'company',
        customerId: 'customer',
        periodStart: '2026-10-01',
        periodEnd: '2026-10-08',
        currency: 'USD',
        totalDebits: '100.00',
        totalCredits: '20.00',
        closingBalance: '80.00',
        status: 'GENERATED',
        settlementHistory: {
          status: 'INCOMPLETE',
          recoveredLegacySettlements: 0,
          unresolvedAmount: '10.00',
          gaps: [],
        },
      },
    ],
    total: 1,
    page: 1,
    totalPages: 1,
  });
  // Keep the drawer loading so the assertion tests request identity independently of detail rendering.
  state.get.mockImplementation(() => new Promise(() => {}));
  render(<CustomerStatementsPage />);
  expect(await screen.findByText('ST-USD')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Unresolved evidence: USD 10.00');
  await userEvent.click(screen.getByRole('button', { name: 'View statement' }));
  await waitFor(() =>
    expect(state.get).toHaveBeenCalledWith(
      '/customer-statements/detail',
      expect.objectContaining({
        query: expect.objectContaining({
          companyId: 'company',
          customerId: 'customer',
          currency: 'USD',
        }),
      }),
    ),
  );
});

import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Payables from '@/app/(dashboard)/finance/payables/page';
import Receivables from '@/app/(dashboard)/finance/receivables/page';

const auth = vi.hoisted(() => ({ manage: false }));

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    hasPermission: (permission: string) =>
      permission.endsWith('.view') || (auth.manage && permission.endsWith('.manage')),
  }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/finance/payables',
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn() }),
}));
beforeEach(() => {
  auth.manage = false;
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

describe.each([
  { Page: Payables, module: 'payables', party: 'supplier', number: 'payableNumber' },
  { Page: Receivables, module: 'receivables', party: 'customer', number: 'receivableNumber' },
])('$module account-first flow', ({ Page, module, party, number }) => {
  it('shows date-overdue debt as payable and hides deletion for posted documents', async () => {
    auth.manage = true;
    const document = {
      id: 'posted-document',
      [number]: 'POSTED-1',
      [`${party}Name`]: 'Party A',
      companyId: 'company-a',
      currency: 'USD',
      amount: '100.00',
      paidAmount: '20.00',
      outstandingAmount: '80.00',
      status: 'OVERDUE',
      lifecycleStatus: 'PARTIALLY_PAID',
      issueDate: '2000-01-01',
      dueDate: '2000-02-01',
      createdAt: '2000-01-01',
      canDelete: false,
    };
    const account = {
      accountKey: 'account-a',
      companyId: 'company-a',
      [`${party}Name`]: 'Party A',
      currency: 'USD',
      documentCount: 1,
      openDocumentCount: 1,
      amount: 100,
      paidAmount: 20,
      outstandingAmount: 80,
      overdueAmount: 80,
      status: 'OVERDUE',
      documents: [document],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () => ({
          success: true,
          data: url.includes('/accounts?')
            ? { data: [account], total: 1, page: 1, totalPages: 1 }
            : { data: [], total: 0 },
        }),
      })),
    );
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole('button', { name: 'View transactions for Party A' }));
    const row = screen.getByText('POSTED-1').closest('tr')!;
    expect(within(row).getByRole('button', { name: 'Pay', exact: true })).toBeEnabled();
    expect(within(row).getByRole('button', { name: 'Write Off', exact: true })).toBeEnabled();
    expect(
      within(row).queryByRole('button', { name: 'Delete', exact: true }),
    ).not.toBeInTheDocument();
    expect(within(row).getByText('OVERDUE')).toBeInTheDocument();
  });

  it('starts with a consolidated balance and drills into all seven distinct transactions and full details', async () => {
    const documents = Array.from({ length: 7 }, (_, i) => ({
      id: `${module}-transaction-${i}`,
      [number]: `DOC-${i}`,
      [`${party}Id`]: 'party-a',
      [`${party}Name`]: 'Party A',
      [party]: { name: 'Party A', phone: '+255 700 000 001' },
      companyId: 'company-a',
      company: { name: 'Company A' },
      currency: 'USD',
      amount: '10.10',
      paidAmount: '0.10',
      outstandingAmount: '10.00',
      status: 'OPEN',
      issueDate: '2026-10-01',
      dueDate: '2026-10-30',
      createdAt: '2026-10-01',
    }));
    const account = {
      accountKey: 'account-a',
      companyId: 'company-a',
      [`${party}Id`]: 'party-a',
      [`${party}Name`]: 'Party A',
      company: { name: 'Company A' },
      currency: 'USD',
      documentCount: 7,
      openDocumentCount: 7,
      amount: 70.7,
      paidAmount: 0.7,
      outstandingAmount: 70,
      overdueAmount: 0,
      status: 'OPEN',
      documents,
    };
    const fetch = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => ({
        success: true,
        data: url.includes('/accounts?')
          ? { data: [account], total: 1, page: 1, totalPages: 1 }
          : url.includes(`/${module}/`)
            ? documents[6]
            : { data: [], total: 0 },
      }),
    }));
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<Page />);
    const selected = await screen.findByRole('button', { name: 'View transactions for Party A' });
    expect(screen.queryByText('DOC-6')).not.toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => url.includes(`/api/backend/${module}/accounts?`))).toBe(
      true,
    );
    await user.click(selected);
    expect(screen.getAllByRole('button', { name: 'View', exact: true })).toHaveLength(7);
    const last = screen.getByText('DOC-6').closest('tr')!;
    await user.click(within(last).getByRole('button', { name: 'View', exact: true }));
    const detail = await screen.findByRole('dialog');
    expect(within(detail).getByText(`${module}-transaction-6`)).toBeInTheDocument();
    expect(within(detail).getByText('+255 700 000 001')).toBeInTheDocument();
    expect(
      within(detail).queryByRole('button', { name: 'Pay', exact: true }),
    ).not.toBeInTheDocument();
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { changeSelectField } from '@/test/select-field';
import { BusinessReports } from './business-reports';
const api = vi.hoisted(() => ({ get: vi.fn(), download: vi.fn(), permissions: new Set<string>() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => api.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get }));
vi.mock('@/lib/report-export', async (original) => ({
  ...(await original<typeof import('@/lib/report-export')>()),
  downloadTextFile: api.download,
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  WorkspaceLink: (p: React.ComponentProps<'a'>) => <a {...p} />,
}));
describe('Connected business reports', () => {
  beforeEach(() => {
    api.permissions = new Set(['sales.view', 'payables.view']);
    api.download.mockReset();
    api.get.mockReset().mockImplementation(async (path: string) =>
      path.endsWith('directory')
        ? { companies: [], divisions: [], branches: [] }
        : {
            kind: 'sales',
            generatedAt: '2026-09-28',
            basis: 'Current balances; original business records only.',
            rows: [
              {
                id: 'sale',
                reference: '=unsafe()',
                party: '+command',
                date: '2026-09-01',
                currency: 'TZS',
                amount: '100.30',
                paid: '0.30',
                balance: '100.00',
                status: 'CONFIRMED',
                href: '/sales-desk/sales/sale',
              },
            ],
            totals: [
              { currency: 'TZS', count: 1, amount: '100.30', paid: '0.30', balance: '100.00' },
            ],
          },
    );
  });
  it('uses original business records and exports safe CSV text', async () => {
    render(<BusinessReports />);
    expect(await screen.findByRole('link', { name: '=unsafe()' })).toHaveAttribute(
      'href',
      '/sales-desk/sales/sale',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(api.download.mock.calls[0][1]).toContain("'=unsafe()");
    expect(api.download.mock.calls[0][1]).toContain("'+command");
    expect(api.get.mock.calls.every(([path]) => !path.startsWith('/sales-desk'))).toBe(true);
    changeSelectField('Report', 'suppliers');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/desk-reports/business',
        expect.objectContaining({ query: { kind: 'suppliers' } }),
      ),
    );
  });
  it('does not offer or fetch unauthorised reports', () => {
    api.permissions.clear();
    render(<BusinessReports />);
    expect(screen.getByText(/does not have access/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

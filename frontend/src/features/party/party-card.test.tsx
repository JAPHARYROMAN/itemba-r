import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyCard } from './party-card';
import { openPartyIn } from './party-links';

const api = vi.hoisted(() => ({ get: vi.fn(), permissions: new Set<string>() }));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => api.permissions.has(p) }),
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  WorkspaceLink: (props: any) => <a {...props} />,
}));

beforeEach(() => {
  vi.resetAllMocks();
  api.permissions = new Set(['suppliers.view', 'cash_desk.view']);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  api.get.mockImplementation(async (path: string) =>
    path === '/suppliers/sup-1'
      ? {
          id: 'sup-1',
          name: 'Mwanjalisi Station',
          supplierCode: 'SUP-001',
          phone: '+255 700 000 000',
          email: null,
          status: 'ACTIVE',
        }
      : {
          kind: 'supplier',
          partyId: 'sup-1',
          total: [{ currency: 'TZS', amount: '1150.00' }],
          erp: [
            {
              currency: 'TZS',
              open: '1000.00',
              overdue: '400.00',
              current: '600.00',
              days1to30: '400.00',
              days31to60: '0.00',
              days61to90: '0.00',
              over90: '0.00',
              documents: 2,
            },
          ],
          desk: [],
          notebook: [],
          lastPaymentAt: '2026-09-30T00:00:00.000Z',
        },
  );
});

describe('PartyCard', () => {
  it('shows who the party is, the resolver balance and only the open-in actions the reader may use', async () => {
    render(<PartyCard kind="supplier" partyId="sup-1" onClose={vi.fn()} />);
    expect(await screen.findByRole('dialog', { name: 'Mwanjalisi Station' })).toBeInTheDocument();
    expect(screen.getByText('SUP-001')).toBeInTheDocument();
    expect(screen.getByText('+255 700 000 000')).toBeInTheDocument();
    expect(await screen.findByText('TZS 1,150.00')).toBeInTheDocument();
    expect(screen.getByText(/Overdue TZS 400\.00 · Last payment 30 Sept 2026/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open profile →' })).toHaveAttribute(
      'href',
      '/invoice-desk/suppliers/sup-1',
    );
    expect(screen.getByRole('link', { name: 'Cash Desk movements →' })).toHaveAttribute(
      'href',
      '/cash-desk?view=movements&supplierId=sup-1',
    );
    expect(screen.queryByRole('link', { name: 'NoteBook →' })).not.toBeInTheDocument();
  });

  it('reads nothing without profile access', () => {
    api.permissions.clear();
    render(<PartyCard kind="customer" partyId="cus-1" onClose={vi.fn()} />);
    expect(screen.getByText(/Profile access is needed/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });

  it('builds every open-in destination from one helper', () => {
    expect(openPartyIn('profile', 'customer', 'c 1')).toBe('/sales-desk/customers/c%201');
    expect(openPartyIn('records', 'supplier', 's1')).toBe('/records?supplierId=s1');
    expect(openPartyIn('statements', 'customer', 'c1')).toBe(
      '/crm/customer-statements?customerId=c1',
    );
  });
});

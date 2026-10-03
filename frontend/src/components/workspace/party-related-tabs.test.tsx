import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PartyRelatedTabs, relatedHref, type RelatedRow } from './party-related-tabs';

const api = vi.hoisted(() => ({ get: vi.fn(), permissions: new Set<string>() }));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => api.permissions.has(p) }),
}));
vi.mock('@/components/workspace/workspace-navigation', () => ({
  WorkspaceLink: (props: any) => <a {...props} />,
}));
const download = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/export-download', () => ({ downloadBinaryGet: download.get }));

beforeEach(() => {
  vi.resetAllMocks();
  api.permissions = new Set(['supplier-payments.view', 'cash_desk.view']);
  api.get.mockImplementation(async (path: string) =>
    path.endsWith('/payments')
      ? {
          section: 'payments',
          total: 1,
          rows: [
            {
              id: 'p1',
              number: 'SPY-3',
              date: '2026-09-30T00:00:00.000Z',
              amount: '100.00',
              currency: 'TZS',
              status: 'COMPLETED',
              detail: 'CASH',
              link: null,
            },
          ],
        }
      : {
          section: 'cash',
          total: 1,
          rows: [
            {
              id: 'm1',
              number: 'Fuel delivery',
              date: '2026-09-10T00:00:00.000Z',
              amount: '25.00',
              currency: 'TZS',
              status: 'EXPENSE',
              detail: 'R1',
              link: { kind: 'cash-movement', id: 'm1' },
            },
          ],
        },
  );
});

describe('PartyRelatedTabs', () => {
  it('shows only permitted sections, loads them lazily and links rows to their records', async () => {
    render(<PartyRelatedTabs kind="supplier" partyId="sup-1" />);
    expect(await screen.findByText('SPY-3')).toBeInTheDocument();
    expect(screen.queryByText('SPY-3', { selector: 'a' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Expenses' })).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls[0][0]).toBe('/party-profile/suppliers/sup-1/payments');
    fireEvent.click(screen.getByRole('button', { name: 'Cash Desk' }));
    expect(await screen.findByRole('link', { name: 'Fuel delivery' })).toHaveAttribute(
      'href',
      '/cash-desk?record=m1',
    );
    await waitFor(() =>
      expect(api.get.mock.calls[1][0]).toBe('/party-profile/suppliers/sup-1/cash'),
    );
  });

  it('maps record kinds to the pages and registers that can open them', () => {
    const row = (kind: string, id = 'x', number = 'EXP-7'): RelatedRow => ({
      id,
      number,
      date: null,
      amount: null,
      currency: null,
      status: null,
      detail: null,
      link: { kind, id },
    });
    expect(relatedHref(row('expense'))).toBe('/finance/expenses?search=EXP-7');
    expect(relatedHref(row('record', 'r1'))).toBe('/records?record=r1');
    expect(relatedHref(row('purchase-order', 'po1'))).toBe('/operations/purchase-orders/po1');
    expect(relatedHref(row('document', 'd1'))).toBe('/group-control/documents/d1');
    expect(relatedHref({ ...row('expense'), link: null })).toBeNull();
    expect(relatedHref(row('contact'))).toBeNull();
  });

  it('offers the party NoteBook statement only on the NoteBook section with export access', async () => {
    api.permissions = new Set(['records.view', 'records.export']);
    download.get.mockResolvedValue(undefined);
    api.get.mockResolvedValue({ section: 'notebook', total: 0, rows: [] });
    render(<PartyRelatedTabs kind="customer" partyId="cus 1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'NoteBook statement CSV' }));
    await waitFor(() =>
      expect(download.get).toHaveBeenCalledWith(
        '/records/party-statement/export?customerId=cus%201&format=csv',
        'notebook-statement.csv',
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Download started.');
  });

  it('downloads a remittance advice for a supplier payment (party linkage, Phase 3)', async () => {
    download.get.mockResolvedValue(undefined);
    render(<PartyRelatedTabs kind="supplier" partyId="sup-1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remittance PDF' }));
    await waitFor(() =>
      expect(download.get).toHaveBeenCalledWith(
        '/supplier-payments/p1/remittance?format=pdf',
        'remittance-SPY-3.pdf',
      ),
    );
    expect(await screen.findByRole('status')).toHaveTextContent('Download started.');
    fireEvent.click(screen.getByRole('button', { name: 'Cash Desk' }));
    await screen.findByRole('link', { name: 'Fuel delivery' });
    expect(screen.queryByRole('button', { name: 'Remittance PDF' })).not.toBeInTheDocument();
  });

  it('tells readers without any register permission that nothing is available', () => {
    api.permissions.clear();
    render(<PartyRelatedTabs kind="customer" partyId="cus-1" />);
    expect(screen.getByText(/No related sections are available/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

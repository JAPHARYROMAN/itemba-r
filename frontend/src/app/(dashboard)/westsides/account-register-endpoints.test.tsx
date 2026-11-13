import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Quotations from './quotations/page';
import ProformaInvoices from './proforma-invoices/page';

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    loading: false,
    hasPermission: (permission: string) => permission.endsWith('.view'),
  }),
}));

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: false });
});

describe.each([
  { Page: Quotations, resource: 'quotations', number: 'quotationNumber', date: 'quotationDate' },
  {
    Page: ProformaInvoices,
    resource: 'proforma-invoices',
    number: 'proformaNumber',
    date: 'proformaDate',
  },
])('$resource account register', ({ Page, resource, number, date }) => {
  it('loads every page from the Westsides API and preserves the individual transaction view', async () => {
    const documents = Array.from({ length: 21 }, (_, index) => ({
      id: `${resource}-${index}`,
      [number]: `DOC-${index}`,
      [date]: '2026-11-01',
      quotationType: 'GENERAL',
      validUntil: '2026-12-01',
      customerId: 'customer-a',
      customerName: 'Customer A',
      companyId: 'company-a',
      company: { name: 'Company A' },
      currency: 'USD',
      totalAmount: '10.00',
      status: 'DRAFT',
    }));
    const fetch = vi.fn(async (input: string) => {
      const url = new URL(input, 'http://localhost');
      if (url.pathname === '/api/backend/companies') {
        return { ok: true, json: async () => ({ success: true, data: [] }) };
      }
      if (url.pathname !== `/api/backend/westsides/${resource}`) {
        return { ok: false, status: 404, json: async () => ({ message: 'Unknown API route' }) };
      }
      const page = Number(url.searchParams.get('page') ?? 1);
      const limit = Number(url.searchParams.get('limit'));
      return {
        ok: true,
        json: async () => ({
          success: true,
          data: {
            data: documents.slice((page - 1) * limit, page * limit),
            total: documents.length,
            page,
            limit,
            totalPages: Math.ceil(documents.length / limit),
          },
        }),
      };
    });
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<Page />);

    const account = await screen.findByRole('button', { name: 'View transactions for Customer A' });
    expect(screen.getByText('USD 210.00')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(
      fetch.mock.calls.some(([url]) => {
        const request = new URL(url, 'http://localhost');
        return (
          request.pathname === `/api/backend/westsides/${resource}` &&
          request.searchParams.get('page') === '2'
        );
      }),
    ).toBe(true);

    await user.click(account);
    expect(screen.getByRole('button', { name: 'Inspect DOC-0' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Individual transactions' }));
    expect(screen.getByText('DOC-20')).toBeInTheDocument();
    expect(
      fetch.mock.calls.every(
        ([url]) =>
          !new URL(url, 'http://localhost').pathname.match(
            /^\/api\/backend\/(quotations|proforma-invoices)$/,
          ),
      ),
    ).toBe(true);
  });
});

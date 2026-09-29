import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { BusinessTransactionLink } from './business-transaction-link';
const api = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), permissions: new Set<string>() }));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => api.permissions.has(p) }),
}));
vi.mock('@/lib/api-client', () => ({ backendGet: api.get, backendPatch: api.patch }));
vi.mock('./workspace-navigation', () => ({
  WorkspaceLink: (p: React.ComponentProps<'a'>) => <a {...p} />,
}));
describe('Reviewed transaction links', () => {
  beforeEach(() => {
    api.get.mockReset().mockResolvedValue({
      data: [
        {
          id: 'business',
          supplierInvoiceNumber: 'INV-BUSINESS',
          currency: 'TZS',
          totalAmount: '123',
          status: 'APPROVED',
        },
      ],
    });
    api.patch.mockReset();
    api.permissions = new Set([
      'invoice_desk.manage',
      'supplier_invoices.view',
      'supplier_invoices.list',
      'suppliers.view',
    ]);
  });
  it('requires both source access and an explicit review before linking', async () => {
    const reload = vi.fn();
    render(<BusinessTransactionLink kind="invoice" id="old" companyId="company" reload={reload} />);
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Match to/ }));
    fireEvent.change(screen.getByLabelText('Find business reference'), {
      target: { value: 'INV' },
    });
    await screen.findByRole('option', { name: /INV-BUSINESS/ });
    fireEvent.change(screen.getByLabelText('Matching business transaction'), {
      target: { value: 'business' },
    });
    expect(screen.getByRole('button', { name: 'Link reviewed transaction' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox'));
    api.patch.mockResolvedValue({ id: 'old', canonicalId: 'business' });
    fireEvent.click(screen.getByRole('button', { name: 'Link reviewed transaction' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith('/invoice-desk/invoices/old/business-link', {
      canonicalId: 'business',
    });
  });
  it('explains a linked historical entry and directs to the real transaction', () => {
    render(
      <BusinessTransactionLink
        kind="sale"
        id="old"
        companyId="company"
        canonicalId="business"
        reload={vi.fn()}
      />,
    );
    expect(screen.getByRole('link')).toHaveAttribute('href', '/sales-desk/sales/business');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('does not request the canonical directory without its permission', () => {
    api.permissions.delete('suppliers.view');
    render(
      <BusinessTransactionLink kind="invoice" id="old" companyId="company" reload={vi.fn()} />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
});

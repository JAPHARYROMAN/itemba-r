import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Supplier-invoice void action regressions.
 *
 * - The void dialog PATCHes /supplier-invoices/:id/void with { reason } only
 *   when a reason was typed (the backend DTO's reason is optional, max 500).
 * - A backend guard rejection (only APPROVED voidable, payments applied,
 *   payable WRITTEN_OFF) is surfaced VERBATIM inside the dialog and the
 *   dialog stays open so the operator can read it.
 * - The row action is gated on supplier_invoices.void and only offered for
 *   APPROVED invoices — mirrors the backend void() status guard.
 */

const permissions = new Set<string>();
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ hasPermission: (p: string) => permissions.has(p) }),
}));

const backendList = vi.fn();
const backendPage = vi.fn();
const backendPatch = vi.fn();
vi.mock('@/lib/api-client', () => ({
  backendGet: vi.fn(),
  backendList: (path: string, options?: unknown) => backendList(path, options),
  backendPage: (path: string, options?: unknown) => backendPage(path, options),
  backendPatch: (path: string, body?: unknown) => backendPatch(path, body),
  backendPost: vi.fn(),
  backendPut: vi.fn(),
}));

vi.mock('@/lib/export-download', () => ({
  downloadTablePdf: vi.fn(),
}));

vi.mock('@/components/documents', () => ({
  DocumentArtifactButton: () => null,
}));

import SupplierInvoicesPage, { VoidInvoiceModal, type SupplierInvoice } from './page';

function invoice(overrides: Partial<SupplierInvoice> = {}): SupplierInvoice {
  return {
    id: 'si-1',
    supplierInvoiceNumber: 'INV-2026-001',
    companyId: 'co-1',
    supplierId: 'sup-1',
    invoiceDate: '2026-08-01T00:00:00.000Z',
    subtotal: 1000,
    taxAmount: 180,
    discountAmount: 0,
    totalAmount: 1180,
    paidAmount: 0,
    outstandingAmount: 1180,
    currency: 'TZS',
    status: 'APPROVED',
    supplier: { name: 'Mto Supplies' },
    company: { name: 'Westsides' },
    ...overrides,
  };
}

beforeEach(() => {
  permissions.clear();
  backendList.mockReset();
  backendPage.mockReset();
  backendPatch.mockReset();
  backendList.mockResolvedValue([]);
  backendPage.mockResolvedValue({ data: [], total: 0, page: 1, limit: 20, totalPages: 1 });
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)) as never;
    globalThis.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as never;
  }
});

describe('VoidInvoiceModal', () => {
  it('PATCHes the void endpoint with the trimmed reason and reports success', async () => {
    backendPatch.mockResolvedValue({});
    const onDone = vi.fn();
    render(<VoidInvoiceModal invoice={invoice()} onClose={() => {}} onDone={onDone} />);

    const textarea = screen.getByLabelText(/reason \(optional\)/i);
    expect(textarea).toHaveAttribute('maxlength', '500');
    fireEvent.change(textarea, { target: { value: '  entered against wrong PO  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void Invoice' }));

    await waitFor(() =>
      expect(backendPatch).toHaveBeenCalledWith('/supplier-invoices/si-1/void', {
        reason: 'entered against wrong PO',
      }),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('sends an empty body when no reason was given (reason is optional)', async () => {
    backendPatch.mockResolvedValue({});
    const onDone = vi.fn();
    render(<VoidInvoiceModal invoice={invoice()} onClose={() => {}} onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: 'Void Invoice' }));

    await waitFor(() =>
      expect(backendPatch).toHaveBeenCalledWith('/supplier-invoices/si-1/void', {}),
    );
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it('surfaces the backend guard message verbatim and keeps the dialog open', async () => {
    backendPatch.mockRejectedValue(
      new Error(
        'Cannot void a supplier invoice with payments applied to its payable. ' +
          'Reverse the supplier payment(s) before voiding the invoice.',
      ),
    );
    const onDone = vi.fn();
    render(<VoidInvoiceModal invoice={invoice()} onClose={() => {}} onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: 'Void Invoice' }));

    expect(
      await screen.findByText(
        'Cannot void a supplier invoice with payments applied to its payable. ' +
          'Reverse the supplier payment(s) before voiding the invoice.',
      ),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    // Still open: the confirm button remains available for a retry after fixing.
    expect(screen.getByRole('button', { name: 'Void Invoice' })).toBeInTheDocument();
  });
});

describe('SupplierInvoicesPage void action gating', () => {
  it('hides the Void action without supplier_invoices.void', async () => {
    permissions.add('supplier_invoices.list');
    backendPage.mockResolvedValue({
      data: [invoice()],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    render(<SupplierInvoicesPage />);

    await screen.findByText('INV-2026-001');
    expect(
      screen.queryByRole('button', { name: 'Void invoice INV-2026-001' }),
    ).not.toBeInTheDocument();
  });

  it('offers Void only for APPROVED invoices when permitted, and opens the dialog', async () => {
    permissions.add('supplier_invoices.list');
    permissions.add('supplier_invoices.void');
    backendPage.mockResolvedValue({
      data: [
        invoice(),
        invoice({ id: 'si-2', supplierInvoiceNumber: 'INV-2026-002', status: 'CANCELLED' }),
        invoice({ id: 'si-3', supplierInvoiceNumber: 'INV-2026-003', status: 'DRAFT' }),
      ],
      total: 3,
      page: 1,
      limit: 20,
      totalPages: 1,
    });

    render(<SupplierInvoicesPage />);

    const voidBtn = await screen.findByRole('button', { name: 'Void invoice INV-2026-001' });
    expect(
      screen.queryByRole('button', { name: 'Void invoice INV-2026-002' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Void invoice INV-2026-003' }),
    ).not.toBeInTheDocument();

    fireEvent.click(voidBtn);
    expect(await screen.findByText('Void invoice INV-2026-001')).toBeInTheDocument();
    expect(screen.getByLabelText(/reason \(optional\)/i)).toBeInTheDocument();
  });
});

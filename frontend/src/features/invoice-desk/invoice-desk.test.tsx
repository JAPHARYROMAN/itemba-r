import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { InvoiceDesk } from './invoice-desk';
import { DeskEditor } from './desk-editor';
import { money, type Invoice } from './types';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { UnsavedWorkProvider } from '@/components/workspace/unsaved-work-provider';
import { WorkspaceDraftsProvider } from '@/components/workspace/workspace-drafts';

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => navigation,
  usePathname: () => '/invoice-desk',
}));

const api = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  upload: vi.fn(),
  permissions: new Set<string>(),
}));
vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({
    user: { id: 'invoice-reader' },
    hasPermission: (p: string) => api.permissions.has(p),
  }),
}));
vi.mock('@/lib/api-client', () => ({
  backendGet: api.get,
  backendPost: api.post,
  backendPatch: api.patch,
  backendUpload: api.upload,
}));
const directory = {
  companies: [
    { id: 'company', name: 'Example company' },
    { id: 'other', name: 'Other company' },
  ],
  divisions: [{ id: 'division', name: 'Retail', companyId: 'company' }],
  branches: [{ id: 'branch', name: 'Central', divisionId: 'division', companyId: 'company' }],
};
const scope = { companyId: 'company', divisionId: 'division', branchId: 'branch' };
const row: Invoice = {
  ...scope,
  id: 'invoice',
  supplierId: 'supplier',
  invoiceNumber: 'INV-0042',
  description: 'Workshop supplies',
  currency: 'TZS',
  invoiceDate: '2026-09-01',
  dueDate: '2026-09-10',
  totalAmount: '1250000.50',
  paidAmount: '250000.00',
  outstanding: '1000000.50',
  status: 'Overdue',
  version: 2,
  voidedAt: null,
  company: { name: 'Example company' },
  division: { name: 'Retail' },
  branch: { name: 'Central' },
  supplier: { id: 'supplier', name: 'Example Supplies' },
  payments: [
    {
      id: 'payment',
      amount: '250000.00',
      paymentDate: '2026-09-02',
      method: 'Bank transfer',
      reference: 'REF-42',
      reversedAt: null,
      reversalReason: null,
    },
  ],
  events: [
    {
      id: 'event',
      actorName: 'Example user',
      action: 'CREATED',
      detail: 'Invoice recorded',
      createdAt: '2026-09-01',
    },
  ],
  attachments: [],
};
function capture(name: string) {
  const dir = process.env.ITEMBA_PAYROLL_VISUAL_DIR;
  if (dir) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name + '.html'), document.body.innerHTML);
  }
}
beforeEach(() => {
  vi.resetAllMocks();
  api.permissions = new Set(['invoice_desk.view', 'invoice_desk.manage', 'invoice_desk.payments']);
  window.matchMedia = vi
    .fn()
    .mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  api.get.mockImplementation(async (path: string) =>
    path.endsWith('directory')
      ? directory
      : path.endsWith('overview')
        ? {
            currencies: [
              {
                currency: 'TZS',
                total: '1250000.50',
                paid: '250000.00',
                outstanding: '1000000.50',
                overdue: '1000000.50',
                due: '0',
                count: 1,
              },
              {
                currency: 'USD',
                total: '50',
                paid: '0',
                outstanding: '50',
                overdue: '0',
                due: '50',
                count: 1,
              },
            ],
            suppliers: [
              {
                id: 'supplier',
                name: 'Example Supplies',
                currency: 'TZS',
                outstanding: '1000000.50',
                count: 1,
              },
            ],
          }
        : path.endsWith('invoices')
          ? { rows: [row], total: 1, page: 1, pageSize: 25 }
          : path.endsWith('suppliers')
            ? [{ id: 'supplier', name: 'Example Supplies', companyId: 'company' }]
            : row,
  );
  api.post.mockResolvedValue({ id: 'saved' });
});
describe('Invoice Desk experience', () => {
  it('previews an attachment in the invoice and returns focus without closing its details', async () => {
    const fallback = api.get.getMockImplementation()!;
    api.get.mockImplementation((path, ...args) =>
      path.endsWith('/attachments/file/preview')
        ? Promise.resolve({ kind: 'download', note: 'Download this file to inspect the original.' })
        : path === '/invoice-desk/invoices/invoice'
          ? Promise.resolve({
              ...row,
              attachments: [
                { id: 'file', name: 'Original.pdf', size: 200, mimeType: 'application/pdf' },
              ],
            })
          : fallback(path, ...args),
    );
    render(<InvoiceDesk targetRecordId="invoice" />);
    const events = userEvent.setup();
    const trigger = await screen.findByRole('button', { name: 'Preview Original.pdf' });
    await events.click(trigger);
    await screen.findByText('Download this file to inspect the original.');
    expect(api.get).toHaveBeenCalledWith(
      '/invoice-desk/invoices/invoice/attachments/file/preview',
      expect.anything(),
    );
    await events.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'INV-0042' })).toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(api.post).not.toHaveBeenCalled();
  });
  it('opens a searched invoice directly and clears its route on close', async () => {
    render(<InvoiceDesk targetRecordId="invoice" />);
    await screen.findByRole('dialog', { name: 'INV-0042' });
    expect(api.get).toHaveBeenCalledWith(
      '/invoice-desk/invoices/invoice',
      expect.objectContaining({ query: {} }),
    );
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }));
    expect(navigation.replace).toHaveBeenCalledWith('/invoice-desk', { scroll: false });
  });
  it('keeps full decimal precision when displaying large balances', () =>
    expect(money('9999999999999999.99', 'TZS')).toBe('TZS 9,999,999,999,999,999.99'));
  it('does not fetch or expose app actions without app access', () => {
    api.permissions.clear();
    render(<InvoiceDesk />);
    expect(screen.getByText(/You need Invoice Desk access/)).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
  });
  it('presents currency-specific balances without combining them', async () => {
    render(<InvoiceDesk />);
    await screen.findByLabelText('Overview currency');
    expect(screen.getAllByText('TZS 1,000,000.50').length).toBeGreaterThan(1);
    capture('invoice-desk');
    fireEvent.change(screen.getByLabelText('Overview currency'), { target: { value: 'USD' } });
    expect(screen.getByRole('button', { name: /Total outstanding USD 50.00/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Total outstanding TZS/ })).not.toBeInTheDocument();
  });
  it('resets division and branch when the company changes', async () => {
    render(<InvoiceDesk />);
    await screen.findByRole('option', { name: 'Example company' });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'company' } });
    fireEvent.change(screen.getByLabelText('Division'), { target: { value: 'division' } });
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'branch' } });
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'other' } });
    expect(screen.getByLabelText('Division')).toHaveValue('');
    expect(screen.getByLabelText('Branch')).toHaveValue('');
    await waitFor(() =>
      expect(api.get).toHaveBeenCalledWith(
        '/invoice-desk/overview',
        expect.objectContaining({ query: { companyId: 'other' } }),
      ),
    );
  });
  it('opens an invoice with payment history and app-specific actions', async () => {
    render(<InvoiceDesk />);
    fireEvent.click(await screen.findByRole('button', { name: /INV-0042 Example Supplies/ }));
    const modal = await screen.findByRole('dialog');
    await within(modal).findByText('Workshop supplies');
    expect(within(modal).getByText(/REF-42/)).toBeInTheDocument();
    expect(within(modal).getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
    capture('invoice-desk-details');
    expect(within(modal).queryByRole('button', { name: 'Void invoice' })).not.toBeInTheDocument();
  });
  it('hides write actions for a read-only app user', async () => {
    api.permissions = new Set(['invoice_desk.view']);
    render(<InvoiceDesk />);
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /INV-0042 Example Supplies/ }));
    await screen.findByText('Workshop supplies');
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Attach invoice document')).not.toBeInTheDocument();
  });
  it('offers an honest empty state with supplier-first onboarding', async () => {
    api.get.mockImplementation(async (path: string) =>
      path.endsWith('directory')
        ? directory
        : path.endsWith('overview')
          ? { currencies: [], suppliers: [] }
          : { rows: [], total: 0 },
    );
    render(<InvoiceDesk />);
    await screen.findByText('A fresh start for your invoices.');
    expect(screen.getByRole('button', { name: /Add your first supplier/ })).toBeInTheDocument();
    expect(screen.queryByText(/1,000,000/)).not.toBeInTheDocument();
  });
  it('keeps the same payment request ID on retry and prevents double submissions', async () => {
    api.post
      .mockRejectedValueOnce(new Error('Connection interrupted'))
      .mockResolvedValue({ id: 'payment' });
    const saved = vi.fn();
    render(
      <DeskEditor
        kind="payment"
        scope={scope}
        directory={directory}
        invoice={row}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    await screen.findByRole('alert');
    const key = api.post.mock.calls[0][1].requestId;
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Record a payment' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.mock.calls[1][1]).toMatchObject({
      requestId: key,
      amount: '1000000.50',
      version: 2,
    });
  });
  it('shows loading failures with retry instead of a false zero balance', async () => {
    api.get.mockRejectedValue(new Error('Service unavailable'));
    render(<InvoiceDesk />);
    await screen.findAllByText('Service unavailable');
    expect(screen.queryByText('A fresh start for your invoices.')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Try again' }).length).toBeGreaterThan(0);
  });
  it('edits invoice details without changing its organisation or supplier', async () => {
    api.patch.mockResolvedValue({ id: 'invoice' });
    const saved = vi.fn();
    render(
      <DeskEditor
        kind="edit"
        scope={scope}
        directory={directory}
        invoice={{ ...row, payments: [], paidAmount: '0', version: 1 }}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );
    expect(screen.getByLabelText(/Supplier invoice number/)).toHaveValue('INV-0042');
    fireEvent.change(screen.getByLabelText(/What was purchased/), {
      target: { value: 'Corrected purchase' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));
    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1]).toMatchObject({
      description: 'Corrected purchase',
      version: 1,
    });
    expect(api.patch.mock.calls[0][1]).not.toHaveProperty('companyId');
  });
  it('edits invoice dates in the page rather than through the native picker', async () => {
    // Invoice Desk is where opening the native picker crashed the in-app
    // browser during acceptance, so it is the surface the replacement has to
    // hold on. Both date fields must be operable without a native picker, read
    // back in Tanzanian order, and still send plain ISO to the API.
    api.patch.mockResolvedValue({ id: 'invoice' });
    const saved = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <DeskEditor
        kind="edit"
        scope={scope}
        directory={directory}
        invoice={{ ...row, payments: [], paidAmount: '0', version: 1 }}
        onClose={vi.fn()}
        onSaved={saved}
      />,
    );

    // One inert submission shim per field, and nothing else native.
    const natives = container.querySelectorAll('input[type="date"]');
    expect(natives).toHaveLength(2);
    for (const shim of natives) {
      expect((shim as HTMLInputElement).tabIndex).toBe(-1);
      expect(shim.parentElement).toHaveAttribute('aria-hidden', 'true');
    }

    const invoiceDate = screen.getByRole('group', { name: /Invoice date/ });
    expect(invoiceDate).toHaveTextContent('01/09/2026');

    await user.click(within(invoiceDate).getAllByRole('spinbutton')[0]);
    await user.keyboard('05');
    fireEvent.click(screen.getByRole('button', { name: 'Edit invoice' }));

    await waitFor(() => expect(saved).toHaveBeenCalled());
    expect(api.patch.mock.calls[0][1]).toMatchObject({ invoiceDate: '2026-09-05' });
  });
  it('resumes a payment after app switching with fresh source data and requires review before saving', async () => {
    const user = userEvent.setup();
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
    function Workspace() {
      const [invoices, setInvoices] = useState(true);
      return (
        <UnsavedWorkProvider>
          <WorkspaceDraftsProvider>
            <button onClick={() => setInvoices((value) => !value)}>Switch workspace</button>
            {invoices ? <InvoiceDesk /> : <p>Another app</p>}
          </WorkspaceDraftsProvider>
        </UnsavedWorkProvider>
      );
    }
    render(<Workspace />);
    await user.click(await screen.findByRole('button', { name: /INV-0042 Example Supplies/ }));
    await user.click(await screen.findByRole('button', { name: 'Record payment', exact: true }));
    await user.clear(screen.getByLabelText(/Amount \(TZS\)/));
    await user.type(screen.getByLabelText(/Amount \(TZS\)/), '750');
    await user.type(screen.getByLabelText('Payment reference'), 'Branch draft reference');
    await user.click(screen.getByRole('button', { name: 'Keep draft', exact: true }));
    // Keeping a payment returns to the invoice detail. Close that detail before switching.
    const details = screen.queryByRole('dialog', { name: /INV-0042/ });
    if (details)
      await user.click(within(details).getByRole('button', { name: 'Close', exact: true }));
    await user.click(screen.getByText('Switch workspace'));
    const originalGet = api.get.getMockImplementation()!;
    api.get.mockImplementation(async (...args) =>
      args[0] === '/invoice-desk/invoices/invoice'
        ? { ...row, version: 3, outstanding: '900000.50' }
        : originalGet(...args),
    );
    await user.click(screen.getByText('Switch workspace'));
    await user.click(await screen.findByRole('button', { name: 'Resume Invoice payment' }));
    expect(await screen.findByLabelText('Payment reference')).toHaveValue('Branch draft reference');
    expect(screen.getByLabelText(/Amount \(TZS\)/)).toHaveValue('750');
    expect(screen.getByText('The source record has changed.')).toBeVisible();
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Record a payment', exact: true }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Review the latest record');
    expect(api.post).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox', { name: /I have reviewed/ }));
    api.post.mockResolvedValue({ id: 'payment' });
    await user.click(screen.getByRole('button', { name: 'Record a payment', exact: true }));
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/invoice-desk/invoices/invoice/payments',
        expect.objectContaining({ amount: '750', reference: 'Branch draft reference', version: 3 }),
      ),
    );
    expect(
      screen.queryByRole('button', { name: 'Resume Invoice payment' }),
    ).not.toBeInTheDocument();
  });
});

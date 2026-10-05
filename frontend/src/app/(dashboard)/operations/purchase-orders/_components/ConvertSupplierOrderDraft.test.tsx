import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import { ConvertSupplierOrderDraft } from './ConvertSupplierOrderDraft';
import type { SupplierOrderDraft } from './supplier-order-draft-types';

const api = vi.hoisted(() => ({ list: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ backendList: api.list, backendPost: api.post }));
vi.mock('@/components/workspace/unsaved-work-provider', () => ({
  useFormGuard: () => ({
    touch: vi.fn(),
    markSaved: vi.fn(),
    requestClose: (close: () => void) => close(),
  }),
}));
vi.mock('@/components/ui/product-picker', () => ({
  ProductPicker: ({ onChange, ariaLabel }: any) => (
    <button aria-label={ariaLabel} onClick={() => onChange('product-1')}>
      Choose product
    </button>
  ),
}));
vi.mock('@/components/ui', () => ({
  Modal: ({ children, footer }: any) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  Btn: ({ children, loading: _loading, variant: _variant, ...props }: any) => (
    <button {...props}>{children}</button>
  ),
  FormInput: ({ label, ...props }: any) => (
    <label>
      {label}
      <input {...props} />
    </label>
  ),
  FormSelect: ({ label, placeholder, children, ...props }: any) => (
    <label>
      {label}
      <select {...props}>
        <option value="">{placeholder}</option>
        {children}
      </select>
    </label>
  ),
  FormDateField: ({ label, onChange, ...props }: any) => (
    <label>
      {label}
      <input {...props} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
  SupplierPicker: () => <span>Supplier picker</span>,
}));

const source = {
  id: 'draft-1',
  draftNumber: 'SOD-1',
  companyId: 'company-1',
  divisionId: 'division-1',
  branchId: 'branch-1',
  supplierId: 'supplier-1',
  supplierName: 'Supplier One',
  currency: 'TZS',
  lines: [
    {
      id: 'line-1',
      description: 'Cement',
      quantity: '3',
      unitLabel: 'bags',
      unitPrice: '120',
      discountAmount: '10',
      taxAmount: '5',
    },
  ],
} as SupplierOrderDraft;

beforeEach(() => {
  api.list.mockReset();
  api.post.mockReset();
  api.list.mockImplementation((route: string) =>
    Promise.resolve(
      route === '/divisions'
        ? [{ id: 'division-1', name: 'Division' }]
        : route === '/branches'
          ? [{ id: 'branch-1', divisionId: 'division-1', name: 'Branch' }]
          : [{ id: 'unit-1', name: 'Bag' }],
    ),
  );
  api.post.mockResolvedValue({
    id: 'po-1',
    purchaseOrderNumber: 'PO-1',
    internalInvoiceNumber: 'PINV-1',
  });
});

it('keeps the source scope and priced cost fixed and requires product matching', async () => {
  render(<ConvertSupplierOrderDraft draft={source} onClose={vi.fn()} onConverted={vi.fn()} />);
  await waitFor(() => expect(screen.getByText('Create Purchase Order')).toBeEnabled());
  expect(screen.getByLabelText('Division')).toBeDisabled();
  expect(screen.getByLabelText('Branch')).toBeDisabled();
  expect(screen.getByLabelText('Unit Cost (TZS) for item 1')).toBeDisabled();
  fireEvent.click(screen.getByText('Create Purchase Order'));
  expect(screen.getByRole('alert')).toHaveTextContent('Match every item');
  expect(api.post).not.toHaveBeenCalled();
});

it('submits the exact source quantities and totals with supplier linkage and an optional invoice', async () => {
  const done = vi.fn();
  render(<ConvertSupplierOrderDraft draft={source} onClose={vi.fn()} onConverted={done} />);
  await waitFor(() => expect(screen.getByText('Create Purchase Order')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Product for Cement'));
  fireEvent.change(screen.getByLabelText('Unit for item 1'), { target: { value: 'unit-1' } });
  fireEvent.change(screen.getByLabelText('Supplier Invoice # (optional)'), {
    target: { value: ' SUP-INV-9 ' },
  });
  fireEvent.click(screen.getByText('Create Purchase Order'));
  await waitFor(() => expect(done).toHaveBeenCalledWith(expect.objectContaining({ id: 'po-1' })));
  expect(api.post).toHaveBeenCalledWith(
    '/purchase-orders/from-draft/draft-1',
    expect.objectContaining({
      companyId: 'company-1',
      supplierId: 'supplier-1',
      purchaseType: 'STOCK_PURCHASE',
      supplierInvoiceNumber: 'SUP-INV-9',
      lines: [
        {
          sourceDraftLineId: 'line-1',
          productId: 'product-1',
          unitId: 'unit-1',
          unitCost: 120,
          quantity: 3,
          discountAmount: 10,
          taxAmount: 5,
        },
      ],
    }),
  );
});

it('lets an unpriced line receive a cost and leaves invoice generation to the server', async () => {
  render(
    <ConvertSupplierOrderDraft
      draft={{ ...source, lines: [{ ...source.lines[0], unitPrice: null }] }}
      onClose={vi.fn()}
      onConverted={vi.fn()}
    />,
  );
  await waitFor(() => expect(screen.getByText('Create Purchase Order')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Product for Cement'));
  fireEvent.change(screen.getByLabelText('Unit for item 1'), { target: { value: 'unit-1' } });
  fireEvent.change(screen.getByLabelText('Unit Cost (TZS) for item 1'), {
    target: { value: '95' },
  });
  fireEvent.click(screen.getByText('Create Purchase Order'));
  await waitFor(() => expect(api.post).toHaveBeenCalled());
  expect(api.post.mock.calls[0][1].supplierInvoiceNumber).toBeUndefined();
  expect(api.post.mock.calls[0][1].lines[0].unitCost).toBe(95);
});

it('reports conversion failures and keeps the form available to retry', async () => {
  api.post.mockRejectedValue(new Error('Invoice already recorded'));
  const done = vi.fn();
  render(<ConvertSupplierOrderDraft draft={source} onClose={vi.fn()} onConverted={done} />);
  await waitFor(() => expect(screen.getByText('Create Purchase Order')).toBeEnabled());
  fireEvent.click(screen.getByLabelText('Product for Cement'));
  fireEvent.change(screen.getByLabelText('Unit for item 1'), { target: { value: 'unit-1' } });
  fireEvent.click(screen.getByText('Create Purchase Order'));
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('Invoice already recorded'),
  );
  expect(done).not.toHaveBeenCalled();
  expect(screen.getByText('Create Purchase Order')).toBeEnabled();
});

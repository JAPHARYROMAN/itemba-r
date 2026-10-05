import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DraftInspector } from './draft-inspector';
import { contextFixture, draftFixture } from './test-fixtures';
import type { Draft } from './types';

const posted: Draft = {
  ...draftFixture,
  status: 'POSTED',
  allowedActions: [],
  pendingMoney: 0,
  postedEntityType: 'SalesOrder',
  postedEntityId: 'posted-sale',
  payload: {
    ...draftFixture.payload,
    salesOrderId: 'related-sale',
    purchaseOrderId: 'purchase',
    productId: 'product',
  },
  duplicateCandidates: [
    {
      id: 'candidate',
      requestId: 'candidate-request',
      originUserId: 'another-operator',
      businessDate: '2026-10-04',
      status: 'POSTED',
      amount: 100,
    },
  ],
};
const callbacks = () => ({
  decide: vi.fn(),
  onChanged: vi.fn(),
  onClose: vi.fn(),
  onReceipt: vi.fn(async () => undefined),
});

describe('staff request references', () => {
  it('shows the captured list and charged prices without removing administrator decisions', () => {
    render(
      <DraftInspector
        draft={{
          ...draftFixture,
          payload: {
            ...draftFixture.payload,
            lines: [{ productId: 'product', quantity: 1, unitPrice: 90, listUnitPrice: 100 }],
          },
        }}
        context={contextFixture}
        {...callbacks()}
      />,
    );
    expect(screen.getByText('TZS 90 each')).toBeVisible();
    expect(screen.getByText('List price TZS 100 each')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Approve and send to stockist' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reject request' })).toBeVisible();
  });
  it('keeps canonical names and the posted receipt without office-only links', async () => {
    const events = callbacks();
    render(
      <DraftInspector draft={posted} context={contextFixture} officeLinks={false} {...events} />,
    );
    expect(screen.queryAllByRole('link')).toEqual([]);
    expect(screen.getByText('Customer A')).toBeVisible();
    expect(screen.getByText('PO-001')).toBeVisible();
    expect(screen.getAllByText('Cement').length).toBeGreaterThan(0);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Print posted receipt' }));
    expect(events.onReceipt).toHaveBeenCalledWith(posted);
  });
  it('preserves record navigation for the office inspector by default', () => {
    render(<DraftInspector draft={posted} context={contextFixture} {...callbacks()} />);
    expect(screen.getByRole('link', { name: 'Customer A' })).toHaveAttribute(
      'href',
      '/sales-desk/customers/customer',
    );
    expect(screen.getByRole('link', { name: 'PO-001' })).toHaveAttribute(
      'href',
      '/operations/purchase-orders/purchase',
    );
    expect(screen.getByRole('link', { name: 'Open posted document' })).toHaveAttribute(
      'href',
      '/sales-desk/sales/posted-sale',
    );
    expect(screen.getAllByRole('link', { name: 'Cement' })).toHaveLength(2);
  });
});

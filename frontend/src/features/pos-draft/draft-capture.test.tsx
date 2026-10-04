import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import { DraftCapture } from './draft-capture';
import { DraftInspector } from './draft-inspector';
import { contextFixture, draftFixture } from './test-fixtures';
vi.mock('@/features/pos/hardware/scanner', () => ({ useScanner: () => undefined }));
describe('role-specific approval capture', () => {
  it('shows only sale and collection to a cashier, using configured payment methods', () => {
    render(
      <DraftCapture context={contextFixture} role="CASHIER" send={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Sale', exact: true })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Collection', exact: true })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Stock receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bank transfer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Credit', exact: true })).not.toBeInTheDocument();
  });
  it('reviews the inherited whole purchase order and requires full arrival confirmation', async () => {
    const user = userEvent.setup(),
      send = vi.fn(async () => draftFixture);
    render(<DraftCapture context={contextFixture} role="STOCKIST" send={send} onSaved={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Stock receipt' }));
    await user.selectOptions(screen.getByLabelText('Confirmed purchase order'), 'purchase');
    expect(screen.getByText('Supplier A', { exact: true })).toBeVisible();
    expect(screen.getByText('Pay in 30 days', { exact: false })).toBeVisible();
    expect(screen.getByText('10 × TZS 75')).toBeVisible();
    expect(screen.queryByLabelText('Unit cost')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review request' }));
    expect(screen.getByRole('alert')).toHaveTextContent('every item');
    expect(send).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Review request' }));
    await user.click(screen.getByRole('button', { name: 'Submit request' }));
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'RECEIPT',
        payload: { purchaseOrderId: 'purchase', fullOrderArrived: true },
      }),
      undefined,
    );
  });
  it('keeps final posting and printing unavailable before final approval', () => {
    const receipt = vi.fn();
    render(
      <DraftInspector
        draft={draftFixture}
        context={contextFixture}
        decide={vi.fn()}
        onChanged={vi.fn()}
        onClose={vi.fn()}
        onReceipt={receipt}
      />,
    );
    expect(screen.getByText('This request has not posted money or stock.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Print posted receipt' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve and send to stockist' })).toBeVisible();
  });
  it('requires duplicate review before approval and sends the current revision', async () => {
    const user = userEvent.setup(),
      decide = vi.fn(async () => ({
        ...draftFixture,
        status: 'AWAITING_STOCKIST' as const,
        revision: 2,
      }));
    render(
      <DraftInspector
        draft={{
          ...draftFixture,
          duplicateCandidates: [
            {
              id: 'other',
              requestId: 'other-request',
              originUserId: 'other',
              businessDate: '2026-10-04',
              amount: 100,
              status: 'SUBMITTED',
            },
          ],
        }}
        context={contextFixture}
        decide={decide}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const approve = screen.getByRole('button', { name: 'Approve and send to stockist' });
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole('checkbox'));
    await user.type(
      screen.getByLabelText('Why is this a separate request?'),
      'Separate customer payment',
    );
    await user.click(approve);
    expect(decide).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole('button', { name: 'Confirm · Approve and send to stockist' }),
    );
    expect(decide).toHaveBeenCalledWith('draft', 'approve', {
      revision: 1,
      reviewedCandidateIds: ['other'],
      duplicateReason: 'Separate customer payment',
    });
  });
  it('labels capture controls accessibly', async () => {
    const { container } = render(
      <DraftCapture context={contextFixture} role="CASHIER" send={vi.fn()} onSaved={vi.fn()} />,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
  it('keeps rejected money pending and requires full return verification before clearing the task', async () => {
    const user = userEvent.setup(),
      decide = vi.fn(async () => ({
        ...draftFixture,
        status: 'REJECTED' as const,
        revision: 3,
        pendingMoney: 0,
      }));
    render(
      <DraftInspector
        draft={{
          ...draftFixture,
          status: 'REJECTED',
          revision: 2,
          allowedActions: ['confirm-return'],
        }}
        context={contextFixture}
        decide={decide}
        onChanged={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/remains with the operator/)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: 'Confirm full funds returned', exact: true }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('full funds');
    expect(decide).not.toHaveBeenCalled();
    await user.click(screen.getByRole('checkbox'));
    await user.type(
      screen.getByLabelText('Return verification'),
      'Returned to customer and verified',
    );
    await user.type(screen.getByLabelText('Return reference · optional'), 'RETURN-001');
    await user.click(
      screen.getByRole('button', { name: 'Confirm full funds returned', exact: true }),
    );
    expect(decide).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirm · Confirm full funds returned' }));
    expect(decide).toHaveBeenCalledWith('draft', 'confirm-return', {
      revision: 2,
      reason: 'Returned to customer and verified',
      reference: 'RETURN-001',
      fundsReturned: true,
    });
  });
});

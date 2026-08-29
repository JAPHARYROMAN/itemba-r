import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * Credit-note create modal — per-line "Return to stock" opt-in.
 *
 * The backend CreateCreditNoteLineDto accepts optional returnedQuantity /
 * restockUnitCost: returnedQuantity requires a productId, must be > 0 and <=
 * the credited line quantity; restockUnitCost (when given) must be > 0 and is
 * otherwise resolved server-side from the original sale's cost basis. The
 * payload contract this file locks down:
 *
 * - restock fields are sent ONLY for lines the operator opted in — an
 *   unchecked (or later unchecked) line stays a pure financial credit with no
 *   returnedQuantity / restockUnitCost keys at all;
 * - a blank restock cost is OMITTED (backend auto-cost), never sent as 0;
 * - the cap (returnedQuantity <= quantity) is enforced inline and blocks the
 *   POST entirely.
 */

const backendGet = vi.fn();
const backendList = vi.fn();
const backendPost = vi.fn();
const backendPatch = vi.fn();

vi.mock('@/lib/api-client', () => ({
  backendGet: (...args: unknown[]) => backendGet(...args),
  backendList: (...args: unknown[]) => backendList(...args),
  backendPost: (...args: unknown[]) => backendPost(...args),
  backendPatch: (...args: unknown[]) => backendPatch(...args),
}));

import { CreateModal } from './page';

const COMPANY = { id: 'co-1', name: 'Itemba Ltd' };

const PRODUCT = {
  id: 'p-1',
  name: 'Portland Cement 42.5kg',
  productCode: 'CEM-425',
  defaultUnitId: 'unit-bag',
};

beforeEach(() => {
  vi.clearAllMocks();
  backendGet.mockResolvedValue(undefined);
  backendList.mockImplementation(async (path: string) => {
    if (path === '/customers') return [];
    if (path === '/products') return [PRODUCT];
    return [];
  });
  backendPost.mockResolvedValue({ id: 'cn-1' });
  if (!globalThis.requestAnimationFrame) {
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)) as unknown as typeof requestAnimationFrame;
    globalThis.cancelAnimationFrame = ((id: number) =>
      clearTimeout(id)) as unknown as typeof cancelAnimationFrame;
  }
});

/** Fill the minimum valid form: company, customer name, line 1 qty 5 @ 100. */
function fillBaseForm() {
  fireEvent.change(screen.getByLabelText(/Company/), { target: { value: 'co-1' } });
  fireEvent.change(screen.getByLabelText(/Customer Name/), { target: { value: 'Walk-in' } });
  fireEvent.change(screen.getByLabelText('Line 1 description'), {
    target: { value: 'Returned goods' },
  });
  fireEvent.change(screen.getByLabelText('Line 1 quantity'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Line 1 unit price'), { target: { value: '100' } });
}

/** Opt line 1 into return-to-stock and pick the mocked product. */
async function optInAndPickProduct() {
  fireEvent.click(screen.getByLabelText('Line 1 return to stock'));
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Line 1 returned product' }));
  await user.click(await screen.findByText('Portland Cement 42.5kg'));
  // Product chosen -> the returned-quantity input is revealed.
  return screen.findByLabelText('Line 1 returned quantity');
}

function postedBody(): any {
  const call = backendPost.mock.calls.find((c) => c[0] === '/credit-notes');
  expect(call).toBeTruthy();
  return call![1];
}

describe('Credit-note CreateModal — return-to-stock payload shape', () => {
  it('sends returnedQuantity (with productId) only for the opted-in line and omits a blank restock cost', async () => {
    render(<CreateModal companies={[COMPANY]} onClose={() => {}} onSaved={() => {}} />);
    fillBaseForm();

    const returnedInput = await optInAndPickProduct();
    fireEvent.change(returnedInput, { target: { value: '3' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(backendPost).toHaveBeenCalled());
    const body = postedBody();
    expect(body.lines).toHaveLength(1);
    expect(body.lines[0]).toMatchObject({
      productId: 'p-1',
      unitId: 'unit-bag',
      quantity: 5,
      unitPrice: 100,
      returnedQuantity: 3,
    });
    // Blank cost means "let the backend resolve the original sale cost".
    expect(body.lines[0]).not.toHaveProperty('restockUnitCost');
  });

  it('enforces the credited-quantity cap inline and blocks the POST, then sends an explicit restock cost', async () => {
    render(<CreateModal companies={[COMPANY]} onClose={() => {}} onSaved={() => {}} />);
    fillBaseForm();

    const returnedInput = await optInAndPickProduct();

    // 6 returned > 5 credited: inline error mirrors the DTO/service cap.
    fireEvent.change(returnedInput, { target: { value: '6' } });
    expect(
      await screen.findByText('Returned quantity cannot exceed the credited quantity (5)'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));
    expect(
      await screen.findByText('Line 1: returned quantity cannot exceed the credited quantity'),
    ).toBeInTheDocument();
    expect(backendPost).not.toHaveBeenCalled();

    // Fix the quantity and give an explicit cost — both must land in the body.
    fireEvent.change(returnedInput, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Line 1 restock unit cost'), {
      target: { value: '60' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(backendPost).toHaveBeenCalled());
    const body = postedBody();
    expect(body.lines[0].returnedQuantity).toBe(3);
    expect(body.lines[0].restockUnitCost).toBe(60);
  });

  it('drops the restock fields entirely when the opt-in is unchecked again', async () => {
    render(<CreateModal companies={[COMPANY]} onClose={() => {}} onSaved={() => {}} />);
    fillBaseForm();

    const returnedInput = await optInAndPickProduct();
    fireEvent.change(returnedInput, { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Line 1 restock unit cost'), {
      target: { value: '60' },
    });

    // Change of mind: pure financial credit after all.
    fireEvent.click(screen.getByLabelText('Line 1 return to stock'));
    expect(screen.queryByLabelText('Line 1 returned quantity')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create Draft' }));

    await waitFor(() => expect(backendPost).toHaveBeenCalled());
    const body = postedBody();
    expect(body.lines[0]).not.toHaveProperty('returnedQuantity');
    expect(body.lines[0]).not.toHaveProperty('restockUnitCost');
    // The picked product stays a plain line link — harmless without a return.
    expect(body.lines[0].productId).toBe('p-1');
  });
});

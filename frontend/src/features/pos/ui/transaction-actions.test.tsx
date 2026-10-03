import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransactionActions, type TransactionDetail } from './TransactionActions';
import type { PosTranslate, Session } from '../core/pos-types';
import { deviceDatabase, deviceLocks } from '../core/testing/device-database';
import { readPosAction } from '../core/pos-actions-store';
const h = vi.hoisted(() => ({ db: null as unknown as IDBDatabase, get: vi.fn(), post: vi.fn() }));
vi.mock('@/lib/mobile-pos-lite-store', () => ({ openDatabase: async () => h.db }));
vi.mock('@/lib/api-client', () => ({ backendGet: h.get, backendPost: h.post }));
const session = {
  terminal: { id: 't', code: 'T' },
  company: { id: 'c' },
  division: { id: 'd' },
  branch: { id: 'b' },
  rep: { id: 'u' },
  paymentMethods: [
    { code: 'CASH', label: 'Cash' },
    { code: 'MOBILE_MONEY', label: 'Mobile', requiresReference: true },
  ],
} as Session;
const binding = {
  terminalCode: 'T',
  deviceSecret: 'secret',
  activatedAt: new Date().toISOString(),
};
const t: PosTranslate = (key) => key;
const detail: TransactionDetail = {
  id: 'sale',
  number: 'SO',
  total: 1000,
  outstanding: 600,
  tenders: [{ method: 'CASH', amount: 400, reference: null }],
  collections: [],
  returns: [],
  actions: [],
  lines: [{ id: 'line', name: 'Water', quantity: 2, returnable: 2, unitPrice: 500, stock: true }],
  canCollect: true,
  canReturn: true,
  canRefund: true,
};
const key = 'pos-action-v1:t:c:d:b:u';
let harness: ReturnType<typeof deviceDatabase>;
beforeEach(() => {
  harness = deviceDatabase();
  h.db = harness.db;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: deviceLocks() });
  h.get.mockReset();
  h.post.mockReset();
  h.get.mockImplementation(async (path: string) =>
    path.includes('/requests/') ? { state: 'not_found' } : detail,
  );
  h.post.mockResolvedValue({ number: 'CP-1' });
});
async function boot(extra = {}) {
  const view = render(
    <TransactionActions
      binding={binding}
      session={session}
      saleId="sale"
      online
      owned
      t={t}
      onChanged={() => undefined}
      {...extra}
    />,
  );
  await screen.findByRole('button', { name: 'posCollectPayment' });
  return view;
}
async function collect() {
  await userEvent.click(screen.getByRole('button', { name: 'posCollectPayment' }));
  fireEvent.change(screen.getByLabelText('posCollectionAmount'), { target: { value: '200' } });
  await userEvent.click(screen.getByRole('button', { name: 'posConfirmTransaction' }));
}
it('keeps an interrupted collection frozen across refresh and observes its outcome without charging twice', async () => {
  h.post.mockRejectedValueOnce(new TypeError('Lost response'));
  const view = await boot();
  await collect();
  await screen.findByText('posActionRecovery');
  const original = await readPosAction(key);
  expect(original?.body).toMatchObject({
    amount: 200,
    method: 'CASH',
    requestId: original?.requestId,
  });
  view.unmount();
  h.get.mockImplementation(async (path: string) =>
    path.includes('/requests/') ? { state: 'confirmed', result: { number: 'CP-1' } } : detail,
  );
  render(
    <TransactionActions
      binding={binding}
      session={session}
      saleId={null}
      online
      owned
      t={t}
      onChanged={() => undefined}
    />,
  );
  await screen.findByText('posActionRecovery');
  expect(h.post).toHaveBeenCalledTimes(1);
  await userEvent.click(screen.getByRole('button', { name: 'posCheckOutcome' }));
  await screen.findByText('posRecorded: CP-1');
  expect(h.post).toHaveBeenCalledTimes(1);
  expect(await readPosAction(key)).toBeNull();
});
it('never posts when the durable request fails to save', async () => {
  await boot();
  harness.abortNext();
  await collect();
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  expect(h.post).not.toHaveBeenCalled();
  expect(await readPosAction(key)).toBeNull();
});
it('keeps the same request identity when a retry is explicitly selected', async () => {
  h.get.mockImplementation(async (path: string) => {
    if (path.includes('/requests/')) throw new TypeError('Unavailable');
    return detail;
  });
  await boot();
  await collect();
  await screen.findByText('posActionRecovery');
  const original = await readPosAction(key);
  expect(h.post).not.toHaveBeenCalled();
  h.get.mockImplementation(async (path: string) =>
    path.includes('/requests/') ? { state: 'not_found' } : detail,
  );
  await userEvent.click(screen.getByRole('button', { name: 'posRetryOriginal' }));
  await screen.findByText('posRecorded: CP-1');
  expect(h.post).toHaveBeenCalledWith(
    '/mobile-pos-lite/transactions/sale/collections',
    original?.body,
    expect.anything(),
  );
});
it('requires return review and submits the original line and damaged disposition', async () => {
  await boot();
  await userEvent.click(screen.getByRole('button', { name: 'posReturnRefund' }));
  expect(screen.getByRole('button', { name: 'posConfirmTransaction' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Water/), { target: { value: '1' } });
  await userEvent.selectOptions(screen.getByLabelText('posDisposition'), 'DAMAGED');
  await userEvent.type(screen.getByLabelText('posReturnReason'), 'Damaged item');
  expect(screen.getByText('posActionReview')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'posConfirmTransaction' }));
  await screen.findByText('posRecorded: CP-1');
  expect(h.post).toHaveBeenCalledWith(
    '/mobile-pos-lite/transactions/sale/returns',
    expect.objectContaining({
      reason: 'Damaged item',
      lines: [{ lineId: 'line', quantity: 1, disposition: 'DAMAGED' }],
    }),
    expect.anything(),
  );
});
it('requires active till ownership for financial actions', async () => {
  await boot({ owned: false });
  expect(screen.getByRole('button', { name: 'posCollectPayment' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'posReturnRefund' })).toBeDisabled();
  expect(h.post).not.toHaveBeenCalled();
});

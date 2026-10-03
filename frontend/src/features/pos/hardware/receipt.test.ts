import { expect, it } from 'vitest';
import { buildReceipt } from './receipt';
import type { Session } from '../core/pos-types';
const args = {
  session: {
    company: { name: 'Company' },
    branch: { name: 'Branch' },
    terminal: { name: 'Till' },
    rep: { name: 'Cashier' },
  } as Session,
  cart: [],
  total: 1000,
  saleResult: null,
  held: false,
  paymentLabel: 'Split',
  paymentMethod: 'MIXED',
  receivedAmount: 700,
  customer: { id: 'c', name: 'Asha' },
  issuedAt: new Date(),
};
it('calculates change against the cash allocation, not the total sale', () => {
  const receipt = buildReceipt({
    ...args,
    payments: [
      { method: 'CASH', amount: 500 },
      { method: 'MOBILE_MONEY', amount: 200, reference: 'REF' },
    ],
  });
  expect(receipt.change).toBe(200);
  expect(receipt.outstanding).toBe(300);
  expect(receipt.payments).toHaveLength(2);
});
it('shows the balance for an entirely credit sale', () => {
  expect(buildReceipt({ ...args, paymentMethod: 'CREDIT', receivedAmount: null }).outstanding).toBe(
    1000,
  );
});
it('uses the acknowledged server balance after checkout', () => {
  expect(
    buildReceipt({
      ...args,
      payments: [{ method: 'CASH', amount: 500 }],
      saleResult: { id: 's', totalAmount: 1000, outstandingAmount: 400 },
    }).outstanding,
  ).toBe(400);
});

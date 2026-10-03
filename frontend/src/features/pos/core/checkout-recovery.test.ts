import { describe, expect, it, vi } from 'vitest';
import { observeCheckout, sendCheckout } from './checkout-recovery';
import type { PendingMobilePosLiteSale } from '@/lib/mobile-pos-lite-store';

const original: PendingMobilePosLiteSale = {
  id: 'attempt-1',
  terminalCode: 'T-001',
  ownerId: 'rep-1',
  createdAt: '2026-10-03T10:00:00Z',
  totalAmount: 2300,
  lineSummary: '2× Soda',
  payload: {
    idempotencyKey: 'one-physical-sale-request',
    paymentMethod: 'MOBILE_MONEY',
    paymentReference: 'MP-123',
    customerId: 'customer-1',
    lines: [{ productId: 'p1', quantity: 2, unitPrice: 1150, priceReason: 'REGULAR_CUSTOMER' }],
  },
};
const confirmed = { id: 'so-1', salesOrderNumber: 'SO-1', totalAmount: 2300 };
function setup() {
  const records = new Map<string, PendingMobilePosLiteSale>();
  const dependencies = {
    save: vi.fn(async (value: PendingMobilePosLiteSale) => {
      records.set(value.id, structuredClone(value));
    }),
    remove: vi.fn(async (id: string) => {
      records.delete(id);
    }),
    submit: vi.fn(async () => confirmed),
    observe: vi.fn(async () => ({ state: 'not_found' as const })),
    connectionFailure: (error: unknown) => error instanceof TypeError,
  };
  return { records, dependencies };
}
describe('durable checkout identity', () => {
  it('commits the saved intent before submitting, including prices and payment reference', async () => {
    const { records, dependencies } = setup();
    dependencies.submit.mockImplementation(async () => {
      expect(records.get(original.id)).toMatchObject({ ...original, requiresReview: true });
      return confirmed;
    });
    expect(await sendCheckout(original, dependencies, true)).toEqual({
      kind: 'confirmed',
      sale: confirmed,
    });
    expect(dependencies.save.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.submit.mock.invocationCallOrder[0],
    );
    expect(records.size).toBe(0);
  });
  it('never sends when device storage aborts', async () => {
    const { dependencies } = setup();
    dependencies.save.mockRejectedValue(new Error('Transaction aborted'));
    await expect(sendCheckout(original, dependencies, true)).rejects.toThrow('Transaction aborted');
    expect(dependencies.submit).not.toHaveBeenCalled();
  });
  it('keeps an interrupted mobile payment frozen for explicit checking, even with offline cash enabled', async () => {
    const { records, dependencies } = setup();
    dependencies.submit.mockRejectedValue(new TypeError('Failed to fetch'));
    const outcome = await sendCheckout(original, dependencies, true);
    expect(outcome.kind).toBe('review');
    expect(records.get(original.id)).toMatchObject({ ...original, requiresReview: true });
    expect(dependencies.submit).toHaveBeenCalledTimes(1);
    expect(dependencies.observe).not.toHaveBeenCalled();
  });
  it('observes the original identity after reload without another money-changing request', async () => {
    const { records, dependencies } = setup();
    dependencies.submit.mockRejectedValue(new TypeError('Failed to fetch'));
    await sendCheckout(original, dependencies, false);
    dependencies.observe.mockResolvedValue({ state: 'confirmed', sale: confirmed } as never);
    expect(await observeCheckout(records.get(original.id)!, dependencies)).toEqual({
      state: 'confirmed',
      sale: confirmed,
    });
    expect(dependencies.observe).toHaveBeenCalledWith(original.payload.idempotencyKey);
    expect(dependencies.submit).toHaveBeenCalledTimes(1);
    expect(records.size).toBe(0);
  });
  it('retries the identical request after an authoritative missing lookup', async () => {
    const { records, dependencies } = setup();
    dependencies.submit.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await sendCheckout(original, dependencies, false);
    const saved = records.get(original.id)!;
    await observeCheckout(saved, dependencies);
    await sendCheckout(saved, dependencies, false);
    expect(dependencies.submit.mock.calls.map((call) => call[0])).toEqual([
      original.payload,
      original.payload,
    ]);
  });
  it('recognises a committed sale despite a failed response and device cleanup', async () => {
    const { dependencies } = setup();
    dependencies.submit.mockRejectedValue(
      Object.assign(new Error('Gateway failed'), { status: 502 }),
    );
    dependencies.observe.mockResolvedValue({ state: 'confirmed', sale: confirmed } as never);
    dependencies.remove.mockRejectedValue(new Error('Device write failed'));
    expect(await sendCheckout(original, dependencies, false)).toEqual({
      kind: 'confirmed',
      sale: confirmed,
    });
  });
  it.each([403, 409, 500])(
    'retains a protected attempt for status %s, including expired permissions',
    async (status) => {
      const { records, dependencies } = setup();
      dependencies.submit.mockRejectedValue(Object.assign(new Error('Refused'), { status }));
      expect((await sendCheckout(original, dependencies, false)).kind).toBe('review');
      expect(records.get(original.id)?.payload).toEqual(original.payload);
    },
  );
  it('does not clear a rejected request when an unfinished server order occupies the key', async () => {
    const { records, dependencies } = setup();
    dependencies.submit.mockRejectedValue(
      Object.assign(new Error('Invalid price'), { status: 400 }),
    );
    dependencies.observe.mockResolvedValue({
      state: 'needs_attention',
      reference: 'SO-DRAFT',
    } as never);
    expect((await sendCheckout(original, dependencies, false)).kind).toBe('review');
    expect(records.size).toBe(1);
  });
  it('allows correcting a validation failure only when the server confirms no order exists', async () => {
    const { records, dependencies } = setup();
    dependencies.submit.mockRejectedValue(
      Object.assign(new Error('Invalid price'), { status: 400 }),
    );
    expect((await sendCheckout(original, dependencies, false)).kind).toBe('rejected');
    expect(records.size).toBe(0);
  });
  it('queues only supported cash; failure to persist the queue state keeps the last saved copy for review', async () => {
    const { records, dependencies } = setup();
    dependencies.submit.mockRejectedValue(new TypeError('Failed to fetch'));
    const cash = { ...original, payload: { ...original.payload, paymentMethod: 'CASH' } };
    const queued = await sendCheckout(cash, dependencies, true);
    expect(queued.kind).toBe('queued');
    expect(records.get(original.id)?.requiresReview).toBe(false);
    const second = setup();
    second.dependencies.submit.mockRejectedValue(new TypeError('Failed to fetch'));
    second.dependencies.save.mockImplementation(async (value) => {
      if (value.requiresReview === false) throw new Error('Storage full');
      second.records.set(value.id, value);
    });
    expect((await sendCheckout(cash, second.dependencies, true)).kind).toBe('review');
    expect(second.records.get(original.id)?.requiresReview).toBe(true);
  });
});
